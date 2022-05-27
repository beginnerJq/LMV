import * as THREE from "three";
import i18n from "i18next";
import { GlobalManagerMixin } from '../../application/GlobalManagerMixin';
import {VIEW_TYPES} from "../../application/PreferenceNames";

// Number.MIN_VALUE is specified as the smallest number greater than 0 possible (5e-324). In Fusion on Mac,
// Number.MIN_VALUE is exactly 0 for reasons that escape me. This causes issues with the Autocam code. Interestingly,
// Fusion on Mac can't represent the number 5e-324. The smallest it can do is 3e-308 (found via trial and error).
// Sadly, this constant can't be overwritten so monkey patching is out of the question. Instead use our own constant.
// See DC-11061
const MIN_VALUE = Number.MIN_VALUE || 3e-308;

const EPSILON = 0.00001;

/**
 * Clamps a vector to an axis aligned unit vector if it's sufficiently close. This is to help deal with THREE doing:
 * var t = new THREE.Vector3(0, 0, -0.6873695734180347);
 * t.normalize();
 * t.z; // -0.9999999999999999
 *
 * and us doing direct comparisons of floating point numbers.
 *
 * @param {THREE.Vector3} vec - The vector to check and clamp. This vector may be modified
 */
function clampToUnitAxisIfNeeded(vec) {
    const tolerance = 1e-12;
    if (Math.abs(vec.x) < tolerance && Math.abs(vec.y) < tolerance) {
        vec.set(0, 0, vec.z > 0 ? 1 : -1);
    } else if (Math.abs(vec.y) < tolerance && Math.abs(vec.z) < tolerance) {
        vec.set(vec.x > 0 ? 1 : -1, 0, 0);
    } else if (Math.abs(vec.z) < tolerance && Math.abs(vec.x) < tolerance) {
        vec.set(0, vec.y > 0 ? 1 : -1, 0);
    }
}

/**
 * Autocam is the container for the view cube and steering wheel classes.
 * It contains math for camera transformations and most of the functions are retrieved from SampleCAM.
 * Refer to their documentation for explanation.
 */
