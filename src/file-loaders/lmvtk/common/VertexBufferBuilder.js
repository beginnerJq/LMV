
"use strict";

var TAU = Math.PI * 2;

var VBB_GT_TRIANGLE_INDEXED = 0,
    VBB_GT_LINE_SEGMENT     = 1,
    VBB_GT_ARC_CIRCULAR     = 2,
    VBB_GT_ARC_ELLIPTICAL   = 3,
    VBB_GT_TEX_QUAD         = 4,
    VBB_GT_ONE_TRIANGLE     = 5,
    VBB_GT_MSDF_TRIANGLE_INDEXED = 6,
    VBB_GT_TEX_TRIANGLE_INDEXED = 7,
    VBB_GT_LINE_SEGMENT_CAPPED = 8,
    VBB_GT_LINE_SEGMENT_CAPPED_START = 9,
    VBB_GT_LINE_SEGMENT_CAPPED_END = 10;

var VBB_INSTANCED_FLAG  = 0, // this is intentionally 0 for the instancing case!
    VBB_SEG_START_RIGHT = 0, // this starts intentionally at 0!
    VBB_SEG_START_LEFT  = 1,
    VBB_SEG_END_RIGHT   = 2,
    VBB_SEG_END_LEFT    = 3;

var VBB_COLOR_OFFSET    = 6,
    VBB_DBID_OFFSET     = 7,
    VBB_FLAGS_OFFSET    = 8,
    VBB_LAYER_VP_OFFSET = 9;

var QUAD_TRIANGLE_INDICES = [ 0,1,3, 0,3,2 ];

export function VertexBufferBuilder(useInstancing, allocSize, fullCount, useCompactBuffers)
{
    var MAX_VCOUNT = allocSize || 65536;
    this.FULL_COUNT = (fullCount || 32767) | 0;

    this.useInstancing = useInstancing;
    this.useCompactBuffers = useCompactBuffers;

    this.stride = 10;
    this.allocVcount = 4 * (this.useInstancing ? MAX_VCOUNT / 4 : MAX_VCOUNT);

    this.vb  = new ArrayBuffer(this.stride * this.allocVcount);
    this.vbf = new Float32Array(this.vb);
    this.vbi = new Int32Array(this.vb);
    this.ib = this.useInstancing ? null : new Uint16Array(MAX_VCOUNT);
    this.minLineWidth = Number.MAX_VALUE;
    this.reset(0);

}

VertexBufferBuilder.prototype.reset = function(vcount) {
    // This is used to restore the vcount when restoring stream state as well as at init time.
    this.vcount = vcount;

    this.icount = 0;

    this.minx = this.miny =  Infinity;
    this.maxx = this.maxy = -Infinity;

    //Keeps track of objectIds referenced by geometry in the VB
    this.dbIds = {};
    this.lastDbId = null;

    //Keep track of unique colors used by this VB
    this.colors = {};

    this.numEllipticals   = 0;
    this.numCirculars     = 0;
    this.numTriangleGeoms = 0;

    // If false, all lines are of type 0 (solid), so that we don't need line-pattern support.
    this.hasLineStyles = false;

    //Certain fields can be invariant over large numbers of primitives.
    //We keep track of those in order to optimize the vertex layout by
    //pulling invariants into shader uniforms.
    this.changeTracking = {};

    this.stride = 10;
};

VertexBufferBuilder.prototype.expandStride = function()
{
    //Currently hardcoded to expand by 4 floats.
    var expandBy = 2;

    var stride = this.stride;

    if (stride >= 12)
        return;

    var nstride = this.stride + expandBy;

    var nvb = new ArrayBuffer(nstride * this.allocVcount);

    var src = new Uint8Array(this.vb);
    var dst = new Uint8Array(nvb);

    for (var i = 0, iEnd = this.vcount; i<iEnd; i++) {
        var os = i * stride * 4;
        var od = i * nstride * 4;

        for (var j=0; j<stride * 4; j++)
            dst[od+j] = src[os+j];
    }

    this.vb = nvb;
    this.vbf = new Float32Array(nvb);
    this.vbi = new Int32Array(nvb);
    this.stride = nstride;

};

