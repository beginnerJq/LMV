
import { SnapType } from "./SnapTypes";

/**
 * Encapsulates the result of a Snap operation performed by the {@link Snapper}.
 *
 * @memberof Autodesk.Viewing.MeasureCommon
 * @alias Autodesk.Viewing.MeasureCommon.SnapResult
 *
 * @class
 * @class
 */
export function SnapResult() {
    this.clear();
}

/**
 * Resets the object to its non-snapping state.
 *
 * @alias Autodesk.Viewing.MeasureCommon.SnapResult#clear
 */
SnapResult.prototype.clear = function() {
    
    this.geomType = null;    // int, such as { "NONE: -1", "VERTEX": 0, "EDGE": 1, "FACE": 2, ... }
    this.modelId = null;               // string, model's internal id. null when snapping to overlay geometry.
    this.snapNode = null;              // int, the dbId
    this.geomVertex = null;            // THREE.Vector3
    this.geomEdge = null;              // THREE.Geometry
    this.geomFace = null;              // THREE.Geometry
    this.radius = null;                // Number
    this.intersectPoint = null;        // THREE.Vector3
    this.faceNormal = null;            // THREE.Vector3
    this.viewportIndex2d = null;       // int
    this.circularArcCenter = null;
    this.circularArcRadius = null;
    this.fromTopology = false;
    this.isPerpendicular = false;
    this.snapPoint = null;
};

/**
 * Copies the current state of the object into another.
 *
 * @param {SnapResult} destiny - target for the copy operation.
 *
 * @alias Autodesk.Viewing.MeasureCommon.SnapResult#copyTo
 */
SnapResult.prototype.copyTo = function(destiny) {
    // Shallow copies of THREE objects should be fine.
    destiny.modelId = this.modelId;
    destiny.snapNode = this.snapNode;
    destiny.geomVertex = this.geomVertex;
    destiny.geomFace = this.geomFace;
    destiny.geomEdge = this.geomEdge;
    destiny.radius = this.radius;
    destiny.geomType = this.geomType;
    destiny.intersectPoint = this.intersectPoint;
    destiny.faceNormal = this.faceNormal;
    destiny.viewportIndex2d = this.viewportIndex2d;
    destiny.circularArcCenter = this.circularArcCenter;
    destiny.circularArcRadius = this.circularArcRadius;
    destiny.fromTopology = this.fromTopology;
    destiny.isPerpendicular = this.isPerpendicular;
    destiny.snapPoint = this.snapPoint;
};

/**
 * Creates a new instance and copies the current state into it.
 *
 * @returns {SnapResult}
 *
 * @alias Autodesk.Viewing.MeasureCommon.SnapResult#clone
 */
SnapResult.prototype.clone = function() {
    var theClone = new SnapResult();
    this.copyTo(theClone);
    return theClone;
};

/**
 * @returns {boolean} true only when snapping information is available.
 *
 * @alias Autodesk.Viewing.MeasureCommon.SnapResult#isEmpty
 */
SnapResult.prototype.isEmpty = function() {
    return !this.getGeometry();
};

let tmpMatrix = null;
let tmpVec1 = null;
let tmpVec2 = null;

// Note that we assume here that matrix preserves spheres. Otherwise, transforming lengths is not possible
const transformRadius = (radius, matrix) => {
    tmpVec1 = tmpVec1 || new THREE.Vector3();
    tmpVec2 = tmpVec2 || new THREE.Vector3();

    tmpVec1.set(0,0,0);
    tmpVec2.set(radius,0,0);
    
    // transform both vectors
    tmpVec1.applyMatrix4(matrix);
    tmpVec2.applyMatrix4(matrix);

    return tmpVec1.distanceTo(tmpVec2);
};

