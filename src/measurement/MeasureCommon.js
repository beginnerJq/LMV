
import * as THREE from "three";
import { SnapType } from "./SnapTypes";
import { MeasurementTypes } from "./MeasurementTypes";
import { convertUnits, formatValueWithUnits } from "./UnitFormatter";


    export const EPSILON = 0.0001;

    export function getSnapResultPosition(pick, viewer) {
        if (!pick) {
            return null;
        }

        const roundToFixed = function(vec) {
            // Currently, the precision is set from PDFs exported through revit.
            const vpId = pick?.viewportIndex2d;
            const viewports = viewer?.model?.getData()?.viewports;
            
            if (viewports && vpId && viewports[vpId]?.precision) {
                const precision = viewports[vpId].precision;
                vec.set(Number(vec.x.toFixed(precision)), Number(vec.y.toFixed(precision)), Number(vec.z.toFixed(precision)));
            }
            return vec;
        };

        if (pick.isPerpendicular) {
            return roundToFixed(pick.intersectPoint);
        }

        switch (pick.geomType) {
            case SnapType.SNAP_VERTEX:
            case SnapType.RASTER_PIXEL:  
            case SnapType.SNAP_MIDPOINT:
            case SnapType.SNAP_CIRCLE_CENTER:
                return roundToFixed(pick.getGeometry());

            case SnapType.SNAP_EDGE:
                var eps = getEndPointsInEdge(pick.getGeometry());
                var p1 = eps[0].clone();
                var p2 = eps[1].clone();
                return roundToFixed(nearestPointInPointToLine(pick.intersectPoint, p1, p2));

            case SnapType.SNAP_FACE:
                return roundToFixed(nearestPointInPointToPlane(pick.intersectPoint, pick.getGeometry().vertices[0], pick.faceNormal));

            case SnapType.SNAP_CIRCULARARC:                
                if (viewer && viewer.model && viewer.model.is2d()) {
                    var point = pick.snapPoint;
                    pick.geomType = SnapType.SNAP_VERTEX;
                    pick.geomVertex = point;
                    return roundToFixed(point);

                } else {
                    // For 3D models, currently we don't have the center geometry of the circle. 
                    // So the only way to select the center is by selecting the perimeter.
                    return roundToFixed(pick.circularArcCenter);    
                }

            case SnapType.SNAP_CURVEDEDGE:
                return roundToFixed(nearestVertexInVertexToEdge(pick.intersectPoint, pick.getGeometry()));

            case SnapType.SNAP_CURVEDFACE:
                return roundToFixed(pick.intersectPoint);

            // For snapping intersections, the snapped position is already computed.
            case SnapType.SNAP_INTERSECTION:
                return roundToFixed(pick.snapPoint);

            default:
                return null;
        }
    };

    export function correctPerpendicularPicks(firstPick, secondPick, viewer, snapper) {

        if (!firstPick || !secondPick || !firstPick.getGeometry() || !secondPick.getGeometry()) {
            return false;
        }

        var start = getSnapResultPosition(firstPick, viewer);

        if (snapper && viewer) {

            // Simple _ to Edge - Snap the second pick when it's 90 degrees.
            if (secondPick.geomType === SnapType.SNAP_EDGE) {
                var v2 = new THREE.Vector3();
                var v3 = new THREE.Vector3();
                
                var secondEdge = secondPick.getGeometry();

                v2.subVectors(secondPick.intersectPoint, start).normalize(); // rubberband vector
                v3.subVectors(secondEdge.vertices[0], secondEdge.vertices[1]).normalize();

                if(isPerpendicular(v2, v3, 0.05)) {
                    
                    var newPoint = nearestPointInPointToSegment(start, secondEdge.vertices[0], secondEdge.vertices[1], true);
                    
                    if (newPoint) {
                        if (snapper.onMouseMove(project(newPoint, viewer))) {
                            snapper.setPerpendicular(true);
                        }
                        
                        secondPick.geomVertex = newPoint;
                        secondPick.intersectPoint = newPoint;
                        return true;
                    }
                }
            }

            // Simple _ to Face - Snap the second pick when it's 90 degrees.
            else if (secondPick.geomType === SnapType.SNAP_FACE) {

                var v = new THREE.Vector3();
                
                var secondFace = secondPick.getGeometry();

                v.subVectors(secondPick.intersectPoint, start).normalize(); // rubberband vector

                if(isParallel(secondPick.faceNormal, v, 0.05)) {
                    
                    var newPoint = nearestPointInPointToPlane(start, secondFace.vertices[0], secondPick.faceNormal);
                    if (snapper.onMouseMove(project(newPoint, viewer))) {
                        snapper.setPerpendicular(true);
                    }

                    secondPick.geomVertex = newPoint;
                    secondPick.intersectPoint = newPoint;
                    return true;
                }
            }
        }
    };

    export function calculateDistance(firstPick, secondPick, dPrecision, viewer) {

        if (!firstPick || !secondPick || !firstPick.getGeometry() || !secondPick.getGeometry()) {
            return null;
        }

        var ep1 = getSnapResultPosition(firstPick, viewer);
        var ep2 = getSnapResultPosition(secondPick, viewer);

        if (!ep1 || !ep2) {
            return null;
        }

        if (isEqualVectors(ep1, ep2, EPSILON)) {
            return null;
        }

        var distanceXYZ, distanceX, distanceY, distanceZ;

        // Convert coords when in 2D
        if (viewer.model.is2d()) {
            ep1 = ep1.clone();
            ep2 = ep2.clone();
            viewer.model.pageToModel(ep1, ep2, firstPick.viewportIndex2d);
        }

        // Include resolution limits for high precision 2D-measurements, where available 
        if (dPrecision) {
                
            dPrecision = processDPrecision(dPrecision);

            // Adjust the distances aligned by the precision
            var measurementDistance = ep1.distanceTo(ep2);
            distanceXYZ = applyDPrecision(measurementDistance, dPrecision);
            
            measurementDistance = Math.abs(ep1.x - ep2.x);
            distanceX = applyDPrecision(measurementDistance, dPrecision);

            measurementDistance = Math.abs(ep1.y - ep2.y);
            distanceY = applyDPrecision(measurementDistance, dPrecision);

            return {
                distanceXYZ: distanceXYZ,
                distanceX: distanceX,
                distanceY: distanceY,
                distanceZ: 0,
                type: MeasurementTypes.MEASUREMENT_DISTANCE
            };
        }

        // Calculation for 3D models and 2D models without resolution limits
        distanceXYZ = ep1.distanceTo(ep2);
        distanceX = Math.abs(ep1.x - ep2.x);
        distanceY = Math.abs(ep1.y - ep2.y);
        distanceZ = Math.abs(ep1.z - ep2.z);
        return {
            distanceXYZ: distanceXYZ,
            distanceX: distanceX,
            distanceY: distanceY,
            distanceZ: distanceZ,
            type: MeasurementTypes.MEASUREMENT_DISTANCE
        };
    };

    function getDpiPrecision(model, viewportIndex) {

        // Only do this for 2D models.
        if (model.is3d()) {
            return 0;
        }

        // TODO: The measurement values were returning incorrect results because the logical_width and logical_height is being exported for PDFs.
        // This issue was introduced with the PDF viewport changes: PR-3523
        if (model.isPdf(true)) {
            return 0
        }

        // Include resolution limits for high precision 2D-measurements, where available (TREX-575)
        var page_width = model.getMetadata('page_dimensions', 'page_width', null);
        var logical_width = model.getMetadata('page_dimensions', 'logical_width', null);
        var page_height = model.getMetadata('page_dimensions', 'page_height', null);
        var logical_height = model.getMetadata('page_dimensions', 'logical_height', null);
        if (!page_width || !logical_width || !page_height || !logical_height) {
            return 0;
        }

        // Retrieve the inverse DPI
        var invdpix = page_width / logical_width;
        var invdpiy = page_height / logical_height;
        
        // Calculate the graininess in model units
        var p1 = new THREE.Vector3(0.0, 0.0, 0.0);
        var p2 = new THREE.Vector3(invdpix, invdpiy, 0.0);
        model.pageToModel(p1, p2, viewportIndex);
        var dPrecision = p1.distanceTo(p2);

        return dPrecision;
    };

    function isContainsEqualVectors(points) {
        for (var i = 0; i < points.length; i++) {
            for (var j = 0; j < points.length; j++) {
                if (i !== j && isEqualVectors(points[i], points[j], EPSILON)) {
                    return true;
                }
            }
        }

        return false;
    };

    function calculateAngle(picks, viewer) {
        var points = [];

        for (var key in picks) {
            if (picks.hasOwnProperty(key)) {
                var point = getSnapResultPosition(picks[key], viewer);
                if (point) {
                    points.push(point);    
                }
            }            
        }

        if (points.length !== 3 || isContainsEqualVectors(points)) {
            return null;
        }


        var v1 = new THREE.Vector3();
        var v2 = new THREE.Vector3();

        v1.subVectors(points[0], points[1]);
        v2.subVectors(points[2], points[1]);

        return angleVectorToVector(v1, v2);
    };
    
    function calculateArea(picks, viewer) {
        var points = [];

        for (var key in picks) {
            if (picks.hasOwnProperty(key)) {
                var point = getSnapResultPosition(picks[key], viewer);
                if (point) {
                    points.push(point.clone());    
                }
            }            
        }

        var firstPoint = getSnapResultPosition(picks[1], viewer);
        if (firstPoint) {
            points.push(firstPoint.clone());
        }

        for (var i = 0; i < points.length; i+=2) {
            viewer.model.pageToModel(points[i], points[i + 1], picks[1].viewportIndex2d);
        }

        var sum1 = 0;
        var sum2 = 0;

        for (var i = 0; i < points.length - 1; i++) {
            sum1 += points[i].x * points[i+1].y;
            sum2 += points[i].y * points[i+1].x;
        }

        var area = Math.abs((sum1 - sum2) / 2);
        return area;
        
    };
    function calculateArcLength(firstPick, secondPick, dPrecision, viewer) {

        if (!firstPick || !secondPick || !firstPick.getGeometry() || !secondPick.getGeometry()) {
            return null;
        }

        if(!firstPick.circularArcRadius) {
            return null;
        }

        var p1 = getSnapResultPosition(firstPick, viewer).clone();
        var p2 = getSnapResultPosition(secondPick, viewer).clone();

        const arcCenter = firstPick.circularArcCenter;

        // Get the center point
        var centerPoint =
            arcCenter instanceof THREE.Vector3
                ? arcCenter.clone()
                : new THREE.Vector3(arcCenter.x, arcCenter.y, arcCenter.z);


        if (!p1 || !p2) {
            return null;
        }

        if (isEqualVectors(p1, p2, EPSILON)) {
            return 0;
        }

        // Convert coords when in 2D
        if (viewer.model.is2d()) {
            viewer.model.pageToModel(p1, p2, firstPick.viewportIndex2d);
            viewer.model.pageToModel(centerPoint, null, firstPick.viewportIndex2d);
        }

        // calculate the arc length
        function getArcLength () {
            var v1 = new THREE.Vector3();
            var v2 = new THREE.Vector3();
            v1.subVectors(p1, centerPoint);
            v2.subVectors(p2, centerPoint);
    
            // To average decimal values from both the points 
            var lengthProduct = v1.length() * v2.length();
    
            var dot = v1.dot(v2);
            var arcAngle = Math.acos(dot / lengthProduct);
    
            var radius = v1.length();

            return arcAngle * radius;
        }

        var arcLength = getArcLength();

        // Include resolution limits for high precision 2D-measurements, where available 
        if (dPrecision) {
            dPrecision = processDPrecision(dPrecision);
            return applyDPrecision(arcLength, dPrecision);
        } else {
            return arcLength;
        }
    };

    /**
     * Calculates the smallest power of 10 such that it is > than the provided precision. For example, 5 will return 10
     * but 11 will return 100
     * @param {number} dPrecision Original precision
     * @returns {number} Closest precision expressed in power of 10
     */
    function processDPrecision(dPrecision) {
        var n = Math.log(dPrecision) / Math.log(10.0);
        var nd = Math.floor(n);

        // Increase one decimal if the original precision < 10^nd
        if (1.0 < (dPrecision / Math.pow(10.0, nd)))
            nd++;

        return Math.pow(10.0, nd);
    };

    // Apply DPI precision to a measurement to round it to the correct number of digits
    function applyDPrecision(measurement, dPrecision) {
        return Math.floor((measurement / dPrecision) + 0.5) * dPrecision;
    };

    /**
     * The main function for this file, which calculates a measurement result (either distance
     * or angle) from a given measurement.
     */
    export function computeResult(picks, measurementType, viewer, options) {

        switch (measurementType) {
            case MeasurementTypes.MEASUREMENT_DISTANCE:
                var firstPick = picks[1];
                var secondPick = picks[2];
                var dPrecision = getDpiPrecision(viewer.model, firstPick.viewportIndex2d);

                return calculateDistance(firstPick, secondPick, dPrecision, viewer);
            
            case MeasurementTypes.MEASUREMENT_ANGLE:
                var angle = calculateAngle(picks, viewer);
                return angle ? {
                        angle: (!options || !options.angleOuter) ? angle : 360 - angle,
                        type: measurementType
                    } : null;

            case MeasurementTypes.MEASUREMENT_AREA:
                return {
                    area: calculateArea(picks, viewer),
                    type: measurementType
                };

            case MeasurementTypes.MEASUREMENT_ARC:
              var firstPick = picks[1];
              var secondPick = picks[2];
              var dPrecision = getDpiPrecision(viewer.model, firstPick.viewportIndex2d);
                return {
                    arc: calculateArcLength(firstPick, secondPick, dPrecision, viewer),
                    type: measurementType
                };

            case MeasurementTypes.MEASUREMENT_LOCATION:
                return {
                    location: getSnapResultPosition(picks[1], viewer),
                    type: measurementType
                };

            default:
                return null;

        }
    };

    export function getFaceArea(viewer, measurement, face, units, precision, calibrationFactor) {

        var area = 0;
        var vertices = face.vertices;
        var V1 = new THREE.Vector3();
        var V2 = new THREE.Vector3();

        for (var i = 0; i < vertices.length; i += 3) {

            V1.subVectors(vertices[i + 1], vertices[i]);
            V2.subVectors(vertices[i + 2], vertices[i]);

            area += V1.length() * V2.length() * Math.sin(V1.angleTo(V2)) / 2;
        }

        area = convertUnits(viewer.model.getUnitString(), units, calibrationFactor, area, 'square');

        if (units) {

            return formatValueWithUnits(area, units+'^2', 3, precision);
        }
        else {

            return formatValueWithUnits(area, null, 3, precision);
        }

    };

    export function getCircularArcRadius(viewer, measurement, edge, units, precision, calibrationFactor) {

        var radius = edge.radius;

        if (radius) {
            if (viewer.model.is2d()) {
                var pt1 = edge.center.clone();
                var pt2 = edge.vertices[0].clone();
                viewer.model.pageToModel(pt1, pt2, measurement.getPick(1).viewportIndex2d);
                radius = pt1.distanceTo(pt2);
            }

            radius = convertUnits(viewer.model.getUnitString(), units, calibrationFactor, radius);
            return formatValueWithUnits(radius, units, 3, precision);
        }
    };

    export function project(point, viewer, offset) {
        var camera = viewer.navigation.getCamera(),
            containerBounds = viewer.navigation.getScreenViewport(),
            p = new THREE.Vector3(point.x, point.y, point.z);

        p = p.project(camera);

        offset = offset || 0;

        return new THREE.Vector2(Math.round(( p.x + 1) / 2 * containerBounds.width) + offset,
                Math.round((-p.y + 1) / 2 * containerBounds.height) + offset);
    };

    export function inverseProject(point, viewer) {

        var camera = viewer.navigation.getCamera(),
            containerBounds = viewer.navigation.getScreenViewport(),
            p = new THREE.Vector3();

        p.x = point.x / containerBounds.width * 2 - 1;
        p.y = -(point.y / containerBounds.height * 2 - 1);
        p.z = 0;

        p = p.unproject(camera);

        return p;
    };

    //***** Helper functions for calculations without state: ***** //