VertexBufferBuilder.prototype.addToBounds = function(x, y)
{
    if (x < this.minx) this.minx = x;
    if (x > this.maxx) this.maxx = x;
    if (y < this.miny) this.miny = y;
    if (y > this.maxy) this.maxy = y;
};

var _toInt32 = new Int32Array(1);
function toInt32(c) {
    _toInt32[0] = c;
    return _toInt32[0];
}

VertexBufferBuilder.prototype.trackChanges = function(geomType, color, dbId, layerId, vpId, linePattern) {

    if (dbId !== this.lastDbId) {
        this.dbIds[toInt32(dbId)] = 1;
        this.lastDbId = dbId;
    }

    if (linePattern) {
        this.hasLineStyles = true;
    }

    if (!this.useCompactBuffers)
        return;

    var ct = this.changeTracking;

    function checkOne(whichAttr, val) {
        if (ct[whichAttr] === undefined)
            ct[whichAttr] = geomType;
        else if (ct[whichAttr] === val)
            ct[whichAttr+"Varies"] = true;
    }

    checkOne("geomType", geomType);
    checkOne("color", color);
    checkOne("dbId", dbId);
    checkOne("layerId", layerId);
    checkOne("viewportId", vpId);
    checkOne("linePattern", linePattern);

    this.colors[toInt32(color)] = 1;
};


VertexBufferBuilder.prototype.setCommonVertexAttribs = function(offset, vertexId, geomType, color, dbId, layerId, vpId, linePattern)
{
    this.trackChanges(geomType, color, dbId, layerId, vpId, linePattern);

    // align changes here with the "decodeCommonAttribs()" function in LineShader.js and VertexBufferReader.js!!!
    vertexId    = (vertexId    &   0xff); //  8 bit
    geomType    = (geomType    &   0xff); //  8 bit
    linePattern = (linePattern &   0xff); //  8 bit
    layerId     = (layerId     & 0xffff); // 16 bit
    vpId        = (vpId        & 0xffff); // 16 bit

    this.vbi[offset + VBB_FLAGS_OFFSET]    = vertexId | (geomType << 8) | (linePattern << 16); // vertexId: int8; geomType: int8; linePattern: int8; ghostingFlag: int8
    this.vbi[offset + VBB_COLOR_OFFSET]    = color;
    this.vbi[offset + VBB_DBID_OFFSET]     = dbId;
    this.vbi[offset + VBB_LAYER_VP_OFFSET] = layerId | (vpId << 16); // layerId: int16; vpId: int16
};

//Creates a non-indexed triangle geometry vertex (triangle vertex coords stored in single vertex structure)
VertexBufferBuilder.prototype.addVertexTriangleGeom = function(x1, y1, x2, y2, x3, y3, color, dbId, layerId, vpId)
{
    var vi  = this.vcount;
    var vbf = this.vbf;

    var repeat = this.useInstancing ? 1 : 4;
    for (var i=0; i<repeat; i++) {
        var offset = (vi+i) * this.stride;

        // align changes here with the "decodeTriangleData()" function in LineShader.js!!!
        vbf[offset]   = x1;
        vbf[offset+1] = y1;
        vbf[offset+2] = x2;

        vbf[offset+3] = y2;
        vbf[offset+4] = x3;
        vbf[offset+5] = y3;

        this.setCommonVertexAttribs(offset, VBB_SEG_START_RIGHT + i, VBB_GT_ONE_TRIANGLE, color, dbId, layerId, vpId, /*linePattern*/0);
        this.vcount++;
    }

    return vi;
};


