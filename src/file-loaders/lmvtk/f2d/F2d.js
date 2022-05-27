
import { VertexBufferBuilder}  from "../common/VertexBufferBuilder";
import { LmvBox3 } from "../../../wgs/scene/LmvBox3";
import { LmvVector3 } from "../../../wgs/scene/LmvVector3";
import { VBUtils } from "../common/VbUtils";
import { InputStream } from "../common/InputStream";
import { logger } from "../../../logger/Logger";
import { errorCodeString, ErrorCodes } from "../../net/ErrorCodes";


var MOBILE_MAX_VCOUNT = 16383;

export var F2dDataType = {
    //Fixed size types
    dt_object : 0,
    dt_void : 1,
    dt_byte : 2,
    dt_int : 3,
    dt_float : 4,
    dt_double : 5,
    dt_varint : 6,
    dt_point_varint : 7,

    //Variable size types
    //Data bytes are prefixed by an integer
    //representing the number of elements in the array.
    dt_byte_array : 32,
    dt_int_array : 33,
    dt_float_array : 34,
    dt_double_array : 35,
    dt_varint_array : 36,
    //Special variable int encoding for point data
    dt_point_varint_array : 37,

    //Well-known data types that help reduce output size for commonly
    //encountered simple geometries
    dt_arc : 38,
    dt_circle : 39,
    dt_circular_arc : 40,

    dt_string : 63,
    //do not want to go into varint range
    dt_last_data_type : 127
};

export var F2dSemanticType = {
    //For objects with fixed serialization (arc, raster) we don't bother having dedicated semantic for each member
    //and assume the parsing application knows the order they appear. There is still an end-object tag of course
    //which shows where the object ends.
    st_object_member : 0,

    //Simple / fixed size attributes
    st_fill : 1,
    st_fill_off : 2,
    st_clip_off : 3,
    st_layer : 4,
    st_link : 5,
    st_line_weight : 6,
    st_miter_angle : 7,
    st_miter_length : 8,
    st_line_pattern_ref : 9,
    st_back_color : 10,
    st_color : 11,
    st_markup : 12,
    st_object_id : 13,
    st_markup_id : 14,
    st_reset_rel_offset : 15,
    st_font_ref : 16,

    //Compound object opcodes

    //Begin a generic object opcode
    st_begin_object : 32,

    //Style attribute related opcodes. Those are compound objects
    st_clip : 33,
    st_line_caps : 34,
    st_line_join : 35,
    st_line_pattern_def : 36,
    st_font_def : 37,
    st_viewport : 38,

    //Drawables are all objects-typed bounded by begin/end object opcodes

    //Root level document begin
    st_sheet : 42,
    //Circle, Ellipse, Arcs
    st_arc : 43,
    //The grandfather of them all
    st_polyline : 44,
    st_raster : 45,
    st_text : 46,
    st_polytriangle : 47,
    st_dot : 48,
    //end object -- could be ending a generic object or drawable, etc.
    st_end_object : 63,

    st_last_semantic_type : 127
};

// F2D shadow ratio, relative to paper width.
export const F2dShadowRatio = 0.0075;


//Initializes a structure of counters used for statistical purposes and sheet content hash
function initGeomMetrics() {
    return {
        "arcs": 0,
        "circles": 0,
        "circ_arcs": 0,
        "viewports": 0,
        "clips": 0,
        "colors": 0,
        "db_ids": 0,
        "dots": 0,
        "fills": 0,
        "layers": 0,
        "line_caps": 0,
        "line_joins": 0,
        "line_patterns": 0,
        "line_pat_refs": 0,
        "plines": 0,
        "pline_points": 0,
        "line_weights": 0,
        "links": 0,
        "miters": 0,
        "ptris": 0,
        "ptri_indices": 0,
        "ptri_points": 0,
        "rasters": 0,
        "texts": 0,
        "strings": []
    };
}


// Restore sign bit from LSB of an encoded integer which has the sign bit
// moved from MSB to LSB.
// The decoding process is the reverse by restoring the sign bit from LSB to MSB.
export function restoreSignBitFromLSB(integer) {
    return (integer & 1) ? -(integer >>> 1) : (integer >>> 1);
};

