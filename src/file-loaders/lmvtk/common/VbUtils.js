"use strict";


export const VBUtils = {


    deduceUVRepetition: function(mesh) {

        for (var p in mesh.vblayout) {

            if (p.indexOf("uv") != 0 || p.indexOf("uvw") == 0)
                continue;

            var baseOffset = mesh.vblayout[p].offset;
            var floatStride = mesh.vbstride;
            var vbf = mesh.vb;
            var vcount = mesh.vb.length/floatStride;

            for (var i = 0, offset = baseOffset; i<vcount; i++, offset += floatStride)
            {
                var u = vbf[offset];
                var v = vbf[offset+1];
                if (u > 2 || u < 0 || v > 2 || v < 0) {
                    mesh.vblayout[p].isPattern = true;
                    break;
                }
            }
        }
    },


    //Calculate the 3D bounding box and bounding sphere
    //of a mesh containing an interleaved vertex buffer
    computeBounds3D : function(mesh) {

        var minx = Infinity, miny = Infinity, minz = Infinity;
        var maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
        var i, offset, x, y, z;

        var floatStride = mesh.vbstride;
        var baseOffset = mesh.vblayout.position.offset;
        var vbf = mesh.vb;
        var vcount = mesh.vb.length/floatStride;

        for (i = 0, offset = baseOffset; i<vcount; i++, offset += floatStride)
        {
            x = vbf[offset];
            y = vbf[offset+1];
            z = vbf[offset+2];

            if (minx > x) minx = x;
            if (miny > y) miny = y;
            if (minz > z) minz = z;

            if (maxx < x) maxx = x;
            if (maxy < y) maxy = y;
            if (maxz < z) maxz = z;
        }

        var bb = mesh.boundingBox = {
                min:{x:minx, y:miny, z:minz},
                max:{x:maxx, y:maxy, z:maxz}
        };

        var cx = 0.5*(minx + maxx), cy = 0.5*(miny + maxy), cz = 0.5*(minz + maxz);

        var bs = mesh.boundingSphere = {};
        bs.center = {x:cx, y:cy, z:cz};

        var maxRadiusSq = 0;
        for (i = 0, offset = baseOffset; i < vcount; i++, offset += floatStride) {

            x = vbf[offset];
            y = vbf[offset+1];
            z = vbf[offset+2];

            var dx = x - cx;
            var dy = y - cy;
            var dz = z - cz;
            var distsq = dx*dx + dy*dy + dz*dz;
            if (distsq > maxRadiusSq)
                maxRadiusSq = distsq;
        }

        bs.radius = Math.sqrt(maxRadiusSq);

    },

    bboxUnion : function(bdst, bsrc) {
        if (bsrc.min.x < bdst.min.x)
            bdst.min.x = bsrc.min.x;
        if (bsrc.min.y < bdst.min.y)
            bdst.min.y = bsrc.min.y;
        if (bsrc.min.z < bdst.min.z)
            bdst.min.z = bsrc.min.z;

        if (bsrc.max.x > bdst.max.x)
            bdst.max.x = bsrc.max.x;
        if (bsrc.max.y > bdst.max.y)
            bdst.max.y = bsrc.max.y;
        if (bsrc.max.z > bdst.max.z)
            bdst.max.z = bsrc.max.z;
    }

};
