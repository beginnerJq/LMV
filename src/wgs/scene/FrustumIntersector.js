import * as THREE from 'three';

// Rearranged logically, base 3. X is 1's digit, Y is 10's digit, Z is 100's digit.
// low/medium/high value is 0/1/2. So the center of the 3x3x3 space is == 111 base 3 == 13.
            // old 64-position code, which is what the comment indices are based on
            // var pos = ((this.eye.x < box.min.x) ?  1 : 0)   // 1 = left
            //         + ((this.eye.x > box.max.x) ?  2 : 0)   // 2 = right
            //         + ((this.eye.y < box.min.y) ?  4 : 0)   // 4 = bottom
            //         + ((this.eye.y > box.max.y) ?  8 : 0)   // 8 = top
            //         + ((this.eye.z < box.min.z) ? 16 : 0)   // 16 = front
            //         + ((this.eye.z > box.max.z) ? 32 : 0);  // 32 = back
var _boxIndexList =     // [27][7]
[
    [ 1, 5, 4, 7, 3, 2,   6], //21 front, bottom, left
    [ 0, 3, 2, 1, 5, 4,   6], //20 front, bottom
    [ 0, 3, 2, 6, 5, 4,   6], //22 front, bottom, right
    [ 0, 4, 7, 3, 2, 1,   6], //17 front, left
    [ 0, 3, 2, 1,-1,-1,   4], //16 front
    [ 0, 3, 2, 6, 5, 1,   6], //18 front, right
    [ 0, 4, 7, 6, 2, 1,   6], //25 front, top, left
    [ 0, 3, 7, 6, 2, 1,   6], //24 front, top
    [ 0, 3, 7, 6, 5, 1,   6], //26 front, top, right
    [ 0, 1, 5, 4, 7, 3,   6], // 5 bottom, left
    [ 0, 1, 5, 4,-1,-1,   4], // 4 bottom
    [ 0, 1, 2, 6, 5, 4,   6], // 6 bottom, right
    [ 0, 4, 7, 3,-1,-1,   4], // 1 left
    [-1,-1,-1,-1,-1,-1,   0], // 0 inside
    [ 1, 2, 6, 5,-1,-1,   4], // 2 right
    [ 0, 4, 7, 6, 2, 3,   6], // 9 top, left 
    [ 2, 3, 7, 6,-1,-1,   4], // 8 top
    [ 1, 2, 3, 7, 6, 5,   6], //10 top, right
    [ 0, 1, 5, 6, 7, 3,   6], //37 back, bottom, left
    [ 0, 1, 5, 6, 7, 4,   6], //36 back, bottom
    [ 0, 1, 2, 6, 7, 4,   6], //38 back, bottom, right
    [ 0, 4, 5, 6, 7, 3,   6], //33 back, left
    [ 4, 5, 6, 7,-1,-1,   4], //32 back
    [ 1, 2, 6, 7, 4, 5,   6], //34 back, right
    [ 0, 4, 5, 6, 2, 3,   6], //41 back, top, left
    [ 2, 3, 7, 4, 5, 6,   6], //40 back, top
    [ 1, 2, 3, 7, 4, 5,   6] //42 back, top, right
];

