const createEllipticalCurveData = (
  center,
  majorAxis,
  minorAxis,
  tiltInRadians,
  startInRadians,
  endInRadians,
  dbId
) => ({
  ellipse: {
    center,
    majorAxis,
    minorAxis,
    tiltInRadians
  },
  startInRadians,
  endInRadians,
  dbId
});

const createCircularCurveData = (
  center,
  radius,
  startInRadians,
  endInRadians,
  dbId
) => ({
  type: "circularCurve",
  circle: {
    center,
    radius
  },
  startInRadians,
  endInRadians,
  dbId
});

const createPolyLineData = (vertices, fillColor, dbId) => ({
  type: "polyLine",
  vertices,
  fillColor,
  dbId
});

const createTriangleData = ([point1, point2, point3], dbId) => ({
  type: "triangle",
  point1,
  point2,
  point3,
  dbId
});

const createLineSegmentData = (from, to, dbId) => ({
  type: "lineSegment",
  from,
  to,
  dbId
});

export class GeometryBuilder {
  constructor() {
    this.numPolyLine = 0;
    this.numEllipticals = 0;
    this.numCirculars = 0;
    this.numSegments = 0;
    this.geometries = [];
  }

  addPolyLine(flatPoints, fillColor, dbId) {
    
    this.numPolyLine++;
    const count = flatPoints.length / 2;
    const points = [];
    for (let i = 0; i < count; i++) {
      points.push({ x: flatPoints[2 * i], y: flatPoints[2 * i + 1] });
    }
    const polyLine = createPolyLineData(points, fillColor, dbId);
    this.geometries.push(polyLine);
  }

  addSegment(to, from, dbId) {
    this.numSegments++;
    const lineSegment = createLineSegmentData(to, from, dbId);
    this.geometries.push(lineSegment);
  }

  addCircularArc(cx, cy, radius, start, end, dbId) {
    this.numCirculars++;

    const circularArc = createCircularCurveData(
      [cx, cy],
      radius,
      start,
      end,
      dbId
    );
    this.geometries.push(circularArc);
  }

  addEllipticalArc(cx, cy, start, end, majorRadius, minorRadius, dbId) {
    this.numEllipticals++;
    const circularArc = createEllipticalCurveData(
      [cx, cy],
      majorRadius,
      minorRadius,
      start,
      end,
      dbId
    );
    this.geometries.push(circularArc);
  }
}
