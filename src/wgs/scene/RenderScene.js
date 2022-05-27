import * as globals from '../globals';
import { FrustumIntersector } from './FrustumIntersector';
import * as THREE from "three";
import { RenderFlags } from "./RenderFlags";
import { ResetFlags } from "./ResetFlags";
import { ModelExploder } from "./ModelExploder"

    /**
     * RenderScene
     * Represents the full graphical scene.
     * Used for iterating through the scene for progressive rendering,
     * hit testing, etc.
     * @constructor
     * */
    export function RenderScene() {

        var _needsRender = false; // if true, scene needs a re-render due to a paging-failure in last render traversal

        var _done        = false; // true indicates that progressive rendering has finished
                                  // since last reset call, i.e. all batches have been traversed.

        var _models          = []; // {RenderModel[]} - All RenderModels to be rendered.
        var _candidateScenes = []; // {RenderBatch[]} - _candidateScenes[i] points to the next batch to be rendered from _models[i]. Same length as _models.
        var _previousScenes = [];  // {RenderBatch[]} - _previousScenes[i] points to the previous batch rendered from _models[i]. Same length as _models.
        var _tmpBox          = new THREE.Box3(); // Reused for return values of getVisibleBounds() 

        var _hiddenModels = []; // {RenderModel[]} - All models that are currently loaded, but excluded from rendering/selection etc.

        var _frustum   = new FrustumIntersector(); // updated for current camera in this.reset().
        var _raycaster = new THREE.Raycaster();        

        //var _frameStamp    = 0;             // increased with each render traversal restart; set, not used. For debug?
        var _perf          = performance;   // shortcut to browser-provided performance object

        // During motion, we usually restart rendering at any frame, i.e. a frame is never resumed. When setting this
        // option, we exploit this to render transparent shapes earlier. (and skip less important opaque ones)
        this.enableNonResumableFrames = false;

        // Determines how much of the render budget is reserved for transparent shapes.
        // E.g., a value of 0.1 means that 10% of the render budget is spent for transparent shapes.
        this.budgetForTransparent = 0.1;

        // If true, we assume the current frame not to be resumed and
        // render some transparent shapes before the opaque ones are done.
        var _frameWillNotBeResumed = false;

        // If _frameWillNotBeResumed is true, this array collects transparent scenes and renders them
        // back-to-front at the end of a frame.
        var _transparentScenes = []; // {THREE.Scene|RenderBatch}[]

        // needed for back-to-front sorting of transparent objects (see renderTransparentScenes)
        var _camera = null;


        this.frustum = function() {
            return _frustum;
        };

        function findById(models, modelId) {
            for (var i = 0; i < models.length; i++) {
                var model = models[i];
                if (model && model.id === modelId) {
                    return model;
                }
            }
            return null;
        }

        this.findModel = function(modelId)       { return findById(_models, modelId);       };
        this.findHiddenModel = function(modelId) { return findById(_hiddenModels, modelId); };

        this.addModel = function (renderModel) {
            if (_models.indexOf(renderModel) !== -1) {
                return;
            }

            _models.push(renderModel);
            _candidateScenes.length = _models.length;
            _previousScenes.length = _models.length;
            this.recomputeLinePrecision();
        };

        this.removeModel = function(renderModel) {
            var idx = _models.indexOf(renderModel);
            if (idx >= 0) {
                _models.splice(idx, 1);
            }
            _candidateScenes.length = _models.length;
            _previousScenes.length = _models.length;
            this.recomputeLinePrecision();
            return idx >= 0;
        };

        this.addHiddenModel = function(renderModel) {
            var idx = _hiddenModels.indexOf(renderModel);
            if (idx < 0) {
                _hiddenModels.push(renderModel);
            }
            return idx < 0;
        };

        this.removeHiddenModel = function(renderModel) {
            var idx = _hiddenModels.indexOf(renderModel);
            if (idx >= 0) {
                _hiddenModels.splice(idx, 1);
            }
            return idx >= 0;
        };

        this.isEmpty = function() {
            return _models.length === 0;
        };

        this.needsRender = function () {
            return _needsRender;
        };
        this.resetNeedsRender = function () {
            _needsRender = false;
        };

        this.recomputeLinePrecision = function() {
            var value = 1;
            const sizeTarget = new THREE.Vector3();
            for (var i=0, len=_models.length; i<len; ++i) {
                var modelBox = _models[i].getData().bbox;

                // Skip empty boxes, as they lead to a zero threshold
                if (modelBox.getSize(sizeTarget).length() === 0)
                    continue;

                // Note that modelBox.getBoundingSphere() may not exist if the box is an LmvBox3. 
                var modelValue = THREE.Box3.prototype.getBoundingSphere.call(modelBox, new THREE.Sphere()).radius * 0.001;
                value = Math.min(value, modelValue);
            }
            _raycaster.params.Line.threshold = value;
        };

        /**
         *  For each sub-scene, keep a running average of how long it took to render over the
         *  last few frames.
         *   @param {THREE.Scene|RenderBatch} scene
         *   @param {number}                  frameTime - last measured rendering time in ms
         */
        function updateAvgFrameTime(scene, frameTime) {
            if (scene.avgFrameTime === undefined)
                scene.avgFrameTime = frameTime;
            else {
                scene.avgFrameTime = 0.8 * scene.avgFrameTime + 0.2 * frameTime;
            }
        }

        /**
         *  Renders transparent scenes in back-to-front order.
         *
         *  @param {RenderCB}      renderObjectsCB - Called for each element of the scenes array
         *  @param {UnifiedCamera} camera
         *  @param {RenderBatch[]} scenes          - Array of RenderBatches (or THREE.Scene with .boundingBox property)
         */
        function renderTransparentScenes(scenes, camera, renderObjectCB) {

            // compute camera distance for each scene
            var i, scene;
            for (i=0; i<scenes.length; i++) {
                scene = scenes[i];
                var bbox = scene.boundingBox || scene.getBoundingBox();
                scene.cameraDistance = bbox.distanceToPoint(camera.position);
            }

            // sort by decreasing camera distance
            var sortOrder = function(a, b) {
                return b.cameraDistance - a.cameraDistance;
            };
            scenes.sort(sortOrder);

            // render each scene and update average frame time
            var t0 = performance.now();
            for (i=0; i<scenes.length; i++) {

                // render scene
                scene = scenes[i];
                renderObjectCB(scene);

                // measure elapsed time
                var t1 = performance.now();
                var delta = t1 - t0;
                t0 = t1;

                // track average frame time
                updateAvgFrameTime(scene, delta);
            }
        }

        /**
         * Indicates if the current traversal is done with the assumption that this frame will not be resumed.
         *  @returns {boolean}
         */
        this.frameResumePossible = function() {
            return !_frameWillNotBeResumed;
        };

        /**
          * Incrementally render some meshes until we run out of time.
          *  @param {RenderCB} cb            - Called that does the actual rendering. Called for each RenderBatch to be rendered.
          *  @param {number}   timeRemaining - Time in milliseconds that can be spend in this function call.
          *  @returns {number} Remaining time left after the call. Usually <=0.0 if the frame could not be fully finished yet.
          * 
          * @callback RenderScene~RenderCB
          * @param {RenderBatch} scene
          */
        this.renderSome = function (renderObjectCB, timeRemaining) {

            var t0 = _perf.now(), t1;

            // reserve some time for transparent shapes.
            var timeForTransparent = this.budgetForTransparent * timeRemaining;

            // repeat until time budget is consumed...
            var model;
            while (1) {

                //Find the best candidate render batch to render now -- in case
                //there are multiple models.
                //TODO: In case a huge number of models is loaded, we may have to
                //rethink the linear loop below and use some priority heap or somesuch.
                var candidateIdx = 0;
                var scene        = null;
                for (var iq=0; iq<_candidateScenes.length; iq++) {

                    // candidate is the next RenderBatch to be processed from _models[q] 
                    var candidate = _candidateScenes[iq];
                    model     = _models[iq];
                    if (!candidate)
                        _candidateScenes[iq] = candidate = model.nextBatch();

                    // If the camera is in motion and the time for opaque scenes is over, continue with transparent shapes.
                    var skipOpaque = (_frameWillNotBeResumed && timeRemaining < timeForTransparent);
                    if (skipOpaque) {

                        // check if the next candidate is still an opaque one. Note that the .sortObjects
                        // flag indicates whether a RenderBatch contains transparent objects.
                        var isOpaque = candidate && !candidate.sortObjects;

                        if (isOpaque) {
                            // skip current candidate and use the first available transparent scene instead
                            model.skipOpaqueShapes();
                            candidate = model.nextBatch();
                        }
                    }

                    if (candidate === null) {
                        // No more batches to render from this model
                        continue;
                    }

                    // If all previous candidates were null, _candidateScenes[q] is obviously the best one so far.
                    if (!scene) {
                        candidateIdx = iq;
                        scene        = candidate;
                    }

                    // Choose current candidate only if its renderImportance is higher.
                    // The renderImportance of RenderBatches is set by model iterators.
                    if (candidate.renderImportance > scene.renderImportance) {
                        candidateIdx = iq;
                        scene        = candidate;
                    }
                }

                // Render the batch we chose above and determine whether to continue the loop
                if (scene) {
                    //Fetch a new render batch from the model that we took the
                    //current batch from.
                    _candidateScenes[candidateIdx] = _models[candidateIdx].nextBatch();

                    // If we are in a non-resumable frame, we try to get the most important ones of opaque and
                    // transparent scenes. Therefore, the traversal of transparent scenes will also be ordered
                    // by decreasing priority just like for opaque ones. For correct rendering, however,
                    // we cannot render them directly here. Instead, we must collect them first and render them
                    // back-to-front at the end of the function.
                    if (scene.sortObjects && _frameWillNotBeResumed) {

                        // defer to the end of the frame
                        _transparentScenes.push(scene);

                        // reserve frame time based on past rendering times. Just for the very first use,
                        // we use an initial guess value as fallback.
                        timeRemaining -= (scene.avgFrameTime === undefined) ? 0.05 : scene.avgFrameTime;

                    } else {

                        // do the actual rendering
                        renderObjectCB(scene);
                        if (scene.hasOwnProperty("drawEnd"))
                            scene.drawEnd = scene.lastItem;
                            
                        // get time that we spent for rendering of the last batch
                        t1 = _perf.now();
                        var delta = t1 - t0; // in milliseconds
                        t0 = t1;

                        //For each sub-scene, keep a running average
                        //of how long it took to render over the
                        //last few frames.
                        updateAvgFrameTime(scene, delta);

                        // update remaining time
                        // Note that we don't do accurate timing here, but compute with average values instead.
                        // In this way, the number of rendered batches is more consistent across different frames
                        timeRemaining -= scene.avgFrameTime;
                    }

                    // get time that we spent for rendering of the last batch
                    t1 = _perf.now();
                    var delta = t1 - t0; // in milliseconds
                    t0 = t1;

                    //For each sub-scene, keep a running average
                    //of how long it took to render over the
                    //last few frames.
                    updateAvgFrameTime(scene, delta);

                    // update remaining time
                    // Note that we don't do accurate timing here, but compute with average values instead.
                    // In this way, the number of rendered batches is more consistent across different frames
                    timeRemaining -= scene.avgFrameTime;

                    // Check if we should exit the loop...
                    if (timeRemaining <= 0) {
                        break;
                    }

                } else {
                    // No more batches => Frame rendering finished, if all models are loaded
                    _done = true;
                    break;
                }
            }

            // Render some deferred transparent shapes (_transparentShapes). Note that this array will
            // usually be empty if _frameWillNotBeResumed is false
            if (_transparentScenes.length > 0) {

                renderTransparentScenes(_transparentScenes, _camera, renderObjectCB);

                // all scenes processed. Clear array.
                _transparentScenes.length = 0;
            }

            return timeRemaining;
        };

        //TODO: This method needs to be revisited as on demand loading is removed from the code base  
        /** Resets the scene traversal 
         *   @param  {UnifiedCamera} camera
         *   @param  {number}        drawMode     - E.g., RENDER_NORMAL. See RenderFlags.js
         *   @param: {number}        [resetType]  - Must be one of RESET_NORMAL, RESET_REDRAW or RESET_RELOAD.
         *                                          Only used when on demand loading is enabled. RESET_RELOAD will reload and redraw
         *                                          geometry. RESET_REDRAW will redraw geometry. RESET_NORMAL will only redraw geometry
         *                                          that hasn't already been drawn. If undefined RESET_NORMAL is used.
         */
        this.reset = function (camera, drawMode, resetType, cutPlanes) {
            //_frameStamp++;
            _done     = false;

            this.resetNeedsRender();

            //Calculate the viewing frustum
            //TODO: same math is done in the renderer also. We could unify
            _frustum.reset(camera, cutPlanes);
            _frustum.areaCullThreshold = globals.PIXEL_CULLING_THRESHOLD;

            if (!_models.length)
                return;

            // If the camera is in-motion, we assume the frame not to be resumed. This allows us to render transparent shapes
            // earlier. This special treatment is only used/needed for the main scene pass.
            _frameWillNotBeResumed = (this.enableNonResumableFrames && resetType == ResetFlags.RESET_RELOAD && drawMode === RenderFlags.RENDER_NORMAL);

            _camera = camera;

            //Begin the frustum based scene iteration process per model.
            //A "Model" is all the objects to display. There's typically one model in a scene, so length is 1. 
            for (var i=0; i<_models.length; i++) {
                // decide what iterator to use, usually the BVH iterator
                _models[i].resetIterator(camera, _frustum, drawMode, resetType);
                // get the first RenderBatch (some set of fragments) to render.
                _candidateScenes[i] = _models[i].nextBatch();
                _previousScenes[i] = null;
            }
        };


        this.isDone = function () {
            return _done || this.isEmpty();
        };

        // Visibility and highlighting methods: see RenderModel.js for details.

        this.setAllVisibility = function (value) {
            for (var i=0; i<_models.length; i++)
                _models[i].setAllVisibility(value);
        };

        this.hideLines = function (hide) {
            for (var i=0; i<_models.length; i++)
                _models[i].hideLines(hide);
        };

        this.hidePoints = function (hide) {
            for (var i=0; i<_models.length; i++)
                _models[i].hidePoints(hide);
        };

        this.hasHighlighted = function () {
            for (var i=0; i<_models.length; i++)
                if (_models[i].hasHighlighted())
                    return true;

            return false;
        };

        this.areAllVisible = function () {
            for (var i=0; i<_models.length; i++)
                if (!_models[i].areAllVisible())
                    return false;

            return true;
        };

        this.areAll2D = function () {
            for (var i=0; i<_models.length; i++)
                if (!_models[i].is2d())
                    return false;

            return true;
        };

        this.areAll3D = function () {
            for (var i=0; i<_models.length; i++)
                if (!_models[i].is3d())
                    return false;

            return true;
        };

        /** Trigger bbox recomputation. See RenderModel.js for details. */
        this.invalidateVisibleBounds = function() {
            for (var i=0; i<_models.length; i++)
                _models[i].visibleBoundsDirty = true;
        };
        
        /**
        * @param {bool}            includeGhosted
        * @param {function(model)} [modeFilter]
        * @param {bool}            excludeShadow - Remove shadow geometry (if exists) from model bounds.
        * @returns {THREE.Box3} 
        *
        * NOTE: The returned box object is always the same, i.e. later calls
        *       affect previously returned values. E.g., for
        *        var box1 = getVisibleBounds(true);
        *        var box2 = getVisibleBounds(false);
        *       the second call would also change box1.
        */
        this.getVisibleBounds = function (includeGhosted, bboxFilter, excludeShadow) {
            _tmpBox.makeEmpty();
            for (var i=0; i<_models.length; i++) {
                var model = _models[i];
                var modelBox = model.getVisibleBounds(includeGhosted, excludeShadow); 

                // Consider bboxFilter
                var skipModel = bboxFilter && !bboxFilter(modelBox);
                if (skipModel) {
                    continue;
                }

                _tmpBox.union(modelBox);
            }
            return _tmpBox;
        };

        /**
         * @param {THREE.Vector3} position            - Ray origin.
         * @param {THREE.Vector3} direction           - Ray direction.
         * @param {bool}          [ignoreTransparent] - Shoot trough transparent objects.
         * @param {number[]|number[][]} [dbIds]       - Optional filter of dbIds to be considered for testing. see RenderModel.rayIntersect().
         *                                              If modelIds is set, dbIds[i] must provide a separate dbId array for modelIds[i].
         * @param {number[]}      [modelIds]          - Optional list of modelIds to be considered for rayIntersection. (default is to consider all)
         * @param {Array}         [intersections]     - Optional return array with all found intersections.
         * @param {function}      [getDbIdAtPointFor2D] - Optional callback. For 2D models, to return the dbId and modelId in an array.
         * @param {Object}        [options]             - Rayintersection options (see RenderModel.rayIntersect)
         * 
         * @returns {Object|null} Intersection result obect (see RenderModel.rayIntersect)
         */ 
        // Add "meshes" parameter, after we get meshes of the object using id buffer,
        // then we just need to ray intersect this object instead of all objects of the model.
        this.rayIntersect = function (position, direction, ignoreTransparent,
                                      dbIds, modelIds,
                                      intersections, getDbIdAtPointFor2D, options) {

            // Init raycaster
            _raycaster.set(position, direction);

            // For multiple RenderModels, perform raytest on each of them and find the closest one.
            if (_models.length > 1) {
                // Collect raytest result objects from each 3D model
                const modelHits = [];

                if (modelIds) {
                    for (let i = 0; i < modelIds.length; i++) {
                        const model = this.findModel(modelIds[i]);
                        if (model) {
                            const modelDbIds = dbIds && dbIds[i];
                            const res = model.rayIntersect(_raycaster, ignoreTransparent, modelDbIds, intersections, getDbIdAtPointFor2D, options);
                            if (res) {
                                modelHits.push(res);
                            }
                        }
                    }
                } else {
                    for (let i = 0; i < _models.length; i++) {
                        // Perform raytest on model i
                        const res = _models[i].rayIntersect(_raycaster, ignoreTransparent, dbIds, intersections, getDbIdAtPointFor2D, options);

                        if (res) {
                            modelHits.push(res);
                        }
                    }
                }

                if (!modelHits.length)
                    return null;

                // Return closest hit
                modelHits.sort(function(a,b) {return a.distance - b.distance;});
                return modelHits[0];
            } else {
                // If we don't have any RenderModel, just return null.
                if (!_models.length)
                    return null;

                // Apply modelIds filter
                const model = _models[0];
                if (modelIds && modelIds.indexOf(model.id) === -1) {
                    return null;
                }

                // If we only have a single RenderModel, just call rayIntersect() on it.
                return model.rayIntersect(_raycaster, ignoreTransparent, dbIds, intersections, getDbIdAtPointFor2D, options);
            }
        };

        /**
         *  Progress of current frame rendering. 
         *  @returns {number} Value in [0,1], where 1 means finished.
         */
        this.getRenderProgress = function () {
            return _models[0].getRenderProgress();
        };

        /** @returns {RenderModel[]} */
        this.getModels = function() {
            return _models;
        };

        /** @returns {RenderModel[]} */
        this.getHiddenModels = function() {
            return _hiddenModels;
        };

        /** @returns {RenderModel[]} */
        this.getAllModels = function() {
            return _models.concat(_hiddenModels);
        };

        // ----------------------------
        // Warning: The methods in the section below assume that there is exactly one RenderModel.
        //          They will ignore any additional models and cause an exception if the model list is empty.
        // 

        // Direct access to FragmentList, GeometryList, and total number of RenderBatches.
        //
        // Note: 
        //  - The methods do only care for model 0 and ignore any additional ones.
        //  - Will cause an error when called if the RenderModel array is empty.
        this.getFragmentList = function () {
            return _models[0].getFragmentList();
        };
        this.getGeometryList = function () {
            return _models[0].getGeometryList();
        };
        this.getSceneCount = function () {
            return _models[0].getSceneCount();
        };

        //Used by ground shadow update, ground reflection update, and screenshots
        this.getGeomScenes = function () {
            var scenes = [];
            for (var i=0; i<_models.length; i++) {
                // Collect all scenes from next model
                var modelScenes = _models[i].getGeomScenes();
                for (var j=0; j<modelScenes.length; j++) {
                    // Some scenes may not exist. E.g., if it corresponds to an empty BVH node.
                    var scene = modelScenes[j];
                    if (scene) {
                        scenes.push(scene);
                    }
                }
            }
            return scenes;
        };

        // Used by ground shadow update, ground reflection update,
        this.getGeomScenesPerModel = function () {
            return _models.reduce((acc, m) => { 
                acc.push(m.getGeomScenes());
                return acc;
            }, []);
        };

        // ---------------- End of section of functions without support for multiple RenderModels

        /** Sets animation transforms for all fragments to create an "exploded view": Each fragment is displaced  
          * away from the model bbox center, so that you can distuinguish separate components. 
          *
          * If the model data provides a model hierarchy (given via model.getData().instanceTree), it is also considered for the displacement.
          * In this case, we recursively shift each object away from the center of its parent node's bbox. 
          *
          * @param {number} scale - In [0,1]. 0 means no displacement (= reset animation transforms). 
          *                                   1 means maximum displacement, where the shift distance of an object varies 
          *                                   depending on distance to model center and hierarchy level.
          */
        this.explode = function(scale) {

            if (!_models.length)
                return;

            for (var q=0; q<_models.length; q++) {

                var model = _models[q];

                ModelExploder.explode(model, scale);
            }

            this.invalidateVisibleBounds();

        };

        /** 
         *  @params  {number} timeStamp
         *  @returns {bool}   true if any of the models needs a redraw
         */
        this.update = function(timeStamp) {

            // call update for all RenderModels and track
            // if any of these needs a redraw
            var needsRedraw = false;
            for (var q=0; q<_models.length; q++) {
                var model = _models[q];
                needsRedraw = needsRedraw || model.update(timeStamp);
            }
            return needsRedraw;
        };

        /*
         *  Move model from visible models to hidden models
         *   @param {number} modelId - id of a currently visible model
         *   @returns {bool} true on success
         */
        this.hideModel = function(modelId) {

            // find model in the list of visible ones
            for (var i=0; i<_models.length; i++) {
                var model = _models[i];
                if (model && model.id === modelId) {
                    // move model from visible to hidden models
                    this.removeModel(model);
                    _hiddenModels.push(model);
                    return true;
                }
            }
            // modelID does not refer to any visible model
            return false;
        };

        /*
         * Move previously hidden model to the array of rendered models.
         *  @param {number} modelId - id of a RenderModel in hiddenModels array
         *  @returns {bool} true on success
         */
        this.showModel = function(modelId) {

            // find model in list of hidden models
            for (var i=0; i<_hiddenModels.length; ++i) {
                var model = _hiddenModels[i];
                if (model && model.id === modelId) {
                    // mode model from hidden to visible models
                    this.addModel(model);
                    _hiddenModels.splice(i, 1);
                    return true;
                }
            }
            // modelId does not refer to a hidden model
            return false;
        };
    }
