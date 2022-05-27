
    "use strict";
    const { getGlobal } = require('../../compat');

    const _window = getGlobal();

    // Returned by animation functions to enable interruption
    function AnimControl() {
        // Function to interrupt animation
        this.stop = null;

        // False indicates that animation is stopped or finished.
        this.isRunning = true;
    }

    // Invoke an animated transition. On each frame, the given setParam() function is called
    // with a value between startValue (at startTime) and endValue (at endTime).
    //  @param {number}   startValue
    //  @param {number}   endValue
    //  @param {number}   duration     - in seconds
    //  @param {function} setParam     - callback that is called with interpolated value in [startValue, endValue]
    //  @param {function] [onFinished] - optional callback triggered when fading is done.
    //  @returns {AnimControl}
    function fadeValue(startVal, endVal, duration, setParam, onFinished) {

        var startTime = performance.now();

        var durationInMs = 1000.0 * duration;

        var reqId = 0;

        // Create control object to interrupt anim
        var control = new AnimControl();

        control.stop = function() {
            // cancel next update
            if (reqId) _window.cancelAnimationFrame(reqId);
            
            control.isRunning = false;
        };

        // Fast-forward anim: Simulates that the anim time has fast. Unlike stop(), it invokes 
        // the last frame immediately and calls onFinished().
        control.skip = function() {
            if (control.isRunning) {
                setParam(endVal);  // invoke last anim frame
                control.stop(); // make sure that onNextFrame is not called anymore
                onFinished && onFinished(); 
            }
        };

        // on each frame, call setParam and request next call until time is up
        var onNextFrame = function(timeStamp) {

            // compute unit time [0,1]
            var unitTime = (timeStamp - startTime) / durationInMs;

            // clamp unitTime to [0,1]
            unitTime = Math.max(unitTime, 0.0);
            unitTime = Math.min(unitTime, 1.0);

            // compute interpolated value
            var t = startVal + unitTime * (endVal - startVal);

            // update param
            setParam(t);

            // request next call if fading is not finished
            if (unitTime < 1.0) {
                reqId = _window.requestAnimationFrame(onNextFrame);
            } else {
                control.isRunning = false;
                if (onFinished) {                
                    onFinished();
                }
            }
        }

        // start fade animation
        onNextFrame(startTime);

        return control;
    }

    // Makes it easy to smoothly animate any parameter values, e.g.,
    // opacity or size of a shape etc.
    class AnimatedParam {

        // @param {number}           initValue - Intial parameter value
        // @param {function(number)} setValue  - Defines how to set the parameter to be animated.
        // @param {number}           number    - fade transition time in seconds.
        constructor(initValue, setValue, animTime) {
            this.setValueCb = setValue;
            this.animTime   = animTime;
    
            // {AnimControl} Allows stopping currently running transition (if any)
            this.fadeAnim = null;
            
            // Latest value set from outside. This value is either currently set or 
            // we are animating to it.
            this.targetValue = initValue; 
    
            // Make sure that curValue and actual param state are 
            // consistently set to the start value.
            this.curValue = initValue;
            setValue(initValue);

            // onFinished callbacks to be invoked at the end of current anim
            this.pendingFinishedCallbacks = [];
        }

        stopAnim() {
            if (this.fadeAnim) {
                this.fadeAnim.stop();
                this.fadeAnim = null;
            }
        }

        // process all onFinished callbacks and clear them
        _onAnimEnded() {
            this.pendingFinishedCallbacks.forEach(cb => cb());
            this.pendingFinishedCallbacks.length = 0;
        }

        // Smoothly fade-over to the given parameter value.
        // If this value is already set or being animated to, the call has no effect.       
        // @param {number}     value
        // @param {function()} [onFinished] - Called (only) if value is reached. Will not be called
        //                                    if transition is interrupted before reaching the value.
        fadeTo(value, onFinished) {

            const animating = this.fadeAnim && this.fadeAnim.isRunning;

            // Simplest case: No anim running and value already reached
            if (!animating && this.curValue == value) {
                onFinished && onFinished();
                return;
            }

            // Make sure that onFinished is triggered later
            if (onFinished) {
                this.pendingFinishedCallbacks.push(onFinished);
            }

            // Avoid triggering a (new) animation if the target value didn't change
            if (animating && value === this.targetValue) {
                return;
            }

            // Interrupt anim to a prior value (if any)
            this.stopAnim();

            // Update param during transition
            const onTimer = t => {

                // let anim start/stop smoothly
                t = smootherStep(t);

                this.curValue = t;
                this.setValueCb(t);
            };

            // Start transition from current value to new target value
            this.targetValue = value;
            this.fadeAnim = fadeValue(this.curValue, this.targetValue, this.animTime, onTimer, () => this._onAnimEnded());
        }

        // Skips current animation (if any)
        skipAnim() {
            if (this.fadeAnim) {
                this.fadeAnim.skip();
            }
        }
    
        // Set value immediately - without any transition
        setValue(value) {
            this.stopAnim();

            this.curValue = value;
            this.setValueCb(value);
        }
    }

    // Can be replaced by THREE.Math.lerp later (not contained in our current THREE version)
    function lerp(x, y, t) {
        return ( 1 - t ) * x + t * y;
    }

    function smootherStep(t) {
        return THREE.Math.smootherstep(t, 0.0, 1.0);
    }

    function SimpleTransition(viewer) {

        // start/end camera
        var _startPos    = new THREE.Vector3();
        var _startTarget = new THREE.Vector3();
        var _startUp     = new THREE.Vector3();
        var _endPos      = new THREE.Vector3();
        var _endTarget   = new THREE.Vector3();
        var _endUp       = new THREE.Vector3();

        // interpolate target distance separately from orientation. Note that the target distance
        // is relevant for the orthoscale.
        var _startTargetDist = 0.0;
        var _endTargetDist   = 0.0;

        // start/end orientation matrix as quaternions
        var _qStart   = new THREE.Quaternion(); // at start
        var _qEnd     = new THREE.Quaternion(); // at end: camera looks at dst target

        // temp objects for reuse
        var _tmpVec    = new THREE.Vector3();
        var _tmpQuat   = new THREE.Quaternion();
        var _tmpObj    = new THREE.Object3D();
        var _tmpMatrix = new THREE.Matrix4();

        // Updates camera view direction based on given quaternion.
        function setFromQuaternion(camera, quat, targetDist) {

            // set target
            _tmpVec.set(0,0,-targetDist).applyQuaternion(quat);
            camera.target.addVectors(camera.position, _tmpVec);

            // set up-vector
            _tmpVec.set(0,1,0).applyQuaternion(quat);
            camera.up.copy(_tmpVec);
        }

        // Compute quaternion to rotate camera in a way that it looks towards the given target and
        // respects the given up direction.
        function computeQuaternion(result, pos, target, up) {

            // NOTE: Actually, we could just use lookAt + setFromRotationMatrix from THREE as below:
            //
            //     _tmpMatrix.lookAt(pos, target, up);
            //     result.setFromRotationMatrix(_tmpMatrix);
            //
            // However, for some target views, direction and up-vector are collinear, so that a valid up-vector
            // is not properly defined. For this case, it is essential to use the same heuristic as the
            // LMV navigation does. Otherwise, the camera up vector may suddenly flip.
            Autodesk.Viewing.Navigation.prototype.orient(_tmpObj, target, pos, up);
            result.copy(_tmpObj.quaternion);
        }

        function initQuaternions() {

            // take qStart from initial camera
            computeQuaternion(_qStart, _startPos, _startTarget, _startUp);

            // quaternion for final view
            computeQuaternion(_qEnd, _endPos, _endTarget, _endUp);
        }

        this.init = function(startCamera, dstPos, dstTarget, dstUp, worldUpAligned = true) {
            _startPos.copy(startCamera.position);
            _startTarget.copy(startCamera.target);
            _startUp.copy(worldUpAligned ? startCamera.worldup : startCamera.up);
            _endPos.copy(dstPos);
            _endTarget.copy(dstTarget);
            _endUp.copy(worldUpAligned ? startCamera.worldup : dstUp);

            _startTargetDist = _startPos.distanceTo(_startTarget);
            _endTargetDist   = _endPos.distanceTo(_endTarget);

            initQuaternions();
        };

        this.updateCamera = function(unitTime, camera) {

            var t = smootherStep(unitTime);

            // interpolate position
            camera.position.lerpVectors(_startPos, _endPos, t);

            // interpolate view direction
            THREE.Quaternion.slerp(_qStart, _qEnd, _tmpQuat, t);
            _tmpQuat.normalize();

            // interpolate target distance
            var targetDist = lerp(_startTargetDist, _endTargetDist, t);

            setFromQuaternion(camera, _tmpQuat, targetDist);

            // trigger viewer update
            camera.dirty = true;
        };

        this.updateViewerCamera = function(unitTime, viewer) {
            this.updateCamera(unitTime, viewer.impl.camera);
            viewer.impl.syncCamera();
            viewer.impl.invalidate(true, true);
        };
    }

    var _transition;

    // @param {Viewer3D}      viewer
    // @param {THREE.Vector3} destView.position  - end position
    // @param {THREE.Vector3} destView.target    - end target position
    // @param {number=2}      duration           - in seconds
    // @param {function}      onFinished         - optional callback triggered when animation is finished
    // @param {boolean}       [worldUpAligned]     - Whether the final view will be world aligned or not. Default is true.
    // @returns {AnimControl}
    function flyToView(viewer, destView, duration, onFinished, worldUpAligned = true) {

        if (!_transition)
            _transition = new SimpleTransition();

        // apply default duration
        duration = duration || 2.0;

        // init transition from current viewer camera
        var cam = viewer.impl.camera;
        _transition.init(cam, destView.position, destView.target, destView.up, worldUpAligned);

        // define onTimer handler that updates the camera
        var onTimer = function(unitTime) {
            _transition.updateViewerCamera(unitTime, viewer);
        };

        return fadeValue(0.0, 1.0, duration, onTimer, onFinished);
    }

    /** Helper for smooth fadeIn/fadeOut of ground shadow and SAO 
     *  @param {Viewer3D}       viewer
     *  @param {number}         fadeDuration - in seconds
     *  @param {function(bool)} [onFadeDone] - Optional callback. Bool param is: true = faded in, false = faded out.
     */
    function ShadowFader(viewer, fadeDuration, onFadeDone) {

        // intensity multiplier for SAO and ground shadow
        var _value = 1.0;

        // AnimControl (if fading is in progress)
        var _fadeAnim = null;
        var _viewer = viewer;

        var _fadeDuration = fadeDuration;

        // If an anim is in progress, _fading indicates the direction (fading in or out)
        var _fadingIn = undefined;

        var _onFadeDone = onFadeDone;

        function onTimer(t) {
            _value = t;
            viewer.impl.setGroundShadowAlpha(t);
        }

        function onFadeEnd() {
            _fadeAnim = null;

            // trigger optional callback
            if (_onFadeDone) {
                _onFadeDone(_fadingIn);
            }
        }

        // Make sure that SAO/Shadow is faded to full visibility
        this.shadowOn = function() {

            // If already fading in, we are done
            if (_fadeAnim && _fadingIn) {
                return;
            }

            // If fading-out, stop it
            if (_fadeAnim && !_fadingIn) {
                _fadeAnim.stop();
                _fadeAnim = null;
            }

            // already full intensity => done
            if (_value >= 1.0) {
                return;
            }

            // compute duration based on intensity change
            var fadingDist = 1.0 - _value;
            var duration = _fadeDuration * fadingDist;

            // Fade from current intensity value to 1.0
            _fadeAnim = fadeValue(_value, 1.0, duration, onTimer, onFadeEnd);

            _fadingIn = true;
        };

        this.shadowOff = function() {

            // already fading out => done
            if (_fadeAnim && !_fadingIn) {
                return;
            }

            // fading in => stop it
            if (_fadeAnim && _fadingIn) {
                _fadeAnim.stop();
                _fadeAnim = null;
            }

            // already 0 intensity => done
            if (_value <= 0.0) {
                return;
            }

            var duration = _fadeDuration * _value;
            _fadeAnim = fadeValue(_value, 0.0, duration, onTimer, onFadeEnd);

            _fadingIn = false;
        };

        this.isFading = function() {
            return _fadeAnim && _fadeAnim.isRunning;
        }
    };

    module.exports = {
        flyToView:          flyToView,
        ShadowFader:        ShadowFader,
        lerp:               lerp,
        smootherStep:       smootherStep,
        fadeValue:          fadeValue,
        AnimatedParam:      AnimatedParam
    };
