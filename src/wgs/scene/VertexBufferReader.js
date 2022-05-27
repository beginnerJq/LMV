
"use strict";

import * as THREE from "three";

var TAU = Math.PI * 2;

//Constants duplicated from src/lmvtk/VertexBufferBuilder.js
var VBB_GT_TRIANGLE_INDEXED = 0,
    VBB_GT_LINE_SEGMENT     = 1,
    VBB_GT_ARC_CIRCULAR     = 2,
    VBB_GT_ARC_ELLIPTICAL   = 3,
    VBB_GT_TEX_QUAD         = 4,
    VBB_GT_ONE_TRIANGLE     = 5;

var VBB_INSTANCED_FLAG  = 0, // this is intentionally 0 for the instancing case!
    VBB_SEG_START_RIGHT = 0, // this starts intentionally at 0!
    VBB_SEG_START_LEFT  = 1,
    VBB_SEG_END_RIGHT   = 2,
    VBB_SEG_END_LEFT    = 3;

var VBB_COLOR_OFFSET    = 6,
    VBB_DBID_OFFSET     = 7,
    VBB_FLAGS_OFFSET    = 8,
    VBB_LAYER_VP_OFFSET = 9;

/**
 * Initializes a "view" into a compacted interleaved vertex buffer array using our custom 2D vertex layout.
 * See src/lmvtk/VertexBufferBuilder.js for more details.
 */
export function VertexBufferReader(geometry)
{
    this.vb  = geometry.vb.buffer;
    this.vbf = new Float32Array(this.vb);
    this.vbi = new Int32Array(this.vb);
    this.vbs = new Uint16Array(this.vb);

    this.ib = geometry.ib;

    this.stride = geometry.vbstride;
    this.vcount = this.vbf.length / this.stride;

    this.useInstancing = geometry.numInstances > 0;
    this.useCompactBuffers = geometry.unpackXform;
    this.texData = this.useCompactBuffers && geometry.tIdColor?.image?.data && new Uint32Array(geometry.tIdColor.image.data.buffer);

    // Does the geom use interleaved vb?
    // Used by FragmentList.updateVertexBufferForThemingAndGhosting which only
    // workes with interleaved vb
    this.isInterleavedVb = (() => {
        const attr = geometry.attributes;
        if (!attr) return false;

        const atLayerVp = attr.layerVp4b;
        const atFlags   = attr.flags4b;

        if (this.useCompactBuffers) {
            const atIdColors  = attr.uvIdColor;
            return atIdColors && atLayerVp && atFlags;
        } else {
            const atColors  = attr.color4b;
            const atIds     = attr.dbId4b;
            return atColors && atIds && atLayerVp && atFlags;
        }
    })();
};

VertexBufferReader.prototype.getDbIdAt = function(vindex) {
    if(this.texData) {
        return this.texData[this.vbs[vindex*this.stride * 2 + VBB_DBID_OFFSET]];
    }
    return this.vbi[vindex*this.stride + VBB_DBID_OFFSET];
};

VertexBufferReader.prototype.getColorAt = function(vindex) {
    if(this.texData) {
        return this.texData[this.vbs[vindex*this.stride * 2 + VBB_COLOR_OFFSET]];
    }
    return this.vbi[vindex*this.stride + VBB_COLOR_OFFSET];
};

VertexBufferReader.prototype.getVertexFlagsAt = function(vindex) {
    if(this.texData) {
        return this.vbi[vindex*this.stride + 4];
    }
    return this.vbi[vindex*this.stride + VBB_FLAGS_OFFSET];
};

VertexBufferReader.prototype.getLayerIndexAt = function(vindex) {
    if(this.texData) {
        return this.vbi[vindex*this.stride + 5] & 0xffff;
    }
    return this.vbi[vindex*this.stride + VBB_LAYER_VP_OFFSET] & 0xffff;
};

VertexBufferReader.prototype.getViewportIndexAt = function(vindex) {
    if(this.texData) {
        return (this.vbi[vindex*this.stride + 5] >> 16) & 0xffff;
    }
    return (this.vbi[vindex*this.stride + VBB_LAYER_VP_OFFSET] >> 16) & 0xffff;
};

