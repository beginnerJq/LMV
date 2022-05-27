
import * as THREE from "three";
import { GlobalManagerMixin } from '../application/GlobalManagerMixin';

/**
 * Variety of utilities convenient to navigation and tool development.
 *
 * This class is instantiated internally and made available to all registered interaction tools
 * via their "utilities" property.
 *
 * @see {@link Autodesk.Viewing.ToolController}
 * @param {object} viewerImplIn - The viewer implementation object.
 * @param {object} autocam - The Autocam interface object.
 * @param {object} navapi - The Navigation interface object.
 * @class
 * @alias Autodesk.Viewing.ViewingUtilities
 */
export function ViewingUtilities( viewerImplIn, autocam, navapi )
{
    this.autocam = autocam;
    this.viewerImpl = viewerImplIn;
    this.setGlobalManager(this.viewerImpl.globalManager);

    var kIndicatorPixelSize = 5;    // Pixels
	var _camera = navapi.getCamera();
    var _savePivot = {};
    var _savePivotSet = {};
    
    /**
     * @param viewerImpl
     * @private
     */
    function PivotIndicator( viewerImpl )
    {
        var kFadeTimeMilliseconds = 500;
        var kIndicatorColor   = 0x007F00;
        var kIndicatorOpacity = 0.6;

        var myFadeTime = 0;
        var myGeometry = new THREE.SphereGeometry( 1.0 );
        var myMaterial = new THREE.MeshPhongMaterial({color:kIndicatorColor, opacity:kIndicatorOpacity, transparent:true});
        var myMesh = new THREE.Mesh( myGeometry, myMaterial );
        var myViewerImpl = viewerImpl;
        var myPivotScale = 1.0;

        myViewerImpl.createOverlayScene("pivot");
        myMesh.visible = false;

        this.shown = function()
        {
			return myMesh.visible;
        };

        this.show = function( position, scale, fade )
        {
            myMesh.scale.x = scale * myPivotScale;
            myMesh.scale.y = scale * myPivotScale;
            myMesh.scale.z = scale * myPivotScale;

            myMesh.position.set(position.x, position.y, position.z);
            myMaterial.opacity  = kIndicatorOpacity;

            myMesh.visible = true;
            myViewerImpl.addOverlay("pivot", myMesh);
            myViewerImpl.invalidate(false, false, true);

            if( fade )
            {
                myFadeTime = Date.now() + kFadeTimeMilliseconds;
            }
            else
                myFadeTime = 0;
        };

        this.hide = function()
        {
            if( myMesh.visible )
            {
                myMesh.visible = false;
                myViewerImpl.removeOverlay("pivot", myMesh);
                myViewerImpl.invalidate(false, false, true);
                myFadeTime = 0;
            }
        };

        this.fade = function()
        {
            if( myFadeTime > 0 )
            {
                var fadeDelta = myFadeTime - Date.now();

                if( fadeDelta <= 0 )
                {
                    this.hide();
                    return true;
                }
                var opacity = (fadeDelta / kFadeTimeMilliseconds) * kIndicatorOpacity;
                myMaterial.opacity  = opacity;
                return true;
            }
            return false;
        };

        this.fading = function()
        {
            return (myFadeTime > 0);
        };

        /**
         * Changes the pivot graphic size.
         * Set default size with scale value of 1.
         *
         * @param {number} scale - Scale factor
         */
        this.setSize = function(scale) {
            myPivotScale = scale;
        };

        /**
         * Change Pivot color.
         * Example, red is 0xFF0000
         *
         * @param {string} color - color hex or string
         * @param {number} [opacity] - Opacity value from 0 (transparent) to 1 (opaque).
         */
        this.setColor = function(color, opacity) {
            myMaterial.color = new THREE.Color( color );
            
            // opacity is optional
            if (opacity !== undefined) {
                kIndicatorOpacity = opacity;
                myMaterial.opacity = kIndicatorOpacity;
            }
        };
    }

    var _pivotIndicator  = new PivotIndicator(this.viewerImpl);

    /**
     * @param pos
     * @param coi
     * @param worldUp
     * @param
     */
    function computeOrthogonalUp(pos, coi, worldUp)
    {
        var eye = coi.clone().sub(pos);
        if( eye.lengthSq() === 0.0 )    // Invalid view?
            return eye.copy(worldUp);

        var right = eye.clone().cross(worldUp);
        if( right.lengthSq() === 0 )
        {
            // If eye and up are colinear, perturb eye
            // to get a valid result:
            if( worldUp.z > worldUp.y )
                eye.y -= 0.0001;
            else
                eye.z -= 0.0001;

            right.crossVectors( eye, worldUp );
        }
        return right.cross(eye).normalize();
    }

    /**
     * This method triggers a camera view transition as specified by the parameters.
     *
     *  @param {THREE.Vector3} pos - The new world space position of the camera.
     *  @param {THREE.Vector3} coi - The new center of interest (look at point).
     *  @param {number} fov - The new field of view for the camera in degrees.
     *  @param {THREE.Vector3} up - The new camera up direction.
     *  @param {THREE.Vector3} worldUp - The new world up direction.
     *  @param {boolean} reorient - If true the given camera up parameter is ignored
     *  and a new up direction will be calculated to be aligned with the given world up direction.
     *  @param {THREE.Vector3} pivot - The new pivot point.
     */
    this.transitionView = function( pos, coi, fov, up, worldUp, reorient, pivot )
    {
        worldUp = worldUp || navapi.getWorldUpVector();

        var upVec = reorient ? computeOrthogonalUp(pos, coi, worldUp) : up;
        if( !upVec )
            upVec = _camera.up;
        
        pivot = pivot || coi;

        var targetView = {
            position: pos,
              center: coi,
               pivot: pivot,
                 fov: fov,
                  up: upVec,
             worldUp: worldUp,
             isOrtho: (_camera.isPerspective === false)
        };
        autocam.goToView(targetView);
    };

    /**
     * This method triggers a camera view transition to the registered home view for the current scene.
     */
    this.goHome = function()
    {
        this.viewerImpl.track({ name: 'navigation/home', aggregate: 'count' });
        autocam.goHome();
    };

    /**
     * This method performs a hit test with the current model using a ray cast from the given screen coordinates.
     *
     *  @param {number} x - The normalized screen x coordinate in [0, 1].
     *  @param {number} y - The normalized screen y coordinate in [0, 1].
     *  @returns {THREE.Vector3} The world space hit position or null if no object was hit.
     */
    this.getHitPoint = function(x, y)
    {
        var result = this.viewerImpl.hitTestViewport(navapi.screenToViewport(x, y), false);
        return result ? result.intersectPoint : null;
    };

    /**
     * This method activates the in scene pivot indicator.
     * The pivot is positioned at the current camera's pivot point.
     *
     * @param {boolean} fadeIt - If true the indicator will be displayed and then fade away after a short period.
     * @see {@link Autodesk.Viewing.Navigation}
     */
    this.activatePivot = function(fadeIt)
    {
        // Only show pivot for 3D models
        if (!this.viewerImpl.model || this.viewerImpl.model.is2d())
            return;

        var distance = _camera.isPerspective ? navapi.getPivotPlaneDistance()
                                             : navapi.getEyeVector().length();
        var fov = navapi.getVerticalFov();
        var worldHeight = 2.0 * distance * Math.tan(THREE.Math.degToRad(fov * 0.5));

        var viewport = navapi.getScreenViewport();
        var _window = this.getWindow();
        var devicePixelRatio = _window.devicePixelRatio || 1;
        var indicatorSize = kIndicatorPixelSize * worldHeight / (viewport.height * devicePixelRatio);

        _pivotIndicator.show( navapi.getPivotPoint(), indicatorSize, fadeIt );
    };

    /**
     * This method changes the display state of the in scene pivot indicator.
     * If the current scene is 2D this method has no effect.
     *
     * @param {boolean} state - The requested display state for the indicator.
     * @param {boolean} fadeIt - If true and "state" is also true, the indicator will be displayed
     * and then fade away after a short period.
     * @see {@link Autodesk.Viewing.Navigation}
     */
    this.pivotActive = function( state, fadeIt )
    {
        state = state && !navapi.getIs2D();  // Currently disabled in 2D mode.

        fadeIt = fadeIt || false;

        if( !state && _pivotIndicator.shown() )
        {
            _pivotIndicator.hide();
            return;
        }
        if( state )
            this.activatePivot(fadeIt);
    };

    /**
     * Invoke this method to refresh the pivot indicator and continue its fading action if required.
     */
    this.pivotUpdate = function()
    {
        if( _pivotIndicator.shown() && _pivotIndicator.fade() )
            this.viewerImpl.invalidate(false, false, true);
    };

    /**
     * Set the current pivot point and pivot set flag.
     * If the pivot indicator is active its position will be updated accordingly. If a temporary pivot was previously applied, its saved state will be cleared.
     *
     * @param {THREE.Vector3} newPivot - The world space position of the new pivot point.
     * @param {boolean} preserveView - If false the camera's view direction will change
     * to look at the new pivot point. If true the camera's view will not be changed.
     * @param {boolean} isset - The new state of the pivot set flag.
     * @see {@link Autodesk.Viewing.Navigation}
     */
    this.setPivotPoint = function( newPivot, preserveView, isset )
    {
        navapi.setPivotPoint(newPivot);

        if( !preserveView )
            navapi.setTarget(newPivot);

        if( isset )
            navapi.setPivotSetFlag(true);

        this.setTemporaryPivot(null);

        // Disallow showing the pivot when in 2D.
        if (navapi.getIs2D())
            return;

        if( _pivotIndicator.shown() ) // The pivot indicator location may need updating:
            this.activatePivot(_pivotIndicator.fading());
    };

    /**
     * Save a copy of the current pivot point and pivot set flag.
     *
     * @param {string} name - Optional unique name of the saved location.
     */
    this.savePivot = function(name)
    {
        if( !name )
            name = "default";

        _savePivot[name]    = navapi.getPivotPoint();
        _savePivotSet[name] = navapi.getPivotSetFlag();
    };

    /**
     * Restore the saved copy of the current pivot point and pivot set flag.
     * Once restored the saved value is erased.
     *
     * @param {string} name - Optional unique name of the saved location.
     */
    this.restorePivot = function(name)
    {
        if( !name )
            name = "default";

        if( _savePivot[name] )
        {
            var set =_savePivotSet[name]; // Get value before calling setPivotPoint
            this.setPivotPoint( _savePivot[name], true, set );
            if( !set )
            {
                // Force the flag off, setPivotPoint only turns it on.
                navapi.setPivotSetFlag(false);
            }
            delete(_savePivot[name]);
            delete(_savePivotSet[name]);
        }
    };

    /**
     * Allows the caller to save the current pivot and replace it with a new location.
     * If while the temporary pivot is active a new pivot is set via the setPivotPoint method,
     * the saved pivot will be cleared to avoid restoring an out of date pivot location.
     *
     * @param {THREE.Vector3} newPivot - The new pivot to be assigned or null to clear any previously saved pivot.
     */
    this.setTemporaryPivot = function( newPivot )
    {
        if( newPivot )
        {
            var pivot    = navapi.getPivotPoint();
            var pivotSet = navapi.getPivotSetFlag();

            this.setPivotPoint(newPivot, true, pivotSet);

            _savePivot["TEMP"]    = pivot;
            _savePivotSet["TEMP"] = pivotSet;
        }
        else
        {
            delete(_savePivot["TEMP"]);
            delete(_savePivotSet["TEMP"]);
        }
    };

    /**
     * Restore a pivot value that was saved by a call to setTemporary Pivot.
     */
    this.removeTemporaryPivot = function()
    {
        this.restorePivot("TEMP");
    };

    /**
     * Changes the pivot graphic size.
     *
     * @param {number} scale - Default size value is 1
     */
    this.setPivotSize = function(scale) {
        _pivotIndicator.setSize(scale);
    };

    /**
     * Change pivot color and opacity.
     * Example, to get red 100% solid (non-transparent) use setPivotColor(0xFF0000, 1)
     *
     * @param {number} color - RBG Hex color.
     * @param {number} [opacity] - Opacity value from 0 (transparent) to 1 (opaque).
     */
    this.setPivotColor = function(color, opacity) {
        _pivotIndicator.setColor(color, opacity);
    };

    /**
     * Return the bounding box of the current model or model selection.
     *
     * @param {boolean} ignoreSelection - If true the current selection is ignored and the model bounds is returned.
     * @returns {THREE.Box3}
     */
    this.getBoundingBox = function( ignoreSelection )
    {
        return this.viewerImpl.getFitBounds(ignoreSelection);
    };

    /**
     * Request a camera transition to fit the current model or model selection into the view frustum.
     *
     * @param {boolean} immediate - If true the transition will be immediate,
     * otherwise animated over a short time period.
     */
    this.fitToView = function(immediate)
    {
        this.viewerImpl.track({ name: 'navigation/fit', aggregate: 'count' });
        this.viewerImpl.fitToView( this.viewerImpl.selector.getAggregateSelection(), immediate );
        this.activatePivot(true);
    };

    this.update = function()
    {
        if( navapi.getRequestFitToView() && !navapi.getTransitionActive() )
        {
            navapi.setRequestFitToView(false);
            this.fitToView();
        }
        if( navapi.getRequestHomeView() && !navapi.getTransitionActive() )
        {
            navapi.setRequestHomeView(false);
            this.goHome();
        }
        var request = navapi.getRequestTransition();
        if( request && !navapi.getTransitionActive() )
        {
            navapi.setRequestTransition(false);
            this.transitionView( request.position, request.coi, request.fov, request.up, request.worldUp, request.reorient, request.pivot );
        }
        return false;
    };
}

GlobalManagerMixin.call(ViewingUtilities.prototype);