import { enumMeshTriangles, enumMeshLines, enumMeshVertices } from './VertexEnumerator';
import * as THREE from "three";

    var inverseMatrix;
    var ray;

    var vA;
    var vB;
    var vC;

    var rayTarget;
    var normal;
    
    function init_three() {

        if (!inverseMatrix) {   
            inverseMatrix = new THREE.Matrix4();
            ray = new THREE.Ray();

            vA = new THREE.Vector3();
            vB = new THREE.Vector3();
            vC = new THREE.Vector3();

            rayTarget = new THREE.Vector3();
            normal = new THREE.Vector3();
        }
    }

    function meshRayCast( mesh, raycaster, intersects ) {
        init_three();

        var geometry = mesh.geometry;

        if (!geometry)
            return;

        var material = mesh.material;
        
        var side = material ? material.side : THREE.FrontSide;

        inverseMatrix.copy( mesh.matrixWorld ).invert();
        ray.copy( raycaster.ray ).applyMatrix4( inverseMatrix );

        var precision = raycaster.precision || 0.0001;
        var intersectionPoint, distance;


        enumMeshTriangles(geometry, function(vA, vB, vC, a, b, c, nA, nB, nC, idx) {

            if (side === THREE.BackSide) {

                intersectionPoint = ray.intersectTriangle(vC, vB, vA, true, rayTarget);

            } else {

                intersectionPoint = ray.intersectTriangle(vA, vB, vC, side !== THREE.DoubleSide, rayTarget);

            }

            if (intersectionPoint === null) return;

            intersectionPoint.applyMatrix4(mesh.matrixWorld);

            distance = raycaster.ray.origin.distanceTo(intersectionPoint);

            if (distance < precision || distance < raycaster.near || distance > raycaster.far) return;

            THREE.Triangle.getNormal(vA, vB, vC, normal);
            intersects.push( {

                distance: distance,
                point: intersectionPoint.clone(),
                face: new THREE.Face3(a, b, c, normal.clone()),
                faceIndex: idx,
                fragId: mesh.fragId,
                dbId: mesh.dbId,
                object: mesh,
                modelId: mesh.modelId,
            } );
        });

    }


    function lineRayCast( mesh, raycaster, intersects, options ) {

        init_three();

        var geometry = mesh.geometry;

        if (!geometry)
            return;

        var precision = raycaster.params.Line.threshold;
        if (mesh.isWideLine) {
            if (mesh.material.linewidth) {
                precision = mesh.material.linewidth;
            } else if (mesh.geometry.lineWidth) {
                precision = mesh.geometry.lineWidth;
            }
        }
        var precisionSq = precision * precision;

        inverseMatrix.copy( mesh.matrixWorld ).invert();
        ray.copy( raycaster.ray ).applyMatrix4( inverseMatrix );

        var interSegment = new THREE.Vector3();
        var interRay = new THREE.Vector3();

        if ( geometry instanceof THREE.BufferGeometry ) {

            enumMeshLines(geometry, function(vStart, vEnd, a, b, idx) {

                var distance, distSq;

                ray.distanceSqToSegment( vStart, vEnd, interRay, interSegment );

                interSegment.applyMatrix4( mesh.matrixWorld );
                interRay.applyMatrix4(mesh.matrixWorld);

                distSq = interSegment.distanceToSquared(interRay);

                if ( distSq > precisionSq ) return;

                distance = raycaster.ray.origin.distanceTo(interSegment);

                if ( distance < raycaster.near || distance > raycaster.far ) return;

                let result = {

                    distance: distance,
                    // What do we want? intersection point on the ray or on the segment??
                    // point: raycaster.ray.at( distance ),
                    point: interSegment.clone(),  // Note that we might hit multiple segments within the same mesh, particularly because everything 
                                                  // within linePrecision radius is considered a hit. Therefore, we must clone the vector here. 
                    face: { a: a, b: b },
                    faceIndex: idx,
                    fragId: mesh.fragId,
                    dbId: mesh.dbId,
                    object: mesh,

                    // Add distance to ray to allow estimating how far away this segment actually is from the ray.
                    // For on-canvas hit-tests, this allows us to estimate the screens-space distance. 
                    distanceToRay: Math.sqrt(distSq), 
                };

                /**
                 * If there is extra filter function in the options, we should let it to do the filter inline here
                 * Because: in FragmentList.prototype.getVizmesh
                 * 
                 * The returned mesh object is a cached object (to reduce the gabage collection pressure, more important than code!!!), and it will not be the same mesh object later on when we run the filter function 
                 */
                if (options && options.filter && !options.filter(result)) return;

                intersects.push( result );
            });
        }
    }

    /// c.f. THREE.PointCloud.prototype.raycast()
    function pointRayCast( mesh, raycaster, intersects ) {

        init_three();

        var geometry = mesh.geometry;
        if (!geometry)
            return;

        inverseMatrix.copy( mesh.matrixWorld ).invert();
        ray.copy( raycaster.ray ).applyMatrix4( inverseMatrix );

        var precision = raycaster.precision || 0.0001;

        var pickRadius = raycaster.params.PointCloud.threshold;
        if (!pickRadius) pickRadius = 1;
        pickRadius *= Math.max(3, geometry.pointSize); // small point sizes are too hard to pick!
        pickRadius /= 4;

        if ( geometry instanceof THREE.BufferGeometry ) {

            enumMeshVertices(geometry, function(point, normal, uv, idx) {
                // points are drawn as squares, but treat them as circles
                // to save having to calculate the orientation
                var distanceToRay = ray.distanceToPoint(point);
                if (distanceToRay > pickRadius) {
                    return;
                }

                var intersectionPoint = ray.closestPointToPoint(point);
                if (intersectionPoint === null) return;
                intersectionPoint.applyMatrix4(mesh.matrixWorld);

                var distance = raycaster.ray.origin.distanceTo(intersectionPoint);
                if (distance < precision || distance < raycaster.near || distance > raycaster.far) {
                    return;
                }

                intersects.push( {

                    distance: distance,
                    point: point,
                    face: { a: idx },
                    faceIndex: idx,
                    fragId: mesh.fragId,
                    dbId: mesh.dbId,
                    object: mesh

                } );

            });

        } else {
            // not implemented - other geometry types
        }

    }


    function rayCast(mesh, raycaster, intersects, options) {

        if (mesh.isLine || mesh.isWideLine)
            lineRayCast(mesh, raycaster, intersects, options);
        else if (mesh.isPoint)
            pointRayCast(mesh, raycaster, intersects);
        else
            meshRayCast(mesh, raycaster, intersects);

    }


    function intersectObjectRec( object, raycaster, intersects, recursive ) {

        if (object instanceof THREE.Mesh)
            rayCast(object, raycaster, intersects); //use our extended impl in case of Mesh.
        else
            object.raycast( raycaster, intersects ); //fall back to normal THREE.js impl

        if ( recursive === true ) {

            var children = object.children;

            for ( var i = 0, l = children.length; i < l; i ++ ) {

                intersectObjectRec( children[ i ], raycaster, intersects, true );

            }

        }

    }

    var descSort = function ( a, b ) {
        return a.distance - b.distance;
    };

    function intersectObject(object, raycaster, intersects, recursive) {
        intersectObjectRec(object, raycaster, intersects, recursive);
        intersects.sort(descSort);
    }


export let VBIntersector = {
    meshRayCast : meshRayCast,
    lineRayCast : lineRayCast,
    rayCast : rayCast,
    intersectObject : intersectObject
};