VertexBufferBuilder.prototype.addVertexLine = function(x, y, angle, distanceAlong, totalDistance, lineWidth, color, dbId, layerId, vpId, lineType, capStart, capEnd)
{
    var vi  = this.vcount;
    var vbf = this.vbf;

    if (dbId >= 0 && lineWidth > 0 && distanceAlong > 0) {
        this.minLineWidth = Math.min(this.minLineWidth, lineWidth);
    }

    var geomType = VBB_GT_LINE_SEGMENT;
    if (capStart && capEnd) {
        geomType = VBB_GT_LINE_SEGMENT_CAPPED;
    }
    else if (capStart) {
        geomType = VBB_GT_LINE_SEGMENT_CAPPED_START;
    }
    else if (capEnd) {
        geomType = VBB_GT_LINE_SEGMENT_CAPPED_END;
    }

    var repeat = this.useInstancing ? 1 : 4;
    for (var i=0; i<repeat; i++) {
        var offset = (vi + i) * this.stride;

        // align changes here with the "decodeSegmentData()" function in LineShader.js and VertexBufferReader!!!
        vbf[offset]   = x;
        vbf[offset+1] = y;
        vbf[offset+2] = (angle + Math.PI) / TAU;

        vbf[offset+3] = distanceAlong;
        vbf[offset+4] = lineWidth * 0.5; // we are storing only the half width (i.e., the radius)
        vbf[offset+5] = totalDistance;

        this.setCommonVertexAttribs(offset, VBB_SEG_START_RIGHT + i, geomType, color, dbId, layerId, vpId, lineType);
        this.vcount++;
    }

    return vi;
};

VertexBufferBuilder.prototype.addVertexTexQuad = function(centerX, centerY, width, height, rotation, color, dbId, layerId, vpId)
{
    var vi  = this.vcount;
    var vbf = this.vbf;

    var repeat = this.useInstancing ? 1 : 4;
    for (var i=0; i<repeat; i++) {
        var offset = (vi + i) * this.stride;

        // align changes here with the "decodeTexQuadData()" function in LineShader.js!!!
        vbf[offset]   = centerX;
        vbf[offset+1] = centerY;
        vbf[offset+2] = rotation / TAU;

        vbf[offset+3] = width;
        vbf[offset+4] = height;

        this.setCommonVertexAttribs(offset, VBB_SEG_START_RIGHT + i, VBB_GT_TEX_QUAD, color, dbId, layerId, vpId, /*linePattern*/0);
        this.vcount++;
    }

    return vi;
};


VertexBufferBuilder.prototype.addVertexArc = function(x, y, startAngle, endAngle, major, minor, tilt, lineWidth, color, dbId, layerId, vpId)
{
    var vi  = this.vcount;
    var vbf = this.vbf;

    var geomType = (major == minor) ? VBB_GT_ARC_CIRCULAR : VBB_GT_ARC_ELLIPTICAL;

    var repeat = this.useInstancing ? 1 : 4;
    for (var i=0; i<repeat; i++) {
        var offset = (vi+i) * this.stride;

        // align changes here with the "decodeArcData()" function in LineShader.js!!!
        vbf[offset]   = x;
        vbf[offset+1] = y;
        vbf[offset+2] = startAngle / TAU;

        vbf[offset+3] = endAngle / TAU;
        vbf[offset+4] = lineWidth * 0.5; // we are storing only the half width (i.e., the radius)
        vbf[offset+5] = major; // = radius for circular arcs

        if (geomType === VBB_GT_ARC_ELLIPTICAL) {
            vbf[offset+10] = minor;
            vbf[offset+11] = tilt;
        }

        this.setCommonVertexAttribs(offset, VBB_SEG_START_RIGHT + i, geomType, color, dbId, layerId, vpId, /*linePattern*/0);
        this.vcount++;
    }

    return vi;
};




//====================================================================================================
//====================================================================================================
// Indexed triangle code path can only be used when hardware instancing is not in use.
// Otherwise, the addTriangleGeom operation should be used to add simple triangles to the buffer.
//====================================================================================================
//====================================================================================================

VertexBufferBuilder.prototype.addVertex = function(x, y, color, dbId, layerId, vpId, flag=VBB_GT_TRIANGLE_INDEXED)
{
    if (this.useInstancing)
        return;//not supported if instancing is used.

    var vi     = this.vcount;
    var offset = this.stride * vi;
    var vbf    = this.vbf;

    // align changes here with the "decodeTriangleData()" function in LineShader.js!!!
    vbf[offset]   = x;
    vbf[offset+1] = y;

    this.setCommonVertexAttribs(offset, /*vertexId*/0, flag, color, dbId, layerId, vpId, /*linePattern*/0);
    this.vcount++;

    return vi;
};


