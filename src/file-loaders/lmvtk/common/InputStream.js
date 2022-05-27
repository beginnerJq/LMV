import { utf8ArrayToString } from './StringUtils';

"use strict";

//We will use these shared memory arrays to
//convert from bytes to the desired data type.
var convBuf = new ArrayBuffer(8);
var convUint8 = new Uint8Array(convBuf);
var convUint16 = new Uint16Array(convBuf);
var convInt32 = new Int32Array(convBuf);
var convUint32 = new Uint32Array(convBuf);
var convFloat32 = new Float32Array(convBuf);
var convFloat64 = new Float64Array(convBuf);


/** @constructor */
export function InputStream(buf) {
    this.buffer = buf;
    this.offset = 0;
    this.byteLength = buf.length;
}


InputStream.prototype.seek = function(off) {
    this.offset = off;
};

InputStream.prototype.getBytes = function(len) {
    var ret = new Uint8Array(this.buffer.buffer, this.offset, len);
    this.offset += len;
    return ret;
};

InputStream.prototype.getVarints = function () {
    var b;
    var value = 0;
    var shiftBy = 0;
    do {
        b = this.buffer[this.offset++];
        value |= (b & 0x7f) << shiftBy;
        shiftBy += 7;
    } while (b & 0x80);
    return value;
};

InputStream.prototype.getUint8 = function() {
    return this.buffer[this.offset++];
};

InputStream.prototype.getUint16 = function() {
    convUint8[0] = this.buffer[this.offset++];
    convUint8[1] = this.buffer[this.offset++];
    return convUint16[0];
};

InputStream.prototype.getInt16 = function() {
    var tmp = this.getUint16();
    //make negative integer if the ushort is negative
    if (tmp > 0x7fff)
        tmp = tmp | 0xffff0000;
    return tmp;
};

InputStream.prototype.getInt32 = function() {
    var src = this.buffer;
    var dst = convUint8;
    var off = this.offset;
    dst[0] = src[off];
    dst[1] = src[off+1];
    dst[2] = src[off+2];
    dst[3] = src[off+3];
    this.offset += 4;
    return convInt32[0];
};

InputStream.prototype.getUint32 = function() {
    var src = this.buffer;
    var dst = convUint8;
    var off = this.offset;
    dst[0] = src[off];
    dst[1] = src[off+1];
    dst[2] = src[off+2];
    dst[3] = src[off+3];
    this.offset += 4;
    return convUint32[0];
};

InputStream.prototype.getFloat32 = function() {
    var src = this.buffer;
    var dst = convUint8;
    var off = this.offset;
    dst[0] = src[off];
    dst[1] = src[off+1];
    dst[2] = src[off+2];
    dst[3] = src[off+3];
    this.offset += 4;
    return convFloat32[0];
};

//Specialized copy which copies 4 byte integers into 2-byte target.
//Used for downcasting OCTM int32 index buffers to int16 index buffers,
//in cases we know we don't need more (LMVTK guarantees 2 byte indices).
InputStream.prototype.getIndicesArray = function(buffer, offset, numItems) {

    var src = this.buffer;
    var dst = new Uint8Array(buffer, offset, numItems*2);
    var off = this.offset;

    for (var i= 0, iEnd=numItems*2; i<iEnd; i+=2) {
        dst[i] = src[off];
        dst[i+1] = src[off+1];
        off += 4;
    }

    this.offset = off;
};

InputStream.prototype.getVector3Array = function(arr, numItems, startOffset, stride) {
    var src = this.buffer;
    var off = this.offset;

    //We cannot use Float32Array copying here because the
    //source stream is out of alignment
    var dst = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);

    if (stride === 3 && startOffset === 0) {
        var len = numItems*12;
        dst.set(src.subarray(off, off+len));
        this.offset += len;
    } else {

        stride *= 4;
        var aoff = startOffset * 4;
        for (var i=0; i<numItems; i++) {
            for (var j=0; j<12; j++) {
                dst[aoff+j] = src[off++];
            }
            aoff += stride;
        }

        this.offset = off;
    }
};

InputStream.prototype.getVector2Array = function(arr, numItems, startOffset, stride) {
    var src = this.buffer;
    var dst = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    var off = this.offset;

    stride *= 4;
    var aoff = startOffset * 4;
    for (var i=0; i<numItems; i++) {
        for (var j=0; j<8; j++) {
            dst[aoff+j] = src[off++];
        }
        aoff += stride;
    }

    this.offset = off;
};

InputStream.prototype.getVector4 = function(arr, offset) {
    var src = this.buffer;
    var dst = convUint8;
    var off = this.offset;
    var conv = convFloat32;

    for (var j=0; j<4; j++) {
        dst[0] = src[off];
        dst[1] = src[off+1];
        dst[2] = src[off+2];
        dst[3] = src[off+3];
        arr[offset+j] = conv[0];
        off += 4;
    }

    this.offset = off;
};

InputStream.prototype.getFloat64 = function() {
    var src = this.buffer;
    var dst = convUint8;
    var off = this.offset;
    for (var i=0; i<8; i++)
        dst[i] = src[off+i];
    this.offset += 8;
    return convFloat64[0];
};



InputStream.prototype.getString = function(len) {
    var res = utf8ArrayToString(this.buffer, this.offset, len);
    this.offset += len;
    return res;
};

InputStream.prototype.reset = function (buf) {
    this.buffer = buf;
    this.offset = 0;
    this.byteLength = buf.length;
};
