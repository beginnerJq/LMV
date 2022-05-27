
import { stringToDOM } from "../../src/globals";
import { isTouchDevice } from "../../src/compat";
import { Navigation } from "../../src/tools/Navigation";

const av = Autodesk.Viewing;

const html = [
    '<div class="orbit-gizmo noselect">',
        '<div class="outside"></div>',
        '<div class="ring"></div>',
        '<div class="layout-hor">',
            '<div class="edgemark-area"><div class="edgemark"></div></div>',
        '</div>',
        '<div class="layout-mid">',
            '<div class="layout-ver">',
                '<div class="edgemark-area"><div class="edgemark"></div></div>',
            '</div>',
            '<div class="circle">',
                '<div class="crosshair-area">',
                    '<div class="crosshair-v"></div>',
                    '<div class="crosshair-h"></div>',
                '</div>',
            '</div>',
            '<div class="layout-ver">',
                '<div class="edgemark-area"><div class="edgemark"></div></div>',
            '</div>',
        '</div>',
        '<div class="layout-hor">',
            '<div class="edgemark-area"><div class="edgemark"></div></div>',
        '</div>',
    '</div>',
].join("\n");

export function FusionOrbitTool() {

    var _names = ["fusion orbit", "fusion orbit constrained"];

    var _PERCENT_SIZE = 0.8;
    var _EXIT_PERCENT_SIZE = 1.2;
    var _CIRCLE_CURSOR_STYLE = "url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAt1BMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8AAAAzMzP6+vri4uISEhKKioqtra2dnZ2EhIR9fX10dHRkZGQdHR3t7e3Hx8e5ubm1tbWoqKhWVlZKSko4ODgICAjv7+/o6OjMzMyxsbFOTk4pKSkXFxcEBAT29vbW1tZ6enpISEgLCwvhzeX+AAAAGXRSTlMANRO0nHRJHfnskIxQRKh89syDVwTWZjEJxPFEswAAAOFJREFUKM+1j+lygkAQhIflEAJe0Rw9u4CCeKKoSTTX+z9XoMJWWeX+ssrvZ3f19DQ5zOw/0DUMQPlmQ72bE2adBp8/Rp3CQUi3ILx+bxj4fjDs9T1Bmo6bbPPN8aDU4bjJt4nb+de789kSFyxn826jW3ICLNZZKU8nWWbrBTCRVm04U8TpjquRFf1Go0d7l8aYOrUR7FGEFr1S9LGymwthgX2gE/Kl0cHPOtF2xOWZ5QpIC93RflW4InkDoPRXesd5LJIMQPzV7tCMa7f6BvhJL79AVDmYTNQ1NhnxbI/uwB8H5Bjd4zQPBAAAAABJRU5ErkJggg==), auto";

    var _orbitModes = {
        HORIZONTAL: 0,
        VERTICAL: 1,
        ROLL: 2
    };

    var _orbitSpeeds = {
        HORIZONTAL: 0.005,
        VERTICAL: 0.005,
        ROLL: 1.0
    };

    var _gizmoElem, _gizmoRect = {}, _ringElem, _outsideElem;
    var _isConstrained;
    var _camera;
    var _isTouch = isTouchDevice();
    var _isClickToExit = false;

    var _mouse = {
        buttons: [],
        src: undefined,
        x: 0,
        y: 0,
        dx: 0,
        dy: 0,
        firstMove: true,   // for dx/dy calc
        mode: undefined
    };

    var _this = this;

    this.setViewer = function(viewer) {
        this.viewer = viewer;
        this.navapi = viewer ? viewer.navigation : null;
        viewer && this.setGlobalManager(viewer.globalManager);
    };

    // PRIVATE FUNCTIONS

    var _onMouseDown = function(e) {
        _mouse.buttons[e.touches ? 0 : e.button] = true;
        _mouse.src = e.target.className;
        _mouse.x = 0;
        _mouse.y = 0;
        _mouse.dx = 0;
        _mouse.dy = 0;
        _mouse.firstMove = true;
        _mouse.mode = undefined;

        if (_mouse.src === "ring") {
            _mouse.mode = _orbitModes.ROLL;
        }
        else if (_mouse.src === "edgemark-area") {
            if (e.target.parentNode.className === "layout-ver")
                _mouse.mode = _orbitModes.HORIZONTAL;
            else if (e.target.parentNode.className === "layout-hor")
                _mouse.mode = _orbitModes.VERTICAL;
        }

        _centerPivot();

        e.stopPropagation();
    };

    var _onMouseUp = function(e) {
        _mouse.buttons[e.touches ? 0 : e.button] = false;
        _mouse.src = undefined;
    };

    var _onMouseMove = function(e) {
        if (!_mouse.buttons[0]) return;

        _updateMousePos(e);
        _updateCamera();

        _mouse.firstMove = false;
    };

    var _updateMousePos = function(e) {
        var pageX = e.touches ? e.touches[0].pageX : e.pageX;
        var pageY = e.touches ? e.touches[0].pageY : e.pageY;

        if (!_mouse.firstMove) {
            _mouse.dx = pageX - _mouse.x;
            _mouse.dy = pageY - _mouse.y;
        }
        _mouse.x = pageX;
        _mouse.y = pageY;
    };

    var _updateCamera = function() {

        // if (_mouse.dx === 0 && _mouse.dy === 0) return;
        switch (_mouse.mode) {
            case _orbitModes.ROLL:
                if (!_this.navapi.isActionEnabled('roll')) {
                    return;
                }
                break;
            case _orbitModes.HORIZONTAL:
            case _orbitModes.VERTICAL:
                if (!_this.navapi.isActionEnabled('orbit')) {
                    return;
                }
                break;
        }

        var eyeVec = _camera.target.clone().sub(_camera.position).normalize();
        var rightVec = eyeVec.clone().cross(_camera.up).normalize();
        var upVec = rightVec.clone().cross(eyeVec).normalize();
        _camera.up.copy(upVec);  // update camera.up

        if (_mouse.mode === _orbitModes.ROLL) {
            var start = new THREE.Vector3(_mouse.x - _gizmoRect.center.x, _mouse.y - _gizmoRect.center.y, 0);
            var end = (new THREE.Vector3(_mouse.dx, _mouse.dy, 0)).add(start);
            start.normalize();
            end.normalize();
            var cross = start.clone().cross(end);
            var angle = Math.asin(cross.z);
            _camera.up.applyAxisAngle(eyeVec, -angle*_orbitSpeeds.ROLL);
        }
        else {
            var rotAxis, rotAmount;

            if (_mouse.mode === _orbitModes.HORIZONTAL) {
                rotAmount = -_mouse.dx*_orbitSpeeds.HORIZONTAL;
                if (_isConstrained)
                    _camera.up = Navigation.snapToAxis(_camera.up.clone()); // snap up vec
                rotAxis = _camera.up;
            }
            else if (_mouse.mode === _orbitModes.VERTICAL) {
                rotAmount = -_mouse.dy*_orbitSpeeds.VERTICAL;
                if (_isConstrained) {
                    if (_mouse.firstMove)           // first time move, snap
                        _camera.up = Navigation.snapToAxis(_camera.up.clone());
                    rotAxis = eyeVec.clone().cross(_camera.up).normalize();  // new right vec
                }
                else {
                    rotAxis = rightVec;
                }
                _camera.up.applyAxisAngle(rotAxis, rotAmount);
            }

            var pivot = _this.navapi.getPivotPoint();
            var newPivotToCam = _camera.position.clone().sub(pivot);
            newPivotToCam.applyAxisAngle(rotAxis, rotAmount);
            _camera.position.addVectors(pivot, newPivotToCam);       // orbit position

            var newPivotToTarget = _camera.target.clone().sub(pivot);
            newPivotToTarget.applyAxisAngle(rotAxis, rotAmount);
            _camera.target.addVectors(pivot, newPivotToTarget);      // orbit target
        }

        _camera.dirty = true;

    };

    // may return camera.target, do not modify
    var _findTarget = function() {
        var eyeVec = _camera.target.clone().sub(_camera.position).normalize();
        var hit = _this.viewer.impl.rayIntersect(new THREE.Ray(_camera.position, eyeVec));
        return (hit && hit.intersectPoint) ?
            hit.intersectPoint :
            _camera.target;
    };

    var _getCameraPlane = function(pos, nor) {
        var planeNor = nor || pos.clone().sub(_camera.position).normalize();
        return new THREE.Plane(
            planeNor, -planeNor.x*pos.x - planeNor.y*pos.y - planeNor.z*pos.z
        );
    };

    var _centerPivot = function() {
        // find distance pivot to camera plane
        // set new pivot to be that distance along eye vector
        var eyeVec = _camera.target.clone().sub(_camera.position).normalize();
        var plane = _getCameraPlane(_camera.position, eyeVec);
        var dist = plane.distanceToPoint(_camera.pivot);
        _camera.pivot.copy(eyeVec).multiplyScalar(dist).add(_camera.position);
    };

    var _onMouseDownCircle = function(e) {
        if (!e.touches && e.button === 0)
            _centerPivot();     // center pivot before passing thru to orbit tool
    };

    var _clickToExit = function() {
        if (_isClickToExit)
            _this.viewer.setActiveNavigationTool();
    };

    var _clickToFocus = function(x, y) {
        var hit = _this.viewer.impl.hitTest(x, y);
        var newTarget;

        if (hit && hit.intersectPoint) {
            newTarget = hit.intersectPoint;
        }
        else {
            // intersect camera plane
            var ray = _this.viewer.impl.viewportToRay(_this.viewer.impl.clientToViewport(x, y));
            newTarget = new THREE.Vector3();
            ray.intersectPlane(_getCameraPlane(_camera.target), newTarget);
        }

        var newCamPos = _camera.position.clone().sub(_findTarget()).add(newTarget);
        _this.navapi.setRequestTransition(true, newCamPos, newTarget, _camera.fov);
    };


    // TOOL INTERFACE

    this.register = function() {
        _gizmoElem = stringToDOM(html);
        _gizmoElem.style.display = "none";
        this.viewer.canvasWrap.insertBefore(_gizmoElem, this.viewer.canvasWrap.firstChild);

        _ringElem = _gizmoElem.querySelector(".ring");
        _ringElem.addEventListener("mousedown", _onMouseDown);

        Array.prototype.forEach.call(_gizmoElem.querySelectorAll(".edgemark-area"), function(elem) {
            elem.addEventListener("mousedown", _onMouseDown);
            if (_isTouch) elem.addEventListener("touchstart", _onMouseDown);
        });

        this.addWindowEventListener("mouseup", _onMouseUp);
        this.addWindowEventListener("mousemove", _onMouseMove);

        // click to exit
        _outsideElem = _gizmoElem.querySelector(".outside");
        _outsideElem.addEventListener("mousedown", _clickToExit);

        // before passing thru to orbit (default) tool
        var circleElem = _gizmoElem.querySelector(".circle");
        circleElem.addEventListener("mousedown", _onMouseDownCircle);

        if (_isTouch) {
            _ringElem.addEventListener("touchstart", _onMouseDown);
            this.addWindowEventListener("touchend", _onMouseUp);
            this.addWindowEventListener("touchmove", _onMouseMove);
            _outsideElem.addEventListener("touchstart", _clickToExit);
            circleElem.addEventListener("touchstart", _onMouseDownCircle);
        }

        _camera = this.viewer.impl.camera;
    };

    this.deregister = function() {
        this.removeWindowEventListener("mouseup", _onMouseUp);
        this.removeWindowEventListener("mousemove", _onMouseMove);
        _outsideElem.removeEventListener("mousedown", _clickToExit);

        if (_isTouch) {
            this.removeWindowEventListener("touchend", _onMouseUp);
            this.removeWindowEventListener("touchmove", _onMouseMove);
            _outsideElem.removeEventListener("touchstart", _clickToExit);
        }

        this.viewer.canvasWrap.removeChild(_gizmoElem);

        _gizmoElem = undefined;
        _ringElem = undefined;
        _outsideElem = undefined;
    };

    this.activate = function(name) {
        _gizmoElem.style.display = "";

        this.handleResize();

        _isConstrained = (name === "fusion orbit constrained");

        var hyperlink = this.viewer.toolController.isToolActivated("hyperlink");

        // Need to make Hyperlink sit on top of default navigation tool
        if (hyperlink)
            this.viewer.toolController.deactivateTool("hyperlink");

        if (_isConstrained) {
            this.viewer.setDefaultNavigationTool("orbit");
            this.viewer.prefs.set("fusionOrbitConstrained", true);
        }
        else {
            this.viewer.setDefaultNavigationTool("freeorbit");
            this.viewer.prefs.set("fusionOrbitConstrained", false);
        }

        if (hyperlink)
            this.viewer.toolController.activateTool("hyperlink");

        this.viewer.navigation.setZoomTowardsPivot(true);
    };

    this.deactivate = function() {
        _gizmoElem.style.display = "none";
        this.viewer.navigation.setZoomTowardsPivot(this.viewer.prefs.get('zoomTowardsPivot'));
    };

    this.getNames = function() {
        return _names;
    };

    this.getName = function() {
        return _names[0];
    };

    this.update = function() {
        return false;
    };

    this.handleSingleClick = function( event ) {
        _clickToFocus(event.canvasX, event.canvasY);
        return true;
    };

    this.handleDoubleClick = function() {
        return true;    // disabled, does not play nice with SingleClick
    };

    this.handleSingleTap = function( event ) {
        _clickToFocus(event.canvasX, event.canvasY);
        return true;
    };

    this.handleDoubleTap = function() {
        return false;    // enabled, DoubleTap doesn't register the first SingleTap
    };

    this.handleKeyDown = function() {
        return false;
    };

    this.handleKeyUp = function() {
        return false;
    };

    this.handleWheelInput = function() {
        return false;
    };

    this.handleButtonDown = function() {
        return false;
    };

    this.handleButtonUp = function() {
        return false;
    };

    this.handleMouseMove = function(event) {
        var rect = this.viewer.impl.getCanvasBoundingClientRect();
        var vp;
        if (rect.width > rect.height) {
            vp = new THREE.Vector2(
                (((event.canvasX+0.5) / rect.width ) * 2 - 1) * rect.width/rect.height,
               -((event.canvasY+0.5) / rect.height) * 2 + 1
            );
        } else {
            vp = new THREE.Vector2(
                (((event.canvasX+0.5) / rect.width ) * 2 - 1),
                (-((event.canvasY+0.5) / rect.height) * 2 + 1) * rect.height/rect.width
            );
        }

        var radius = vp.length();

        var isOutside = radius > _EXIT_PERCENT_SIZE;
        if (_isClickToExit !== isOutside) {
            if (isOutside)
                _outsideElem.style.cursor = "";
            else
                _outsideElem.style.cursor = _CIRCLE_CURSOR_STYLE;
            _isClickToExit = isOutside;
            // console.log("click exit: " + _isClickToExit);
        }

        return false;
    };

    this.handleGesture = function() {
        _centerPivot();
        return false;
    };

    this.handleBlur = function() {
        return false;
    };

    this.handleResize = function() {
        // for mouse roll
        var rect = _gizmoElem.getBoundingClientRect();
        const _window = this.getWindow();
        _gizmoRect.left = rect.left + _window.pageXOffset;
        _gizmoRect.top = rect.top + _window.pageYOffset;
        _gizmoRect.width = rect.width;
        _gizmoRect.height = rect.height;
        _gizmoRect.center = {};
        _gizmoRect.center.x = _gizmoRect.left + _gizmoRect.width/2;
        _gizmoRect.center.y = _gizmoRect.top + _gizmoRect.height/2;

        // resize gizmo
        var dim = (_window.innerWidth > _window.innerHeight ? _window.innerHeight : _window.innerWidth) * _PERCENT_SIZE;
        _gizmoElem.style.width = _gizmoElem.style.height = ""+dim+"px";
        _gizmoElem.style.top = _gizmoElem.style.left = "calc(50% - "+(dim/2)+"px)";
        _ringElem.style.borderWidth = ""+(dim*0.1)+"px";
    };
}

av.GlobalManagerMixin.call(FusionOrbitTool.prototype);

