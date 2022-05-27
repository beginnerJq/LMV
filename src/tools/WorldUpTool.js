
import * as THREE from "three";
import * as et from "../application/EventTypes";

// TODO: Pass in the api instead of the impl, don't use the impl object.
export function WorldUpTool( viewerImpl, viewerApi )
{
    var kRingSizeMin = 0.35; // Proportion of screen height
    var kRingSizeMax = 0.80; // Proportion of screen height
    var kRingSizeDefault = 0.65; // Proportion of screen height

    var _navapi = viewerApi.navigation;
    var _camera = _navapi.getCamera();
    var _names = ["worldup"];
    var self = this;

    // Returns the projection of (x,y,z) onto the plane with this unit normal
    var projectAxis = function()
    {
        var projectionVec = new THREE.Vector3();

        return function (x, y, z, normal)
        {
            var vec = new THREE.Vector3(x, y, z);
            var projectionLength = normal.dot(vec);
            projectionVec.copy(normal);
            projectionVec.multiplyScalar(projectionLength);
            return vec.sub(projectionVec);
        }
    }();

    // /** @constructor */
    function RollInteraction( viewerImpl, camera )
    {
        var kRollColor = 0xBBBBBB;
        var kHudFov = 30;
        var kHudWorldScale = 2.0 * Math.tan(THREE.Math.degToRad(kHudFov * 0.5));

        var myMaterial  = new THREE.MeshPhongMaterial({
            color:       kRollColor,
            opacity:     0.5,
            transparent: true,
            depthTest:   false,
            depthWrite:  false,
        });

        // Preallocate these as work objects:
        var myVec1   = new THREE.Vector3();
        var myVec2   = new THREE.Vector3();
        var myRotate = new THREE.Quaternion();

        // Use our own camera for the Roll HUD:
        // var myCamera = camera.clone();   // There's a bug in Object3D.clone()
        var myCamera = new THREE.PerspectiveCamera(kHudFov, camera.aspect, camera.near, camera.far);
        var mySceneCamera = camera;
        var myRingScale = 1.0;
        var myRingSize = 1.0;
        var myLookAtPoint = null;
        var myReferenceCircle = null;
        var myReferenceXaxis = null;
        var myReferenceYaxis = null;
        var myReferenceZaxis = null;
        var myReferenceGeometry = null;
        var myReferenceUp = null;
        var mySnapPoints = null;
        var mySnapFlags = null;
        var mySnapAngles = new Array(6);
        var myClosestAngle = 0.0;
        var myRollAngle = 0.0;
        var myAnglesFlipped = false;
        var myCurrentlySnapped = true;  // Assume initially true
        var mySnappedRoll = 0.0;
        var kSnapInThreshold  = 5.0 * Math.PI / 180.0;
        var kSnapOutThreshold = 7.0 * Math.PI / 180.0;
        var myDistance = 1.0;

        var kNOSNAP = 1e3;
        var kAliasLengthThreshold = 0.1;

        viewerImpl.createOverlayScene("roll", null, null, myCamera);

        function angleDiff(a, b)
        {
            var diff = Math.abs(a - b);
            if( diff > kTwo_PI )
                return diff;

            return Math.min(kTwo_PI - diff, diff);
        }

        function isThisAxis(index, worldUp)
        {
            var snapVec = getSnapVector(index);
            if( snapVec.distanceToSquared(worldUp) < kEpsilon )
                return true;

            myVec2.set(-worldUp.x, -worldUp.y, -worldUp.z);
            return (snapVec.distanceToSquared(myVec2) < kEpsilon);
        }

        function filterSnapAngles(snapLengths, worldUp)
        {
            // For some rotation axes the snap angles for two axes can be close together.
            // Snapping to one or the other doesn't give expected results. This filters
            // the snap angles and removes one of the close angles. When two angles are
            // withing AliasSnapThreshold, one of the angles is removed. The one we keep
            // is the one with the longest projection length unless it happens to be the
            // current up direction.

            // This threshold should be greater than the snap out threshold plus the snap
            // in threshold so that when two snap points are close together there is room
            // to snap out of one and into the other.
            var kAliasSnapThreshold = kSnapInThreshold + kSnapOutThreshold + (2.0 * Math.PI / 180.0);

            for (var i = 0; i < 6; ++i)
            {
                if( mySnapAngles[i] === kNOSNAP )
                    continue;

                for (var j = i + 1; j < 6; ++j)
                {
                    if( mySnapAngles[j] === kNOSNAP )
                        continue;

                    var diff = angleDiff(mySnapAngles[i], mySnapAngles[j]);

                    if (diff < kAliasSnapThreshold)
                    {
                        if( (snapLengths[i] < snapLengths[j] && !isThisAxis(i, worldUp))
                        ||  isThisAxis(j, worldUp) )
                        {
                            mySnapAngles[i] = kNOSNAP;
                            break;  // angle i is removed stop checking
                        }
                        else
                            mySnapAngles[j] = kNOSNAP;
                    }
                }
            }
        }

        // Calculate the opposite angle from angle. angle should be
        // from -PI to PI, or kNOSNAP
        function oppositeAngle(angle)
        {
            if( angle > kTwo_PI )
                return angle;
            if( angle <= 0.0 )
                return angle + Math.PI;
            return angle - Math.PI;
        }

        function updateSnapPoints(viewVec, cameraUp, worldUp)
        {
            var normal = viewVec.clone().normalize();
            var snaps   = new Array(3);
            var lengths = new Array(6);

            // Project the 6 axis vectors onto the view plane:
            snaps[0] = projectAxis(1.0, 0.0, 0.0, normal);
            snaps[1] = projectAxis(0.0, 1.0, 0.0, normal);
            snaps[2] = projectAxis(0.0, 0.0, 1.0, normal);

            var i;
            var left = cameraUp.clone().cross(normal).normalize();

            for( i=0; i < 3; ++i )
            {
                var snap = snaps[i];
                lengths[i] = snap.length();

                // A short projection length means the axis was too close to
                // the view vector:
                if( lengths[i] < kAliasLengthThreshold )
                {
                    mySnapAngles[i] = kNOSNAP;
                }
                else
                {
                    snap.multiplyScalar(1.0 / lengths[i]);
                    mySnapAngles[i] = Math.atan2(left.dot(snap), cameraUp.dot(snap));
                }
            }
            mySnapAngles[3] = oppositeAngle(mySnapAngles[0]);
            mySnapAngles[4] = oppositeAngle(mySnapAngles[1]);
            mySnapAngles[5] = oppositeAngle(mySnapAngles[2]);
            lengths[3] = lengths[0];
            lengths[4] = lengths[1];
            lengths[5] = lengths[2];

            filterSnapAngles(lengths, worldUp);

            for( i=0; i < 6; ++i )
            {
                if( mySnapAngles[i] !== kNOSNAP )
                {
                    var z = myVec2.set(0.0, 0.0, 1.0);
                    myRotate.setFromAxisAngle( z, mySnapAngles[i] );
                    // The radius of the circle is 0.5 so place the points
                    // just outside the circle:
                    var pos = myVec2.set(0.0, 0.54, 0.0);
                    pos.applyQuaternion( myRotate );
                    mySnapPoints[i].position.copy(pos);
                    mySnapPoints[i].visible = true;
                }
                else
                    mySnapPoints[i].visible = false;
            }
        }

        function buildReferenceGeometry()
        {
            myReferenceGeometry = new THREE.Object3D();

            // The roll hud geometry is built with unit diameter and then scaled
            // to world space later.
            var geom   = new THREE.RingGeometry( 0.5 - 0.01 * myRingScale, 0.5, 60 );
            var circle = new THREE.Mesh( geom, myMaterial );

            myReferenceCircle = circle;

            var thick = 0.007 * myRingScale;
            var geomX = new THREE.BoxGeometry( 0.930, thick, thick );
            var geomY = new THREE.BoxGeometry( thick, 0.930, thick );
            var geomZ = new THREE.BoxGeometry( thick, thick, 0.930 );

            myReferenceXaxis = new THREE.Mesh( geomX, myMaterial );
            myReferenceYaxis = new THREE.Mesh( geomY, myMaterial );
            myReferenceZaxis = new THREE.Mesh( geomZ, myMaterial );

            myReferenceGeometry.add( myReferenceXaxis );
            myReferenceGeometry.add( myReferenceYaxis );
            myReferenceGeometry.add( myReferenceZaxis );

            myReferenceUp = new THREE.Mesh( new THREE.CircleGeometry( 0.005 ), myMaterial );
            myReferenceGeometry.add(myReferenceUp);

            mySnapPoints = new Array(6);
            mySnapFlags  = new Array(6);
            for( var i = 0;  i < 6;  ++i )
            {
                var r1 = 0.0050 * myRingScale;
                var r2 = 0.0025 * myRingScale;
                mySnapPoints[i] = new THREE.Mesh( new THREE.CircleGeometry( r1, 16 ), myMaterial );
                mySnapFlags[i]  = new THREE.Mesh( new THREE.CircleGeometry( r2, 16 ), myMaterial );
                mySnapFlags[i].visible = false;
                mySnapPoints[i].add(mySnapFlags[i]);
                circle.add(mySnapPoints[i]);
            }
            myReferenceGeometry.add( circle );

            return myReferenceGeometry;
        }

        function getReferenceGeometry(scale, lookAtPoint, viewVec, worldUp, cameraUp)
        {
            if( !myReferenceGeometry )
                myReferenceGeometry = buildReferenceGeometry();

            _navapi.orient(myReferenceCircle, lookAtPoint, myCamera.position, worldUp);

            updateSnapPoints(viewVec, cameraUp, worldUp);

            myReferenceGeometry.scale.x = scale;
            myReferenceGeometry.scale.y = scale;
            myReferenceGeometry.scale.z = scale;

            myReferenceGeometry.position.copy(lookAtPoint);

            return myReferenceGeometry;
        }

        function getSnapVector(index)
        {
            myVec1.set(0.0, 0.0, 0.0);
            if( index >= 0 )
            {
                var v = (index >= 3) ? -1 : 1;
                index %= 3;
                if( index === 0 ) myVec1.x = v;
                if( index === 1 ) myVec1.y = v;
                if( index === 2 ) myVec1.z = v;
            }
            if( myAnglesFlipped )
                myVec1.multiplyScalar(-1);

            return myVec1;
        }

        function closestSnap(dtheta, snapThresh)
        {
            var diff = angleDiff(mySnapAngles[0], dtheta);
            var closest = 0;
            for (var i = 1; i < 6; ++i)
            {
                var d = angleDiff(mySnapAngles[i], dtheta);
                if (d < diff)
                {
                    diff = d;
                    closest = i;
                }
            }
            myClosestAngle = diff;
            return (diff < snapThresh) ? closest : -1;
        }

        function setWorldUp(upvec)
        {
            _navapi.setWorldUpVector(upvec, true);
        }

        function applyRoll(angle)
        {
            if( angle === 0.0 )
                return;

            var kStableRollThreshold = 30.0 * Math.PI / 180.0;
            var view = myVec2.copy(myCamera.position).sub(myLookAtPoint).normalize();

            // Create a quaterion rotation about the roll axis by the angle:
            myRotate.setFromAxisAngle( view, angle );

            // Check the angle between the view vector and the world up.
            // When we get close the roll about the view vector becomes unstable
            // so we jump the up vector to the camera's current vertical.
            // This should be OK because if we're here we know we aren't snapped.
            var up = _navapi.getWorldUpVector();
            var viewUpAngle = Math.abs(view.angleTo(up));
            if( viewUpAngle < kStableRollThreshold || (Math.PI - viewUpAngle) < kStableRollThreshold )
            {
                up.copy(_navapi.getCameraUpVector());  // This is the actual camera up
            }
            // Rotate the current up vector by that quaternion:
            up.applyQuaternion( myRotate );

            setWorldUp(up);
        }

        function justNowSnapped()
        {
            if( !myCurrentlySnapped )
            {
                var closest = closestSnap(myRollAngle, kSnapInThreshold);
                if( closest >= 0 )
                {
                    myClosestAngle = 0.0;
                    myCurrentlySnapped = true;
                    myRollAngle = mySnapAngles[closest];
                    return getSnapVector(closest);
                }
            }
            return false;
        }

        function justNowUnsnapped()
        {
            if( myCurrentlySnapped )
            {
                var closest = closestSnap(myRollAngle, kSnapOutThreshold);
                if( closest < 0 )
                {
                    myCurrentlySnapped = false;
                    return true;
                }
                myClosestAngle = 0.0;
            }
            return false;
        }

        function isReallySnapped(angle, threshold, i, worldUp)
        {
            var circleSnapped = (angle < threshold);
            if( circleSnapped )
            {
                // Check if the up direction really is the same:
                var snapUp = getSnapVector(i);
                return (snapUp.distanceToSquared(worldUp) < kEpsilon);
            }
            return false;
        }

        function updateIndicators(worldUp, cameraUp)
        {
            // Check if the camera is upside down. If so, up is down.
            var wDotC = worldUp.dot(cameraUp);
            var flipped = (wDotC < 0.0);
            if( flipped )
                cameraUp = cameraUp.clone().multiplyScalar(-1);

            // Need to re-orient and position the UP indicator.
            // The scalar is the middle radius of the ring geometry.
            _navapi.orient(myReferenceUp, myLookAtPoint, myCamera.position, cameraUp);
            myReferenceUp.position.copy(cameraUp.multiplyScalar(0.495));

            var isSnapped = false;
            var threshold = myCurrentlySnapped ? kSnapOutThreshold : kSnapInThreshold;
            for (var i = 0; i < 6; ++i)
            {
                var angle = angleDiff(mySnapAngles[i], myRollAngle);
                var snapped = isReallySnapped(angle, threshold, i, worldUp);
                if( snapped )
                    isSnapped = true;
                var proximityScale = snapped ? 4.0 : (1.0 - 3.0 * angle / Math.PI) * 3.0;
                if( proximityScale < 1.0 )
                    proximityScale = 1.0;

                // Keep the snap point sizes independent of the ring size:
                proximityScale *= myRingScale;

                // This turns off/on the inner snap indicator circle within
                // each of the snap points:
                mySnapFlags[i].visible = snapped;
                var snap = mySnapPoints[i];
                snap.scale.x = proximityScale;
                snap.scale.y = proximityScale;
                snap.scale.z = proximityScale;
            }
            myReferenceXaxis.visible = isSnapped;
            myReferenceYaxis.visible = isSnapped;
            myReferenceZaxis.visible = isSnapped;

            return isSnapped;
        }

        this.updateRollCamera = function(size, distance)
        {
            myCamera.position.copy(mySceneCamera.position);
            myCamera.quaternion.copy(mySceneCamera.quaternion);
            myCamera.up.copy(mySceneCamera.up);
            myCamera.aspect = mySceneCamera.aspect;

            if( size && distance )
            {
                myCamera.near = distance - size;
                myCamera.far  = distance + size;
            }
            myCamera.updateProjectionMatrix();
        };

        this.isSnapped = function()
        {
            return myCurrentlySnapped;
        };

        this.resize = function()
        {
            var worldHeight = myDistance * kHudWorldScale;
            var worldWidth  = worldHeight * mySceneCamera.aspect;
            var worldSize   = ((mySceneCamera.aspect < 1.0) ? worldWidth : worldHeight) * myRingSize;

            myReferenceGeometry.scale.x = worldSize;
            myReferenceGeometry.scale.y = worldSize;
            myReferenceGeometry.scale.z = worldSize;
        };

        // TODO: Check for rolled camera and re-orient to up before setting up HUD.
        this.start = function(lookAtPoint, ringSize)
        {
            this.updateHUD(lookAtPoint, ringSize);
            viewerImpl.addOverlay("roll", myReferenceGeometry);
        };

        this.updateHUD = function(lookAtPoint, ringSize)
        {
            myLookAtPoint = lookAtPoint;

            if( ringSize < kRingSizeMin )
                ringSize = kRingSizeMin;
            else if( ringSize > kRingSizeMax )
                ringSize = kRingSizeMax;

            myRingSize  = ringSize;
            myRingScale = kRingSizeMax / ringSize;

            var viewVec = myVec1.copy(lookAtPoint).sub(mySceneCamera.position);
            myDistance = viewVec.length();

            var worldHeight = myDistance * kHudWorldScale;
            var worldWidth  = worldHeight * mySceneCamera.aspect;
            var worldSize   = ((mySceneCamera.aspect < 1.0) ? worldWidth : worldHeight) * ringSize;

            this.updateRollCamera(worldSize, myDistance);

            var worldUp  = _navapi.getWorldUpVector();
            var cameraUp = _navapi.getCameraUpVector();
            getReferenceGeometry(worldSize, lookAtPoint, viewVec, worldUp, cameraUp);
            myRollAngle = 0.0;
            mySnappedRoll = 0.0;

            var wDotC = worldUp.dot(cameraUp);
            myAnglesFlipped = (wDotC < 0.0);

            myCurrentlySnapped = updateIndicators(worldUp, cameraUp);
        };

        this.handleRoll = function( dx, dy, p2 )
        {
            this.updateRollCamera();

            updateIndicators(_navapi.getWorldUpVector(), _navapi.getCameraUpVector());

            if( dx !== 0.0 || dy !== 0.0 )
            {
                // 2D vectors from the center of the screen (0.5, 0.5)
                var v1x = p2.x - dx - 0.5;
                var v1y = p2.y - dy - 0.5;
                var v2x = p2.x - 0.5;
                var v2y = p2.y - 0.5;

                // Angle between those to vectors is the rotation of the mouse
                // around the center of the screen:
                return handleRollByAngle(Math.atan2(v2y, v2x) - Math.atan2(v1y, v1x));
            }
            return false;
        };

        this.handleRollTouch = function ( angle )
        {
            this.updateRollCamera();

            updateIndicators(_navapi.getWorldUpVector(), _navapi.getCameraUpVector());

            var delta = angle - myRollAngle;
            return (Math.abs(delta) > 0.001) ? handleRollByAngle(delta) : false;
        };

        function handleRollByAngle ( angle )
        {
            // Make sure it's in the right range for comparison with the
            // snap angles:
            myRollAngle += angle;
            if( myRollAngle > Math.PI )
                myRollAngle = myRollAngle - kTwo_PI;
            else if( myRollAngle <= -Math.PI )
                myRollAngle = kTwo_PI + myRollAngle;

            var snappedUp = justNowSnapped();
            if( snappedUp )
            {
                mySnappedRoll = myRollAngle;
                setWorldUp(snappedUp);
            }
            else if( justNowUnsnapped() )
            {
                // Because the snap points are "sticky" the roll amount
                // in this case is the distance from the snap point:
                var deltaRoll = myRollAngle - mySnappedRoll;
                applyRoll(deltaRoll);
                mySnappedRoll = 0.0;
            }
            else if( !myCurrentlySnapped )
            {
                applyRoll(angle);
            }
            else
                return false;

            return true;
        }

        this.end = function()
        {
            viewerImpl.removeOverlay("roll", myReferenceGeometry);
        };
    }

    var kTwo_PI  = 2.0 * Math.PI; // 360 degrees.
    var kScreenEpsilon = 0.001;
    var kEpsilon = 0.00001;

    var _isDragging = false;
    var _needNextRefresh = false;
    var _started = false;

    var _rollInteraction = new RollInteraction(viewerImpl, _camera);
    var _startXYZ = new THREE.Vector3();
    var _moveXYZ  = new THREE.Vector3();
    var _motionDelta = new THREE.Vector3();
    var _touchType = null;
    var _touchAngle = 0.0;
    var _touchCenter = { x: 0.5, y: 0.5 };
    var _touchDistance = 1.0;

    this.getNames = function()
    {
        return _names;
    };

    this.getName = function()
    {
        return _names[0];
    };

    this.activate = function(name)
    {
        viewerApi.addEventListener(et.CAMERA_CHANGE_EVENT, this.handleCameraChange);
        _started = false;
    };

    this.deactivate = function(name)
    {
        _rollInteraction.end();
        viewerApi.removeEventListener(et.CAMERA_CHANGE_EVENT, this.handleCameraChange);
        this.utilities.restorePivot();
        _touchType = null;

        _isDragging = false;
        _started = false;
    };

    this.getCursor = function()
    {
        return "auto";
    };

    this.getMotionDelta = function(dxyz)
    {
        var deltaX = _moveXYZ.x - _startXYZ.x;
        var deltaY = _moveXYZ.y - _startXYZ.y;
        var deltaZ = _moveXYZ.z - _startXYZ.z;

        if( Math.abs(deltaX) < kScreenEpsilon ) deltaX = 0.0;
        if( Math.abs(deltaY) < kScreenEpsilon ) deltaY = 0.0;
        if( Math.abs(deltaZ) < kScreenEpsilon ) deltaZ = 0.0;

        dxyz.set(deltaX, deltaY, deltaZ);
    };

    this.stepMotionDelta = function()
    {
        _startXYZ.copy(_moveXYZ);
    };

    this.update = function()
    {
        if( !_started )
        {
            // Stash the current COI and while the interaction is active
            // use the center of the view as the pivot for rolling.
            //
            // Position the temporary COI half way between the near and far
            // clipping planes to avoid clipping problems:
            //
            var viewVec = _navapi.getEyeVector();
            var distance = (_camera.near + _camera.far) * 0.5;
            viewVec.normalize().multiplyScalar(distance);
            var target = viewVec.add(_camera.position);

            this.utilities.savePivot();
            this.utilities.setPivotPoint( target, true, true );
            this.utilities.pivotActive(true);

            // var ringSize = (_touchType === "roll") ? _touchDistance : kRingSizeDefault;
            var ringSize = kRingSizeDefault;
            _rollInteraction.start( target, ringSize );
            _started = true;
        }

        var moved = _needNextRefresh;

        this.getMotionDelta(_motionDelta);

        var deltaX = _motionDelta.x;
        var deltaY = _motionDelta.y;
        var deltaZ = _motionDelta.z;

        if( _needNextRefresh || _touchType === "roll" || _isDragging && (deltaX !== 0.0 || deltaY !== 0.0 || deltaZ !== 0.0) )
        {
            if( _touchType === "roll" )
                _needNextRefresh = _rollInteraction.handleRollTouch(_touchAngle);
            else
                _needNextRefresh = _rollInteraction.handleRoll(deltaX, deltaY, _moveXYZ);
        }
        this.stepMotionDelta();

        if( _camera.dirty )
            moved = true;

        return moved;
    };

    this.handleResize = function()
    {
        _rollInteraction.resize();
        _needNextRefresh = true;
    };

    function fingerSeparation(event)
    {
        var dx = event.pointers[1].clientX - event.pointers[0].clientX;
        var dy = event.pointers[1].clientY - event.pointers[0].clientY;
        var dist = Math.sqrt(dx * dx + dy * dy);

        // Normalize:
        var vp = _navapi.getScreenViewport();
        return dist / Math.min(vp.width, vp.height);
    }

    this.handleGesture = function( event )
    {
        switch( event.type )
        {
            // Single touch, fake the mouse for now...
            case "dragstart":
                _touchType = "drag";
                return this.handleButtonDown(event, 0);

            case "dragmove":
                return this.handleMouseMove(event);

            case "dragend":
                _touchType = null;
                return this.handleButtonUp(event, 0);


            // Rotate gesture detected:
            case "rotatestart":
                viewerApi.removeEventListener(et.CAMERA_CHANGE_EVENT, this.handleCameraChange);
                _touchType = "roll";
                _touchAngle = THREE.Math.degToRad(event.rotation);
                _touchCenter = {
                    x: (event.normalizedX + 1.0) * 0.5,
                    y: 1.0 - (event.normalizedY + 1.0) * 0.5
                };
                _touchDistance = fingerSeparation(event);
                return true;

            case "rotatemove":
                _touchAngle = THREE.Math.degToRad(event.rotation);
                return (_touchType === "roll");

            case "rotateend":
                viewerApi.addEventListener(et.CAMERA_CHANGE_EVENT, this.handleCameraChange);
                _touchAngle = THREE.Math.degToRad(event.rotation);
                _touchType = null;

                // Sigh... minor hack
                // Can't consume the end event because the hot gesture
                // tool needs to see it to end the interaction.
                return false;
        }
        return false;
    };

    this.handleWheelInput = function(delta)
    {
        // Disable wheel while roll active:
        return true;
    };

    this.handleCameraChange = function()
    {
        var viewVec = _navapi.getEyeVector();
        var distance = (_camera.near + _camera.far) * 0.5;
        viewVec.normalize().multiplyScalar(distance);
        var target = viewVec.add(_camera.position);

        // Setting the pivot causes an infinite loop of camera changed events. Is it necessary to set it?
        //this.utilities.savePivot();
        //this.utilities.setPivotPoint( target, true, true );
        //this.utilities.pivotActive(true);

        _rollInteraction.updateHUD( target, kRingSizeDefault );
    };

    this.handleButtonDown = function( event, button )
    {
        _startXYZ.x = (event.normalizedX + 1.0) * 0.5;
        _startXYZ.y = 1.0 - (event.normalizedY + 1.0) * 0.5;

        _moveXYZ.copy(_startXYZ);

        _isDragging = true;
        _touchType = null;

        this.controller.setIsLocked(true);

        viewerApi.removeEventListener(et.CAMERA_CHANGE_EVENT, self.handleCameraChange);

        return true;
    };

    this.handleButtonUp = function( event, button )
    {
        _moveXYZ.x = (event.normalizedX + 1.0) * 0.5;
        _moveXYZ.y = 1.0 - (event.normalizedY + 1.0) * 0.5;

        _isDragging = false;
        _needNextRefresh = true;    // To accept final motion.

        this.controller.setIsLocked(false);

        viewerApi.addEventListener(et.CAMERA_CHANGE_EVENT, self.handleCameraChange);

        return true;
    };

    this.handleMouseMove = function( event )
    {
        _moveXYZ.x = (event.normalizedX + 1.0) * 0.5;
        _moveXYZ.y = 1.0 - (event.normalizedY + 1.0) * 0.5;
        return true;
    };

    this.handleBlur = function(event)
    {
        _isDragging = false;
        _touchType = null;
        return false;
    };

};