export function Autocam(camera, navApi, canvas) {

    var cam = this;
    var dropDownMenu = null;
    var _changing = false;

    this.cube = null;
    this.camera = camera;
    this.renderer = 'WEBGL';
    this.startState = {};
    this.navApi = navApi;   // TODO: use this for camera sync.
    this.orthographicFaces = false;
    this.canvas = canvas;

    this.cameraChangedCallback = function(){};
    this.pivotDisplayCallback = function(){};
    this.transitionCompletedCallback = function(){};

    //delta Time
    var startTime = Date.now();
    var deltaTime;
    var setHomeDeferred = false;

    function changed(worldUpChanged)
    {
        _changing = true;
        camera.target.copy(cam.center);
        camera.pivot.copy(cam.pivot);

        if( camera.worldup )
            camera.worldup.copy(cam.sceneUpDirection);
        else
            camera.up.copy(cam.sceneUpDirection);

        cam.cameraChangedCallback(worldUpChanged);
        _changing = false;
    }
    
    this.recordTime = true;
    this.dtor = function() {
        this.cube = null;
        this.cameraChangedCallback = null;
        this.pivotDisplayCallback = null;
        this.transitionCompletedCallback = null;
        this.canvas = null;
        this.recordTime = false;
        this.afAnimateTransition && cancelAnimationFrame(this.afAnimateTransition);
    };

    this.registerCallbackCameraChanged = function(callback) {
        this.cameraChangedCallback = callback;
    };
    this.registerCallbackPivotDisplay = function(callback) {
        this.pivotDisplayCallback = callback;
    };
    this.registerCallbackTransitionCompleted = function(callback) {
        this.transitionCompletedCallback = callback;
    };

    this.showPivot = function(state)
    {
        this.pivotDisplayCallback(state);
    };

    this.setWorldUpVector = function( newUp )
    {
        if( _changing )
            return;

        if( newUp && (newUp.lengthSq() > 0) && !newUp.normalize().equals(this.sceneUpDirection) )
        {
            // Changing up resets the front face:
            this.sceneUpDirection.copy( newUp );
            this.sceneFrontDirection.copy( this.getWorldFrontVector() );
            this.cubeFront.copy(this.sceneFrontDirection).cross(this.sceneUpDirection).normalize();
            if( this.cube )
                requestAnimationFrame(this.cube.render);
        }
    };

    this.getWorldUpVector = function()
    {
        return this.sceneUpDirection.clone();
    };

    // Assumes sceneUpDirection is set.
    this.getWorldRightVector = function()
    {
        var vec = this.sceneUpDirection.clone();

        if (Math.abs(vec.z) <= Math.abs(vec.y))
        {
            // Cross(Vertical, ZAxis)
            vec.set(vec.y, -vec.x, 0);
        }
        else if (vec.z >= 0)
        {
            // Cross(YAxis, Vertical)
            vec.set(vec.z, 0, -vec.x);
        }
        else
        {
            // Cross(Vertical, YAxis)
            vec.set(-vec.z, 0, vec.x);
        }
        return vec.normalize();
    };

    // Assumes sceneUpDirection is set.
    this.getWorldFrontVector = function()
    {
        var up = this.getWorldUpVector();
        return up.cross(this.getWorldRightVector()).normalize();
    };

    this.goToView = function( viewVector ) {
        if( this.navApi.isActionEnabled('gotoview') ) {
            var destination = {
                position: viewVector.position.clone(),
                      up: viewVector.up.clone(),
                  center: viewVector.center.clone(),
                   pivot: viewVector.pivot.clone(),
                     fov: viewVector.fov,
                 worldUp: viewVector.worldUp.clone(),
                 isOrtho: viewVector.isOrtho
            };

            // add global position/center/pivot - which are stable under globalOffset changes
            this.addGlobalPositions(destination);

            cam.elapsedTime = 0;
            this.animateTransition(destination);
        }
    };

    this.getCurrentView = function () {
        return {
            position: camera.position.clone(),
            up: camera.up.clone(),
            center: this.center.clone(),
            pivot: this.pivot.clone(),
            fov: camera.fov,
            worldUp: this.sceneUpDirection.clone(),
            isOrtho: (camera.isPerspective === false)
        };
    };

    this.setCurrentViewAsHome = function( focusFirst ) {
        if( focusFirst ) {
            this.navApi.setRequestFitToView(true);
            setHomeDeferred = true;
        }
        else {
            this.homeVector = this.getCurrentView();
        }
    };

    // This method sets both the "current" home and the "original" home.
    // The latter is used for the "reset home" function.
    this.setHomeViewFrom = function(camera) {
        var pivot   = camera.pivot   ? camera.pivot   : this.center;
        var center  = camera.target  ? camera.target  : this.pivot;
        var worldup = camera.worldup ? camera.worldup : this.sceneUpDirection;

        this.homeVector = {
            position: camera.position.clone(),
                  up: camera.up.clone(),
              center: center.clone(),
               pivot: pivot.clone(),
                 fov: camera.fov,
             worldUp: worldup.clone(),
             isOrtho: (camera.isPerspective === false)
        };

        this.originalHomeVector = {
            position: camera.position.clone(),
                  up: camera.up.clone(),
              center: center.clone(),
               pivot: pivot.clone(),
                 fov: camera.fov,
             worldUp: worldup.clone(),
          worldFront: this.sceneFrontDirection.clone(),  // Extra for reset orientation
             isOrtho: (camera.isPerspective === false)
        };

        // Remember global positions as well - which keep stable under globalOffset changes.
        this.addGlobalPositions(this.homeVector);
        this.addGlobalPositions(this.originalHomeVector);
    };

    this.toPerspective = function() {
        if( !camera.isPerspective ) {
            camera.toPerspective();
            changed(false);
        }
    };

    this.toOrthographic = function() {
        if( camera.isPerspective ) {
            camera.toOrthographic();
            changed(false);
        }
    };

    this.setOrthographicFaces = function(state) {
         this.orthographicFaces = state;
    };

    this.getViewType = function() {
        if (this.orthographicFaces) {
            return VIEW_TYPES.PERSPECTIVE_ORTHO_FACES;
        }

        return camera.isPerspective ? VIEW_TYPES.PERSPECTIVE : VIEW_TYPES.ORTHOGRAPHIC;
    };

    this.setViewType = function(viewType, isFaceView) {
        switch (viewType) {
            case VIEW_TYPES.ORTHOGRAPHIC:
                this.setOrthographicFaces(false);
                this.toOrthographic();
                return true;
            case VIEW_TYPES.PERSPECTIVE:
                this.setOrthographicFaces(false);
                this.toPerspective();
                return true;
            case VIEW_TYPES.PERSPECTIVE_ORTHO_FACES:
                this.setOrthographicFaces(true);
                if (isFaceView === undefined) {
                    isFaceView = this.isFaceView();
                }

                if (isFaceView) {
                    this.toOrthographic();
                } else {
                    this.toPerspective();
                }
                return true;
            default:
                // This viewType is not supported.
                // We do not want to call the view type changed callback
                return false;
        }
    };

    this.goHome = function() {
        if( this.navApi.isActionEnabled('gotoview') ) {
            this.navApi.setPivotSetFlag(false);
            this.goToView( this.homeVector );
        }
    };

    this.resetHome = function() {
        this.homeVector.position.copy(this.originalHomeVector.position);
        this.homeVector.up.copy(this.originalHomeVector.up);
        this.homeVector.center.copy(this.originalHomeVector.center);
        this.homeVector.pivot.copy(this.originalHomeVector.pivot);
        this.homeVector.fov = this.originalHomeVector.fov;
        this.homeVector.worldUp.copy(this.originalHomeVector.worldUp);
        this.homeVector.isOrtho = this.originalHomeVector.isOrtho;
        this.goHome();
    };

    this.getView = function() {
        return this.center.clone().sub(camera.position);
    };

    this.setCameraUp = function(up) {
        var view = this.dir.clone();
        var right = view.cross(up).normalize();
        if( right.lengthSq() === 0 )
        {
            // Try again after perturbing eye direction:
            view.copy(this.dir);
            if( up.z > up.y )
                view.y += 0.0001;
            else
                view.z += 0.0001;

            right = view.cross(up).normalize();
        }
        // Orthogonal camera up direction:
        camera.up.copy(right).cross(this.dir).normalize();
    };

    // Add global positions to view. These are used on globalOffset changes.
    this.addGlobalPositions = function(view) {
        // use globalOffset of current camera by default
        var globalOffset = this.camera.globalOffset;

        view.globalPosition = view.position.clone().add(globalOffset);
        view.globalCenter = view.center.clone().add(globalOffset);
        view.globalPivot = view.pivot.clone().add(globalOffset);
    }

    function updateViewGlobalOffset(view, newOffset) {
        view.position.copy(view.globalPosition).sub(newOffset);
        view.center.copy(view.globalCenter).sub(newOffset);
        view.pivot.copy(view.globalPivot).sub(newOffset);
    };

    // If the dynamic viewer globalOffset changes, we must update our saved views.
    this.onGlobalOffsetChanged = function(newOffset) {
        updateViewGlobalOffset(this.homeVector, newOffset);
        updateViewGlobalOffset(this.originalHomeVector, newOffset);
        this.camera.setGlobalOffset(newOffset);
    };

    var that = this;
    (function animate() {
        if (that.recordTime) {
            requestAnimationFrame(animate);
        }
        // Is there an assumption here about the order of animation frame callbacks?
        var now = Date.now();
        deltaTime = now - startTime;
        startTime = now;
    }());

    //Control variables
    this.ortho = false;
    this.center = camera.target ? camera.target.clone() : new THREE.Vector3(0,0,0);
    this.pivot = camera.pivot ? camera.pivot.clone() : this.center.clone();

    this.sceneUpDirection    = camera.worldup ? camera.worldup.clone() : camera.up.clone();
    this.sceneFrontDirection = this.getWorldFrontVector();

    //
    //dir, up, left vector
    this.dir = this.getView();

    // Compute "real" camera up:
    this.setCameraUp(camera.up);

    this.saveCenter = this.center.clone();
    this.savePivot  = this.pivot.clone();
    this.saveEye    = camera.position.clone();
    this.saveUp     = camera.up.clone();
    var prevEye, prevCenter, prevUp, prevPivot;

    this.cubeFront = this.sceneFrontDirection.clone().cross(this.sceneUpDirection).normalize();

    this.setHomeViewFrom(camera);

    var rotInitial = new THREE.Quaternion();
    var rotFinal   = new THREE.Quaternion();
    var rotTwist   = new THREE.Quaternion();
    var rotSpin    = new THREE.Quaternion();
    var distInitial;
    var distFinal;

    /**
     * Holds the default pan speed multiplier of 0.5
     * @type {number}
     */
    this.userPanSpeed = 0.5;

    /**
     * Holds the default look speed multiplier of 2.0
     * @type {number}
     */
    this.userLookSpeed = 2.0;

    /**
     * Holds the default height speed multiplier of 5.0 (used in updown function)
     * @type {number}
     */
    this.userHeightSpeed = 5.0;

    /**
     * Holds the current walk speed multiplier, which can be altered in the steering wheel drop down menu (between 0.24 and 8)
     * @type {number}
     */
    this.walkMultiplier = 1.0;

    /**
     * Holds the default zoom speed multiplier of 1.015
     * @type {number}
     */
    this.userZoomSpeed = 1.015;

    /**
     * Holds the orbit multiplier of 5.0
     * @type {number}
     */
    this.orbitMultiplier = 5.0;
    this.currentlyAnimating = false;

    //look
    camera.keepSceneUpright = true;

    //orbit
    this.preserveOrbitUpDirection = true;
    this.alignOrbitUpDirection = true;
    this.constrainOrbitHorizontal = false;
    this.constrainOrbitVertical = false;
    this.doCustomOrbit = false;
    this.snapOrbitDeadZone = 0.045;
    this.snapOrbitThresholdH = this.snapOrbitThresholdV = THREE.Math.degToRad(15.0);
    this.snapOrbitAccelerationAX = this.snapOrbitAccelerationAY = 1.5;
    this.snapOrbitAccelerationBX = this.snapOrbitAccelerationBY = 2.0;
    this.snapOrbitAccelerationPointX = this.snapOrbitAccelerationPointY = 0.5;

    this.combined = false;

    //variables used for snapping
    this.useSnap = false;
    this.lockDeltaX = 0.0;
    this.lockedX = false;
    this.lastSnapRotateX = 0.0;
    this.lockDeltaY = 0.0;
    this.lockedY = false;
    this.lastSnapRotateY = 0.0;
    this.lastSnapDir = new THREE.Vector3(0,0,0);

    //up-down
    this.topLimit = false;
    this.bottomLimit = false;
    this.minSceneBound = 0;
    this.maxSceneBound = 0;

    //shot
    var shotParams = { destinationPercent:1.0, duration:1.0, zoomToFitScene:true, useOffAxis:false };
    this.shotParams = shotParams;   // Expose these for modification
    var camParamsInitial, camParamsFinal;

    //zoom
    this.zoomDelta = new THREE.Vector2();
    var unitAmount = 0.0;

    //walk
    var m_resetBiasX, m_resetBiasY, m_bias;

    this.viewCubeMenuOpen = false;
    this.menuSize = new THREE.Vector2(0,0);
    this.menuOrigin = new THREE.Vector2(0,0);

    camera.lookAt(this.center);

    // function windowResize(){
        // refresh camera on size change

        // We handle this elsewhere
        /*
            renderer.setSize( window.innerWidth, window.innerHeight );
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.topFov = camera.bottomFov = camera.fov/2;
            camera.leftFov = camera.rightFov = (camera.aspect * camera.fov)/2;
            camera.updateProjectionMatrix();
        */
    // }

    /***
    windowResize();
    window.addEventListener('resize', windowResize, false);
    ***/

    this.setCube = function(viewcube)
    {
        this.cube = viewcube;    // DOH!!!
    };

    // Sync our local data from the given external camera:
    this.sync = function(clientCamera) {
        if( clientCamera.isPerspective !== camera.isPerspective ) {
            if( clientCamera.isPerspective ) {
                camera.toPerspective();
            }
            else {
                camera.toOrthographic();
                if( clientCamera.saveFov )
                    camera.saveFov = clientCamera.saveFov;
            }
        }
        camera.fov = clientCamera.fov;
        camera.position.copy(clientCamera.position);

        if( clientCamera.target ) {
            this.center.copy(clientCamera.target);
            camera.target.copy(clientCamera.target);
        }
        if( clientCamera.pivot ) {
            this.pivot.copy(clientCamera.pivot);
            camera.pivot.copy(clientCamera.pivot);
        }
        this.dir.copy(this.center).sub(camera.position);

        this.setCameraUp(clientCamera.up);

        var worldUp = clientCamera.worldup ? clientCamera.worldup : clientCamera.up;
        if( worldUp.distanceToSquared(this.sceneUpDirection) > 0.0001 ) {
            this.setWorldUpVector(worldUp);
        }

        if( setHomeDeferred && !this.navApi.getTransitionActive() ) {
            setHomeDeferred = false;
            this.setCurrentViewAsHome(false);
        }
        if( this.cube )
            requestAnimationFrame(this.cube.render);
    };


    this.refresh = function() {
        if( this.cube )
            this.cube.refreshCube();
    };

    /*        Prototyped Functions          */

    //so we dont need a matrix4 as an intermediate
    THREE.Matrix3.prototype.makeRotationFromQuaternion = function ( q ) {
        var te = this.elements;

        var x = q.x, y = q.y, z = q.z, w = q.w;
        var x2 = x + x, y2 = y + y, z2 = z + z;
        var xx = x * x2, xy = x * y2, xz = x * z2;
        var yy = y * y2, yz = y * z2, zz = z * z2;
        var wx = w * x2, wy = w * y2, wz = w * z2;

        te[0] = 1 - ( yy + zz );
        te[3] = xy - wz;
        te[6] = xz + wy;

        te[1] = xy + wz;
        te[4] = 1 - ( xx + zz );
        te[7] = yz - wx;

        te[2] = xz - wy;
        te[5] = yz + wx;
        te[8] = 1 - ( xx + yy );

        return this;
    };

    // changed to accept a matrix3
    THREE.Quaternion.prototype.setFromRotationMatrix3 = function ( m ) {
        // http://www.euclideanspace.com/maths/geometry/rotations/conversions/matrixToQuaternion/index.htm

        var te = m.elements,
            m11 = te[0], m12 = te[3], m13 = te[6],
            m21 = te[1], m22 = te[4], m23 = te[7],
            m31 = te[2], m32 = te[5], m33 = te[8],

            trace = m11 + m22 + m33,
            s;

        if ( trace > 0 ) {
            s = 0.5 / Math.sqrt( trace + 1.0 );
            this.w = 0.25 / s;
            this.x = ( m32 - m23 ) * s;
            this.y = ( m13 - m31 ) * s;
            this.z = ( m21 - m12 ) * s;
        } else if ( m11 > m22 && m11 > m33 ) {
            s = 2.0 * Math.sqrt( 1.0 + m11 - m22 - m33 );
            this.w = (m32 - m23 ) / s;
            this.x = 0.25 * s;
            this.y = (m12 + m21 ) / s;
            this.z = (m13 + m31 ) / s;
        } else if ( m22 > m33 ) {
            s = 2.0 * Math.sqrt( 1.0 + m22 - m11 - m33 );
            this.w = (m13 - m31 ) / s;
            this.x = (m12 + m21 ) / s;
            this.y = 0.25 * s;
            this.z = (m23 + m32 ) / s;
        } else {
            s = 2.0 * Math.sqrt( 1.0 + m33 - m11 - m22 );
            this.w = ( m21 - m12 ) / s;
            this.x = ( m13 + m31 ) / s;
            this.y = ( m23 + m32 ) / s;
            this.z = 0.25 * s;
        }
        return this;
    };

    // NOTE: This modifies the incoming vector!!
    // TODO: Change all calls to use Vector3.applyQuaternion instead.
    THREE.Quaternion.prototype.rotate = function (vector){
        //From AutoCamMath.h file
        var kRot = new THREE.Matrix4().makeRotationFromQuaternion(this);
        var e = kRot.elements;

        //converting 4d matrix to 3d
        var viewRot = new THREE.Matrix3().set( e[0],e[1],e[2], e[4],e[5],e[6], e[8],e[9],e[10] );

        return vector.applyMatrix3(viewRot);
    };


    function linearClamp( x, a, b ){
        if ( x <= a ) { return 0.0; }
        if ( x >= b ) { return 1.0; }

        return ( x - a ) / ( b - a );
    }

    function easeClamp( x, a, b ){
        if ( x <= a ) { return 0.0; }
        if ( x >= b ) { return 1.0; }

        var t = ( x - a ) / ( b - a );
        return 0.5 * ( Math.sin( (t - 0.5) * Math.PI ) + 1.0 );
    }

    function linearInterp( t, a, b ){
        return a * (1.0 - t) + b * t;
    }

    function equalityClamp(x,a,b){
        if ( x <= a ) { return a; }
        if ( x >= b ) { return b; }

        return x;
    }

    function round2(x){
        return (Math.round(x*100))/100;
    }

    function round1(x){
        return (Math.round(x*10))/10;
    }


    /*      SHOT OPERATION      */

    //transitions smoothly to destination
    this.animateTransition = function ( destination ) {

        // GlobalOffset may change during a transition. So, we make sure here that
        // the viewerCoords are computed based on latest globalOffset.
        updateViewGlobalOffset(destination, camera.globalOffset);

        if ( !destination ) { return; }

        var worldUpChanged = false;
        var unitTime = 0.0;

        this.setCameraOrtho(destination.isOrtho);

        if ( cam.elapsedTime >= shotParams.duration ) {
            unitTime = 1.0;

            cam.center.copy(destination.center);
            cam.pivot.copy(destination.pivot);
            camera.position.copy(destination.position);
            camera.up.copy(destination.up);
            camera.target.copy(destination.center);
            if( !destination.isOrtho )
                camera.fov = destination.fov;
            camera.dirty = true;

            worldUpChanged = !destination.worldUp.equals(this.sceneUpDirection);
            if( worldUpChanged )
                this.setWorldUpVector(destination.worldUp);

            this.currentlyAnimating = false;
            changed(worldUpChanged);
            this.showPivot(false);
            if( this.cube )
                requestAnimationFrame(this.cube.render);

            //this.addHistoryElement();
            this.navApi.setTransitionActive(false);
            this.transitionCompletedCallback();
            return;
        }
        this.currentlyAnimating = true;
        this.showPivot(true);
        this.navApi.setTransitionActive(true);

        var tMax = shotParams.destinationPercent;
        unitTime =  easeClamp( cam.elapsedTime / shotParams.duration, 0.0, tMax );
        var oneMinusTime = 1.0 - unitTime;
        cam.elapsedTime += deltaTime/500;

        var center = (cam.center.clone().multiplyScalar(oneMinusTime)).add( destination.center.clone().multiplyScalar( unitTime ));
        var position = (camera.position.clone().multiplyScalar(oneMinusTime)).add(destination.position.clone().multiplyScalar( unitTime ));
        var up = (camera.up.clone().multiplyScalar(oneMinusTime)).add(destination.up.clone().multiplyScalar( unitTime ));
        var pivot = (camera.pivot.clone().multiplyScalar(oneMinusTime)).add(destination.pivot.clone().multiplyScalar( unitTime ));
        var worldUp = (this.sceneUpDirection.clone().multiplyScalar(oneMinusTime)).add(destination.worldUp.clone().multiplyScalar( unitTime ));
        var fov = camera.fov * oneMinusTime + destination.fov * unitTime;

        cam.center.copy(center);
        cam.pivot.copy(pivot);
        camera.position.copy(position);
        camera.up.copy(up);
        camera.target.copy(center);
        if( !destination.isOrtho )
            camera.fov = fov;
        camera.dirty = true;

        worldUpChanged = (worldUp.distanceToSquared(this.sceneUpDirection) > 0.0001);
        if( worldUpChanged )
            this.setWorldUpVector(worldUp);

        camera.lookAt(cam.center);
        changed(worldUpChanged);

        if( this.cube )
            requestAnimationFrame(this.cube.render);

        cam.afAnimateTransition = requestAnimationFrame(function() { cam.animateTransition(destination); });
    };

    //used for view cube transforms, to see difference between this and linear interpolation watch
    //http://www.youtube.com/watch?v=uNHIPVOnt-Y
    this.sphericallyInterpolateTransition = function( completionCallback )
    {
        var center, position, up;
        var unitTime = 0.0;
        this.currentlyAnimating = true;
        this.navApi.setTransitionActive(true);

        if ( cam.elapsedTime >= shotParams.duration ){
            unitTime = 1.0;
            this.currentlyAnimating = false;
        }
        else {
            var tMax = shotParams.destinationPercent;
            unitTime =  easeClamp( cam.elapsedTime / shotParams.duration, 0.0, tMax );
            cam.elapsedTime += deltaTime/500;
        }

        // This seems to avoid some error in the rotation:
        if( unitTime === 1.0 ) {
            position = camParamsFinal.position;
            center   = camParamsFinal.center;
            up       = camParamsFinal.up;
        }
        else {
            var M = new THREE.Matrix3();
            var rot = rotInitial.clone();
            rot.slerp(rotFinal,(unitTime));
            M.makeRotationFromQuaternion(rot);
            var dist = linearInterp(unitTime, distInitial, distFinal);

            var e = M.elements;

            center = camParamsInitial.center.clone().multiplyScalar(1.0 - unitTime).add(camParamsFinal.center.clone().multiplyScalar(unitTime));
            position = center.clone().sub(new THREE.Vector3(e[0],e[1],e[2]).multiplyScalar(dist));
            up = new THREE.Vector3(e[3],e[4],e[5]);
        }
        cam.center.copy(center);
        camera.position.copy(position);
        camera.up.copy(up);

        // The above code will have to change if we want the proper rotation
        // to occur about the pivot point instead of the center.
        if( !cam.navApi.getUsePivotAlways() )
            cam.pivot.copy(center);

        camera.lookAt(cam.center);

        if( this.currentlyAnimating === true ) {
            this.showPivot(true);
            requestAnimationFrame(function() { cam.sphericallyInterpolateTransition(completionCallback); });
        }
        else {
            this.navApi.setTransitionActive(false);
            this.showPivot(false);
            //this.addHistoryElement();

            if( this.orthographicFaces && this.isFaceView() )
                this.setCameraOrtho(true);

            if( completionCallback )
                completionCallback();
        }
        changed(false);
        if( this.cube )
            requestAnimationFrame(this.cube.render);
    };

    //This is used to determine the relation between camera up vector and scene direction, used to determine which
    //face to translate to when clicking on a viewcube arrow
    this.getOrientation = function(){
        if( !this.cube )
            return;

        var camX = round1(camera.up.x);
        var camY = round1(camera.up.y);
        var camZ = round1(camera.up.z);
        var sceneFront = this.sceneFrontDirection.clone();
        var sceneUp = this.sceneUpDirection.clone();
        var sceneRight = this.sceneFrontDirection.clone().cross(this.sceneUpDirection).normalize();
        sceneFront.x = round1(sceneFront.x);
        sceneFront.y = round1(sceneFront.y);
        sceneFront.z = round1(sceneFront.z);
        sceneUp.x = round1(sceneUp.x);
        sceneUp.y = round1(sceneUp.y);
        sceneUp.z = round1(sceneUp.z);
        sceneRight.x = round1(sceneRight.x);
        sceneRight.y = round1(sceneRight.y);
        sceneRight.z = round1(sceneRight.z);
        var sceneLeft = sceneRight.clone().multiplyScalar(-1);
        var sceneDown = sceneUp.clone().multiplyScalar(-1);
        var sceneBack = sceneFront.clone().multiplyScalar(-1);

        switch (this.cube.currentFace){
            case "front":
                if (sceneUp.x == camX && sceneUp.y == camY && sceneUp.z == camZ)
                    return "up";
                else if (sceneDown.x == camX && sceneDown.y == camY && sceneDown.z == camZ)
                    return "down";
                else if (sceneRight.x == camX && sceneRight.y == camY && sceneRight.z == camZ)
                    return "right";
                else if (sceneLeft.x == camX && sceneLeft.y == camY && sceneLeft.z == camZ)
                    return "left";
                break;
            case "right":
                if (sceneUp.x == camX && sceneUp.y == camY && sceneUp.z == camZ)
                    return "up";
                else if (sceneDown.x == camX && sceneDown.y == camY && sceneDown.z == camZ)
                    return "down";
                else if (sceneBack.x == camX && sceneBack.y == camY && sceneBack.z == camZ)
                    return "left";
                else if (sceneFront.x == camX && sceneFront.y == camY && sceneFront.z == camZ)
                    return "right";
                break;
            case "left":
                if (sceneUp.x == camX && sceneUp.y == camY && sceneUp.z == camZ)
                    return "up";
                else if (sceneDown.x == camX && sceneDown.y == camY && sceneDown.z == camZ)
                    return "down";
                else if (sceneFront.x == camX && sceneFront.y == camY && sceneFront.z == camZ)
                    return "left";
                else if (sceneBack.x ==camX && sceneBack.y == camY && sceneBack.z == camZ)
                    return "right";
                break;
            case "back":
                if (sceneUp.x == camX && sceneUp.y == camY && sceneUp.z == camZ)
                    return "up";
                else if (sceneDown.x == camX && sceneDown.y == camY && sceneDown.z == camZ)
                    return "down";
                else if (sceneLeft.x == camX && sceneLeft.y == camY && sceneLeft.z == camZ)
                    return "right";
                else if (sceneRight.x == camX && sceneRight.y == camY && sceneRight.z == camZ)
                    return "left";
                break;
            case "top":
                if (sceneBack.x == camX && sceneBack.y == camY && sceneBack.z == camZ)
                    return "down";
                else if (sceneFront.x == camX && sceneFront.y == camY && sceneFront.z == camZ)
                    return "up";
                else if (sceneRight.x == camX && sceneRight.y == camY && sceneRight.z == camZ)
                    return "right";
                else if (sceneLeft.x == camX && sceneLeft.y == camY && sceneLeft.z == camZ)
                    return "left";
                break;
            case "bottom":
                if (sceneFront.x == camX && sceneFront.y == camY && sceneFront.z == camZ)
                    return "down";
                else if (sceneBack.x == camX && sceneBack.y == camY && sceneBack.z == camZ)
                    return "up";
                else if (sceneRight.x == camX && sceneRight.y == camY && sceneRight.z == camZ)
                    return "right";
                else if (sceneLeft.x == camX && sceneLeft.y == camY && sceneLeft.z == camZ)
                    return "left";
                break;
        }
    };

    this.setCameraOrtho = function(yes) {
        if( yes && camera.isPerspective )
            camera.toOrthographic();

        if( !yes && !camera.isPerspective )
            camera.toPerspective();
    };

    this.resetOrientation = function(){
        if( this.cube ) {
            this.cube.showCompass(this.cube.prevRenderCompass);
        }

        this.setCameraOrtho(this.originalHomeVector.isOrtho);
        this.sceneUpDirection.copy(this.originalHomeVector.worldUp);
        this.sceneFrontDirection.copy(this.originalHomeVector.worldFront);
        this.cubeFront.copy(this.sceneFrontDirection).cross(this.sceneUpDirection).normalize();
        this.setCameraUp(this.sceneUpDirection);
        changed(true);
    };

    this.setCurrentViewAsFront = function(){
        if( this.cube ) {
            this.cube.currentFace = "front";
            this.cube.showCompass(false); // hide the compass if the user changes the view
        }

        this.sceneUpDirection.copy(camera.up.clone());
        clampToUnitAxisIfNeeded(this.sceneUpDirection);

        this.sceneFrontDirection.copy(this.getView()).normalize();
        clampToUnitAxisIfNeeded(this.sceneFrontDirection);

        this.cubeFront.copy(this.sceneFrontDirection).cross(this.sceneUpDirection).normalize();
        clampToUnitAxisIfNeeded(this.cubeFront);

        if( this.orthographicFaces )
            this.setCameraOrtho(true);

        changed(true);
    };

    this.setCurrentViewAsTop = function(){
        if( this.cube ) {
            this.cube.currentFace = "top";
            this.cube.showCompass(false); // hide the compass if the user changes the view
        }

        this.sceneUpDirection.copy(this.getView()).multiplyScalar(-1).normalize();
        clampToUnitAxisIfNeeded(this.sceneUpDirection);

        this.sceneFrontDirection.copy(camera.up);
        clampToUnitAxisIfNeeded(this.sceneFrontDirection);

        this.cubeFront.copy(this.sceneFrontDirection).cross(this.sceneUpDirection).normalize();
        clampToUnitAxisIfNeeded(this.cubeFront);

        changed(true);
    };

    this.calculateCubeTransform = function(faceString){
        var worldUp = this.sceneUpDirection.clone();
        var worldFront = this.sceneFrontDirection.clone();
        var worldRight = this.sceneFrontDirection.clone().cross( this.sceneUpDirection).normalize();

        camParamsInitial = camera.clone();
        camParamsInitial.center = cam.center.clone();
        camParamsInitial.pivot = cam.pivot.clone();

        camParamsFinal = camera.clone();
        camParamsFinal.center = cam.center.clone();
        camParamsFinal.pivot = cam.pivot.clone();

        // find movement offset based on given boolean flags
        var offset = new THREE.Vector3( 0, 0, 0 );
        if ( faceString.indexOf('back') >= 0){
            offset = offset.add(worldFront);
        }
        if ( faceString.indexOf('front') >= 0){
            offset = offset.sub(worldFront);
        }
        if ( faceString.indexOf('top') >= 0){
            offset = offset.add(worldUp);
        }
        if ( faceString.indexOf('bottom') >= 0){
            offset = offset.sub(worldUp);
        }
        if ( faceString.indexOf('right') >= 0){
            offset = offset.add(worldRight);
        }
        if ( faceString.indexOf('left') >= 0){
            offset = offset.sub(worldRight);
        }
        var upDir = worldUp;

        // view looking at top or bottom chosen
        var test = offset.clone().normalize();

        if ( ( 1.0 - Math.abs(test.dot(worldUp)) ) < MIN_VALUE ) {
            //( offset == worldUp || offset == -worldUp )
            // find the principal view direction other than top/bottom closest to
            // the current view direction and use it as an up vector

            var viewDir = this.getView().normalize();
            var optUpDir = [ worldFront.clone(), worldFront.clone().negate(), worldRight.clone(), worldRight.clone().negate() ];

            // use both view and up vectors for test vector because transitioning from
            // top and bottom views, view direction is the same (but up direction is different)

            var sign = (test.dot(worldUp) > 0.0) ? +1.0 : -1.0; //( offset == worldUp ) ? +1.0 : -1.0;
            var testDir = viewDir.clone().add(camera.up.clone().multiplyScalar(sign)).normalize();

            var optValue = -2.0;

            for ( var i = 0; i < 4; i++ ){
                var value = testDir.dot( optUpDir[i] );

                if ( value > optValue ){
                    optValue = value;
                    upDir = optUpDir[i].multiplyScalar(sign);
                }
            }
        }

        distFinal = distInitial = this.getView().length();
        // WHY? camParamsFinal.center = this.originalCenter;
        camParamsFinal.position.copy(camParamsFinal.center.clone().add(offset.multiplyScalar(distFinal/offset.length())));
        camParamsFinal.up.copy(upDir);

        var D = camParamsInitial.center.clone().sub(camParamsInitial.position).normalize();
        var R = D.clone().cross(camParamsInitial.up).normalize();
        var U = R.clone().cross(D).normalize();
        var M = new THREE.Matrix3();
        M.set(D.x, U.x, R.x, D.y, U.y, R.y, D.z, U.z, R.z);
        rotInitial.setFromRotationMatrix3(M);

        D = camParamsFinal.center.clone().sub(camParamsFinal.position).normalize();
        R = D.clone().cross(camParamsFinal.up).normalize();
        U = R.clone().cross(D).normalize();
        M.set(D.x, U.x, R.x, D.y, U.y, R.y, D.z, U.z, R.z);
        //TODO: figure out when these angles aren't supposed to be 0, works for now
        rotTwist.setFromAxisAngle(D,0.0);
        rotSpin.setFromAxisAngle(U,0.0);
        rotFinal.setFromRotationMatrix3(M);
        rotFinal.multiply(rotTwist).multiply(rotSpin).normalize();

    };


    /*         Functions for operation         */

    //convert screen coords to window coords
    function convertCoordsToWindow( pixelX, pixelY ){
        var delta = new THREE.Vector2(0,0);

        var _window = cam.getWindow();
        delta.x = pixelX / _window.innerWidth;
        delta.y = pixelY / _window.innerHeight;

        return delta;
    }


    function getNextRotation(rotationType, snapAngle, lastDelta){
        var threshold, accelerationA, accelerationB, shiftZone;
        threshold = accelerationA = accelerationB = shiftZone = 0.0;

        var next = 0.0;
        var lockedAxis = null;
        var lockDelta = null;

        var deadZone = cam.snapOrbitDeadZone;
        var orbitMultiplier = cam.orbitMultiplier;

        if (rotationType == 'h'){
            threshold = cam.snapOrbitThresholdH;
            accelerationA = cam.snapOrbitAccelerationAX;
            accelerationB = cam.snapOrbitAccelerationBX;
            shiftZone = 1.0 -cam.snapOrbitAccelerationPointX;
            lockDelta = cam.lockDeltaX;
            lockedAxis = cam.lockedX;
        }else{
            threshold = cam.snapOrbitThresholdV;
            accelerationA = cam.snapOrbitAccelerationAY;
            accelerationB = cam.snapOrbitAccelerationBY;
            shiftZone = 1.0 -cam.snapOrbitAccelerationPointY;
            lockDelta = cam.lockDeltaY;
            lockedAxis = cam.lockedY;
        }

        if(!lockedAxis){
            if(Math.abs(snapAngle) > threshold){
                next = lastDelta * orbitMultiplier;
            }else if (Math.abs(snapAngle) > shiftZone * threshold){
                if(lastDelta * snapAngle > 0.0){
                    next = lastDelta * orbitMultiplier * accelerationA;
                }else{
                    next = lastDelta * orbitMultiplier * 1.0/accelerationA;
                }

            }else{
                if(lastDelta * snapAngle > 0.0){
                    next = lastDelta * orbitMultiplier * accelerationB;
                }else{
                    next = lastDelta * orbitMultiplier * 1.0/accelerationB;
                }

            }

            if(next * snapAngle > 0.0 && Math.abs(next) > Math.abs(snapAngle)){
                this.lockDeltaX = this.lockDeltaY = 0.0;	//want to reset both regardless of rotation axis
                lockedAxis = true;
                next = snapAngle;
            }

        }else{
            lockDelta += lastDelta;

            if(lockDelta < -deadZone){
                next =  (lockDelta + deadZone) * orbitMultiplier * 1.0/accelerationB;
                lockedAxis = false;
            }else if(lockDelta > deadZone){
                next =  (lockDelta - deadZone) * orbitMultiplier * 1.0/accelerationB;
                lockedAxis = false;
            }
        }
        return next;
    }



/// Returns true if the operation belongs to a chain of combined operations; otherwise returns false.
    function IsCombined(){
        return cam.combined;
    }

    function isInDeadZone(currentCursor, startCursor){

        var deadZone = 30;
        var res = false;

        var _window = cam.getWindow();
        var w = _window.innerWidth;
        var x = currentCursor.x % w;

        var h = _window.innerHeight;
        var y = currentCursor.y % h;


        var diffX = (x > 0) ? (x - startCursor.x) : (w + x - startCursor.x);
        var diffY = (y > 0) ? (y - startCursor.y) : (h + y - startCursor.y);

        if((Math.abs(diffX) < deadZone) &&  (Math.abs(diffY) < deadZone))
            res = true;

        return res;
    }

    function GetXYAndWrapCounts(currentCursor, startCursor, wrapCount ){
        var _window = cam.getWindow();
        wrapCount.x = (currentCursor.x - startCursor.x) / _window.innerWidth;
        currentCursor.x = startCursor.x + (currentCursor.x - startCursor.x) % _window.innerWidth;

        wrapCount.y = (currentCursor.y - startCursor.y) / _window.innerHeight;
        currentCursor.y = startCursor.y + (currentCursor.y - startCursor.y) % _window.innerHeight;
    }

    function setBias( set, currentCursor, startCursor ){
        var _window = cam.getWindow();
        if (m_bias && set){
            return;

        }else if (set){
            var deadZone = 30;
            var wrapCount = new THREE.Vector2();

            var x = currentCursor.x;
            var y = currentCursor.y;

            GetXYAndWrapCounts(currentCursor, startCursor, wrapCount);

            m_resetBiasX = _window.innerWidth * wrapCount.x;
            m_resetBiasY = _window.innerHeight * wrapCount.y;

            if (x < startCursor.x)
                x = x - 2 * deadZone;
            else
                x = x + 2 * deadZone;

            if (y < startCursor.y)
                y = y - 2 * deadZone;
            else
                y = y + 2 * deadZone;
        }
        m_bias = set;
    }

    function checkBoundaryConditions(amount, cursorOffset, m_amount){
        if (cursorOffset === 0)
            return 0;

        var deltaAmount = amount;
        var eye = cam.saveEye.clone().sub(worldUp.clone().multiplyScalar(m_amount + deltaAmount));
        var prevEye = cam.saveEye.clone().sub(worldUp.clone().multiplyScalar(m_amount));

        var eyeHeight = 0.0;
        var epsilon = (cam.maxSceneBound - cam.minSceneBound) / 1000;

        //avp.logger.log(m_amount);
        //avp.logger.log(deltaAmount);


        if (cam.topLimit && (cursorOffset > 0)){
            // Cursor was on the top of the slider, but now is moving down.
            // Bring eyeHeight below maxSceneBound.
            eyeHeight = cam.maxSceneBound - epsilon;
            cam.topLimit = false;
        }else if (cam.bottomLimit && (cursorOffset < 0)){
            // Cursor was on the bottom of the slider, but now is moving up.
            // Bring eyeHeight above minSceneBound.
            eyeHeight = cam.minSceneBound + epsilon;
            cam.bottomLimit = false;
        }else{
            eyeHeight = eye.dot(worldUp);
        }

        var prevEyeHeight =	prevEye.dot(worldUp);

        //avp.logger.log(eyeHeight);

        if ( eyeHeight < cam.minSceneBound ) {
            if ( prevEyeHeight < cam.minSceneBound) {
                // this limits how far under the min we can go
                cam.bottomLimit = true;
                deltaAmount = 0.0;
            }
        }else if ( eyeHeight > cam.maxSceneBound ) {
            if ( prevEyeHeight > cam.maxSceneBound ) {
                // This limits how far over the max we can go
                cam.topLimit = true;
                deltaAmount = 0.0;
            }
        }

        return deltaAmount;
    }

    function getMoveAmountFromCursorOffset(offset){
        // Manipulating with power of 2 of cursor offset allows to amplify the visible change in the offset
        // when the offset is big to achieve the effect ofhigher sensitivity of the tool on small offsets
        // and lower sensitivity on big offsets.
        var derivedOffset = Math.pow (offset, 2.0);
        if (offset < 0){
            derivedOffset = -derivedOffset;
        }

        //delta.y = derivedOffset;
        var delta = convertCoordsToWindow( 0, derivedOffset );
        var sceneHeight = cam.maxSceneBound - cam.minSceneBound;

        // This empirical step provides a good motion of the scene when moving up/down.
        var p = sceneHeight * 0.01;
        delta.y *= p;

        var deltaAmount = cam.userHeightSpeed * delta.y;
        deltaAmount = checkBoundaryConditions(deltaAmount, offset, cam.m_amount);

        return deltaAmount;
    }

    /**
     * Draws a menu by appending an unordered list to the given container element.
     * @param {Array} menuOptions - string array of menu options, null meaning seperator
     * @param {Array} menuEnables - boolean array of menu enable flags indicating which corresponding menu entry in menuOptions should be enabled or disabled.
     * @param {Number} mousex - the x coordinate of the menu trigger point, used to position menu
     * @param {Number} mousey - the y coordinate of the menu trigger point, used to position menu
     * @param {HTMLElement} container - the container element to add the menu to.
     * @param {Object} position - object with x, y, w, h of the container element.
     */
    this.drawDropdownMenu = function(menuOptions, menuEnables, menuCallbacks, mousex, mousey, container, position) {
        var itemID = 0;

        var _document = this.getDocument();
        if( !dropDownMenu ) {

            dropDownMenu = _document.createElement('div');
            dropDownMenu.className = 'dropDownMenu';

            // Initialize the top and left with some approximate values
            // so that the correct width can be returned by gerBoudningClientRect().
            dropDownMenu.style.top    = '100px';
            dropDownMenu.style.left   = '-400px';

            var menuHeight = 0;
            var menuMinWidth = 0;
            for (var i = 0; i<menuOptions.length; i++){
                var listItem;
                if (menuOptions[i] === null) {                       // menu separator
                    listItem = _document.createElement("li");
                    listItem.style.height = '1px';
                    menuHeight += 1;
                    listItem.style.backgroundColor="#E0E0E0";
                } else {
                    var content = i18n.t(menuOptions[i]);
                    menuMinWidth = content.length > menuMinWidth ? content.length : menuMinWidth;

                    if( menuCallbacks[i] ) {
                        listItem = _document.createElement("div");
                        var check = _document.createElement("input");
                        var text  = _document.createElement("label");
                        check.type = "radio";
                        check.className = "dropDownMenuCheck";
                        text.innerHTML = content;
                        text.className = "dropDownMenuCheckText";
                        listItem.appendChild(check);
                        listItem.appendChild(text);
                        listItem.className = "dropDownMenuCheckbox";
                    }
                    else {
                        listItem = _document.createElement("li");
                        listItem.textContent = content;
                        listItem.className = menuEnables[i] ? "dropDownMenuItem" : "dropDownMenuItemDisabled";
                    }

                    listItem.id = "menuItem" + itemID;
                    itemID++;
                    menuHeight += 25;       // HACK!!!

                    listItem.setAttribute( "data-i18n", menuOptions[i] );
                }
                dropDownMenu.appendChild(listItem);
            }

            // Add the menu to the DOM before asking for boundingClientRect.
            // Otherwise, it will be zero.
            container.appendChild(dropDownMenu);

            dropDownMenu.style.minWidth = Math.max(256, menuMinWidth * 7.4) + 'px'; // approximate min width
            var menuWidth = dropDownMenu.getBoundingClientRect().width;

            this.menuSize.x = menuWidth;
            this.menuSize.y = menuHeight;
        }
        else {
            // Just add the drop down menu, It already exists.
            container.appendChild(dropDownMenu);
        }
        itemID = 0;
        for (var i = 0; i<menuOptions.length; i++) {
            if( menuOptions[i] === null )
                continue;

            if( menuCallbacks[i] ) {
                var id = "menuItem" + itemID;
                var element = _document.getElementById(id);
                if( element ) {
                    element.children[0].checked = menuCallbacks[i]();
                }
            }
            itemID++;
        }
        var top  = mousey - 15;        // 15 offset so list appears @ button
        var left = mousex + 1;

        var rect = this.canvas.getBoundingClientRect();

        if( (left + this.menuSize.x) > rect.right )
            left = mousex - this.menuSize.x - 1;
        if( (top + this.menuSize.y) > rect.bottom )
            top = rect.bottom - this.menuSize.y;

        // Make relative to container:
        top  -= position.y;
        left -= position.x;

        dropDownMenu.style.top  = top + 'px';
        dropDownMenu.style.left = left + 'px';

        this.menuOrigin.x = left;
        this.menuOrigin.y = top;
    };


    this.removeDropdownMenu = function(container) {
        container.removeChild(dropDownMenu);
    };

    function isAxisAligned(vec) {
        var sceneRight  = cam.sceneFrontDirection.clone().cross(cam.sceneUpDirection);
        var checkUp    = Math.abs(Math.abs(vec.dot(cam.sceneUpDirection)) - 1.0);
        var checkFront = Math.abs(Math.abs(vec.dot(cam.sceneFrontDirection)) - 1.0);
        var checkRight = Math.abs(Math.abs(vec.dot(sceneRight)) - 1.0);

        return (checkUp < EPSILON || checkFront < EPSILON || checkRight < EPSILON);
    }

    this.isFaceView = function() {
        var dir = this.center.clone().sub(camera.position).normalize();
        return isAxisAligned(dir) && isAxisAligned(camera.up);
    };

    this.startInteraction = function (x, y) {
        this.startCursor = new THREE.Vector2(x, y);

        this.startState = {
            saveCenter: this.center.clone(),
            saveEye:    this.camera.position.clone(),
            savePivot:  this.pivot.clone(),
            saveUp:     this.camera.up.clone()
        };

        this.lockDeltaX = 0.0;
        this.lockedX = false;
        this.lastSnapRotateX = 0.0;
        this.lockDeltaY = 0.0;
        this.lockedY = false;
        this.lastSnapRotateY = 0.0;
        this.lastSnapDir = new THREE.Vector3(0,0,0);

        this.navApi.setTransitionActive(true);
    };

    this.orbit = function (currentCursor, startCursor, distance, startState){
        if( !this.navApi.isActionEnabled('orbit') || this.currentlyAnimating === true )
            return;

        var mode = 'wheel';

        // If orthofaces is enabled, and camera is ortho
        // then switch to perspective
        if(cam.orthographicFaces && !camera.isPerspective) {
            camera.toPerspective();

            // Hack: update the start state with the new position:
            if( startState )
                startState.saveEye.copy(this.camera.position);
        }
        if (startState){
            mode = 'cube';
        }
        if (mode == 'cube'){
            this.saveCenter.copy(startState.saveCenter);
            this.saveEye.copy(startState.saveEye);
            this.savePivot.copy(startState.savePivot);
            this.saveUp.copy(startState.saveUp);
            this.useSnap = true;
            this.doCustomOrbit = true;
        } else {
            this.saveCenter.copy(this.center);
            this.savePivot.copy(this.pivot);
            this.saveEye.copy(camera.position);
            this.saveUp.copy(camera.up);
            this.useSnap = false;
            this.doCustomOrbit = false;
        }

        if (IsCombined() && prevCenter == undefined) {
            prevCenter = this.saveCenter.clone();
            prevEye    = this.saveEye.clone();
            prevPivot  = this.savePivot.clone();
            prevUp     = this.saveUp.clone();
        }

        // TODO: fold the two cases into one and prevent duplicate code
        if (this.preserveOrbitUpDirection ) {

            var delta = convertCoordsToWindow( currentCursor.x - startCursor.x, currentCursor.y - startCursor.y );
            var lastDelta = convertCoordsToWindow(distance.x, distance.y);

            var worldUp = this.sceneUpDirection.clone();
            var worldFront = this.sceneFrontDirection.clone();
            var worldRight = this.sceneFrontDirection.clone().cross( this.sceneUpDirection).normalize();

            /* ????? WTF:
            var worldFront = new THREE.Vector3(1,0,0);
            var worldUp = new THREE.Vector3(0,1,0);
            */

            //viewcube
            // if (this.doCustomOrbit ) {
            //     worldUp = new THREE.Vector3(0,1,0);
            //     worldFront = new THREE.Vector3(1,0,0);
            // }

            /* ?????? WTF:
            var worldR = worldFront.clone().cross( worldUp );
            worldUp = worldR.clone().cross(worldFront);
            worldUp.clone().normalize();
            */

            var pivot  = IsCombined() ? prevPivot  : this.savePivot;
            var eye    = IsCombined() ? prevEye    : this.saveEye;
            var center = IsCombined() ? prevCenter : this.saveCenter;
            var camUp  = IsCombined() ? prevUp     : this.saveUp;

            var initViewDir  = pivot.clone().sub(eye).normalize();
            var initViewDirV = center.clone().sub(eye).normalize();
            var initRightDir = initViewDirV.clone().cross( camUp );

            var fTargetDist  = eye.clone().sub(pivot).length();
            var fTargetDistV = eye.clone().sub(center).length();

            var vLookUpdate  = initViewDir.clone().multiplyScalar(-1);
            var vLookUpdateV = initViewDirV.clone().multiplyScalar(-1);
            var vRightUpdate = initRightDir;
            var vUpUpdate = camUp.clone();

            var snapAngleh = 0.0;
            var snapAnglev = 0.0;

            //viewcube

            if ( !this.constrainOrbitHorizontal ) {
                // Need to check if:
                //  1. camera is "upside-down" (angle between world up and camera up is obtuse) or
                //  2. camera is in top view (camera up perpendicular to world up and view angle acute to world up)
                // These cases required a reversed rotation direction to maintain consistent mapping of tool:
                //  left->clockwise, right->counter-clockwise
                //
                //  PHB June 2014 - #2 above makes no sense to me. If the camera up is perpendicular to the
                //  world up then the view is parallel to world up (view dot up == 1). So the second test is
                //  meaningless. There is no good way to determine the rotation direction in this case. If you
                //  want it to feel like direct manipulation then it would be better to determine if the cursor
                //  is above or below the pivot in screen space.

                var worldUpDotCamUp = worldUp.dot(this.saveUp);
                // var worldUpDotView  = worldUp.dot(this.saveCenter.clone().sub(this.saveEye).normalize());

                // if ((worldUpDotCamUp < -MIN_VALUE) ||
                //     ((Math.abs(worldUpDotCamUp) < MIN_VALUE) && (worldUpDotView > 0.0)))
                //
                var kFlipTolerance = 0.009;     // Must be flipped by more than about 0.5 degrees
                if( worldUpDotCamUp < -kFlipTolerance ) {
                    delta.x = -delta.x;
                    lastDelta.x = -lastDelta.x;
                }

                var dHorzAngle = 0.0;
                if (IsCombined()) {
                    dHorzAngle = lastDelta.x * this.orbitMultiplier;
                } else {
                    dHorzAngle = this.useSnap ? this.lastSnapRotateX + getNextRotation('h', snapAngleh, -lastDelta.x) :
                        delta.x * this.orbitMultiplier;
                }

                this.lastSnapRotateX = dHorzAngle;
                // Define rotation transformation

                var quatH = new THREE.Quaternion().setFromAxisAngle( worldUp, -dHorzAngle );

                vLookUpdate.applyQuaternion(quatH);
                vLookUpdateV.applyQuaternion(quatH);
                vRightUpdate.applyQuaternion(quatH);
                vUpUpdate.applyQuaternion(quatH);
            }

            if ( !this.constrainOrbitVertical ) {
                var vRightProjF = worldFront.clone().multiplyScalar(worldFront.dot(vRightUpdate));
                var vRightProjR = worldRight.clone().multiplyScalar(worldRight.dot(vRightUpdate));
                var vRightProj = vRightProjF.clone().add(vRightProjR);
                vRightProj.clone().normalize();

                var dVertAngle = 0.0;

                if (IsCombined()){
                    dVertAngle = lastDelta.y * this.orbitMultiplier;
                }else{
                    var next = getNextRotation('v', snapAnglev, lastDelta.y);
                    dVertAngle = this.useSnap ? this.lastSnapRotateY + next : delta.y * this.orbitMultiplier;
                }
                var quatV = new THREE.Quaternion().setFromAxisAngle( vRightProj, -dVertAngle );

                if( !this.navApi.getOrbitPastWorldPoles() ) {

                    var vUpUpdateTemp = vUpUpdate.clone();
                    vUpUpdateTemp.applyQuaternion(quatV).normalize();

                    // Check if we've gone over the north or south poles:
                    var wDotC = worldUp.dot(vUpUpdateTemp);
                    if( wDotC < 0.0 )
                    {
                        var vLookUpdateVtemp = vLookUpdateV.clone();
                        vLookUpdateVtemp.applyQuaternion(quatV).normalize();

                        // How far past Up are we?
                        var dVertAngle2 = vLookUpdateVtemp.angleTo(worldUp);
                        if( Math.abs(dVertAngle2) > (Math.PI * 0.5) )
                            dVertAngle2 -= (dVertAngle2 > 0.0) ? Math.PI : -Math.PI;

                        dVertAngle -= dVertAngle2;

                        quatV.setFromAxisAngle( vRightProj, -dVertAngle );
                        vLookUpdate.applyQuaternion(quatV).normalize();
                        vLookUpdateV.applyQuaternion(quatV).normalize();
                        vUpUpdate.applyQuaternion(quatV).normalize();

                    }
                    else
                    {
                        vLookUpdate.applyQuaternion(quatV).normalize();
                        vLookUpdateV.applyQuaternion(quatV).normalize();
                        vUpUpdate.applyQuaternion(quatV).normalize();
                    }
                }
                else
                {
                    vLookUpdate.applyQuaternion(quatV).normalize();
                    vLookUpdateV.applyQuaternion(quatV).normalize();
                    vUpUpdate.applyQuaternion(quatV).normalize();
                }
                this.lastSnapRotateY = dVertAngle;
            }

            // figure out new eye point
            var vNewEye = vLookUpdate.multiplyScalar(fTargetDist).add(pivot);

            camera.position.copy(vNewEye);
            camera.up.copy(vUpUpdate);
            this.center.copy(vNewEye);
            this.center.sub(vLookUpdateV.multiplyScalar(fTargetDistV));

            if( IsCombined() )
            {
                prevCenter.copy(this.center);
                prevEye.copy(camera.position);
                prevPivot.copy(this.pivot);
                prevUp.copy(camera.up);
            }
        }
        else {
            /*var lastDelta = convertCoordsToWindow(distance.x, distance.y);
            var vDir = prevPivot.clone().sub(prevEye);
            var vDirView = prevCenter.clone().sub(prevEye);
            var vRight = vDirView.clone().cross(prevUp);
            var vUp = vRight.clone().cross(vDirView);
            vUp.clone().normalize();

            var dist = (prevPivot.clone().sub(prevEye)).clone().length();
            var distView = (prevCenter.clone().sub(prevEye)).clone().length();

            var snapAngleh = 0.0;
            var snapAnglev = 0.0;

            //viewcube
            //snapToClosestView(vUp, snapAngleh, snapAnglev);

            if ( !this.constrainOrbitHorizontal ){

            var dHorzAngle = this.useSnap ? getNextRotation(HORIZONTAL, snapAngleh, lastDelta.x):
            lastDelta.x *this.orbitMultiplier;

            var quatH = new THREE.Quaternion().setFromAxisAngle( vUp.clone().normalize(), dHorzAngle );
            vDir = quatH.clone().rotate(vDir);
            vDirView = quatH.clone().rotate(vDirView);
            }

            if ( !this.constrainOrbitVertical ){
            var dVertAngle = this.useSnap ? getNextRotation(VERTICAL, snapAnglev, lastDelta.y) :
            lastDelta.y *this.orbitMultiplier;

            var quatV = new THREE.Quaternion().setFromAxisAngle( vRight.clone().normalize(), dVertAngle );
            vDir = quatV.clone().rotate(vDir);
            vDirView = quatV.clone().rotate(vDirView);
            vUp = quatV.clone().rotate(vUp);
            }

            camera.eye = this.pivot.clone().sub((vDir.clone().normalize()).clone().multiplyScalar(dist));
            this.center.copy(camera.eye.clone().add((vDirView.clone().normalize()).clone().multiplyScalar(distView)));
            camera.up.copy(vUp.clone().normalize());

            prevCenter = this.center;
            prevEye = camera.position;
            prevPivot = this.pivot;
            prevUp = camera.up;*/
        }
        camera.lookAt(this.center);
        changed(false);

        /*avp.logger.log("Camera Position: ( "+camera.position.x +", "+camera.position.y+", "+camera.position.z+" )");
        avp.logger.log("Up Vector: ( "+camera.up.x +", "+camera.up.y+", "+camera.up.z+" )");
        avp.logger.log("Center: ( "+this.center.x +", "+this.center.y+", "+this.center.z+" )");
        */
    };

    this.endInteraction = function() {

        this.navApi.setTransitionActive(false);
    };

    this.look = function( distance ){
        if( !this.navApi.isActionEnabled('walk') )
            return;

        var delta = convertCoordsToWindow(distance.x, distance.y);
        var multiplier = this.userLookSpeed;

        //if ( m_manager->GetApplicationParameters().lookInvertVerticalAxis ) { deltaY = -deltaY; }

        var eyeToCenter = this.getView();

        var camUp = camera.up;
        var camRight = eyeToCenter.clone().cross(camUp).normalize();
        var worldUp = this.sceneUpDirection.clone();

        // TODO: scale look by camera's FOV
        // vertical rotation around the camera right vector
        var angle = delta.clone();
        angle.x *= Math.PI;
        angle.y *= Math.PI / camera.aspect;
        angle.multiplyScalar(multiplier);
        var qRotY = new THREE.Quaternion().setFromAxisAngle( camRight, -angle.y);

        if (camera.keepSceneUpright && !this.navApi.getOrbitPastWorldPoles()) {
            var futureUp = camUp.clone();
            futureUp.applyQuaternion(qRotY).normalize();

            if (futureUp.dot(worldUp) < 0) {
                var futureEyeToCenter = eyeToCenter.clone();
                futureEyeToCenter.applyQuaternion(qRotY);

                var deltaAngle = futureEyeToCenter.angleTo(worldUp);

                if(Math.abs(deltaAngle) > (Math.PI * 0.5))
                    deltaAngle -= (deltaAngle > 0.0) ? Math.PI : -Math.PI;

                angle.y -= deltaAngle;

                qRotY.setFromAxisAngle(camRight, -angle.y);
            }
        }

        eyeToCenter = qRotY.clone().rotate(eyeToCenter);
        camUp = qRotY.clone().rotate(camUp);
        camUp.normalize();

        var vertAxis = camera.keepSceneUpright ? worldUp : camUp;
        var qRotX = new THREE.Quaternion().setFromAxisAngle( vertAxis, -angle.x );

        eyeToCenter = qRotX.clone().rotate( eyeToCenter );
        camUp = qRotX.clone().rotate( camUp );

        this.center.copy(eyeToCenter.add(camera.position));
        camera.up.copy(camUp);

        camera.lookAt(this.center);
        changed(false);
    };

    this.pan = function ( distance ) {
        if( !this.navApi.isActionEnabled('pan') )
            return;

        distance = convertCoordsToWindow(distance.x, distance.y);

        var W = this.getView();
        var U = camera.up.clone().cross(W);
        var V = W.clone().cross(U);

        U.normalize();
        V.normalize();
        W.normalize();

        var Pscreen = this.pivot.clone().sub(camera.position);
        var screenW = W.clone().dot(Pscreen);
        var screenU = screenW * (Math.tan( THREE.Math.degToRad(camera.leftFov)) + Math.tan(THREE.Math.degToRad(camera.rightFov)));
        var screenV = screenW * (Math.tan( THREE.Math.degToRad(camera.topFov)) + Math.tan(THREE.Math.degToRad(camera.bottomFov)));

        var offsetU = distance.x * Math.abs(screenU);
        var offsetV = distance.y * Math.abs(screenV);

        var offset = new THREE.Vector3();
        var u = U.clone().multiplyScalar(offsetU);
        var v = V.clone().multiplyScalar(offsetV);

        offset = (u.clone().add(v)).clone().multiplyScalar(this.userPanSpeed);

        camera.position.add(offset);
        this.center.add(offset);

        camera.lookAt(this.center);
        changed(false);
    };

    this.zoom = function(zoomDelta){
        if( !this.navApi.isActionEnabled('zoom') )
            return;

        //TODO: bug - when pivot is set outside the object, object zooms past the pivot point
        var zoomMin = 0.05;
        var zoomBase = this.userZoomSpeed;
        var distMax = Number.MAX_VALUE;
        var deltaXY = zoomDelta.x + zoomDelta.y;
        var dist = Math.pow ( zoomBase, deltaXY);

        var zoomPosition = (this.pivot.clone().sub((this.pivot.clone().sub(this.saveEye).clone()).multiplyScalar(dist)));
        var zoomCenter = zoomPosition.clone().add(cam.D.clone().multiplyScalar(cam.D.clone().dot((this.pivot.clone().sub(zoomPosition)).clone())));

        if (dist >= distMax)
            return;

        if (deltaXY > 0.0){
            var snapSize = 0;
            var dist2 = Math.pow(zoomBase, deltaXY - snapSize);

            // PERSP zoom out
            if ( deltaXY < snapSize ){
                // inside the zoomout speedbump region
                unitAmount = 0.0;
                return;

            } else {
                camera.position.copy(zoomPosition);
                this.center.copy(zoomCenter);

                var EprojD = (zoomPosition.clone().sub(this.saveEye)).dot(cam.D);

                if ( EprojD > distMax ) {
                    camera.position.copy((this.saveEye.sub(cam.D)).clone().multiplyScalar(distMax));
                    unitAmount = (distMax > 0.0) ? -1.0 : 0.0;
                } else {
                    unitAmount = -(EprojD / distMax);
                }
            }
        } else {


            camera.position.copy(zoomPosition);
            this.center.copy(zoomCenter);

            //Zoom In
            /*if ( dist < zoomMin) {
                //exponential zoom moved in as far as it can
                var zoomMinLinear = ( Math.log(zoomMin) / Math.log(zoomBase) );
                var distLinearXY = Math.abs(deltaXY) - Math.abs(zoomMinLinear);
                var snapSize = 0;

                // do linear zoomin
                if ( distLinearXY > snapSize ) {

                    var distLinearXY = distLinearXY - snapSize/window.innerHeight;
                    var amount = -distLinearXY;

                    var multiplier = this.userZoomSpeed;
                    var dist2 = amount * multiplier;

                    var Esnap = this.pivot.clone().sub((this.pivot.clone().sub(this.saveEye)).clone().multiplyScalar(zoomMin));
                    var E = Esnap.clone().sub((this.pivot.clone().sub(this.saveEye)).clone().multiplyScalar(dist2));

                    this.center.copy(E.clone().add(cam.D.clone().multiplyScalar(zoomMin)));
                    camera.position.copy(E);
                }
            } else {
                cam.D = (this.saveCenter.clone().sub(this.saveEye)).clone().normalize();
                camera.position.copy(zoomPosition);
                this.center.copy(zoomCenter);
            }*/
        }
        camera.lookAt(this.center);
        changed(false);
    };

    this.walk = function(currentCursor, startCursor, movementX, movementY, deltaTime){
        if( !this.navApi.isActionEnabled('walk') )
            return;

        var worldUp = this.sceneUpDirection.clone();
        var worldFront = this.sceneFrontDirection.clone();
        var worldRight = this.sceneFrontDirection.clone().cross( this.sceneUpDirection);
        //TODO: figure out what deltaTime does

        var flyPlanarMotion = true;
        var flyUpDownSensitivity = 0.01;

        if (isInDeadZone(currentCursor, startCursor)){
            wheel.cursorImage('SWWalk');
            setBias(true, currentCursor, startCursor);
            x = startCursor.x;
            y = startCursor.y;
        }else{
            setBias(false, currentCursor, startCursor);
        }

        //x = currentCursor.x - m_resetBiasX;
        //y = currentCursor.y - m_resetBiasY;
        x = currentCursor.x;
        y = currentCursor.y;

        var delta = convertCoordsToWindow( x - startCursor.x, y - startCursor.y );

        var fInitialMoveX = -delta.x;
        var fInitialMoveY = -delta.y;
        var fSignX = (fInitialMoveX < 0.0) ? -1.0 : 1.0;
        var fSignY = (fInitialMoveY < 0.0) ? -1.0 : 1.0;
        var fMoveX = Math.abs(fInitialMoveX);
        var fMoveY = Math.abs(fInitialMoveY);

        var deadzoneRadius = new THREE.Vector2(30, 30);
        deadzoneRadius = convertCoordsToWindow (deadzoneRadius.x, deadzoneRadius.y);

        fMoveX = ( isInDeadZone(currentCursor, startCursor)) ? 0.0 : Math.abs(fInitialMoveX) - deadzoneRadius.x;
        fMoveY = ( isInDeadZone(currentCursor, startCursor)) ? 0.0 : Math.abs(fInitialMoveY) - deadzoneRadius.y;

        var rampRadius = 0.25;
        fMoveX /= rampRadius;
        fMoveY /= rampRadius;

        fMoveX = ( fMoveX < 1.0 ) ? easeClamp( fMoveX, 0.0, 1.0 ) : Math.pow(fMoveX, 1.0);
        fMoveY = ( fMoveY < 1.0 ) ? easeClamp( fMoveY, 0.0, 1.0 ) : Math.pow(fMoveY, 1.0);


        // scale by time
        //fMoveX *= deltaTime;
        //fMoveY *= deltaTime;

        var fDeltaX = (fMoveX > 0.0) ? fMoveX * fSignX : 0.0;
        var fDeltaY = (fMoveY > 0.0) ? fMoveY * fSignY : 0.0;

        var vViewDir = this.getView();
        var fViewDist = vViewDir.length();
        vViewDir.normalize();

        var vRightDir = vViewDir.clone().cross( camera.up );
        vRightDir.normalize();

        // project vViewDir onto plane perpendicular to up direction to get
        // better walking inside houses, etc
        // (but prevents flying down to model from 3/4 view...)

        var vYViewDirRight = worldRight.clone().multiplyScalar(worldRight.clone().dot(vViewDir));
        var vYviewDirFront = worldFront.clone().multiplyScalar(worldFront.clone().dot(vViewDir));
        var vYViewDir = vYviewDirFront.clone().add(vYViewDirRight);

        vYViewDir = (vYViewDir.clone().length() > MIN_VALUE) ? vYViewDir.normalize() : camera.up;

        var scale = 1.0;
        var fDollyDist = fDeltaY * (this.walkMultiplier * scale );

        var dir = flyPlanarMotion ? vYViewDir : vViewDir;


        // Free-flying or constrained walk?
        if (flyPlanarMotion) {
            // Constrained Walk
            // To avoid perceptually confusing motion, force a reversal of flying direction along a shifted axis

           // Angle to offset threshold from up-axis
           // TODO: make cos(0.65) into an AutoCam Parameter
           var dDirThreshold = Math.cos(0.65);

           if ((dDirThreshold != 1) &&
               (((worldUp.clone().dot(camera.up) < -MIN_VALUE) && (worldUp.clone().dot(vViewDir) < -dDirThreshold)) ||
                   ((worldUp.clone().dot(camera.up) > MIN_VALUE) && (worldUp.clone().dot(vViewDir) > dDirThreshold)))) {
               dir = -dir;
           }
        }


        var fSpinAngle = -fDeltaX *this.walkMultiplier*0.05;

        // rotate around world-up vector instead of CameraOperations up vector (more like head movement!)
        //Quaternion quat( m_cameraParams.up, (float)fSpinAngle );

        // Define rotation axis direction
        var vRotAxis = camera.up;

        // Free-flying or constrained walk?
        if (flyPlanarMotion) {
            // Constrained Walk
            // Need to check if:
            //  1. camera is "upside-down" (angle between world up and camera up is obtuse) or
            //  2. camera is in top view (camera up perpendicular to world up and view angle acute to world up)
            // These cases require a reversed rotation direction to maintain consistent mapping of tool:
            //  left->clockwise, right->counter-clockwise
            if ((worldUp.clone().dot(camera.up) < -MIN_VALUE) ||
                ((Math.abs(worldUp.clone().dot(camera.up)) < MIN_VALUE)
                    && (worldUp.clone().dot(vViewDir) > MIN_VALUE))) {
                fSpinAngle = -fSpinAngle;
            }
            vRotAxis = worldUp;
        }

        // Define rotation transformation

        var quat = new THREE.Quaternion().setFromAxisAngle( vRotAxis, fSpinAngle );
        quat.normalize();

        vViewDir = quat.clone().rotate( vViewDir );
        vViewDir.normalize();
        camera.up.copy(quat.clone().rotate( camera.up ));
        camera.up.normalize();

        camera.position.add(dir.clone().multiplyScalar(fDollyDist));
        this.center.copy(camera.position.clone().add(vViewDir.clone().multiplyScalar(fViewDist)));

        dir = flyPlanarMotion ? worldUp : camera.up;
        dir.normalize();

        if(fDollyDist === 0)
            fDollyDist = flyUpDownSensitivity;

        camera.lookAt(this.center);
        changed(false);
    };

    this.updown = function(movementY){
        if( this.navApi.getIsLocked() )
            return;

        var deltaCursor = movementY;
        var deltaAmount = getMoveAmountFromCursorOffset(deltaCursor);

        cam.m_amount += deltaAmount;

        var upDir = new THREE.Vector3(0,1,0);

        var eye = cam.saveEye.clone().sub(upDir.clone().multiplyScalar(cam.m_amount));
        var eyeHeight = eye.clone().dot(upDir);

        camera.position.copy(eye);

        if ( eyeHeight < cam.minSceneBound ) {
            camera.position.add(upDir.clone().multiplyScalar(cam.minSceneBound - eyeHeight));
        }

        if ( eyeHeight > cam.maxSceneBound ) {
            camera.position.add(upDir.clone().multiplyScalar(cam.maxSceneBound - eyeHeight));
        }

        this.center.copy(camera.position.clone().add(cam.saveCenter.clone().sub(cam.saveEye)));
        camera.lookAt(this.center);
        changed(false);
    };
};

GlobalManagerMixin.call(Autocam.prototype);