export function F2D(metadata, manifest, basePath, options = {}) {
    this.metadata = metadata;
    this.scaleX = 1;
    this.scaleY = 1;
    this.bbox = { min:{x:0,y:0,z:0}, max:{x:0,y:0,z:0} };
    this.is2d = true;
    this.layersMap = {};
    this.fontDefs = {};
    this.fontCount = 0;
    this.fontId = 0;
    this.manifestAvailable = false;
    this.geomMetricsSum = 0;
    this.objectMemberQueue = [];

    this.propertydb = {
        attrs : [],
        avs: [],
        ids: [],
        values: [],
        offsets: [],
        viewables: []
    };

    if (metadata) {

        var dims = metadata.page_dimensions;

        this.paperWidth = dims.page_width;
        this.paperHeight = dims.page_height;

        // TODO: scale parsing.
        this.scaleX = this.paperWidth / dims.plot_width;
        this.scaleY = this.paperHeight / dims.plot_height;

        this.hidePaper = dims.hide_paper;

        var pw = this.paperWidth;
        var ph = this.paperHeight;
        this.bbox.max.x = pw;
        this.bbox.max.y = ph;

        var dim = metadata.page_dimensions || {};
        // If the paper is rotated or offset, include that in the bbox
        if (isFinite(dim.paper_rotation) && dim.paper_rotation !== 0) {
            var angle = dim.paper_rotation * Math.PI / 180;
            var cos = Math.cos(angle);
            var sin = Math.sin(angle);
            var dwx;
            var dwx = pw * cos;
            var dwy = pw * sin;
            var dhx = -ph * sin;
            var dhy = ph * cos;
            this.bbox.min.x = Math.min(0, dwx, dhx, dwx + dhx);
            this.bbox.max.x = Math.max(0, dwx, dhx, dwx + dhx);
            this.bbox.min.y = Math.min(0, dwy, dhy, dwy + dhy);
            this.bbox.max.y = Math.max(0, dwy, dhy, dwy + dhy);
        }
        if (isFinite(dim.paper_offset_x) && dim.paper_offset_x !== 0) {
            this.bbox.min.x += dim.paper_offset_x;
            this.bbox.max.x += dim.paper_offset_x;
        }
        if (isFinite(dim.paper_offset_y) && dim.paper_offset_y !== 0) {
            this.bbox.min.y += dim.paper_offset_y;
            this.bbox.max.y += dim.paper_offset_y;
        }

        //Initialize mapping between layer index -> layer number to be used for rendering
        var count = 0;
        //Some geometry comes on null layer, and we reserve a spot for that one.
        //For example, Revit plots have no layers at all.
        this.layersMap[0] = count++;

        for (var l in metadata.layers) {

            var index = parseInt(l);

            //We store in a map in order to allow non-consecutive layer numbers,
            //which does happen.
            this.layersMap[index] = count++;
        }

        this.layerCount = count;

        //Create a layers tree to be used by the UI -- this splits AutoCAD style
        //layer groups (specified using | character) into a tree of layers.
        this.createLayerGroups(metadata.layers);

        if (metadata.geom_metrics) {
            var values = Object.keys(metadata.geom_metrics).map(function(key) {
                return metadata.geom_metrics[key];
            })
            this.geomMetricsSum = values.reduce((acc, cur) => acc + cur);
        }
    }

    this.hidePaper = this.hidePaper || options.modelSpace;
    this.noShadow = !!options.noShadow; // The request to not draw a shadow

    this.hasPageShadow = false; // Will be true only if the shadow was actually created

    // For debugging only. Could be removed.
    this.opCount = 0;

    this.excludeTextGeometry = options.excludeTextGeometry;
    //provides additional parameters for precise text search and highlight
    this.extendStringsFetching = options.extendStringsFetching;

    this.fontFaces = [];
    this.fontFamilies = [];

    this.viewports = [{}]; // make viewport index start at 1, 0 as paper is used in LineShader
    this.currentVpId = 0; // current viewport index
    this.viewports[0].geom_metrics = this.currentGeomMetrics = initGeomMetrics();

    this.clips = [0]; // make clip index start at 1, matched with viewport index

    this.strings = [];
    this.stringDbIds = [];
    this.stringBoxes = [];
    if (this.extendStringsFetching) {
        this.stringCharWidths = [];
        this.stringAngles = [];
        this.stringPositions = [];
        this.stringHeights = [];
    }
    this.currentStringNumber = -1;
    this.currentStringBox = new LmvBox3();

    this.linkBoxes = [];
    this.currentLinkBox = new LmvBox3();

    this.objectNumber = 0;
    this.currentFakeId = -2; //We tag certain objects that we care about (like strings) that have no ID with fake negative IDs instead of giving them default ID of 0.
    this.imageNumber = 0;
    this.linkNumber = 0;
    this.maxObjectNumber = 0;

    this.objectStack = [];
    this.objectNameStack = [];
    this.parseObjState = {
        polyTriangle : {},
        viewport : {},
        clip : {},
        raster : {},
        text: {},
        fontDef: {},
        uknown: {}
    };

    this.layer = 0;

    this.bgColor = (typeof options.bgColor === "number") ? options.bgColor : 0xffffffff;

    //NOTE: Use of contrast color is turned off in mapColor() until UX makes up their mind
    //one way or another.
    this.contrastColor = this.color = this.fillColor = 0xff000000;
    if (this.hidePaper)
        this.contrastColor = 0xffffff00;

    this.isMobile = options && !!options.isMobile;

    // https://git.autodesk.com/A360/firefly.js/pull/3884
    // We spotted multiple devices that doesn't play nice with 2dInstancing and compactBuffers.
    // After some testing, we found out that using WebGL2 fixes the performance issues for these devices.
    // For browsers that don't support WebGL2 (Safari), we want to still use these optimisations, 
    // only if the number of geometries is large (more than 10 million) - this is when the memory optimisation
    // is really important and we can't risk on not using it.
    var isWebGL2 = options && !!options.isWebGL2;
    var useMobileOptimizations = this.isMobile && (isWebGL2 || this.geomMetricsSum > 1e7);
    var useInstancing = useMobileOptimizations && options && !!options.supportsInstancing;
    var useCompactBuffers = useMobileOptimizations;

    this.max_vcount = this.isMobile ? MOBILE_MAX_VCOUNT : undefined;

    this.currentVbb = new VertexBufferBuilder(useInstancing, undefined, this.max_vcount, useCompactBuffers);
    this.meshes = [];

    this.numCircles = this.numEllipses = this.numPolylines = this.numLineSegs = 0;
    this.numPolytriangles = this.numTriangles = 0;

    // Newly added f2d pasing stuff.
    this.error = false;

    // Last absolute positions of point parsed so far.
    // Used to decode relative positions parsed from points array.
    this.offsetX = 0;
    this.offsetY = 0;

    // Parse manifest, do stuff.
    // 1. Build image id to raster URI map used to assign values to texture path.
    // 2. Acquire names of property database json streams.
    if (manifest) {
        this.manifestAvailable = true;
        this.imageId2URI = {};
        var assets = manifest.assets;
        for (var i = 0, e = assets.length; i < e; ++i) {
            var entry = assets[i];
            var mime = entry.mime;
            if (mime.indexOf('image/') !== -1) {
                var id = entry.id;
                id = id.substr(0, id.indexOf('.'));
                this.imageId2URI[id] = basePath + entry.URI;
            }

            if (entry.type === "Autodesk.CloudPlatform.PropertyAttributes")
                this.propertydb.attrs.push({path:entry.URI});
            if (entry.type === "Autodesk.CloudPlatform.PropertyValues")
                this.propertydb.values.push({path:entry.URI});
            if (entry.type === "Autodesk.CloudPlatform.PropertyIDs")
                this.propertydb.ids.push({path:entry.URI});
            if (entry.type === "Autodesk.CloudPlatform.PropertyViewables")
                this.propertydb.viewables.push({path:entry.URI});
            if (entry.type === "Autodesk.CloudPlatform.PropertyOffsets") {
                // rcv and rcv_offsets are not used any longer
                if (entry.id.indexOf('rcv') === -1)
                    this.propertydb.offsets.push({path:entry.URI});
            }
            if (entry.type === "Autodesk.CloudPlatform.PropertyAVs")
                this.propertydb.avs.push({path:entry.URI});
        }

    }
}

