import { InputStream } from '../common/InputStream';
import { LmvMatrix4 } from '../../../wgs/scene/LmvMatrix4';


"use strict";

var warnedGzip = false;

/** @constructor */
export function PackFileReader(data)
{
    var stream = this.stream = new InputStream(data);

    var len = stream.getInt32();
    this.type = stream.getString(len);
    this.version = stream.getInt32();

    this.types = null;
    this.entryOffsets = [];

    //read the table of contents
    {
        var offset = stream.offset;

        // Jump to file footer.
        stream.seek(stream.byteLength - 8);

        // Jump to toc.
        var tocOffset = stream.getUint32();
        this.typesOffset = stream.getUint32();

        // Populate type sets.
        stream.seek(this.typesOffset);
        var typesCount = this.readU32V();
        this.types = [];
        for (var i = 0; i < typesCount; ++i)
            this.types.push({
                "entryClass": this.readString(),
                "entryType": this.readString(),
                "version": this.readU32V()
            });

        // Populate data offset list.
        stream.seek(tocOffset);
        var entryCount = this.readU32V();
        var dso = this.entryOffsets;
        for (var i = 0; i < entryCount; ++i)
            dso.push(stream.getUint32());

        // Restore sanity of the world.
        stream.seek(offset);
    }
};

PackFileReader.prototype.readVarint = function() {
    var b;
    var value = 0;
    var shiftBy = 0;
    do {
        b = this.stream.getUint8();
        value |= (b & 0x7f) << shiftBy;
        shiftBy += 7;
    } while (b & 0x80);
    return value;
};
PackFileReader.prototype.readU32V = PackFileReader.prototype.readVarint;

PackFileReader.prototype.readU16 = function () {
    return this.stream.getUint16();
};

PackFileReader.prototype.readU8 = function () {
    return this.stream.getUint8();
};

PackFileReader.prototype.readString = function() {
    return this.stream.getString(this.readU32V());
};

PackFileReader.prototype.readVector3f = function () {
    var s = this.stream;
    return { x:s.getFloat32(), y:s.getFloat32(), z:s.getFloat32()};
};

PackFileReader.prototype.readF32 = function () {
    return this.stream.getFloat32();
};

PackFileReader.prototype.readVector3d = (function() {

    var t = { x:0, y:0, z:0 };

    return function () {
        var s = this.stream;
        t.x = s.getFloat64();
        t.y = s.getFloat64();
        t.z = s.getFloat64();

        return t;
    };
})();

PackFileReader.prototype.readQuaternionf = (function() {

    var q = { x:0, y:0, z:0, w:0 };

    return function() {
        var s = this.stream;
        q.x = s.getFloat32();
        q.y = s.getFloat32();
        q.z = s.getFloat32();
        q.w = s.getFloat32();

        return q;
    };

})();

PackFileReader.prototype.readMatrix3f = (function() {

    var _m = new LmvMatrix4();

    return function(dst) {
        if (!dst) dst = _m;
            
        var s = this.stream;
        dst.identity();
        for (var i = 0; i < 3; ++i)
            for (var j = 0; j < 3; ++j)
                dst.elements[4*i+j] = s.getFloat32();

        return dst;
    };

})();



PackFileReader.prototype.readTransform = (function() {

    var s = { x:1, y:1, z:1 };
    var m = new LmvMatrix4(true);

    return function(entityIndex, buffer, offset, placementTransform, globalOffset, originalTranslation)
    {
        var stream = this.stream;
        var t, q;

        var transformType = stream.getUint8();

        switch (transformType)
        {
            case 4/*TransformType.Identity*/: {
                m.identity();
            } break;
            case 0/*TransformType.Translation*/: {
                t = this.readVector3d();
                m.makeTranslation(t.x, t.y, t.z);
            } break;
            case 1/*TransformType.RotationTranslation*/: {
                q = this.readQuaternionf();
                t = this.readVector3d();
                s.x = 1;s.y = 1;s.z = 1;
                m.compose(t, q, s);
            } break;
            case 2/*TransformType.UniformScaleRotationTranslation*/: {
                var scale = stream.getFloat32();
                q = this.readQuaternionf();
                t = this.readVector3d();
                s.x = scale; s.y = scale; s.z = scale;
                m.compose(t, q, s);
            } break;
            case 3/*TransformType.AffineMatrix*/: {
                this.readMatrix3f(m);
                t = this.readVector3d();
                m.setPosition(t);
            } break;
            default:
                break; //ERROR
        }

        //Report the original translation term to the caller, if they need it.
        //This is only required when reading fragment bounding boxes, where the translation
        //term of this matrix is subtracted from the bbox terms.
        if (originalTranslation) {
            originalTranslation[0] = m.elements[12];
            originalTranslation[1] = m.elements[13];
            originalTranslation[2] = m.elements[14];
        }

        //Apply any placement transform
        if (placementTransform) {
            m.multiplyMatrices(placementTransform, m);
        }

        //Apply global double precision offset on top
        if (globalOffset) {
            m.elements[12] -= globalOffset.x;
            m.elements[13] -= globalOffset.y;
            m.elements[14] -= globalOffset.z;
        }

        //Store result back into single precision matrix or array
        if (entityIndex !== undefined) {
            var src = m.elements;
            // Sometimes we don't want to keep this data (e.g. when we are probing the fragment list
            // to find the data base id to fragment index mappings used for fragment filtering) so we
            // pass a null buffer and if that is the case, bail out here.
            if (!buffer) return;
            buffer[offset+0] = src[0]; buffer[offset+1] = src[1]; buffer[offset+2] = src[2];
            buffer[offset+3] = src[4]; buffer[offset+4] = src[5]; buffer[offset+5] = src[6];
            buffer[offset+6] = src[8]; buffer[offset+7] = src[9]; buffer[offset+8] = src[10];
            buffer[offset+9] = src[12]; buffer[offset+10] = src[13]; buffer[offset+11] = src[14];
        }
        else {
            return new LmvMatrix4().copy(m);
        }
    };

})();

PackFileReader.prototype.getEntryCounts = function() {
    return this.entryOffsets.length;
};

PackFileReader.prototype.seekToEntry = function(entryIndex) {
    var count = this.getEntryCounts();
    if (entryIndex >= count)
        return null;

    // Read the type index and populate the entry data
    this.stream.seek(this.entryOffsets[entryIndex]);
    var typeIndex = this.stream.getUint32();
    if (typeIndex >= this.types.length)
        return null;

    return this.types[typeIndex];
};


PackFileReader.prototype.readPathID = function() {
    var s = this.stream;

    //Construct a /-delimited string as the path to a node
    //TODO: in case we need a split representation (e.g. to follow paths), then
    //an array of numbers might be better to return from here.
    if (this.version < 2) {
        var pathLength = s.getUint16();
        if (!pathLength)
            return null;

        //The first number in a path ID is always zero (root)
        //so we skip adding it to the path string here.
        //Remove this section if that is not the case in the future.
        s.getUint16();
        if (pathLength == 1)
            return "";

        var path = s.getUint16();
        for (var i = 2; i < pathLength; ++i) {
            path += "/" + s.getUint16();
        }
    }
    else {
        var pathLength = this.readU32V();
        if (!pathLength)
            return null;

        //The first number in a path ID is always zero (root)
        //so we skip adding it to the path string here.
        //Remove this section if that is not the case in the future.
        this.readU32V();
        if (pathLength == 1)
            return "";

        var path = this.readU32V();
        for (var i = 2; i < pathLength; ++i) {
            path += "/" + this.readU32V();
        }
    }
    return path;
};
