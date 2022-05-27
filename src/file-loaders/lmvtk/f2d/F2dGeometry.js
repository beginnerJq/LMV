import { GeometryBuilder } from "./GeometryBuilder";
import { InputStream } from "../common/InputStream";
import { logger } from "../../../logger/Logger";
import { errorCodeString, ErrorCodes } from "../../net/ErrorCodes";
import { F2dDataType, F2dSemanticType, restoreSignBitFromLSB } from "./F2d";

export class F2DGeometry {
  constructor(metadata, options) {
    this.metadata = metadata;
    this.scaleX = 1;
    this.scaleY = 1;
    this.bbox = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    this.fillColor = null;
    if (metadata) {
      const dimensions = metadata.page_dimensions;
      this.setScale(dimensions);
    }

    this.excludeTextGeometry = options.excludeTextGeometry || true;

    this.dbId = 0;
    this.maxDbId = 0;

    this.geometry = new GeometryBuilder();

    // Newly added f2d pasing stuff.
    this.error = false;

    // Last absolute positions of point parsed so far.
    // Used to decode relative positions parsed from points array.
    this.offsetX = 0;
    this.offsetY = 0;
  }

  setScale(dims) {
    this.paperWidth = dims.page_width;
    this.paperHeight = dims.page_height;

    // TODO: scale parsing.
    this.scaleX = this.paperWidth / dims.plot_width;
    this.scaleY = this.paperHeight / dims.plot_height;
  }

  load(loadContext, fydoPack) {
    if (!(fydoPack instanceof Uint8Array)) fydoPack = new Uint8Array(fydoPack);
    this.data = fydoPack;
    this.parse();

    loadContext.loadDoneCB(true);
  }

  loadFrames(loadContext) {
    this.loadContext = loadContext;

    let data = loadContext.data;

    if (data) {
      if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
      this.data = data;
    } else if (loadContext.finalFrame) {
      this.data = null;
    }

    this.probeFrames(loadContext.finalFrame);

    loadContext.loadDoneCB(true);
  }

  sx(x) {
    //TODO: The hardcoded scale is used to get the integer coords from FYDO
    //into something normal and close to page coordinates
    return x * this.scaleX;
  }

  sy(y) {
    //TODO: The hardcoded scale is used to get the integer coords from FYDO
    //into something normal and close to page coordinates
    return y * this.scaleY;
  }

  // ====================== F2D Parser ================================= //

  parserAssert(actualType, expectedType, functionName) {
    if (actualType != expectedType) {
      logger.warn(
        "Expect " +
          expectedType +
          "; actual type is " +
          actualType +
          "; in function " +
          functionName
      );
      this.error = true;
      return true;
    } else {
      return false;
    }
  }