F2D.prototype.load = function(loadContext, fydoPack) {

    if (!(fydoPack instanceof Uint8Array))
        fydoPack = new Uint8Array(fydoPack);
    this.data = fydoPack;
    this.parse();

    if (this.stringBoxes.length) {
        var fbuf = new Float32Array(this.stringBoxes.length);
        fbuf.set(this.stringBoxes);
        this.stringBoxes = fbuf;
    }

    loadContext.loadDoneCB(true);
};

F2D.prototype.loadFrames = function(loadContext) {

    this.loadContext = loadContext;

    var data = loadContext.data;

    if (data) {
        if (!(data instanceof Uint8Array))
            data = new Uint8Array(data);
        this.data = data;
    } else if (loadContext.finalFrame) {
        this.data = null;

        if (this.stringBoxes.length) {
            var fbuf = new Float32Array(this.stringBoxes.length);
            fbuf.set(this.stringBoxes);
            this.stringBoxes = fbuf;
        }
    }

    this.parseFrames(loadContext.finalFrame);

    loadContext.loadDoneCB(true);
};


F2D.prototype.pushMesh = function(mesh) {
    this.meshes.push(mesh);


    mesh.material = {
                        skipEllipticals : !this.currentVbb.numEllipticals,
                        skipCircles: !this.currentVbb.numCirculars,
                        skipTriangleGeoms : !this.currentVbb.numTriangleGeoms,
                        useInstancing : this.currentVbb.useInstancing,
                        unpackPositions: !!mesh.unpackXform
                    };

    if (this.currentImage) {
        mesh.material.image = this.currentImage;
        mesh.material.image.name = this.imageNumber++;
        this.currentImage = null;
    }
}

F2D.prototype.flushBuffer = function(addCount, finalFlush)
{
    if (!this.currentVbb.vcount && !finalFlush)
    {
        return;
    }

    var flush = finalFlush;
    flush = flush || this.currentVbb.isFull(addCount);

    if (flush) {
        if (this.currentVbb.vcount) {
            var mesh = this.currentVbb.toMesh();
            VBUtils.bboxUnion(this.bbox, mesh.boundingBox);

            this.pushMesh(mesh);
            this.currentVbb.reset(0);
        }

        if (this.loadContext)
            this.loadContext.loadDoneCB(true, finalFlush);
    }


};

F2D.prototype.tx = function(x) {
    return this.sx(x);
};

F2D.prototype.ty = function(y) {
    return this.sy(y);
};

F2D.prototype.sx = function(x) {
    //TODO: The hardcoded scale is used to get the integer coords from FYDO
    //into something normal and close to page coordinates
    return x * this.scaleX;
};

F2D.prototype.sy = function(y) {
    //TODO: The hardcoded scale is used to get the integer coords from FYDO
    //into something normal and close to page coordinates
    return y * this.scaleY;
};

F2D.prototype.invertColor = function(c) {
    var a = ((c >> 24) & 0xff);
    var b = ((c >> 16) & 0xff);
    var g = ((c >>  8) & 0xff);
    var r = ((c)       & 0xff);

    b = 255 - b;
    g = 255 - g;
    r = 255 - r;

    return (a << 24) | (b << 16) | (g << 8) | r;
};

F2D.prototype.mapColor = function(c, isFill) {

    if (!this.hidePaper || this.bgColor !== 0)
        return c;

    //Color substitution in cases when we want to interleave the 2D drawing
    //into a 3D scene (when bgColor is explicitly specified as transparent black (0)
    //and hidePaper is set to true.

    var r = c & 0xff;
    var g = (c & 0xff00) >> 8;
    var b = (c & 0xff0000) >> 16;

    var isGrey = (r === g) && (r === b);

    if (r < 0x7f) {
        //c = this.contrastColor;
    } else if (isGrey && isFill) {
        c = c & 0x55ffffff;
    }

    return c;
};

// ====================== F2D Parser ================================= //


// Convert relative positions to absolute positions, and update global offsets.
F2D.prototype.parsePointPositions = function() {
    var x = this.stream.getVarints();
    var y = this.stream.getVarints();

    x = restoreSignBitFromLSB(x);
    y = restoreSignBitFromLSB(y);

    x += this.offsetX;
    y += this.offsetY;

    this.offsetX = x;
    this.offsetY = y;

    return [this.tx(x), this.ty(y)];
};

F2D.prototype.parserAssert = function(actualType, expectedType, functionName) {
    if (actualType != expectedType) {
        logger.warn("Expect " + expectedType + "; actual type is " +
            actualType + "; in function " + functionName);
        this.error = true;
        return true;
    } else {
        return false;
    }
};

F2D.prototype.unhandledTypeWarning = function(inFunction, semanticType) {
    logger.warn("Unhandled semantic type : " + semanticType + " in function " + inFunction);
};

F2D.prototype.parseObject = function() {
    var semantic_type = this.stream.getVarints();
    this.objectStack.push(semantic_type);
    //debug(semantic_type);
    switch (semantic_type) {
        case F2dSemanticType.st_sheet :
            this.objectNameStack.push("sheet");
            this.objectMemberQueue.unshift("paperColor");
            break;
        case F2dSemanticType.st_viewport :
            this.objectNameStack.push("viewport");
            this.objectMemberQueue.unshift("units", "transform");
            break;
        case F2dSemanticType.st_clip :
            this.objectNameStack.push("clip");
            this.objectMemberQueue.unshift("contourCounts", "points", "indices");
            break;
        case F2dSemanticType.st_polytriangle :
            this.objectNameStack.push("polyTriangle");
            this.objectMemberQueue.unshift("points", "indices", "colors");
            break;
        case F2dSemanticType.st_raster:
            this.objectNameStack.push("raster");
            this.objectMemberQueue.unshift("position", "width", "height", "imageId");
            break;
        case F2dSemanticType.st_text:
            this.currentStringNumber = this.strings.length;
            if (this.objectNumber === 0)
                this.objectNumber = this.currentFakeId--;
            this.currentStringBox.makeEmpty();
            this.objectNameStack.push("text");
            this.objectMemberQueue.unshift("string", "position", "height", "widthScale", "rotation", "oblique", "charWidths");
            break;
        case F2dSemanticType.st_font_def:
            this.objectNameStack.push("fontDef");
            this.objectMemberQueue.unshift("name", "fullName", "flags", "spacing", "panose");
            break;
        case F2dSemanticType.st_end_object : {
                this.objectStack.pop(); //pop the end_object we pushed at the beginning of the function

                if (!this.objectStack.length)
                    this.parserAssert(0,1, "parseEndObject (Stack Empty)");
                else {
                    //Do any end-of-object post processing depending on object type
                    var objType = this.objectStack.pop(); //pop the start object

                    switch (objType) {
                        case F2dSemanticType.st_polytriangle:   this.actOnPolyTriangle(); break;
                        case F2dSemanticType.st_viewport:       this.actOnViewport(); break;
                        case F2dSemanticType.st_clip:           this.actOnClip(); break;
                        case F2dSemanticType.st_raster:         this.actOnRaster(); break;
                        case F2dSemanticType.st_text:           this.actOnText(); break;
                        case F2dSemanticType.st_font_def:       this.actOnFontDef(); break;
                    }

                    //Zero out the state of the object we just finished processing
                    var name = this.objectNameStack.pop();
                    var state = this.parseObjState[name];
                    for (var p in state)
                        state[p] = null;
                }

                this.objectMemberQueue.length = 0;
            }
            break;
        default:
            this.objectNameStack.push("unknown");
            this.error = true;
            this.unhandledTypeWarning('parseObject', semantic_type);
            break;
    }
};