//TODO_TS: Are these used outside the Markup extension? If not, they should move there.
    

    // Get the nearest point on the line from point to line
    // inLine - whether to force the result to be inside the given line or not.
    export function nearestPointInPointToLine(point, lineStart, lineEnd) {

        var X0 = new THREE.Vector3();
        var X1 = new THREE.Vector3();
        var nearestPoint;
        var param;

        X0.subVectors(lineStart, point);
        X1.subVectors(lineEnd, lineStart);
        param = X0.dot(X1);
        X0.subVectors(lineEnd, lineStart);
        param = -param / X0.dot(X0);

        X0.subVectors(lineEnd, lineStart);
        X0.multiplyScalar(param);
        nearestPoint = X0.add(lineStart);    

        return nearestPoint;
    };

    // Get the nearest point on the line segment from point to line segment
    export function nearestPointInPointToSegment(point, lineStart, lineEnd, forcePerpendicular) {

        var X0 = new THREE.Vector3();
        var X1 = new THREE.Vector3();
        var nearestPoint;
        var param;

        X0.subVectors(lineStart, point);
        X1.subVectors(lineEnd, lineStart);
        param = X0.dot(X1);
        X0.subVectors(lineEnd, lineStart);
        param = -param / X0.dot(X0);

        if (param < 0) {
            if (forcePerpendicular) {
                nearestPoint = null;
            } else {
                nearestPoint = lineStart;    
            }
        }
        else if (param > 1) {
            if (forcePerpendicular) {
                nearestPoint = null;
            } else {
                nearestPoint = lineEnd;    
            }
        }
        else {
            X0.subVectors(lineEnd, lineStart);
            X0.multiplyScalar(param);
            nearestPoint = X0.add(lineStart);
        }

        return nearestPoint;
    };
        
        

    export function isEqualVectors(v1, v2, precision) {
        if (!v1 || !v2) {
            return false;
        }

        if (Math.abs(v1.x - v2.x) <= precision && Math.abs(v1.y - v2.y) <= precision && Math.abs(v1.z - v2.z) <= precision) {
            return true;
        }
        return false;
    };

    export function getEndPointsInEdge(edge) {

        var vertices = edge.vertices;
        var endPoints = [];

        for (var i = 0; i < vertices.length; ++i) {

            var duplicate = false;

            for (var j = 0; j < vertices.length; ++j) {

                if (j !== i && vertices[j].equals(vertices[i])) {

                    duplicate = true;
                    break;
                }
            }

            if (!duplicate) {

                endPoints.push(vertices[i]);

            }
        }

        // If the edge is degenerated, endPoints may be empty here. In this case, just add the first
        // two vertices of the input edge (different pointers, but equal point values in this case).
        if (endPoints.length < 2) {
            endPoints[0] = vertices[0];
            endPoints[1] = vertices[1];
        }

        return endPoints;
    };

    export function angleVectorToVector(v1, v2) {
        return v1.angleTo(v2) * 180 / Math.PI;
    };


    // Find the nearest point from point to plane
    function nearestPointInPointToPlane(p1, p2, n) {

        var nearestPoint = new THREE.Vector3();
        var norm = n.clone();
        var X0 = new THREE.Vector3();
        X0.subVectors(p1, p2);

        var sn = -norm.dot(X0);
        var sd = norm.dot(norm);
        var sb = sn / sd;

        nearestPoint.addVectors(p1, norm.multiplyScalar(sb));
        return nearestPoint;
    };



    // Returns true if v1 an v2 are parallel
    export function isParallel(v1, v2, precision) {
        precision = precision ? precision : EPSILON;
        return 1 - Math.abs(v1.dot(v2)) < precision;
    };

    export function isPerpendicular(v1, v2, precision) {
        precision = precision ? precision : EPSILON;
        return Math.abs(v1.dot(v2)) < precision;
    };


    // Find the vertex need to draw For circular arc's radius
    export function nearestVertexInVertexToEdge(vertex, edge) {

        var nearestPoint;
        var minDist = Number.MAX_VALUE;

        for (var i = 0; i < edge.vertices.length; i++) {
            var dist = vertex.distanceTo(edge.vertices[i]);
            if (minDist > dist) {
                nearestPoint = edge.vertices[i];
                minDist = dist;
            }
        }

        return nearestPoint;
    };

    export function createCommonOverlay(viewer, name) {
        if (!viewer.impl.overlayScenes[name])
            viewer.impl.createOverlayScene(name);
    }

    export function safeToggle(element, property, show) {
        // toggle only if it needs to. Necessary for IE11.

        if ((element.classList.contains(property) && !show) || (!element.classList.contains(property) && show)) {
            element.classList.toggle(property, show);    
        }
    }