VertexBufferReader.prototype.decodeLineAt = function(vindex, layer, vpId, callback)
{
    if (!callback.onLineSegment) { return; }

    if(this.useCompactBuffers) {
        var vertexOffset = this.stride * vindex * 2;
        var x0         = ((this.useCompactBuffers.x * this.vbs[vertexOffset]) / 65535) + this.useCompactBuffers.z;
        var y0         = ((this.useCompactBuffers.y * this.vbs[vertexOffset+1]) / 65535) + this.useCompactBuffers.w;
        var angle      = ((this.vbs[vertexOffset+2] / 65535) * TAU) - Math.PI;
        var distAlong  = (this.vbs[vertexOffset+3] / 65535) * Math.max(this.useCompactBuffers.x, this.useCompactBuffers.y);
        var lineWidth  = (((this.vbs[vertexOffset+4]) / 32767) * Math.max(this.useCompactBuffers.x, this.useCompactBuffers.y)) * 2.0;
    } else {
        var baseOffset = this.stride * vindex;
        var x0         = this.vbf[baseOffset];
        var y0         = this.vbf[baseOffset+1];
        var angle      = this.vbf[baseOffset+2] * TAU - Math.PI; // decode angle: see VertexBufferBuilder.addVertexLine
        var distAlong  = this.vbf[baseOffset+3];
        var lineWidth  = this.vbf[baseOffset+4] * 2.0;
    }

    var x1 = x0 + distAlong * Math.cos(angle);
    var y1 = y0 + distAlong * Math.sin(angle);

    callback.onLineSegment(x0, y0, x1, y1, vpId, lineWidth);
};

VertexBufferReader.prototype.decodeCircularArcAt = function(vindex, layer, vpId, callback)
{
    if (!callback.onCircularArc) { return; }

    if(this.useCompactBuffers) {
        var vertexOffset = this.stride * vindex * 2;
        var cx         = ((this.useCompactBuffers.x * this.vbs[vertexOffset]) / 65535) + this.useCompactBuffers.z;
        var cy         = ((this.useCompactBuffers.y * this.vbs[vertexOffset+1]) / 65535) + this.useCompactBuffers.w;
        var start      = (this.vbs[vertexOffset+2] / 65535) * TAU;
        var end        = (this.vbs[vertexOffset+3] / 65535) * TAU;
        var radius     = (this.vbs[vertexOffset+5] / 65535) * Math.max(this.useCompactBuffers.x, this.useCompactBuffers.y);
    } else {
        var baseOffset = this.stride * vindex;
        var cx         = this.vbf[baseOffset];
        var cy         = this.vbf[baseOffset+1];
        var start      = this.vbf[baseOffset+2] * TAU;
        var end        = this.vbf[baseOffset+3] * TAU;
        var radius     = this.vbf[baseOffset+5];
    }

    callback.onCircularArc(cx, cy, start, end, radius, vpId);
};

VertexBufferReader.prototype.decodeEllipticalArcAt = function(vindex, layer, vpId, callback)
{
    if (!callback.onEllipticalArc) { return; }

    // Note: compaction will not happen for the VBB_GT_ARC_ELLIPTICAL
    var baseOffset = this.stride * vindex;
    var cx         = this.vbf[baseOffset];
    var cy         = this.vbf[baseOffset+1];
    var start      = this.vbf[baseOffset+2] * TAU;
    var end        = this.vbf[baseOffset+3] * TAU;
    var major      = this.vbf[baseOffset+5];
    var minor      = this.vbf[baseOffset+10];
    var tilt       = this.vbf[baseOffset+11];

    callback.onEllipticalArc(cx, cy, start, end, major, minor, tilt, vpId);
};

VertexBufferReader.prototype.decodeTexQuadAt = function(vindex, layer, vpId, callback)
{
    if (!callback.onTexQuad) { return; }

    if(this.useCompactBuffers) {
        var vertexOffset = this.stride * vindex * 2;
        var centerX    = ((this.useCompactBuffers.x * this.vbs[vertexOffset]) / 65535) + this.useCompactBuffers.z;
        var centerY    = ((this.useCompactBuffers.y * this.vbs[vertexOffset+1]) / 65535) + this.useCompactBuffers.w;
        var rotation   = (this.vbs[vertexOffset+2] / 65535) * TAU;
        var width      = (this.vbs[vertexOffset+3] / 65535) * Math.max(this.useCompactBuffers.x, this.useCompactBuffers.y);
        var height     = (this.vbs[vertexOffset+4] / 65535) * Math.max(this.useCompactBuffers.x, this.useCompactBuffers.y);
    } else {
        var baseOffset = this.stride * vindex;
        var centerX    = this.vbf[baseOffset];
        var centerY    = this.vbf[baseOffset+1];
        // yes, this is in a different order than output, following VertexBufferBuilder's order
        var rotation   = this.vbf[baseOffset+2] * TAU;
        var width      = this.vbf[baseOffset+3];
        var height     = this.vbf[baseOffset+4];
    }

    callback.onTexQuad(centerX, centerY, width, height, rotation, vpId);
};

