import { PIXEL_CULLING_THRESHOLD } from "../wgs/globals.js";
import { FrustumIntersector } from '../wgs/scene/FrustumIntersector';
import { RenderContext } from "../wgs/render/RenderContext";
import { getGlobal } from "../compat";
import { RenderBatch } from "../wgs/scene/RenderBatch";
import { MeshFlags } from "../wgs/scene/MeshFlags";
import { SceneMath } from "../wgs/scene/SceneMath";
import { RenderFlags } from "../wgs/scene/RenderFlags";
import * as THREE from "three";
import * as et from "./EventTypes";
import SheetRenderContext from "../wgs/render/SheetRenderContext";

//Old screenshot function that is stil the public Viewer3D.getScreenShot API.
//It resizes the HTML canvas element and captures that.
// we use Blob URL, Chrome crashes when opening dataURL that is too large
// https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL
function getScreenShotLegacy(viewer, w, h, cb, overlayRenderer) {
    var viewerImpl = viewer.impl;
    var renderer = viewerImpl.renderer();
    var oldWidth = renderer.settings.logicalWidth;
    var oldHeight = renderer.settings.logicalHeight;
    var oldProgressiveRender = viewerImpl.progressiveRender;
    var pixelRatio = viewerImpl.glrenderer().getPixelRatio();

    if (!w || !h) {
        w = oldWidth;
        h = oldHeight;
    }

    viewerImpl.progressiveRender = false;

    // Render the scene with new size
    viewerImpl.resize(w / pixelRatio, h / pixelRatio, true);

    viewerImpl.tick(performance.now());
    // Use an offscreen target to render the overlays
    let format = THREE.RGBAFormat;
                                   
    {
      format = THREE.RGBFormat;
    }
              
    var finalTarget = new THREE.WebGLRenderTarget(w, h,
        {   minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format,
            type: THREE.UnsignedByteType
        });
    
    const offscreenTargetBackup = renderer.getOffscreenTarget();
    renderer.setOffscreenTarget(finalTarget);
    // Rebuild the final output into the offscreen buffer.
    renderer.presentBuffer();
    // Turn off offscreen target
    renderer.setOffscreenTarget(offscreenTargetBackup);

    function renderToCanvas() {

        var res = renderer.targetToCanvas(finalTarget || renderer.getColorTarget());
        // Dispose of the offscreen target, if there is one
        if (finalTarget) {
            finalTarget.dispose();
            finalTarget = undefined;

            // Make sure that we don't leave a deleted target assigned in WebGLRenderer.
            // This avoids a WebGL warning "WebGL: INVALID_OPERATION: bindFramebuffer: attempt to use a deleted object"
            // in WebGlRenderer.initFrameBuffer later. Note that this warning would happen even if no one actually renders to this target.
            viewerImpl.glrenderer().setRenderTarget(null);
        }

        function finalizeRender() {
            // Resize the render context back the original size
            viewerImpl.progressiveRender = oldProgressiveRender;
            viewerImpl.resize(oldWidth, oldHeight, true);

            res.canvas.toBlob(function(blob) {
                var newBlobURL = getGlobal().URL.createObjectURL(blob);
                if (cb) {
                    cb(newBlobURL);
                } else {
                    getGlobal().open(newBlobURL);
                }
            }, 'image/png');
        }

        if (overlayRenderer) {
            overlayRenderer(res.ctx, finalizeRender);
        } else {
            finalizeRender();
        }
    }

    // In case the model is leaflet, we should wait until all the tiles will be downloaded in the new scale.
    // Otherwise, the screenshot will be pixelated.
    if (viewer.model.isLeaflet()) {

        var cancelLeafletScreenshot = false;

        const cancelCB = function cancelCB() {
            cancelLeafletScreenshot = true;
            viewerImpl.progressiveRender = oldProgressiveRender;
            viewerImpl.resize(oldWidth, oldHeight, true);
             // Dispose of the offscreen target, if there is one
            if (finalTarget)
                finalTarget.dispose();
        };

        viewer.addEventListener(et.CANCEL_LEAFLET_SCREENSHOT, cancelCB, { once: true });

        // invalidate is needed here in order to make sure that the iterator's reset method will be called.
        viewerImpl.invalidate(true);
        viewer.model.getIterator().callWhenRefined(function() {
            if (!cancelLeafletScreenshot) {
                viewer.removeEventListener(et.CANCEL_LEAFLET_SCREENSHOT, cancelCB);
                renderToCanvas();
            }
        });
    } else {
        renderToCanvas();
    }
}


