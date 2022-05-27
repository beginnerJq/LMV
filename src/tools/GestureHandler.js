
import { isTouchDevice, isIE11, isNodeJS } from "../compat";

//Hammer cannot be included in a node.js context....
let Hammer;
if (!isNodeJS()) {
    //Hammer does not work on Node because it references window and document
    Hammer = require('../../thirdparty/hammer/hammer.js');
}

//Delay initialization so we can skip it on the server.
export const GestureRecognizers = {};

function initGesturesOnce() {
    if (GestureRecognizers.singletap)
        return;

    var gr = GestureRecognizers;
    gr.singletap = [Hammer.Tap, { event: 'singletap', threshold: 7.0, time: 400 } ];
    gr.singletap2 = [Hammer.Tap, { event: 'singletap2', pointers: 2, threshold: 7.0, time: 400 } ];
    gr.press = [Hammer.Press, { event: 'press', time: 500, threshold: 50.0 } ];
    gr.doubletap = [Hammer.Tap, { event: 'doubletap', taps: 2, interval: 300, threshold: 6, posThreshold: 30 } ];
    gr.doubletap2 = [Hammer.Tap, { event: 'doubletap2', pointers: 2, taps: 2, interval: 300, threshold: 6, posThreshold: 40 } ];
    gr.swipe = [Hammer.Swipe, { event: 'swipe', pointers: 1, threshold: 200, velocity: 1.7 } ];
    gr.drag = [Hammer.Pan, { event: 'drag', pointers: 1 } ];
    gr.drag3 = [Hammer.Pan, { event: 'drag3', pointers: 3, threshold: 15 } ];
    gr.pan = [Hammer.Pan, { event: 'pan', pointers: 2, threshold: 20 } ];
    gr.pinch = [Hammer.Pinch, { event: 'pinch', pointers: 2, enable: true, threshold: 0.05 } ];
    gr.rotate = [Hammer.Rotate, { event: 'rotate', pointers: 2, enable: true, threshold: 7.0 } ];
}

// Initialize asap
if (Hammer) {
    initGesturesOnce();
}