F2D.prototype.initSheet = function(paperColor) {
    if (this.hidePaper)
        return;
    
    this.bgColor = paperColor;

    if (this.metadata) {
        var pw = this.paperWidth;
        var ph = this.paperHeight;
        
        var o = { x: 0, y: 0 };                     // origin
        var dw = { x: pw, y: 0 };      // paper width direction
        var dh = { x: 0, y: ph };     // paper height direction

        // If the metadata has a non-zero rotation, then use it
        var dim = this.metadata.page_dimensions || {};
        if (isFinite(dim.paper_rotation) && dim.paper_rotation !== 0) {
            var angle = dim.paper_rotation * Math.PI / 180;
            var cos = Math.cos(angle);
            var sin = Math.sin(angle);
            dw.y = pw * sin;
            dw.x = pw * cos;
            dh.x = -ph * sin;
            dh.y = ph * cos;
        }
        // If the metadata has a non-zero offset, then use them
        if (isFinite(dim.paper_offset_x) && dim.paper_offset_x !== 0) {
            o.x = dim.paper_offset_x;
        }
        if (isFinite(dim.paper_offset_y) && dim.paper_offset_y !== 0) {
            o.y = dim.paper_offset_y;
        }

        var vbb = this.currentVbb;

        var points = [o.x,o.y, o.x+dw.x,o.y+dw.y, o.x+dw.x+dh.x,o.y+dw.y+dh.y, o.x+dh.x,o.y+dh.y];
        var colors = [paperColor, paperColor, paperColor, paperColor];
        var indices = [0,1,2,0,2,3];
        
        if (!this.noShadow) {
            var ss = pw * F2dShadowRatio;
            var ssw = { x: dw.x * ss / pw, y: dw.y * ss / pw }; // shadow offset in width direction
            var ssh = { x: dh.x * ss / ph, y: dh.y * ss / ph }; // shadow offset in height direction
            var ssb = { x: o.x+ssw.x, y: o.y+ssw.y };           // bottom shadow origin
            var ssr = { x: o.x+dw.x, y: o.y+dw.y };             // right shadow origin
            var shadowColor = 0xff555555;

            points = points.concat([ssb.x-ssh.x,ssb.y-ssh.y, ssb.x-ssh.x+dw.x,ssb.y-ssh.y+dw.y, ssb.x+dw.x,ssb.y+dw.y, ssb.x,ssb.y,
                ssr.x,ssr.y, ssr.x+ssw.x,ssr.y+ssw.y, ssr.x+ssw.x-ssh.x+dh.x,ssr.y+ssw.y-ssh.y+dh.y, ssr.x-ssh.x+dh.x,ssr.y-ssh.y+dh.y]);
            colors = colors.concat([shadowColor, shadowColor, shadowColor,shadowColor,
                shadowColor, shadowColor, shadowColor,shadowColor]);
            indices = indices.concat([4,5,6,4,6,7,
                8,9,10,8,10,11]);

            this.hasPageShadow = true;
        }

        var paperLayer = 0; //Put the paper the null layer so it won't get turned off.
        var paperDbId = -1;

        this.addPolyTriangle(points, colors, indices, 0xffffffff, paperDbId, paperLayer, false);

        //Page outline
        vbb.addSegment(o.x,o.y,o.x+dw.x,o.y+dw.y,   0, 1e-6, 0xff000000, paperDbId, paperLayer, this.currentVpId);
        vbb.addSegment(o.x+dw.x,o.y+dw.y,o.x+dw.x+dh.x,o.y+dw.y+dh.y, 0, 1e-6, 0xff000000, paperDbId, paperLayer, this.currentVpId);
        vbb.addSegment(o.x+dw.x+dh.x,o.y+dw.y+dh.y,o.x+dh.x,o.y+dh.y, 0, 1e-6, 0xff000000, paperDbId, paperLayer, this.currentVpId);
        vbb.addSegment(o.x+dh.x,o.y+dh.y,o.x,o.y,   0, 1e-6, 0xff000000, paperDbId, paperLayer, this.currentVpId);


        //Test pattern for line styles.
        //for (var i=0; i<39; i++) {
        //    vbb.addSegment(0, ph + i * 0.25 + 1, 12, 12 + ph + i * 0.25 + 1, 0, -1 /* device space pixel width */, 0xff000000, 0xffffffff, 0, 0, i);
        //}

        //Test pattern for line styles.
        //for (var i=0; i<39; i++) {
        //    vbb.addSegment(0, ph + (i+39) * 0.25 + 1, 12, 12 + ph + (i+39) * 0.25 + 1, 0, (1.0 / 25.4) /*1mm width*/, 0xff000000, 0xffffffff, 0, 0, i);
        //}

    }
};

F2D.prototype.setObjectMember = function(val) {
    if (!this.objectMemberQueue.length) {
        logger.warn("Unexpected object member. " + val + " on object " + this.objectNameStack[this.objectNameStack.length-1]);
        return false;
    }

    var propName = this.objectMemberQueue.shift();
    var curObjName = this.objectNameStack[this.objectNameStack.length-1];

    //The paper color needs to be processed as soon as it comes in
    //because we want to initialize the page geometry first, before
    //adding any other geometry
    if (curObjName == "sheet" && propName == "paperColor") {
        this.initSheet(val);
        return true;
    }
    else if (curObjName) {
        this.parseObjState[curObjName][propName] = val;
        return true;
    }

    return false;
};


