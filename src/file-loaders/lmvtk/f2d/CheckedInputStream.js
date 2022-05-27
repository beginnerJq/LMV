
"use strict";

// Similar as InputStream but with bounds checking.
// Throw exception when out of bounds access is / to be made.
export function CheckedInputStream(buf) {
    this.buffer = buf;
    this.offset = 0;
    this.byteLength = buf.length;

    //We will use these shared memory arrays to
    //convert from bytes to the desired data type.
    this.convBuf = new ArrayBuffer(8);
    this.convUint8 = new Uint8Array(this.convBuf);
    this.convUint16 = new Uint16Array(this.convBuf);
    this.convInt32 = new Int32Array(this.convBuf);
    this.convUint32 = new Uint32Array(this.convBuf);
}

function OutOfBoundsBufferAccessException(offset) {
    this.offset = offset;
    this.message = "try to access an offset that is out of bounds: " + this.offset;
    this.toString = function() {
        return this.message;
    };
}

CheckedInputStream.prototype.boundsCheck = function(offset) {
    if (offset >= this.byteLength) {
        throw new OutOfBoundsBufferAccessException(offset);
    }
}

CheckedInputStream.prototype.seek = function(off) {
    this.boundsCheck(off);
    this.offset = off;
};

CheckedInputStream.prototype.getBytes = function(len) {
    this.boundsCheck(this.offset + len);
    var ret = new Uint8Array(this.buffer.buffer, this.offset, len);
    this.offset += len;
    return ret;
};

CheckedInputStream.prototype.skipBytes = function(len) {
    this.boundsCheck(this.offset + len);
    this.offset += len;
};


CheckedInputStream.prototype.getVarints = function () {
    var b;
    var value = 0;
    var shiftBy = 0;
    do {
        this.boundsCheck(this.offset);
        b = this.buffer[this.offset++];
        value |= (b & 0x7f) << shiftBy;
        shiftBy += 7;
    } while (b & 0x80);
    return value;
};

CheckedInputStream.prototype.getUint8 = function() {
    this.boundsCheck(this.offset + 1);
    return this.buffer[this.offset++];
};

CheckedInputStream.prototype.getUint16 = function() {
    this.boundsCheck(this.offset + 2);
    this.convUint8[0] = this.buffer[this.offset++];
    this.convUint8[1] = this.buffer[this.offset++];
    return this.convUint16[0];
};

CheckedInputStream.prototype.getInt16 = function() {
    var tmp = this.getUint16();
    //make negative integer if the ushort is negative
    if (tmp > 0x7fff)
        tmp = tmp | 0xffff0000;
    return tmp;
};

CheckedInputStream.prototype.getInt32 = function() {
    this.boundsCheck(this.offset + 4);
    var src = this.buffer;
    var dst = this.convUint8;
    var off = this.offset;
    dst[0] = src[off];
    dst[1] = src[off+1];
    dst[2] = src[off+2];
    dst[3] = src[off+3];
    this.offset += 4;
    return this.convInt32[0];
};

CheckedInputStream.prototype.getUint32 = function() {
    this.boundsCheck(this.offset + 4);
    var src = this.buffer;
    var dst = this.convUint8;
    var off = this.offset;
    dst[0] = src[off];
    dst[1] = src[off+1];
    dst[2] = src[off+2];
    dst[3] = src[off+3];
    this.offset += 4;
    return this.convUint32[0];
};

CheckedInputStream.prototype.skipUint32 = function() {
    this.boundsCheck(this.offset + 4);
    this.offset += 4;
};

CheckedInputStream.prototype.getFloat32 = function() {
    this.boundsCheck(this.offset + 4);
    this.offset += 4;
    return 0;
};

CheckedInputStream.prototype.getFloat64 = function() {
    this.boundsCheck(this.offset + 8);
    this.offset += 8;
    return 0;
};

CheckedInputStream.prototype.skipFloat64 = function() {
    this.boundsCheck(this.offset + 8);
    this.offset += 8;
};

CheckedInputStream.prototype.reset = function (buf) {
    this.buffer = buf;
    this.offset = 0;
    this.byteLength = buf.length;
};