//Encapsulates frustum-box intersection logic
    export function FrustumIntersector() {
        this.frustum = new THREE.Frustum();
        this.viewProj = new THREE.Matrix4();
        this.viewDir = [0, 0, 1];
        this.ar = 1.0;
        this.viewport = new THREE.Vector3(1, 1, 1);
        this.areaConv = 1;
        this.areaCullThreshold = 1; // The pixel size of the object projected on screen, will be culled if less than this value.
        this.eye = new THREE.Vector3();
        this.perspective = false;    // assume orthographic camera to match viewProj
    }

    export const OUTSIDE = 0;
    export const INTERSECTS = 1;
    export const CONTAINS = 2;
    export const CONTAINMENT_UNKNOWN = -1;
    FrustumIntersector.OUTSIDE = OUTSIDE;
    FrustumIntersector.INTERSECTS = INTERSECTS;
    FrustumIntersector.CONTAINS = CONTAINS;
    FrustumIntersector.CONTAINMENT_UNKNOWN = CONTAINMENT_UNKNOWN;

    // @param {THREE.Vector4[]} [cutPlanes]
    FrustumIntersector.prototype.reset = function (camera, cutPlanes) {
        this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.perspective = camera.isPerspective;
        this.frustum.setFromProjectionMatrix(this.viewProj);
        var vm = camera.matrixWorldInverse.elements;
        this.ar = camera.aspect;
        this.viewDir[0] = -vm[2];
        this.viewDir[1] = -vm[6];
        this.viewDir[2] = -vm[10];
        this.eye.x = camera.position.x;
        this.eye.y = camera.position.y;
        this.eye.z = camera.position.z;
        this.areaConv = (camera.clientWidth * camera.clientHeight) / 4;
        this.cutPlanes = cutPlanes;
    };

    FrustumIntersector.prototype.projectedArea = (function () {

        var points = [
            new THREE.Vector3(),
            new THREE.Vector3(),
            new THREE.Vector3(),
            new THREE.Vector3(),
            new THREE.Vector3(),
            new THREE.Vector3(),
            new THREE.Vector3(),
            new THREE.Vector3()
        ];
        var tmpBox = new THREE.Box2();

        function applyProjection(p, m) {

            var x = p.x, y = p.y, z = p.z;
            var e = m.elements;

            var w = ( e[3] * x + e[7] * y + e[11] * z + e[15] );

            //This is the difference between this function and
            //the normal THREE.Vector3.applyProjection. We avoid
            //inverting the positions of points behind the camera,
            //otherwise our screen area computation can result in
            //boxes getting clipped out when they are in fact partially visible.
            if (w < 0)
                w = -w;

            var d = 1.0 / w;

            p.x = ( e[0] * x + e[4] * y + e[8] * z + e[12] ) * d;
            p.y = ( e[1] * x + e[5] * y + e[9] * z + e[13] ) * d;

            //We also don't need the Z
            //p.z = ( e[ 2 ] * x + e[ 6 ] * y + e[ 10 ] * z + e[ 14 ] ) * d;
        }

        return function (box) {

            if (box.isEmpty())
                return 0;

            var matrix = this.viewProj;

            // NOTE: I am using a binary pattern to specify all 2^3 combinations below
            points[0].set(box.min.x, box.min.y, box.min.z); // 000
            points[1].set(box.min.x, box.min.y, box.max.z); // 001
            points[2].set(box.min.x, box.max.y, box.min.z); // 010
            points[3].set(box.min.x, box.max.y, box.max.z); // 011
            points[4].set(box.max.x, box.min.y, box.min.z); // 100
            points[5].set(box.max.x, box.min.y, box.max.z); // 101
            points[6].set(box.max.x, box.max.y, box.min.z); // 110
            points[7].set(box.max.x, box.max.y, box.max.z); // 111

            for (var i = 0; i < 8; i++)
                applyProjection(points[i], matrix);

            tmpBox.makeEmpty();
            tmpBox.setFromPoints(points);

            // Clamp both min and max value between [-1.0, 1.0]
            if (tmpBox.min.x < -1.0)
                tmpBox.min.x = -1.0;
            if (tmpBox.min.x > 1.0)
                tmpBox.min.x = 1.0;
            if (tmpBox.min.y < -1.0)
                tmpBox.min.y = -1.0;
            if (tmpBox.min.y > 1.0)
                tmpBox.min.y = 1.0;

            if (tmpBox.max.x > 1.0)
                tmpBox.max.x = 1.0;
            if (tmpBox.max.x < -1.0)
                tmpBox.max.x = -1.0;
            if (tmpBox.max.y > 1.0)
                tmpBox.max.y = 1.0;
            if (tmpBox.max.y < -1.0)
                tmpBox.max.y = -1.0;

            return (tmpBox.max.x - tmpBox.min.x) * (tmpBox.max.y - tmpBox.min.y);
        };

    })();

    // A more precise estimator, based on https://github.com/erich666/jgt-code/blob/master/Volume_04/Number_2/Schmalstieg1999/bboxarea.cxx
    // Schmalstieg, Dieter, and Robert F. Tobler, "Fast Projected Area Computation for Three-Dimensional Bounding Boxes," journal of graphics tools, 4(2):37-43, 1999.
    // Note: this code assumes that the silhouette corners will all project to be in front of the viewer. We do Take
    // corrective action if this is not the case, but it's of a "well, negate the value" nature, not a true clip fix.
    // It is assumed that frustum culling has already been applied, so that such cases should be rare.
    // So, for example, a long terrain tile below the viewer may get the corners behind the viewer transformed to be some
    // semi-arbitrary corner locations in front. ProjectedArea has the same problem. Since this method is used just to get
    // a rough idea of the importance of a fragment, we don't spend a lot of time on fixing this. If a corner is detected
    // as behind the eye, we could instead return an area of 4, i.e., it fills the screen.
    FrustumIntersector.prototype.projectedBoxArea = (function () {

        var sizeClippedPolygon;

        // maximum of 6 points in silhouette, plus 4 points, one for each clip edge
        var points = [];
        var pointsSwap = [];
        for (var i = 0; i < 10; i++) {
            points.push(new THREE.Vector3());
            pointsSwap.push(new THREE.Vector3());
        }

        // TODO: same as projectedArea - should this implementation be a derived class? How to do that in javascript?
        function applyProjection(p, m) {

            var x = p.x, y = p.y, z = p.z;
            var e = m.elements;

            var w = ( e[3] * x + e[7] * y + e[11] * z + e[15] );

            //This is the difference between this function and
            //the normal THREE.Vector3.applyProjection. We avoid
            //inverting the positions of points behind the camera,
            //otherwise our screen area computation can result in
            //boxes getting clipped out when they are in fact partially visible.
            if (w < 0)
                w = -w;

            var d = 1.0 / w;

            p.x = ( e[0] * x + e[4] * y + e[8] * z + e[12] ) * d;
            p.y = ( e[1] * x + e[5] * y + e[9] * z + e[13] ) * d;

            //We also don't need the Z
            //p.z = ( e[ 2 ] * x + e[ 6 ] * y + e[ 10 ] * z + e[ 14 ] ) * d;
        }

        // Optimized to clip against -1 to 1 NDC in X and Y.
        // NOTE: this modifies the clipPolygon being passed in, as the
        // code takes four passes (for each edge of the screen) and ping-pongs
        // the data between clipPolygon (really, the "points" array) and pointsSwap, a temporary buffer.
        // Doing so saves us from having to copy data or duplicate code.
        function clip (clipPolygon, sizePolygon) {
            var polygonSource = clipPolygon;
            var polygonDest = pointsSwap;
            var polygonSwap;
            var prevPt, thisPt, prevIn, thisIn;
            var numPt,numClip;
            var newSizePolygon;

            var testInside = function (pt) {
                switch (numClip) {
                    case 0:
                        return (pt.x >= -1);
                    case 1:
                        return (pt.x <= 1);
                    case 2:
                        return (pt.y >= -1);
                    case 3:
                        return (pt.y <= 1);
                }
            };
            var savePoint = function(pt) {
                polygonDest[newSizePolygon].x = pt.x;
                polygonDest[newSizePolygon++].y = pt.y;
            };
            var saveIntersect = function() {
                var ptx,pty;
                switch (numClip) {
                    case 0:
                        ptx = -1;
                        pty = prevPt.y + (thisPt.y-prevPt.y)*(ptx-prevPt.x)/(thisPt.x-prevPt.x);
                        break;
                    case 1:
                        ptx = 1;
                        pty = prevPt.y + (thisPt.y-prevPt.y)*(ptx-prevPt.x)/(thisPt.x-prevPt.x);
                        break;
                    case 2:
                        pty = -1;
                        ptx = prevPt.x + (thisPt.x-prevPt.x)*(pty-prevPt.y)/(thisPt.y-prevPt.y);
                        break;
                    case 3:
                        pty = 1;
                        ptx = prevPt.x + (thisPt.x-prevPt.x)*(pty-prevPt.y)/(thisPt.y-prevPt.y);
                        break;
                }
                polygonDest[newSizePolygon].x = ptx;
                polygonDest[newSizePolygon++].y = pty;
            };

            // If polygon size <= 2, it will have no area, so don't care. We need this test to avoid
            // access polygonSource[-1] when size === 0.
            for (numClip = 0; (numClip < 4) && (sizePolygon>2); numClip++) {
                newSizePolygon = 0;
                prevPt = polygonSource[sizePolygon-1];
                prevIn = testInside(prevPt);
                for (numPt = 0; numPt < sizePolygon; numPt++) {
                    thisPt = polygonSource[numPt];
                    thisIn = testInside(thisPt);
                    if ( prevIn ) {
                        if ( thisIn ) {
                            // edge is entirely in - save point
                            savePoint(thisPt);
                        } else {
                            // edge is exiting - save intersection
                            saveIntersect();
                        }
                    } else {
                        // edge starts out
                        if ( thisIn ) {
                            // edge is entering - save intersection and point
                            saveIntersect();
                            savePoint(thisPt);
                        }
                        //else {
                            // edge is still out - save nothing
                        //}
                    }
                    prevPt = thisPt;
                    prevIn = thisIn;
                }

                // swap for next round
                sizePolygon = newSizePolygon;
                polygonSwap = polygonSource;
                polygonSource = polygonDest;
                polygonDest = polygonSwap;
            }
            sizeClippedPolygon = sizePolygon;
            return polygonSource;
        }

        // if not specified, perform clip
        return function (box, doNotClip) {

            if (box.isEmpty())
                return 0;

            var matrix = this.viewProj;

            //compute the array index to classify eye with respect to the 6 defining planes
            //of the bbox, 0-26
            var pos;
            if (this.perspective) {
                if ( this.eye.x >= box.min.x ) {
                    pos = ( this.eye.x > box.max.x ) ? 2 : 1;
                } else {
                    pos = 0;
                }
                if ( this.eye.y >= box.min.y ) {
                    pos += ( this.eye.y > box.max.y ) ? 6 : 3;
                }
                if ( this.eye.z >= box.min.z ) {
                    pos += ( this.eye.z > box.max.z ) ? 18 : 9;
                }
            } else {
                if ( this.viewDir[0] <= 0 ) {
                    pos = ( this.viewDir[0] < 0 ) ? 2 : 1;
                } else {
                    pos = 0;
                }
                if ( this.viewDir[1] <= 0 ) {
                    pos += ( this.viewDir[1] < 0 ) ? 6 : 3;
                }
                if ( this.viewDir[2] <= 0 ) {
                    pos += ( this.viewDir[2] < 0 ) ? 18 : 9;
                }
            }

            // 13 indicates eye location is inside box, index 1+3+9, so return full screen area
            if (pos === 13) {
                return 4;
            }
            var num = _boxIndexList[pos][6]; //look up number of vertices in outline

            //generate 8 corners of the bbox, as needed
            // run through "num" points and create and transform just those
            var i;
            for (i=0; i<num; i++) {
                var idx = _boxIndexList[pos][i];
                // tricksiness here: order is (though this is left-handed; we use right-handed)
                // (min[0],min[1],min[2]); //     7+------+6
                // (max[0],min[1],min[2]); //     /|     /|
                // (max[0],max[1],min[2]); //    / |    / |
                // (min[0],max[1],min[2]); //   / 4+---/--+5
                // (min[0],min[1],max[2]); // 3+------+2 /    y   z
                // (max[0],min[1],max[2]); //  | /    | /     |  /
                // (max[0],max[1],max[2]); //  |/     |/      |/
                // (min[0],max[1],max[2]); // 0+------+1      *---x

                points[i].set(
                    (((idx+1) % 4)<2) ? box.min.x : box.max.x,
                    ((idx % 4)<2)     ? box.min.y : box.max.y,
                    (idx < 4)         ? box.min.z : box.max.z
                );
                applyProjection(points[i], matrix);
            }

            var sum = 0;
            // always clip if needed; TODO: make more efficient, i.e., don't alloc each time.
            if ( doNotClip ) {
                sum = (points[num-1].x - points[0].x) * (points[num-1].y + points[0].y);
                for (i=0; i<num-1; i++)
                    sum += (points[i].x - points[i+1].x) * (points[i].y + points[i+1].y);
            } else {
                var clippedPolygon = clip(points,num);
                // see if clipped polygon has anything returned at all; if not, area is 0
                if ( sizeClippedPolygon >= 3 ) {
                    sum = (clippedPolygon[sizeClippedPolygon-1].x - clippedPolygon[0].x) * (clippedPolygon[sizeClippedPolygon-1].y + clippedPolygon[0].y);
                    for (i=0; i<sizeClippedPolygon-1; i++)
                        sum += (clippedPolygon[i].x - clippedPolygon[i+1].x) * (clippedPolygon[i].y + clippedPolygon[i+1].y);
                }
            }

            // avoid winding order left-handed/right-handed headaches by taking abs(); fixes clockwise loops
            return Math.abs(sum * 0.5); //return computed value corrected by 0.5
        };

    })();

    FrustumIntersector.prototype.estimateDepth = function (bbox) {

        var e = this.viewProj.elements;

        // Take center of box and find its distance from the eye.
        var x = (bbox.min.x+bbox.max.x)/2.0;
        var y = (bbox.min.y+bbox.max.y)/2.0;
        var z = (bbox.min.z+bbox.max.z)/2.0;

        // not used: var w = e[3] * x + e[7] * y + e[11] * z + e[15];

        var d = 1.0 / ( e[3] * x + e[7] * y + e[11] * z + e[15] );

        return ( e[2] * x + e[6] * y + e[10] * z + e[14] ) * d;

    };

    FrustumIntersector.prototype.intersectsBox = (function () {

        //Copied from three.js and modified to return separate
        //value for full containment versus intersection.
        //Return values: 0 -> outside, 1 -> intersects, 2 -> contains
        var p1 = new THREE.Vector3();
        var p2 = new THREE.Vector3();

        return function (box) {

            var planes = this.frustum.planes;
            var contained = 0;

            for (var i = 0; i < 6; i++) {

                var plane = planes[i];

                p1.x = plane.normal.x > 0 ? box.min.x : box.max.x;
                p2.x = plane.normal.x > 0 ? box.max.x : box.min.x;
                p1.y = plane.normal.y > 0 ? box.min.y : box.max.y;
                p2.y = plane.normal.y > 0 ? box.max.y : box.min.y;
                p1.z = plane.normal.z > 0 ? box.min.z : box.max.z;
                p2.z = plane.normal.z > 0 ? box.max.z : box.min.z;

                var d1 = plane.distanceToPoint(p1);
                var d2 = plane.distanceToPoint(p2);

                // if both outside plane, no intersection

                if (d1 < 0 && d2 < 0) {

	                return FrustumIntersector.OUTSIDE;

                }

                if (d1 > 0 && d2 > 0) {

                    contained++;

                }
            }

            return (contained == 6) ? FrustumIntersector.CONTAINS : FrustumIntersector.INTERSECTS;
        };


    })();

