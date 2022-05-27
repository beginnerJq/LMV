
import * as et from "../application/EventTypes";
import { GlobalManagerMixin } from '../application/GlobalManagerMixin';
import { Prefs3D } from '../application/PreferenceNames'

// /** @constructor */
//
// TODO: Pass in the api instead of the impl, don't use the impl object.
//
export function OrbitDollyPanTool( viewerImpl, viewerApi, config )
{
    this.setGlobalManager(viewerApi.globalManager);

    var _this = this;
    var kScreenEpsilon = 0.001;
    var kEpsilon = 0.01;
    var kAutoDeltaZ  = 1.5;         // Dolly increment
    var kAutoDeltaXY = 0.01;
    var kAutoScreenXY = 20;
    var kDollyDragScale = config && config.hasOwnProperty('dollyDragScale') ? config.dollyDragScale : 100.0;
    var kDollyPinchScale = 0.5;
    var kOrbitScale = 2.0;

    var isMac = (navigator.userAgent.search("Mac OS") != -1);
    var _isPinchRotationDisabled = config && config.disablePinchRotation;

    var _navapi = viewerApi.navigation;
    var _camera = _navapi.getCamera();
    var _names = ["orbit", "freeorbit", "dolly", "pan"];

    var _activeMode = _names[0];
    var _activations = [ _activeMode ];   // Safeguard
    var _activatedMode = _activeMode;

    var _touchType = null;
    var _pinchScale = 1.0;
    var _prevPinchScale = 1.0;
    var _prevPinchLength = 0;
    var _pinchLength = 0;
    var _deltaRoll = 0.0;
    var _prevRoll = 0.0;

    var _useCustomCursors = true;
    var _activeModeLocked = false;
    var _autoCamStartXY = null;
    var _interactionActive = false;
    var _lastMouseX, _lastMouseY;

    var _keys = {
              SHIFT: 16,
            CONTROL: 17,
                ALT: 18,
              SPACE: 32,
             PAGEUP: 33,
           PAGEDOWN: 34,
               LEFT: 37,
                 UP: 38,
              RIGHT: 39,
               DOWN: 40,
               ZERO: 48,
             EQUALS: 187,
               DASH: 189
    };

    // Interaction Triggers:
    var kNone = -5;
    var kKeyboard = -4;
    var kWheel = -1;
    var kMouseLeft = 0;
    var kMouseMiddle = 1;
    var kMouseRight = 2;
    var kTouch = 3;

    var _activeTrigger = kNone;
    var _startXYZ = new THREE.Vector3();
    var _moveXYZ  = new THREE.Vector3();
    var _touchStartXY  = new THREE.Vector2();
    var _startXY  = new THREE.Vector2();
    var _moveXY   = new THREE.Vector2();
    var _deltaXY  = new THREE.Vector2();
    var _motionDelta = new THREE.Vector3();

    var _rotateStart = new THREE.Vector3();
    var _rotateEnd = new THREE.Vector3();
    var _pivotToEye = new THREE.Vector3();
    var _targetToEye = new THREE.Vector3();
    var _projVector = new THREE.Vector3();
    var _objectUp = new THREE.Vector3();
    var _mouseOnBall = new THREE.Vector3();
    var _rotateNormal = new THREE.Vector3();
    var _quaternion = new THREE.Quaternion();
    var _intersectionPlane = new THREE.Plane();
    var _noRoll = false;
    var _staticMoving = true;
    var _dynamicDampingFactor = 0.2;

    var _autoMove = [false, false, false, false, false, false];  // left, right, up, down, in, out
    var _modifierState = { SHIFT: 0, ALT: 0, CONTROL: 0, SPACE: 0 };

    this.active = false;

    // Remove rollover effect when mouse is not over the canvas.
    var _onMouseOut = function(event) {
        viewerImpl.renderer().rolloverObjectId(0, null, 0);
    };

    var kDampingFactor = 0.6;
    var kLookSpeedDefault = 5.0;
    var kDollySpeedDefault = 0.025;
    var kMinDollySpeed = 0.01;
    var kClosestDistance = 0.0005;
    var kDollyScale = config && config.hasOwnProperty('dollyScrollScale') ? config.dollyScrollScale : 0.6;

    var _trackingDistance = 1.0;
    var _boundingBox;

    var myLookSpeed = kLookSpeedDefault;
    var myDollySpeed = kDollySpeedDefault;

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
        this.active = true;
        // avp.logger.log("ACTIVATE: " + _activatedMode + " => " + name);
        _activations.push(name);
        _activatedMode = name;

        _useCustomCursors = viewerApi.prefs.get(Prefs3D.ENABLE_CUSTOM_ORBIT_TOOL_CURSOR);
        viewerApi.prefs.addListeners(Prefs3D.ENABLE_CUSTOM_ORBIT_TOOL_CURSOR, this._onPrefCursor);

        viewerImpl.canvas.addEventListener('mouseout', _onMouseOut);
        viewerApi.addEventListener(et.ESCAPE_EVENT, this.handleBlur);
    };

    this.deactivate = function(name)
    {
        this.active = false;

        viewerApi.prefs.removeListeners(Prefs3D.ENABLE_CUSTOM_ORBIT_TOOL_CURSOR, this._onPrefCursor);

        var end = _activations.length - 1;
        if( end > 0 && _activations[end] === name )
        {
            _activations.pop();
            _activatedMode = _activations[end-1];

            // avp.logger.log("DEACTIVATE: " + name + " => " + _activatedMode );
        }
        viewerImpl.canvas.removeEventListener('mouseout', _onMouseOut);
        viewerApi.removeEventListener(et.ESCAPE_EVENT, this.handleBlur);
    };

    this.isActive = function() {
        return this.active;
    }

    this.adjustDollyLookSpeed = function( direction )
    {
        if( direction === 0 )
        {
            myDollySpeed = kDollySpeedDefault;
            myLookSpeed  = kLookSpeedDefault;
        }
        else
        {
            myDollySpeed *= (direction > 0) ?  1.10 : 0.90;
            myLookSpeed  *= (direction > 0) ?  1.10 : 0.90;

            // May need more appropriate minimums (and maximums) here.
            if( myDollySpeed < 0.000001 )
                myDollySpeed = 0.000001;

            if( myLookSpeed < 0.000001 )
                myLookSpeed = 0.000001;
        }
    };

    this.getDollySpeed = function(dollyTarget, isZoomIn)
    {
        // Calculate the distance that one unit of virtual dolly will move:
        var speed;
        // In order to avoid bugs as described in BLMV-3936, when the zoom is not working properlly in orthoCamera when zooming towards pivot,
        // We want to compute the speed by orthoScale (which considers the "distance" between the camera and it's target)
        if ((_navapi.getZoomTowardsPivot() || _navapi.getWheelSetsPivot()) && !_camera.isPerspective && !_navapi.getIs2D()) {
            var distance = _camera.orthoScale * myDollySpeed;
            speed = (Math.abs(distance) < kClosestDistance && isZoomIn) ? 0 : distance;
        } else {
            var view     = _navapi.getEyeVector();
            var position = _navapi.getPosition();
            var projectedLength = dollyTarget.clone().sub(position).dot(view.normalize());
            var distance = projectedLength * myDollySpeed;
            speed = (Math.abs(distance) < kMinDollySpeed) ? ((distance < 0) ? -kMinDollySpeed : kMinDollySpeed) : distance;
        }

        return speed;
    };

    this.setPivotPointFromInput = function (inputX, inputY) {

        if( _navapi.getIs2D() || !_navapi.getWheelSetsPivot() ) {
            return;
        }

        var res = viewerImpl.hitTest(inputX, inputY, true);
        if (res && res.intersectPoint) {
            this.utilities.setPivotPoint( res.intersectPoint, true, true );
        } else {
            // When we don't get an intersection with the model, compute the hitPoint with a plane that is:
            // Parallel to the current near/far-plane
            // At the same distance as the previous pivot.
            const pivot = _navapi.getPivotPoint();
            const eye = _navapi.getEyeVector().normalize();
            const dist = -pivot.dot(eye);
            _intersectionPlane.set(eye, dist);

            const ray = viewerImpl.viewportToRay(viewerImpl.clientToViewport(inputX, inputY));
            let pos = ray.intersectPlane(_intersectionPlane);
            this.utilities.setPivotPoint( pos, true, true );
        }
    }

    /**
     * Get the dolly (zoom) scale value which is used for the scroll wheel.
     * @returns {Number} - dolly scroll scale
     */
    this.getDollyScrollScale = function()
    {
        return kDollyScale;
    }

    /**
     * Set the dolly (zoom) scale of the scroll wheel.
     * This value is used to calculate the distance of the camera.
     * The default value is 0.6.
     *
     * @example
     * // Zoom at a larger scale
     * viewer.toolController.getTool("dolly").setDollyScrollScale(2);
     *
     * // Zoom at a lower scale
     * viewer.toolController.getTool("dolly").setDollyScrollScale(0.1);
     *
     * @param {Number} dollyScale
     */
    this.setDollyScrollScale = function(dollyScale)
    {
        kDollyScale = dollyScale;
    }

    /**
     * Get the dolly (zoom) scale value which is used after enabling the zoom tool and dragging the mouse.
     * @returns {Number} - dolly drag scale
     */
    this.getDollyDragScale = function()
    {
        return kDollyDragScale;
    }

    /**
     * Set the dolly (zoom) scale of the zoom tool.
     * This value is used to calculate the distance of the camera.
     * The default value is 100.
     *
     * @example
     * // Zoom at a larger scale
     * viewer.toolController.getTool("dolly").setDollyDragScale(50);
     *
     * // Zoom at a lower scale
     * viewer.toolController.getTool("dolly").setDollyDragScale(200);
     *
     * @param {Number} dollyScale
     */
    this.setDollyDragScale = function(dollyDragScale)
    {
        kDollyDragScale = dollyDragScale;
    }

    this.getLookSpeed = function()
    {
        return myLookSpeed;
    };

    this.coiIsActive = function()
    {
        return _navapi.getPivotSetFlag() && _navapi.isPointVisible(_navapi.getPivotPoint());
    };

    this.adjustSpeed = function( direction )
    {
        this.adjustDollyLookSpeed( direction );

        if( this.utilities.autocam )
            this.utilities.autocam.orbitMultiplier = this.getLookSpeed();
    };

    this.getTriggeredMode = function()
    {
        // Fusion wants Shift+Middle to go back to orbit
        if ((_activeTrigger === kMouseMiddle) && _modifierState.SHIFT)
            return _activations[1]; // TODO_NOP: return to chosen orbit behavior, don't use _activations

        return (isDolly() || _motionDelta.z !== 0.0) ? shouldPanOverrideDolly() ? "pan" : "dolly"
            : isTrack() ? "pan"
            : (_touchType === 'pan' || _touchType === 'pinch') ? "dollypan"
            : _activatedMode;
    }

    // TO DO: Where/when do we push/pop tool state?
    function isTrack()
    {
        var mod = _modifierState;
        return ((_activeTrigger === kMouseRight)  && !mod.SHIFT && !(mod.ALT ^ mod.CONTROL))
            || ((_activeTrigger === kMouseRight)  && mod.SHIFT && mod.CONTROL)
            || ((_activeTrigger === kMouseMiddle) && !mod.SHIFT && !mod.CONTROL)
            || ((_activeTrigger === kMouseMiddle) && mod.ALT)
            || ((_activeTrigger === kMouseMiddle) && mod.CONTROL && !mod.ALT)
            || ((_activeTrigger === kMouseLeft) && mod.SHIFT && !mod.CONTROL && !mod.ALT)
            || ((_activatedMode === "pan") && (_activeTrigger !== kMouseMiddle) && !mod.ALT && !(_touchType === "pinch"))
            || (mod.SPACE);
    }

    function isDolly()
    {
        var mod = _modifierState;
        return ((_activeTrigger === kMouseRight)  && mod.SHIFT && !mod.ALT && !mod.CONTROL)
            || ((_activeTrigger === kMouseRight)  && mod.ALT && !mod.SHIFT && !mod.CONTROL)
            || ((_activatedMode === "dolly") && !mod.ALT && !(_touchType === "pinch"))
    }

    function shouldPanOverrideDolly()
    {
        var mod = _modifierState;
        return !mod.CONTROL && !mod.ALT && !mod.SHIFT && (_activeTrigger === kMouseRight || _activeTrigger === kMouseMiddle);
    }

    this.initTracking = function(x, y)
    {
        var distance;

        if( !_camera.isPerspective )
        {
            distance = _navapi.getEyeVector().length();
        }
        else
        {
            // Decide what point in world space defines the plane
            // orthogonal to the view that will be used to track
            // the camera. If we get an intersection point use it,
            // otherwise if the pivot point is set use that. The
            // fallback is to use the mid-point of the view frustum.

            distance = (_camera.near + _camera.far) * 0.5;

            var p = this.utilities.getHitPoint(x, y);
            var position = _navapi.getPosition();
            if( p && p.sub )
            {
                // Calculate orthogonal distance along view vector:
                var hitToEye = p.sub(position);
                var view = _navapi.getEyeVector().normalize();
                distance = Math.abs(view.dot(hitToEye));
            }
            else
            {
                var usePivot = _navapi.getPivotSetFlag() && _navapi.isPointVisible(_navapi.getPivotPoint());
                if( usePivot )
                {
                    var pivotDistance = _navapi.getPivotPlaneDistance();
                    if( pivotDistance > kEpsilon )
                    {
                        distance = pivotDistance;
                    }
                }
            }
        }
        _trackingDistance = distance;
    };

    function pivotIsBehind()
    {
        if (!_camera.isPerspective)
            return false;


        var pivotVector = _navapi.getPivotPoint().sub(_navapi.getPosition());
        return (pivotVector.dot(_navapi.getEyeVector()) <= 0.0);
    }

    this.initOrbit = function()
    {
        // If the pivot point is behind us we pivot around the center of the view:
        this.utilities.setTemporaryPivot(pivotIsBehind() ?  _navapi.getTarget() : null);
    };

    this.getActiveMode = function()
    {
        return _activeMode;
    };

    this.getCursor = function()
    {
        if (!_useCustomCursors)
            return null;

        switch( _activeMode )
        {
            case "freeorbit":
            case "orbit":
                return 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAt1BMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8AAAAzMzP6+vri4uISEhKKioqtra2dnZ2EhIR9fX10dHRkZGQdHR3t7e3Hx8e5ubm1tbWoqKhWVlZKSko4ODgICAjv7+/o6OjMzMyxsbFOTk4pKSkXFxcEBAT29vbW1tZ6enpISEgLCwvhzeX+AAAAGXRSTlMANRO0nHRJHfnskIxQRKh89syDVwTWZjEJxPFEswAAAOFJREFUKM+1j+lygkAQhIflEAJe0Rw9u4CCeKKoSTTX+z9XoMJWWeX+ssrvZ3f19DQ5zOw/0DUMQPlmQ72bE2adBp8/Rp3CQUi3ILx+bxj4fjDs9T1Bmo6bbPPN8aDU4bjJt4nb+de789kSFyxn826jW3ICLNZZKU8nWWbrBTCRVm04U8TpjquRFf1Go0d7l8aYOrUR7FGEFr1S9LGymwthgX2gE/Kl0cHPOtF2xOWZ5QpIC93RflW4InkDoPRXesd5LJIMQPzV7tCMa7f6BvhJL79AVDmYTNQ1NhnxbI/uwB8H5Bjd4zQPBAAAAABJRU5ErkJggg==), auto';

            case "dolly":
                return "url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAgVBMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8mJiYAAADNzc2/v7+fn59paWlPT08MDAwICAj6+vqpqak7Ozv29vby8vLp6em2traAgIBkZGRZWVlAQEAaGhpISEgkS7tbAAAAFHRSTlMAOvhpZD8mkQWegMy9qY1YVE01EYiqlE0AAADZSURBVCjPbY9ZloMgEAAbEbfsmRZZXbJn7n/AAX2RQVN/VD26AXLOeZLDGo6IbfI9tHq8cdxuj1HwvgCoaiHqKoRk+M3hB9jueUW8PnfsE/bJ3vms7nCkq7NoE3s99AXxoh8vFoXCpknrn5faAuJCenT0xPkYqnxQFJaU0gdZrsKm8aHZrAIffBj40mc1jsTfIJRWegq6opTMvlfqLqYg7kr1ZB7jFgeaMC59N//8O4WZ1IiPF8b5wMHcJn8zB4g4mc77zpxgAbMSUVoGK4iV0hL4wrksz+H0Bw5+E+HrniDQAAAAAElFTkSuQmCC), auto";

            case "pan":
                return "url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAABHVBMVEUAAABPTk4AAAAAAAAJCQkRERE0MzQQEBAODg4QEBB4d3dbWlo9PDw/Pj4vLy8sLCwZGBgWFhYcHBwKCgoSEhIAAAAKCgoICAgKCgoQEBAODg4EBAQICAgPDw8REREMDAx2dnY0NDQvLy9QUFAaGhomJSYjIyM7OjokJCQNDA0mJiYNDQ0AAAAUFBQJCQkQEBAEBAQNDQ0PDw8VFRX///+amJkAAAD5+fnz8/PKycn9/f339vbi4eLR0dDNzMyAgIB8e3xycHH7+/vw7+/o6OjX1ta7urq4t7iwsLCnp6eioqKbmppva21OTk74+Pjl5eXc3Nzb29vLy8vDw8PDwsKrqqqdnZ2WlpaSkpKTkZKMiouEg4NkZGRISEgxLzBpgbsEAAAANHRSTlMA+fiQXgngKSYG/vX17uvBuqackpCNg3BpUkpAPBwTDvj18+vl0s/NwrOwoZZ+TDg4NBkBGrzX8QAAAP5JREFUKM99j9Vuw0AQRdeuKZyGkyZNmbnXDLHDVGb8/8/oy7paK1bO0+oc7WiGnGiaxq+QRTQAOh8f9Jv4H/Ge8PZPrCdlvkxfYluUT2WyyCq3mZ7unwlKVLcqOzA/Mf71j0TWJ/Ym6rPeca05Ni4iIevYc7yoUD2zQFhq71BdI9nvBeBabFDSPe8DswlUc1Riw3VxbH0NHBUPQ0jrbDnPYDjALQBMq9E7nkC5y7VDKTZlUg8Q0lmjvl74zlYErgvKa42GPKf3/a0kQmYCDY1SYMDosqMoiWrGwz/uAbNvc/fNon4kXRKGq+PUo2Mb96afV0iUxqGU2s4VBbKUP65NL/LKF+7ZAAAAAElFTkSuQmCC), auto";
        }
        return null;
    };

    this.getMotionDelta = function(dxyz, dxy)
    {
        // Add any offset triggered by key controls:
        // TODO: Change these to scale based on real time so fast frame
        // rate doesn't cause super fast motion.

        var autoDeltaZ = (_navapi && _navapi.getReverseZoomDirection()) ? -kAutoDeltaZ : kAutoDeltaZ;
        if( isMac )
            autoDeltaZ *= -1;   // Match the "natural" scroll direction on Mac.

        if( _autoMove[0] ) { _moveXYZ.x += kAutoDeltaXY; _moveXY.x += kAutoScreenXY; }
        if( _autoMove[1] ) { _moveXYZ.x -= kAutoDeltaXY; _moveXY.x -= kAutoScreenXY; }
        if( _autoMove[2] ) { _moveXYZ.y += kAutoDeltaXY; _moveXY.y += kAutoScreenXY; }
        if( _autoMove[3] ) { _moveXYZ.y -= kAutoDeltaXY; _moveXY.y -= kAutoScreenXY; }
        if( _autoMove[4] ) { _moveXYZ.z += autoDeltaZ; }
        if( _autoMove[5] ) { _moveXYZ.z -= autoDeltaZ; }

        var deltaX = _moveXYZ.x - _startXYZ.x;
        var deltaY = _moveXYZ.y - _startXYZ.y;
        var deltaZ = _moveXYZ.z - _startXYZ.z;

        if( Math.abs(deltaX) < kScreenEpsilon ) deltaX = 0.0;
        if( Math.abs(deltaY) < kScreenEpsilon ) deltaY = 0.0;
        if( Math.abs(deltaZ) < kScreenEpsilon ) deltaZ = 0.0;

        dxyz.set(deltaX, deltaY, deltaZ);

        if( dxy )
        {
            dxy.set(_moveXY.x - _startXY.x, _moveXY.y - _startXY.y);
        }
    };

    this.stepMotionDelta = function(delta, damped)
    {
        if( damped )
        {
            _startXYZ.x += delta.x * kDampingFactor;
            _startXYZ.y += delta.y * kDampingFactor;
            _startXYZ.z += delta.z * kDampingFactor;
        }
        else
            _startXYZ.copy(_moveXYZ);

        _startXY.copy(_moveXY);
    };

    function getMouseProjectionOnBall(pageX, pageY)
    {
        var _window = _this.getWindow();
        var viewport = {left: 0, top: 0, width: _window.innerWidth, height: _window.innerHeight};

        _mouseOnBall.set(
            (pageX - viewport.width * 0.5 - viewport.left) / (viewport.width * 0.5),
            (viewport.height * 0.5 + viewport.top - pageY) / (viewport.height * 0.5),
            0.0
        );

        var length = _mouseOnBall.length();
        if (_noRoll)
        {
            if (length < Math.SQRT1_2)
            {
                _mouseOnBall.z = Math.sqrt(1.0 - length*length);
            }
            else
            {
                _mouseOnBall.z = .5 / length;
            }
        }
        else if (length > 1.0)
        {
            _mouseOnBall.normalize();
        }
        else
        {
            _mouseOnBall.z = Math.sqrt(1.0 - length * length);
        }
        _pivotToEye.copy(_camera.position).sub(_camera.pivot);
        _projVector.copy(_camera.up).setLength(_mouseOnBall.y)
        _projVector.add(_objectUp.copy(_camera.up).cross(_pivotToEye).setLength(_mouseOnBall.x));
        _projVector.add(_pivotToEye.setLength(_mouseOnBall.z));
        return _projVector;
    }

    function freeOrbit()
    {
        if (!_navapi.isActionEnabled('orbit')) {
            return;
        }

        _pivotToEye.subVectors(_camera.position, _camera.pivot);
        _targetToEye.subVectors(_camera.position, _camera.target);
        var targetDist = _targetToEye.length();
        _targetToEye.normalize();

        var angle = Math.acos(_rotateStart.dot(_rotateEnd) / _rotateStart.length() / _rotateEnd.length());
        if (angle)
        {
            angle *= kOrbitScale;
            _rotateNormal.crossVectors(_rotateStart, _rotateEnd).normalize();
            _quaternion.setFromAxisAngle(_rotateNormal, -angle);

            _pivotToEye.applyQuaternion(_quaternion);
            _camera.up.applyQuaternion(_quaternion);
            _rotateEnd.applyQuaternion(_quaternion);
            _targetToEye.applyQuaternion(_quaternion);

            if (_staticMoving)
            {
                _rotateStart.copy(_rotateEnd);
            }
            else
            {
                _quaternion.setFromAxisAngle(_rotateNormal, angle * (_dynamicDampingFactor - 1.0));
                _rotateStart.applyQuaternion(_quaternion);
            }
        }

        _camera.position.addVectors(_camera.pivot, _pivotToEye);
        _camera.target.subVectors(_camera.position, _targetToEye.multiplyScalar(targetDist));
        _camera.dirty = true;
    }

    this.getFitBounds = function()
    {
        if (this.utilities.viewerImpl.zoomBoundsChanged){
            _boundingBox = this.utilities.viewerImpl.getVisibleBounds(true);
            this.utilities.viewerImpl.zoomBoundsChanged = false;
        }

        return _boundingBox;
    };

    this.update = function()
    {
        var wheelEnded = false;
        var updatePivot = false;
        var viewport;

        this.getMotionDelta(_motionDelta, _deltaXY);

        var deltaX = _motionDelta.x;
        var deltaY = _motionDelta.y;
        var deltaZ = _motionDelta.z;

        if( !_activeModeLocked )
            this.checkInteractionMode();

        _activeModeLocked = (_activeTrigger > kWheel);

        if( _activeModeLocked )
            this.controller.setIsLocked(true);

        if( deltaX !== 0.0 || deltaY !== 0.0 || deltaZ !== 0.0 )
        {
            switch( _activeMode )
            {
                case "orbit":
                    if( this.utilities.autocam && this.utilities.autocam.startState )
                    {
                        _deltaXY.x = -_deltaXY.x;
                        if( _autoCamStartXY )
                            this.utilities.autocam.orbit(_moveXY, _autoCamStartXY, _deltaXY.multiplyScalar(kOrbitScale), this.utilities.autocam.startState);
                    }
                    break;

                case "freeorbit":
                    freeOrbit();
                    break;

                case "dolly":
                    var dollyTarget;
                    var screen = new THREE.Vector2();

                    deltaZ *= kDollyScale;

                    if( _activeTrigger >= kMouseLeft )
                    {
                        // Map XY movement to Z:
                        deltaY = -deltaY;   // Invert Y
                        deltaZ = (Math.abs(deltaX) > Math.abs(deltaY)) ? deltaX : deltaY;

                        if (_navapi.getReverseZoomDirection()) {
                             deltaZ *= -1;
                        }

                        deltaZ *= kDollyDragScale;
                        deltaX = 0.0;
                        deltaY = 0.0;

                        // Towards center of viewport:
                        screen = _navapi.viewportToScreen(0, 0);
                    }
                    else
                    {
                        // Towards cursor position:
                        viewport = _navapi.getScreenViewport();
                        if (_lastMouseX && _lastMouseY)
                        {
                            screen.x = _lastMouseX / viewport.width;
                            screen.y = _lastMouseY / viewport.height;
                        }
                        else
                        {
                            screen = _navapi.viewportToScreen(0, 0);
                        }
                    }
                    if( !_navapi.getIs2D() && _navapi.getZoomTowardsPivot() )
                    {
                        if( !this.coiIsActive() )
                        {
                            // Center of viewport if pivot is not active
                            screen = _navapi.viewportToScreen(0, 0);
                            dollyTarget = _navapi.getWorldPoint(screen.x, screen.y);
                        }
                        else
                            dollyTarget = _navapi.getPivotPoint();
                    }
                    else
                        dollyTarget = _navapi.getWorldPoint(screen.x, screen.y);

                    _navapi.dollyFromPoint(deltaZ * this.getDollySpeed(dollyTarget, deltaZ < 0), dollyTarget, this.getFitBounds());
                    break;

                case "pan":
                    // Moving camera down/left moves the model up/right:
                    _navapi.panRelative(-deltaX, deltaY, _trackingDistance);
                    break;

                case "dollypan":

                    if( deltaX !== 0.0 || deltaY !== 0.0 )
                        _navapi.panRelative(-deltaX, deltaY, _trackingDistance);

                    // Towards cursor position:
                    viewport = _navapi.getScreenViewport();
                    dollyTarget = _navapi.getWorldPoint(_lastMouseX / viewport.width, _lastMouseY / viewport.height);

                    var position = _navapi.getPosition();
                    var distance = _navapi.getIs2D() ? position.sub(dollyTarget).length() : _trackingDistance;
                    var touchScale = _prevPinchLength / _pinchLength - 1;

                    var distanceDelta = touchScale * distance;

                    _navapi.dollyFromPoint(distanceDelta, dollyTarget, this.getFitBounds());

                    var vview   = new THREE.Vector3();
                    var qrotate = new THREE.Quaternion();

                    var up = _navapi.getCameraUpVector();
                    var view = vview.copy(_camera.position).sub(_camera.target).normalize();
                    qrotate.setFromAxisAngle( view, _deltaRoll * 1.2 );
                    up.applyQuaternion( qrotate );

                    if (!_navapi.getIs2D() && !(_isPinchRotationDisabled && (_touchType === 'pinch' || _touchType === 'pan')))
                        _navapi.setCameraUpVector(up);

                    _prevPinchLength = _pinchLength;
                    _prevPinchScale = _pinchScale;
                    _trackingDistance = distance + distanceDelta;
                    break;
            }
            updatePivot = true;
        }
        this.stepMotionDelta(_motionDelta, (_activeMode !== "pan" && _activeMode !== 'dollypan'));

        // If a wheel event triggered this we've now handled it,
        if( _activeTrigger === kWheel && Math.abs(deltaZ) < kEpsilon )
        {
            this.interactionEnd(kWheel);

            //Clamp the motion vector to zero too, so that motion stops.
            //Otherwise zooming continues in tiny deltas that prevent
            //progressive repaint from starting.
            _moveXYZ.z = 0;
            _startXYZ.z = 0;

            wheelEnded = true;
            updatePivot = true;
        }

        // Show pivot if a clutch key is being held.
        if( (_modifierState.SHIFT || _modifierState.ALT) && (_names.indexOf(viewerApi.getActiveNavigationTool()) !== -1)) {
            updatePivot = true;
        }

        // If the interaction has "ended" we can now forget the trigger.
        if( !_interactionActive && (wheelEnded || (_activeTrigger > kNone)) )
        {
            if( _activeTrigger > kWheel )
            {
                // Kill any ongoing damped motion if we aren't using
                // the wheel.
                _startXYZ.copy(_moveXYZ);

                this.utilities.removeTemporaryPivot();
            }
            this.utilities.autocam.endInteraction();
            _activeTrigger = kNone;
            if( _activeModeLocked )
                this.controller.setIsLocked(false);
            _activeModeLocked = false;
            _autoCamStartXY = null;
            _touchType = null;
        }
        if( updatePivot )
            this.utilities.pivotActive(_navapi.getPivotSetFlag(), (_activeTrigger <= kWheel));
        else
            this.utilities.pivotUpdate();

        return _camera.dirty;
    };


    this.checkInteractionMode = function()
    {
        var newMode = this.getTriggeredMode();

        if( newMode !== _activeMode )
        {
			_activeMode = newMode;

            if( (_activeMode === "pan" && _activeTrigger > kWheel) || (_activeMode === "dollypan") )
                this.initTracking(_startXYZ.x, _startXYZ.y);
        }
    };

    this.interactionStart = function(trigger, force)
    {
        // Just a simple way to give device input a sort of priority
        // so we don't have to track all active triggers. Just remember
        // the most recent with highest "priority".
        if( force || trigger > _activeTrigger )
        {
            // Perhaps we need to remember the modifier keys now.
            _activeTrigger = trigger;
            _interactionActive = true;

            if( trigger > kWheel )
            {
                if( _activeMode === "pan" )
                    this.initTracking(_startXYZ.x, _startXYZ.y);

                if( _activeMode === "orbit" )
                    this.initOrbit();
            }
            !_navapi.getSelectionSetsPivot() && this.utilities.pivotActive(_navapi.getPivotSetFlag(), (trigger === kWheel));

            if( this.utilities.autocam )
            {
                this.utilities.autocam.sync(_camera);
                this.utilities.autocam.startInteraction(_startXY.x, _startXY.y);
                _autoCamStartXY = _startXY.clone();
            }
        }
    };

    this.interactionCheck = function()
    {
        // Restart keyboard interaction if certain keys are still down:
        //
        if( _autoMove[0]
         || _autoMove[1]
         || _autoMove[2]
         || _autoMove[3]
         || _autoMove[4]
         || _autoMove[5]
         || _modifierState.SHIFT
         || _modifierState.CONTROL
         || _modifierState.ALT
         || _modifierState.SPACE ) this.interactionStart(kKeyboard, true);
    };

    this.interactionEnd = function(trigger)
    {
        if( trigger === _activeTrigger )
        {
            if( trigger !== kWheel )
                this.utilities.pivotActive(false);

            // We have to leave the _activeTrigger set until the
            // next update occurs so the update will apply the correct
            // operation.
            _interactionActive = false;
        }
    };

    this.isInteractionActive = function() {
        return _interactionActive;
    };

    // ------------------------
    // Event handler callbacks:
    // These can use "this".


    this.handleWheelInput = function(delta, event)
    {
        _lastMouseX = event.canvasX;
        _lastMouseY = event.canvasY;

        if( this.isDragging )
            return false;

        //Auto-update the center of zoom (pivot) to center on the cursor
        //on mouse wheel.
        if( _navapi.getIs2D() ) {
            // TODO: Perhaps this should be in the update method
            // to avoid unnecessary calls.
            var viewport = _navapi.getScreenViewport();
            var point = viewerImpl.intersectGround(_lastMouseX + viewport.width, _lastMouseY + viewport.height);
            this.utilities.setPivotPoint( point, true, true );
        } else {
            this.setPivotPointFromInput(_lastMouseX, _lastMouseY);
        }

        if( _navapi.getReverseZoomDirection() )
            delta *= -1;

        _moveXYZ.z += delta;

        if( delta != 0.0 )
            this.interactionStart(kWheel);

        return true;
    };

    this.resetKeys = function()
    {
        // Turn off any auto motion that may be stuck due to lost focus
        this.autoMove(-1, false);

        // Clear modifier states:
        _modifierState.SHIFT = 0;
        _modifierState.CONTROL = 0;
        _modifierState.ALT = 0;
        _modifierState.SPACE = 0;
    };

    this.autoMove = function(index, state)
    {
        if( !state || !this.isDragging )
        {
            if( index < 0 )
                _autoMove[0] =
                _autoMove[1] =
                _autoMove[2] =
                _autoMove[3] =
                _autoMove[4] =
                _autoMove[5] = state;
            else
                _autoMove[index] = state;

            if( !state )
                this.interactionEnd(kKeyboard);

            this.interactionCheck();
        }
    };

    this.updateModifierState = function( event )
    {
        /* See SPK-930 and SPK-928
        _modifierState.CONTROL = ((isMac && event.metaKey) || (!isMac && event.ctrlKey)) ? 1 : 0;
         */
        _modifierState.CONTROL = ((isMac && event.metaKey) || event.ctrlKey) ? 1 : 0;
        _modifierState.SHIFT = (event.shiftKey) ? 1 : 0;
        _modifierState.ALT = (event.altKey) ? 1 : 0;
    };

    this.handleKeyDown = function( event, keyCode )
    {
        this.updateModifierState(event);
        var handled = false;

        // On Mac KeyUp events are swallowed while CMD/Meta is pressed and there is no workaround
        // In that case we don't even allow movement to happen
        if( isMac && _modifierState.CONTROL) {
            this.autoMove(-1, false);
            this.interactionEnd(kKeyboard); // Verify interaction didn't start again inside autoMove->interactionCheck
            return false;
        }

        switch( keyCode )
        {
            case _keys.EQUALS: this.adjustSpeed(1);  handled = true; break;
            case _keys.DASH:   this.adjustSpeed(-1); handled = true; break;
            case _keys.ZERO:   this.adjustSpeed(0);  handled = true; break; // Reset dolly speed to default

            case _keys.LEFT:     this.autoMove(0, true); handled = true; break;
            case _keys.RIGHT:    this.autoMove(1, true); handled = true; break;
            case _keys.PAGEUP:   this.autoMove(2, true); handled = true; break;
            case _keys.PAGEDOWN: this.autoMove(3, true); handled = true; break;
            case _keys.UP:       this.autoMove(4, true); handled = true; break;
            case _keys.DOWN:     this.autoMove(5, true); handled = true; break;

            default:
                return false;
        }
        if( !this.isDragging )
            this.interactionStart(kKeyboard);

        return handled;
    };

    this.handleKeyUp = function( event, keyCode )
    {
        this.updateModifierState(event);
        var handled = false;

        // On Mac KeyUp events are swallowed while CMD/Meta is pressed and there is no workaround
        // We just stop interactions in that case
        if( isMac && _modifierState.CONTROL) {
            this.autoMove(-1, false);
            this.interactionEnd(kKeyboard); // Verify interaction didn't start again inside autoMove->interactionCheck
            return false;
        }

        switch( keyCode )
        {
            case _keys.LEFT:     this.autoMove(0, false); handled = true; break;
            case _keys.RIGHT:    this.autoMove(1, false); handled = true; break;
            case _keys.PAGEUP:   this.autoMove(2, false); handled = true; break;
            case _keys.PAGEDOWN: this.autoMove(3, false); handled = true; break;
            case _keys.UP:       this.autoMove(4, false); handled = true; break;
            case _keys.DOWN:     this.autoMove(5, false); handled = true; break;

            default:
                return false;
        }
        if( handled )
        {
            this.interactionEnd(kKeyboard);

            if( !_interactionActive )
                this.interactionCheck();
        }
        return handled;
    };

    function endsWith(str, suffix)
    {
        return str.indexOf(suffix, str.length - suffix.length) !== -1;
    }

    function fingerSeparation(event)
    {
        var dx = event.pointers[1].clientX - event.pointers[0].clientX;
        var dy = event.pointers[1].clientY - event.pointers[0].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    this.handleDollyPan = function(event)
    {
        _lastMouseX = event.canvasX;
        _lastMouseY = event.canvasY;

        var viewport = _navapi.getScreenViewport();
        _moveXY.x  = _lastMouseX;
        _moveXY.y  = _lastMouseY;
        _moveXYZ.x = _moveXY.x / viewport.width;
        _moveXYZ.y = _moveXY.y / viewport.height;

        _pinchLength = fingerSeparation(event);

        var roll = THREE.Math.degToRad(event.rotation);
        _deltaRoll = roll - _prevRoll;
        if (Math.abs(_deltaRoll) > 1.0)
            _deltaRoll = 0;
        _prevRoll = roll;

        if( endsWith(event.type, "start") )
        {
            _prevPinchLength = _pinchLength;
            _prevPinchScale = 1.0;
            _deltaRoll = 0;
            _prevRoll = roll;
        }

        _pinchScale = event.scale;
    };

    this.handleGesture = function( event )
    {
        switch( event.type )
        {
            case "dragstart":
                _touchType = "drag";
                // Single touch, fake the mouse for now...
                return this.handleButtonDown(event, 0);

            case "dragmove":
                if( _touchType !== "drag" ) {
                    this.handleButtonDown(event, 0);
                    _touchType = "drag";
                }
                return this.handleMouseMove(event);

            case "dragend":
                // We seem to often get a lone dragend after a multi-touch.
                if( _touchType === "drag" )
                {
                    this.handleButtonUp(event, 0);
                    _touchType = null;
                    return true;
                }
                return false;


            case "panstart":
                _touchType = "pan";
                this.handlePanStart(event);
                this.handleDollyPan(event);
                return true;

            case "panmove":
                if( _touchType !== "pan" ) {
                    _touchType = "pan";
                    this.handlePanStart(event);
                }
                return this.handleDollyPan(event);

            case "panend":
                if( _touchType === "pan" )
                {
                    this.isDragging = false;
                    this.handleDollyPan(event);
                    this.interactionEnd(kTouch);
                    return true;
                }
                return false;


            case "pinchstart":

                this.setPivotPointFromInput(event.center.x, event.center.y);

                this.isDragging = true;
                _touchType = "pinch";

                _startXYZ.x = (event.normalizedX + 1.0) * 0.5;
                _startXYZ.y = 1.0 - (event.normalizedY + 1.0) * 0.5;

                _touchStartXY.set(event.canvasX, event.canvasY);
                _startXY.set(event.canvasX, event.canvasY);

                _activeModeLocked = false;
                this.interactionStart(kTouch);
                this.handleDollyPan(event);
                return true;

            case "pinchmove":
                return (_touchType === "pinch") ? this.handleDollyPan(event) : false;

            case "pinchend":
                if( _touchType === "pinch" )
                {
                    this.isDragging = false;
                    this.handleDollyPan(event);
                    this.interactionEnd(kTouch);
                    return true;
                }
                return false;
        }
        return false
    };

    this.handleButtonDown = function( event, button )
    {
        this.updateModifierState(event);

        _startXYZ.x = (event.normalizedX + 1.0) * 0.5;
        _startXYZ.y = 1.0 - (event.normalizedY + 1.0) * 0.5;

        _startXY.set(event.canvasX, event.canvasY);
        _moveXYZ.copy(_startXYZ);
        _moveXY.copy(_startXY);

        _rotateStart.copy(getMouseProjectionOnBall(event.canvasX, event.canvasY));
        _rotateEnd.copy(_rotateStart);

        _lastMouseX = event.canvasX;
        _lastMouseY = event.canvasY;

        this.isDragging = true;

        this.interactionStart(button);
        return true;
    };

    this.handlePanStart = function (event) {
        this.isDragging = true;

        _startXYZ.x = (event.normalizedX + 1.0) * 0.5;
        _startXYZ.y = 1.0 - (event.normalizedY + 1.0) * 0.5;

        _touchStartXY.set(event.canvasX, event.canvasY);
        _startXY.set(event.canvasX, event.canvasY);

        this.interactionStart(kTouch);
        return true;
    };

    this.handleButtonUp = function( event, button )
    {
        this.updateModifierState(event);

        _moveXYZ.x = (event.normalizedX + 1.0) * 0.5;
        _moveXYZ.y = 1.0 - (event.normalizedY + 1.0) * 0.5;
        _moveXY.set(event.canvasX, event.canvasY);

        _rotateEnd.copy(getMouseProjectionOnBall(event.canvasX, event.canvasY));
        _rotateStart.copy(_rotateEnd);

        _lastMouseX = event.canvasX;
        _lastMouseY = event.canvasY;

        this.interactionEnd(button);

        this.isDragging = false;
        return true;
    };

    this.handleMouseMove = function( event )
    {
        this.updateModifierState(event);

        //Handles non-dragging mouse move over the canvas.
        //Updates the last known mouse point for
        //using during mouse wheel (as zoom center) and
        //will eventually be needed for mouse over highlighting
        if(!this.isDragging )
        {
            _startXYZ.x = (event.normalizedX + 1.0) * 0.5;
            _startXYZ.y = 1.0 - (event.normalizedY + 1.0) * 0.5;

            _startXY.set(event.canvasX, event.canvasY);
            _moveXYZ.x = _startXYZ.x;
            _moveXYZ.y = _startXYZ.y;
            _moveXY.copy(_startXY);

            _lastMouseX = event.canvasX;
            _lastMouseY = event.canvasY;

            // mouse over highlighting
            // TODO: Perhaps this should be in the update method
            // to avoid unnecessary calls.
            if(event.target === viewerImpl.canvas)
            {
                viewerImpl.rolloverObject(_lastMouseX, _lastMouseY);
            }

            return false;
        }
        _moveXYZ.x = (event.normalizedX + 1.0) * 0.5;
        _moveXYZ.y = 1.0 - (event.normalizedY + 1.0) * 0.5;
        _moveXY.set(event.canvasX, event.canvasY);

        _rotateEnd.copy(getMouseProjectionOnBall(event.canvasX, event.canvasY));

        _lastMouseX = event.canvasX;
        _lastMouseY = event.canvasY;

        return true;
    };

    this.handleBlur = (event) => {
        // Reset things when we lose focus...
        this.resetKeys();
        this.interactionEnd(_activeTrigger);
    }

    // private
    this._onPrefCursor = function(value) {
        _useCustomCursors = value;
    }.bind(this);


}

GlobalManagerMixin.call(OrbitDollyPanTool.prototype);