// Creates a blob containing a snapshot and passes result to onFinished.
// It runs in the background parallel to main rendering.
// 
//  @param {function(result)} onFinished - Gets the blob with the result image. If options.returnAsTarget is true, 
//                                         it is called with (renderContext, renderTarget, camera, sheetRenderer) instead.
//  @param {UnifiedCamera}    [options.camera]       - If undefined, we use a copy of the current main camera
//  @param {function(number)} [options.onProgress]   - progress callback. Gets progress value as integer
//  @param {RenderContext}    [options.renderContext]- optional render context to use for the screenshot rendering
//  @param {SheetRenderContext}[options.sheetRenderer]- optional sheet render context to use for screenshot rendering
//  @param {Object}           [options.renderConfig] - custom RenderContext configuration (by default, we use the config of the main renderer)
//  @param {function()}       [options.beforeRender] - triggered before rendering into the screenshot. This allows to apply temporary changes 
//                                                     (e.g. on materials) that would affect main rendering otherwise.
//  @param {function()}       [options.afterRender]  - triggered after rendering into snapshot. Use this to revert/cleanup any changes done in beforeRender.
//  @param {av.Model[]}       [options.models]       - Array of RenderModels to appear in the screenshot. (Default: all currently visible ones)
//  @param {Object}           [options.fragOptions]  - By default, visibility and ghosting of fragments are 1:1 inherited from main viewer.
//                                                     Optionally, fragOptions allow for customizing fragment states, e.g. to force everything to be visible.
//                                                     Return undefined to preserve original fragment state. Available options:
//                                                         fragOptions.isFragVisible: see FragmentList.setVisibility {function(fragId)=>bool}
//                                                         fragOptions.isFragOff:     see FragmentList.setFragOff    {function(fragId)=>bool} 
//  @param {boolean}            [options.excludeCutPlanes] - By default, cutplanes are inherited from main view. This flag makes the screenshot independent
//                                                         of any active cutplanes.
//  @param {boolean}            [options.excludeThemingColors] - By default (false), theming colors are inherited from main view. 
//                                                             Note: This option only supports 3D so far.
//  @param {boolean}            [options.is2d]             - By default, we decide dimensionality from main viewer.
//  @param {boolean}            [options.dontWaitForLeafletTiles] - By default, we wait until all the leaflet tiles are being fully loaded before we complete the render.
//                                                                If set to true, we just use the low res tiles if the high res tiles don't exist yet.
//  @param {Viewer3DImpl}     viewerImpl             - main viewer instance - to get glRenderer, material manager, default models etc.
//  @returns {Object} Control object C: Use...
//                    - C.stop() to cancel computation
//                    - C.finished() to check if it's done
//
// Known limitations:
//  - Rendering overlays is currently not supported.
//  - When using custom render settings: AO can only be used if the main canvas uses it as well. This is because materials are shared and must be compiled differently based 
//                                       whether a depth target is used (as for AO)
const getScreenShot = (w, h, onFinished, options, viewerImpl) => {

    let materials     = viewerImpl.getMaterials();
    let webglrenderer = viewerImpl.glrenderer();
    let renderer      = viewerImpl.renderer();
    let modelQueue    = viewerImpl.modelQueue();

    options = options || {};

    // get scenes
    let scenes = [];
    let models = options.models || modelQueue.getModels();

    for (let i=0; i<models.length; i++) {
        let model = models[i];
        let iter = model.getIterator();

        // skip models that don't support getGeomScenes (e.g. leaflets)
        // Leaflet scenes are handled separately below.
        if (!iter || !iter.getGeomScenes) {
            continue;
        }

        // Collect all scenes from next model
        let modelScenes = iter.getGeomScenes();
        for (let j=0; j<modelScenes.length; j++) {
            // Some scenes may not exist. E.g., if it corresponds to an empty BVH node.
            let scene = modelScenes[j];
            if (scene) {
                scenes.push(scene);
            }
        }
    }

    let camera = options.camera || viewerImpl.camera;

    // Make sure that we never use the same camera object as the main canvas. Otherwise, tools may modify the camera and affect the
    // screenshot during rendering.
    if (camera === viewerImpl.camera) {
        camera = camera.clone();
    }

    // Make sure all matrices are updated.
    if (camera.isUnifiedCamera) {
        camera.updateCameraMatrices();
    }

    // Make sure the camera client width/height is set according to screenshot custom size
    camera.clientWidth = w;
    camera.clientHeight = h;

    // Screenshots may contain objects that are culled in the main canvas.
    // Therefore, we need this apply correct culling for RenderBatches.
    let frustum   = new FrustumIntersector();
    let cutplanes = options.excludeCutPlanes ? [] : materials.getCutPlanes();
    frustum.reset(camera, cutplanes);
    frustum.areaCullThreshold = PIXEL_CULLING_THRESHOLD;

    // We share WebGLRenderer with main rendering 
    // => Make sure that viewport keeps unaffected.
    webglrenderer.pushViewport();

    // Preserve pixelRatio based on browser device pixel size.
    // For offline rendering, we use 1:1 to get exactly the desired resolution.
    webglrenderer.setPixelRatio(1.0);

    let ctx;

    // create temp RenderContext
    if (options.renderContext) {
        ctx = options.renderContext;
    } else {
        ctx = new RenderContext();
        ctx.init(webglrenderer, w, h, { offscreen: true });
    }

    let sheetRenderer;
    if (viewerImpl.isSheetRendererNeeded()) {
        if (options.sheetRenderer) {
            sheetRenderer = options.sheetRenderer;
        } else {
            sheetRenderer = new SheetRenderContext(viewerImpl, ctx, webglrenderer, materials);
        }
    }

    // Make sure that cutplanes are consistently applied to override materials of our new RenderContext.
    // Note: We are replacing these override materials on each screenshot call. This will not work anymore 
    //       if anyone runs multiple screenshots in parallel (which would work otherwise).
    //       For this, we would need to use unique ids here and always clean-up the materials afterwards.
    materials.addOverrideMaterial("normalsMaterial_screenshot", ctx.getDepthMaterial());
    materials.addOverrideMaterial("edgeMaterial_screenshot",    ctx.getEdgeMaterial());

    // by default, configure RenderContext in the same way as for main rendering (edges, cubemap etc.)
    let cfg = options.renderConfig || renderer.getConfig();
    ctx.applyConfig(cfg);
    
    // Render scenes
    ctx.beginScene(viewerImpl.scene, camera, viewerImpl.noLights, true);
 
    webglrenderer.popViewport();

    // recover original pixel ratio
    webglrenderer.setPixelRatio();

    let MaxTimePerCycle = 20; // Time in ms that we allow per cycle
    let sceneIndex = 0;       // Next scene to be rendered
    
    // Allow safe interruptions from outside
    let reqId = undefined;
    let control = {
        stop:     () => {
            if (!reqId) {
                return;
            }
            // cancel timeout
            getGlobal().clearTimeout(reqId);

            // if there are leaflets, tell them that there is no need anymore to
            // refine them for the screenshot.
            releaseLeafLetViews();
        },
        finished: () => !!reqId
    };

    let lastProgress = -1;

    // Leaflets: Register separate views to make sure that the tiles are loaded without affecting the main view
    let leaflets = [];
    for (let i=0; i<models.length; i++) {
        let model = models[i];
        if (model.isLeaflet()) {
            let iter = model.getIterator();
            leaflets.push({
                iter: iter,
                viewId: iter.registerView(),
                ready: false // fully refined and ready for rendering
            });
        }
    }

    // Continue refinement of leaflets for this screenshot. Returns true when done.
    const continueLeafletRefine = () => {
        let allReady = true;
        for (let i=0; i<leaflets.length; i++) {
            let leaflet = leaflets[i];
            if (!leaflet.ready) {
                leaflet.ready = leaflet.iter.reset(frustum, camera, leaflet.viewId);
            }
            allReady = allReady && leaflet.ready;
        }
        
        allReady = allReady || options.dontWaitForLeafletTiles;

        // Once leaflets are ready, collect the scenes to be rendered
        if (allReady) {
            for (let i=0; i<leaflets.length; i++) {
                let leaflet = leaflets[i];
                let scene   = leaflet.iter.getScene(leaflet.viewId);
                scenes.push(scene);
            }
        }

        // When done, collect 
        return allReady;
    };

    // When leaflet rendering is done, unregister view so that the leaflet iterator
    // knows that the tiles are allowed to be deleted in cache cleanups later.
    const releaseLeafLetViews = () => {
        // Release tiles needs for leaflets
        leaflets.forEach(l=>l.iter.unregisterView(l.viewId));
        leaflets.length = 0;
    };

    // Used to remember fragment states per scene if we use overrides
    let fragOptions = options.fragOptions;
    let visFlags = fragOptions ? [] : undefined;
    
    // Optional: Remember fragment states and overwrite with custom ones
    const applyFragmentOverrides = (scene) => {

        // Note: Since we work on unconsolidated geometry, we assume here that Fragments are 
        //       always rendered using RenderBatches. Without that, things would get a bit more
        //       complicated here.
        let useOverrides = !!fragOptions && (scene instanceof RenderBatch);
        if (!useOverrides) {
            return;
        }

        let fragList = scene.frags;
        let overrideFragState = function(fragId, index) {
            
            // remember original fragment flags per scene
            visFlags[index] = fragList.vizflags[fragId];
            
            // We set the flags directly here without affecting allVisibleDirty,
            // because we recover the orginal state before returning to main render.
            
            // Customize isFragOff flag
            let isOff = fragOptions.isFragOff && fragOptions.isFragOff(fragId);
            if (isOff !== undefined) {
                fragList.setFlagFragment(fragId, MeshFlags.MESH_HIDE, isOff);
            }
            
            // Customize isVisible
            let isVisible = fragOptions.isFragVisible && fragOptions.isFragVisible(fragId);
            if (isVisible !== undefined) {
                fragList.setFlagFragment(fragId, MeshFlags.MESH_VISIBLE, isVisible);
            }
        };
        scene.forEachNoMesh(overrideFragState);
    };

    // Restore original state for all fragments of a RenderBatch
    const revertFragmentOverrides = (scene) => {

        let useOverrides = !!fragOptions && (scene instanceof RenderBatch);
        if (!useOverrides) {
            return;
        }

        let fragList = scene.frags;
        let recoverFragState = function(fragId, index) {
            let flags      = visFlags[index];
            let wasOff     = !!(flags & MeshFlags.MESH_HIDE);
            let wasVisible = !!(flags & MeshFlags.MESH_VISIBLE);
            
            fragList.setFlagFragment(fragId, MeshFlags.MESH_HIDE, wasOff);
            fragList.setFlagFragment(fragId, MeshFlags.MESH_VISIBLE, wasVisible);
        };
        scene.forEachNoMesh(recoverFragState);
    };

    // Determine pixelPerUnit parameter for this screenshot
    const getPixelsPerUnitValue = () => {

        // Get bounds from viewer - unless we have custom models
        let worldBox = undefined;
        if (!options.models) {
            worldBox = viewerImpl.getVisibleBounds();
        } else {
            // If we have custom models, we use the summed model bounds.
            // Note: Strictly speaking, we would need to consider individual fragment visibility/overrides here too.
            //       But this would make things even more complicated here and only might make a difference in edge cases.
            worldBox = new THREE.Box3();
            for (let i=0; i<models.length; i++) {
                let model = models[i];
                worldBox.union(model.getBoundingBox());
            }
        }

        // initialized after ctx.beginScene() - which also sets up the render targets on first call.
        let is2d = Object.prototype.hasOwnProperty.call(options, 'is2d') ? options.is2d : viewerImpl.is2d;

        // It is important that we call it after ctx.beginScene(), so that these values are initialized.
        let deviceHeight = ctx.settings.deviceHeight;

        // Consider cutplane if wanted
        let cutPlanes = options.excludeCutPlanes ? undefined : materials.getCutPlanesRaw();
        let cutPlane  = cutPlanes && cutPlanes[0];

        // For 2d: If we have a sheet model box, its base elevation is considered as reference plane for 2d rendering.
        let modelBox = models[0] && models[0].getBoundingBox();

        // Note that getPixelsPerUnit() uses the _deviceHeight of the RenderContext. This value is only
        return SceneMath.getPixelsPerUnit(camera, is2d, worldBox, deviceHeight, cutPlane, modelBox);
    };
    const pixelsPerUnit = getPixelsPerUnitValue();

    // Decouple theming from main rendering
    let EmptyThemingColors = [];   // temporarily used empty theming-color table
    let themingColors      = null; // temporarily used to backup original theming colors
    const disableThemingColors = (scene) => {
        
        if (!options.excludeThemingColors || !(scene instanceof RenderBatch)) {
            return;
        }

        // This option is only supported for 3d atm. For 2d, we would need some
        // extra work because theming-colors are stored per vertex.
        if (scene.frags.is2d) {
            return;
        }

        themingColors = scene.frags.db2ThemingColor;
        scene.frags.db2ThemingColor = EmptyThemingColors;
    };
    const restoreThemingColors = (scene) => {
        if (!themingColors) {
            return;
        }
        scene.frags.db2ThemingColor = themingColors;
        themingColors = null;
    };

    // Note: Changing the number of cutplanes on each render cycle would trigger repeated shader recompiles (see MaterialManager.setCutPlanes)
    //       Changing the cutplane values is much cheaper and just changes a shader param.
    //       => To temporarily nuke a cutplane, we just change it to only exclude shapes in outer space
    let dummyCutPlane = new THREE.Vector4(0, 0, -1, -1e+20);
    let dummyCutPlanes = [];
    let originalCutPlanes = null;

    const disableCutPlanes = () => {
        // Note that the cutplanes in main view may change at any time.
        // So we have to get them again when an update cycle starts.
        originalCutPlanes = materials.getCutPlanes();
    
        // make sure that dummyCutPlanes has the same length
        let planeCount = originalCutPlanes.length;
        if (dummyCutPlanes.length !== planeCount) {
            dummyCutPlanes.length = planeCount;
            for (let i=0; i<planeCount; i++) {
                dummyCutPlanes[i] = dummyCutPlane;
            }
        }
        renderer.toggleTwoSided(materials.setCutPlanes(dummyCutPlanes));
    };

    const recoverCutPlanes = () => {
        renderer.toggleTwoSided(materials.setCutPlanes(originalCutPlanes));
    };
    
    const onRenderDone = () => {

        releaseLeafLetViews();

        // In the simplest case, we can just read-back the color-target directly.
        let finalTarget = ctx.getColorTarget();

        // If we need post-processing (SAO/FXAA), we must run presentBuffer to
        // render into an offscreen target.
        let needsPostProcess = (cfg.aoEnabled || cfg.antialias);
        if (needsPostProcess) {
                    
            if (cfg.aoEnabled) {
                ctx.computeSSAO();
            }

            // Note: We don't render overlays in screenshots. So, we can simply use 
            //       the overlay target for final present. If you want to add overlay support
            //       as well, you either have to allocate a new target or things get a bit more complicated:
            //       The target to use leties with configuration and you have to choose one
            //       that a) exists and b) is not used as src in the final pass.
            finalTarget = ctx.getNamedTarget('overlay');

            // Make sure that blend pass doesn't read from overlay target while writing to it.
            ctx.getBlendPass().uniforms[ 'tOverlay' ].value = null;

            ctx.setOffscreenTarget(finalTarget);
            ctx.presentBuffer();
        }
        
        if (options.returnAsTarget) {
            onFinished(ctx, finalTarget, camera, sheetRenderer);
            return;
        }

        if (!options.sheetRenderer) { // Destroy only if it was created (and it's not being returned)
            sheetRenderer?.destroy();
            sheetRenderer = null;
        }
        
        // read result into blob
        let res = ctx.targetToCanvas(finalTarget);
        res.canvas.toBlob(function(blob) {
            let newBlobURL = getGlobal().URL.createObjectURL(blob);
            if (onFinished) {
                onFinished(newBlobURL);
            }
        });
    };

    const continueRender = () => {

        // Leaflets may need to be refined first
        let waitForLeaflets = !continueLeafletRefine();
        if (waitForLeaflets) {
            reqId = getGlobal().setTimeout(continueRender, 0);
            return;
        }
        
        // Render scenes until time is up or all scenes are done
        let tStart = performance.now();

        webglrenderer.pushViewport();
        
        // Preserve pixelRatio based on browser device pixel size.
        // For offline rendering, we use 1:1 to get exactly the desired resolution.
        webglrenderer.setPixelRatio(1.0);

        // Please note that pixelratio is also used to define the viewport.
        webglrenderer.setViewport(0, 0, w, h);

        let pixelsPerUnitBackup = viewerImpl.getPixelsPerUnit(viewerImpl.camera, viewerImpl.getVisibleBounds());
        materials.updatePixelScale(pixelsPerUnit, w, h, camera);

        // Disable cutplanes if not wanted in the screenshot
        if (options.excludeCutPlanes) {
            disableCutPlanes();
        } else {
            // In case that LeechViewer is being used, and the target models are being shared between viewers with different section state,
            // there might be scenarios where the cut planes inside the materials are not synced with the current viewer state (See LeechViewer.restoreViewerState).
            // By calling syncCutPlanes, it makes sure that the current cutplanes inside the materials are the correct ones for the active viewer.
            viewerImpl.api.syncCutPlanes?.();
        }

        // Allow client to do custom modifcations without affecting main rendering
        options.beforeRender && options.beforeRender();

        while (sceneIndex < scenes.length) {
            let scene = scenes[sceneIndex];

            // Find the current model that we are going to render.
            const model = models.find(m => m.id === scene.frags?.modelId);

            if (model?.is2d()) {
                const transform = model.getModelToViewerTransform();
                const scaling = transform ? transform.getMaxScaleOnAxis() : 1;

                // Set pixelsPerUnit according to each sheet in 3D space. In general, it is set according to the modelQueue's bounds
                // which is not related to how we want to present the sheet (i.e. the line thickness will vary when selecting a
                // floor as a result, because of the changing viewing volume)
                // Note: Previously this was done only when in 3D mode, but it's also needed in 2D in case a transform with
                // scaling is set.
                if (!viewerImpl.is2d || scaling !== 1) {
                    const bounds = model.getVisibleBounds();
                    const deviceWidth = ctx.settings.deviceWidth;
                    const deviceHeight = ctx.settings.deviceHeight;
                    // Sending is2d:true here because we want the calculation path done for 2D sheets
                    const pixelsPerUnit = SceneMath.getPixelsPerUnit(camera, true, bounds, deviceHeight, null, bounds);

                    materials.updatePixelScaleForModel(model, pixelsPerUnit, deviceWidth, deviceHeight, scaling, camera);
                }
            }

            // If specified, apply custom values for fragment states (ghosting, fragOff)
            // Note that these flags are not evaluated in renderScenePart, but earlier
            // in applyVisibility() already.
            applyFragmentOverrides(scene);

            disableThemingColors(scene);
            // Make sure that culling is applied based on screenshot camera. Without this code, some parts would be
            // missing if they are currently not visible in the main canvas.
            if (scene instanceof RenderBatch) {
                scene.applyVisibility(RenderFlags.RENDER_NORMAL, frustum);
            }

            if (sheetRenderer && scene.frags.is2d) {
                sheetRenderer.renderScenePart(scene, true, true, false, ctx);
            } else {
                ctx.renderScenePart(scene, true, true, false, false);

                // Render ghosted objects.
                if ((scene.frags && !scene.frags.areAllVisible() && viewerImpl.showGhosting) || fragOptions) {
                    if (scene instanceof RenderBatch) {
                        scene.applyVisibility(RenderFlags.RENDER_HIDDEN, frustum);
                    }

                    // Configure for ghosting
                    renderer.setEdgeColor(viewerImpl.edgeColorGhosted);
                    scene.overrideMaterial = viewerImpl.fadeMaterial;

                    ctx.renderScenePart(scene, true, true, false, false);

                    // Restore edge color and reset override material
                    renderer.setEdgeColor(viewerImpl.edgeColorMain);
                    scene.overrideMaterial = null;
                }
            }

            restoreThemingColors(scene);

            revertFragmentOverrides(scene);

            sceneIndex++;

            // stop loop if time is up
            let elapsed = performance.now() - tStart;
            if (elapsed > MaxTimePerCycle) {
                break;
            }
        }
        webglrenderer.popViewport();

        // recover original pixel ratio
        webglrenderer.setPixelRatio();

        materials.updatePixelScale(pixelsPerUnitBackup, renderer.settings.deviceWidth, renderer.settings.deviceHeight, camera);

        // Recover cutplanes for main view rendering
        if (options.excludeCutPlanes) {
            recoverCutPlanes();
        }

        // Allow client to remove custom modifications before main canvas renders again
        options.afterRender && options.afterRender();

        // If we are done...
        if (sceneIndex === scenes.length) {
            // ...start image readback
            onRenderDone();
        } else {
            // Otherwise, let a bit time for main rendering and continue later.
            reqId = getGlobal().setTimeout(continueRender, 0);
        }

        // track progress
        if (options.onProgress) {
            let percent = Math.floor(100 * sceneIndex / scenes.length);
            if (percent !== lastProgress) {
                lastProgress = percent;
                options.onProgress(percent);
            }
        }
    };

    continueRender();

    return control;
};