function getCorner(box, i, target) {
    target.x = (i & 1) ? box.max.x : box.min.x;
    target.y = (i & 2) ? box.max.y : box.min.y;
    target.z = (i & 4) ? box.max.z : box.min.z;
    return target;
}

function pointOutsideCutPlane(point, cutPlane) {
    var dp = point.x * cutPlane.x + point.y * cutPlane.y + point.z * cutPlane.z + cutPlane.w;
    return dp > 1e-6;
}

var boxOutsideCutPlane = (function () {

    var _tmp;
    return function(box, plane) {

        if (!_tmp) _tmp = new THREE.Vector3();

        // for each corner...
        for (var i=0; i<8; i++) {
            // stop if corner i is outside
            var corner = getCorner(box, i, _tmp);
            if (!pointOutsideCutPlane(corner, plane)) {
                return false;
            }
        }
        // all corners are in the outer half-space
        return true;
    }
})();

// Returns true if the given box is fully in the outer half-space of an active cut plane
FrustumIntersector.prototype.boxOutsideCutPlanes = function(box) {
    if (!this.cutPlanes) {
        return false;
    }

    for (var i=0; i<this.cutPlanes.length; i++) {
        var plane = this.cutPlanes[i];
        if (boxOutsideCutPlane(box, plane)) {
            return true;
        }
    }
    return false;
};