// Transform SnapResult to another coordinate system. 
//
// Note that we assume matrix to preserve spheres, which works for a composition of translation, uniform scaling, and rotation.
SnapResult.prototype.applyMatrix4 = function(matrix) {

    // transform THREE.Geometry
    this.geomEdge && this.geomEdge.applyMatrix4(matrix);
    this.geomFace && this.geomFace.applyMatrix4(matrix);
    
    // transform points (Vector3)
    this.geomVertex && this.geomVertex.applyMatrix4(matrix);
    this.intersectPoint && this.intersectPoint.applyMatrix4(matrix);
    this.circularArcCenter && this.circularArcCenter.applyMatrix4(matrix);
    this.snapPoint && this.snapPoint.applyMatrix4(matrix);

    // transform normal
    if (this.faceNormal) {
        tmpMatrix = tmpMatrix || new THREE.Matrix4();
        const normalMatrix = tmpMatrix.getNormalMatrix(matrix);
        this.faceNormal.applyMatrix4(normalMatrix);
    }

    // Transform radii
    this.radius = transformRadius(this.radius, matrix);
    this.circularArcRadius = transformRadius(this.circularArcRadius, matrix);
};

/**
 * Gets the snapped face, when available.
 *
 * @alias Autodesk.Viewing.MeasureCommon.SnapResult#getFace
 */
SnapResult.prototype.getFace = function() {
    return this.geomFace;
};

/**
 * Gets the snapped edge, when available.
 *
 * @alias Autodesk.Viewing.MeasureCommon.SnapResult#getEdge
 */
SnapResult.prototype.getEdge = function() {
    return this.geomEdge;
};

/**
 * Gets the snapped vertex, when available.
 *
 * @alias Autodesk.Viewing.MeasureCommon.SnapResult#getVertex
 */
SnapResult.prototype.getVertex = function() {
    return this.geomVertex;
};

/**
 * Gets the snapped element, which differs depending on what kind of
 * element it was snapped to, see {@link SnapType}.
 *
 * @alias Autodesk.Viewing.MeasureCommon.SnapResult#getGeometry
 */
SnapResult.prototype.getGeometry = function() {

    switch (this.geomType) {
        case SnapType.SNAP_VERTEX: return this.geomVertex;
        case SnapType.SNAP_MIDPOINT: return this.geomVertex;
        case SnapType.SNAP_INTERSECTION: return this.geomVertex;
        case SnapType.SNAP_CIRCLE_CENTER: return this.geomVertex;
        case SnapType.RASTER_PIXEL: return this.geomVertex;
        case SnapType.SNAP_EDGE: return this.geomEdge;
        case SnapType.SNAP_FACE: return this.geomFace;
        case SnapType.SNAP_CIRCULARARC: return this.geomEdge;
        case SnapType.SNAP_CURVEDEDGE: return this.geomEdge;
        case SnapType.SNAP_CURVEDFACE: return this.geomFace;
        default: break;
    }
    return null;
};

/**
 * @param type
 * @param geometry
 * @private
 */
SnapResult.prototype.setGeometry = function(type, geometry) {

    switch (type) {
        case SnapType.SNAP_VERTEX:          this.geomVertex = geometry; break;
        case SnapType.SNAP_MIDPOINT:        this.geomVertex = geometry; break;
        case SnapType.SNAP_INTERSECTION:    this.geomVertex = geometry; break;
        case SnapType.SNAP_CIRCLE_CENTER:   this.geomVertex = geometry; break;
        case SnapType.RASTER_PIXEL:         this.geomVertex = geometry; break;
        case SnapType.SNAP_EDGE:            this.geomEdge = geometry; break;
        case SnapType.SNAP_FACE:            this.geomFace = geometry; break;
        case SnapType.SNAP_CIRCULARARC:     this.geomEdge = geometry; break;
        case SnapType.SNAP_CURVEDEDGE:      this.geomEdge = geometry; break;
        case SnapType.SNAP_CURVEDFACE:      this.geomFace = geometry; break;
        default: return;
    }
    this.geomType = type;
};