/**
 * Creates a screenshot of the viewer, with extra parameters to enable more control.
 * Common uses are for creating screenshot with an overlay, specific bounds and crop.
 * The output image returns as blob, inside onDone callback.
 * 
 * @param {Viewer3D} [viewer] - Viewer instance
 * @param {Number} [width] - Width of the screenshot, before cropping.
 * @param {Number} [height] - Height of the screenshot, before cropping.
 * @param {Function} [onDone] - A callback called when the screenshot is ready. Signature: onDone(blobUrl, outputWidth, outputHeight);
 * @param {Object} [options] - Additional initialization options. Not mandatory.
 * @param {Boolean} [options.fullPage] - For 2D documents only. Output will be a cropped image of the viewer, without the grey background.
 * @param {THREE.Box3} [options.bounds] - Bounds in world coordinates of the screenshot. The virtual camera of the screenshot will zoom in to these bounds.
 * @param {Function} [options.getCropBounds] - A callback used to get crop bounds of the image. Signature: getCropBounds(viewer, camera, bounds).
 * @param {Number} [options.margin] - Extra margin over the bounds.
 * @param {Function} [options.overlayRenderer] - a callback used to render an overlay on top of the viewer. Signature: overlayRenderer(viewer, opt, overlayRendererExtraOptions)
 * @param {Object} [options.overlayRendererExtraOptions] - Extra options object used only by the overlayRenderer.
 *
 * @private
 */