VertexBufferBuilder.prototype.addVertexPolytriangle = function(x, y, color, dbId, layerId, vpId)
{
    if (this.useInstancing)
        return;//not supported if instancing is used.

    this.addVertex(x, y, color, dbId, layerId, vpId);

    this.addToBounds(x, y);
};

VertexBufferBuilder.prototype.addVertexMSDFPolytriangle = function(x, y, u, v, color, dbId, layerId, vpId)
{
    this.addVertexTexPolytriangle(x, y, u, v, color, dbId, layerId, vpId, VBB_GT_MSDF_TRIANGLE_INDEXED);
};

VertexBufferBuilder.prototype.addIndices = function(indices, vindex) {

    if (this.useInstancing)
        return; //not supported if instancing is used.

    var ib = this.ib;
    var ii = this.icount;

    if (ii + indices.length >= ib.length) {
        var ibnew = new Uint16Array(Math.max(indices.length, ib.length) * 2);
        for (var i=0; i<ii; ++i) {
            ibnew[i] = ib[i];
        }
        this.ib = ib = ibnew;
    }

    for(var i=0; i<indices.length; ++i) {
        ib[ii+i] = vindex + indices[i];
    }

    this.icount += indices.length;
};

//====================================================================================================
//====================================================================================================
// End indexed triangle code path.
//====================================================================================================
//====================================================================================================


VertexBufferBuilder.prototype.finalizeQuad = function(vindex)
{
    if (!this.useInstancing) {
        this.addIndices(QUAD_TRIANGLE_INDICES, vindex);
    }
};


VertexBufferBuilder.prototype.addSegment = function(x1, y1, x2, y2, totalDistance, lineWidth, color, dbId, layerId, vpId, lineType, capStart, capEnd)
{
    var dx = x2 - x1;
    var dy = y2 - y1;
    var angle  = (dx || dy) ? Math.atan2(dy, dx)       : 0.0;
    var segLen = (dx || dy) ? Math.sqrt(dx*dx + dy*dy) : 0.0;

    //Add four vertices for the bbox of this line segment
    //This call sets the stuff that's common for all four
    var v = this.addVertexLine(x1, y1, angle, segLen, totalDistance, lineWidth, color, dbId, layerId, vpId, lineType, capStart, capEnd);

    this.finalizeQuad(v);
    this.addToBounds(x1, y1);
    this.addToBounds(x2, y2);
};


//Creates a non-indexed triangle geometry (triangle vertex coords stored in single vertex structure)
VertexBufferBuilder.prototype.addTriangleGeom = function(x1, y1, x2, y2, x3, y3, color, dbId, layerId, vpId)
{
    this.numTriangleGeoms++;

    var v = this.addVertexTriangleGeom(x1, y1, x2, y2, x3, y3, color, dbId, layerId, vpId);

    this.finalizeQuad(v);
    this.addToBounds(x1, y1);
    this.addToBounds(x2, y2);
    this.addToBounds(x3, y3);
};