F2D.prototype.parseString = function() {
    var s = this.stream;
    var sema = s.getVarints();

    var len = s.getVarints();
    var ret = s.getString(len);

    switch (sema) {
        case F2dSemanticType.st_object_member:
            if (this.setObjectMember(ret))
                return;
            break;
        default: logger.info("Unexpected opcode semantic type for string.");  break;
    }

    return ret;
};


F2D.prototype.actOnFontDef = function() {
    var fontDef = this.parseObjState.fontDef;
    this.fontDefs[++this.fontCount] = fontDef;
    this.fontId = this.fontCount;
};


F2D.prototype.parsePoint = function() {
    var s = this.stream;
    var sema = s.getVarints(); //skip past the semantics
    var ret = this.parsePointPositions();

    switch (sema) {
        case F2dSemanticType.st_object_member:
            if (this.setObjectMember(ret))
                return;
            break;
        default: logger.info("Unexpected opcode semantic type for point.");  break;
    }

    return ret;
};


F2D.prototype.parsePointsArray = function() {

    var s = this.stream;

    var sema = s.getVarints();

    var count = s.getVarints(); // number of coordinates * 2
    if (!count) return;
    count = count / 2;

    var ret = [];
    var position;

    for (var i = 0; i < count; ++i) {
        position = this.parsePointPositions();
        ret.push(position[0]);
        ret.push(position[1]);
    }

    switch (sema) {
        case F2dSemanticType.st_polyline :
            this.actOnPolylinePointsArray(ret);
            return;
        case F2dSemanticType.st_dot:
            this.actOnDot(ret);
            return;
        case F2dSemanticType.st_object_member:
            if (this.setObjectMember(ret))
                return;
            break;
        default: logger.info("Unexpected opcode semantic type for points array.");  break;
    }

    return ret;
};

F2D.prototype.parseIntArray = function() {
    var s = this.stream;
    var sema = s.getVarints();
    var count = s.getVarints(); // total number of elements in integer array.
    var retVal = [];
    for (var i = 0; i < count; ++i) {
        retVal.push(s.getUint32());
    }

    switch (sema) {
        case F2dSemanticType.st_object_member:
            if (this.setObjectMember(retVal))
                return;
            break;
        default:
            this.unhandledTypeWarning('parseIntArray', sema);
            break;
    }

    return retVal;
};

F2D.prototype.parseDoubleArray = function() {
    var s = this.stream;
    var sema = s.getVarints();
    var count = s.getVarints(); // total number of elements in integer array.
    var retVal = [];
    for (var i = 0; i < count; ++i) {
        retVal.push(s.getFloat64());
    }

    switch (sema) {
        case F2dSemanticType.st_object_member:
            if (this.setObjectMember(retVal))
                return;
            break;
        default:
            this.unhandledTypeWarning('parseDoubleArray', sema);
            break;
    }

    return retVal;
};

F2D.prototype.parseByteArray = function() {
    var s = this.stream;
    var sema = s.getVarints();
    var count = s.getVarints(); // total number of elements in byte array.
    var retVal = [];
    for (var i = 0; i < count; ++i) {
        retVal.push(s.getUint8());
    }

    switch (sema) {
        case F2dSemanticType.st_object_member:
            if (this.setObjectMember(retVal))
                return;
            break;
        default:
            this.unhandledTypeWarning('parseByteArray', sema);
            break;
    }

    return retVal;
};


F2D.prototype.parseVarintArray = function() {
    var s = this.stream;
    var sema = s.getVarints();

    var ret = [];

    // Total number of integers in array, not the total number of bytes.
    var count = s.getVarints();

    for (var i = 0; i < count; ++i) {
        ret.push(s.getVarints());
    }

    switch (sema) {
        case F2dSemanticType.st_object_member:
            if (this.setObjectMember(ret))
                return;
            break;
        default:
            this.unhandledTypeWarning('parseVarIntArray', sema);
            break;
    }

    return ret;
};


F2D.prototype.parseInt = function() {
    var s = this.stream;
    var sema = s.getVarints();
    var val = s.getUint32();

    switch (sema) {
        case F2dSemanticType.st_color:
            this.color = this.mapColor(val, false);
            this.currentGeomMetrics.colors++;
            break;
        case F2dSemanticType.st_fill:
            this.fill = true;
            this.fillColor = this.mapColor(val, true);
            this.currentGeomMetrics.fills++;
            break;
        case F2dSemanticType.st_object_member:
            if (this.setObjectMember(val))
                return;
        default:
            this.unhandledTypeWarning('parseInt', sema);
            break;
    }

    return val;
};

F2D.prototype.parseVoid = function() {
  var sema = this.stream.getVarints();
  switch (sema) {
      case F2dSemanticType.st_fill_off:
          this.fill = false;
          this.currentGeomMetrics.fills++;
          break;
      default:
          this.unhandledTypeWarning('parseVoid', sema);
          break;
  }
};

F2D.prototype.parseVarint = function() {
    var s = this.stream;
    var semantic_type = s.getVarints();
    var val = s.getVarints();

    switch (semantic_type) {
        case F2dSemanticType.st_line_weight:
            this.lineWeight = this.tx(val);
            this.currentGeomMetrics.line_weights++;
            break;
        case F2dSemanticType.st_line_caps:
            this.currentGeomMetrics.line_caps++;
            break;
        case F2dSemanticType.st_line_join:
            this.currentGeomMetrics.line_joins++;
            break;
        case F2dSemanticType.st_object_id:
        case F2dSemanticType.st_markup_id:
            this.objectNumber = val;
            this.maxObjectNumber = Math.max(this.maxObjectNumber, val);
            this.currentGeomMetrics.db_ids++;
            break;
        case F2dSemanticType.st_link:
            if (this.linkNumber) {
                this.linkBoxes[this.linkNumber] = this.currentLinkBox.clone();
                this.currentLinkBox.makeEmpty();
            }
            this.linkNumber = val;
            break;
        case F2dSemanticType.st_layer:
            this.currentGeomMetrics.layers++;
            this.layer = this.layersMap[val];
            break;
        case F2dSemanticType.st_font_ref:
            this.fontId = val;
            break;
        case F2dSemanticType.st_object_member:
            if (this.setObjectMember(val))
                return;
            break;
        default:
            break;
    }

    return val;
};