const getScreenShotWithBounds = (viewer, width, height, onDone, options) => {
    var {
        fullPage, bounds, getCropBounds, margin, overlayRenderer, overlayRendererExtraOptions
    } = options;

    if (fullPage) {
        bounds = viewer.impl.getVisibleBounds();
    }

    const canvasBounds = viewer.impl.getCanvasBoundingClientRect();
    const originalWidth = canvasBounds.width;

    let camera = viewer.navigation.getCamera();

    if (bounds) {
        camera = getCameraWithFitBounds(viewer, bounds, margin);
    }

    const sceneBounds = getSceneClientBounds(viewer, camera);

    try {
        // Scale the viewer so the full render width won't contain the gray canvas layout.
        if (fullPage) {
            const sceneBoundsSize = sceneBounds.getSize(new THREE.Vector3());
            const ratio = originalWidth / Math.max(sceneBoundsSize.x, sceneBoundsSize.y);
            width = Math.floor(width * ratio);
            height = Math.floor(height * ratio);
        }

        // This callback is used for cropping the image.
        const cropScreenshot = (canvas) => {
            // In case of a 2D full page, crop the view so the image will be without the gray margin.
            if (fullPage) {
                const scaleRatio = width / originalWidth;

                sceneBounds.min.x *= scaleRatio;
                sceneBounds.min.y *= scaleRatio;
                sceneBounds.max.x *= scaleRatio;
                sceneBounds.max.y *= scaleRatio;

                cropImage(canvas, sceneBounds, onDone);
            // Crop to a specific bounding box
            } else if (getCropBounds) {
                const clientBounds = getCropBounds(viewer, camera, bounds);
                cropImage(canvas, clientBounds, onDone);
            // Don't crop anything, just call onDone
            } else {
                canvas.toBlob((blob) => {
                    const blobUrl = getGlobal().URL.createObjectURL(blob);
                    onDone(blobUrl, width, height);
                });
            }
        };

        // Deselect everything before taking the screenshot.
        const selected = viewer.impl.selector.getSelection();
        viewer.clearSelection();

        return getScreenShot(width, height, (ctx, target, screenshotCamera) => {
            viewer.impl.selector.setSelection(selected);

            if (overlayRenderer) {
                const opt = {
                    width,
                    height,
                    ctx,
                    target,
                    screenshotCamera,
                    onRenderDone: cropScreenshot
                };
                overlayRenderer(viewer, opt, overlayRendererExtraOptions);
            } else {
                const { canvas } = ctx.targetToCanvas(target);
                cropScreenshot(canvas);
            }
        }, { returnAsTarget: true, camera }, viewer.impl);
    } catch (error) {
        console.error('getScreenShot error: ' + error);
        onDone(null);
    }
};