VertexBufferBuilder.prototype.addArc = function(cx, cy, start, end, major, minor, tilt, lineWidth, color, dbId, layerId, vpId)
{
    if(major == minor)  {
        this.numCirculars++;
    } else {
        this.numEllipticals++;

        //Ellipticals need large vertex layout
        this.expandStride();
    }

    // This is a workaround, when the circular arc has rotation, the extractor cannot handle it.
    // After the fix is deployed in extractor, this can be removed.
    var result = fixUglyArc(start, end);
    start = result.start;
    end   = result.end;

    //If both start and end angles are exactly 0, it's a complete ellipse/circle
    //This is working around a bug in the F2D writer, where an fmod operation will potentially.
    //convert 2pi to 0.
    if (start == 0 && end == 0)
        end = TAU;

    //Add two zero length segments as round caps at the end points
    {
        //If it's a full ellipse, then we don't need caps
        var range = Math.abs(start - end);
        if (range > 0.0001 && Math.abs(range - TAU) > 0.0001)
        {
            var sx = cx + major * Math.cos(start);
            var sy = cy + minor * Math.sin(start);
            this.addSegment(sx, sy, sx, sy, 0, lineWidth, color, dbId, layerId, vpId);

            var ex = cx + major * Math.cos(end);
            var ey = cy + minor * Math.sin(end);
            this.addSegment(ex, ey, ex, ey, 0, lineWidth, color, dbId, layerId, vpId);

            //TODO: also must add all the vertices at all multiples of PI/2 in the start-end range to get exact bounds
        }
        else
        {
            this.addToBounds(cx - major, cy - minor);
            this.addToBounds(cx + major, cy + minor);
        }

        // Add the center of the circle / ellipse as a single transparent dot - So it wil be snappable.
        const hiddenColor = 0x01ffffff; // Note that lineShader discards fully transparent fragments. Therefore, we use a white here with very small, but nonzero alpha.
        var c = this.addVertexLine(cx, cy, 0, 0.0001, 0, 0, hiddenColor, dbId, layerId, vpId);
        this.finalizeQuad(c);
    }

    var v = this.addVertexArc(cx, cy, start, end, major, minor, tilt, lineWidth, color, dbId, layerId, vpId);

    this.finalizeQuad(v);

    //Testing caps
    if(false) {
        //If it's a full ellipse, then we don't need caps
        var range = Math.abs(start - end);
        if (Math.abs(range - TAU) > 0.0001)
        {
            var sx = cx + major * Math.cos(start);
            var sy = cy + minor * Math.sin(start);
            this.addSegment(sx, sy, sx, sy, 0, lineWidth, 0xff00ffff, dbId, layerId, vpId);

            var ex = cx + major * Math.cos(end);
            var ey = cy + minor * Math.sin(end);
            this.addSegment(ex, ey, ex, ey, 0, lineWidth, 0xff00ffff, dbId, layerId, vpId);
        }
    }
}


VertexBufferBuilder.prototype.addTexturedQuad = function(centerX, centerY, width, height, rotation, color, dbId, layerId, vpId)
{
    //Height is specified using the line weight field.
    //This will result in height being clamped to at least one pixel
    //but that's ok (zero height for an image would be rare).
    var v = this.addVertexTexQuad(centerX, centerY, width, height, rotation, color, dbId, layerId, vpId);

    this.finalizeQuad(v);

    var cos = 0.5 * Math.cos(rotation);
    var sin = 0.5 * Math.sin(rotation);
    var w = Math.abs(width * cos) + Math.abs(height * sin);
    var h = Math.abs(width * sin) + Math.abs(height * cos);
    this.addToBounds(centerX - w, centerY - h);
    this.addToBounds(centerX + w, centerY + h);
};

VertexBufferBuilder.prototype.addVertexImagePolytriangle = function(x, y, u, v, color, dbId, layerId, vpId) {
    return this.addVertexTexPolytriangle(x, y, u, v, color, dbId, layerId, vpId, VBB_GT_TEX_TRIANGLE_INDEXED);
};

VertexBufferBuilder.prototype.addVertexTexPolytriangle = function(x, y, u, v, color, dbId, layerId, vpId, type) {
    if (this.useInstancing)
        return; //not supported if instancing is used.

    let vi = this.vcount;
    let vbf = this.vbf;
    this.addVertex(x, y, color, dbId, layerId, vpId, type);

    // put the UV data into the fields2 attribute
    vbf[vi * this.stride + 2] = u;
    vbf[vi * this.stride + 3] = v;

    this.addToBounds(x, y);
}


VertexBufferBuilder.prototype.isFull = function(addCount)
{
    addCount = addCount || 3;
    var mult = this.useInstancing ? 4 : 1;

    return (this.vcount * mult + addCount > this.FULL_COUNT);
};