VertexBufferReader.prototype.decodeOneTriangleAt = function(vindex, layer, vpId, callback)
{
    if (!callback.onOneTriangle) { return; }

    if(this.useCompactBuffers) {
        var vertexOffset = this.stride * vindex * 2;
        var x1         = ((this.useCompactBuffers.x * this.vbs[vertexOffset]) / 65535) + this.useCompactBuffers.z;
        var y1         = ((this.useCompactBuffers.y * this.vbs[vertexOffset+1]) / 65535) + this.useCompactBuffers.w;
        var x2         = ((this.useCompactBuffers.x * this.vbs[vertexOffset+2]) / 65535) + this.useCompactBuffers.z;
        var y2         = ((this.useCompactBuffers.y * this.vbs[vertexOffset+3]) / 65535) + this.useCompactBuffers.w;
        var x3         = ((this.useCompactBuffers.x * this.vbs[vertexOffset+4]) / 65535) + this.useCompactBuffers.z;
        var y3         = ((this.useCompactBuffers.y * this.vbs[vertexOffset+5]) / 65535) + this.useCompactBuffers.w;
    } else {
        var baseOffset = this.stride * vindex;
        var x1         = this.vbf[baseOffset];
        var y1         = this.vbf[baseOffset+1];
        var x2         = this.vbf[baseOffset+2];
        var y2         = this.vbf[baseOffset+3];
        var x3         = this.vbf[baseOffset+4];
        var y3         = this.vbf[baseOffset+5];
    }

    callback.onOneTriangle(x1, y1, x2, y2, x3, y3, vpId);
};


VertexBufferReader.prototype.decodeTriangleIndexed = function(vi0, vi1, vi2, layer, vpId, callback)
{
    if (!callback.onOneTriangle) { return; }

    if(this.useCompactBuffers) {
        var vertexOffset = this.stride * vi0 * 2;
        var x1         = ((this.useCompactBuffers.x * this.vbs[vertexOffset]) / 65535) + this.useCompactBuffers.z;
        var y1         = ((this.useCompactBuffers.y * this.vbs[vertexOffset+1]) / 65535) + this.useCompactBuffers.w;

        vertexOffset   = this.stride * vi1 * 2; 
        var x2         = ((this.useCompactBuffers.x * this.vbs[vertexOffset]) / 65535) + this.useCompactBuffers.z;
        var y2         = ((this.useCompactBuffers.y * this.vbs[vertexOffset+1]) / 65535) + this.useCompactBuffers.w;

        vertexOffset   = this.stride * vi2 * 2;
        var x3         = ((this.useCompactBuffers.x * this.vbs[vertexOffset]) / 65535) + this.useCompactBuffers.z;
        var y3         = ((this.useCompactBuffers.y * this.vbs[vertexOffset+1]) / 65535) + this.useCompactBuffers.w;
    } else {
        var baseOffset = this.stride * vi0;
        var x1         = this.vbf[baseOffset];
        var y1         = this.vbf[baseOffset+1];
    
        baseOffset     = this.stride * vi1;
        var x2         = this.vbf[baseOffset];
        var y2         = this.vbf[baseOffset+1];
    
        baseOffset     = this.stride * vi2;
        var x3         = this.vbf[baseOffset];
        var y3         = this.vbf[baseOffset+1];
    }

    callback.onOneTriangle(x1, y1, x2, y2, x3, y3, vpId);
};