/**
 * Creates a screenshot of the viewer, in original screen resolution.
 * Common uses are for creating thumbnails.
 * The output image returns as base64 image, inside callback.
 * 
 * @param {Viewer3D} [viewer] - Viewer instance
 * @param {Function} [callback] - A callback called when the screenshot is ready. Signature: callback(base64Image);
 * @param {Object} [options] - Optional - Additional initialization options. See getScreenShot Documentation for more details.
 * 
 * @private
 */
const getScreenShotAtScreenSize = (viewer, callback, options) => {
    const canvasBounds = viewer.impl.getCanvasBoundingClientRect();
    const width = Math.floor(canvasBounds.width);
    const height = Math.floor(canvasBounds.height);

    const onDone = (blob, outputWidth, outputHeight) => {
        if (!blob) {
            callback(null);
            return;
        }

        blobToImage(blob, outputWidth, outputHeight, (img) => {
            callback(img, outputWidth, outputHeight);
        });
    };

    getScreenShotWithBounds(viewer, width, height, onDone, options);
};

/**
 * Returns the scene's client bounding box. In case of F2D, it will return the bounds without the gray area.
 * @private
 */
const getSceneClientBounds = (viewer, camera) => {
    const worldBounds = viewer.impl.getVisibleBounds(undefined, undefined, undefined, true); // exclude shadows

    const min = viewer.worldToClient(worldBounds.min, camera);
    const max = viewer.worldToClient(worldBounds.max, camera);

    const bbox = new THREE.Box3().setFromPoints([min, max]);

    return bbox;
};