//Determines if there are invariant memebers in the vertex layout,
//which can be moved out to shader uniforms to save space.
//Determines if uint16 can be used to store positions data
VertexBufferBuilder.prototype.makeCompactVertexLayout = function() {

    var colorKeys = Object.keys(this.colors);
    var dbIdsKeys = Object.keys(this.dbIds);

    // if (this.changeTracking.geomType === VBB_GT_LINE_SEGMENT && !this.changeTracking.geomTypeVaries) {
    //   console.log("Vertex buffer only has lines");
    // }

    // if (this.changeTracking.color === VBB_GT_LINE_SEGMENT && !this.changeTracking.colorVaries) {
    //     console.log("Vertex buffer has invariant color");
    // } else {
    //     console.log("Num colors:", colorKeys.length);
    // }

    // if (!this.changeTracking.viewportIdVaries) {
    //     console.log("Vertex buffer has invariant viewportId");
    // }

    // if (!this.changeTracking.layerIdVaries) {
    //     console.log("Vertex buffer has invariant layerId");
    // }

    // if (!this.changeTracking.dbIdVaries) {
    //     console.log("Vertex buffer has invariant dbId");
    // } else {
    //     console.log("Num dbIds:", dbIdsKeys.length);
    // }

    if (this.stride !== 10)
        return null;

    //create the color/dbId index texture
    var texLen = colorKeys.length + dbIdsKeys.length;

    if (colorKeys.length + dbIdsKeys.length > 65536)
        return null;

    var texData = new Int32Array(texLen+1);
    texData[0] = 0;
    var count = 1;
    for (var i=0; i<colorKeys.length; i++, count++) {
        texData[count] = parseInt(colorKeys[i]);
        this.colors[colorKeys[i]] = count;
    }
    for (var i=0; i<dbIdsKeys.length; i++, count++) {
        texData[count] = parseInt(dbIdsKeys[i]);
        this.dbIds[dbIdsKeys[i]] = count;
    }

    var compactStride = 6;

    var vb  = new ArrayBuffer(compactStride * 4 * this.vcount);
    var vbi = new Int32Array(vb);
    var vbs = new Uint16Array(vb);

    var sx = (this.maxx - this.minx) || 1;
    var sy = (this.maxy - this.miny) || 1;
    var ox = this.minx;
    var oy = this.miny;
    var ss = Math.max(sx, sy);

    function tx(x) {
        return 0 | Math.round((((x - ox) / sx) * 65535));
    }

    function ty(y) {
        return 0 | Math.round((((y - oy) / sy) * 65535));
    }

    function ts(x) {
        return 0 | Math.round(((x / ss) * 65535));
    }

    function unit(x) {
        return 0 | (x * 65535);
    }

    function lineWeight(x) {
        if (x < 0) {
            return 32768 + Math.min(1.0, (-x / 1024)) * 32767;
        } else {
            // Don't allow non-zero line weights to become 0 because
            // of the compact buffer format.
            return x ? (0 | Math.round(((x / ss) * 32767))) || 1 : x;
        }
    }

    for (var i=0; i<this.vcount; i++) {

        var srcOffset = this.stride * i;
        var dstOffset = compactStride * i;
        var ushortOffset = dstOffset * 2;

        var gt = (this.vbi[srcOffset + VBB_FLAGS_OFFSET] >> 8) & 0xff;

        //Handle data that varies per geometry type and needs scaling
        //to uint16 packing, e.g. positions and angles
        switch (gt) {
            case VBB_GT_TRIANGLE_INDEXED:
                vbs[ushortOffset  ] = tx(this.vbf[srcOffset]);
                vbs[ushortOffset+1] = ty(this.vbf[srcOffset+1]);
                break;

            case VBB_GT_LINE_SEGMENT:
            case VBB_GT_LINE_SEGMENT_CAPPED:
            case VBB_GT_LINE_SEGMENT_CAPPED_START:
            case VBB_GT_LINE_SEGMENT_CAPPED_END:
                vbs[ushortOffset  ] = tx(this.vbf[srcOffset]);
                vbs[ushortOffset+1] = ty(this.vbf[srcOffset+1]);
                vbs[ushortOffset+2] = unit(this.vbf[srcOffset+2]);
                vbs[ushortOffset+3] = ts(this.vbf[srcOffset+3]);
                vbs[ushortOffset+4] = lineWeight(this.vbf[srcOffset+4]);
                break;

            case VBB_GT_ARC_CIRCULAR:
                vbs[ushortOffset  ] = tx(this.vbf[srcOffset]);
                vbs[ushortOffset+1] = ty(this.vbf[srcOffset+1]);
                vbs[ushortOffset+2] = unit(this.vbf[srcOffset+2]);
                vbs[ushortOffset+3] = unit(this.vbf[srcOffset+3]);
                vbs[ushortOffset+4] = lineWeight(this.vbf[srcOffset+4]);
                vbs[ushortOffset+5] = ts(this.vbf[srcOffset+5]);
                break;

            case VBB_GT_ARC_ELLIPTICAL:
                //will not happen
                break;

            case VBB_GT_TEX_QUAD:
                vbs[ushortOffset  ] = tx(this.vbf[srcOffset]);
                vbs[ushortOffset+1] = ty(this.vbf[srcOffset+1]);
                vbs[ushortOffset+2] = unit(this.vbf[srcOffset+2]);
                vbs[ushortOffset+3] = ts(this.vbf[srcOffset+3]);
                vbs[ushortOffset+4] = ts(this.vbf[srcOffset+4]);
                break;

            case VBB_GT_ONE_TRIANGLE:
                vbs[ushortOffset  ] = tx(this.vbf[srcOffset]);
                vbs[ushortOffset+1] = ty(this.vbf[srcOffset+1]);
                vbs[ushortOffset+2] = tx(this.vbf[srcOffset+2]);
                vbs[ushortOffset+3] = ty(this.vbf[srcOffset+3]);
                vbs[ushortOffset+4] = tx(this.vbf[srcOffset+4]);
                vbs[ushortOffset+5] = ty(this.vbf[srcOffset+5]);
                break;

            default: console.error("Unknown geometry type"); break;
        }

        //Copy the common data to the new offset
        vbs[ushortOffset + 6] = this.colors[this.vbi[srcOffset + VBB_COLOR_OFFSET]] || 0;
        vbs[ushortOffset + 7 ] = this.dbIds[this.vbi[srcOffset + VBB_DBID_OFFSET]] || 0;

        vbi[dstOffset + 4] = this.vbi[srcOffset + VBB_FLAGS_OFFSET];
        vbi[dstOffset + 5] = this.vbi[srcOffset + VBB_LAYER_VP_OFFSET];
    }

    var mesh = {};

    mesh.vb = new Float32Array(vb);
    mesh.vbstride = compactStride;

    var d = this.useInstancing ? 1 : 0;

    mesh.vblayout = {
        "fields1" :    { offset: 0, itemSize: 2, bytesPerItem: 2, divisor: d, normalized: true },
        "fields2" :    { offset: 1, itemSize: 4, bytesPerItem: 2, divisor: d, normalized: true },
        "uvIdColor":   { offset: 3, itemSize: 2, bytesPerItem: 2, divisor: d, normalized: false },
        "flags4b":     { offset: 4, itemSize: 4, bytesPerItem: 1, divisor: d, normalized: false },
        "layerVp4b":   { offset: 5, itemSize: 4, bytesPerItem: 1, divisor: d, normalized: false }
    };

    mesh.unpackXform = {x: sx, y: sy, z: ox, w: oy };
    mesh.texData = texData;

    return mesh;
};