// used by the snapper and by the bounds finder
VertexBufferReader.prototype.enumGeomsForObject = function(dbId, callback)
{
    if (this.useInstancing) {

        //When instancing is used, each geometry primitive is encoded into a single vertex
        //and there is no index buffer.

        var i = 0;
        while (i < this.vcount) {
            var flag = this.getVertexFlagsAt(i);

            //var vertexId  = (flag >>  0) & 0xff;        //  8 bit
            var geomType    = (flag >>  8) & 0xff;        //  8 bit
            //var linePattern = (flag >> 16) & 0xff;      //  8 bit
            var layerId     = this.getLayerIndexAt(i);    // 16 bit
            var vpId        = this.getViewportIndexAt(i); // 16 bit     
            var visible     = this.getDbIdAt(i) === dbId;
            if (visible) {
                switch (geomType) {
                    case VBB_GT_LINE_SEGMENT:        this.decodeLineAt(         i, layerId, vpId, callback); break;
                    case VBB_GT_ARC_CIRCULAR:        this.decodeCircularArcAt(  i, layerId, vpId, callback); break;
                    case VBB_GT_ARC_ELLIPTICAL:      this.decodeEllipticalArcAt(i, layerId, vpId, callback); break; //  compaction is not performed
                    case VBB_GT_TEX_QUAD:            this.decodeTexQuadAt(      i, layerId, vpId, callback); break;
                    case VBB_GT_ONE_TRIANGLE:        this.decodeOneTriangleAt(  i, layerId, vpId, callback); break;
                    default:                         break;
                }
            }

            //In the case of instancing, there is no vertex duplication and no index buffer, we just
            //move to the next vertex
            i += 1;
        }
    } else {

        var i = 0;
        while (i < this.ib.length) {
            var vi = this.ib[i];
            var flag = this.getVertexFlagsAt(vi);

            //var vertexId    = (flag >>  0) & 0xff;        //  8 bit
            var geomType    = (flag >>  8) & 0xff;        //  8 bit
            //var linePattern = (flag >> 16) & 0xff;        //  8 bit
            var layerId     = this.getLayerIndexAt(vi);    // 16 bit
            var vpId        = this.getViewportIndexAt(vi); // 16 bit

            var visible = this.getDbIdAt(vi) === dbId;

            if (geomType === VBB_GT_TRIANGLE_INDEXED) {

                //Triangles are encoded in three vertices (like a simple mesh) instead of 4 like everything else

                if (visible) {
                    this.decodeTriangleIndexed(this.ib[i], this.ib[i+1], this.ib[i+2], layerId, vpId, callback);
                }

                //Advance to the next primitive
                i += 3;

            } else {

                if (visible) {
                    switch (geomType) {
                        case VBB_GT_LINE_SEGMENT:        this.decodeLineAt(         vi, layerId, vpId, callback); break;
                        case VBB_GT_ARC_CIRCULAR:        this.decodeCircularArcAt(  vi, layerId, vpId, callback); break;
                        case VBB_GT_ARC_ELLIPTICAL:      this.decodeEllipticalArcAt(vi, layerId, vpId, callback); break;
                        case VBB_GT_TEX_QUAD:            this.decodeTexQuadAt(      vi, layerId, vpId, callback); break;
                        case VBB_GT_ONE_TRIANGLE:        this.decodeOneTriangleAt(  vi, layerId, vpId, callback); break;
                        default:                         break;
                    }
                }

                //Skip duplicate vertices (when not using instancing and the geometry is not a simple polytriangle,
                //each vertex is listed four times with a different vertexId flag
                i += 6;
            }


        }
    }

};


/**
 * Used by the bounds finder.
 * @param {array[number]} layerIdsVisible - list of layer ids that are visible
 * @param {function} callback
 * @private
 */
VertexBufferReader.prototype.enumGeomsForVisibleLayer = function(layerIdsVisible, callback)
{
    var filter = function(dbId, layerId, viewportId) {
        return !layerIdsVisible || (layerId !== 0 && layerIdsVisible.indexOf(layerId) !== -1);
    };
    this.enumGeoms(filter, callback);
};


/**
 * Enumerate all geometric primitives that match the given filter.
 * @param {function} [filter] - function(dbId, layerId, viewportId): Filter function to define a subset of primitives to include. By default, all geometry is included.
 * @param {function} callback
 * @private
 */