// Crops an image according to given bounds.
// Output as blobUrl.
const cropImage = (canvas, bounds, callback) => {
    const _document = getGlobal().document;
    const tmpCanvas = _document.createElement('canvas');
    const tmpCtx = tmpCanvas.getContext('2d');
    const size = bounds.getSize(new THREE.Vector3());
    const imageWidth = Math.min(Math.floor(size.x), canvas.width);
    const imageHeight = Math.min(Math.floor(size.y), canvas.height);
    tmpCanvas.width = imageWidth;
    tmpCanvas.height = imageHeight;

    const cropFromX = Math.max(Math.floor(bounds.min.x), 0);
    const cropFromY = Math.max(Math.floor(bounds.min.y), 0);
    const cropToX = imageWidth;
    const cropToY = imageHeight;
    tmpCtx.drawImage(canvas, cropFromX, cropFromY, cropToX, cropToY, 0, 0, imageWidth, imageHeight);

    tmpCanvas.toBlob((blob) => {
        var newBlobURL = getGlobal().URL.createObjectURL(blob);
        callback(newBlobURL, imageWidth, imageHeight);
    }, 'image/png');
};

// Converts blobUrl to base64 image.
const blobToImage = (blobUrl, width, height, callback) => {
    const _document = getGlobal().document;
    const tmpCanvas = _document.createElement('canvas');
    const tmpCtx = tmpCanvas.getContext('2d');
    const img = new Image();

    tmpCanvas.width = width;
    tmpCanvas.height = height;
    img.src = blobUrl;

    img.onload = function () {
        tmpCtx.drawImage(img, 0, 0, width, height);
        const outputImg = tmpCanvas.toDataURL('image/png');
        callback(outputImg);
    };
};

