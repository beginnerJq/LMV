import { isNodeJS } from "../../../compat";
import { VBUtils } from '../common/VbUtils';
//import { readOpenCTM_MG2 } from './OctmMG2';

"use strict";

//=====================================================================
//=====================================================================
//=====================================================================
//=====================================================================
//=====================================================================
//=====================================================================
//=====================================================================

var ntmp = new Float32Array(3);

var INV_PI = 1.0 / Math.PI;

var atan2 = Math.atan2;
if (!isNodeJS()) {
    //Faster approximation to atan2
    //http://math.stackexchange.com/questions/1098487/atan2-faster-approximation
    //The algorithm does not deal with special cases such as x=0,y=0x=0,y=0,
    //nor does it consider special IEEE-754 floating-point operands such as infinities and NaN.
    atan2 = function(y, x) {
        var ax = Math.abs(x);
        var ay = Math.abs(y);
        //var a = (ax > ay) ? ay / ax : ax / ay;
        var a = Math.min(ax, ay) / Math.max(ax, ay);
        var s = a * a;
        var r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
        if (ay > ax)
            r = 1.57079637 - r;
        if (x < 0)
            r = 3.14159274 - r;
        if (y < 0)
            r = -r;
        return r;
    }
}

function readOpenCTM_RAW(stream, mesh, dstBuffer, startOffset, estimateSizeOnly) {

    var readOpenCTMString = function() {
        return stream.getString(stream.getInt32());
    };

    //Now do the data reads
    var name = stream.getString(4);
    if (name != "INDX") return null;

    var vcount = mesh.vertexCount;
    var tcount = mesh.triangleCount;
    var stride = mesh.vbstride;

    //We will create a single ArrayBuffer to back both the vertex and index buffers
    //The indices will be places after the vertex information, because we need alignment
    //of 4 bytes
    var vbSizeFloat = vcount * stride;
    var totalSizeInFloats = vbSizeFloat + ((tcount*3*2 + 3) / 4)|0;

    mesh.sharedBufferBytes = totalSizeInFloats * 4;

    if (estimateSizeOnly) {
        return;
    }

    var vbf;
    if (!dstBuffer) {
        dstBuffer = new ArrayBuffer(totalSizeInFloats * 4);
        startOffset = 0;
    }

    vbf = mesh.vb = new Float32Array(dstBuffer, startOffset, vbSizeFloat);
    mesh.indices = new Uint16Array(dstBuffer, startOffset + vbSizeFloat*4, tcount*3);
    stream.getIndicesArray(vbf.buffer, startOffset + vbSizeFloat*4, tcount*3);

    name = stream.getString(4);
    if (name != "VERT") return null;

    var vbi;
    //See if we want to pack the normals into two shorts
    if (mesh.vblayout.normal && mesh.vblayout.normal.itemSize === 2)
        vbi = new Uint16Array(vbf.buffer, vbf.byteOffset, vbf.byteLength / 2);

    //Read positions
    stream.getVector3Array(vbf, vcount, mesh.vblayout['position'].offset, stride);

    //Read normals
    var i, t, offset;
    if (mesh.flags & 1) {
        name = stream.getString(4);
        if (name != "NORM") return null;

        if (vbi) {
            if (ntmp.length < vcount*3)
                ntmp = new Float32Array(vcount*3);
            stream.getVector3Array(ntmp, vcount, 0, 3);

            for (i=0, offset=mesh.vblayout['normal'].offset;
                 i<vcount;
                 i++, offset += stride)
            {
                var pnx = (atan2(ntmp[i*3+1], ntmp[i*3]) * INV_PI + 1.0) * 0.5;
                var pny = (ntmp[i*3+2] + 1.0) * 0.5;

                vbi[offset*2] = (pnx * 65535)|0;
                vbi[offset*2+1] = (pny * 65535)|0;
            }
        } else {
            stream.getVector3Array(vbf, vcount, mesh.vblayout['normal'].offset, stride);
        }

    }

    //Read uv layers
    for (t=0; t<mesh.texMapCount; t++) {
        name = stream.getString(4);
        if (name != "TEXC") return null;

        var uv = {
            name : readOpenCTMString(),
            file : readOpenCTMString()
        };
        mesh.uvs.push(uv);

        var uvname = "uv";
        if (t)
            uvname += (t+1).toString();

        stream.getVector2Array(vbf, vcount, mesh.vblayout[uvname].offset, stride);
    }

    var attributeOffset = stride - (mesh.attribMapCount||0) * 3;

    //Read vertex colors and uvw (and skip any other attributes that we don't know)
    for (t=0; t<mesh.attribMapCount; t++) {
        name = stream.getString(4);
        if (name != "ATTR") return null;

        var attr = {
            name : readOpenCTMString()
        };

        // console.log("attribute", attr.name);

        var attrname;
        if (attr.name.indexOf("Color") != -1)//Special case of vertex colors
            attrname = 'color';
        else if (attr.name.indexOf("UVW") != -1)//Only used by prism 3d wood.
            attrname = 'uvw';
        else {
            //Other attributes, though we don't know what to do with those
            mesh.attrs.push(attr);
            stream.getBytes(vcount*16); //skip past
            continue;
        }

        mesh.vblayout[attrname] = { offset : attributeOffset, itemSize : 3};

        var v4 = [0,0,0,0];
        for (i=0, offset=attributeOffset;
                i<vcount;
                i++, offset += stride) {
            stream.getVector4(v4,0);
            vbf[offset] = v4[0];
            vbf[offset+1] = v4[1];
            vbf[offset+2] = v4[2];
            //Ignoring the alpha term. For color attribute, we can actually pack it in a 4-byte attribute,
            //but we do not know in advance (when we allocate the target buffer) if the OCTM attribute is UVW or color
        }
        attributeOffset += 3;
    }

}

