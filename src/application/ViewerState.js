

import { logger } from "../logger/Logger";
import { LightPresets } from "./LightPresets";
import { SceneMath } from "../wgs/scene/SceneMath";

/**
 * Class for creating and restoring viewer states.
 *
 * Main interactions come from methods
 * - {@link Autodesk.Viewing.Private.ViewerState#getState}
 * - {@link Autodesk.Viewing.Private.ViewerState#restoreState}
 * @tutorial viewer_state
 * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer instance used to operate on.
 * @private
 */
export function ViewerState( viewer )
{
    /**
     * All-inclusive filter constant used when no filter is provided.
     * @type {boolean}
     * @private
     */
    var FILTER_ALL = true;

    
    function removeUnneededCutplanes(viewerState, planes) {
        const supportsLevels = !!viewer.getExtension('Autodesk.AEC.LevelsExtension');
        if (supportsLevels && viewerState.floorGuid === undefined) {
            // Legacy fallback for old serialized viewer states.
            // TODO: Added on February 2019. Can be removed after a while when we can assume that all issues are serialized with new serialization.
            //
            // Previously the cutplanes were saved as is, together with the section cutplanes.
            // This created problems when restoring a state because there was no way to differentiate among
            // the different sets. Instead of saving the planes we now save the floor guid, but for states
            // that were saved between the time the levels extension was introduced, and when the floorGuid
            // attribute was added to the state, we need to remove the extraneous planes from the __set_view set.
            // Heuristic:
            // Remove from __set_view if exists, and there are 3 or 8 cutplanes, and the last two have the shape of 
            // [new THREE.Vector4(0,0,-1,zMin), new THREE.Vector4(0,0,1,-zMax)].
            // Reasoning: Revit files (the only type that support levels) can have only 1 or 6 planes, from the Section
            // extension, so the extra 2 probably come from the level extension. We check the shape to be sure.
            const length = planes.length;
            if (length === 3 || length === 8) {
                const beforeLast = planes[length - 2];
                const last = planes[length - 1];
                if ((beforeLast.x === 0 && beforeLast.y === 0 && beforeLast.z === -1) &&
                    (last.x === 0 && last.y === 0 && last.z === 1)) {
                    planes.splice(-2, 2); // Remove last 2 elements
                }
            }
        }
    }

    /**
     * Get a model object (that is visible) from the passed-in seedUrn.
     * 
     * @returns {Autodesk.Viewing.Model} - Model that is associated with the seedUrn.
     * @private
     */
    this.getVisibleModel = function(seedUrn) {
        const visibleModels = viewer.getVisibleModels();
        for (let i = 0; i < visibleModels.length; ++i) {
            const model = visibleModels[i];
            if (this.getSeedUrn(model) === seedUrn) {
                return model;
            }
        }
    };

    /**
     * Creates an array of objectSets associated to each model. It assigns the array to `viewerState.objectSet`.
     * @param {object} viewerState
     * @private 
     */
    this.createObjectSets = function(viewerState) {
        // Object set, contains selection, isolation and explode value.
        var objectSet = viewerState['objectSet'];
        if (!Array.isArray(objectSet)) {
            viewerState['objectSet'] = objectSet = [];
        }

        var visibleModels = viewer.getVisibleModels();
        for (var i = 0; i < visibleModels.length; i++) {
            var model = visibleModels[i];
            var seedUrn = this.getSeedUrn(model);
            var selectedNodes = this.getSelectedNodes(model);

            objectSet[i] = {
                id: selectedNodes, // Works for 2d and 3d
                idType: 'lmv'
            };

            if (visibleModels.length > 1) {
                objectSet[i].seedUrn = seedUrn;
            }

            // Spec call for these elements to grouped in an Object at an Array's index 0.
            // 3d models attributes
            if (!model.is2d()) {
                objectSet[i].isolated = viewer.getIsolatedNodes(model);
                objectSet[i].hidden = viewer.getHiddenNodes(model);
                objectSet[i].explodeScale = viewer.getExplodeScale();
            } else {
                // 2d models attributes
                objectSet[i].isolated = this.getVisibleLayers2d(model);
                objectSet[i].allLayers = this.areAllLayersVisible(model);
                objectSet[i].hidden = []; // There's no hide feature for 2d.
            }
        }
    };

    /**
     * Returns a viewer state Object for the current viewer instance.
     *
     * @param {object} [filter] - Object with a structure similar to the output where
     * values are replaced with Booleans true/false indicating whether they should be stored or not.
     * @returns {object} Plain object describing the state of the viewer.
     * @tutorial viewer_state
     */
    this.getState = function( filter ) {

        var nav = viewer.navigation;
        var viewerState = {};

        // Adding level-0 properties
        viewerState["seedURN"] = this.getSeedUrn();

        // Create an objectSet for each model.
        this.createObjectSets(viewerState);

        // Viewport
        var viewport = viewerState["viewport"];
        if (!viewport) {
            viewport = viewerState["viewport"] = {};
        }
        
        var bPerspectiveCam = nav.getCamera().isPerspective;
        viewport["name"] = ""; // TODO: Populate accordingly; Requested by the mobile team.
        viewport["eye"] = nav.getPosition().toArray();
        viewport["target"] = nav.getTarget().toArray();
        viewport["up"] = nav.getCameraUpVector().toArray();
        viewport["worldUpVector"] = nav.getWorldUpVector().toArray();
        viewport["pivotPoint"] = nav.getPivotPoint().toArray();
        viewport["distanceToOrbit"] = nav.getPivotPlaneDistance();
        viewport["aspectRatio"] = this.getAspectRatio();
        viewport["projection"] = bPerspectiveCam ? "perspective" : "orthographic";
        viewport["isOrthographic"] = !bPerspectiveCam;
        if (bPerspectiveCam) {
            viewport["fieldOfView"] = nav.getVerticalFov();
        } else {
            viewport["orthographicHeight"] = this.getOrthographicHeight();
        }


        // Render Options
        var renderOptions = viewerState["renderOptions"];
        if (!renderOptions) {
            renderOptions = viewerState["renderOptions"] = {};
        }
        renderOptions["environment"] = this.getEnvironmentName();
        renderOptions["ambientOcclusion"] = {
            enabled: viewer.impl.renderer().getAOEnabled(),
            radius: viewer.impl.renderer().getAORadius(),
            intensity: viewer.impl.renderer().getAOIntensity()
        };
        renderOptions["toneMap"] = {
            method: viewer.impl.renderer().getToneMapMethod(),
            exposure: viewer.impl.renderer().getExposureBias(),
            lightMultiplier: this.getToneMapIntensity()
        };
        renderOptions["appearance"] = {
            ghostHidden: viewer.impl.showGhosting,
            ambientShadow: viewer.prefs.get('ambientShadows'),
            antiAliasing: viewer.impl.renderer().settings.antialias,
            progressiveDisplay: viewer.prefs.get('progressiveRendering'),
            swapBlackAndWhite: viewer.prefs.get('swapBlackAndWhite'),
            displayLines: viewer.prefs.get('lineRendering'),
            displayPoints: viewer.prefs.get('pointRendering')
        };

        // Cutplanes (aka: Sectioning) are a 3d-only feature.
        if (viewer.model && !viewer.model.is2d()) {
            var cutplanes = viewerState.cutplanes = [];
            var planes = viewer.impl.getCutPlaneSet('__set_view');
            for (var i = 0; i < planes.length; i++) {
                cutplanes.push(planes[i].toArray());
            }
        }

        // Allow extensions to inject their state data
        for (var extensionName in viewer.loadedExtensions) {
            var extension = viewer.loadedExtensions[extensionName];
            extension.getState && extension.getState(viewerState);
        }

        // Filter out values the user doesn't want to consume before returning.
        if (filter && filter !== FILTER_ALL) {
            this.applyFilter(viewerState, filter);
        }
        return viewerState;
    };

    /**
     * Restores all of the object sets. Sets the state of each model (selected, hidden, isolated nodes).
     * @param {object} viewerState - see viewerState.getState()
     * @private
     */
    this.restoreObjectSet = function(viewerState) {
        var objectSets = viewerState.objectSet;
        if (!Array.isArray(objectSets) || objectSets.length === 0) {
            return;
        }
        var isolateAggregate = [];
        var hideAggregate = [];
        var selectAggregate = [];
        // Legacy-fallback
        var model = viewer.model;
        for (var i = 0; i < objectSets.length; ++i) {
            var objectSet = objectSets[i];

            // Ensure that the objectSet was generated by the getState function
            if (objectSet.idType !== "lmv") {
                continue;
            } 
            var seedUrn = objectSet.seedUrn;
            if (seedUrn) {
                model = this.getVisibleModel(seedUrn);
                // the model is not loaded 
                if (!model) continue;
            }

            // Selection (2d and 3d)
            var selectionIds = objectSet.id;
            if (selectionIds) {
                selectionIds = this.toIntArray(selectionIds);
                selectAggregate.push({model: model, ids: selectionIds});
            }
            

            // Isolation / Hidden depends on whether it is 2d or 3d
            if (model.is2d()) {
                // TODO: aggregate layers are not yet supported.
                // 2d Isolation is Layer visibility
                var visibleLayers = objectSet.isolated;
                if (Array.isArray(visibleLayers) && visibleLayers.length > 0) {
                    // Only certain layers are visible
                    viewer.setLayerVisible(null, false); // start by hiding all

                    // Make sure layers integer-types
                    for (var k = 0; k < visibleLayers.length; ++k) {
                        visibleLayers[k] = parseInt(visibleLayers[k]);
                    }
                    viewer.impl.setLayerVisible(visibleLayers, true);
                } else if (!objectSet.allLayers) {
                    // If there are no isolated ids, that means that all of the layers should be invisible.
                    // Reported in LMV-3537
                    viewer.setLayerVisible(null, false);
                }
            } else {
                // 3d Isolation
                var isolatedIds = objectSet.isolated || [];
                var hiddenIds = objectSet.hidden || [];

                isolatedIds = this.toIntArray(isolatedIds);
                isolateAggregate.push({model: model, ids: isolatedIds});

                if (isolatedIds.length === 0 && hiddenIds.length > 0) {
                    hiddenIds = this.toIntArray(hiddenIds);
                    // get the hidden ids and push them to the hiddenAggregate array.
                    hideAggregate.push({model: model, ids: hiddenIds});
                }
            }

            // Explode scale (3d)
            if ("explodeScale" in objectSet) {
                var explodeScale = parseFloat(objectSet.explodeScale);
                if(viewer.explode) {
                    viewer.explode(explodeScale);
                }
            }
        }

        if (selectAggregate.length > 0) {
            viewer.impl.selector.setAggregateSelection(selectAggregate);
        }

        if (isolateAggregate.length > 0) {
            viewer.impl.visibilityManager.aggregateIsolate(isolateAggregate, { hideLoadedModels: false });
        }

        if (hideAggregate.length > 0) {
            viewer.impl.visibilityManager.aggregateHide(hideAggregate);
        }
    };


    /**
     * Restores the associated viewer instance with the provided viewerState object.
     *
     * @param {object} viewerState
     * @param {object} [filter] - Similar in structure to viewerState used to filter out values
     * that should not be restored.
     * @param {boolean} [immediate] - Whether the state should be apply with (false)
     * or without (true) a smooth transition.
     * @returns {boolean} True if the operation was successful.
     * @tutorial viewer_state
     */
    this.restoreState = function( viewerState, filter, immediate ) {

        if (!viewerState) {
            logger.warn("restoreState has no viewer state to restore from.");
            return false;
        }

        if (!viewer || !viewer.model) {
            logger.warn("restoreState has no viewer or model to restore.");
            return false;
        }

        if (filter && filter !== FILTER_ALL) {
            // To avoid modifying viewerState passed in, we create a clone of it
            viewerState = JSON.parse(JSON.stringify(viewerState));
            this.applyFilter(viewerState, filter);
        }

        var nav = viewer.navigation;
        var isModel2d = viewer.model.is2d();
        var isModel3d = !isModel2d;

        // Objectset
        this.restoreObjectSet(viewerState);

        var viewport = viewerState.viewport;
        if (viewport) {

            var eye = this.getVector3FromArray(viewport.eye, nav.getPosition());
            var up = this.getVector3FromArray(viewport.up, nav.getCameraUpVector());
            var target = this.getVector3FromArray(viewport.target, nav.getTarget());
            var fov = ("fieldOfView" in viewport) ? parseFloat(viewport.fieldOfView) : nav.getVerticalFov();
            var worldUp = this.getVector3FromArray(viewport.worldUpVector, null);
            if (!worldUp) {
                var upVectorArray = viewer.model ? viewer.model.getUpVector() : null;
                if (upVectorArray) {
                    worldUp = new THREE.Vector3().fromArray(upVectorArray);
                } else {
                    worldUp = new THREE.Vector3(0,1,0); // TODO: Can we do better? Is it worth it?
                }
            }
            var pivot = this.getVector3FromArray(viewport.pivotPoint, nav.getPivotPoint());

            // Retain current values if not available in restore object
            var isPerspective = nav.getCamera().isPerspective;
            if ('isOrthographic' in viewport) {
                isPerspective = !viewport.isOrthographic;
            }
            var orthoScale = this.getOrthographicHeight();
            if ('orthographicHeight' in viewport) {
                orthoScale = Number(viewport.orthographicHeight);
            }

            var camera = {
                position: eye,
                target: target,
                up: up,
                worldup: worldUp,
                aspect: viewer.impl.camera.aspect,
                fov: fov,
                orthoScale: orthoScale,
                isPerspective: isPerspective,
                pivot: pivot
            };

            this.restoreCameraState(camera, immediate);
        }


        // Render option state
        var renderOptions = viewerState.renderOptions;
        if (renderOptions) {

            // current values
            var renderer = viewer.impl.renderer();
            var prefs = viewer.prefs;
            var saoEnabled = prefs.get('ambientShadows');
            var antiAliasing = prefs.get('antialiasing');

            var sao = renderOptions.ambientOcclusion;
            if (sao) {
                if ("enabled" in sao) {
                    saoEnabled = sao.enabled;
                }
                var saoRadius = ("radius" in sao) ? sao.radius : null;
                var saoIntensity = ("intensity" in sao) ? sao.intensity : null;
                if (saoRadius !== null && saoIntensity !== null) {
                    if (saoRadius !== renderer.getAORadius() ||
                        saoIntensity !== renderer.getAOIntensity()) {
                        renderer.setAOOptions(saoRadius, saoIntensity);
                        renderer.composeFinalFrame();
                    }
                }
            }

            if ("environment" in renderOptions) {
                var lightPresetIndex = this.getLightPresetIndex(renderOptions.environment);
                if (lightPresetIndex !== -1 && lightPresetIndex !== prefs.get('lightPreset') && isModel3d) {
                    viewer.setLightPreset(lightPresetIndex);
                }
            }

            // ToneMap values are overrides to the environment settings.
            var toneMap = renderOptions.toneMap;
            if (toneMap) {
                var invalidate = false;
                var exposure = "exposure" in toneMap ? toneMap.exposure : null;
                var toneMapIntensity = "lightMultiplier" in toneMap ?  toneMap.lightMultiplier : null;

                if (exposure !== null && exposure !== renderer.getExposureBias()) {
                    renderer.setTonemapExposureBias(exposure);
                    invalidate = true;
                }

                if (toneMapIntensity !== null && viewer.impl.dir_light1 && toneMapIntensity !== this.getToneMapIntensity()) {
                    viewer.impl.dir_light1.intensity = Math.pow(2.0, toneMapIntensity);
                    invalidate = true;
                }

                if (invalidate) {
                    viewer.impl.invalidate(true);
                }
            }

            var appearance = renderOptions.appearance;
            if (appearance) {
                if ("antiAliasing" in appearance) {
                    antiAliasing = appearance.antiAliasing;
                }
                if ("progressiveDisplay" in appearance && appearance.progressiveDisplay !== prefs.get('progressiveRendering')) {
                    viewer.setProgressiveRendering(appearance.progressiveDisplay);
                }
                if ("swapBlackAndWhite" in appearance && appearance.swapBlackAndWhite !== prefs.get('swapBlackAndWhite')) {
                    viewer.setSwapBlackAndWhite(appearance.swapBlackAndWhite);
                }
                if (("ghostHidden" in appearance) && appearance.ghostHidden !== prefs.get('ghosting')) {
                    isModel3d && viewer.setGhosting(appearance.ghostHidden);
                }
                if ("displayLines" in appearance && appearance.displayLines !== prefs.get('lineRendering')) {
                    viewer.hideLines(!appearance.displayLines);
                }
                if ("displayPoints" in appearance && appearance.displayPoints !== prefs.get('pointRendering')) {
                    viewer.hidePoints(!appearance.displayPoints);
                }
            }

            // SAO and AA at the end.
            if (isModel3d && saoEnabled !== prefs.get('ambientShadows') && antiAliasing !== prefs.get('antialiasing')) {
                viewer.setQualityLevel(saoEnabled, antiAliasing);
            }
        }

        // Restore cutplanes (aka: Sectioning) data only for 3d models.
        if (Array.isArray(viewerState.cutplanes) && viewer.model && isModel3d) {
            var cutplanes = [];
            for (var i = 0; i < viewerState.cutplanes.length; i++) {
                var plane = viewerState.cutplanes[i];
                if (Array.isArray(plane) && plane.length >= 4) {
                    cutplanes.push(new THREE.Vector4(plane[0], plane[1], plane[2], plane[3]));
                }
            }

            removeUnneededCutplanes(viewerState, cutplanes);
            
            viewer.impl.setCutPlaneSet('__set_view', cutplanes);
        }

        // Allow extensions to restore their data
        for (var extensionName in viewer.loadedExtensions) {
            var extension = viewer.loadedExtensions[extensionName];
            extension.restoreState && extension.restoreState(viewerState, immediate);
        }

        return true;
    };

    /**
     * Gets the environment identifier.
     * 
     * @returns {string}
     * @private
     */
    this.getEnvironmentName = function() {
        var preset = LightPresets[viewer.impl.currentLightPreset()];
        if (!preset) {
            return 'none';
        }
        return preset.name;
    };

    /**
     * Restores camera states values back into the viewer.
     * We avoid using methods such as setViewFromCamera() because those make some
     * assumptions about the current state of the viewer. We need no such things.
     *
     * Note: Implementation based on Viewer3DImpl.setViewFromCamera()
     *
     * @param {object} camera
     * @param {boolean} immediate
     * @private
     */
    this.restoreCameraState = function(camera, immediate) {

        viewer.impl.adjustOrthoCamera(camera);
        var navapi = viewer.navigation;

        if (!immediate) {
            // With animation
            viewer.impl.camera.isPerspective = camera.isPerspective;
            navapi.setRequestTransitionWithUp(true, camera.position, camera.target, camera.fov, camera.up, camera.worldup, camera.pivot);
        } else {
            // Instantaneous, no animation
            if (camera.isPerspective) {
                navapi.toPerspective();
            } else {
                navapi.toOrthographic();
            }
            navapi.setCameraUpVector(camera.up);
            navapi.setWorldUpVector(camera.worldup);
            navapi.setView(camera.position, camera.target);
            navapi.setPivotPoint(camera.pivot);
            navapi.setVerticalFov(camera.fov, false);

            viewer.impl.syncCamera(true);
        }
    };

    /**
     * Return true if two viewer states are equal, it's possible to compare only a subset of the objects providing a filter
     * as parameter.

     * @param {object} viewerStateA
     * @param {object} viewerStateB
     * @param {object} [filter] - Similar in structure to viewerState used to filter out values to check.
     * @returns {boolean} True if the states are equal.
     * @tutorial viewer_state
     */
    this.areEqual = function(viewerStateA, viewerStateB, filter) {

        function areArraysEqual(arrayA, arrayB) {

            arrayA = arrayA || [];
            arrayB = arrayB || [];

            if (arrayA.length !== arrayB.length) {
                return false;
            }

            for (var i = 0; i < arrayA.length; ++i) {
                if (arrayA[i] !== arrayB[i]) {
                    return false;
                }
            }

            return true;
        }

        function areVectorsEqual(vectorA, vectorB, epsilon) {

            vectorA = vectorA || [];
            vectorB = vectorB || [];

            if (vectorA.length !== vectorB.length) {
                return false;
            }

            if (vectorA.length === 0) {
                return false;
            }

            return (
                areNumbersEqual(vectorA[0], vectorB[0], epsilon) ||
                areNumbersEqual(vectorA[1], vectorB[1], epsilon) ||
                areNumbersEqual(vectorA[2], vectorB[2], epsilon));

        }

        function areNumbersEqual(numberA, numberB, epsilon) {

            var parcedA = numberA ? parseFloat(numberA) : null;
            var parcedB = numberA ? parseFloat(numberB) : null;

            var typeOfA = typeof(parcedA);
            var typeOfB = typeof(parcedB);

            if (typeOfA === 'number' && typeOfB === 'number') {
                return (Math.abs(numberA - numberB) < epsilon);
            }

            numberA = numberA ? numberA : null;
            numberB = numberB ? numberB : null;

            return numberA === numberB;
        }

        var stateA = viewerStateA;
        var stateB = viewerStateB;
        var epsilon = 0.000000001;

        if (filter && filter !== true) {
            stateA = this.applyFilter(stateA, filter);
            stateB = this.applyFilter(stateB, filter);
        }

        if (stateA["seedURN"] !== stateB["seedURN"]) {
            return false;
        }

        // Check object set (only check first element, the one written by ViewerState).
        var objectSetA = stateA["objectSet"] || [];
        var objectSetB = stateB["objectSet"] || [];

        if (objectSetA.length !== objectSetB.length) {
            return false;
        }

        var objectA = objectSetA[0] || {};
        var objectB = objectSetB[0] || {};

        if (
            objectA.idType !== objectB.idType ||
           !areNumbersEqual(objectA.explodeScale, objectB.explodeScale, epsilon) ||
           !areArraysEqual(objectA.id,  objectB.id) ||
           !areArraysEqual(objectA.isolated, objectB.isolated) ||
           !areArraysEqual(objectA.hidden, objectB.hidden)) {
            return false;
        }

        // Check Viewport.
        var viewportA = stateA["viewport"] || {};
        var viewportB = stateB["viewport"] || {};

        if (viewportA["name"] !== viewportB["name"] ||
            viewportA["projection"] !== viewportB["projection"] ||
            viewportA["isOrthographic"] !== viewportB["isOrthographic"] ||
           !areNumbersEqual(viewportA["distanceToOrbit"], viewportB["distanceToOrbit"], epsilon) ||
        // !areNumbersEqual(viewportA["aspectRatio"], viewportB["aspectRatio"], epsilon) ||
           !areNumbersEqual(viewportA["fieldOfView"], viewportB["fieldOfView"], epsilon) ||
           !areNumbersEqual(viewportA["orthographicHeight"], viewportB["orthographicHeight"], epsilon) ||
           !areVectorsEqual(viewportA["eye"], viewportB["eye"], epsilon) ||
           !areVectorsEqual(viewportA["target"], viewportB["target"], epsilon) ||
           !areVectorsEqual(viewportA["up"], viewportB["up"], epsilon) ||
           !areVectorsEqual(viewportA["worldUpVector"], viewportB["worldUpVector"], epsilon) ||
           !areVectorsEqual(viewportA["pivotPoint"], viewportB["pivotPoint"], epsilon)) {
            return false;
        }

        // Skip render options, cut planes and extension data.
        return true;
    };

    /**
     * Helper method with the intent to change the type of an array with ids from String to ints.
     * We need this method because we need to make sure that ids that get fed into the ViewerState
     * are in the correct type.
     *
     * @param {Array} array - For example, `["45", "33", "1"]`.
     * @returns {Array} For example, `[45, 33, 1]`.
     * @private
     */
    this.toIntArray = function( array ) {
        var ret = [];
        if (Array.isArray(array)) {
            for (var i= 0, len=array.length; i<len; ++i) {
                ret.push( parseInt(array[i]) );
            }
        }
        return ret;
    };


    /**
     * Helper method that constructs a Vector3 from a given Array.
     * If Array is not well-formed, then the failValue is return instead.
     *
     * @param {array} array - An array with 3 values.
     * @param {THREE.Vector3} failValue - If array param is invalid, failValue will be returned instead.
     * @returns {THREE.Vector3} Either a new Vector with values coming from 'array' or failValue.
     * @private
     */
    this.getVector3FromArray = function(array, failValue) {

        if (array instanceof Array && array.length > 2) {

            // Some array values are exported as string-of-numbers. Fix that here.
            array[0] = parseFloat(array[0]);
            array[1] = parseFloat(array[1]);
            array[2] = parseFloat(array[2]);
            return new THREE.Vector3().fromArray(array);
        }
        return failValue;
    };

    /**
     * Helper function that returns selected node ids in an array.
     * @param {Model} [model] - model 
     * @returns {array}
     * @private
     */
    this.getSelectedNodes = function(model) {
        model = model || viewer.model;
        return model.selector ? model.selector.getSelection() : [];
    };

    /**
     * Helper function that returns the index values of the isolated (visible) layers.
     * Applies only to 2d models/blueprints
     * @param {Autodesk.Viewing.Model} [model]
     * @private
     */
    this.getVisibleLayers2d = function(model) {
        if (!model || model === viewer.model) return viewer.impl.getVisibleLayerIndices();

        logger.warn('[getVisibleLayers2d] multiple models not yet supported.');
        return [];
    };

    /**
     * Helper function that returns true if all layers are visible.
     * Applies only to 2d models/blueprints
     * @param {Autodesk.Viewing.Model} [model]
     * @private
     */
    this.areAllLayersVisible = function(model) {
        if (!model || model === viewer.model) return viewer.impl.layers.allLayersVisible();

        logger.warn('[areAllLayersVisible] multiple models not yet supported.');
        // All of the layers should be visible
        return true;
    };
      
    /**
     * Gets the aspect ratio.
     * @returns {number} Aspect ratio.
     * @private
     */
    this.getAspectRatio = function() {
        var viewport = viewer.navigation.getScreenViewport();
        var aspect = viewport.width / viewport.height;
        return aspect;
    };

    /**
     * Returns world height when in orthographic camera mode.
     * @returns {number} Orthographic height.
     * @private
     */
    this.getOrthographicHeight = function() {
        var cam = viewer.navigation.getCamera();
        if (cam.isPerspective) return 0;
        return Math.abs(2 * cam.orthographicCamera.top);
    };

    /**
     * Returns the URN of the document model.
     * @returns {string} Model URN.
     */
    this.getSeedUrn = function(model) {
        model = model || viewer.model;
        return model?.getSeedUrn() || "";
    };

    /**
     * Returns the slider value for the viewer's current light intensity.
     * @returns {number}
     * @private
     */
    this.getToneMapIntensity = function () {

        // Original code from RenderOptionsPanel.js
        // Should probably live elsewhere in the api.
        var intensity = 0.0;
        if (viewer.impl.dir_light1) {
            if (viewer.impl.dir_light1.intensity != 0)
                intensity = Math.log(viewer.impl.dir_light1.intensity)/Math.log(2.0);
            else
                intensity = -1e-20;
        }
        return intensity;
    };

    /**
     * Returns the index of the LightPreset with a matching name value.
     * @param environmentName
     * @returns {number} Index of LightPreset, or -1 if not found.
     * @private
     */
    this.getLightPresetIndex = function ( environmentName ) {

        for (var i=0; i<LightPresets.length; i++) {
            if (LightPresets[i].name === environmentName) {
                return i;
            }
        }
        return -1;
    };

    /**
     * Filters out key/value pairs from the viewerState.
     *
     * To get all of the values available use FILTER_ALL. If no filter is provided FILTER_ALL will be used.
     * It is encourage for consumers to define their specialized filters.
     *
     * @param {object} viewerState - Object to be filtered.
     * @param {object} filter - Object with a similar structure to viewerState, where values are Booleans signaling which
     * elements should be included (true) and which ones should not (false).
     * If a viewerState key is not found in the filter, we assume that it is non-wanted.
     * @private
     */
    this.applyFilter = function( viewerState, filter ) {

        // Check the 'ALL' filter
        if (filter === true) return;

        // Filtering only 1 level depth keys
        // Additional levels are checked recursively.
        for (var key in viewerState) {

            if (!Object.prototype.hasOwnProperty.call(viewerState, key)) {
                continue;
            }

            // Try to find the key in the filter object
            var filterValue = filter[key];

            if (filterValue === undefined) {

                // key not enabled in filter, remove key/value pair from viewerState.
                delete viewerState[key];
            }
            else if (typeof(filterValue) === 'boolean') {

                if (filterValue === false) {
                    // key explicitly flagged for removal, remove key/value pair from viewerState.
                    delete viewerState[key];
                }
            }
            else if (filterValue instanceof Object) {

                if (viewerState[key] instanceof Object) {
                    // Both are Objects, recursive call on them.
                    this.applyFilter(viewerState[key], filter[key]);
                } else {
                    // This case signals a miss-match between filter and value.
                    // Since it's an undefined case, we'll be inclusive for the time being.
                    // *** Keep the value in viewerState ***
                    logger.warn("[applyFilter] A - Invalid filter Object for key [" + key + "]");
                }
            }
            else {

                // Note: Every other value for filter is invalid.
                // For now, we'll keep the key/value in viewerState.
                logger.warn("[applyFilter] B - Invalid filter value for key [" + key + "]");
            }

        }
    };

    /**
     * Converts viewport coordinates into range [0...1] using the model's bounding box.
     * 
     * @param {object} viewerState - A state object obtained via `viewer.getState()`. The object is modified in-place.
     */
    this.normalizeCoordinates = function(viewerState) {

        var viewport = viewerState.viewport;
        if (viewport) {

            // Avoid operating on the object more than once
            if (viewport.normalized) {
                logger.warn('invalid normalization of state.viewport. Ignoring command.');
                return;
            }

            // Add flag
            viewport.normalized = true;

            const mat = SceneMath.getNormalizingMatrix(viewer.model);
            applyMatrix4(viewport, mat);

            // Change orthographicHeight as a ratio of the model's bounding-box height.
            if ('orthographicHeight' in viewport) {
                var bbox  = viewer.model.myData.bbox;
                var bboxHeight = bbox.max.y - bbox.min.y;
                var newValue = viewport.orthographicHeight / bboxHeight;
                viewport.orthographicHeight = newValue;
            }
        }
    };

    /**
     * Converts normalized coordinates [0..1] into bounding box coordinates. 
     * 
     * @param {object} viewerState - A state object obtained via `viewer.getState()`. The object is modified in-place.
     */
    this.denormalizeCoordinates = function(viewerState) {

        var viewport = viewerState.viewport;
        if (viewport) {

            // Make sure data is normalized
            if (!viewport.normalized) {
                logger.warn('invalid denormalization of state.viewport. Ignoring command.');
                return;
            }

            // Remove flag
            delete viewport.normalized;

            const mat = SceneMath.getNormalizingMatrix(viewer.model);
            let matInv = mat.clone().invert();
            applyMatrix4(viewport, matInv);

            // Restore orthographicHeight from a ratio of the model's bounding-box height.
            if ('orthographicHeight' in viewport) {
                var bbox  = viewer.model.myData.bbox;
                var bboxHeight = bbox.max.y - bbox.min.y;
                var newValue = viewport.orthographicHeight * bboxHeight;
                viewport.orthographicHeight = newValue;
            }
        }
    };

}

ViewerState.prototype.constructor = ViewerState;



function applyMatrix4(viewport, matrix) {
    var eye = new THREE.Vector3(viewport.eye[0], viewport.eye[1], viewport.eye[2]);
    var pivot = new THREE.Vector3(viewport.pivotPoint[0], viewport.pivotPoint[1], viewport.pivotPoint[2]);
    var target = new THREE.Vector3(viewport.target[0], viewport.target[1], viewport.target[2]);

    eye.applyMatrix4(matrix);
    pivot.applyMatrix4(matrix);
    target.applyMatrix4(matrix);
    
    viewport.eye[0] = eye.x;
    viewport.eye[1] = eye.y;
    viewport.eye[2] = eye.z;
    viewport.pivotPoint[0] = pivot.x;
    viewport.pivotPoint[1] = pivot.y;
    viewport.pivotPoint[2] = pivot.z;
    viewport.target[0] = target.x;
    viewport.target[1] = target.y;
    viewport.target[2] = target.z;
}