// Converts given bounds object to square bounds.
const makeBoundsSquare = (bounds, minValue = 0) => {
    const size = bounds.getSize(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, minValue);
    bounds.expandByVector(new THREE.Vector3((maxSize - size.x) / 2, (maxSize - size.y) / 2, 0));
};

// Get camera with fit bounds.
const getCameraWithFitBounds = (viewer, bounds, margin) => {
    margin = margin || viewer.navigation.FIT_TO_VIEW_HORIZONTAL_MARGIN;

    const marginBackup = {
        horizontal: viewer.navigation.FIT_TO_VIEW_HORIZONTAL_MARGIN,
        vertical: viewer.navigation.FIT_TO_VIEW_VERTICAL_MARGIN
    };

    // Change global bounds margins.
    viewer.navigation.FIT_TO_VIEW_HORIZONTAL_MARGIN = margin;
    viewer.navigation.FIT_TO_VIEW_VERTICAL_MARGIN = margin;

    // Get a clone of the camera in a fit to view position
    const camState = viewer.getState({ viewport: true });
    viewer.navigation.fitBounds(true, bounds, false, true);

    // Clone virtual camera
    const camera = viewer.navigation.getCamera().clone();
    
    // Restore global bound margins & camera.
    viewer.restoreState(camState, undefined, true);
    viewer.navigation.FIT_TO_VIEW_HORIZONTAL_MARGIN = marginBackup.horizontal;
    viewer.navigation.FIT_TO_VIEW_VERTICAL_MARGIN = marginBackup.vertical;

    // Update camera's near-far values
    viewer.impl.updateNearFarValues(camera, bounds);

    return camera;
};


/**
 * Contains static functions for capturing screenshots from the viewer.
 * @namespace Autodesk.Viewing.ScreenShot
 */
export let ScreenShot = {
    getScreenShotLegacy,
    getScreenShot,
    getScreenShotWithBounds,
    getScreenShotAtScreenSize,
    getSceneClientBounds,
    cropImage,
    blobToImage,
    makeBoundsSquare,
    getCameraWithFitBounds,
};