VertexBufferBuilder.prototype.makeWideVertexLayout = function() {
    var mesh = {};

    mesh.vb = new Float32Array(this.vb.slice(0, this.vcount * this.stride * 4));
    mesh.vbstride = this.stride;

    var d = this.useInstancing ? 1 : 0;

    mesh.vblayout = {
        "fields1" :    { offset: 0,                   itemSize: 2, bytesPerItem: 4, divisor: d, normalized: false },
        "fields2" :    { offset: 2,                   itemSize: 4, bytesPerItem: 4, divisor: d, normalized: false },
        "color4b":     { offset: VBB_COLOR_OFFSET,    itemSize: 4, bytesPerItem: 1, divisor: d, normalized: true  },
        "dbId4b":      { offset: VBB_DBID_OFFSET,     itemSize: 4, bytesPerItem: 1, divisor: d, normalized: false },
        "flags4b":     { offset: VBB_FLAGS_OFFSET,    itemSize: 4, bytesPerItem: 1, divisor: d, normalized: false },
        "layerVp4b":   { offset: VBB_LAYER_VP_OFFSET, itemSize: 4, bytesPerItem: 1, divisor: d, normalized: false }
    };

    //Set the expanded vertex layout to use the last two floats in the buffer. If the
    //were allocated then it is good. If they weren't it overlaps the flags4b and layerVp4b
    //channels, but since the extraParams won't be used in the shader it won't matter.
    //Doing this lets the shader connect to something and prevents crashes on iOS.
    mesh.vblayout["extraParams"] = { offset: this.stride - 2, itemSize: 2, bytesPerItem: 4, divisor: d, normalized: false };
    return mesh;
};