F2D.prototype.parseFloat = function() {
    var s = this.stream;
    var semantic_type = s.getVarints();
    var val = s.getFloat32();

    switch (semantic_type) {
        case F2dSemanticType.st_miter_angle:
            break;
        case F2dSemanticType.st_miter_length:
            break;
        case F2dSemanticType.st_object_member:
            if (this.setObjectMember(val)) {
                return;
            }
            break;
        default:
            break;
    }

    return val;
};

F2D.prototype.parseCircularArc = function() {
    var s = this.stream;
    var sema = s.getVarints();
    if (this.parserAssert(sema, F2dSemanticType.st_arc, 'parseCircularArc')) return;

    var point = this.parsePointPositions();
    var major = s.getVarints(), /*rotation = s.getFloat32(),*/ start = s.getFloat32(), end = s.getFloat32();

    this.actOnCircularArc(point[0], point[1], start, end, this.sx(major));
};

F2D.prototype.parseCircle = function() {
    var s = this.stream;
    var sema = s.getVarints();
    if (this.parserAssert(sema, F2dSemanticType.st_arc, 'parseCircle')) return;

    var point = this.parsePointPositions();
    var major = s.getVarints();

    this.actOnCompleteCircle(point[0], point[1], this.sx(major));
};

F2D.prototype.parseArc = function() {
    var s = this.stream;
    var sema = s.getVarints();
    if (this.parserAssert(sema, F2dSemanticType.st_arc, 'parseArc')) return;

    // Relative positions.
    var point = this.parsePointPositions();

    var major = s.getVarints();
    var minor = s.getVarints();

    var rotation = s.getFloat32();
    var start = s.getFloat32();
    var end = s.getFloat32();

    this.actOnArc(point[0], point[1], start, end, this.sx(major), this.sy(minor), rotation);
};

F2D.prototype.parseDataType = function() {
    var data_type = this.stream.getVarints();

    switch (data_type) {
        case F2dDataType.dt_void:
            this.parseVoid();
            break;
        case F2dDataType.dt_int :
            this.parseInt();
            break;
        case F2dDataType.dt_object :
            this.parseObject();
            break;
        case F2dDataType.dt_varint :
            this.parseVarint();
            break;
        case F2dDataType.dt_point_varint :
            this.parsePoint();
            break;
        case F2dDataType.dt_float :
            this.parseFloat();
            break;
        case F2dDataType.dt_point_varint_array :
            this.parsePointsArray();
            break;
        case F2dDataType.dt_circular_arc :
            this.parseCircularArc();
            break;
        case F2dDataType.dt_circle :
            this.parseCircle();
            break;
        case F2dDataType.dt_arc :
            this.parseArc();
            break;
        case F2dDataType.dt_int_array:
            this.parseIntArray();
            break;
        case F2dDataType.dt_varint_array:
            this.parseVarintArray();
            break;
        case F2dDataType.dt_byte_array:
            this.parseByteArray();
            break;
        case F2dDataType.dt_string:
            this.parseString();
            break;
        case F2dDataType.dt_double_array:
            this.parseDoubleArray();
            break;
        default:
            this.error = true;
            logger.info("Data type not supported yet: " + data_type);
            break;
    }
};

F2D.prototype.readHeader = function() {
    var stream = this.stream = new InputStream(this.data);

    // "F2D"
    var header = stream.getString(3);

    if (header !== "F2D") {
        logger.error("Invalid F2D header : " + header, errorCodeString(ErrorCodes.BAD_DATA));
        return false;
    }

    var versionMajor = stream.getString(2);
    if (versionMajor !== "01") {
        logger.error("Only support f2d major version 1; actual version is : " + versionMajor, errorCodeString(ErrorCodes.BAD_DATA));
        return false;
    }

    var dot = stream.getString(1);
    if (dot !== ".") {
        logger.error("Invalid version delimiter.", errorCodeString(ErrorCodes.BAD_DATA));
        return false;
    }

    var versionMinor = stream.getString(2);
    return true;
};

F2D.prototype.parse = function() {
    // Read and check header
    if (!this.readHeader())
        return;

    var stream = this.stream;
    while (stream.offset < stream.byteLength) {
        this.parseDataType();
        if (this.error)
            break;
        this.opCount++;
    }

    if (this.linkNumber) {
        this.linkBoxes[this.linkNumber] = this.currentLinkBox.clone();
        this.currentLinkBox.makeEmpty();
    }

    this.flushBuffer(0, true);
    this.currentVbb = null;

    this.stream = null;
    this.data = null;

    logger.info("F2d parse: data types count : " + this.opCount);
};

F2D.prototype.parseFrames = function(flush) {

    if (this.data) {
        var stream = this.stream = new InputStream(this.data);
        while (stream.offset < stream.byteLength) {
            this.parseDataType();
            if (this.error)
                break;
            this.opCount++;
        }
    } else if (!flush) {
        logger.warn("Unexpected F2D parse state: If there is no data, we only expect a flush command, but flush was false.");
    }

    if (flush) {
        this.flushBuffer(0, true);
    }

    this.stream = null;
    this.data = null;
};

// ================= Semantic Analysis Pass ======================//

F2D.prototype.actOnPolylinePointsArray = function(points) {

    this.flushBuffer();

    // For now only consider this.fill == false case.
    // TODO: handle fill case.

    var count = points.length / 2;

    var totalLen = 0;
    var x0 = points[0];
    var y0 = points[1];
    for (var i = 1; i < count; ++i) {
        var x1 = points[2*i];
        var y1 = points[2*i+1];

        // TODO: make sure this function can be reused as is.
        this.currentVbb.addSegment(x0, y0, x1, y1, totalLen, this.lineWeight, this.color, this.objectNumber, this.layer, this.currentVpId);

        totalLen += Math.sqrt((x1-x0)*(x1-x0) + (y1-y0)*(y1-y0));

        x0 = x1;
        y0 = y1;
    }

    this.numPolylines ++;
    this.numLineSegs += count - 1;

    this.currentGeomMetrics.plines++;
    this.currentGeomMetrics.pline_points += count - 1;
};

F2D.prototype.actOnDot = function(points) {

    this.currentGeomMetrics.dots++;

    var x0 = points[0];
    var y0 = points[1];

    this.actOnCompleteCircle(x0, y0, this.sx(1), true);
};