VertexBufferReader.prototype.enumGeoms = function(filter, callback)
{
    if (this.useInstancing) {

        //When instancing is used, each geometry primitive is encoded into a single vertex
        //and there is no index buffer.

        var i = 0;
        while (i < this.vcount) {
            var flag = this.getVertexFlagsAt(i);

            //var vertexId    = (flag >>  0) & 0xff;        //  8 bit
            var geomType    = (flag >>  8) & 0xff;        //  8 bit
            //var linePattern = (flag >> 16) & 0xff;        //  8 bit
            var layerId     = this.getLayerIndexAt(i);    // 16 bit
            var vpId        = this.getViewportIndexAt(i); // 16 bit
            var dbId        = this.getDbIdAt(i);

            // Get the bounds of only the visible layers. Ignore layer 0, which is always the page.
            // If layerId visibility is not set, consider the layer visible.
            var visible = !filter || filter(dbId, layerId, vpId);
            if (visible) {
                switch (geomType) {
                    case VBB_GT_LINE_SEGMENT:        this.decodeLineAt(         i, layerId, vpId, callback); break;
                    case VBB_GT_ARC_CIRCULAR:        this.decodeCircularArcAt(  i, layerId, vpId, callback); break;
                    case VBB_GT_ARC_ELLIPTICAL:      this.decodeEllipticalArcAt(i, layerId, vpId, callback); break;
                    case VBB_GT_TEX_QUAD:            this.decodeTexQuadAt(      i, layerId, vpId, callback); break;
                    case VBB_GT_ONE_TRIANGLE:        this.decodeOneTriangleAt(  i, layerId, vpId, callback); break;
                    default:                         break;
                }
            }

            //In the case of instancing, there is no vertex duplication and no index buffer, we just
            //move to the next vertex
            i += 1;
        }
    } else {

        var i = 0;
        while (i < this.ib.length) {
            var vi = this.ib[i];
            var flag = this.getVertexFlagsAt(vi);

            //var vertexId    = (flag >>  0) & 0xff;        //  8 bit
            var geomType    = (flag >>  8) & 0xff;        //  8 bit
            //var linePattern = (flag >> 16) & 0xff;        //  8 bit
            var layerId     = this.getLayerIndexAt(vi);    // 16 bit
            var vpId        = this.getViewportIndexAt(vi); // 16 bit
            var dbId        = this.getDbIdAt(vi);

            // Get the bounds of only the visible layers. Ignore layer 0, which is always the page.
            // If layerId visibility is not set, consider the layer visible.
            var visible = !filter || filter(dbId, layerId, vpId);

            if (geomType === VBB_GT_TRIANGLE_INDEXED) {

                //Triangles are encoded in three vertices (like a simple mesh) instead of 4 like everything else

                if (visible) {
                    this.decodeTriangleIndexed(this.ib[i], this.ib[i+1], this.ib[i+2], layerId, vpId, callback);
                }

                //Advance to the next primitive
                i += 3;

            } else {

                if (visible) {
                    switch (geomType) {
                        case VBB_GT_LINE_SEGMENT:        this.decodeLineAt(         vi, layerId, vpId, callback); break;
                        case VBB_GT_ARC_CIRCULAR:        this.decodeCircularArcAt(  vi, layerId, vpId, callback); break;
                        case VBB_GT_ARC_ELLIPTICAL:      this.decodeEllipticalArcAt(vi, layerId, vpId, callback); break;
                        case VBB_GT_TEX_QUAD:            this.decodeTexQuadAt(      vi, layerId, vpId, callback); break;
                        case VBB_GT_ONE_TRIANGLE:        this.decodeOneTriangleAt(  vi, layerId, vpId, callback); break;
                        default:                         break;
                    }
                }

                //Skip duplicate vertices (when not using instancing and the geometry is not a simple polytriangle,
                //each vertex is listed four times with a different vertexId flag
                i += 6;
            }

        }
    }

};



/**
 * Callback class for calculating bounds of 2D objects via VertexBufferReader
 * @private
 */
export function BoundsCallback(bounds) {
    this.bounds = bounds;
    // workspace, so we don't reallocate this each time
    this.point = new THREE.Vector4();
    this.point.z = 0.0;
    this.point.w = 1.0; // it's a point, not a vector
}

BoundsCallback.prototype.onVertex = function(cx, cy, vpId) {
    this.point.x = cx;
    this.point.y = cy;
    this.bounds.expandByPoint( this.point );
};

BoundsCallback.prototype.onLineSegment = function(x1, y1, x2, y2, vpId) {
    this.onVertex( x1, y1 );
    this.onVertex( x2, y2 );
};

BoundsCallback.prototype.onCircularArc = function(cx, cy, start, end, radius, vpId) {
    this.onEllipticalArc(cx, cy, start, end, radius, radius, 0.0, vpId);
};

