
"use strict";

import { CheckedInputStream} from "./CheckedInputStream";
import { F2dDataType, F2dSemanticType } from "./F2d";
import { errorCodeString, ErrorCodes } from "../../net/ErrorCodes";
import { logger} from "../../../logger/Logger";

export function F2DProbe() {
    this.data = null;
    this.frameStart = 0;
    this.frameEnd = 0;
    this.stream = null;
    this.opCount = 0;
    this.marker = {frameStart : this.frameStart,
                   frameEnd : this.frameEnd};
}

F2DProbe.prototype.load = function(data) {
    this.data = data;
    this.frameStart = 0;

    if (!this.stream) {
        this.stream = new CheckedInputStream(this.data);
        // Skip headers.
        this.stream.seek(8);
        this.frameStart = 8;
        this.frameEnd = 8;
    }
    else {
        this.stream.reset(this.data);
        this.stream.seek(0);
        this.frameEnd = 0;
    }

    this.probe();
    this.marker.frameStart = this.frameStart;
    this.marker.frameEnd = this.frameEnd;
    return this.marker;
};

var F2dProbeDataType = F2dDataType;
var F2dProbeSemanticType = F2dSemanticType;

F2DProbe.prototype.readColor = function() {
    var s = this.stream;
    s.getVarints();// data type : dt_int 3
    s.getVarints(); // semantic type : st_object_member 0
    s.skipUint32(); // color
};

F2DProbe.prototype.parsePointPositions = function() {
    this.stream.getVarints();
    this.stream.getVarints();
};

F2DProbe.prototype.unhandledTypeWarning = function(inFunction, semanticType) {
    logger.warn("Unhandled semantic type when probing F2d : " + semanticType + " in function " + inFunction);
};

F2DProbe.prototype.parseObject = function() {
    /*var semantic_type =*/ this.stream.getVarints();
    //debug("object parsing : type" + semantic_type);
};


F2DProbe.prototype.parseString = function() {
    var s = this.stream;
    s.getVarints();
    var len = s.getVarints();
    s.skipBytes(len);
};

F2DProbe.prototype.parsePoint = function() {
    this.stream.getVarints();
    this.parsePointPositions();
};

F2DProbe.prototype.parseVarintArray = function() {
    var s = this.stream;
    s.getVarints();

    var count = s.getVarints();
    for (var i = 0; i < count; ++i)
        s.getVarints();
};

F2DProbe.prototype.parseByteArray = function() {
    var s = this.stream;
    s.getVarints();
    var count = s.getVarints();
    s.skipBytes(count);
};

F2DProbe.prototype.parseEndOfObject = function() {
    var s = this.stream;
    s.getVarints();
    s.getVarints();
};

F2DProbe.prototype.parsePointsArray = function(context) {
    var s = this.stream;
    var sema = s.getVarints();
    var count = s.getVarints(); // number of coordinates * 2
    if (!count) return;
    count = count / 2;
    for (var i = 0; i < count; ++i)
        this.parsePointPositions();
};

F2DProbe.prototype.parsePoint = function(context) {
    var s = this.stream;
    var sema = s.getVarints();
    this.parsePointPositions();
};

F2DProbe.prototype.parseInt = function() {
    var s = this.stream;
    var sema = s.getVarints();

    switch (sema) {
        case F2dProbeSemanticType.st_color:
            s.skipUint32();
            break;
        case F2dProbeSemanticType.st_fill: {
            s.skipUint32();
            break;
        }
        default:
            s.skipUint32();
            this.unhandledTypeWarning('parseInt', sema);
            break;
    }
};

F2DProbe.prototype.parseVoid = function() {
    var sema = this.stream.getVarints();
    switch (sema) {
        case F2dProbeSemanticType.st_fill_off:
            break;
        default:
            this.unhandledTypeWarning('parseVoid', sema);
            break;
    }
};

F2DProbe.prototype.parseVarint = function() {
    this.stream.getVarints();
    this.stream.getVarints();
};

F2DProbe.prototype.parseIntArray = function() {
    var s = this.stream;
    s.getVarints();
    var count = s.getVarints();
    for (var i = 0; i < count; ++i)
        s.skipUint32();
};

F2DProbe.prototype.parseFloat = function() {
    var s = this.stream;
    s.getVarints();
    s.getFloat32();
};

F2DProbe.prototype.parseDoubleArray = function() {
    var s = this.stream;
    s.getVarints();
    var count = s.getVarints();
    for (var i = 0; i < count; ++i)
        s.skipFloat64();
};

F2DProbe.prototype.parseCircularArc = function() {
    var s = this.stream;
    s.getVarints();
    this.parsePointPositions();
    s.getVarints();
    s.getFloat32();
    s.getFloat32();
};

F2DProbe.prototype.parseCircle = function() {
    var s = this.stream;
    s.getVarints();
    this.parsePointPositions();
    s.getVarints();
};

F2DProbe.prototype.parseArc = function() {
    var s = this.stream;
    s.getVarints();
    this.parsePointPositions();
    s.getVarints();
    s.getVarints();
    s.getFloat32();
    s.getFloat32();
    s.getFloat32();
};

F2DProbe.prototype.parseDataType = function() {
    var data_type = this.stream.getVarints();

    switch (data_type) {
        case F2dProbeDataType.dt_void:
            this.parseVoid();
            break;
        case F2dProbeDataType.dt_int :
            this.parseInt();
            break;
        case F2dProbeDataType.dt_object :
            this.parseObject();
            break;
        case F2dProbeDataType.dt_varint :
            this.parseVarint();
            break;
        case F2dProbeDataType.dt_float :
            this.parseFloat();
            break;
        case F2dProbeDataType.dt_point_varint :
            this.parsePoint();
            break;
        case F2dProbeDataType.dt_point_varint_array :
            this.parsePointsArray();
            break;
        case F2dProbeDataType.dt_circular_arc :
            this.parseCircularArc();
            break;
        case F2dProbeDataType.dt_circle :
            this.parseCircle();
            break;
        case F2dProbeDataType.dt_arc :
            this.parseArc();
            break;
        case F2dProbeDataType.dt_varint_array:
            this.parseVarintArray();
            break;
        case F2dProbeDataType.dt_int_array:
            this.parseIntArray();
            break;
        case F2dProbeDataType.dt_byte_array:
            this.parseByteArray();
            break;
        case F2dProbeDataType.dt_string:
            this.parseString();
            break;
        case F2dProbeDataType.dt_double_array:
            this.parseDoubleArray();
            break;
        default:
            this.error = true;
            logger.error("Bad op code encountered : " + data_type + " , bail out.", errorCodeString(ErrorCodes.BAD_DATA));
            break;
    }

    if (!this.error)
        this.frameEnd = this.stream.offset;
};

F2DProbe.prototype.probe = function() {
    var stream = this.stream;
    var error = false;

    try {
        while (stream.offset < stream.byteLength) {
            this.parseDataType();
            if (this.error) {
                break;
            }
            this.opCount++;
        }
    } catch (exc) {
        // Typically caused by out of bounds access of data.
        var message = exc.toString();
        var stack = exc.stack ? exc.stack.toString() : "...";

        // Don't panic with this - we are supposed to hit out of bounds a couple of times when probing.
        //debug("Error in F2DProbe.prototype.probe : " + message + " with stack : " + stack);
    }
};