F2D.prototype.actOnCompleteCircle = function(cx, cy, radius, skipCount) {
    // Relative positions.
    this.flushBuffer();
    this.numCircles++;

    if (!skipCount)
        this.currentGeomMetrics.circles++;

    if (this.fill) {
        //A simple filled circle can be handled
        //as degenerate thick line segment -- lots of these
        //in line style grass clippings
        this.currentVbb.addSegment(cx, cy, cx, cy, 0, 2 * radius, this.color, this.objectNumber,
            this.layer, this.currentVpId, true, false, true);
    } else {
        this.currentVbb.addArc(cx, cy, 0, 2 * Math.PI, /*major*/radius, /*minor*/radius, /*tilt*/0.0,
            this.lineWeight, this.color, this.objectNumber, this.layer, this.currentVpId);
    }
};

F2D.prototype.actOnCircularArc = function(cx, cy, start, end, radius) {
    this.numCircles++;
    this.currentGeomMetrics.circ_arcs++;
    this.flushBuffer();

//    debug("circle " + start + " " + end + " c " + this.color.toString(16));

    this.currentVbb.addArc(cx, cy, start, end, /*major*/radius, /*minor*/radius, /*tilt*/0.0,
        this.lineWeight, this.color, this.objectNumber, this.layer, this.currentVpId);
};

F2D.prototype.actOnArc = function(cx, cy, start, end, major, minor, rotation) {
    this.numEllipses++;
    this.currentGeomMetrics.arcs++;
    // TODO: need this?
    this.flushBuffer();
    this.currentVbb.addArc(cx, cy, start, end, major, minor, rotation,
        this.lineWeight, this.color, this.objectNumber, this.layer, this.currentVpId);
};

F2D.prototype.actOnRaster = function() {

    if (!this.manifestAvailable)
        return;

    this.flushBuffer(4, true);

    var ps = this.parseObjState.raster;

    var position = ps.position,
        imageId  = ps.imageId,
        imageUri = this.imageId2URI[imageId];

    var width  = this.sx(ps.width),
        height = this.sy(ps.height);

    var centerX = position[0] + 0.5 * width,
        centerY = position[1] - 0.5 * height;

    this.currentVbb.addTexturedQuad(centerX, centerY, width, height, /*rotation*/0, 0xff00ffff, this.objectNumber, this.layer, this.currentVpId);
    this.currentImage = { dataURI: imageUri };

    //We can do one image per Vertex Buffer, so flush the quad
    this.flushBuffer(0, true);

    //TODO: we need to compare the contents of the raster also.
    this.currentGeomMetrics.rasters++;
};

F2D.prototype.actOnClip = function() {

    var v = this.parseObjState.clip;
    this.parseObjState.clip = {};

    this.clips.push(v);

    this.currentGeomMetrics.clips++;
};

F2D.prototype.actOnText = function() {
    //TODO: text not currently used for rendering,
    //but we collect the strings for search/lookup purposes
    this.strings[this.currentStringNumber] = this.parseObjState.text.string;

    this.currentGeomMetrics.texts++;
    this.currentGeomMetrics.strings.push(this.parseObjState.text.string);

    this.stringDbIds[this.currentStringNumber] = this.objectNumber;
    this.stringBoxes.push(this.currentStringBox.min.x, this.currentStringBox.min.y, this.currentStringBox.max.x, this.currentStringBox.max.y);
    if (this.extendStringsFetching) {
        this.stringCharWidths.push(this.parseObjState.text.charWidths);
        this.stringAngles.push(this.parseObjState.text.rotation);
        this.stringPositions.push(this.parseObjState.text.position);
        this.stringHeights.push(this.parseObjState.text.height);
    }
    this.currentStringBox.makeEmpty();
    this.currentStringNumber = -1;
    if (this.objectNumber < -1)
        this.objectNumber = 0; //reset the current object ID in case we were using a fake one for the text object
};


var _tmpVector = new LmvVector3();