BoundsCallback.prototype.onEllipticalArc = function(cx, cy, start, end, major, minor, tilt, vpId) {
    if ( tilt == 0.0 ) {
        // does start and end make a full ellipse?
        if ( (start <= 0) && (end >= 2.0 * Math.PI - 0.00001) ) {
            // full way around, simply treat it like a rectangle
            this.onTexQuad(cx, cy, 2*major, 2*minor, tilt, vpId);
        } else {
            // Not a full ellipse. We take the start and end points and also figure
            // out the four "compass rose" points that are between these two locations.
            // The start and end locations often exist as separate vertices so would
            // already be included, but for some line types they may not exist, so we
            // include them here.
            this.point.x = cx + Math.cos(start)*major;
            this.point.y = cy + Math.sin(start)*minor;
            this.bounds.expandByPoint( this.point );
            this.point.x = cx + Math.cos(end)*major;
            this.point.y = cy + Math.sin(end)*minor;
            this.bounds.expandByPoint( this.point );

            // now check each NESW compass point, i.e., middle of each edge
            if ( start > end ) {
                // add right edge
                this.point.x = cx + major;
                this.point.y = cy ;
                this.bounds.expandByPoint( this.point );
                // make start < end for the rest of the tests
                start -= 2.0 * Math.PI;
            }
            if ( start < 0.5 * Math.PI && end > 0.5 * Math.PI ) {
                // add top edge
                this.point.x = cx ;
                this.point.y = cy + minor;
                this.bounds.expandByPoint( this.point );
            }
            if ( start < Math.PI && end > Math.PI ) {
                // add left edge
                this.point.x = cx - major;
                this.point.y = cy;
                this.bounds.expandByPoint( this.point );
            }
            if ( start < 1.5 * Math.PI && end > 1.5 * Math.PI ) {
                // add bottom edge
                this.point.x = cx ;
                this.point.y = cy - minor;
                this.bounds.expandByPoint( this.point );
            }
        }
    } else {
        // Has a tilt.
        // From what we see, you should never reach here, as tilted ellipses are actually
        // always tessellated. So, we do a fallback: call the onTexQuad with the rotation.
        // This call will be a pretty good approximation, putting a rotated bounding box
        // around the whole ellipse. For more accuracy you would need to tessellate the
        // ellipse and get its points (especially if you don't have a full ellipse).
        this.onTexQuad(cx, cy, 2*major, 2*minor, tilt, vpId);

        // does start and end make a full ellipse?
        //if ( (start <= 0) && (end >= 2.0 * Math.PI - 0.00001) ) {
        //}
    }
};

// Currently this case does not actually come up, as textured quads, i.e., images, are
// not something that can be selected, from what data I have tried. So I have not spent
// any time on the rotated case.
// TODO: this code is only partially tested: I had problems getting a selectable raster
// object in a DWG convert to an F2D.
BoundsCallback.prototype.onTexQuad = function(centerX, centerY, width, height, rotation, vpId) {
    var halfWidth = 0.5 * width;
    var halfHeight = 0.5 * width;
    if (rotation == 0.0) {
        this.onVertex( centerX - halfWidth, centerY - halfHeight );
        this.onVertex( centerX + halfWidth, centerY + halfHeight );
    } else {
        // A more complex rectangle, rotated. Take the four corners and rotate each
        // around the center.
        var rmtx = new THREE.Matrix4();  // Matrix3() does not have enough helper methods
        var mtx = new THREE.Matrix4();
        // Take a rectangle centered at the origin, rotate it, translate it to the final
        // position. Each corner is added to the bounds.
        rmtx.makeRotationZ(rotation);
        // put it into the final position:
        mtx.makeTranslation(centerX, centerY, 0.0);
        mtx.multiply(rmtx);

        for (var i = 0; i < 4; i++) {
            this.point.x = (((i%2)==1)?halfWidth:-halfWidth);
            this.point.y = ((i>=2)?halfHeight:-halfHeight);
            this.point.applyMatrix4(mtx);
            this.bounds.expandByPoint( this.point );
        }
    }
};

BoundsCallback.prototype.onOneTriangle = function(x1, y1, x2, y2, x3, y3, vpId) {
    this.onVertex( x1, y1 );
    this.onVertex( x2, y2 );
    this.onVertex( x3, y3 );
};