  parseDataType() {
    const data_type = this.stream.getVarints();
    switch (data_type) {
      case F2dDataType.dt_void:
        this.parseVoid();
        break;
      case F2dDataType.dt_int:
        this.parseInt();
        break;
      case F2dDataType.dt_object:
        this.parseObject();
        break;
      case F2dDataType.dt_varint:
        this.parseVarint();
        break;
      case F2dDataType.dt_point_varint:
        this.parsePoint();
        break;
      case F2dDataType.dt_float:
        this.parseFloat();
        break;
      case F2dDataType.dt_point_varint_array:
        this.parsePointsArray();
        break;
      case F2dDataType.dt_circular_arc:
        this.parseCircularArc();
        break;
      case F2dDataType.dt_circle:
        this.parseCircle();
        break;
      case F2dDataType.dt_arc:
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
  }

  readHeader() {
    const stream = (this.stream = new InputStream(this.data));

    // "F2D"
    const header = stream.getString(3);

    if (header !== "F2D") {
      logger.error(
        "Invalid F2D header : " + header,
        errorCodeString(ErrorCodes.BAD_DATA)
      );
      return false;
    }

    const versionMajor = stream.getString(2);
    if (versionMajor !== "01") {
      logger.error(
        "Only support f2d major version 1; actual version is : " + versionMajor,
        errorCodeString(ErrorCodes.BAD_DATA)
      );
      return false;
    }

    const dot = stream.getString(1);
    if (dot !== ".") {
      logger.error(
        "Invalid version delimiter.",
        errorCodeString(ErrorCodes.BAD_DATA)
      );
      return false;
    }

    const versionMinor = stream.getString(2);
    return true;
  }

  probe() {
    const stream = this.stream;
    this.error = false;

    try {
      while (stream.offset < stream.byteLength) {
        this.parseDataType();
        if (this.error) {
          break;
        }
      }
    } catch (exc) {
      // Typically caused by out of bounds access of data.
      const message = exc.toString();
      const stack = exc.stack ? exc.stack.toString() : "...";

      // Don't panic with this - we are supposed to hit out of bounds a couple of times when probing.
      logger.error(
        "Error in F2DProbe.prototype.probe : " +
          message +
          " with stack : " +
          stack
      );
    }
  }

  parse() {
    // Read and check header
    if (!this.readHeader()) return;
    this.probe();
  }

  parseFrames() {
    if (this.data) {
      this.stream = new InputStream(this.data);
      this.probe();
    }

    this.stream = null;
    this.data = null;
  }

  // === Parse Geometry === //

  parsePointPositions() {
    let x = this.stream.getVarints();
    let y = this.stream.getVarints();

    x = restoreSignBitFromLSB(x);
    y = restoreSignBitFromLSB(y);

    x += this.offsetX;
    y += this.offsetY;

    this.offsetX = x;
    this.offsetY = y;

    return [this.sx(x), this.sy(y)];
  }

  parseObject() {
    this.stream.getVarints();
  }

  parseString() {
    const s = this.stream;
    s.getVarints(); //skip past the semantics

    const len = s.getVarints();
    return s.getString(len);
  }

  parsePoint() {
    const s = this.stream;
    s.getVarints(); //skip past the semantics
    this.parsePointPositions();
  }

  parsePointsArray() {
    const s = this.stream;
    const sema = s.getVarints();

    let count = s.getVarints(); // number of coordinates * 2
    if (!count) return;
    count = count / 2;

    const ret = [];
    let position;

    for (let i = 0; i < count; ++i) {
      position = this.parsePointPositions();
      ret.push(position[0]);
      ret.push(position[1]);
    }

    switch (sema) {
      case F2dSemanticType.st_polyline:
        this.actOnPolylinePointsArray(ret);
        return;
      case F2dSemanticType.st_dot:
        this.actOnDot(ret[0], ret[1]);
        return;
      default:
        logger.info("Unexpected opcode semantic type for points array.");
        break;
    }
  }

  parseArray(getFunction) {
    const s = this.stream;
    s.getVarints();
    const count = s.getVarints(); // total number of elements in integer array.

    for (let i = 0; i < count; ++i) {
      getFunction();
    }
  }

  parseIntArray() {
    const s = this.stream;
    this.parseArray(s.getUint32.bind(s));
  }

  parseDoubleArray() {
    const s = this.stream;
    this.parseArray(s.getFloat64.bind(s));
  }

  parseByteArray() {
    const s = this.stream;
    this.parseArray(s.getUint8.bind(s));
  }

  parseVarintArray() {
    const s = this.stream;
    this.parseArray(s.getVarints.bind(s));
  }

  parseInt() {
    const sema = this.stream.getVarints();
    const val = this.stream.getUint32();
    switch (sema) {
      case F2dSemanticType.st_fill:
        this.fillColor = val;
        break;
    }

    return val;
  }

  parseFloat() {
    this.stream.getVarints();
    this.stream.getFloat32();
  }

  parseVoid() {
    var sema = this.stream.getVarints();
    switch (sema) {
      case F2dSemanticType.st_fill_off:
        this.fillColor = null;
        break;
    }
  }

  parseVarint() {
    const s = this.stream;
    const semantic_type = s.getVarints();
    const val = s.getVarints();

    switch (semantic_type) {
      case F2dSemanticType.st_object_id:
      case F2dSemanticType.st_markup_id:
        this.dbId = val;
        this.maxDbId = Math.max(this.maxDbId, val);
        break;
      default:
        break;
    }
  }

  parseCircularArc() {
    const s = this.stream;
    const sema = s.getVarints();
    if (this.parserAssert(sema, F2dSemanticType.st_arc, "parseCircularArc"))
      return;

    const point = this.parsePointPositions();
    const major = s.getVarints();
    const start = s.getFloat32();
    const end = s.getFloat32();

    this.actOnCircularArc(point[0], point[1], start, end, this.sx(major));
  }

  parseCircle() {
    const s = this.stream;
    const sema = s.getVarints();
    if (this.parserAssert(sema, F2dSemanticType.st_arc, "parseCircle")) return;

    const point = this.parsePointPositions();
    const major = s.getVarints();

    this.actOnCompleteCircle(point[0], point[1], this.sx(major));
  }

  parseArc() {
    const s = this.stream;
    const sema = s.getVarints();
    if (this.parserAssert(sema, F2dSemanticType.st_arc, "parseArc")) return;

    // Relative positions.
    const point = this.parsePointPositions();

    const major = s.getVarints();
    const minor = s.getVarints();

    const rotation = s.getFloat32();
    const start = s.getFloat32();
    const end = s.getFloat32();

    this.actOnArc(
      point[0],
      point[1],
      start,
      end,
      this.sx(major),
      this.sy(minor),
      rotation
    );
  }

  // ================= Semantic Analysis Pass ======================//
  actOnPolylinePointsArray(points) {
    this.geometry.addPolyLine(points, this.fillColor, this.dbId);
  }

  actOnDot(x, y) {
    this.actOnCompleteCircle(x, y, this.sx(1));
  }

  actOnCompleteCircle(cx, cy, radius) {
    // Relative positions.
    this.geometry.addCircularArc(
      cx,
      cy,
      /*major*/ radius,
      0,
      2 * Math.PI,
      this.dbId
    );
  }

  actOnCircularArc(cx, cy, start, end, radius) {
    this.geometry.addCircularArc(
      cx,
      cy,
      /*major*/ radius,
      start,
      end,
      this.dbId
    );
  }

  actOnArc(cx, cy, start, end, major, minor) {
    this.geometry.addEllipticalArc(cx, cy, start, end, major, minor, this.dbId);
  }

  actOnPolyTriangle() {
    logger.warn("Polytriangles not currently supported.");
    return;
  }
}