//Polytriangle processing differs depending on whether
//we want edge antialiasing and whether the renderer is using
//hardware instancing or not, so it require a lot more
//work than other geometries before sending raw primitives to the
//vertex buffer.
F2D.prototype.addPolyTriangle = function(points, colors, inds, color, dbId, layer, antialiasEdges) {
    var me = this;
    var edgeMap = null;

    //For non-text geometry we get good looking results with
    //1 pixel outlines. For text, which is generally small and highly detailed,
    //a 0.5 pixel AA outline does better.
    var aaLineWeight = -1.0; //negative = in pixel units
    if (this.objectStack[this.objectStack.length-1] == F2dSemanticType.st_text)
        aaLineWeight = -0.5;


    function processEdge(iFrom, iTo) {
        if (iFrom > iTo) {
            var tmp = iFrom;
            iFrom = iTo;
            iTo = tmp;
        }

        if (!edgeMap[iFrom])
            edgeMap[iFrom] = [iTo];
        else {
            var adjacentVerts = edgeMap[iFrom];
            var idx = adjacentVerts.lastIndexOf(iTo);
            if (idx == -1)
                adjacentVerts.push(iTo); //first time we see this edge, so remember it as exterior edge
            else
                adjacentVerts[idx] = -1; //the second time we see an edge mark it as interior edge
        }
    }


    function addAllAntialiasEdges() {

        for (var i = 0, iEnd = edgeMap.length; i<iEnd; i++) {

            var adjacentVerts = edgeMap[i];
            if (!adjacentVerts)
                continue;

            for (var j=0; j<adjacentVerts.length; j++) {
                var iTo = adjacentVerts[j];
                if (iTo == -1)
                    continue; //an interior edge was here -- skip
                else {
                    //exterior edge -- add an antialiasing line for it
                    me.flushBuffer(4);
                    me.currentVbb.addSegment(points[2*i], points[2*i+1],
                                             points[2*iTo], points[2*iTo+1],
                                             0,
                                             aaLineWeight,
                                             me.mapColor(colors ? colors[i] : color, true),
                                             dbId, layer, me.currentVpId);
{
                    if (colors && (colors[i] != colors[iTo]))
                        logger.warn("Gouraud triangle encountered. Will have incorrect antialiasing.");}
                }
            }
        }
    }

    function antialiasOneEdge(iFrom, iTo) {
        if (iFrom > iTo) {
            var tmp = iFrom;
            iFrom = iTo;
            iTo = tmp;
        }

        var adjacentVerts = edgeMap[iFrom];
        if (!adjacentVerts)
            return;

        var idx = adjacentVerts.indexOf(iTo);
        if (idx != -1) {
            //exterior edge -- add an antialiasing line for it
            me.flushBuffer(4);
            me.currentVbb.addSegment(points[2*iFrom], points[2*iFrom+1],
                                     points[2*iTo], points[2*iTo+1],
                                     0,
                                     aaLineWeight,
                                     me.mapColor(colors ? colors[iFrom] : color, true),
                                     dbId, layer, me.currentVpId);

            if (colors && (colors[iFrom] != colors[iTo]))
                logger.warn("Gouraud triangle encountered. Will have incorrect antialiasing.");
        }
    }

    if (antialiasEdges) {
        edgeMap = new Array(points.length/2);

        for (var i= 0, iEnd = inds.length; i<iEnd; i+= 3) {
            var i0 = inds[i];
            var i1 = inds[i+1];
            var i2 = inds[i+2];

            processEdge(i0, i1);
            processEdge(i1, i2);
            processEdge(i2, i0);
        }
    }

    //If the polytriangle is part of tesselated text or hyperlink, add it to the current
    //text object bounding box
    if (this.currentStringNumber !== -1 || this.linkNumber) {
        var count = points.length / 2; // number of vertices
        for (var i = 0; i < count; ++i) {
            _tmpVector.set(points[2*i], points[2*i+1], 0);

            if (this.currentStringNumber !== -1)
                this.currentStringBox.expandByPoint(_tmpVector);

            if (this.linkNumber)
                this.currentLinkBox.expandByPoint(_tmpVector);
        }
    }

    if (this.currentVbb.useInstancing) {
        var count = inds.length;
        for (var i = 0; i < count; i+=3) {
            var i0 = inds[i];
            var i1 = inds[i+1];
            var i2 = inds[i+2];

            this.flushBuffer(4);

            this.currentVbb.addTriangleGeom(points[2*i0], points[2*i0+1],
                                            points[2*i1], points[2*i1+1],
                                            points[2*i2], points[2*i2+1],
                                            this.mapColor(colors ? colors[i0] : color, true), dbId, layer, this.currentVpId);

            if (antialiasEdges) {
                antialiasOneEdge(i0, i1);
                antialiasOneEdge(i1, i2);
                antialiasOneEdge(i2, i0);
            }
        }
    }
    else {
        var count = points.length / 2; // number of vertices

        this.flushBuffer(count);
        var vbb = this.currentVbb;
        var vbase = vbb.vcount;

        for (var i = 0; i < count; ++i) {
            var x = points[2*i];
            var y = points[2*i+1];
            vbb.addVertexPolytriangle(x, y, this.mapColor(colors ? colors[i] : color, true), dbId, layer, this.currentVpId);
        }

        vbb.addIndices(inds, vbase);

        if (antialiasEdges) {
            addAllAntialiasEdges();
        }

    }
};

F2D.prototype.actOnPolyTriangle = function() {

    var ptri = this.parseObjState.polyTriangle;
    this.parseObjState.polyTriangle = {};

    var points = ptri.points;
    var inds = ptri.indices;
    var colors = ptri.colors;

    if (!points || !inds) {
        logger.warn("Malformed polytriangle.");
        return;
    }

    //Skip polytriangles that belong to text strings from the geometry stats
    //as they are not relevant to the sheet signature computation
    if (this.objectStack[this.objectStack.length-1] == F2dSemanticType.st_text) {
        if (this.excludeTextGeometry) {
            return;
        }
    } else {
        this.currentGeomMetrics.ptris++;
        this.currentGeomMetrics.ptri_points += points.length / 2;
        this.currentGeomMetrics.ptri_indices += inds.length;
    }

    this.numPolytriangles++;
    this.numTriangles += inds.length / 3;

    this.addPolyTriangle(points, colors, inds, this.color, this.objectNumber, this.layer, true);
};

F2D.prototype.actOnViewport = function() {

    var v = this.parseObjState.viewport;
    this.parseObjState.viewport = {};

    v.geom_metrics = this.currentGeomMetrics = initGeomMetrics();

    this.viewports.push(v);
    this.currentVpId = this.viewports.length - 1;
};

F2D.prototype.createLayerGroups = function(layers) {

    // Temporary: build the layers tree. Eventually the extractor
    // should be the one doing this; we're incompletely faking it
    // by looking at the layer names.
    //
    var layersRoot = this.layersRoot = {name: 'root', id: 'root', childrenByName: {}, isLayer: false};
    var groupId = 0, layerId = 0;

    for (var l in layers) {

        var index = parseInt(l);
        var layerDef = layers[l];

        var name = (typeof layerDef === "string") ? layerDef : layerDef.name;

        if (!name)
            name = l; //won't get here...

        var path = name.split('|');
        var parent = layersRoot;

        if (path.length > 1) {
            for (var i = 0; i < path.length - 1; ++i) {
                var pathComponent = path[i];
                var item = parent.childrenByName[pathComponent];
                if (!item) {
                    item = {
                        name: pathComponent,
                        id: 'group-' + groupId++,
                        childrenByName: {},
                        isLayer: false
                    };
                    parent.childrenByName[pathComponent] = item;
                }
                parent = item;
            }
        }

        parent.childrenByName[name] = {
            name: name,
            index: index,
            id: layerId++,
            childrenByName: {},
            isLayer: true
        };
    }

    function sortLayers(parent) {
        var children = Object.keys(parent.childrenByName).map(function(k) {return parent.childrenByName[k];});
        delete parent.childrenByName;

        if (children.length) {
            parent.children = children;

            parent.childCount = 0;

            for (var i = 0; i < children.length; ++i) {
                parent.childCount += sortLayers(children[i]);
            }

            children.sort(function (a, b) {
                if (a.isLayer && !b.isLayer) {
                    return -1; // Layers before groups
                } else if (!a.isLayer && b.isLayer) {
                    return 1;
                }
                return a.name.localeCompare(b.name, undefined, {sensitivity: 'base', numeric: true}); // Sort layers and groups by name
            });
        }

        return parent.isLayer ? 1 : parent.childCount;
    }
    sortLayers(this.layersRoot);
};