VertexBufferBuilder.prototype.toMesh = function()
{
    var mesh = null;

    if (this.useCompactBuffers)
        mesh = this.makeCompactVertexLayout();

    if (!mesh)
        mesh = this.makeWideVertexLayout();

    if (this.useInstancing) {
        mesh.numInstances = this.vcount;

        //Set up trivial vertexId and index attributes

        var instFlags = new Int32Array([ VBB_SEG_START_RIGHT, VBB_SEG_START_LEFT, VBB_SEG_END_RIGHT, VBB_SEG_END_LEFT ]);
        mesh.vblayout.instFlags4b = { offset: 0, itemSize: 4, bytesPerItem: 1, divisor: 0, normalized: false };
        mesh.vblayout.instFlags4b.array = instFlags.buffer;

        var idx = mesh.indices = new Uint16Array(QUAD_TRIANGLE_INDICES);
    } else {
        mesh.indices = new Uint16Array(this.ib.buffer.slice(0, 2 * this.icount));
    }

    mesh.dbIds = this.dbIds;

    var w  = this.maxx - this.minx;
    var h  = this.maxy - this.miny;
    var sz = Math.max(w, h);

    mesh.boundingBox = {
        min: { x: this.minx, y: this.miny, z: -sz * 1e-3 },
        max: { x: this.maxx, y: this.maxy, z:  sz * 1e-3 }
    };

    //Also compute a rough bounding sphere
    var bs = mesh.boundingSphere = {
        center: {
            x: 0.5 * (this.minx + this.maxx),
            y: 0.5 * (this.miny + this.maxy),
            z: 0.0
        },
        radius: 0.5 * Math.sqrt(w*w + h*h)
    };

    return mesh;
};

// The following logic attempts to "fix" imprecisions in arc definitions introduced
// by Heidi's fixed point math, in case that the extractor doesn't handle it correctly.

var fixUglyArc = function (start, end)
{
    //Snap critical angles exactly
    function snapCritical() {
        function fuzzyEquals(a, b) { return (Math.abs(a - b) < 1e-3); }

        if (fuzzyEquals(start, 0))   start = 0.0;
        if (fuzzyEquals(end,   0))   end   = 0.0;
        if (fuzzyEquals(start, TAU)) start = TAU;
        if (fuzzyEquals(end,   TAU)) end   = TAU;
    }

    snapCritical();

    //OK, in some cases the angles are both over-rotated...
    if (start > end) {
        while (start > TAU) {
            start -= TAU;
            end   -= TAU;
        }
    } else {
        while (end > TAU) {
            start -= TAU;
            end   -= TAU;
        }
    }

    //Snap critical angles exactly -- again
    snapCritical();

    //If the arc crosses the x axis, we have to make it clockwise...
    //This is a side effect of bringing over-rotated arcs in range above.
    //For example start = 5.0, end = 7.0 will result in start < 0 and end > 0,
    //so we have to make start > end in order to indicate we are crossing angle = 0.
    if (start < 0 && end > 0) {
        start += TAU;
    }

    return {start: start, end: end};
};