// Helper function for calculating new vertex for wide lines
var getLineSplitVertex = function(stride, vbf, neighbourhoods, a, b) {
    // New vertex position
    var pos = {
        x: vbf[stride * a],
        y: vbf[stride * a + 1],
        z: vbf[stride * a + 2]
    };
    // Direction to the next vertex for segment (must be valid always)
    var next = {
        x: pos.x - vbf[stride * b],
        y: pos.y - vbf[stride * b + 1],
        z: pos.z - vbf[stride * b + 2]
    };

    // Index of previous point
    var prev_ind = (neighbourhoods[a].next == b) ? neighbourhoods[a].prev : neighbourhoods[a].next;
    
    // Direction to previous point
    var prev;
    // If does not exist
    if (prev_ind < 0) {
        // mirror next direction
        prev = {
            x: next.x,
            y: next.y,
            z: next.z
        };
    } else {
        // else - set directly
        prev = {
            x: vbf[stride * prev_ind] - pos.x,
            y: vbf[stride * prev_ind + 1] - pos.y,
            z: vbf[stride * prev_ind + 2] - pos.z
        };
    }

    return {
        pos: pos,
        next: next,
        prev: prev
    };
};

// convert a line mesh into specially organised triangles, which will be drawn
// as lines with a specific width
var convertToWideLines = function(mesh, stride, vbf, indexPairs, offset) {

    var numCoords = 3;

    // add some extra vertex data to the mesh
    // prev & next are directions specific vertex positions, which are used to specify
    // the offset direction in the shader
    // side is the directed line width used for the magnitude of the offset in the shader
    offset = mesh.vbstride;
    mesh.vblayout['prev'] = {offset:offset, itemSize: numCoords};
    offset += numCoords;
    mesh.vblayout['next'] = {offset:offset, itemSize: numCoords};
    offset += numCoords;
    mesh.vblayout['side'] = {offset:offset, itemSize: 1};

    mesh.vbstride += 7;

    // Count of shared vertexes
    var connections = 0;

    // Build neighbourhoods of each vertex
    var neighbourhoods = new Array(mesh.vertexCount);
    var i,j,n,a,b;
    for (i = 0; i < mesh.vertexCount; ++i) {
        neighbourhoods[i] = {
            prev: -1,       // index of previous vertex
            next: -1,       // index of next vertex
            prev_seg: -1    // index of previous segment
        };
    }

    for (j = 0; j < indexPairs; ++j) {
        n = j * 2;
        a = mesh.indices[n];
        b = mesh.indices[n + 1];
        neighbourhoods[a].next = b;
        if (neighbourhoods[a].prev >= 0) {
            ++connections;
        }

        neighbourhoods[b].prev = a;
        neighbourhoods[b].prev_seg = j;
        if (neighbourhoods[b].next >= 0) {
            ++connections;
        }
    }

    // Each segment will have its own vertexes
    var newBaseVertexCount = indexPairs * 2;
    var newBaseVertexies = new Array(newBaseVertexCount);

    // Indexes contains line segments and additional connection for shared vertexes
    var newIndices = new Uint16Array(2 * numCoords * (indexPairs + connections));
    var meshIndex = 0;

    // Split all vertexes and build indexes of all triangles
    for (j = 0; j < indexPairs; ++j) {
        n = j * 2;
        a = mesh.indices[n];
        b = mesh.indices[n + 1];
        // New vertexes with calculated next and previous points
        newBaseVertexies[n] = getLineSplitVertex(stride, vbf, neighbourhoods, a, b);
        newBaseVertexies[n + 1] = getLineSplitVertex(stride, vbf, neighbourhoods, b, a);

        // Segment triangles
        a = n;
        b = n + 1;
        // First two coordinates form line segment are used in ray casting
        newIndices[meshIndex++] = 2 * a + 1;
        newIndices[meshIndex++] = 2 * b;
        newIndices[meshIndex++] = 2 * a;
        newIndices[meshIndex++] = 2 * b;
        newIndices[meshIndex++] = 2 * b + 1;
        newIndices[meshIndex++] = 2 * a;

        // Connection triangles for shared vertexes, if exist
        a = mesh.indices[n];
        if (neighbourhoods[a].prev >= 0) {
            b = neighbourhoods[a].prev_seg * 2 + 1;
            a = n;

            newIndices[meshIndex++] = 2 * b;
            newIndices[meshIndex++] = 2 * a;
            newIndices[meshIndex++] = 2 * b + 1;
            newIndices[meshIndex++] = 2 * a + 1;
            newIndices[meshIndex++] = 2 * a;
            newIndices[meshIndex++] = 2 * b;
        }
    }
    mesh.indices = newIndices;

    // Finally, fill vertex buffer with new data
    var newVertexCount = newBaseVertexCount * 2;
    mesh.vb = new Float32Array(newVertexCount * mesh.vbstride);

    offset = mesh.vblayout['position'].offset;
    for (var c = 0; c < newBaseVertexCount; ++c) {
        // Duplicate every vertex for each side
        for (var side = 0; side < 2; ++side) {
            // Vertex position
            mesh.vb[offset] = newBaseVertexies[c].pos.x;
            mesh.vb[offset + 1] = newBaseVertexies[c].pos.y;
            mesh.vb[offset + 2] = newBaseVertexies[c].pos.z;
            offset += stride;

            // Previous vertex direction
            mesh.vb[offset] = newBaseVertexies[c].prev.x;
            mesh.vb[offset + 1] = newBaseVertexies[c].prev.y;
            mesh.vb[offset + 2] = newBaseVertexies[c].prev.z;
            offset += numCoords;

            // Next vertex direction
            mesh.vb[offset] = newBaseVertexies[c].next.x;
            mesh.vb[offset + 1] = newBaseVertexies[c].next.y;
            mesh.vb[offset + 2] = newBaseVertexies[c].next.z;
            offset += numCoords;

            // Side (offset direction)
            mesh.vb[offset] = side ? -1 : 1;
            offset += 1;
        }
    }

    mesh.vertexCount = newVertexCount;

    // flag to mark this mesh as special
    mesh.isWideLines = true;
};

