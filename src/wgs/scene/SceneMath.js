
import * as THREE from "three";


const normals = [
	new THREE.Vector3(1, 0, 0),
	new THREE.Vector3(0, 1, 0),
	new THREE.Vector3(0, 0, 1),
	new THREE.Vector3(-1, 0, 0),
	new THREE.Vector3(0, -1, 0),
	new THREE.Vector3(0, 0, -1)
];

let plane = new THREE.Plane();
const tmpTarget = new THREE.Vector3();

// Returns an array of vector4 values that describe the cutplanes needed to apply a given sectionBox
function box2CutPlanes(box, transform) {

	let planeVecs = [];

    for (let i=0; i<normals.length; i++) {

        plane.normal.copy(normals[i]);
        const onPlane  = (i < 3 ? box.max : box.min);
        plane.constant = -plane.normal.dot(onPlane);

        if (transform) {
            plane.applyMatrix4(transform);
        }

        planeVecs.push(new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant));
    }

    return planeVecs;
}

// Compute pixels per unit parameter for 2D materials.
//  @param {Camera}  camera
//  @param {bool}    is2d
//  @param {Box3}    worldBox      - worldBox of all visible geometry
//  @param {number}  deviceHeight  - canvas height * pixelRatio
//  @param {Vector4} [cutPlane]    - Optional: A cutplane in 3D containg 2D geometry. If specified, its camera distance is
//                                   considered to determine pixelsPerUnit.
//  @param {Vector3} [modelBox]    - Only for 2D: The min-plane of this box is assumed as ground plane
function getPixelsPerUnit(camera, is2d, worldBox, deviceHeight, cutPlane, modelBox) {
    if (!camera.isPerspective) {
        // Since tan(fov/2) = 0.5 for orthographic camera, the equation can be simplified here
        return deviceHeight / camera.orthoScale;
    }

    let pt = worldBox.getCenter(new THREE.Vector3());
    let distance;
    if (is2d) {
        if (modelBox) {
            // If the modelBox was passed it makes more sense to base the scale on the
            // distance of the camera to the nearest part of the world bounding box
            distance = Math.sqrt(pointToBoxDistance2(camera.position, modelBox));
        } else {
            //Here we base pixel scale on the point at the center of the view.
            const worldUp = 'z'; // in 2d, world-up is always Z
            const ray = new THREE.Vector3(0, 0, 1);
            const groundPt = intersectGroundViewport(ray, camera, worldUp);

            // Can be null in the degenerate case (camera direction parallel to the ground plane)
            if (groundPt) {
                pt = groundPt;
            }
            distance = camera.position.distanceTo(pt);
        }
    } else {
        if (cutPlane) {
            const p = cutPlane;

            const dir = camera.target.clone().sub(camera.position).normalize();
            const denominator = dir.dot(p);

            if (denominator !== 0) {
                const t = -(camera.position.clone().dot(p) + p.w) / denominator;
                pt = worldBox.clampPoint(dir.multiplyScalar(t).add(camera.position), pt);
            }
        }

        distance = camera.position.distanceTo(pt);
    }

    return deviceHeight / (2 * distance * Math.tan(THREE.Math.degToRad(camera.fov * 0.5)));
}

// Note: The camera world matrix must be up-to-date
//  @param {Vec3d}  vpVec         - ray direction in viewport coords
//  @param {Camera} camera
//  @param {string} worldUp       - main axis of up-vector, i.e., "x", "y", or "z".
//  @param {Box3}   modelBox      - Used to derive min-elevation (where ground is assumed)
function intersectGroundViewport(vpVec, camera, worldUpName, modelBox) {

    var vector = vpVec;

    // set two vectors with opposing z values
    vector.z = -1.0;
    var end = new THREE.Vector3( vector.x, vector.y, 1.0 );
    vector = vector.unproject( camera );
    end = end.unproject( camera );

    // find direction from vector to end
    end.sub( vector ).normalize();

    var dir = end;

    //Is the direction parallel to the ground plane?
    //Then we fail.
    if (Math.abs(dir[worldUpName]) < 1e-6)
        return null;

    var rayOrigin;
    if (camera.isPerspective) {
        rayOrigin = camera.position;
    } else {
        rayOrigin = vector;
    }

    var baseElev = modelBox ? modelBox.min[worldUpName] : 0;
    var distance = (baseElev - rayOrigin[worldUpName]) / dir[worldUpName];

    //2D drawing, intersect the plane
    dir.multiplyScalar(distance);
    dir.add(rayOrigin);

    return dir;
}


/**
 * Returns a new matrix that transforms points from the loaded 2D model
 * into a normalized coordinate space [0..1].
 *
 * @param {THREE.Box3} bbox - Optional - Compute the normalizing matrix according to the given bounding box.
 *
 * @returns {THREE.Matrix4}
 * @private
 */
function getNormalizingMatrix(model, bbox) {

	bbox = bbox || model.getData().bbox;

	var trans = new THREE.Matrix4();
	trans.makeTranslation(-bbox.min.x, -bbox.min.y, -bbox.min.z);

	var delta = new THREE.Vector3(0,0,0).subVectors(bbox.max, bbox.min);
	var scale = new THREE.Matrix4();
	scale.makeScale(1/delta.x, 1/delta.y, 1);

	var res = new THREE.Matrix4();
	res.multiplyMatrices(scale, trans);
	return res;
}


// @param {THREE.Vector3} p
// @param {THREE.Vector3} bboxMin
// @param {THREE.Vector3} bboxMax
// @returns {Number} Squared distance of the bbox to p
function pointToMinMaxBoxDistance2(p, boxMin, boxMax) {

    // compute the point within bbox that is nearest to p by clamping against box
    var nearest = p.clone();
    nearest.max(boxMin);
    nearest.min(boxMax);

    // return squared length of the difference vector
    return nearest.distanceToSquared(p);
}

// @param {THREE.Vector3} p
// @param {THREE.Box3} bboxMin
// @returns {Number} Squared distance of the bbox to p
function pointToBoxDistance2(p, box) {
    return pointToMinMaxBoxDistance2(p, box.min, box.max);
}

export let SceneMath = {
    box2CutPlanes,
    getPixelsPerUnit,
    intersectGroundViewport,
    getNormalizingMatrix,
    pointToMinMaxBoxDistance2,
    pointToBoxDistance2,
};
