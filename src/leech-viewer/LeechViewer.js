import LeechViewerRenderContext from './LeechViewerRenderContext';
import { DefaultLightPreset2d, DefaultLightPreset } from "../application/LightPresets";
import ResizeObserver from 'resize-observer-polyfill';

// LeechViewer is a regular viewer, that lets you share resources (Models, Geometries & Materials) with other viewers.
// After rendering a frame, the result gets copied into the LeechViewer's canvas.
const protoCache = new Map();

// In order to support the ability to dynamically decide which ViewerClass to use, I had to wrap the initialization of the LeechViewer prototype in a function.
export function createLeechViewer(container, config, sharedResources, ViewerClass) {
    
    // In order to still share prototypes between different instances of leech viewers, we save the prototype in a cache.
    if (protoCache.has(ViewerClass)) {
        const proto = protoCache.get(ViewerClass);
        return new proto(container, config, sharedResources);
    }

    function LeechViewer(container, config = {}, sharedResources) {
        this.sharedResources = sharedResources;
        this.loadingIntervals = {};
    
        ViewerClass.call(this, container, config);
    
        this.renderContext = new LeechViewerRenderContext(this.canvas);

        this.originalLoadDocumentNode = this.loadDocumentNode.bind(this);

        if (this.sharedResources.mrtFlags) {
            // Needed in order to sync the ID targets usage of the renderer.
            this.renderContext.mrtFlags = this.sharedResources.mrtFlags;
        } else {
            // save mrtFlags for the next leechViewer to use.
            this.sharedResources.mrtFlags = this.renderContext.mrtFlags;
        }

        this.resizeObserver = new ResizeObserver((entries) => {
            const rect = entries[0].contentRect;
            const width = Math.floor(rect.width);
            const height = Math.floor(rect.height);

            // In case someone removed the viewer's container before properly destroyed the viewer.
            // In that case, we have to skip the rendering of that last frame - or we'll get tons of errors.
            if (!width || !height) {
                // Do not consider it as an error. It is not necessarily an error if the client app temporarily
                // hides the viewer canvas without deleting everything each time.
                return;
            }

            this.impl.resize(width, height, true);

            this.dispatchEvent({
                type: Autodesk.Viewing.VIEWER_RESIZE_EVENT,
                width: width,
                height: height
            });

            this.impl.tick(performance.now());
        });

        this.resizeObserver.observe(this.container);
    }
    
    LeechViewer.prototype = Object.create(ViewerClass.prototype);
    LeechViewer.prototype.constructor = LeechViewer;
    
    LeechViewer.prototype.initialize = function (initOptions = {}) {
        const leechViewerInitOptions = {
            glrenderer: this.sharedResources.glrenderer,
            materialManager: this.sharedResources.materialManager,
            renderer: this.renderContext
        };

        const options = Object.assign({}, initOptions, leechViewerInitOptions);
    
        const viewerErrorCode = ViewerClass.prototype.initialize.call(this, options);
    
        this.overrideAPIs();

        if (this.sharedResources.geomCache && this.sharedResources.geomCache.initialized) {
            this.impl.setGeomCache(this.sharedResources.geomCache);
        }
    
        return viewerErrorCode;
    };

    LeechViewer.prototype.uninitialize = function() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        Object.keys(this.loadingIntervals).forEach(key => {
            this.clearLoadingInterval(key);
        });

        ViewerClass.prototype.uninitialize.call(this);
    };

    function generateKey(node, options) {
        let key = node.getModelKey();

        // Add options that can generate different geometry to unique key
        key += '.ref:' + (!!options.applyRefPoint);
    
        const arr = options.globalOffset ? [options.globalOffset.x, options.globalOffset.y, options.globalOffset.z] : [0, 0, 0];
        key += '.g:' + arr.toString();

        if (options.placementTransform) {
            key += '.p:' + options.placementTransform.toArray().toString();
        }

        if (options.customHash) {
            key += '.h:' + options.customHash;
        }

        return key;
    }

    // Override functions that need a special treatment in order to support shared renderer.
    LeechViewer.prototype.overrideAPIs = function() {
        // Before each tick, make sure the viewport is set to the right size.
        const originalTick = this.impl.tick.bind(this.impl);
        this.impl.tick = () => {
            // In rare cases, viewer is being destroyed before it completely being initialized.
            // In these cases, this.impl is null, but the "tick" interval still exists.
            if (!this.impl || !this.impl.glrenderer()) {
                return;
            }

            this.impl.renderer().prepareViewport();
            this.restoreViewerState();
            // we pass the current time instead of the original argument from the tick function, because we want to take into consideration that other
            // viewers worked before this tick, on the same frame.
            const timestamp = performance.now();
            originalTick(timestamp);
            this.impl.renderer().restoreViewport();
        };

        // Only after renderPresented is done, copy the render target into the LeechViewer's canvas.
        // Priority is set to -1000, so in case of other event-listeners that should render to the target too, they'll do that prior to this.
        this.addEventListener(Autodesk.Viewing.RENDER_PRESENTED_EVENT, () => {
            this.renderContext.renderToCanvas();
        }, { priority: -1000 });

        const originalSetLightPreset = this.impl.setLightPreset.bind(this.impl);
        this.impl.setLightPreset = (index, force, callback) => {
            if (this.impl.is2d) {
                // In case of 2d, don't call `setLightPreset`, because it can unload 3D material resources that being used by other viewers.
                // Only set the background according to the light preset.
                this.impl.initLights();
                const bgColor2d = Autodesk.Viewing.Private.LightPresets[index].bgColorGradient;
                this.setBackgroundColor(...bgColor2d);
                this.impl.setCurrentLightPreset(index);
                const cubeMap = this.impl.loadCubeMapFromColors(this.impl.clearColorTop, this.impl.clearColorBottom);
                this.impl.renderer().setCubeMap(cubeMap);
            } else {
                originalSetLightPreset(index, force, callback);
            }
        };

        // Needed in order to restore cutplanes before selecting an object
        const originalInvokeStack = this.toolController.__invokeStack.bind(this.toolController);
        this.toolController.__invokeStack = (...args) => {
            this.restoreViewerState();
            return originalInvokeStack(...args);
        };
    
        // Whenever unloadModel is called for a viewer, we want to make sure that it's resources are not being
        // used by other viewers. In that case, use keepResources flag to prevent disposing them.
        const originalUnloadModel = this.impl.unloadModel.bind(this.impl);
        this.impl.unloadModel = (model, keepResources) => {

            const modelKey = model.leechViewerKey;
    
            let keepResourcesModelItem = false;

            // If model is not in loadedModels, it's a sign that it wasn't loaded, or it wasn't loaded using loadDocumentNode.    
            const modelItem = this.sharedResources.loadedModels[modelKey];

            if (modelItem) {
                modelItem.usedByViewersCounter--;
                keepResourcesModelItem = keepResources  || modelItem.forceKeepResources || modelItem.usedByViewersCounter > 0;
        
                if (!keepResourcesModelItem) {            
                    delete this.sharedResources.loadedModels[modelKey];
                }
            }

            this.clearLoadingInterval(modelKey);

            // use keepResources if provided
            keepResources = keepResources || keepResourcesModelItem;
    
            return originalUnloadModel(model, keepResources);
        };
    
        // When loading a model, make sure to check if it's already loaded by another viewer.
        this.loadDocumentNode = (avDocument, manifestNode, options = {}) => {
            return new Promise((resolve, reject) => {
                const key = generateKey(manifestNode, options);
    
                // Model already loaded
                const modelItem = this.sharedResources.loadedModels[key];

                if (modelItem) {
                    const model = this.onModelLoaded(modelItem.model, options);
                    resolve(model);
                } else {
                    // If model is not loaded yet, load it, and cache it before resolving.
                    this.originalLoadDocumentNode(avDocument, manifestNode, options).then((model) => {
                        model.leechViewerKey = key;
                        this.sharedResources.loadedModels[key] = { model, usedByViewersCounter: 1, loadingViewer: this };
                        resolve(model);
                    }).catch(reject);
                }
            });
        };

        const originalGeomCache = this.impl.geomCache.bind(this.impl);
        this.impl.geomCache = () => {
            if (!this.sharedResources.geomCache || !this.sharedResources.geomCache.initialized) {
                this.sharedResources.geomCache = originalGeomCache();
            }

            return this.sharedResources.geomCache;
        };
    };
    
    LeechViewer.prototype.setViewerProfile = function(model, options) {
        if (options.loadAsHidden) {
            return;
        }
    
        options.isAEC = model.isAEC();
        const profile = this.chooseProfile(options);

        // These settings change the model itself (not only the renderer settings).
        // We delete here so the current model's state won't change.
        delete profile.settings.lineRendering;
        delete profile.settings.pointRendering;

        this.setProfile(profile);
    };

    LeechViewer.prototype.setViewerLight = function(model, options) {
        if (options.loadAsHidden) {
            return;
        }

        // A fix for a case where one viewer has 3D model and on a different viewer a 2D model is loaded.
        // In that case, the materials gets updated with a 2D preset, that makes it appear black.
        if (this.impl.is2d) {
    
            this.impl.setLightPreset(DefaultLightPreset2d);
    
            const clearColorTopBackup = this.impl.clearColorTop.clone().multiplyScalar(255);
            const clearColorBottomBackup = this.impl.clearColorBottom.clone().multiplyScalar(255);
    
            if (options.isAEC) {
                this.impl.setLightPresetForAec();
            } else {
                this.impl.setLightPreset(DefaultLightPreset);
            }
            
            this.impl.toggleEnvMapBackground(false);
    
            this.setBackgroundColor(
                clearColorTopBackup.x, clearColorTopBackup.y, clearColorTopBackup.z,
                clearColorBottomBackup.x, clearColorBottomBackup.y, clearColorBottomBackup.z
            );
        } else {
            this.impl.toggleEnvMapBackground(this.profile.settings.envMapBackground);
        }
    };
    
    LeechViewer.prototype.cleanViewerBeforeLoadModel = function(options) {
        if (!options.keepCurrentModels && this.impl.hasModels()) {
            let _conf = this.config;
            this.tearDown();
            this.setUp(_conf);
        }
    
        // Add spinner for first model
        if (!this.impl.hasModels() && this._loadingSpinner) {
            this._loadingSpinner.show();
        }
    };
    
    const infiniteCutplane = new THREE.Vector4(0, 0, -1, -1e20);
    
    // We can't use matman.setCutPlanes() every frame, because it sets needsUpdate for all the materials, which is super heavy.
    // In order to skip that, we make sure that there is always at least one cutplane available, so materials include NUM_CUTPLANES > 0.
    LeechViewer.prototype.syncCutPlanes = function() {
            const cutplanes = this.impl.getAllCutPlanes() || [infiniteCutplane];
            const materialManager = this.impl.matman();
            
            const maxLength = Math.max(cutplanes.length, materialManager._cutplanes.length);

            // Empty array
            materialManager._cutplanes.length = 0;
    
            let i = 0;

            for (; i < cutplanes.length; i++) {
                materialManager._cutplanes.push(cutplanes[i].clone());
            }

            // Fill cutplanes array according to the largest cutplanes array.
            // This is needed because eventually, inside cutplanes.glsl you don't want to traverse over NUM_CUTPLANES with empty entries.
            for (;i < maxLength; i++) {
                materialManager._cutplanes.push(infiniteCutplane);
            }
    
            materialManager.forEach(mat => {
                if (!mat.doNotCut) {
                    mat.cutplanes = materialManager._cutplanes;
                }
            }, false, true);
    };
    
    LeechViewer.prototype.restoreViewerState = function() {
        if (this.sharedResources.lastRenderedViewer !== this) {
            // Update cutplanes according to the current viewer.
            this.syncCutPlanes();
    
            // Needed for updated resolution for 2D shaders.
            if (this.impl.is2d) {
                this.impl.updateCameraMatrices();
            }
    
            // Finally, update last viewer that got rendered.
            this.sharedResources.lastRenderedViewer = this;
        }
    };
    
    LeechViewer.prototype.onModelLoaded = function (model, options) {
        const key = model.leechViewerKey;

        // forceKeepResources is being used here to make sure that while we cleanup the viewer,
        // and unload the same model that we just want to clone - we'll keep its resources.
        this.sharedResources.loadedModels[key].forceKeepResources = true;

        this.cleanViewerBeforeLoadModel(options);
        const modelClone = this.cloneModelToViewer(model);
        this.addModelToViewer(modelClone, options);

        delete this.sharedResources.loadedModels[key].forceKeepResources;
    
        return modelClone;
    };
    
    LeechViewer.prototype.addModelToViewer = function(model, options) {
        this.impl.modelQueue().addHiddenModel(model);
    
        if (!options.loadAsHidden) {
            this.setViewerProfile(model, options);
            this.showModel(model);
            this.setViewerLight(model, options);
    
            if (!options.headlessViewer && this.createUI) {
                this.createUI(model);
            }
        }
    
        if (this._loadingSpinner) {
            this._loadingSpinner.hide();
        }

    };

    LeechViewer.prototype.clearLoadingInterval = function (key) {
        if (this.loadingIntervals[key]) {
            clearInterval(this.loadingIntervals[key]);
            delete this.loadingIntervals[key];
        }
    };

    // Returns true if all pending loading is finished. More concrete, it means that there is no...
    //  - model-root loading
    //  - geometry loading, or
    //  - propDbLoading
    // pending or in progress.
    function isModelLoadDone(model) {
        const modelRootPending = !model;
        const geomPending      =  model && !model.isLoadDone();
        const propDbPending    =  model &&  model.getPropertyDb() && !model.getPropertyDb().isLoadDone();

        if (modelRootPending || geomPending || propDbPending) {
            return false;
        }

        return true;
    }

    // Returns a promise that resolves when isLoadDone() returns true.
    function waitForLoadDone(viewer, model) {
        return new Promise((resolve) => {

            if (isModelLoadDone(model)) {
                resolve();
            }

            // On each load-relevant event, check if loading is finished.
            const onEvent = () => {
                if (!isModelLoadDone(model)) {
                    return;
                }

                viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onEvent);
                viewer.removeEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onEvent);

                resolve();
            };

            // register event listeners to try again if something changes
            viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onEvent);
            viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onEvent);
        });
    }
    
    LeechViewer.prototype.cloneModelToViewer = function (model) {
        // model.clone() returns a shallow copy of the model instance. All the internal state is shared between the models.
        // The reason we can't use the exact same instance, and we have to clone it, is because of VisibilityManager & Selector.
        // When a model is added to a viewer, the specific viewer instance is being used inside the selector, and
        // every model can have a single Selector & VisibilityManager.
        const modelClone = model.clone();

        const key = model.leechViewerKey;
        modelClone.leechViewerKey = key;
        
        const modelItem = this.sharedResources.loadedModels[key];
        modelItem.usedByViewersCounter++;
        const loadingViewer = modelItem.loadingViewer;
    
        // Until loading is done, keep refreshing the viewer, in order to mimic the invalidation inside the loaders.
        // A better way to do that would be to dispatch an event on the loading viewer's `processReceivedMesh`.
        this.clearLoadingInterval(key);

        this.loadingIntervals[key] = setInterval(() => {
            this.impl.invalidate(false, true, false);
        }, 1000);

        waitForLoadDone(loadingViewer, modelClone).then(() => {
            this.clearLoadingInterval(key);

            // onLoadComplete should be called after viewer.impl.addModel is called.
            // The reason is that viewer.impl.is2d is being set only there.
            // This timeout ensures it, and prevents a bug where 2D selection doesn't work (init2dSelection wasn't called because of that timing issue).
            // onLoadComplete is an async method anyway - so there is no risk in delaying it like that.
            setTimeout(() => {
                // Need to re-sync because of consolidationIterator is being set only when model loading is done.
                // Also, verify that idRemap is being updated and fully synced after.
                modelClone.setInnerAttributes(model.getInnerAttributes());
                this.impl.onLoadComplete(modelClone);
            }, 1);
        });

        return modelClone;
    };

    protoCache.set(ViewerClass, LeechViewer);

    return new LeechViewer(container, config, sharedResources, ViewerClass);
}