//=====================================================================
//=====================================================================
//=====================================================================
//=====================================================================
//=====================================================================
//=====================================================================
//=====================================================================


var readOpenCTM = function(stream, dstBuffer, startOffset, estimateSizeOnly, packNormals) {

    var readOpenCTMString = function() {
        return stream.getString(stream.getInt32());
    };

    var fourcc = stream.getString(4);
    if (fourcc != "OCTM") return null;

    var version = stream.getInt32();
    if (version != 5) return null;

    var method = stream.getString(3);
    stream.getUint8(); //read the last 0 char of the RAW or MG2 fourCC.

    var mesh = {
        stream: null,
        vertices:   null,
        indices:    null,
        normals:    null,
        colors:     null,
        uvs:        [],
        attrs:      []
    };

    mesh.vertexCount = stream.getInt32();
    mesh.triangleCount = stream.getInt32();
    mesh.texMapCount = stream.getInt32();
    mesh.attribMapCount = stream.getInt32();
    mesh.flags = stream.getInt32();
    mesh.comment = readOpenCTMString();

    var usePackedNormals = packNormals;


    //Calculate stride of the interleaved buffer we need
    mesh.vbstride = 3; //position is always there
    if (mesh.flags & 1)
        mesh.vbstride += usePackedNormals ? 1 : 3; //normal
    mesh.vbstride += 2 * (mesh.texMapCount || 0); //texture coords
    mesh.vbstride += 3 * (mesh.attribMapCount || 0); //we now support color and uvw. Both of them use three floats.

    mesh.vblayout = {};
    var offset = 0;

    mesh.vblayout['position'] = { offset: offset, itemSize: 3 };

    offset += 3;
    if (mesh.flags & 1) {
        mesh.vblayout['normal'] = { offset : offset, 
                                    itemSize : usePackedNormals ? 2 : 3, 
                                    bytesPerItem: usePackedNormals ? 2 : 4,
                                    normalized: usePackedNormals };

        offset += usePackedNormals ? 1 : 3; //offset is counted in units of 4 bytes
    }
    if (mesh.texMapCount) {
        for (var i=0; i<mesh.texMapCount; i++) {
            var uvname = "uv";
            if (i)
                uvname += (i+1).toString();

            mesh.vblayout[uvname] = { offset : offset, itemSize: 2 };
            offset += 2;
        }
    }

    //Now read and populate the mesh data
    if (method == "RAW") {
        readOpenCTM_RAW(stream, mesh, dstBuffer, startOffset, estimateSizeOnly);
        if (!estimateSizeOnly) {
            VBUtils.deduceUVRepetition(mesh);
            VBUtils.computeBounds3D(mesh);
        }
        return mesh;
    }
    else if (method == "MG2") {
        //This code path is never used, since MG2 compression is disabled at the LMVTK C++ level
        debug("readOpenCTM_MG2(stream, mesh, dstBuffer, startOffset, estimateSizeOnly) not supported");
        if (!estimateSizeOnly) {
            VBUtils.deduceUVRepetition(mesh);
            VBUtils.computeBounds3D(mesh);
        }
        return mesh;
    }
    else
        return null;
};