export function GestureHandler(viewerApi)
{
    var _navapi = viewerApi.navigation;
    var _names = [ 'gestures' ];
    var _this = this;
    var _mouseEnabled = true;
    var _lock = false;
    var _twoPointerSwipeEnabled = true;
    var hammer = null;
    var _isActive = false;

    var isTouch = isTouchDevice();

    _navapi.setIsTouchDevice(isTouch);


    if (isTouch) {
        hammer = new Hammer.Manager(viewerApi.canvasWrap, {
            recognizers: [
                GestureRecognizers.drag,
                GestureRecognizers.doubletap,
                GestureRecognizers.doubletap2,
                GestureRecognizers.singletap,
                GestureRecognizers.singletap2,
                GestureRecognizers.press,
                GestureRecognizers.drag3,
                GestureRecognizers.swipe,
                
                // Note: These recognizers are active only when _twoPointerSwipeEnabled is true
                GestureRecognizers.pan,
                GestureRecognizers.pinch,
                GestureRecognizers.rotate
            ],
            handlePointerEventMouse: false,
            inputClass: isIE11 ? Hammer.PointerEventInput : Hammer.TouchInput
        });
        hammer.get('pinch').recognizeWith([hammer.get('drag')]);
        
        viewerApi.canvasWrap.addEventListener( 'touchstart', this.onTouchStart, false );
    }

    this.onTouchStart = function(event) {

        event.preventDefault();
    };

    this.getNames = function() {

        return _names;
    };

    this.getName = function() {

        return _names[0];
    };

    this.isActive = function() {

        return _isActive;
    };

    this.__clientToCanvasCoords = function (event) {

        var rect = viewerApi.impl.getCanvasBoundingClientRect();
        var width  = rect.width;
        var height = rect.height;

        // Canvas coordinates: relative to the canvas element.
        // 0 = top left, +ve right and down.
        //
        var canvasX, canvasY;

        if (event.hasOwnProperty('center')) {
            canvasX = event.center.x - rect.left;
            canvasY = event.center.y - rect.top;
        } else {
            canvasX = event.pointers[0].clientX - rect.left;
            canvasY = event.pointers[0].clientY - rect.top;
        }
        event.canvasX = canvasX;
        event.canvasY = canvasY;

        // Normalized coordinates: [-1, +1].
        // 0 = center, +ve = right and up.
        //
        event.normalizedX = (canvasX / width) * 2.0 - 1.0;
        event.normalizedY = ((height - canvasY) / height) * 2.0 - 1.0;
    };


    this.distributeGesture = function(event) {

        _this.__clientToCanvasCoords(event);

        if (_this.controller.distributeEvent('handleGesture', event))
            event.preventDefault();
    };

    this.onSingleTap = function(event) {

        _this.__clientToCanvasCoords(event);

        if (_this.controller.distributeEvent('handleSingleTap', event))
            event.preventDefault();
    };

    this.onDoubleTap = function(event) {

        _this.__clientToCanvasCoords(event);

        if (_this.controller.distributeEvent('handleDoubleTap', event))
            event.preventDefault();
    };

    this.onPressHold = function(event) {

        _this.__clientToCanvasCoords(event);

        if (_this.controller.distributeEvent('handlePressHold', event))
            event.preventDefault();
    };

    // Hammer.js contains an event called hammer.input, which is emitted for
    // every touch event. This contains information of when the user started touching,
    // and when they ended. This provides a general mechanism when to disable mouse
    // buttons. Touch interactions should have priority, and there's no use-case for
    // handling mouse events while touch is being used.
    // This prevents cases (most prominent in IE11 / Edge) where a mouse down is emitted
    // while Hammer is still trying to determine what type of gesture was traced on screen.
    this.onHammerInput = function(event) {

        _this.setMouseDisabledWhenTouching(event);
    };

    this.setMouseDisabledWhenTouching = function(event) {
        if (event.isFirst && !_lock) {
            _mouseEnabled = _this.controller.enableMouseButtons(false);
            _lock = true;            
        } else if (event.isFinal) {
            setTimeout(function() {
                _this.controller.enableMouseButtons(_mouseEnabled);
                _lock = false;                
            }, 10);
        }
    };

    this.activate = function(name) {

        if (hammer && !_isActive)
        {
            hammer.on('dragstart dragmove dragend', this.distributeGesture);
            hammer.on('singletap', this.onSingleTap);
            hammer.on('singletap2', this.onSingleTap);
            hammer.on('doubletap', this.onDoubleTap);
            hammer.on('doubletap2', this.onDoubleTap);
            hammer.on('press pressup', this.onPressHold);
            hammer.on('drag3start drag3move drag3end', this.distributeGesture);
            hammer.on('swipeleft swiperight swipeup swipedown', this.distributeGesture);

            if (_twoPointerSwipeEnabled) {
                hammer.on('panstart panmove panend', this.distributeGesture);
                hammer.on('pinchstart pinchmove pinchend', this.distributeGesture);
                hammer.on('rotatestart rotatemove rotateend', this.distributeGesture);
            }

            hammer.on('hammer.input', this.onHammerInput);

            // we only want to trigger a tap, when we don't have detected a doubletap
            hammer.get('doubletap2').recognizeWith('doubletap');
            hammer.get('singletap2').recognizeWith('singletap');
            hammer.get('singletap').requireFailure('doubletap');
            hammer.get('swipe').recognizeWith('drag');
        }

        _isActive = true;
    };

    this.deactivate = function(name) {

        if (hammer && _isActive)
        {
            hammer.off('dragstart dragmove dragend', this.distributeGesture);
            hammer.off('singletap', this.onSingleTap);
            hammer.off('singletap2', this.onSingleTap);
            hammer.off('doubletap', this.onDoubleTap);
            hammer.off('doubletap2', this.onDoubleTap);
            hammer.off('press pressup', this.onPressHold);
            hammer.off('drag3start drag3move drag3end', this.distributeGesture);
            hammer.off('swipeleft swiperight swipeup swipedown', this.distributeGesture);

            if (_twoPointerSwipeEnabled) {
                hammer.off('panstart panmove panend', this.distributeGesture);
                hammer.off('pinchstart pinchmove pinchend', this.distributeGesture);
                hammer.off('rotatestart rotatemove rotateend', this.distributeGesture);
            }

            hammer.off('hammer.input', this.onHammerInput);
        }

        _isActive = false;
    };


    this.update = function() {

        return false;
    };


    this.handleBlur = function(event) {

        return false;
    };

    /**
     * Disables two finger swipe functionality (pan, rotate, zoom) so that a
     * mobile user can scroll the page where the viewer is being embedded.
     */
    this.disableTwoFingerSwipe = function() {

        _twoPointerSwipeEnabled = false;
        if (hammer) {
            hammer.remove(Hammer.Pan);
            hammer.remove(Hammer.Pinch);
            hammer.remove(Hammer.Rotate);
            hammer.off('panstart panmove panend', this.distributeGesture);
            hammer.off('pinchstart pinchmove pinchend', this.distributeGesture);
            hammer.off('rotatestart rotatemove rotateend', this.distributeGesture);
        }
    };

    /**
     * Change a gesture's parameter (such as threshold, time, velocity, etc) to allow customizing the experience
     * according to the tool being used
     * @param gestureName
     * @param parameter - which gesture parameter to change
     * @param value - the new parameter value
     * @returns {boolean} - true if the gesture exists and could be changed
     */
    this.setGestureParameter = function(gestureName, parameter, value) {
        const gesture = hammer && hammer.get(gestureName);
        
        if (!gesture) return false;
        
        gesture.options[parameter] = value;
        
        return true;
    };

    /**
     * Restore's a gesture's default value for a specified parameter
     * @param gestureName
     * @param parameter - which gesture parameter to change
     * @returns {boolean} - true if the gesture exists and could be restored
     */    
    this.restoreGestureParameterDefault = function(gestureName, parameter) {
        const gesture = hammer && hammer.get(gestureName);

        if (!gesture) return false;

        const lmvDefaults = GestureRecognizers[gestureName][1];
        
        gesture.options[parameter] = lmvDefaults.hasOwnProperty(parameter) ?
            lmvDefaults[parameter] :
            gesture.defaults[parameter];

        return true;
    }
}
