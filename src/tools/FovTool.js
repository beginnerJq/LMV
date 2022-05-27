
import * as THREE from "three";

export function FovTool( viewerApi )
{
    var kScreenEpsilon = 0.001;
    var kEpsilon = 0.00001;
    var kFovDragScale = -1.0;
    var kDampingFactor = 0.6;
    var kWheelThresholdMs = 100;

    var _navapi = viewerApi.navigation;
    var _camera = _navapi.getCamera();
    var _names = ["fov"];

    var _interactionActive = false;

    var _wheelAccum = 0;
    var _wheelOldest = null;
    var _wheelNewest = null;
    var _wheelContinuous = false;

    var _mouseButtons = 0; // Track mouse buttons that are held

    // Interaction Triggers:
    var kNone = -5;
    var kWheel = -1;
    var kMouseLeft = 0;
    var kMouseMiddle = 1;
    var kMouseRight = 2;

    var _activeTrigger = kNone;
    var _startXYZ = new THREE.Vector3();
    var _moveXYZ  = new THREE.Vector3();
    var _motionDelta = new THREE.Vector3();
    var _touchType = null;
    
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
        _mouseButtons = 0;
    };

    this.deactivate = function(name)
    {
        _activeTrigger = kNone;
    };
    
    this.getCursor = function()
    {
        return _mouseButtons !== 0 && _activeTrigger === kNone ? null : "url(data:image/x-icon;base64,AAACAAEAGBgAAAAAAACICQAAFgAAACgAAAAYAAAAMAAAAAEAIAAAAAAAYAkAABMLAAATCwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlgAAAP8AAAD/AAAAlgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAACEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////////////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAnAwMD/yEhIf8AAABmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////////////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAGknJyf/goKC/8/Pz/8aGhr/AAAALQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////////////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAABTFBQU/2lpaf/MzMz///////////+Wlpb/AAAAlgAAAAAAAAAAAAAAAAAAAAAAAAAKAAAAAAAAAAAAAAAAAAAAlgAAAP8AAAD/AAAAlgAAAAAAAAAAAAAAOAAAAKFTU1P/t7e3////////////8PDw////////////AQEB/wAAAAEAAAAAAAAAFAAAAH0KCgr/AAAAYwAAAAAAAAAAAAAAlgAAAP8AAAD/AAAAlgAAAAAAAAAjCwsL/6Ghof/t7e3///////Dw8P9MTEz/LS0t//Pz8///////Ghoa/wAAABoAAAANDQ0N/319ff+rq6v/Y2Nj/wAAAK8AAABGAAAA////////////AAAA/wAAAF0hISH/jIyM////////////sLCw/xEREf8AAACHAAAArKysrP//////V1dX/wAAAFcAAABSUlJS//f39///////8PDw/6+vr/86Ojr/LS0t////////////FRUV/1xcXP/Gxsb/+Pj4//Hx8f9MTEz/AAAAsAAAAEcAAAAAAAAAZ2dnZ///////pKSk/wAAAKQAAACtra2t///////////////////////m5ub/kZGR/wAAAP8AAAD/q6ur//Hx8f//////vb29/x0dHf8AAACIAAAAAAAAAAAAAAAAAAAAOjo6Ov//////5+fn/wAAAOcAAADd3d3d////////////////////////////+/v7/9bW1v/i4uL//v7+//Pz8/9hYWH/AAAAvQAAAFQAAAAAAAAAAAAAAAAAAAAAAAAAJycnJ//6+vr//////wMDA/8AAADv7+/v/////////////////////////////////////////////////7y8vP8ODg7/AAAAKwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJiYmJv/6+vr//////wkJCf8AAADv7+/v//////////////////////////////////f39//9/f3//////+np6f+UlJT/GBgY/wAAAH0AAAACAAAAAAAAAAAAAAAAAAAAKSkpKf///////v7+/w0NDf8AAADd3d3d////////////////////////////29vb/39/f/+Xl5f/5+fn////////////5ubm/1RUVP8CAgL/AAAAPwAAAAAAAAAAAAAAOTk5Of//////8PDw/wgICP8AAAChoaGh/////////////////+np6f+YmJj/QkJC/wAAAP8AAAD/UFBQ/7e3t//39/f///////////+oqKj/EBAQ/wAAAIgAAAAAAAAAZ2dnZ///////29vb/wEBAf8AAAA4NTU1/9zc3P/t7e3/tbW1/01NTf8AAACYAAAA////////////AwMD/wsLC/9oaGj/y8vL////////////8fHx/zg4OP8AAACWAAAApaWlpf//////n5+f/wAAAJ8AAAAAAAAAczg4OP9LS0v/EhIS/wAAAE0AAAAAAAAA////////////FRUV/wAAABUAAABoJSUl/4GBgf/i4uL///////////9+fn7/Pz8///b29v//////SkpK/wAAAEoAAAAAAAAAAAAAADgAAABLAAAAEgAAAAAAAAAAAAAAlgAAAP8AAAD/AAAAlgAAAAAAAAAAAAAAJQAAAIE8PDz/np6e//z8/P/////////////////8/Pz/CQkJ/wAAAAkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlgAAAP8AAAD/AAAAlgAAAAAAAAAAAAAAAAAAAAAAAAA8DAwM/09PT/+7u7v///////////+QkJD/AAAAkwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////////////Dw8P/wAAAA8AAAAAAAAAAAAAAAAAAAAAAAAADAAAAFIYGBj/aGho/729vf8WFhb/AAAAJwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////////////FRUV/wAAABUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAQEB/w8PD/8AAABUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////////////DAwM/wAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlgAAAP8AAAD/AAAAlgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8x/h/nO/4fw1D+HwFy/h4BRu4YAHOGEABkAAAAXAAAIFwAAOBnAAHgIAAD4GUAAOB4AABgXAAAIGMAAABtggAAVMYYAHT+HgE7/g8BcP4Pw2/+D+dc/h//XP///2c=), auto";
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
    };

    function promoteDelta(delta)
    {
        // promote a wheel delta to a full wheel stop (3)
        if ( delta < 0 && delta > -3 ) {
            return -3;
        }
        return ( delta > 0 && delta < 3 ) ? 3 : delta;
    }

    this.getAccumulatedWheelDelta = function()
    {
        var now = Date.now();
        var delta = 0;

        if ( _wheelNewest && now - _wheelNewest > kWheelThresholdMs ) {
            // Newest event in accumulator has aged out; assume wheel motion has stopped.
            delta = promoteDelta(_wheelAccum);
            _wheelAccum = 0;
            _wheelOldest = null;
            _wheelNewest = null;
            _wheelContinuous = false;
        }
        else if ( _wheelOldest && (now - _wheelOldest) > kWheelThresholdMs ) {
            // Oldest event in accumulator has aged out; process continuously.
            if ( _wheelContinuous ) {
                if( Math.abs(_wheelAccum) >= 3 ) {
                    delta = _wheelAccum;
                    _wheelAccum = 0;
                }
            } else {
                delta = promoteDelta(_wheelAccum);
                _wheelContinuous = true;
                _wheelAccum = 0;
            }
        }
        return delta;
    };

    this.update = function()
    {
        var wheelEnded = false;
        var updatePivot = _activeTrigger > kNone;

        if( _activeTrigger > kNone )
        {
            this.controller.setIsLocked(true);
            this.getMotionDelta(_motionDelta);

            var deltaX = _motionDelta.x;
            var deltaY = _motionDelta.y;
            var deltaZ = _motionDelta.z;

            if( deltaX !== 0.0 || deltaY !== 0.0 || deltaZ !== 0.0 )
            {
                updatePivot = true;
                if( _activeTrigger >= kMouseLeft )
                {
                    // Map XY movement to Z:
                    deltaY = -deltaY;   // Invert Y
                    deltaZ = (Math.abs(deltaX) > Math.abs(deltaY)) ? deltaX : deltaY;
                    if( deltaZ !== 0.0 )
                    {
                        deltaZ *= kFovDragScale;
                        _navapi.setVerticalFov(_navapi.getVerticalFov() * (1.0 + deltaZ), true);
                    }
                }
                else 
                {
                    // Translate wheelAccum backwards to determine the number of wheel stops.
                    var deltaFocalLength = this.getAccumulatedWheelDelta() / 3;
                    if( deltaFocalLength !== 0.0 )
                        _navapi.setFocalLength(_navapi.getFocalLength() + deltaFocalLength, true);
                }
            }
            this.stepMotionDelta(_motionDelta, true);

            // If a wheel event triggered this we've now handled it,
            if( _activeTrigger === kWheel && Math.abs(deltaZ) < kEpsilon )
            {
                this.interactionEnd(kWheel);
                wheelEnded = true;
            }
        }

        if( updatePivot )
            this.utilities.pivotActive(_navapi.getPivotSetFlag(), true);
        else
            this.utilities.pivotUpdate();

        // If the interaction has "ended" we can now forget the trigger.
        if( !_interactionActive && (wheelEnded || (_activeTrigger > kNone)) )
        {
            if( _activeTrigger > kWheel )
            {
                // Kill any ongoing damped motion if we aren't using
                // the wheel.
                _startXYZ.copy(_moveXYZ);
            }
            _activeTrigger = kNone;
            this.controller.setIsLocked(false);
        }
        return _camera.dirty;
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
        }

        // Switch to perspective
        _navapi.toPerspective();
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

    // ------------------------
    // Event handler callbacks:
    // These can use "this".

    
    this.handleWheelInput = function(delta)
    {
        if( _activeTrigger > kWheel )
            return false;

        // Match original reverse behaviour:
        if( _navapi.getReverseZoomDirection() )
            delta *= -1;

        _moveXYZ.z += delta;
        _wheelAccum += delta;
        var now = Date.now();
        if ( !_wheelOldest ) {
            _wheelOldest = now;
        }
        _wheelNewest = now;

        if( delta != 0.0 )
            this.interactionStart(kWheel);

        return true;
    };

    this.handleGesture = function( event )
    {
        switch( event.type )
        {
            case "dragstart":
                return this.handleButtonDown(event, 0);

            case "dragmove":
                return this.handleMouseMove(event);

            case "dragend":
                return this.handleButtonUp(event, 0);

            case "drag3start":
                _touchType = "drag";
                // Fake the mouse for now. Coord should be centroid.
                return this.handleButtonDown(event, 0);

            case "drag3move":
                return (_touchType === "drag") ? this.handleMouseMove(event) : false;

            case "drag3end":
                if( _touchType === "drag" )
                    this.handleButtonUp(event, 0);

                _touchType = null;
                // Sigh... minor hack
                // Can't consume the end event because the hot gesture
                // tool needs to see it to end the interaction.
                return false;
        }
        return false;
    };


    this.handleButtonDown = function( event, button )
    {
        _mouseButtons += 1 << button;

        if (button !== kMouseRight) {
            _startXYZ.x = (event.normalizedX + 1.0) * 0.5;
            _startXYZ.y = 1.0 - (event.normalizedY + 1.0) * 0.5;

            _moveXYZ.copy(_startXYZ);

            this.interactionStart(button);
            return true;
        }

        return false;
    };

    this.handleButtonUp = function( event, button )
    {
        _mouseButtons -= 1 << button;

        if (button !== kMouseRight) {
            _moveXYZ.x = (event.normalizedX + 1.0) * 0.5;
            _moveXYZ.y = 1.0 - (event.normalizedY + 1.0) * 0.5;

            this.interactionEnd(button);
            return true;
        }

        return false;
    };

    this.handleMouseMove = function( event )
    {
        _moveXYZ.x = (event.normalizedX + 1.0) * 0.5;
        _moveXYZ.y = 1.0 - (event.normalizedY + 1.0) * 0.5;
        return (_activeTrigger > kWheel);
    };

    this.handleBlur = function(event)
    {
        // Reset things when we lose focus...
        this.interactionEnd(_activeTrigger);
        return false;
    };

};