var readLinesOrPoints = function(pfr, tse, estimateSizeOnly, lines) {

    //TODO: Line geometry does not go into shared buffers yet
    if (estimateSizeOnly)
        return null;

    // Initialize mesh
    var mesh = {
        vertices:   null,
        indices:    null,
        colors:     null,
        normals:    null,
        uvs:        [],
        attrs:      [],
        lineWidth:  1.0
    };

    // Read vertex count, index count, polyline bound count
    var indexCount;
    if (lines) {
        // Read vertex count, index count, polyline bound count
        var polyLineBoundCount;
        if ( tse.version > 1 ) {
            mesh.vertexCount   = pfr.readU16();
            indexCount         = pfr.readU16();
            polyLineBoundCount = pfr.readU16();

            if (tse.version > 2) {
                mesh.lineWidth = pfr.readF32();
            }
        } else {
            mesh.vertexCount   = pfr.readU32V();
            indexCount         = pfr.readU32V();
            polyLineBoundCount = pfr.readU32V();
        }
        mesh.isLines = true;
    } else {
        // Read vertex count, index count, point size
        mesh.vertexCount   = pfr.readU16();
        indexCount         = pfr.readU16();
        mesh.pointSize     = pfr.readF32();
        mesh.isPoints = true;
    }

    // Determine if color is defined
    var hasColor = (pfr.stream.getUint8() != 0);


    //Calculate stride of the interleaved buffer we need
    mesh.vbstride = 3; //position is always there
    if (hasColor)
        mesh.vbstride += 3; //we only interleave the color attribute, and we reduce that to RGB from ARGB.

    mesh.vblayout = {};
    var offset = 0;

    mesh.vblayout['position'] = { offset: offset, itemSize: 3 };

    offset += 3;
    if (hasColor) {
        mesh.vblayout['color'] = { offset : offset, itemSize : 3};
    }

    mesh.vb = new Float32Array(mesh.vertexCount * mesh.vbstride);


    // Read vertices
    var vbf = mesh.vb;
    var stride = mesh.vbstride;
    var stream = pfr.stream;

    stream.getVector3Array(vbf, mesh.vertexCount, mesh.vblayout['position'].offset, stride);

    // Determine color if specified
    var c, cEnd;
    if (hasColor) {
        for (c=0, offset=mesh.vblayout['color'].offset, cEnd=mesh.vertexCount;
             c<cEnd;
             c++, offset += stride)
        {
            vbf[offset] = stream.getFloat32();
            vbf[offset+1] = stream.getFloat32();
            vbf[offset+2] = stream.getFloat32();
            stream.getFloat32(); //skip alpha -- TODO: convert color to ARGB 32 bit integer in the vertex layout and shader
        }
    }

    // Copies bytes from buffer
    var forceCopy = function(b) {
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    };

    // Read indices and polyline bound buffer
    if (lines) {
        var indices;
        var polyLineBoundBuffer;
        if ( tse.version > 1 ) {
            // 16 bit format
            indices = new Uint16Array(forceCopy(stream.getBytes(indexCount*2)));
            polyLineBoundBuffer = new Uint16Array(forceCopy(stream.getBytes(polyLineBoundCount*2)));
        }
        else {
            // 32 bit format
            indices = new Int32Array(forceCopy(stream.getBytes(indexCount*4)));
            polyLineBoundBuffer = new Int32Array(forceCopy(stream.getBytes(polyLineBoundCount*4)));
        }

        // three.js uses GL-style index pairs in its index buffer. We need one pair
        // per segment in each polyline
        var indexPairs = polyLineBoundBuffer[polyLineBoundCount-1] - polyLineBoundCount + 1;

        mesh.indices = new Uint16Array(2*indexPairs);

        // Extract the individual line segment index pairs
        var meshIndex = 0;
        for (var i=0; i+1 < polyLineBoundCount; i++){
            for(var j = polyLineBoundBuffer[i]; j+1 < polyLineBoundBuffer[i+1]; j++){
                mesh.indices[meshIndex++] = indices[j];
                mesh.indices[meshIndex++] = indices[j+1];
            }
        }
    } else {
        mesh.indices = new Uint16Array(forceCopy(stream.getBytes(indexCount*2)));
    }

    if (mesh.lineWidth != 1.0) {
        convertToWideLines(mesh, stride, vbf, indexPairs, offset);
    }

    VBUtils.computeBounds3D(mesh);

    return mesh;
};

var readLines = function(pfr, tse, estimateSizeOnly) {
    return readLinesOrPoints(pfr, tse, estimateSizeOnly, true);
};

var readPoints = function(pfr, tse, estimateSizeOnly) {
    return readLinesOrPoints(pfr, tse, estimateSizeOnly, false);
};

export function readGeometry(pfr, entry, options) {
    var tse = pfr.seekToEntry(entry);
    if (!tse)
        return null;

    if (tse.entryType == "Autodesk.CloudPlatform.OpenCTM") {
        return readOpenCTM(pfr.stream, options.dstBuffer, options.startOffset, options.estimateSizeOnly, options.packNormals);
    }
    else if (tse.entryType == "Autodesk.CloudPlatform.Lines") {
        return readLines(pfr, tse, options.estimateSizeOnly);
    }
    else if (tse.entryType == "Autodesk.CloudPlatform.Points") {
        return readPoints(pfr, tse, options.estimateSizeOnly);
    }

    return null;
}
