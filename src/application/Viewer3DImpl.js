// Viewer3D offers public methods for developers to use.
// Viewer3DImpl is the implementation file for Viewer3D and is only used by Viewer3D.js
// 
// Viewer3D does things like parameter validation.
// Viewer3DImpl does the actual work, by interfacing with other internal components, such as the MaterialManager.

import { getGlobal, isNodeJS, isMobileDevice, isIE11 } from "../compat";
import { ScreenShot } from "./ScreenShot";
import { ProgressState } from "./ProgressState";
import { RenderScene } from "../wgs/scene/RenderScene";
import { RenderContext } from "../wgs/render/RenderContext";
import { MaterialManager } from "../wgs/render/MaterialManager";
import { MultiModelSelector } from "../tools/Selector";
import { MultiModelVisibilityManager } from "../tools/VisibilityManager";
import { LightPresets, DefaultLightPreset, DefaultLightPreset2d, BackgroundPresets, copyLightPreset } from "./LightPresets";
import { GroundShadow } from "../wgs/render/GroundShadow";
import { OtgResourceCache } from "../file-loaders/main/OtgResourceCache";
import { logger } from "../logger/Logger";
import { TextureLoader } from "../file-loaders/main/TextureLoader";
import { unconsolidateModels, reconsolidateModels } from "../wgs/render/LostContextRecovery";
import { RenderFlags } from "../wgs/scene/RenderFlags";
import * as shadow from "../wgs/render/ShadowMap";
import { GroundFlags } from "../wgs/render/GroundFlags";
import { ResetFlags } from "../wgs/scene/ResetFlags";
import { GroundReflection } from "../wgs/render/GroundReflection";
import { ModelLayers } from "./ModelLayers";
import { FragmentPointer } from "../wgs/scene/FragmentList";
import { CreateCubeMapFromColors } from "../wgs/render/DecodeEnvMap";
import { getResourceUrl } from "../globals";
import { SAOShader } from "../wgs/render/SAOShader";
import { VBIntersector } from "../wgs/scene/VBIntersector";
import { VertexBufferReader, BoundsCallback } from "../wgs/scene/VertexBufferReader";
import * as THREE from "three";
import { UnifiedCamera } from "../tools/UnifiedCamera";
import * as et from "./EventTypes";
import { Navigation } from "../tools/Navigation";
import { SelectionType } from "../tools/SelectionType";
import { BubbleNode } from "./bubble";
import { SceneMath } from "../wgs/scene/SceneMath";
import { GlobalManagerMixin } from '../application/GlobalManagerMixin';
import { Prefs3D, Prefs2D, Prefs } from "./PreferenceNames";
import SheetRenderContext from "../wgs/render/SheetRenderContext";
import { LMVRenderer } from "../wgs/render/LMVRenderer";

var ModelSettingsEnvironment = null;

var ENABLE_DEBUG = getGlobal().ENABLE_DEBUG;
var ENABLE_DEBUG_RCS = getGlobal().ENABLE_DEBUG_RCS;

//default parameters for WebGL initialization
export let InitParametersSetting = {
    canvas: null,
    antialias: false,
    alpha: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    stencil: false,
    depth: false
};

// Create a webgl renderer
export function createRenderer(canvas, webglInitParams = {}) {
    if (isNodeJS()) {
        return;
    }

    var params = Object.assign({}, InitParametersSetting, webglInitParams);
    params.canvas = canvas;
    let renderer;
    try {
        renderer = new LMVRenderer(params);
    } catch(e) { 
        return null;
    }

    // Simplify debugging
    renderer.name = 'MainRenderer';

    if ((!renderer.getContext) || (renderer.getContext && !renderer.getContext()))
        return null;

    renderer.autoClear = false;

    //Turn off scene sorting by THREE -- this is ok if we
    //do progressive draw in an order that makes sense
    //transparency-wise. If we start drawing using a frustum culling
    //r-tree or there are problems with transparency we'd have to turn on sorting.
    renderer.sortObjects = false;

    return renderer;
}

/** 
* @constructor
* @private
* */
export function Viewer3DImpl(thecanvas, theapi) {
    var _this = this;
    this.setGlobalManager(theapi.globalManager);

    //Frame time cutoffs in milliseconds. We target the middle value,
    //but adjust the CPU-side work in the give min/max range
    //once we measure actual frame times (including async GPU work, system load, etc).
    //NOTE: These are doubled for mobile devices at construction time (end of this file).
    var MAX_FRAME_BUDGET = 1000 / 15,
        TARGET_FRAME_TIME = 1000 / 30,
        MIN_FRAME_BUDGET = 1;   // This is the minimum time we will spend drawing and
    // is only indirectly related to the fastest frame rate.

    var _currentLightPreset = -1;
    var _oldLightPreset = -1;
    var _3dLightPreset = -1; // LMV-5655: Keeps track of the last 3d light preset
    var _oldCallback = null;

    var _worldUp;
    var _worldUpName = "y";

    var _reqid, _needsResize, _newWidth, _newHeight, _materials;
    var _webglrender, _renderer;
    var _sheetRenderer;

    var _shadowMaps;

    // Default direction in world-space from which we get the most light from. Needed for shadow casting.
    // The default is only used if no direction is specified by light preset or model.
    var _shadowLightDirDefault = null; // {THREE.Vector3}
    var _shadowLightDir = null; //

    var _lightDirDefault = null;

    var _needsClear = false,
        _needsRender = false,
        _overlayDirty = false;
    //var _spectorDump = false;

    var _progressEvent = { type: et.PROGRESS_UPDATE_EVENT, state: ProgressState.LOADING, percent: 0 };

    var _sceneDirty = false;

    // A "silent render" means to do a full, but interruptible, render in the background. Display the result on completion.
    // The idea is to make a good-quality render after a progressive render occurs, or after some new content has been loaded,
    // or some other situation where we don't want to "lose progress," that is, we don't want to do a progressive render but
    // rather want to add to or modify an existing render on the screen.
    var _deferredSilentRender = false;
    var _immediateSilentRender = false;

    var _cameraUpdated;

    var _explodeScale = 0;

    var _lastHighResTimeStamp = 0;

    var _frameTimeAvg = 1000.0 / 60.0;
    var _frameTimeSamples = 0;

    var _isLoading = true;  // turned off in onLoadComplete()

    var _groundShadow, _groundReflection;

    var _envMapBackground = false;

    var _modelQueue;

    var _lightsInitialized = false;
    var _defaultLightIntensity = 1.0;
    var _defaultDirLightColor = null; // {THREE.Color}
    var _defaultAmbientColor = null; //

    // apply separate edge color/opacity 
    this.edgeColorMain = new THREE.Vector4(0, 0, 0, 0.3);
    this.edgeColorGhosted = new THREE.Vector4(0, 0, 0, 0.1);

    var _lmvDisplay = getGlobal(); // return 'window', or something else for NodeJs context that won't work anyways.

    // render command system
    var _rcs;

    //OTG geom cache
    var _geomCache;

    // Listener used to load StandardSurface extension when we load
    // a model with standard surface materials
    var _stdSurfaceLoadListener = e => {
        var model = e.model;
        // Make sure the viewr is still active and the model has standard surface materials
        if (this.canvas && model && model.getData() && model.getData().stdSurfMats &&
            model.getData().stdSurfMats["materials"]) {
            // If we have surface materials then load the extension
            this.api.loadExtension("Autodesk.StandardSurface").then(extension => {
                // Extension loaded, process the model if the loader hasn't been destroyed
                if (extension)
                    extension.processModel(model);
            });
        }
    };


    var _onModelRootLoaded = e => e.model.modelRootLoaded = true;

    // keys: name of cutplane set. values: array of cutplanes
    var _cutPlaneSets = {};

    // 2D rendering onto a cutplane can only be adjusted for a single cutplane. This key defines for which one:
    // The first cutplane in this cutPlaneSet.   
    var _cutPlaneSetFor2DRendering = "";

    // we assume the program starts in a "doing work" state
    var _workPreviousTick = true;
    var _workThisTick;

    if (thecanvas) {
        this.interval = setInterval(function () {
            // Only start reporting the framerate to ADP when there's been "enough" samples
            if (_isLoading || _frameTimeSamples < 60) {
                return;
            }
            _this.track({ name: 'fps', value: Number(_this.fps().toFixed(2)), aggregate: 'last' });
        }, 30000);
    }

    this.api = theapi;
    this.canvas = thecanvas;
    this.loader = null;
    this.canvasBoundingclientRectDirty = true;

    this.nearRadius = 0;
    this.defaultLoadingAnimationDuration = 300; // Time in milliseconds to load a 2D line.
    this.lastTime2dGeometryCreated = 0;

    // Optional: If >0, models whose camera distance exceeds this value are excluded from near/far-plane computation.
    this.maxModelDistance = 0;

    //Slower initialization pieces can be delayed until after
    //we start loading data, so they are separated out here.
    this.initialize = function (initOptions = {}) {

        _worldUp = new THREE.Vector3(0, 1, 0);
        _modelQueue = new RenderScene();

        _webglrender = initOptions.glrenderer || createRenderer(thecanvas, initOptions.webglInitParams);
        if (!_webglrender && !isNodeJS()) {
            return;
        }

        if (_webglrender) {
            this.onWebGLcontextLost = this.onWebGLcontextLost.bind(this);
            this.onWebGLcontextRestored = this.onWebGLcontextRestored.bind(this);
            _webglrender.addEventListener(LMVRenderer.Events.WEBGL_CONTEXT_LOST, this.onWebGLcontextLost);

            _webglrender.refCount++;

            // Optional: Allow viewer to resurrect after webgl context restore
            if (initOptions.enableContextRestore) {
                _webglrender.enableContextRestore = true;
                _webglrender.addEventListener(LMVRenderer.Events.WEBGL_CONTEXT_RESTORED, this.onWebGLcontextRestored);
            }
        }

        _renderer = initOptions.renderer || new RenderContext();
        _renderer.init(_webglrender, thecanvas ? thecanvas.clientWidth : 0, thecanvas ? thecanvas.clientHeight : 0, initOptions);

        _materials = initOptions.materialManager || new MaterialManager(_webglrender);

        _materials.refCount++;

        this.camera = new UnifiedCamera(thecanvas ? thecanvas.clientWidth : 512, thecanvas ? thecanvas.clientHeight : 512);
        this.lightsOn = false;
        // we'll fill this in later, in initLights.
                                       
        {
            this.lights = [];
        }
                 
         
                                            
         
                  
        // pass in when lightsOn is false;
        this.no_lights = [];

        _defaultDirLightColor = new THREE.Color().setRGB(1, 1, 1);
        _defaultAmbientColor = new THREE.Color().setRGB(1, 1, 1);

        // this.camera = this.unicam.getOrthographicCamera();
        this.cameraChangedEvent = { type: et.CAMERA_CHANGE_EVENT, camera: this.camera };

        _shadowLightDirDefault = new THREE.Vector3(1, 1, 1); // which does not match the _lightDirDefault
        _shadowLightDir = new THREE.Vector3().copy(_shadowLightDirDefault);
        _lightDirDefault = new THREE.Vector3(-1, 0, 1);   // a horizontal light, which is not a good default shadowd direction

        //This scene will just hold the camera and lights, while
        //we keep groups of progressively rendered geometry in
        //separate geometry scenes.
        this.scene = new THREE.Scene();
        this.sceneAfter = new THREE.Scene();
        this.sceneAfter.sortObjects = false;

        this.overlayScenes = {};

        setupSelectionHighlight();

        // no override materials for the scene for selected point clouds, because it overwrites the point size setting.
        // instead we overwrite the material for the duplicated geometry in this.highlightFragment()        
        this.createOverlayScene("selection_points", null, null);

        this.selectionMeshes = {};

        this.fadeMaterial = new THREE.MeshPhongMaterial({ color: 0xffffff, opacity: 0.1, reflectivity: 0, transparent: true, depthWrite: false });
        this.fadeMaterial.packedNormals = true;
        _materials.addInstancingSupport(this.fadeMaterial);
        _materials.addMaterial("__fadeMaterial__", this.fadeMaterial, true);

        this.setSelectionColor(0x6699ff);


        //Polygon offset is always used.
        _materials.togglePolygonOffset(true);
        _renderer.setDepthMaterialOffset(_materials.getPolygonOffsetOn(), _materials.getPolygonOffsetFactor(), _materials.getPolygonOffsetUnits());

        //Settings exposed to GUI:
        this.progressiveRender = true;
        this.swapBlackAndWhite = false;

        this.targetFrameBudget = TARGET_FRAME_TIME;

        // How many ticks pass in between updates. Make this half as many for mobile because the frame budget is doubled.
        // 1 means that we display every frame
        this.frameDisplayRate = 5;
        if (isMobileDevice()) {
            MAX_FRAME_BUDGET *= 2;          // Increase to match TARGET_FRAME_TIME
            TARGET_FRAME_TIME *= 2;         // GPUs are slower on mobile use a longer target frame time
            this.targetFrameBudget /= 2;    // Even though the target's doubled, start the budget smaller and have it work up to the target (ask Cleve)
            this.frameDisplayRate /= 2;     // since time per tick is doubled (in the long run), halve the number of ticks to give the same wall-clock delay interval
        }
        // How much time between checks on a full frame for any interrupt signal.
        this.interruptBudget = 1e10;

        this.controls = {
            update: function () {
                this.camera.lookAt(this.camera.target);
                this.camera.updateProjectionMatrix();
                this.camera.dirty = false;
            },
            handleResize: function () { },
            recordHomeView: function () { },
            uninitialize: function () { },
            isToolActivated: function () { return false; }
        };

        this.selector = new MultiModelSelector(this);

        this.visibilityManager = new MultiModelVisibilityManager(this);

        this.showGhosting = true;
        this.showOverlaysWhileMoving = true;
        this.skipAOWhenMoving = false;

        this.keyFrameAnimator = null;
        this.zoomBoundsChanged = true;

        var cc = LightPresets[DefaultLightPreset].bgColorGradient;
        this.setClearColors(cc[0], cc[1], cc[2], cc[3], cc[4], cc[5]);

        _groundShadow = new GroundShadow(_webglrender);
        _groundShadow.enabled = true;

        _rcs = new RenderCommandSystem();

        // TODO_NOP: hack register materials for cutplanes
        _materials.addMaterialNonHDR("groundShadowDepthMaterial", _groundShadow.getDepthMaterial());
        _materials.addOverrideMaterial("normalsMaterial", _renderer.getDepthMaterial());
        _materials.addOverrideMaterial("edgeMaterial", _renderer.getEdgeMaterial());

        //just meant to do an initial clear to the background color we want.
        _renderer.beginScene(this.scene, this.camera, this.noLights, true);

        _renderer.composeFinalFrame(true, isIE11 /* TS: are you kidding me */);
        this.api.addEventListener(et.MODEL_ROOT_LOADED_EVENT, _stdSurfaceLoadListener);
        this.api.addEventListener(et.MODEL_ROOT_LOADED_EVENT, _onModelRootLoaded);
    };

    this.getSheetRenderer = function () {
        if (!_sheetRenderer) {
            _sheetRenderer = new SheetRenderContext(_this, _renderer, _webglrender, _materials);
        }

        return _sheetRenderer;
    };

    this.isSheetRendererNeeded = function () {
        return !_this.is2d && this.get2DModels().length > 0;
    };

    this.get2DModels = function () {
        return _modelQueue.getModels().filter(m => m.is2d());
    };

    this.get3DModels = function () {
        return _modelQueue.getModels().filter(m => m.is3d());
    };

    //Bridge between the render queue and render context
    //For passing pieces of model to the renderer during
    //timed progressive rendering, while also taking into account
    //the current rendering mode of the viewer
    function renderSomeCallback(scene) {

        //Ideally, here we only want the piece of the
        //render function that specifically renders geometries,
        //and none of the camera update stuff that we already do
        //once in beginProgressive() -- but this requires
        //some refactoring of THREE.WebGLRenderer.
        const is2DScene = scene.frags?.is2d;
        var phase = _rcs.phase;
        var wantColor = true;
        var wantSAO = phase == RenderFlags.RENDER_NORMAL;
        var wantID = _renderer.settings.idbuffer && phase != RenderFlags.RENDER_HIDDEN;

        // Set edge color/opacity differently for main rendering and ghosted shapes
        var edgeColor = (phase == RenderFlags.RENDER_HIDDEN) ? _this.edgeColorGhosted : _this.edgeColorMain;
        _renderer.setEdgeColor(edgeColor);

        if (phase == RenderFlags.RENDER_HIDDEN && !scene.ignoreFadeMaterial)
            scene.overrideMaterial = _this.fadeMaterial;
        else if (phase == RenderFlags.RENDER_HIGHLIGHTED)
            scene.overrideMaterial = _this.highlightMaterial;

        const event = {
            type: et.RENDER_SCENE_PART,
            scene, wantColor, wantSAO, wantID,
            context: _renderer
        };

        _this.api.dispatchEvent(event);

        if (!_this.is2d && is2DScene) {
            _this.getSheetRenderer().renderScenePart(scene, wantColor, wantSAO, wantID);
        } else {
            _renderer.renderScenePart(scene, wantColor, wantSAO, wantID);
        }

        scene.overrideMaterial = null;

    }

    function updateFPS(highResTimeStamp) {
        _frameTimeSamples++;

        if ((_lastHighResTimeStamp <= highResTimeStamp) && (_lastHighResTimeStamp > 0)) {
            _frameTimeAvg = _frameTimeAvg * 0.8 + (highResTimeStamp - _lastHighResTimeStamp) * 0.2;
        }

        if (_this.fpsCallback)
            _this.fpsCallback(_this.fps());
    }

    function updateAnimations(highResTimeStamp) {
        if (_this.keyFrameAnimator) {
            var delta = _lastHighResTimeStamp > 0 ? (highResTimeStamp - _lastHighResTimeStamp) / 1000 : 0;
            var updateFlags = _this.keyFrameAnimator.update(delta);
            if (updateFlags) {
                _this.sceneUpdated(true);
                if (updateFlags & _this.keyFrameAnimator.UPDATE_CAMERA)
                    return true;
            }
        }
        return false;
    }

    function updateCanvasSize(noEvent) {
        if (_needsResize) {
            _this.canvasBoundingclientRectDirty = true;
            _this.camera.aspect = _newWidth / _newHeight;
            _this.camera.clientWidth = _newWidth;
            _this.camera.clientHeight = _newHeight;
            _renderer.setSize(_newWidth, _newHeight);
            _this.controls.handleResize();
            if (_groundReflection)
                _groundReflection.setSize(_newWidth, _newHeight);
            if (_sheetRenderer) {
                // Uses the size of the attached renderContext (impl's _renderer, by default)
                _sheetRenderer.setSize();
            }
            _this.invalidate(true, true, true);
            _needsResize = false;
            if (!noEvent) {
                _this.api.dispatchEvent({
                    type: et.VIEWER_RESIZE_EVENT,
                    width: _newWidth,
                    height: _newHeight
                });
            }
        }
    }

    this.renderGroundShadow = function (target) {

        // If shadow maps are active, we don't use _groundShadow for the ground. Instead, the ground is
        // rendered using the shadow map as well.
        if (_shadowMaps) {
            if (_shadowMaps.state == shadow.SHADOWMAP_VALID) {
                _shadowMaps.renderGroundShadow(_this.camera, target || _renderer.getColorTarget());
            }
        } else {
            _groundShadow.renderShadow(_this.camera, target || _renderer.getColorTarget());
            _groundShadow.rendered = true;
        }
    };

    // Set any information needed for the ground plane reflection, drop shadow, or shadow map projection
    function updateGroundTransform() {
        // if we're not using the ground shadow or reflection, or it's a 2D drawing, return
        if (!_groundShadow.enabled && !_groundReflection || _this.is2d)
            return;

        // Get the box of all the scene's data
        var groundBox;
        if (_this.model && !_this.model.isLoadDone()) {
            groundBox = _this.model.getData().bbox;
        }
        else {
            groundBox = _this.getVisibleBounds(true, false);
        }
        // If there's nothing to see, return
        if (!groundBox)
            return;

        var camera = _this.camera;
        var bbox = groundBox.clone();

        var rightAxis = new THREE.Vector3(1, 0, 0);

        var shadowDir = _shadowLightDir.clone();

        // Transform bbox, rightAxis, and shadowDir using worldUpTransform. For the resulting box, we
        // can safely assume that y is the up-direction
        if (camera.worldUpTransform) {
            bbox.applyMatrix4(camera.worldUpTransform);
            rightAxis.applyMatrix4(camera.worldUpTransform);
            shadowDir.applyMatrix4(camera.worldUpTransform);
        }

        // expand the box downwards by 0.5%. The effect of this is just that the
        // ground plane does not touch the world box, but is slightly below it
        bbox.min.y -= 0.005 * (bbox.max.y - bbox.min.y);

        if (_shadowMaps) {
            _shadowMaps.expandByGroundShadow(bbox, shadowDir);
        }

        // get size and center
        var bsize = bbox.getSize(new THREE.Vector3());
        var bcenter = bbox.getCenter(new THREE.Vector3());

        // apply some adjustments specific for drop-shadow
        if (!_shadowMaps) {
            // add some horizontal margin so that blurring is not clipped at the boundaries
            bsize.x *= 1.25;
            bsize.z *= 1.25;

            // expand to square, because the texture is squared as well
            bsize.x = bsize.z = Math.max(bsize.x, bsize.z);
        }

        // Rotate center back to world-coords.
        if (camera.worldUpTransform) {
            var worldUpInverse = camera.worldUpTransform.clone().invert();
            bcenter.applyMatrix4(worldUpInverse);

            // Note that we leave size vector as it is. I.e., only the center is transformed back to world-coords.
            // The size vector keeps as it is, i.e. the bbox defined by (center, size) is still aligned with
            // the rotated axes. In other worlds
            //  - size.x is the extent along worldUpTransform * (1,0,0) = rightAxis
            //  - size.y is the extent along worldUpTransform * (0,1,0) = camera.worldUp
            //  - size.z is the extent along worldUpTransform * (0,0,1)
        }

        _groundShadow.setTransform(
            bcenter,
            bsize,
            camera.worldup,
            rightAxis
        );

        if (_groundReflection) {
            var groundPos = (new THREE.Vector3()).subVectors(bcenter, camera.worldup.clone().multiplyScalar(bsize.y / 2));
            _groundReflection.setTransform(groundPos, camera.worldup, bsize);
        }

        if (_shadowMaps) {
            _shadowMaps.setGroundShadowTransform(bcenter, bsize, camera.worldup, rightAxis);
        }
    }

    function updateScene() {
        if (_sceneDirty) {
            // If the model had changed, the ground-plane, etc., may have changed, so recompute
            updateGroundTransform();
            _groundShadow.setDirty();
            _sceneDirty = false;
            return true;
        } else {
            return false;
        }
    }

    function updateOverlays() {

        //Update the selection set cloned meshes
        for (var id in _this.selectionMeshes) {

            var m = _this.selectionMeshes[id];
            if (m.model) {
                var fragList = m.model.getFragmentList();

                // If the proxy uses original geometry of the fragment, update its matrix.
                // If the geometry does not match, it is a consolidated or instanced mesh.
                // For these, the matrix is already baked into vertex buffer or
                // index buffer. We don't support animation for these.
                if (m.geometry === fragList?.getGeometry(m.fragId)) {
                    fragList.getWorldMatrix(m.fragId, m.matrix);
                }
            }
        }

    }

    function invalidateShadowMap() {
        if (_shadowMaps) {
            _shadowMaps.state = shadow.SHADOWMAP_NEEDS_UPDATE;
        }
    }

    var _screenDrawnFlags = {
        NOTHING_DRAWN: 0,
        MODEL_DRAWN: 1,
        BACKGROUND_DRAWN: 2,
        OVERLAY_DRAWN: 4,
        REFLECTION_DRAWN: 8,
        ALL_DRAWN: 15
    };

    // The render command system is what actually does the render. The idea here is that each tick() checks if anything causes a new
    // render. If so, then we make a new list of commands to perform, then start performing them. For a full render without interruptions,
    // this is overkill - we could just lockstep execute them all. Where the command list comes into its own is that it can be continued.
    // For progressive rendering we want 
    // Rather than pepper the rendering sequence of the code with lots of "if" statements that
    function RenderCommandSystem() {
        this.highResTimeStamp = -1;
        // did something get rendered that would change the screen (almost always true when rendering occurs)?
        this.screenDrawn = _screenDrawnFlags.NOTHING_DRAWN;
        // did a Present get done?
        this.screenHasChanged = false;
        // how much time we are given to render things during each execution, in ms.
        this.frameBudget = 0;
        // how much time we have left to render stuff during this tick(), in ms.
        this.frameRemaining = 0;
        // what type of render is happening currently
        this.phase = RenderFlags.RENDER_NORMAL;
        // show the amount of the scene rendered. TODO this doesn't really work right with ghosting or shadow mapping on, as those also affect it.
        this.signalProgressByRendering = false;

        // How many ticks have executed the current command list. Good for knowing if we're on the first frame (tick 0).
        this.tickCount = 0;
        // average time spent rendering a tick() TODO - needs to be revisited and thought through: if a batch is not loaded, it displays really fast!
        this.beginFrameAvg = 0;
        // exactly what it says, the time stamp passed in on the previous tick().
        this.lastBeginFrameTimeStamp = 0;

        // various types of rendering
        this.RENDERMODE_FULL = 0;
        this.RENDERMODE_PROGRESSIVE = 1;
        this.RENDERMODE_SILENT = 2;
        // type of rendering being done.
        this.renderType = this.RENDERMODE_FULL;

        // First frame budget
        // If it's progressive and the first frame, try to finish the ground shadow in the allocated time
        this.INITIAL_GROUND_SHADOW = 0.2;

        // Internal command iterator state
        // is there a command list to execute?
        this.cmdListActive = false;
        // what command we are executing
        this.cmdIndex = 0;
        // was execution terminated for this tick()?
        this.continueExecution = true;
        // are there "CMD_ALWAYS_DO" commands in the command list? If so, we need to traverse the whole command list each tick.
        this.encounteredAlwaysDo = false;
        // did the full render finish? If not, then ignore overlay and present updates until it has
        this.finishedFullRender = true;
        // did the ground shadow get computed in the post-process for deferred rendering?
        this.groundShadowInPost = false;
        // did any previous or current frame trigger the overlay to be drawn?
        this.drawOverlay = false;

        // true means parameters can be set on the command
        this.cmdIsOpen = false;

        // how long the array is (so that if new commands/params are needed, they get allocated first).
        this.allocArraySize = 0;
        // how many commands are in the active command list
        this.cmdListLength = 0;
        // the command and parameters set for the command
        this.cmdList = [];
        this.paramList = [];

        // command states
        this.CMD_NORMAL_SEQUENCE = 0;
        this.CMD_DO_AFTER = 1;
        this.CMD_ALWAYS_DO = 2;

        this.isActive = function () {
            return this.cmdListActive;
        };

        this.setFrame = function (timeBudget) {
            this.frameBudget = timeBudget;
        };

        // signal the beginning of a new set of commands
        this.beginCommandSet = function () {
            this.cmdListActive = true;
            this.cmdIndex = 0;
            this.cmdListLength = 0;
            this.encounteredAlwaysDo = false;
            this.tickCount = 0;
            this.screenDrawn = _screenDrawnFlags.NOTHING_DRAWN;
            this.screenHasChanged = false;
        };

        // signal the end
        this.endCommandSet = function () {
            if (this.cmdIsOpen) {
                this.cmdIsOpen = false;
                // close previous command - really, increment just to get the final count
                this.cmdListLength++;
            }
        };

        // Set the parameter on the currently-executed parameter. Meant for the commands above.
        this._internalSetParam = function (indexString, val) {
            this.paramList[this.cmdIndex][indexString] = val;
        };


        this.addCommand = function (func, executionLevel) {
            if (this.cmdIsOpen) {
                // close previous command
                this.cmdListLength++;
            }
            this.cmdIsOpen = true;
            while (this.allocArraySize <= this.cmdListLength) {
                this.cmdList[this.cmdListLength] = {};
                this.paramList[this.cmdListLength] = {};
                this.allocArraySize++;
            }
            this.cmdList[this.cmdListLength] = func;
            this.paramList[this.cmdListLength].executionLevel = executionLevel || this.CMD_NORMAL_SEQUENCE;
            this.encounteredAlwaysDo = this.encounteredAlwaysDo || (executionLevel === this.CMD_ALWAYS_DO);

            // return value so if we want to jump to this command, we know where to go.
            return this.cmdListLength;
        };

        // note that we're a bit sloppy with parameter setting. Since the parameter set at an index location
        // gets reused, you may see parameters in the parameter object that have nothing to do with this
        // command, since this parameter set might have been used for another command at some other time.
        // Basically, if a command doesn't use the parameter, then ignore it.
        this.setParam = function (indexString, val) {
            if (this.cmdIsOpen) {
                this.paramList[this.cmdListLength][indexString] = val;
            } else {
                if (ENABLE_DEBUG) {
                    logger.error("ERROR: cannot set param when no command is open!");
                }
            }
        };

        // This method is meant for use during execution of a command, so gets the parameter from the currently-active command.
        this.getParam = function (indexString) {
            if (ENABLE_DEBUG) {
                if (this.paramList[this.cmdIndex][indexString] === undefined) {
                    logger.error("ERROR: parameter " + indexString + " was never set for this command! Go fix it.");
                }
            }
            return this.paramList[this.cmdIndex][indexString];
        };

        // return true if done running all commands.
        this.executeCommandList = function () {
            if (_rcs.cmdListActive) {
                // go through command list, interrupting as needed.

                // If we do more than one tick for the rendering, then turn
                // off the average frame calculation in cmdBeginScene.
                if (this.tickCount > 0)
                    _rcs.lastBeginFrameTimeStamp = 0;

                // set frame budget
                this.frameRemaining = this.frameBudget;

                if (ENABLE_DEBUG) {
                    // reality check
                    if (this.cmdIsOpen) {
                        logger.error("ERROR: should call endCommandSet before executing");
                    }
                }
                this.continueExecution = true;
                var restartIdx;
                // not at end of command list? We always go through the whole command list, as there may be "always do"
                // commands, such as a Present().

                if (ENABLE_DEBUG_RCS) {
                    if (this.tickCount === 0) { console.log("==================="); }
                    console.log("Running commands for " + ((_rcs.renderType === _rcs.RENDERMODE_PROGRESSIVE) ? "progressive" :
                        ((_rcs.renderType === _rcs.RENDERMODE_FULL) ? "full" : "silent")) +
                        " render, for tick count " + this.tickCount);
                }

                // Are there any "always do" commands in this command set, that must be done before we continue our command sequence?
                // Currently needed by smooth navigation, to turn off AO during the render sequence.
                if (this.encounteredAlwaysDo) {
                    var idx = 0;
                    while (idx < this.cmdIndex) {
                        // Is this a command we should always do?
                        if (this.paramList[idx].executionLevel >= _rcs.CMD_ALWAYS_DO) {
                            // Commands we always do are assumed to never abort, so we don't check for failure.
                            if (ENABLE_DEBUG_RCS) { console.log("  ALWAYS DO command " + idx + ": " + this.cmdList[idx].name); }
                            this.cmdList[idx]();
                        }
                        idx++;
                    }
                }

                while (this.cmdIndex < this.cmdListLength) {
                    // if we are to continue execution, easy;
                    // if not, then check if the next command is an "always do after", such as a Present().
                    if (this.continueExecution ||
                        (this.paramList[this.cmdIndex].executionLevel >= _rcs.CMD_DO_AFTER)) {
                        // we're supposed to execute this command, so do it and see what it says
                        if (ENABLE_DEBUG_RCS) { console.log("  command " + this.cmdIndex + ": " + this.cmdList[this.cmdIndex].name + " and " + _rcs.frameRemaining + " frame budget remaining"); }

                        if (this.cmdList[this.cmdIndex]()) {
                            // true means stop executing, out of time (typically),
                            // so restart execution at this command the next tick()
                            if (ENABLE_DEBUG_RCS) { console.log("  >>> out of tick time with " + _rcs.frameRemaining); }
                            restartIdx = this.cmdIndex;
                            // signal to not execute any "normal sequence" commands for the rest of the command list.
                            this.continueExecution = false;
                        }
                    }
                    // Go to next command until we hit the end of the list;
                    // we always continue, since there could be "always do" or "do after"
                    // commands in the list that need to be executed.
                    this.cmdIndex++;
                }

                // out of time or aborted for some other reason? We'll be back later...
                if (this.continueExecution) {
                    // did all commands, so we're done
                    this.cmdListActive = false;
                } else {
                    // set where to continue the work next tick()
                    this.cmdIndex = restartIdx;
                }
                this.tickCount++;

                return !this.continueExecution;
            } else {
                // If we finish the rendering, then turn
                // off the average frame calculation in cmdBeginScene.
                _rcs.lastBeginFrameTimeStamp = 0;

                // not active, so "done"
                return true;
            }
        };
    }

    // Here's the system:
    // If ground shadow is done - well, that's easy, just blit it before beauty pass
    // If not done
    // 	If we are doing a full render
    //     Render the whole shadow first (possibly tick limited), blit it to screen, then continue to beauty pass
    //     Else we are doing progressive
    //        if this is the first frame:
    //           if the number of objects in the scene is low (10?),
    //              render the drop shadow, figuring we can rendering the rest of the scene in a single frame
    //           else
    //              don't bother rendering anything in later ticks (we used to waste time rendering a few each tick)	
    //        if this is a later frame:
    // 			 render just the beauty pass, until done. Don't bother with the shadow now, as it won't get used.
    //        When we get to the end of progressive:
    //           If needed, render the ground shadow until done. Once done, signal that a re-render is needed.
    function cmdGenerateGroundShadow() {
        // three cases: full render, quick out for progressive, continue as possible for progressive.
        if ((_rcs.renderType === _rcs.RENDERMODE_PROGRESSIVE)) {
            if (_rcs.getParam("GenerateGroundShadow.afterBeauty")) {
                // Rendering the ground shadow after all progressive rendering is done. Signal redraw if it finishes.
                _rcs.frameRemaining = _groundShadow.prepareGroundShadow(_this.modelQueue(), 0, _rcs.frameRemaining);
                // was this the call that rendered it fully?
                if (_groundShadow.getStatus() == GroundFlags.GROUND_RENDERED) {
                    // Do we need to rerender? This needs to happen if we're not using reflection insertion.
                    // TODO: someday perhaps make ground shadows more "full featured" and merge behind, like ground reflections do?
                    if (_rcs.getParam("GenerateGroundShadow.signalRedraw")) {
                        _this.requestSilentRender();
                        if (ENABLE_DEBUG_RCS) {
                            console.log(" $$$$ SIGNAL FULL GROUND SHADOW REDRAW");
                        }
                        // don't need to continue, since we know we need to fully redraw on next tick
                        return true; // TODO could signal abort rest of command stream, since we know we invalidate. It's just a bit inefficient otherwise.
                    }
                    // note for ground reflection, so it can decide on deferred silent rendering.
                    _rcs.groundShadowInPost = true;
                }
            } else {
                // If this is the first frame, try to render the drop shadow in a small amount of time.
                // Else, don't waste time on the drop shadow.
                if (_rcs.tickCount === 0) {
                    // render 10 objects TODO - expose 10 as some other number?
                    //_rcs.frameRemaining = 
                    _groundShadow.prepareGroundShadow(_this.modelQueue(), 10);
                    // TODO or this way, which does possibly give flicker:
                    //_rcs.frameRemaining = _groundShadow.prepareGroundShadow(_this.modelQueue(), _rcs.frameRemaining, _rcs.INITIAL_GROUND_SHADOW);
                    //var minRemaining = _rcs.frameBudget * (1-_rcs.INITIAL_GROUND_SHADOW);
                    //if ( _rcs.frameRemaining < minRemaining ) {
                    //     _rcs.frameRemaining = minRemaining;
                    //}
                }
            }
        } else {
            // full render, just do it fully.
            _rcs.frameRemaining = _groundShadow.prepareGroundShadow(_this.modelQueue(), 0, _rcs.frameRemaining);
        }

        // rendering can continue if there's time left
        return (_rcs.frameRemaining < 0) && (_groundShadow.getStatus() === GroundFlags.GROUND_UNFINISHED);
    }

    function cmdBlitGroundShadow() {
        //Render the ground shadow after screen clear
        if (_groundShadow.getStatus() !== GroundFlags.GROUND_UNFINISHED)
            _this.renderGroundShadow();
        return false;
    }

    function cmdGenerateGroundReflection() {
        // three cases: full render, quick out for progressive, continue as possible for progressive.
        if ((_rcs.renderType === _rcs.RENDERMODE_PROGRESSIVE)) {
            // is this pass happening after the beauty pass is completed?
            if (_rcs.getParam("GenerateGroundReflection.afterBeauty")) {
                // Rendering the ground reflection after all progressive rendering is done.
                _rcs.frameRemaining = _groundReflection.prepareGroundReflection(_groundShadow, _this, false, 0, _rcs.frameRemaining);
                // was this the call that rendered it fully?
                if (_groundReflection.getStatus() == GroundFlags.GROUND_RENDERED) {
                    _rcs.screenDrawn |= _screenDrawnFlags.REFLECTION_DRAWN;
                    // If we're done, we should also check to see if a silent render is needed for ground shadows.
                    // If ground shadows were finished in these post-render passes (rare - only on animation or explode,
                    // for complex scenes), transparent objects in the scene will not show the shadows properly through
                    // their transparent objects, LMV-2508.
                    // TODO - nicer still would be to see if the scene actually has any transparent objects. If not,
                    // then we don't need this separate re-render.
                    // TODO Also, note this isn't a perfect system: in practice you really want to have the ground reflection
                    // entirely done before rendering atop it, so that what is seen through transparent objects is fully
                    // folded in. However, this problem is much less obvious in the scenes tested - missing ground shadows
                    // are more obvious.
                    if (_rcs.groundShadowInPost && _materials.hasTransparentMaterial()) {
                        _this.requestDeferredSilentRender();
                    }
                }
            } else {
                // If this is the first frame, try to render the reflection in a small amount of time.
                // Else, don't waste time on the reflection.
                if (_rcs.tickCount === 0) {
                    // render 10 objects TODO - expose 10 as some other number? Or use a budget? Or...?
                    //_rcs.frameRemaining =
                    _groundReflection.prepareGroundReflection(_groundShadow, _this, true, 10);
                    // TODO or this way, which does possibly give flicker:
                    //_rcs.frameRemaining = _groundReflection.prepareGroundReflection(_this.modelQueue(), _rcs.frameRemaining, _rcs.INITIAL_GROUND_SHADOW);
                    //var minRemaining = _rcs.frameBudget * (1-_rcs.INITIAL_GROUND_SHADOW);
                    //if ( _rcs.frameRemaining < minRemaining ) {
                    //     _rcs.frameRemaining = minRemaining;
                    //}
                }
            }
        } else {
            // full render, just do it fully.
            _rcs.frameRemaining = _groundReflection.prepareGroundReflection(_groundShadow, _this, false, 0, _rcs.frameRemaining);
        }

        // rendering can continue if there's time left, or if we actually finished display and should present, even though we're out of time.
        // TODO we could revise commands to be of "takes time" and "doesn't take time", so that we abort if and only if we're out of time
        // and hit a "takes time" command.
        return (_rcs.frameRemaining < 0) && (_groundReflection.getStatus() === GroundFlags.GROUND_UNFINISHED);
    }

    /**
     * Progressive update of the shadow map:
     *
     *   a) For small models that can be rendered within a single frame, the shadow map will always be rendered first,
     *      so that shadows will not flicker on and off during animations, on scene changes, or when changing the light direction.
     *   b) For large models, seeing something is more important than shadows. Therefore, we render without shadows
     *      first and only do work on the shadow map if everything else is finished.
     *
     *  Whether we take a) or b) is determined on-the-fly: We use a) if we succeed updating the whole ShadowMap
     *  within a single frame time budget.
     */
    function cmdUpdateShadowMap() {

        // We are either starting an update of the shadow map, or are continuing to render it in this tick.

        // This section is always entered in the first frame if the shadow map is not available yet.
        if (_shadowMaps.state === shadow.SHADOWMAP_NEEDS_UPDATE) {

            // start shadow map update. This call may end in two ways:
            //  - In case a), the shadowmap could already be finished within the startUpdate() call. Therefore, the
            //    shadow map will already be available and will be used in this frame.
            //    In this case, there is nothing more to do and all subsequent calls to updateShadowMap will
            //    do nothing.
            //  - in case b), the shadow map is not available. In this case, we first wait until the rendering
            //    without shadows is finished. (see next section)
            _rcs.frameRemaining = _shadowMaps.startUpdate(_modelQueue, _rcs.frameRemaining, _this.camera, _shadowLightDir, _materials);

        } else if (_shadowMaps.state == shadow.SHADOWMAP_INCOMPLETE) {

            // continue shadow map update as long as we have time
            _rcs.frameRemaining = _shadowMaps.continueUpdate(_modelQueue, _rcs.frameRemaining, _materials);

            // if we're done and this is a progressive render, then this shadow generation is happening at the end.
            // In such a case we need to re-render (similar to ground shadows and reflections).
            if (_shadowMaps.state == shadow.SHADOWMAP_VALID) {

                // TODO - may wish to make this a deferred silent render, so that reflection etc. is completed, then shadows come in later.
                _this.requestSilentRender();
                if (ENABLE_DEBUG_RCS) {
                    console.log(" $$$$ SIGNAL FULL SHADOW MAP REDRAW");
                }
                // don't need to continue, since we know we need to fully redraw on next tick
                return true; // TODO could signal abort rest of command stream, since we know we invalidate. It's just a bit inefficient otherwise.
            }
        }
        return (_rcs.frameRemaining < 0.0) && (_shadowMaps.state !== shadow.SHADOWMAP_VALID);
    }

    function cmdResetShadowMap() {
        _shadowMaps.state = shadow.SHADOWMAP_NEEDS_UPDATE;
    }

    function cmdBeginScene() {
        if (_rcs.signalProgressByRendering)
            _this.signalProgress(0, ProgressState.RENDERING); //zero out the progress bar for when rendering begins

        if ((_rcs.renderType === _rcs.RENDERMODE_PROGRESSIVE)) {
            //Measure actual frame time between two consecutive initial frames.
            //This is used to correct measured per-scene times to what they actually take
            //once the async processing of the graphics thread is taken into account.
            if (_rcs.lastBeginFrameTimeStamp > 0) {
                var delta = _rcs.highResTimeStamp - _rcs.lastBeginFrameTimeStamp;
                _rcs.beginFrameAvg = 0.75 * _rcs.beginFrameAvg + 0.25 * delta;
            }
            _rcs.lastBeginFrameTimeStamp = _rcs.highResTimeStamp;

            //Adjust frame time allowance based on actual frame rate,
            //but stay within the given boundaries.
            if (_rcs.beginFrameAvg < TARGET_FRAME_TIME && _rcs.frameBudget < MAX_FRAME_BUDGET) {
                _this.targetFrameBudget += 1;
                if (_this.targetFrameBudget > MAX_FRAME_BUDGET) {
                    _this.targetFrameBudget = MAX_FRAME_BUDGET;
                }
            }
            else if (_rcs.beginFrameAvg > TARGET_FRAME_TIME && _rcs.frameBudget > MIN_FRAME_BUDGET) {
                _this.targetFrameBudget *= (0.75 + 0.25 * TARGET_FRAME_TIME / _rcs.beginFrameAvg);
                if (_this.targetFrameBudget < MIN_FRAME_BUDGET) {
                    _this.targetFrameBudget = MIN_FRAME_BUDGET;
                }
            }
        }

        // clear the color and depth targets
        var clear = _rcs.getParam("BeginScene.clear");
        _renderer.beginScene(_this.scene, _this.camera, _this.lightsOn ? _this.lights : _this.no_lights, clear);

        if (clear) {
            _rcs.screenDrawn |= _screenDrawnFlags.BACKGROUND_DRAWN;
        }

        // Check if the camera changed, and if so, signal.
        if (_rcs.getParam("BeginScene.signalCameraChanged")) {
            // Tells view cube to update, for example.
            _this.api.dispatchEvent(_this.cameraChangedEvent);
        }

        return false;
    }

    function cmdBeginPhase() {
        // If nothing is highlighted just skip the highlighted phase
        _rcs.phase = _rcs.getParam("BeginPhase.phase");
        if (ENABLE_DEBUG_RCS) {
            console.log("     render phase is now " + _rcs.phase);
        }

        // We need to get the XR projection matrix to make LMVs frustum culling work
        if (_this.glrenderer().xr?.isPresenting) {
            const cameraVR = _this.glrenderer().xr.getCamera(_this.camera);
            _this.camera.projectionMatrix.copy(cameraVR.projectionMatrix);

            // TODO: Workaround to adjust LMVs camera transforms to reflect cameraVR transforms.
            // Fixed in three.js r130, remove when we update to r130+
            cameraVR.matrixWorld.decompose( cameraVR.position, cameraVR.quaternion, cameraVR.scale );

            _this.camera.position.copy( cameraVR.position );
            _this.camera.quaternion.copy( cameraVR.quaternion );
            _this.camera.scale.copy( cameraVR.scale );
            _this.camera.matrix.copy( cameraVR.matrix );
            _this.camera.matrixWorld.copy( cameraVR.matrixWorld );
        }

        // Start rendering the scene by resetting the rendering queue.
        // This sets up the view frustum intersector and begins scene iteration.
        _modelQueue.reset(_this.camera, _rcs.phase, _rcs.getParam("BeginPhase.moved"), _materials.getCutPlanes());

        return false;
    }

    function cmdMainRender() {
        if (!_modelQueue.isEmpty() && !_modelQueue.isDone()) {

            _rcs.screenDrawn |= _screenDrawnFlags.MODEL_DRAWN;

            //Render some geometry with the current render mode (highlighted, normal, or ghosted)
            _rcs.frameRemaining = _modelQueue.renderSome(renderSomeCallback, _rcs.frameRemaining);

            // TODO - cmdMainRender gets used by a number of systems - what sort of progress should really happen here?
            if (_rcs.signalProgressByRendering) {
                _this.signalProgress(100.0 * _modelQueue.getRenderProgress(), ProgressState.RENDERING);
                if (ENABLE_DEBUG_RCS) {
                    console.log("  %%% percent done " + (100 * _modelQueue.getRenderProgress()));
                }
            }
        }
        // if there is time left, continue on (return false), else return true, which means "stop for now"
        return !_modelQueue.isDone();
    }

    // render sectioning, if any, and any additional buffers needed, such as ID.
    function cmdSceneAfterRender() {
        _rcs.phase = RenderFlags.RENDER_FINISHED;
        _renderer.renderScenePart(_this.sceneAfter, true, true, true);

        // TODO: bad, renderScenePart does not return the amount of time used to render. It should, so we know the remaining budget.
        // TODO: to be honest, we should actually do a performance.now() at the beginning of any command list set, and
        // use *that* to track the time truly remaining. highResTimeStamp that is passed in is not trustworthy. But there's also the
        // "average batch time" that gets set, to minimize flicker. A creaky system that works, mostly.
        return false;
    }

    function cmdFinishAllRendering() {
        // in case some system is querying the phase
        _rcs.phase = RenderFlags.RENDER_FINISHED;

        return false;
    }

    function cmdSignalProcessingDone() {
        //if (_rcs.signalProgressByRendering)
        _this.signalProgress(100.0, ProgressState.RENDERING);
    }

    function cmdRenderOverlays() {
        // Render selection highlight / pivot / HUD overlays and other overlay geometry
        // This is stuff that goes into the separate overlay render buffer. It does rely on the z-buffer being properly populated,
        // so is normally rendered after the beauty pass (or highlighting pass) is performed. As such, we need to rerender it on
        // every progressive pass.

        // If there was an overlay dirty (i.e., someone hovered over something in the middle of a progressive render), note that the
        // overlay must now be drawn from here on out.
        if (_this.isOverlayDirty()) {
            // avoid having successive passes 
            _this.clearOverlayDirtyFlag();
            _rcs.drawOverlay = true;
        }

        // draw if needed
        if (_rcs.drawOverlay) {

            // If there is geometry, and we're done rendering it, OR we need to always render the overlay while moving, make the overlay
            if ((!_modelQueue.isEmpty() && _modelQueue.isDone()) || _this.showOverlaysWhileMoving) {
                _this.renderOverlays();
                _rcs.screenDrawn |= _screenDrawnFlags.OVERLAY_DRAWN;
            } else {
                // overlay update not needed (no geometry, or to be done only at end): clear once, and turn off drawing it since we need to clear only once.
                _renderer.clearAllOverlays();
                _rcs.drawOverlay = false;
            }
        }

        return false;
    }

    // if we're fading in the rollover highlight, we just need to compose the final frame.
    // This command forces PostAndPresent to happen.
    function cmdForcePresent() {
        _rcs.screenDrawn |= _screenDrawnFlags.ALL_DRAWN;
    }

    function cmdPostAndPresent() {
        //Run post-processing and present to the front buffer
        if (_rcs.screenDrawn &&
            // present if we're done rendering, or if progressive and this is a displayable frame
            (_rcs.phase === RenderFlags.RENDER_FINISHED || ((_rcs.tickCount % _this.frameDisplayRate) === 0))) {
            // Skip AO if we clear the screen and nothing else was drawn, or if
            // it was disabled when we created the command list.
            var skipAO = !_rcs.getParam("PostAndPresent.performAO")
                || (_rcs.screenDrawn & (_screenDrawnFlags.BACKGROUND_DRAWN | _screenDrawnFlags.MODEL_DRAWN)) == _screenDrawnFlags.BACKGROUND_DRAWN;
            // present image
            _renderer.composeFinalFrame(skipAO);
            _rcs.screenHasChanged = true;
            // reset
            _rcs.screenDrawn = _screenDrawnFlags.NOTHING_DRAWN;

            updateFPS(_rcs.highResTimeStamp);

            _this.api.dispatchEvent({ type: et.RENDER_PRESENTED_EVENT });
        }

        return false;    // TODO - could actually measure time at this point
    }

    // Smooth navigation overrides
    // TODO - I don't really like toggle SAO off and on during a single tick, it is a little
    // costly (how much?), but it's the safest option.
    function cmdSuppressAO() {
        if (ENABLE_DEBUG) {
            if (_renderer.getAOEnabled() === false) {
                // AO should be on and we should be suppressing it.
                logger.error("AO should be on at this point!");
            }
        }
        _renderer.setAOEnabled(false);
        return false;
    }
    function cmdRestoreAO() {
        if (ENABLE_DEBUG) {
            if (_renderer.getAOEnabled() === true) {
                // AO should be off and we should be restoring it.
                logger.error("AO should be off at this point!");
            }
        }
        _renderer.setAOEnabled(true);
        return false;
    }
    function cmdSignalRedraw() {
        _this.requestSilentRender();
        return false;
    }
    function cmdFinishedFullRender() {
        _rcs.finishedFullRender = true;
        return false;
    }

    //Main animation loop -- update camera,
    //advance animations, render if needed.
    this.tick = function (highResTimeStamp) {
        // tick() does three main operations:
        // 1. Determine if anything has changed that would trigger a new render.
        // 2. If a new render of any sort is needed, set the command system to do it.
        // 3. Check if there is a command set to run, and if so, run it.

        // TODO We have a high-res time stamp from performance.now(), but, interestingly enough,
        // it comes in about 100 ticks later than whatever number we get when we call
        // performance.now() right here. TODO - how's that work? Why this mis-sync?

        _rcs.highResTimeStamp = highResTimeStamp = highResTimeStamp || 0;   // TODO sometimes highResTimeStamp is zero. What?
        _webglrender.updateTimestamp(highResTimeStamp);

        ///////////////////////////////////////////////
        // Determine if anything has changed that would cause a new render to be performed

        // Texture uploads of newly received textures;
        // Any texture change causes a full redraw.
        var res = _materials.updateMaterials();
        _this.invalidate(res.needsClear, res.needsRender, res.overlayDirty);

        // Perform animations, return true if something animated -- this has to be done
        // before the scene update below
        var animationMoved = updateAnimations(highResTimeStamp);

        // update controls (e.g. view cube, home button, orbit, key press) and see if that has affected the view
        var controlsMoved = _this.controls.update(highResTimeStamp);

        // see if more data was loaded.
        var sceneChanged = _modelQueue && _modelQueue.update(highResTimeStamp);

        var moved = controlsMoved || animationMoved || _cameraUpdated || sceneChanged;
        // reset and record state of this frame
        _cameraUpdated = false;
        // Did the window resize since last tick?
        var canvasSizeUpdated = _needsResize;
        // checks _needsResize to see if an update is needed.
        updateCanvasSize();

        _needsClear = _needsClear || moved;
        _overlayDirty = _overlayDirty || moved;
        //var needsPresent = false;

        var rollover = false;
        var highlightIntensityChanged = _renderer.overlayUpdate();

        if (_overlayDirty) {
            // Update the selection set cloned meshes (does no rendering, yet)
            updateOverlays(highResTimeStamp);
        } else {
            // If the overlay is not dirty, fade in the overlay update over time (rollover highlighting becomes stronger).
            // If the value changes, the _blendPass needs to be redone - the overlay itself did not change, so
            // does not need to be rerendered.
            if (highlightIntensityChanged && !_overlayDirty) {
                // special case where all that is needed is the rollover hightlight blend pass
                _overlayDirty = rollover = true;
            }
            //needsPresent = _renderer.overlayUpdate();
        }

        // In case loading animation is still in progress, force render.
        if (this.isLoadingAnimationEnabled() && (_lastHighResTimeStamp - _this.lastTime2dGeometryCreated <= _webglrender.getLoadingAnimationDuration())) {
            _needsRender = true;
        }        

        var memoryLimitedisActive = _this.model && _this.model.loader && _this.model.loader.pagingProxy && _this.model.loader.pagingProxy.getMemoryInfo();
        _rcs.signalProgressByRendering = _this.model && (_this.model.isLoadDone()) && !_this.model.isLeaflet() && !memoryLimitedisActive;

        // Has the geometry changed since the last frame?
        // Note this is not the same as just the camera moving, it indicates
        // that meshes have changed position, e.g., during explode, animation, etc.
        // The main effect is that the ground plane and shadow bounds may have changed, so adjust their location and bounds.
        if (updateScene()) {
            // if the scene was indeed dirty, we'll need to render from the start
            _needsClear = true;
        }

        // If _needsClear is false at this point, nothing changed from outside. However, we might still
        // have to set _needsClear to true if the previous frame cannot be resumed. This happens when
        // when we rendered some transparent shapes before all opaque ones were rendered.
        var somethingChanged = _needsClear;
        var lastFrameValid = _modelQueue.frameResumePossible();
        _needsClear = _needsClear || !lastFrameValid;

        ///////////////////////////////////////////////
        // If a new render of any sort is needed, set the command system to do it.
        //
        // Store parameters that should not change on successive ticks, but rather control function.
        //
        // Add Command related params:
        // CMD_ALWAYS_DO - always do, no matter what. Executed every tick.
        // CMD_DO_AFTER - used in the command loop; if a command times out, any commands immediately after the timeout will be
        //              executed. This then makes progressive rendering possible: we render, timeout, and the next command(s) such as blend and present will be done.
        //              If executed, it will be executed again later when we get the next tick.
        // CMD_NORMAL_SEQUENCE - execute until done, don't come back to it once it's fully executed in the command list.

        // Is there anything at all that triggers a rerender?
        // if this is an immediate silent render, go do it. Else, check if we're still rendering; if not, then a deferred silent render can launch.
        _immediateSilentRender = _immediateSilentRender || (_deferredSilentRender && !_rcs.cmdListActive);
        if (_needsClear || _needsRender || _overlayDirty || _immediateSilentRender) {

            // For rendering purposes, rcs.drawOverlay is set true whenever any (new) overlay dirty is noticed during progressive rendering.
            // We also need to redraw the overlays if anything triggers a main scene rendering as changed depth values have to be taken into account in the overlays.
            _rcs.drawOverlay = _overlayDirty || _needsClear || _needsRender;

            // uncomment all code with _spectorDump in order to have Spector.js dump a frame when "u" (update) is clicked
            /* 
            // This version is for Chrome and Firefox's extension.
            if ( _spectorDump ) {
                _spectorDump = false;
                if ( spector ) {
                    spector.clearMarker();
                    spector.captureNextFrame(_this.canvas);
                }
            }
            */
            /*
            // This version is for Internet Explorer, which does not support an extension. You must also uncomment the Spector code in Viewer3D.js.
            if (_spectorDump) {
                _spectorDump = false;
                /*
                // use this and put a break on the jsonInString to grab the capture as text, for compare
                // (this is a bug in Spector that should be fixed someday - right now IE doesn't allow storing the session)
                window.spector.onCapture.add(function(capture) {
                    var jsonInString = JSON.stringify(capture);
                    // optional, doesn't really work: console.log(jsonInString);
                });
                window.spector.startCapture(_this.canvas);
            }
            */

            // restart rendering?
            if (_needsClear || _needsRender || _immediateSilentRender) {

                // There are three types of render:
                // 1) full render - not (currently) interruptible, runs until completion, "locks" application
                // 2) progressive render - show a bit more each tick, runs unless interrupted by a move, control, etc.
                // 3) silent render - a full render that is done unless interrupted. Display at end if not interrupted by any other render request.
                var frameBudget;
                var movedStatus = somethingChanged ? ResetFlags.RESET_RELOAD : ResetFlags.RESET_NORMAL;
                if (_needsClear || _needsRender) {
                    if (_this.progressiveRender) {
                        _rcs.renderType = _rcs.RENDERMODE_PROGRESSIVE;
                        frameBudget = _this.targetFrameBudget;
                    } else {
                        _rcs.renderType = _rcs.RENDERMODE_FULL;
                        // How much time to spend rendering the data; 1e10 is an arbitrarily large number of milliseconds, i.e., progressive is off
                        frameBudget = _this.interruptBudget;
                    }

                    if (_needsClear) {
                        // Looks like silentRender flag should only be reset when a clear happened
                        _deferredSilentRender = _immediateSilentRender = false;
                    }
                } else {
                    // Must be a silent render - really, it's the same as a full render, but has a time limit per tick
                    _rcs.renderType = _rcs.RENDERMODE_SILENT;
                    frameBudget = _this.targetFrameBudget;
                    // we must clear, just as on a full render
                    _needsClear = true;
                    movedStatus = ResetFlags.RESET_REDRAW;
                    _deferredSilentRender = _immediateSilentRender = false;
                }

                // Option to skip automatic camera update - can be used when a specific camera near-far values are desired.
                if (!_this.skipCameraUpdate) {
                    _this.updateCameraMatrices();
                }

                //if (ENABLE_DEBUG) { console.log(" COMMAND CREATION: clearing: " + _needsClear + ", rendering: " + _needsRender); }

                _rcs.setFrame(frameBudget);

                // set to true when the render is truly done
                _rcs.finishedFullRender = false;

                _rcs.beginCommandSet();

                // Set up commands for the entire sequence of possible render states. The most important thing here is to not overthink it.
                // Each command gets executed. If it runs out of time, it returns "true". On the next tick command processing will continue
                // at the same command (it's up to the command itself to keep track of where it left off). The tricky part is if a command
                // needs to be run after renders every tick, "CMD_DO_AFTER", e.g. draw overlays and present when progressive rendering is on.

                // Otherwise, just lay out the worst-case scenario for drawing the scene, "if this didn't finish here, early on, do the rest
                // later". This happens with ground reflections, for example. There's some logic in the commands themselves that check if it's
                // the first tick, for example, or if it's a progressive tick or a full-render tick.

                // Ground shadow is computed separately, if needed, so check if the feature is in use at all.
                // It is if the flag is on, it's not 2D, and we're not loading (if we are loading, the ground shadow will change
                // anyway, so we don't render it then).
                var useGroundShadow = _groundShadow.enabled && !_this.is2d && !_isLoading;
                var useGroundReflection = (!!_groundReflection) && !_this.is2d && !_isLoading;

                // build a list to do the main full pass
                var cameraChanged = moved || canvasSizeUpdated;

                // Smooth Navigation: if it's on, and "moved" is happening, and AO is on, AO is temporarily turned off in the renderer.
                // We also note this status, and use a special CMD_DO_AFTER command to turn AO back on at the end of every command execution
                // (i.e., tick that this command set runs). This avoids headaches with some other system turning off AO in between ticks -
                // it can now safely do so, without the tick() turning it back on when execution is completed or aborted.
                var suppressAO = moved && _this.skipAOWhenMoving && _renderer.getAOEnabled();

                // -----------------------------------------------------------------------------
                // Start creation of a set of commands to execute over this and following ticks.

                // Highlighting from the model browser needed?
                _rcs.addCommand(cmdBeginScene);
                _rcs.setParam("BeginScene.signalCameraChanged", cameraChanged);
                _rcs.setParam("BeginScene.clear", _needsClear);

                // for Smooth Navigation - turned on later by cmdRestoreAO as an CMD_ALWAYS_DO.
                // We let the clear above clear the SAO buffer, since if we're using smooth navigation
                // we know the SAO there will be invalid. This avoids the case where we're in a long
                // smooth-navigation render which gets interrupted by a "needs present" render (a rollover
                // highlight) which stops the full render we signalled for from completing.
                if (suppressAO) {
                    _rcs.addCommand(cmdSuppressAO, _rcs.CMD_ALWAYS_DO);
                }

                // is there any geometry to render?
                if (_modelQueue) {

                    // is shadow map needed? Generate only if not progressive.
                    if (_shadowMaps && _shadowMaps.state !== shadow.SHADOWMAP_VALID) {
                        _rcs.addCommand(cmdUpdateShadowMap);
                    }

                    // is ground shadow computed at this point? If not, and this is a full
                    // render, or this is a progressive render and it looks likely to finish,
                    // draw it.
                    if (useGroundShadow) {
                        _rcs.addCommand(cmdGenerateGroundShadow);
                        _rcs.setParam("GenerateGroundShadow.afterBeauty", false);
                        _rcs.setParam("GenerateGroundShadow.signalRedraw", false);
                    }

                    // if doing ground reflection, generate it now
                    if (useGroundReflection) {
                        // tell reflection system it needs to start from scratch once the commands start
                        _groundReflection.setDirty();

                        _rcs.addCommand(cmdGenerateGroundReflection);
                        _rcs.setParam("GenerateGroundReflection.afterBeauty", false);
                    }
                    // Blit ground shadow first, if in use and ground reflection not in use.
                    // If ground reflection is in use, the shadow is composited with its target instead.
                    // If we are truly not clearing, then don't blit ground shadow, as it was already
                    // displayed in the previous frame (possibly incorrect for this frame, but the user
                    // asked to have no clear, so...). See LMV-2571
                    else if (useGroundShadow && _needsClear) {
                        _rcs.addCommand(cmdBlitGroundShadow);
                    }


                    if (_modelQueue.hasHighlighted()) {
                        // set phase and reset
                        _rcs.addCommand(cmdBeginPhase);
                        _rcs.setParam("BeginPhase.phase", RenderFlags.RENDER_HIGHLIGHTED);
                        _rcs.setParam("BeginPhase.moved", movedStatus);
                        // need to gather frags for the iterator, etc. only once
                        movedStatus = false;

                        // draw the highlighting
                        _rcs.addCommand(cmdMainRender);

                    }

                    // beauty pass
                    _rcs.addCommand(cmdBeginPhase);
                    _rcs.setParam("BeginPhase.phase", RenderFlags.RENDER_NORMAL);
                    _rcs.setParam("BeginPhase.moved", movedStatus);
                    // need to gather frags for the iterator, etc. only once
                    movedStatus = false;
                    _rcs.addCommand(cmdMainRender);

                    // ghosting is done after the ground reflection is generated and merged, as it
                    // draws transparent atop all.
                    if (!_modelQueue.areAllVisible() && _this.showGhosting) {

                        // if we are progressive rendering, and are generating ground reflections, we do ghosting
                        // after the ground reflection is done. Else, do it now, as part of the full render, since
                        // we know everything's done.
                        // TODO I can imagine changing this logic - seems like we should have just one "ghosting
                        // after everything" bit of code insertion. The reason there is a split is that for full
                        // rendering we know the ground reflection is done at this point and can simply render atop,
                        // directly. For progressive rendering we need to wait for the reflection to finish, blend it
                        // in under, then ghost.
                        if (!useGroundReflection || (_rcs.renderType !== _rcs.RENDERMODE_PROGRESSIVE)) {
                            // show ghosting - highly transparent, so must be rendered last, atop everything else

                            //[TS] Ignore the below TODO -- I enabled rendering of sceneAfter and we will deal with the repercussions if they happen.
                            // TODO note that we don't do cmdSceneAfterRender here, though it might be nice to
                            // show sectioning. I don't really understand, but if we do add it here, the ghosted objects
                            // are drawn normally. I guess these objects need to be drawn again for sectioning?
                            _rcs.addCommand(cmdBeginPhase);
                            _rcs.setParam("BeginPhase.phase", RenderFlags.RENDER_HIDDEN);
                            _rcs.setParam("BeginPhase.moved", movedStatus);
                            _rcs.addCommand(cmdMainRender);
                        }
                        // note that all (possibly basic, for progressive) rendering is truly done.
                        _rcs.addCommand(cmdSceneAfterRender);
                    } else {
                        // Render sectioning, if any, and any additional buffers needed, such as ID.
                        // TODO for progressive rendering, it seems like we should do this *after* any Present(), if
                        // the buffers are not needed immediately. This command also notes rendering is done.
                        _rcs.addCommand(cmdSceneAfterRender);
                    }

                    if (_rcs.signalProgressByRendering) {
                        _rcs.addCommand(cmdSignalProcessingDone);
                    }
                }

                // Overlay is always rendered. In this way if we *do* get an overlay dirty while progressive rendering,
                // the overlay will get updated.
                // This must be done after the passes above, because our global rule is "draw if z-depth matches"
                // and the z-depths must be established before the highlighted objects get drawn.
                // render them. Always do this for progressive rendering, even if we stop early, since these are important.
                _rcs.addCommand(cmdRenderOverlays, (_rcs.renderType === _rcs.RENDERMODE_PROGRESSIVE) ? _rcs.CMD_DO_AFTER : _rcs.CMD_NORMAL_SEQUENCE);


                // We always need a present, since we know we're doing something. Also antialiasing and whatever blending is needed.
                // Always do this for progressive rendering.
                _rcs.addCommand(cmdPostAndPresent, (_rcs.renderType === _rcs.RENDERMODE_PROGRESSIVE) ? _rcs.CMD_DO_AFTER : _rcs.CMD_NORMAL_SEQUENCE);
                _rcs.setParam("PostAndPresent.performAO", _renderer.getAOEnabled() && !suppressAO);

                // If this is a progressive render, make the last thing to happen the ground shadow, which if not done by now will trigger
                // a rerender once it is fully created.
                if ((_rcs.renderType === _rcs.RENDERMODE_PROGRESSIVE) && _modelQueue) {

                    if (_shadowMaps && _shadowMaps.state !== shadow.SHADOWMAP_VALID) {
                        // start shadow map generation from beginning
                        _rcs.addCommand(cmdResetShadowMap);
                        _rcs.addCommand(cmdUpdateShadowMap);
                    }

                    // Ground shadows are an entirely separate render, happening concurrently with the main renderer, and
                    // done after the progressive render is performed, if not completed by then. The full render does it
                    // as part of its rerender.

                    // If we are done with progressive and the ground shadow is not done, do them now.
                    if (useGroundShadow) {
                        _rcs.addCommand(cmdGenerateGroundShadow);
                        _rcs.setParam("GenerateGroundShadow.afterBeauty", true);
                        // don't signal a redraw if the ground reflection is about to be finished and merged, too.
                        _rcs.setParam("GenerateGroundShadow.signalRedraw", !useGroundReflection);
                        // TODO really need to fix progress meter, but at least we should show 100% done
                        if (_rcs.signalProgressByRendering) {
                            _rcs.addCommand(cmdSignalProcessingDone);
                        }
                    }

                    // if the ground shadows and reflection are not done, do them now.
                    if (useGroundReflection) {
                        _rcs.groundShadowInPost = false;

                        // Note that ground shadow is guaranteed to be done at this point, so will be merged in correctly.
                        _rcs.addCommand(cmdGenerateGroundReflection);
                        _rcs.setParam("GenerateGroundReflection.afterBeauty", true);

                        // ghosting is done after the ground reflection is generated and merged, as it
                        // draws transparent atop all. Note that sectioning is already done.
                        if (!_modelQueue.areAllVisible() && _this.showGhosting) {
                            // show ghosting - highly transparent, so must be rendered last, atop everything else
                            // TODO note that we don't do cmdSceneAfterRender here, though it might be nice to
                            // show sectioning. I don't really understand, but if we do add it here, the ghosted objects
                            // are drawn normally. I guess these objects need to be drawn again for sectioning?
                            _rcs.addCommand(cmdBeginPhase);
                            _rcs.setParam("BeginPhase.phase", RenderFlags.RENDER_HIDDEN);
                            _rcs.setParam("BeginPhase.moved", movedStatus);
                            _rcs.addCommand(cmdMainRender);
                        }

                        // if it's done, perform a present
                        _rcs.addCommand(cmdFinishAllRendering);
                        _rcs.addCommand(cmdPostAndPresent);
                        _rcs.setParam("PostAndPresent.performAO", _renderer.getAOEnabled() && !suppressAO);
                        if (_rcs.signalProgressByRendering) {
                            _rcs.addCommand(cmdSignalProcessingDone);
                        }
                    }
                }

                // Smooth Navigation - if on, then we need to always turn the renderer back to AO at the end of any tick;
                // it will get turned back off the next tick by the renderer.
                if (suppressAO) {
                    _rcs.addCommand(cmdRestoreAO, _rcs.CMD_ALWAYS_DO);
                    // If we get to this command, we've done all we can during smooth navigation and should now signal for a full redraw
                    // without smooth navigation. This works because "moved" should be false on the next tick (unless of course the
                    // user moved the view) and so a full or progressive render will occurs with smooth navigation off.
                    _rcs.addCommand(cmdSignalRedraw);
                }

                _rcs.addCommand(cmdFinishedFullRender);

                _rcs.endCommandSet();

                // if we reenter, by turning these off, we then will not rebuild the command list
                _needsClear = false;
                _needsRender = false;
                // Avoid having updateOverlays() called every tick during a progressive rendering by turning off the overlay dirty flag. 
                // If we get a later overlayDirty, this will trigger updateOverlays() at the start of tick(), and will als cause the
                // cmdRenderOverlays to trigger during a progressive render.
                _overlayDirty = false;

            }
            ////////////////////////////////////////////////////////////////////////////

            // only case left is that overlay is dirty
            else {

                // Possibly draw the overlay, only.
                // Check if we've finished a render. If we are, we set up a short render to update the overlay.
                // We ignore overlay dirty if we're in the middle of a (more than one tick) render, since the render itself will update the overlay.
                if (_rcs.finishedFullRender) {

                    _rcs.beginCommandSet();

                    if (ENABLE_DEBUG_RCS) { console.log("=====\nOVERLAY DIRTY"); }

                    if (rollover) {
                        // Do just the blend pass, having already adjusted the uniform for fading in.
                        _rcs.addCommand(cmdForcePresent);

                    } else {
                        // full overlay render and display

                        // just the overlay needs to be re-rendered
                        _rcs.addCommand(cmdRenderOverlays, true);

                    }

                    // we always need a present, since we know we're doing something.
                    _rcs.addCommand(cmdPostAndPresent, true);
                    // don't need to think about AO, since we are just fading in.
                    _rcs.setParam("PostAndPresent.performAO", _renderer.getAOEnabled());

                    if (_rcs.signalProgressByRendering) {
                        _rcs.addCommand(cmdSignalProcessingDone);
                    }

                    _rcs.endCommandSet();

                    // Avoid having updateOverlays() called every tick during a progressive rendering by turning off the overlay dirty flag. 
                    // If we get a later overlayDirty, this will trigger updateOverlays() at the start of tick(), and will als cause the
                    // cmdRenderOverlays to trigger during a progressive render.
                    // Note that if we get an overlayDirty and rendering is occurring, _overlayDirty won't get cleared, which is good:
                    // we want the command system to detect this and turn on overlay rendering at that point.
                    _overlayDirty = false;
                }
            }
        }

        ///////////////////////////////////////////////
        // Run the command list, if any. Note whether there's any work to do, so we can see if this state has changed and send an event.
        _workThisTick = _rcs.cmdListActive;

        // Optional callback that's being called just before executing the render command list.
        // At this step, we already know if there is anything to render at all.
        if (_this.onBeforeRender) {
            _this.onBeforeRender(_workThisTick);
        }

        _rcs.executeCommandList();

        ///////////////////////////////////////////////
        // Keep it simple: this tick either did rendering, or it did not. If this differs from last frame's state, signal.
        if (_workThisTick !== _workPreviousTick) {
            _this.api.dispatchEvent({ type: et.FINAL_FRAME_RENDERED_CHANGED_EVENT, value: { finalFrame: !_workThisTick } });
            // we're at the end of things, so the current state now becomes the "previous tick" state for testing next time.
            _workPreviousTick = _workThisTick;
        }

        // used to determine FPS
        _lastHighResTimeStamp = _rcs.highResTimeStamp;
    };

    // webVR has a requestAnimationFrame handler specific to HMD displays 
    this.setLmvDisplay = function (display) {
        _lmvDisplay = display;
    };

    this.run = function () {
        //Begin the render loop (but delay first repaint until the following frame, so that
        //data load gets kicked off as soon as possible
        _reqid = 0;
        setTimeout(function () {
                                           
            {
                (function animloop(highResTimeStamp) {
                    _reqid = _lmvDisplay.requestAnimationFrame(animloop);
                    _this.tick(highResTimeStamp);
                })();
            }
                     
             
                                                    
                                                                   
                                                 
                  
                                                         
             
                      

        }, 1);
    };

    this.stop = function () {
                                       
        {
            let _window = _this.getWindow();
            _window.cancelAnimationFrame(_reqid);
        }
                 
         
                                                                
                                
         
                  
    };

    this.toggleProgressive = function (value) {
        this.progressiveRender = value;
        _needsClear = true;
    };

    // Apply current clear colors to renderer while considering swapBlackAndWhite flag when in 2D
    this.updateClearColors = function () {
        var clearColor = this.clearColorTop;

        // apply black/white swap to clear color if wanted
        if (this.is2d && this.swapBlackAndWhite) {
            var isWhite = (clearColor.x === 1 && clearColor.y === 1 && clearColor.z === 1);
            var isBlack = (clearColor.x === 0 && clearColor.y === 0 && clearColor.z === 0);
            if (isWhite) {
                clearColor = new THREE.Color(0, 0, 0);
            } else if (isBlack) {
                clearColor = new THREE.Color(1, 1, 1);
            }
        }

        _renderer.setClearColors(clearColor, this.clearColorBottom);
    };

    this.toggleSwapBlackAndWhite = function (value) {
        this.swapBlackAndWhite = value;
        this.updateClearColors();
        _needsClear = true;
    };

    this.toggleGrayscale = function (value) {
        _materials.setGrayscale(value);
        _needsClear = true;
    };

    this.toggleGhosting = function (value) {
        this.showGhosting = value;
        _needsClear = true;
    };

    this.toggleOverlaysWhileMoving = function (value) {
        this.showOverlaysWhileMoving = value;
    };

    this.togglePostProcess = function (useSAO, useFXAA) {
        _renderer.initPostPipeline(useSAO, useFXAA);
        this.fireRenderOptionChanged();
        _needsClear = true;
    };

    this.toggleCmdMapping = function (value, controller) {
        controller.keyMapCmd = value;
    };

    this.toggleGroundShadow = function (value) {
        if (_groundShadow.enabled === value)
            return;

        _groundShadow.enabled = value;
        _groundShadow.clear();
        if (value) {
            _groundShadow.setDirty();
        }
        // if we're turning on the ground shadow, we need to set up the ground plane
        updateGroundTransform();
        this.fireRenderOptionChanged();
        this.invalidate(true, false, false);
    };


    /**
     * Check if the ground shadows are enabled
     * @private
     */
    this.isGroundShadowEnabled = function () {
        return _groundShadow && _groundShadow.enabled;
    };

    this.setGroundShadowColor = function (color) {
        if (!_groundShadow.enabled) return;

        _groundShadow.setColor(color);
        this.invalidate(true, false, false);
    };

    this.setGroundShadowAlpha = function (alpha) {
        if (!_groundShadow.enabled) return;

        _groundShadow.setAlpha(alpha);
        this.invalidate(true, false, false);
    };

    this.toggleGroundReflection = function (enable) {
        if ((enable && !!_groundReflection) ||
            (!enable && !_groundReflection))
            return;

        if (enable) {
            _groundReflection = new GroundReflection(_webglrender, this.canvas.clientWidth, this.canvas.clientHeight, { clearPass: _renderer.getClearPass() });
            _groundReflection.setClearColors(this.clearColorTop, this.clearColorBottom, isMobileDevice());
            _groundReflection.toggleEnvMapBackground(_envMapBackground);
            _groundReflection.setEnvRotation(_renderer.getEnvRotation());
            // if we're turning on the ground reflection, we need to set up the ground plane
            updateGroundTransform();
        }
        else {
            _groundReflection.cleanup();
            _groundReflection = undefined;
        }

        this.fireRenderOptionChanged();
        this.invalidate(true, false, false);
    };

    this.setGroundReflectionColor = function (color) {
        if (!_groundReflection) return;

        _groundReflection.setColor(color);
        this.invalidate(true, false, false);
    };

    this.setGroundReflectionAlpha = function (alpha) {
        if (!_groundReflection) return;

        _groundReflection.setAlpha(alpha);
        this.invalidate(true, false, false);
    };

    this.toggleEnvMapBackground = function (value) {
        _envMapBackground = value;
        _renderer.toggleEnvMapBackground(value);

        if (_groundReflection) {
            _groundReflection.toggleEnvMapBackground(value);
        }
        this.invalidate(true, true, false);
    };

    this.isEnvMapBackground = function () {
        return _envMapBackground;
    };

    this.setOptimizeNavigation = function (value) {
        this.skipAOWhenMoving = value;
    };

    // If we have selection meshes, this function makes sure that they use exactly the same
    // geometry as we used in the main scene rendering. This is needed to avoid z-buffer artifacts
    // when using consolidation.
    function updateSelectionProxies() {
        for (var id in _this.selectionMeshes) {
            var proxy = _this.selectionMeshes[id];

            // Updating proxies is only relevant when using consolidtion. Otherwise, we always use the original
            // fragment geometry and can keep static proxy geometry.
            if (proxy.model && proxy.model.isConsolidated()) {
                proxy.model.updateRenderProxy(proxy, proxy.fragId);
            }
        }
    }

    this.renderOverlays = function () {

        updateSelectionProxies();

        //The overlays (selection, pivot, etc) get lighted using
        //the default lights, even if IBL is on
        var lightsOn = this.lightsOn;
        if (!lightsOn) {
            this.toggleLights(true, true);
        }

        var oldIntensity;
        if (this.dir_light1) {
            oldIntensity = this.dir_light1.intensity;
            this.dir_light1.intensity = 1;
        }

                                       
        {
            _renderer.renderOverlays(this.overlayScenes, this.lightsOn ? this.lights : this.no_lights);
        }
                 
                     
                                                         
         
                  

        if (!lightsOn) {
            this.toggleLights(false, true);
        }

        if (this.dir_light1)
            this.dir_light1.intensity = oldIntensity;
    };

    this.setLayerVisible = function (layerIndexes, visible) {
        this.layers.setLayerVisible(layerIndexes, visible);
    };

    this.isLayerVisible = function (layerIndex) {
        return this.layers.isLayerVisible(layerIndex);
    };

    this.getVisibleLayerIndices = function () {
        return this.layers.getVisibleLayerIndices();
    };

    this.setNearRadius = function (radius, redraw) {
        if (this.nearRadius !== radius) {
            this.nearRadius = radius;
            if (redraw) {
                this.invalidate(true);
            }
        }
    };

    this.getNearRadius = function () {
        return this.nearRadius;
    };

    // Find model's bounds, including ground plane, if needed.
    // Fit near and far planes to the model.
    this.updateNearFarValues = (function () {

        var tmpCameraMatrix;
        var tmpViewMatrix;
        var tmpBox;

        function init_three() {
            tmpCameraMatrix = new THREE.Matrix4();
            tmpViewMatrix = new THREE.Matrix4();
            tmpBox = new THREE.Box3();
        }

        return function (camera, worldBox) {

            if (worldBox.isEmpty()) {
                logger.warn('Calculating near-far values based on empty worldBox (infinity) will result in incorrect values - Better to keep previous values instead.');
                return;
            }

            if (!tmpBox)
                init_three();

            //NOTE: This is not computing the same matrix as what we use for rendering,
            //in cases where we are in ORTHO mode and the camera is inside the model,
            //which would result in negative near plane. For the purposes of computing
            //the near/far planes, we have to skip the logic that adjusts the view matrix
            //based on the near/far planes. See UnifiedCamera.updateMatrix for the related
            //adjustment to the view matrix.
            tmpCameraMatrix.compose(camera.position, camera.quaternion, camera.scale);
            tmpViewMatrix.copy(tmpCameraMatrix).invert();

            tmpBox.copy(worldBox);

            //If reflection is on, then we need to double the worldBox size in the Y
            //direction, the reflection direction, otherwise the reflected view can be
            //clipped.
            if (_groundReflection) {
                // Increase bounding box to include ground reflection geometry. The idea
                // here is to extend the bounding box in the direction of reflection, based
                // on the "up" vector.
                var tmpVecReflect = new THREE.Vector3();
                tmpVecReflect.multiplyVectors(tmpBox.max, camera.worldup);
                var tmpVecMin = new THREE.Vector3();
                tmpVecMin.multiplyVectors(tmpBox.min, camera.worldup);
                tmpVecReflect.sub(tmpVecMin);
                // tmpVecReflect holds how much to increase the bounding box.
                // Negative values means the "up" vector is upside down along that axis,
                // so we increase the maximum bounds of the bounding box in this case.
                if (tmpVecReflect.x >= 0.0) {
                    tmpBox.min.x -= tmpVecReflect.x;
                } else {
                    tmpBox.max.x -= tmpVecReflect.x;
                }
                if (tmpVecReflect.y >= 0.0) {
                    tmpBox.min.y -= tmpVecReflect.y;
                } else {
                    tmpBox.max.y -= tmpVecReflect.y;
                }
                if (tmpVecReflect.z >= 0.0) {
                    tmpBox.min.z -= tmpVecReflect.z;
                } else {
                    tmpBox.max.z -= tmpVecReflect.z;
                }
            }

            // Expand the bbox based on ground shadow. Note that the horizontal extent of the ground shadow
            // may be significantly larger for flat shadow light directions.
            if (_shadowMaps && _shadowMaps.groundShapeBox) {
                tmpBox.union(_shadowMaps.groundShapeBox);
            }

            //Transform the world bounds to camera space
            //to estimate the near/far planes we need for this frame
            tmpBox.applyMatrix4(tmpViewMatrix);

            //Expand the range by a small amount to avoid clipping when
            //the object is perfectly aligned with the axes and has faces at its boundaries.
            var sz = 1e-5 * (tmpBox.max.z - tmpBox.min.z);

            //TODO: expand for ground shadow. This just matches what the
            //ground shadow needs, but we need a better way to take into account
            //the ground shadow scene's bounds
            var expand = (tmpBox.max.y - tmpBox.min.y) * 0.5;

            var dMin = -(tmpBox.max.z + sz) - expand;
            var dMax = -(tmpBox.min.z - sz) + expand;

            //Camera is inside the model?
            if (camera.isPerspective) {
                // If dMax / dMin is too large then we get z buffer fighting, which we would
                // like to avoid. In this case there are two alterniatives that we can do -
                // we can move the near plane away from the camera, or we can move the far
                // place toward the camera. If this.nearRadius is > 0, then we want to move
                // the far plane toward the camera.
                if (this.nearRadius > 0) {
                    // dMin might be OK, or might be negative or close to 0. If it is so small
                    // that depth precision will be bad, then we need to move it away from 0
                    // but no further than this.nearRadius.
                    dMin = Math.max(dMin, Math.min(this.nearRadius, Math.abs(dMax - dMin) * 1e-4));

                    // If the max is still too far away, then move it closer
                    dMax = Math.min(dMax, dMin * 1e4);
                } else {
                    // dMin might be OK, or might be negative. If it's negative,
                    // give it a value of 1/10,000 of the entire scene's size relative to this view direction,
                    // or 1, whichever is *smaller*. It's just a heuristic.
                    dMin = Math.max(dMin, Math.min(1, Math.abs(dMax - dMin) * 1e-4));

                    if (dMax < 0) {
                        // near and far planes should always be positive numbers for perspective
                        dMax = 1e-4;
                    }
                    // One more attempt to improve the near plane: make it 1/100,000 of the distance of the
                    // far plane, if that's higher.
                    // See https://wiki.autodesk.com/display/LMVCORE/Z-Buffer+Fighting for reasoning.
                    // 1e-4 is generally good below, but inside Silver Cross we get a lot of near clipping. So, 1e-5.
                    dMin = Math.max(dMin, dMax * 1e-5);
                }

                // Correct near plane so it won't be farther than the actual distance to the world bounds.
                const boxDist = Math.sqrt(SceneMath.pointToBoxDistance2(camera.position, worldBox));
                // In case the that the camera is inside the bounds, boxDist will be 0. In that case let's set the minimum distance to 1.
                const minDistToBox = Math.max(1, boxDist);
                dMin = Math.min(dMin, minDistToBox);
            } else {
                //TODO:
                //Do nothing in case of ortho. While this "fixes" near plane clipping too aggressively,
                //it effectively disallows moving through walls to go inside the object.
                //So we may need some heuristic based on how big we want the object to be
                //on screen before we let it clip out.
                //dMin = Math.max(dMin, 0);
            }

            //The whole thing is behind us -- nothing will display anyway?
            dMax = Math.max(dMax, dMin);

            // https://jira.autodesk.com/browse/BLMV-4989
            // Since version 14.0 of Safari, there is a significant precision issue when camera.near is below 1.
            // The reason for this regression, is that they probably changed the depth buffer to be 16 bit instead of 24 bit.
            // When forcing Safari to use WebGL2, the problem is gone.
            //
            // Since 16 bit is not good enough for small camera.near values, we need to decide when exactly we should override it.
            // According to this thread: https://community.khronos.org/t/how-big-exactly-is-16bit-depth/26871/11
            // When the ratio of max / min is over 2000, 16bit is not enough. So only in this case, we can change camera.near to 1, to prevent precision problems.
            //
            // This fix can be removed once WebGL2 will be enabled by default in Safari (currently it's still experimental in Safari).
            if (Autodesk.Viewing.isSafari() && !this.glrenderer().capabilities.isWebGL2) {
                const ratio = dMax / dMin;

                if (camera.isPerspective && ratio > 2000) {
                    dMin = Math.max(dMin, 1);
                }
            }

            camera.near = dMin;
            camera.far = dMax;
            camera.updateCameraMatrices();
        };
    })();

    this.getPixelsPerUnit = function (camera, worldBox, model = this.model) {
        var deviceHeight = _renderer.settings.deviceHeight; // = canvas height * pixelRatio

        //If there is a cutting plane, get a point on that plane
        //for by the pixel scale computation. (only used for 3D)
        var cutPlanes = _materials.getCutPlanesRaw();
        var cutPlane = cutPlanes[0];

        var modelBox = model ? model.getBoundingBox() : worldBox;

        return SceneMath.getPixelsPerUnit(camera, this.is2d, worldBox, deviceHeight, cutPlane, modelBox);
    };

    this.updateCameraMatrices = function () {
        const camera = this.camera;

        //TODO: Would be nice if this got called by the world up tool instead,
        //so that we don't have to update it every frame.
        if (camera.worldup)
            this.setWorldUp(camera.worldup);

        // Update near & far values according to the unified bounds of all the models in modelQueue.
        // There is a special case for underlay raster, where `this.model` is not set, but there is a temp model inside modelQueue - this
        // is why we update these values even if `this.model` is not set.
        const worldBox = this.getVisibleBounds(true, _overlayDirty);
        this.updateNearFarValues(camera, worldBox);

        // Optional: If a maxDistance is set, allow excluding some boxes if near/far distance gets too large.
        this.maxModelDistance && this._applyMaxModelDistanceToNearFar();

        // Update the line width scale with the new pixels per unit scale.
        const pixelsPerUnit = this.getPixelsPerUnit(camera, worldBox);
        const width = _renderer.settings.deviceWidth;
        const height = _renderer.settings.deviceHeight;
        if (this.is2d) {
            //If we want to take into account devicePixelRatio for line weights (so that lines are not too thin)
            //we can do this here, but it's less esthetically pleasing:
            //pixelsPerUnit /= _webglrenderer.getPixelRatio();

            _materials.updatePixelScale(pixelsPerUnit, width, height, camera);

            // AutoCAD drawings are commonly displayed with white lines on a black background. Setting reverse swaps (just)
            // these two colors.
            _materials.updateSwapBlackAndWhite(this.swapBlackAndWhite);
        } else { // is3d

            _materials.updatePixelScale(pixelsPerUnit, width, height, camera);
        }

        // Set pixelsPerUnit according to each sheet in 3D space. In general, it is set according to the modelQueue's bounds
        // which is not related to how we want to present the sheet (i.e. the line thickness will vary when selecting a
        // floor as a result, because of the changing viewing volume)
        // Note: Previously this was done only when in 3D mode, but it's also needed in 2D in case a transform with
        // scaling is set.
        const models = this.get2DModels();
        models.forEach(model => {
            const transform = model.getModelToViewerTransform();
            const scaling = transform ? transform.getMaxScaleOnAxis() : 1;
            if (!this.is2d || scaling !== 1) {
                const bounds = model.getVisibleBounds();
                // Sending is2d:true here because we want the calculation path done for 2D sheets
                const pixelsPerUnit = SceneMath.getPixelsPerUnit(camera, true, bounds, height, null, bounds);

                _materials.updatePixelScaleForModel(model, pixelsPerUnit, width, height, scaling, camera);
            }
        });
    };

    this.initLights = function () {
        if (_lightsInitialized) {
            return;
        }

        this.dir_light1 = new THREE.DirectionalLight(_defaultDirLightColor, _defaultLightIntensity);
        this.dir_light1.position.copy(_lightDirDefault);

        //Note this color will be overridden by various light presets
        this.amb_light = new THREE.AmbientLight(_defaultAmbientColor);

        // Set this list only once, so that we're not constantly creating and deleting arrays each frame.
        // See https://www.scirra.com/blog/76/how-to-write-low-garbage-real-time-javascript for why.
        // use this.no_lights empty array if no lights are needed.
                                       
        {
            this.lights = [this.dir_light1, this.amb_light];
        }
                 
         
                                                                                                              
                                                       
                                                      
         
                  

        //We do not add the lights to any scene, because we need to use them
        //in multiple scenes during progressive render.
        //this.scene.add(this.amb_light);

        // Attach the light to the camera, so that the light direction is applied in view-space.
        // Note:
        //
        //  1. For directional lights, the direction where the light comes from is determined by
        //     lightPosition - targetPosition, both in in world-space.
        //  2. The default target of dir lights is the world origin.
        //  3. Transforming the light object only affects the light position, but has no effect on the target.
        //
        // The goal is to rotate the lightDir with the camera, but keep it independent
        // of the camera position. Due to 3. above, we must also attach the light's target object to the camera.
        // Otherwise, the camera position would incorrectly be added to the light direction.

        this.camera.add(this.dir_light1);
        this.camera.add(this.dir_light1.target);

        _lightsInitialized = true;
    };

    var setLights = function (amb_light, dir_light1, state, isForOverlay) {
        //Update the light colors based on the current preset
        var preset = LightPresets[_currentLightPreset];
        var ac = preset && preset.ambientColor;
        var dc = preset && preset.directLightColor;

        ac = ac || _defaultAmbientColor.toArray();
        dc = dc || _defaultDirLightColor.toArray();

        if (state) {
            if (isForOverlay && amb_light)
                amb_light.color.setRGB(dc[0] * 0.5, dc[1] * 0.5, dc[2] * 0.5);
            else if (amb_light) {
                amb_light.color.setRGB(ac[0], ac[1], ac[2]);
            }

            if (dir_light1) {
                dir_light1.color.setRGB(dc[0], dc[1], dc[2]);
            }
        }
        else {
            //Restores the ambient for the main scene after drawing overlays
            if (amb_light && isForOverlay)
                amb_light.color.setRGB(ac[0], ac[1], ac[2]);
        }
    };


    this.toggleLights = function (state, isForOverlay) {

        //This can happen during initial construction
        if (!this.amb_light)
            return;

        // Don't create or remove arrays, as that's bad to do during rendering.
        // Instead, later use lightsOn to decide which array to use.
        this.lightsOn = state;

                                       
         
                                        
         
                  

        setLights(this.amb_light, this.dir_light1, state, isForOverlay);
    };

    //Forces the view controller to update when the camera
    //changes programmatically (instead of via mouse events).
    this.syncCamera = function (syncWorldUp) {
        this.camera.updateCameraMatrices();

        if (syncWorldUp)
            this.setWorldUp(this.api.navigation.getWorldUpVector());

        _cameraUpdated = true;
    };

    /**
     * Get the model's initial camera
     * @param {Model} model
     * @returns camera
     */
    this.getModelCamera = function (model) {
        if (!model) return;
        let camera;
        const defaultCamera = model.getDefaultCamera();
        if (defaultCamera) {
            camera = defaultCamera;
        } else {
            //Model has no default view. Make one up based on the bounding box.
            camera = UnifiedCamera.getViewParamsFromBox(
                model.getBoundingBox(),
                model.is2d(),
                this.camera.aspect,
                this.camera.up,
                this.camera.fov
            );
        }
        return camera;
    };


    this.setViewFromFile = function (model, skipTransition) {

        if (!model) {
            return;
        }

        var camera = this.getModelCamera(model);

        //[TS] WTF, this is a hack that should not be here, the viewer3dimpl is not supposed to know
        //about tools at all!
        // If the current orbiting mode is unconstrained (the 'freeorbit' tool),
        // use exact camera settings, otherwise (the 'orbit' tool) snap the up vector to a world axis.
        // However, if this is the initial load and the model has a free orbit navigation mode defined
        // we will use the exact camera settings no matter if the free orbit tool is active or not.
        // Note #1: that 'freeorbit' vs. 'orbit' tools are active even when the FusionOrbit extension is used.
        // Note #2: isToolActivated is not available in node-lmv, so we stub it to always return false
        var navModeHint = model.getMetadata('navigation hint', 'value', null);
        var useExactCamera = this.controls.isToolActivated('freeorbit') ||
            (skipTransition && navModeHint === "Freeorbit");

        this.setViewFromCamera(camera, skipTransition, useExactCamera);
    };

    //Camera is expected to have the properties of a THREE.Camera.
    this.adjustOrthoCamera = function (camera) {
        var bbox = this.getVisibleBounds();
        UnifiedCamera.adjustOrthoCamera(camera, bbox);
    };

    /**
     * Switches to a new view based on a given camera. If the current orbiting mode is constrained,
     * the up vector may be adjusted.
     *
     * @param {THREE.Camera} camera Input camera.
     * @param {boolean} skipTransition Switch to the view immediately instead of transitioning.
     * @param {boolean} useExactCamera -- whether any up vector adjustment is to be done (to keep head up view)
     */
    this.setViewFromCamera = function (camera, skipTransition, useExactCamera) {
        this.adjustOrthoCamera(camera);

        // Choose the first up-vector we get from the main model.
        // We assume all models have identical up vectors - otherwise, the aggregated model would be weird anyway.
        var upVectorArray = this.model ? this.model.getUpVector() : null;

        var worldUp;
        if (upVectorArray) {
            worldUp = new THREE.Vector3().fromArray(upVectorArray);
        } else {
            worldUp = useExactCamera ? camera.up.clone() : Navigation.snapToAxis(camera.up.clone());
        }

        if (useExactCamera) {
            if (this.api.prefs)
                this.api.prefs.set('fusionOrbitConstrained', worldUp.equals(camera.up));
        } else {
            camera.up = worldUp;
        }

        var navapi = this.api.navigation;
        if (navapi) {

            var tc = this.camera;

            if (!skipTransition) {
                tc.isPerspective = camera.isPerspective;

                if (!camera.isPerspective) {
                    tc.saveFov = camera.fov;    // Stash original fov
                    camera.fov = UnifiedCamera.ORTHO_FOV;
                }

                if (useExactCamera) {
                    navapi.setRequestTransitionWithUp(true, camera.position, camera.target, camera.fov, camera.up, worldUp);
                } else {

                    // Fix camera's target if it is not inside the scene's bounding box.
                    var bbox = this.getVisibleBounds();
                    if (!bbox.containsPoint(camera.target)) {
                        var distanceFromCenter = bbox.getCenter(new THREE.Vector3()).distanceTo(camera.position);
                        var direction = camera.target.clone().sub(camera.position).normalize().multiplyScalar(distanceFromCenter);
                        camera.target.copy(camera.position.clone().add(direction));
                    }

                    var up = navapi.computeOrthogonalUp(camera.position, camera.target);
                    navapi.setRequestTransitionWithUp(true, camera.position, camera.target, camera.fov, up, worldUp);
                }
            } else {
                //This code path used during initial load -- it sets the view directly
                //without doing a transition. Transitions require that the camera is set explicitly

                tc.up.copy(camera.up);
                tc.position.copy(camera.position);
                tc.target.copy(camera.target);
                if (camera.isPerspective) {
                    tc.fov = camera.fov;
                }
                else {
                    tc.saveFov = camera.fov;    // Stash original fov
                    tc.fov = UnifiedCamera.ORTHO_FOV;
                }
                tc.isPerspective = camera.isPerspective;
                tc.orthoScale = camera.orthoScale;
                tc.dirty = true;

                navapi.setWorldUpVector(useExactCamera ? worldUp : tc.up);
                navapi.setView(tc.position, tc.target);
                navapi.setPivotPoint(tc.target);

                this.syncCamera(true);
            }
        }
        _cameraUpdated = true;
    };

    /**
     * Performs the inverse operation than Viewer3D.setViewFromArray() using
     * the current camera values.
     * 
     * @param {object} [globalOffset] - { x:Number, y:Number, z:Number } that gets substracted from position and target.
     * 
     * @returns {Array} with 13 elements
     */
    this.getViewArrayFromCamera = function (globalOffset) {

        var off = globalOffset || { x: 0, y: 0, z: 0 };
        var cam = this.camera;

        var worldUp;
        var upVectorArray = this.model.getUpVector();
        if (upVectorArray) {
            worldUp = new THREE.Vector3().fromArray(upVectorArray);
        } else {
            worldUp = Navigation.snapToAxis(cam.up.clone());
        }

        var target = this.api.navigation.getPivotPoint();

        var ret = [
            cam.position.x + off.x, cam.position.y + off.y, cam.position.z + off.z,
            target.x + off.x, target.y + off.y, target.z + off.z,
            worldUp.x, worldUp.y, worldUp.z,
            cam.aspect,
            THREE.Math.degToRad(cam.fov),
            cam.orthoScale,
            cam.isPerspective ? 0 : 1
        ];

        return ret;
    };

    this.setViewFromViewBox = function (model, viewbox, name, skipTransition) {
        if (!model.is2d()) {
            return;
        }


        var camera = {};

        var bbox = model.getBoundingBox();

        var box = {
            width: viewbox[2] - viewbox[0],
            height: viewbox[3] - viewbox[1]
        };
        box.aspect = box.width / box.height;
        box.centerX = viewbox[0] + box.width / 2;
        box.centerY = viewbox[1] + box.height / 2;

        var screenAspect = this.camera.aspect;

        //Fit the viewbox to the screen
        if (screenAspect > box.aspect)
            camera.orthoScale = box.height;
        else
            camera.orthoScale = box.width / screenAspect;

        const bboxCenter = bbox.getCenter(new THREE.Vector3());
        camera.isPerspective = false;
        camera.position = new THREE.Vector3(box.centerX, box.centerY, bboxCenter.z + camera.orthoScale);
        camera.target = new THREE.Vector3(box.centerX, box.centerY, bboxCenter.z);
        camera.target.y += 1e-6 * box.height;

        camera.up = new THREE.Vector3(0, 0, 1);

        this.setViewFromCamera(camera, skipTransition, false);
    };

    this.setWorldUp = function (upVector) {

        if (_worldUp.equals(upVector))
            return;

        _worldUp.copy(upVector);

        // get the (max) up axis and sign
        var maxVal = Math.abs(upVector.x);
        _worldUpName = "x";
        if (Math.abs(upVector.y) > maxVal) {
            _worldUpName = "y";
            maxVal = Math.abs(upVector.y);
        }
        if (Math.abs(upVector.z) > maxVal) {
            _worldUpName = "z";
        }

        var getRotation = function (vFrom, vTo) {
            var rotAxis = (new THREE.Vector3()).crossVectors(vTo, vFrom).normalize();  // not sure why this is backwards
            var rotAngle = Math.acos(vFrom.dot(vTo));
            return (new THREE.Matrix4()).makeRotationAxis(rotAxis, rotAngle);
        };

        var identityUp = new THREE.Vector3(0, 1, 0);
        _this.camera.worldUpTransform = getRotation(identityUp, upVector);

        this.sceneUpdated(false);
    };

    this.setUp2DMode = function (model, isOverlay) {
        const data = model.getData();

        // Initialize layer texture if needed. Note that some files may not have layers at all, e.g., leaflets.
        if (data.layerCount) {
            _materials.initLayersTexture(data.layerCount, data.layersMap, model.id);
        }

        // The id material is not specific to a model, so don't make it a model material.
        // If the id material is attached to a model, you can get into this situation:
        // Load two models m1 first and then m2 into the same RenderContext and MaterialManager.
        // At the end of this the RenderContext's id material is attached to m2. Then transfer
        // m2 to a new RenderContext and MaterialManager. Because the id material is attached
        // to m2, it is transfered to the new context, but it is still the id material in the
        // first context, too. There isn't anything in the id material that is specific to a model,
        // so keeping the id material from being attached to a model, fixes that issue.
        const idMatName = _materials.create2DMaterial(null, {}, true, false, function () { _this.invalidate(false, true, false); });
        const idMaterial = _materials.findMaterial(null, idMatName);

        if (!isOverlay) {
            // In case the previous model was 2d, first exit the previous 2d mode, and only then re-enter it again.
            if (this.is2d) {
                _renderer.exit2DMode();
            }

            // When loading single leaflet models, don't ask for ids.
            _renderer.enter2DMode(idMaterial, this.matman().get2dSelectionColor());

            // If we were in 3d mode before, save lightPreset first before replacing it by 2d preset
            if (!this.is2d) {
                this.saveLightPreset();
            }

            this.is2d = true;

            this.setLightPreset(DefaultLightPreset2d);
            this.setRenderingPrefsFor2D(true);

            const svf = model.getData();
            if (svf.hidePaper) {
                var bg = svf.bgColor;
                var r = (bg >> 16) & 0xff;
                var g = (bg >> 8) & 0xff;
                var b = bg & 0xff;
                this.setClearColors(r, g, b, r, g, b);
            }
        }
    };

    this.addModel = function (model, preserveTools) {
        if (!model)
            return;

        //Is it the first model being loaded into the scene?
        var isOverlay = !!this.model;
        var is2d = model.is2d();

        if (!this.model && !model.getData().underlayRaster) {
            this.model = model;

            _renderer.setUnitScale(model.getUnitScale());
        }

        // Initialize layers.
        if (!this.layers) {
            this.layers = new ModelLayers(this);
        }

        if (!model.getData().underlayRaster) {
            this.layers.addModel(model, /*defer3d*/ true);
        }

        //Create a render list for progressive rendering of the
        //scene fragments
        _modelQueue.addModel(model);
        this.selector.addModel(model);
        this.visibilityManager.addModel(model);

        this._setModelPreferences(model);

        // In case of a 2D drawing initialize the common line shader and the layers texture.
        if (is2d) {
            this.setUp2DMode(model, isOverlay);
        } else if (this.is2d) {
            // If a previous model was 2d and the newly inserted model is 3d, switch off 2d mode.
            this.is2d = undefined;
            _renderer.exit2DMode();
        } else if (_3dLightPreset >= 0) {
            // LMV-5655: Keep track of the last 3d light preset.
            // There was an issue when switching from 3d -> 2d -> 2d -> 3d.
            // For this case the _oldLightPreset would be overridden with environment 0.
            _oldLightPreset = _3dLightPreset;
        }

        // Make sure that swapBlackAndWhite toggle is only considered as long as we are in 2d
        this.updateClearColors();

        this.setupLighting(model);
        syncIdTargetCount();

        this.fireRenderOptionChanged();
        this.invalidate(true);

        // Fire an event for the addition of a model into the _modelQueue
        this.api.fireEvent({ type: et.MODEL_ADDED_EVENT, model, preserveTools, isOverlay });
    };

    this._setModelPreferences = function (model) {

        // This is the place to load from preferences when a new model is added

        // Apply current renderLines/renderPoints settings
        model.hideLines(!this.api.prefs.get('lineRendering'));
        model.hidePoints(!this.api.prefs.get('pointRendering'));

        // selection mode
        model.selector.setSelectionMode(this.api.prefs.get(Prefs3D.SELECTION_MODE));

    };

    this.setupLighting = function (model) {

        model = model || this.model;

        if (isNodeJS() || !model || model.is2d()) {
            return;
        }

        // grab the environment preset data from the file.
        //This will usually be set for Fusion files.
        if (!this.setLightPresetFromFile(model)) {
            //When switching from a 2D sheet back to a 3D view,
            //we restore the environment map that was used for the
            //last 3D view displayed. The operation is delayed until here
            //so that switching between 2D sheets does not incur this unnecessary overhead.
            if (_oldLightPreset >= 0) {
                this.setLightPreset(_oldLightPreset, true, _oldCallback);
                _oldLightPreset = -1;
                _oldCallback = null;
            } else {
                this.setLightPreset(_currentLightPreset, false);
            }
        }

        this.setAOHeuristics(model);
    };

    this.getSvfMaterialId = function (fragId) {
        return this.model.getFragmentList().getSvfMaterialId(fragId);
    };

    this.getMaterials = function () { return _materials; };


    //Creates a THREE.Mesh representation of a fragment. Currently this is only
    //used as vehicle for activating a fragment instance for rendering once its geometry is received
    //or changing the fragment data (matrix, material). So, it's mostly vestigial.
    this.setupMesh = function (model, threegeom, materialId, matrix) {

        var m = {
            geometry: threegeom,
            matrix: matrix,
            isLine: threegeom.isLines,
            isWideLine: threegeom.isWideLines,
            isPoint: threegeom.isPoints,
            is2d: threegeom.is2d
        };

        if (materialId)
            m.material = this.matman().setupMaterial(model, threegeom, materialId);

        // Update creation time for loading animation.
        if (model.is2d()) {
            m.geometry.creationTime = _lastHighResTimeStamp;
            this.lastTime2dGeometryCreated = _lastHighResTimeStamp;
        }

        return m;
    };

    function selection2dOverlayName(model) {
        //We have to use the material hashing from MaterialManager so that
        //the material gets cleaned up when the model is unloaded.
        return _materials._getMaterialHash(model, "selection2d");
    }

    this.init2dSelection = function (model) {

        var overlayName = selection2dOverlayName(model);
        if (this.overlayScenes[overlayName]) {
            // Selection already initialized for this model
            return;
        }

        // create selection texture and material
        // Note: We assume here that the selection material for this model does not exist yet. (otherwise, the params in create2DMaterial would be ignored)
        var selectionTexture = _materials.initSelectionTexture(model.getData().maxObjectNumber, model.id);
        const modelFrags = model.getFragmentList();
        const doNotCut = model.getDoNotCut();

        let viewportBounds;

        if (modelFrags?.viewBounds) {
            const bounds = modelFrags.viewBounds;
            viewportBounds = new THREE.Vector4(bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y);
        }

        var selMatName = _materials.create2DMaterial(model, { doNotCut, viewportBounds }, false, selectionTexture, function () { _this.invalidate(false, true, false); });
        var selMat = _materials.findMaterial(model, selMatName);

        this.createOverlayScene(overlayName, selMat);
    };

    // Gets called by the active Loader
    this.onLoadComplete = function (model) {
        _isLoading = false;

        this.signalProgress(100, ProgressState.LOADING);

        if (this.modelVisible(model.id)) {
            // Only if ground shadows or reflections are on do we need to emit a refresh.
            if ((_groundShadow && _groundShadow.enabled) || _groundReflection) {
                this.sceneUpdated(false, true);
            }
            this.invalidate(!!_groundReflection, true, false);
        }

        //In the case of 2d drawing, initialize the dbIds texture
        //to be used for selection highlighting.
        // Note that we cannot do this earlier: Creating the texture requires to know model.myData.maxObjectNumber - which
        // is dynamically increased during loading and not known on model-add.
        if (model.is2d()) {
            this.init2dSelection(model);
        }

        var geomList = model.getGeometryList();
        if (geomList) {
            geomList.printStats();
        }

        if (!model.hasGeometry()) {
            logger.warn("Loaded model has no geometry.");
        }
        // do a silent render in case a transparent object got loaded and rendered ahead of an opaque one.
        else if (_materials.hasTransparentMaterial()) {
            this.requestSilentRender();
        }

        // set initial visibility of nodes
        this.handleInitialVisibility(model);

        // Fire the event so we know the geometry is done loading.
        this.api.dispatchEvent({
            type: et.GEOMETRY_LOADED_EVENT,
            model: model
        });
    };

    this.onTextureLoadComplete = function (model) {
        // Fire the event so we know the textures for a model are done loading.
        this.api.dispatchEvent({
            type: et.TEXTURES_LOADED_EVENT,
            model: model
        });

        // Once all the texture are loaded, we need to trigger an extra silent Render in Next Frame
        // It will fix the missing texture and avoid loading-flashing if we clear the color target everytime
        // LMV-4577 for more information
        this.requestSilentRender();
    };

    this.signalProgress = function (percent, progressState, model) {
        if (_progressEvent.percent === percent &&
            _progressEvent.state === progressState &&
            (model && _progressEvent.model && (_progressEvent.model.id === model.id))) {
            return;
        }

        _progressEvent.percent = percent;
        _progressEvent.state = progressState;

        if (model) {
            _progressEvent.model = model;
        }

        this.api.dispatchEvent(_progressEvent);
    };

    this.resize = function (w, h, immediateUpdate) {
        if (this.glrenderer()?.xr?.isPresenting) {
            console.warn('Viewer3DImpl: Can\'t change size while XR device is presenting.');
            return;
        }

        _needsResize = true;
        _newWidth = w;
        _newHeight = h;

        if (immediateUpdate) {
            updateCanvasSize(true);
        }
    };

    this.unloadModel = function (model, keepResources) {

        this.api.dispatchEvent({ type: et.BEFORE_MODEL_UNLOAD_EVENT, model: model });

        // If model was visible, remove it.
        // If it was hidden, it has already been removed from viewer and we just have to remove it from
        // the hiddenModels list in RenderScene.
        if (!this.removeModel(model) && !_modelQueue.removeHiddenModel(model)) {
            // If neither of this works, this model is unknown.
            return;
        }

        if (!keepResources) {
            // Note that this just discards the GPU resources, not the model itself.
            model.dtor(this.glrenderer());
            _materials.cleanup(model);

            if (model.loader) {
                model.loader.dtor?.();
                model.loader = null;
            }
        }

        // remove selection overlay (F2D models)
        if (model.is2d() && this.overlayScenes[model.id]) {
            this.removeOverlayScene(selection2dOverlayName(model));
        }

        this.api.dispatchEvent({ type: et.MODEL_UNLOADED_EVENT, model: model });
    };

    this._reserveLoadingFile = function () {
        if (!this.loaders) {
            this.loaders = [];
        }
        // The reservation is an object with a dtor function, in case
        // the load gets canceled before loader instance is created.
        var reservation = { dtor: function () { } };
        this.loaders.push(reservation);
        return reservation;
    };

    this._hasLoadingFile = function () {
        return this.loaders && this.loaders.length > 0;
    };

    this._addLoadingFile = function (reservation, svfLoader) {
        if (this.loaders) {
            var index = this.loaders.indexOf(reservation);
            if (index >= 0)
                this.loaders[index] = svfLoader;
        }
    };

    this._removeLoadingFile = function (svfLoader) {
        if (this.loaders) {
            var idx = this.loaders.indexOf(svfLoader);
            if (idx >= 0) {
                this.loaders.splice(idx, 1);
            }
        }
    };


    /** Removes a model from this viewer, but (unlike unload) keeps the RenderModel usable,
     *  so that it can be added to this or other viewers later.
     *   @param {RenderModel}
     *   @returns {boolean} True if the model was known and has been successfully removed.
     */
    this.removeModel = function (model) {

        if (!_modelQueue.removeModel(model)) {
            return false;
        }

        // TODO: Removing a single model should not destroy this whole thing.
        if (this.keyFrameAnimator) {
            this.keyFrameAnimator.destroy();
            this.keyFrameAnimator = null;
        }

        this.selector.removeModel(model);
        this.visibilityManager.removeModel(model);
        this.layers.removeModel(model);

        if (model === this.model) {
            this.model = null;

            if (!_modelQueue.isEmpty())
                this.model = _modelQueue.getModels()[0];
        }

        syncIdTargetCount();
        this.invalidate(true, true, true);

        this.api.fireEvent({ type: et.MODEL_REMOVED_EVENT, model: model });

        return true;
    };

    /**
     * Stops loading for a model url for which the RenderModel is not in memory yet.
     * TODO: This should be unified with unloadModel to a single API function, but we need a unique way first
     *       to address the model in both cases.
     *
     *  @param {string} url - Must exactly match the url used for loading
     */
    this.cancelLoad = function (url) {

        if (!this.loaders) {
            return;
        }

        // Find loader that is loading this url
        for (var i = 0; i < this.loaders.length; i++) {
            // TODO: currentLoadPath is only defined for SVF/OTG models. It would be better to have a unified way
            //       to cancel model loading.
            var loader = this.loaders[i];
            if (loader.currentLoadPath === url) {
                // Loader found - stop it
                loader.dtor();
                this.loaders.splice(i, 1);
                break;
            }
        }
    };

    function syncIdTargetCount() {
        if (isMobileDevice())
            return;

        var sceneModelCount = _modelQueue.getModels().length;
        let flags = _renderer.mrtFlags();

        if (sceneModelCount > 1 && flags.mrtIdBuffer < 2) {
            // To support more than 24 bits, the target count will have to be 2 from the get-go,
            // even for single model usage.
            var bChanged = _renderer.setIdTargetCount(2);
            bChanged && _materials.toggleMRTSetting(_renderer.mrtFlags());
        }
    }

    /**
     * Removes loaded models and models that are getting loaded.
     * Method can be invoked while still loading the initial model. 
     */
    this.unloadCurrentModel = function () {

        if (this.model) {
            //Before loading a new model, restore states back to what they
            //need to be when loading a new model. This means restoring transient
            //changes to the render state made when entering 2d mode,
            //like light preset, antialias and SAO settings,
            //and freeing GL objects specific to the old model.
            if (this.is2d) {
                this.is2d = undefined;
                this.removeOverlayScene(selection2dOverlayName(this.model));
                _renderer.exit2DMode();
            } else {
                _oldLightPreset = _currentLightPreset;
            }

            if (this.model.is3d()) {
                // LMV-5655: Keep track of the 3d light preset
                _3dLightPreset = _currentLightPreset;
            }

            _renderer.beginScene(this.scene, this.camera, this.lightsOn ? this.lights : this.no_lights, true);
            _renderer.composeFinalFrame(true);
        }

        // Destruct any ongoing loaders, in case the loading starts, but the model root hasn't created yet.
        if (this.loaders) {
            this.loaders.forEach(function (loader) {
                loader.dtor();
            });
            this.loaders = [];
        }

        var models = _modelQueue.getAllModels();
        for (var i = models.length - 1; i >= 0; i--)
            this.unloadModel(models[i]);

        this.model = null;
    };

    var createSelectionScene = function (name, materialPre, materialPost) {
        materialPre.depthWrite = false;
        materialPre.depthTest = true;
        materialPre.side = THREE.DoubleSide;

        materialPost.depthWrite = false;
        materialPost.depthTest = true;
        materialPost.side = THREE.DoubleSide;

        // make selection material support instanced geometry
        _materials.addInstancingSupport(materialPre);
        _materials.addInstancingSupport(materialPost);

        _this.createOverlayScene(name, materialPre, materialPost);
    };

    var setupSelectionHighlight = function () {

        _this.selectionMaterialBase = new THREE.MeshPhongMaterial({ specular: 0x080808, opacity: 1.0, transparent: false });
        _this.selectionMaterialTop = new THREE.MeshPhongMaterial({ specular: 0x080808, opacity: 0.15, transparent: true });
        _this.selectionMaterialTop.packedNormals = true;
        _this.selectionMaterialBase.packedNormals = true;
        // selectionMaterialBase is the visible base highlight.
        // selectionMaterialTop draws over everything.
        createSelectionScene("selection", _this.selectionMaterialBase, _this.selectionMaterialTop);

        _this.highlightMaterial = new THREE.MeshPhongMaterial({ specular: 0x080808, opacity: 1.0, transparent: false });
        _this.highlightMaterial.packedNormals = true;
        _materials.addInstancingSupport(_this.highlightMaterial);
        _materials.addMaterial("__highlightMaterial__", _this.highlightMaterial, true);

    };

    this.createOverlayScene = function (name, materialPre, materialPost, camera, needIdTarget = false, needSeparateDepth = false) {
        if (materialPre) {
            _materials.addOverrideMaterial(name + "_pre", materialPre);
        }

        if (materialPost) {
            _materials.addOverrideMaterial(name + "_post", materialPost);
        }

        var s = new THREE.Scene();
        s.__lights = this.scene.__lights;
                                       
         
                                         
         
                  
        return this.overlayScenes[name] = {
            scene: s,
            camera: camera,
            materialName: name,
            materialPre: materialPre,
            materialPost: materialPost,
            needIdTarget,
            needSeparateDepth
        };
    };

    this.removeOverlayScene = function (name) {

        var overlay = this.overlayScenes[name];
        if (overlay) {
            var scene = this.overlayScenes[name];
            scene.materialPre && _materials.removeMaterial(scene.materialName + "_pre");
            scene.materialPost && _materials.removeMaterial(scene.materialName + "_post");
            delete this.overlayScenes[name];
            this.invalidate(false, false, true);
        }
    };

    this.addOverlay = function (overlayName, mesh) {
        if (this.overlayScenes[overlayName]) {
            this.overlayScenes[overlayName].scene.add(mesh);
            this.invalidate(false, false, true);
        }
    };

    this.addMultipleOverlays = function (overlayName, meshes) {
        for (var i in meshes) {
            if (!Object.prototype.hasOwnProperty.call(meshes, i)) continue;
            this.addOverlay(overlayName, meshes[i]);
        }
    };

    this.removeOverlay = function (overlayName, mesh) {
        if (this.overlayScenes[overlayName]) {
            this.overlayScenes[overlayName].scene.remove(mesh);
            this.invalidate(false, false, true);
        }
    };

    this.removeMultipleOverlays = function (overlayName, meshes) {
        for (var i in meshes) {
            if (!Object.prototype.hasOwnProperty.call(meshes, i)) continue;
            this.removeOverlay(overlayName, meshes[i]);
        }
    };

    this.clearOverlay = function (overlayName) {

        if (!this.overlayScenes[overlayName])
            return;

        var scene = this.overlayScenes[overlayName].scene;
        var obj, i;
        for (i = scene.children.length - 1; i >= 0; --i) {
            obj = scene.children[i];
            if (obj) {
                scene.remove(obj);
            }
        }

        this.invalidate(false, false, true);
    };

    this.setClearColors = function (r, g, b, r2, g2, b2) {
        this.clearColorTop = new THREE.Vector3(r / 255.0, g / 255.0, b / 255.0);
        this.clearColorBottom = new THREE.Vector3(r2 / 255.0, g2 / 255.0, b2 / 255.0);

        //If we are using the background color as environment also,
        //create an environment map texture from the new colors
        //This is too magical and should not be necessary here -- it's done when calling setLightPreset with a light preset
        //that does not use explicit cube map.
        /*
        if (!_materials._reflectionMap || _materials._reflectionMap.isBgColor) { // TODO: don't access internal members of matman
            var cubeMap = this.loadCubeMapFromColors(this.clearColorTop, this.clearColorBottom);
            _renderer.setCubeMap(cubeMap);
            _renderer.toggleEnvMapBackground(_envMapBackground);
            this.invalidate(true);
        }
        */

        this.updateClearColors();
        if (_groundReflection)
            _groundReflection.setClearColors(this.clearColorTop, this.clearColorBottom, isMobileDevice());
        _needsClear = true;
        this.fireRenderOptionChanged();
    };

    this.setClearAlpha = function (alpha) {
        _renderer.setClearAlpha(alpha);
    };

    //Similar to THREE.Box3.setFromObject, but uses the precomputed bboxes of the
    //objects instead of doing it per vertex.
    var _box3 = new THREE.Box3();
    function computeObjectBounds(dst, object, bboxFilter) {

        object.updateMatrixWorld(true);

        object.traverse(function (node) {

            var geometry = node.geometry;

            // Special-handling for selection proxies. Why needed?: 
            //  - selection proxies share model geometry
            //  - A model BufferGeometry does not contain a BoundingBoxes (to save memory)
            //  - A model geometry uses interleaved buffers, which is not supported by computeBoundingBox() anyway.
            // So, the standard handling below does not work here and would just waste memory by attaching wrong bboxes to model geometry.
            const isModelGeom = node.model && (typeof node.fragId === 'number');
            if (isModelGeom && !geometry.boundingBox) {

                const fragList = isModelGeom && node.model.getFragmentList();
                if (fragList) {
                    fragList.getWorldBounds(node.fragId, _box3);

                    if (!bboxFilter || bboxFilter(_box3)) {
                        dst.union(_box3);
                    }
                }

                // TODO: In case any overlay contains inverleaved geometry from anywhere else, this is still not
                //       handled properly here.
                return;
            }

            if (geometry !== undefined && node.visible) {

                if (!geometry.boundingBox)
                    geometry.computeBoundingBox();

                _box3.copy(geometry.boundingBox);
                _box3.applyMatrix4(node.matrixWorld);

                if (!bboxFilter || bboxFilter(_box3)) {
                    dst.union(_box3);
                }
            }

        });
    }

    var _bounds = new THREE.Box3();
    function getOverlayBounds(bboxFilter) {

        _bounds.makeEmpty();

        var overlays = _this.overlayScenes;

        for (var key in overlays) {
            if (!Object.prototype.hasOwnProperty.call(overlays, key))
                continue;

            computeObjectBounds(_bounds, overlays[key].scene, bboxFilter);
        }

        //Also add the root scenes -- people add overlays there too
        computeObjectBounds(_bounds, _this.scene, bboxFilter);
        computeObjectBounds(_bounds, _this.sceneAfter, bboxFilter);

        return _bounds;
    }

    this.getVisibleBounds = function (includeGhosted, includeOverlays, bboxFilter, excludeShadow) {
        var result = new THREE.Box3();
        if (!_modelQueue.isEmpty()) {
            computeObjectBounds(result, this.scene, bboxFilter);
            result = _modelQueue.getVisibleBounds(includeGhosted, bboxFilter, excludeShadow).union(result);

            if (includeOverlays) {
                result = getOverlayBounds(bboxFilter).union(result);
            }
        }
        return result;
    };

    this.getFitBounds = function (ignoreSelection) {
        var bounds;

        // If there is a valid selection, use its bounds
        if (!ignoreSelection && this.selector !== null) {
            bounds = this.selector.getSelectionBounds();
        }

        // Otherwise, if there is a valid isolation, use its bounds
        if (!bounds || bounds.isEmpty()) {
            bounds = this.getVisibleBounds();

            //sometimes during loading, bounds set to infinity, as in BLMV-6568
            if (bounds.isEmpty() && this.model.is2d()) {
                bounds = this.model.getBoundingBox();
            }
        }
        //console.log("  getFitBounds bounds are " + + bounds.min.x +", "+ bounds.min.y + " to " + bounds.max.x +", "+ bounds.max.y);

        return bounds;
    };

    this.getRenderProxy = function (model, fragId) {
        //currently there is a single model so the mapping
        //of fragId to render mesh is 1:1.
        return model.getFragmentList()?.getVizmesh(fragId);
    };

    this.getLayersRoot = function () {
        return this.layers.getRoot();
    };

    this.getFragmentProxy = function (model, fragId) {
        return new FragmentPointer(model.getFragmentList(), fragId);
    };

    this.getRenderProxyCount = function (model) {
        return model.getFragmentList().getCount();
    };

    this.getRenderProxyDbIds = function (model, fragId) {
        return model.getFragmentList().getDbIds(fragId);
    };

    this.isWholeModelVisible = function () {
        return _modelQueue ? _modelQueue.areAllVisible() : true;
    };

    this.isNodeVisible = function (nodeId, model) {
        return this.visibilityManager.isNodeVisible(model, nodeId); // swapped arguments
    };

    this.highlightObjectNode = function (model, dbId, value, simpleHighlight) {

        dbId = model.reverseMapDbIdFor2D(dbId);

        if (model.is2d()) {
            _materials.highlightObject2D(dbId, value, model.id); //update the 2d object id texture
            this.invalidate(false, false, true);
        }

        this.renderer().setDbIdForEdgeDetection(value && !simpleHighlight ? dbId : 0, value ? model.id : 0);

        var scope = this;
        var instanceTree = model.getData().instanceTree;

        //TODO: There can be instance tree in the case of 2D drawing, but
        //we do not currently populate the node tree with the virtual fragment ids
        //that map 2d objects to 2d consolidated meshes, hence the use of dbId2fragId in the else condition
        if (instanceTree && !model.is2d()) {
            // set model to useIdBufferSelection and model needs to have its dbId2fragId map 
            if (model.useIdBufferSelection) {
                var fragId = model.getData().fragments.dbId2fragId[dbId];
                scope.highlightFragment(model, fragId, value, simpleHighlight);
            } else {
                instanceTree.enumNodeFragments(dbId, function (fragId) {
                    scope.highlightFragment(model, fragId, value, simpleHighlight);
                }, false);
            }
        } else {
            let fragId = dbId;

            if (model.is2d() && model.getData().fragments)
                fragId = model.getData().fragments.dbId2fragId[dbId];

            if (Array.isArray(fragId))
                for (var i = 0; i < fragId.length; i++)
                    scope.highlightFragment(model, fragId[i], value, simpleHighlight);
            else
                scope.highlightFragment(model, fragId, value, simpleHighlight);

        }

    };

    this.highlightFragment = function (model, fragId, value, simpleHighlight) {

        if (model.isLeaflet()) {
            model.getIterator().highlightSelection(value, this.highlightMaterial.color);
            this.invalidate(true);
            return;
        }

        var mesh = this.getRenderProxy(model, fragId);

        if (!mesh)
            return;

        // And also add a mesh to the overlays in case we need that.
        // For 2D that is always the case, while for 3D it's done
        // for "fancy" single-selection where we draw an outline for the object as post-processing step.
        // Overlay is only used for 2D, Point cloud, transparent and themeing colored objects.
        var useOverlay = !simpleHighlight || mesh.is2d || mesh.isPoint || mesh.themingColor;

        var highlightId = model.id + ":" + fragId;

        if (useOverlay) {
            var overlayName = "selection";
            if (model.is2d()) overlayName = selection2dOverlayName(model);
            if (mesh.isPoint) overlayName += "_points";

            if (value) {
                if (mesh.is2d && Object.prototype.hasOwnProperty.call(this.selectionMeshes, highlightId)) {
                    // 2d has multiple dbids in a single fragment. As each dbid
                    // is highlighted we count the number so we know when the mesh
                    // is no longer needed.
                    ++this.selectionMeshes[highlightId]._lmv_highlightCount;
                } else {
                    var selectionProxy;

                    // Make sure it all worked
                    if (!mesh || !mesh.geometry)
                        return;

                    if (mesh.isPoint) {
                        // using an override material would overwrite the point size for
                        // each point cloud, so we apply the selection colour to the
                        // duplicated geometry here instead by copying the material
                        var selectionMaterial = mesh.material.clone();
                        selectionMaterial.color = this.selectionMaterialBase.color;
                        selectionMaterial.needsUpdate = true;
                        if (selectionMaterial.defines && mesh.geometry.attributes["pointScale"]) {
                            selectionMaterial.defines["PARTICLE_FLAGS"] = 1;
                        }

                        selectionProxy = new THREE.Mesh(mesh.geometry, selectionMaterial);
                    } else {
                        selectionProxy = new THREE.Mesh(mesh.geometry, mesh.material);
                    }

                    selectionProxy.matrix.copy(mesh.matrixWorld);
                    selectionProxy.matrixAutoUpdate = false;
                    selectionProxy.matrixWorldNeedsUpdate = true;

                    selectionProxy.frustumCulled = false;
                    selectionProxy.model = model;
                    selectionProxy.fragId = fragId;
                    selectionProxy._lmv_highlightCount = 1;

                    this.addOverlay(overlayName, selectionProxy);

                    this.selectionMeshes[highlightId] = selectionProxy;
                }
            }
            else if (Object.prototype.hasOwnProperty.call(this.selectionMeshes, highlightId)) {
                var proxy = this.selectionMeshes[highlightId];
                if (--proxy._lmv_highlightCount <= 0) {
                    this.removeOverlay(overlayName, proxy);
                    delete this.selectionMeshes[highlightId];
                }
            }
        }

        if (!useOverlay || !value) {
            //Case where highlighting was done directly in the primary render queue
            //and we need to repaint to clear it. This happens when multiple
            //nodes are highlighted using e.g. right click in the tree view
            if (model.setHighlighted(fragId, value)) //or update the vizflags in the render queue for 3D objects
                this.invalidate(true);
        }
    };

    this.explode = function (scale) {

        scale = Number(scale);
        if (scale == _explodeScale)
            return false;

        _explodeScale = scale;

        this.refreshExplode();

        this.api.dispatchEvent({ type: et.EXPLODE_CHANGE_EVENT, scale: scale });
        return true;
    };


    this.refreshExplode = function () {

        _modelQueue.explode(_explodeScale);

        //force a repaint and a clear
        this.sceneUpdated(true);
    };

    /**
     * Gets the last applied explode scale
     */
    this.getExplodeScale = function () {
        return _explodeScale;
    };

    /**
     * Lock dbid so it doesn't explode
     *
     * Not applicable to 2D.
     */
    this.lockExplode = function (dbids, lock, model) {
        model = model || this.model;
        const instanceTree = model.getData().instanceTree;
        if (!instanceTree)
            return false;

        const lockDbid = function (acc, dbid) {
            instanceTree.enumNodeChildren(dbid, function (child) {
                acc = instanceTree.lockNodeExplode(child, lock) || acc;
            }, true);
            return acc;
        };

        let changed;
        if (Array.isArray(dbids)) {
            changed = dbids.reduce(lockDbid, false);
        } else {
            changed = lockDbid(false, dbids);
        }

        if (changed && _explodeScale > 0) {
            _modelQueue.explode(_explodeScale);
            this.sceneUpdated(true);
        }
        return changed;
    };

    /**
     * Check whether a dbid is locked so it doesn't explode
     *
     * Not applicable to 2D.
     */
    this.isExplodeLocked = function (dbid, model) {
        model = model || this.model;
        const instanceTree = model.getData().instanceTree;
        return instanceTree && instanceTree.isNodeExplodeLocked(dbid);
    };


    /* simple function to set the brightness of the ghosting.
     * Simply sets another colour that is better for brighter environments
     */
    this.setGhostingBrightness = function (darkerFade) {
        var color = new THREE.Color(darkerFade ? 0x101010 : 0xffffff);
        function setColor(mat) {
            mat.color = color;
        }

        setColor(this.fadeMaterial);
        this.fadeMaterial.variants && this.fadeMaterial.variants.forEach(setColor);
    };


    this.loadCubeMapFromColors = function (ctop, cbot) {
        var texture = CreateCubeMapFromColors(ctop, cbot);
        texture.isBgColor = true;
        _materials.setReflectionMap(texture);
        return texture;
    };

    this.loadCubeMap = function (path, exposure) {

        this._reflectionMapPath = path;

        var mapDecodeDone = function (map) {

            //If setCubeMap was called twice quickly, it's possible that
            //a texture map that is no longer desired loads after the one that was
            //set last. In such case, just make the undesirable disappear into the void.
            if (path !== _this._reflectionMapPath)
                return;

            // It is possible for this load to complete after the model has been canceled
            if (!_materials)
                return;

            _materials.setReflectionMap(map);
            _this.invalidate(true);

            if (!map) {
                _this.loadCubeMapFromColors(_this.clearColorTop, _this.clearColorBottom);
            } else if (!LightPresets[_currentLightPreset].useIrradianceAsBackground) {
                _renderer.setCubeMap(map);
            }
        };

        return TextureLoader.loadCubeMap(path, exposure, mapDecodeDone);
    };


    this.loadIrradianceMap = function (path, exposure) {

        this._irradianceMapPath = path;

        var mapDecodeDone = function (map) {

            //If setCubeMap was called twice quickly, it's possible that
            //a texture map that is no longer desired loads after the one that was
            //set last. In such case, just make the undesirable disappear into the void.
            if (path !== _this._irradianceMapPath)
                return;

            // It is possible for this load to complete after the model has been canceled
            if (!_materials)
                return;

            _materials.setIrradianceMap(map);
            _this.invalidate(true);

            if (LightPresets[_currentLightPreset].useIrradianceAsBackground) {
                _renderer.setCubeMap(map);
            }
        };

        return TextureLoader.loadCubeMap(path, exposure, mapDecodeDone);

    };

    this.setCurrentLightPreset = function (index) {
        _currentLightPreset = index;
    };

    this.setLightPreset = function (index, force, callback) {
        //We do not have the ability to load the environment map textures on node.js yet,
        //because they use plain XHR that needs to be converted to use TextureLoader.
        //So we override the environment to zero, which does not use external environment maps.
        if (isNodeJS())
            index = 0;

        // make sure that lights are created
        this.initLights();

        if (_currentLightPreset === index && !force) {
            callback && callback();
            return;
        }

        // Reset index in cases the index out of range.
        // This could happen, if we update the light preset list and user
        // has a local web storage which stores the last accessed preset index which is potentially
        // out of range with respect to the new preset list.
        if (index < 0 || LightPresets.length <= index) {
            index = DefaultLightPreset;
        }
        _currentLightPreset = index;

        // If we don't have any models, then we save the light preset
        // so it is set when a model is added. This is to stop unnecessary
        // loading of environment maps for 2D models.
        if (_modelQueue.isEmpty()) {
            _oldLightPreset = _currentLightPreset;
            _oldCallback = callback;
            return;
        }

        var preset = LightPresets[index];

        //if the light preset has a specific background color, set that
        //This has to be done first, because the encironment map may use
        //the background colors in case no environment map is explicitly given.
        var c = preset.bgColorGradient;
        if (!c)
            c = BackgroundPresets["Custom"];
        this.setClearColors(c[0], c[1], c[2], c[3], c[4], c[5]);

        //If allowed, display the environment as background (most likely the irradiance map will be used
        //by the AEC presets, so it will be almost like a color gradient)
        if (preset.useIrradianceAsBackground !== undefined) {
            if (this.api.prefs.hasTag('envMapBackground', 'ignore-producer')) {
                logger.debug('setLightPreset(): envMapBackground is locked. No changes.');
            } else {
                this.api.prefs.tag('no-storage', 'envMapBackground');
                this.api.setEnvMapBackground(preset.useIrradianceAsBackground);
            }
        }

        if (preset.path) {

            var pathPrefix = "res/environments/" + preset.path;
            var reflPath = getResourceUrl(pathPrefix + "_mipdrop." + (preset.type || "") + ".dds");
            var irrPath = getResourceUrl(pathPrefix + "_irr." + (preset.type || "") + ".dds");

            this.loadIrradianceMap(irrPath, preset.E_bias);
            this.loadCubeMap(reflPath, preset.E_bias);

            //Set exposure that the environment was baked with.
            //This has to be known at baking time and is applied
            //by the shader.
            _materials.setEnvExposure(-preset.E_bias);
            _renderer.setEnvExposure(-preset.E_bias);

            this.setTonemapExposureBias(preset.E_bias);
            this.setTonemapMethod(preset.tonemap);

            this.setGhostingBrightness(preset.darkerFade);
        }
        else {
            var cubeMap = this.loadCubeMapFromColors(this.clearColorTop, this.clearColorBottom);
            _renderer.setCubeMap(cubeMap);
            _materials.setIrradianceMap(null);
            //_materials.setReflectionMap(cubeMap); //will be set by the loadCubeMapFromColors call

            //Set exposure that the environment was baked with.
            //This has to be known at baking time and is applied
            //by the shader.
            _materials.setEnvExposure(-preset.E_bias || 0);
            _renderer.setEnvExposure(-preset.E_bias || 0);

            this.setTonemapExposureBias(preset.E_bias || 0);
            this.setTonemapMethod(preset.tonemap || 0);

            this.setGhostingBrightness(preset.darkerFade);

            _renderer.toggleEnvMapBackground(_envMapBackground);


            this.invalidate(true);
        }

        const dwfModels = _modelQueue?.getModels().filter((model) =>  {
            const documentNode = model?.getDocumentNode();
            const fileType = documentNode?.getInputFileType() || documentNode?.getRootNode()?.data?.name || '';
            return ['dwfx', 'dwf'].includes(fileType.toLowerCase());
        });
        if (dwfModels.length > 0) {
            dwfModels.forEach((model) => {
                _materials.forEachInModel(model, false, m => {
                    if (!m.emissiveOrig) {
                        m.emissiveOrig = m.emissive;
                    }
                    m.emissive = m.emissiveOrig.clone().multiplyScalar(Math.pow(2.0, -preset.E_bias));
                });
            });
        }

        //To begin with, get the SAO defaults from the shader uniforms definition
        //Note the scaling we apply to inverse scaling done by the setAOOptions API internally.
        //This is not pretty....
        var saoRadius = SAOShader.uniforms.radius.value;
        var saoIntensity = SAOShader.uniforms.intensity.value;

        //Check if the preset overrides the SAO settings
        if (Object.prototype.hasOwnProperty.call(preset, "saoRadius"))
            saoRadius = preset.saoRadius;
        if (Object.prototype.hasOwnProperty.call(preset, "saoIntensity"))
            saoIntensity = preset.saoIntensity;
        _renderer.setAOOptions(saoRadius, saoIntensity);

        var lightIntensity = _defaultLightIntensity;
        if (preset.lightMultiplier !== null && preset.lightMultiplier !== undefined) {
            lightIntensity = preset.lightMultiplier;
        }

        // init primary light direction used for shadows
        _shadowLightDir.copy(_shadowLightDirDefault);
        if (preset.lightDirection) {
            // The presets describe the direction away from the light, while _shadowLightDir
            // is the direction pointing to the light.
            _shadowLightDir.fromArray(preset.lightDirection).negate();
        }

        // changing the shadow light direction invalidates the shadow-map
        if (_shadowMaps) {
            invalidateShadowMap();
        }

        if (this.dir_light1) {
            this.dir_light1.intensity = lightIntensity;

            if (preset.lightDirection) {
                this.dir_light1.position.set(-preset.lightDirection[0], -preset.lightDirection[1], -preset.lightDirection[2]);
            } else {
                // set to default, otherwise the environment will inherit the direction from whatever previous environment was chosen
                this.dir_light1.position.copy(_lightDirDefault);
            }

        }

        _materials.setEnvRotation(preset.rotation || 0.0);
        _renderer.setEnvRotation(preset.rotation || 0.0);

        if (_groundReflection) _groundReflection.setEnvRotation(preset.rotation || 0.0);

        // toggle lights on/off based on lightMultiplier
        this.toggleLights(lightIntensity !== 0.0);

        this.invalidate(true, false, true);

        this.fireRenderOptionChanged();

        // Call the callback
        callback && callback();
    };

    this.setLightPresetFromFile = function (model) {
        if (!model || model.is2d()) {
            return false;
        }

        let ignoreProducer;

        // TODO add more control for environments
        // the user cannot set anything expect the style from current UI
        // currently only the style can be selected.
        // TODO We cannot control these values so comment out for now
        var grndReflection = model.getMetadata('renderEnvironmentGroundReflection', 'value', null);
        ignoreProducer = this.api.prefs.hasTag(Prefs3D.GROUND_REFLECTION, 'ignore-producer');
        if (grndReflection !== null && !ignoreProducer) {
            this.api.prefs.tag('no-storage', Prefs3D.GROUND_REFLECTION);
            this.api.setGroundReflection(grndReflection);
        }

        var grndShadow = model.getMetadata('renderEnvironmentGroundShadow', 'value', null);
        ignoreProducer = this.api.prefs.hasTag(Prefs3D.GROUND_SHADOW, 'ignore-producer');
        if (grndShadow !== null && !ignoreProducer) {
            this.api.prefs.tag('no-storage', Prefs3D.GROUND_SHADOW);
            this.api.setGroundShadow(grndShadow);
        }

        var ambientShadows = model.getMetadata('renderEnvironmentAmbientShadows', 'value', null);
        ignoreProducer = this.api.prefs.hasTag(Prefs3D.AMBIENT_SHADOWS, 'ignore-producer');
        if (ambientShadows !== null && !ignoreProducer) {
            this.api.prefs.tag('no-storage', Prefs3D.AMBIENT_SHADOWS);
            // kludgey, but maintains previous API linking these two different algorithms together
            this.api.setQualityLevel(ambientShadows, _renderer.getAntialiasing());
        }

        var displayLines = model.getMetadata('renderEnvironmentDisplayLines', 'value', null);
        ignoreProducer = this.api.prefs.hasTag(Prefs3D.LINE_RENDERING, 'ignore-producer');
        if (displayLines !== null && !ignoreProducer) {
            this.api.prefs.tag('no-storage', Prefs3D.LINE_RENDERING);
            this.api.hideLines(!displayLines);
        }

        var displayPoints = model.getMetadata('renderEnvironmentDisplayPoints', 'value', null);
        ignoreProducer = this.api.prefs.hasTag(Prefs.POINT_RENDERING, 'ignore-producer');
        if (displayPoints !== null && !ignoreProducer) {
            this.api.prefs.tag('no-storage', Prefs.POINT_RENDERING);
            this.api.hidePoints(!displayPoints);
        }

        var displayEdges = model.getMetadata('renderEnvironmentDisplayEdges', 'value', null);
        ignoreProducer = this.api.prefs.hasTag(Prefs3D.EDGE_RENDERING, 'ignore-producer');
        if (displayEdges !== null && !ignoreProducer) {
            this.api.prefs.tag('no-storage', Prefs3D.EDGE_RENDERING);
            this.api.setDisplayEdges(!isMobileDevice() && !!displayEdges);
        }

        var style = model.getMetadata('renderEnvironmentStyle', 'value', null);
        var preset = LightPresets.filter(function (lightPreset) {
            return lightPreset.name === style;
        })[0];
        ignoreProducer = this.api.prefs.hasTag(Prefs3D.LIGHT_PRESET, 'ignore-producer');
        if (preset && !ignoreProducer) {
            this.api.prefs.tag('no-storage', Prefs3D.LIGHT_PRESET);

            // Create an env based on an existing preset
            // and add it at the end of the official list
            var env = ModelSettingsEnvironment;
            if (!env) {
                env = ModelSettingsEnvironment = {};
                LightPresets.push(env);
            }

            // Copy existing Preset into custom Model-Loaded preset
            copyLightPreset(preset, env);

            // Override Name for use in UI
            env.name = 'Custom Model defined';

            // Override Environment Exposure Values
            var exposureBias = model.getMetadata('renderEnvironmentExposureBias', 'value', null);
            var exposureBase = model.getMetadata('renderEnvironmentExposureBase', 'value', null);
            if (exposureBias !== null && exposureBase !== null) {
                env.E_bias = exposureBias + exposureBase;
            }

            // Override Environment Background Color
            // Note that there's a specific preset for background color
            var bgColor = model.getMetadata('renderEnvironmentBackgroundColor', 'value', null);
            ignoreProducer = this.api.prefs.hasTag(Prefs.BACKGROUND_COLOR_PRESET, 'ignore-producer');
            if (bgColor && !ignoreProducer) {
                env.bgColorGradient = [
                    255.0 * bgColor[0], 255.0 * bgColor[1], 255.0 * bgColor[2],
                    255.0 * bgColor[0], 255.0 * bgColor[1], 255.0 * bgColor[2]
                ];
            }

            // Override Environment Rotation
            var envRotation = model.getMetadata('renderEnvironmentRotation', 'value', null); //assumed radians
            if (envRotation !== null) {
                env.rotation = envRotation;
            }

            var i = LightPresets.indexOf(env);
            this.setLightPreset(i, true);
        }

        var bgEnvironment = model.getMetadata('renderEnvironmentBackgroundFromEnvironment', 'value', null);
        ignoreProducer = this.api.prefs.hasTag(Prefs3D.ENV_MAP_BACKGROUND, 'ignore-producer');
        if (bgEnvironment !== null && !ignoreProducer) {
            this.api.prefs.tag('no-storage', Prefs3D.ENV_MAP_BACKGROUND);
            this.api.setEnvMapBackground(bgEnvironment);
        }

        // Important to return the model defined preset
        return preset;
    };

    this.setLightPresetForAec = function () {

        //Find the AEC light preset
        var presetName = getGlobal().DefaultLightPresetAec || "Boardwalk";
        var idx = -1;
        for (var i = 0; i < LightPresets.length; i++) {
            if (LightPresets[i].name === presetName) {
                idx = i;
                break;
            }
        }

        if (idx >= 0) {
            if (this.api.prefs.hasTag('lightPreset', 'ignore-producer')) {
                logger.debug('setLightPresetForAec(): lightPreset is locked. No changes.');
            } else {
                this.api.prefs.tag('no-storage', 'lightPreset');

                this.setLightPreset(idx, true, function () {
                    //When AEC preset is set, we lock changes to the envMapBackground in order to prevent
                    //setLightPresetFromFile from changing our settings. This is ugly, but it works around the
                    //followng issue: Revit files do not set renderEnvironmentStyle in the metadata, which
                    //indicates that we should not override any environment settings from the file.
                    //However, Max files would like to have a null environment style with non-null specific overrides.
                    //The issue comes that the other overrides have a default value of false in LMV, so
                    //we mistakenly use those overrides to nuke the AEC settings that were set here.
                    //So here, we lock the setting to prevent it from being nuked in setLightPresetFromFile.
                    this.api.prefs.tag('ignore-producer', 'envMapBackground');
                }.bind(this));
                this.saveLightPreset();
            }
        }

        //If allowed, display edge topology
        if (this.api.prefs.hasTag('edgeRendering', 'ignore-producer')) {
            logger.debug('setLightPresetForAec(): edgeRendering is locked. No changes.');
        } else {
            this.api.prefs.tag('no-storage', 'edgeRendering');
            this.api.setDisplayEdges(!isMobileDevice());
        }

        return true;
    };


    this.setAOHeuristics = function (model) {

        //Decide on what SSAO settings to use.

        var metersPerModelUnit = model.getUnitScale();

        // First, check the metadata for explcit AO settings and use them if present.
        var aoRadius = model.getMetadata('renderEnvironmentAmbientShadows', 'radius', undefined);
        var aoIntensity = model.getMetadata('renderEnvironmentAmbientShadows', 'intensity', undefined);
        var aoOpacity = model.getMetadata('renderEnvironmentAmbientShadows', 'opacity', undefined);
        if (aoRadius !== undefined || aoIntensity !== undefined || aoOpacity !== undefined) {
            _renderer.setAOOptions(aoRadius / metersPerModelUnit, aoIntensity, aoOpacity);
        } else if (model.isAEC()) {
            var largeRadius = (metersPerModelUnit > 0.3);
            if (largeRadius) {
                //AEC model in meters or feet -- probably building
                //use room-sized radius
                _renderer.setAOOptions(4.0 / metersPerModelUnit, 1.0, 0.625);
            } else {
                //AEC model in inches or cm -- most likely a factory floor with lots
                //of small things / pipes / nuts / bolts, use smaller radius.
                _renderer.setAOOptions(0.25 / metersPerModelUnit, 1.0, 0.625);
            }
        } else {
            // Compute a rough size for the model, so that we can set a reasonable AO radius.
            // This simple approach is reasonable for mechanical models, but is probably too
            // large a value for architectural models, where the viewer is inside the model
            // and so the model itself is relatively large compared to the viewer.
            var bbox = model.getData().bbox;
            var diagonalLength = bbox.getSize(new THREE.Vector3()).length();

            // 10 works well as a default for most models, including
            // architectural scenes. Surprising! But, for small models,
            // where for some reason the model is not in "human-sized units",
            // 0.05 says the ambient occlusion should extend 5% of the
            // diagonal length of the model.
            // The 10 here should match the SAOShader.js radius of 10.
            _renderer.setAOOptions(Math.min(10.0, 0.05 * diagonalLength));
        }


    };


    this.setTonemapMethod = function (index) {

        if (index == _renderer.getToneMapMethod())
            return;

        _renderer.setTonemapMethod(index);
        _materials.setTonemapMethod(index);

        this.fireRenderOptionChanged();
        this.invalidate(true);
    };

    this.setTonemapExposureBias = function (bias) {

        if (bias == _renderer.getExposureBias())
            return;

        _renderer.setTonemapExposureBias(bias);
        _materials.setTonemapExposureBias(bias);

        this.fireRenderOptionChanged();
        this.invalidate(true);
    };

    this.setRenderingPrefsFor2D = function (is2D) {

        if (!isNodeJS()) {
            var value = is2D ? false : !!this.api.prefs.get('envMapBackground');
            this.toggleEnvMapBackground(value);
        }
    };


    /**
     * Unloads model, frees memory, as much as possible.
     */
    this.dtor = function () {
        this.stop();
        this.api.removeEventListener(et.MODEL_ROOT_LOADED_EVENT, _stdSurfaceLoadListener);
        this.api.removeEventListener(et.MODEL_ROOT_LOADED_EVENT, _onModelRootLoaded);

        this.unloadCurrentModel();

        // this.controls is uninitialized by Viewer3D, since it was initialized there
        this.controls = null;
        this.canvas = null;
        clearInterval(this.interval);

        this.loader = null;

        this.selector.dtor();
        this.selector = null;

        this.model = null;
        this.layers = null;
        this.visibilityManager = null;

        if (_geomCache) {
            _geomCache.removeViewer(this.api);
            _geomCache = null;
        }

        _modelQueue = null;
        _renderer = null;

        _materials.refCount--;

        if (_materials.refCount === 0) {
            _materials.dtor();
        }

        _materials = null;

        if (_webglrender) {
            _webglrender.refCount--;

            if (_webglrender.refCount === 0) {
                _webglrender.domElement = null;
                                               
                {
                    _webglrender.context = null;
                }
                          
            }

            _webglrender.removeEventListener(LMVRenderer.Events.WEBGL_CONTEXT_LOST, this.onWebGLcontextLost);
            _webglrender.removeEventListener(LMVRenderer.Events.WEBGL_CONTEXT_RESTORED, this.onWebGLcontextRestored);
            _webglrender = null;
        }
    };

    this.hideLines = function (hide) {
        if (_modelQueue && !_modelQueue.isEmpty()) {
            _modelQueue.hideLines(hide);
            this.sceneUpdated(true);
        }
    };

    this.hidePoints = function (hide) {
        if (_modelQueue && !_modelQueue.isEmpty()) {
            _modelQueue.hidePoints(hide);
            this.sceneUpdated(true);
        }
    };

    this.setDisplayEdges = function (show) {

        _renderer.toggleEdges(show);

        //If edges are turned off, turn off polygon offset also.
        //Except if the model has line geometries in the scene, then do not turn off
        //polygon offset.
        var needsPO = show;

        if (!show) {
            // return false, not undefined
            needsPO = !!(this.model && this.model.getData().hasLines);
        }

        _materials.togglePolygonOffset(needsPO);
        _renderer.setDepthMaterialOffset(_materials.getPolygonOffsetOn(), _materials.getPolygonOffsetFactor(), _materials.getPolygonOffsetUnits());

        this.invalidate(true);
    };

    /**
     * Sets surface materials to double sided or single sided.
     * @param {boolean} enable - sets materials to double sided if set to true.
     * @param {Autodesk.Viewing.Model} model - model instance
     * @param {boolean} [update=true] - Updates the scene 
     */
    this.setDoubleSided = function (enable, model, update = true) {
        model = model || this.model;

        // Double sided materials will only be set to 3d models.
        if (model.is2d()) {
            return;
        }

        const modelData = model.getData();

        // Do not apply if the model data is not available.
        if (!modelData) {
            return;
        }

        // Sets surface materials to either double sided or single sided
        this.matman().setDoubleSided(enable, model);
        update && this.sceneUpdated();
    };

    this.getAllCutPlanes = function () {
        // create array of the planes by combining all cut plane sets
        var allPlanes = undefined;
        for (var key in _cutPlaneSets) {
            var cps = _cutPlaneSets[key];
            if (cps && cps.length) {
                if (!allPlanes) {
                    allPlanes = cps;
                } else if (key === _cutPlaneSetFor2DRendering) {
                    // UnitsPerPixel only consider the first cutplane. So, this one must go first.
                    allPlanes = cps.concat(allPlanes);
                } else {
                    // append cutplanes
                    allPlanes = allPlanes.concat(cps);
                }
            }
        }
        return allPlanes;
    };

    // Set cutplane array by combining the cutplanes specified by different tools
    this.updateCutPlanes = function () {
        var allPlanes = this.getAllCutPlanes();
        this.setCutPlanes(allPlanes);
    };


    /**
     * A cutplane set is an array of cutplanes that can be controlled individually by a single tool
     * without affecting other tools' cutplanes.
     *  @param {string} cutPlaneSetName
     *  @param {Vector4[]|null} [planes]
     *  @param {Boolean} [fireEvent] - if set to false the av.CUTPLANES_CHANGE_EVENT event will not be fired.
     */
    this.setCutPlaneSet = function (cutPlaneSetName, planes, fireEvent = true) {
        // store copy of plane array
        _cutPlaneSets[cutPlaneSetName] = planes ? planes.slice() : undefined;
        if (fireEvent) {
            this.updateCutPlanes();
        } else {
            var allPlanes = this.getAllCutPlanes();
            this.setCutPlanesInScene(allPlanes);
        }
    };

    /** Defines which cutplane is used to adjust 2D rendering. This is used by SectionTool
     * to make sure that 2D rendering resolution is properly adjusted for its cutplane.
     *  @param {string] cutPlaneSetName */
    this.setCutPlaneSetFor2DRendering = function (cutPlaneSetName) {
        _cutPlaneSetFor2DRendering = cutPlaneSetName;
        this.updateCutPlanes();
    };

    this.getCutPlaneSet = function (cutPlaneSetName) {
        return _cutPlaneSets[cutPlaneSetName] || [];
    };

    /* @returns {string[]} names - names of all active (non-empty) cutplane sets. */
    this.getCutPlaneSets = function () {
        var result = [];
        for (var key in _cutPlaneSets) {
            var cp = _cutPlaneSets[key];
            if (cp && cp.length) {
                result.push(key);
            }
        }
        return result;
    };

    this.getCutPlanes = function () {
        return _materials.getCutPlanes();
    };

    /**
     * Sets the material cutplanes and updates the scene.
     * This function does not fire the Autodesk.Viewing.CUTPLANES_CHANGE_EVENT
     * @see Viewer3DImpl#setCutPlanes
     */
    this.setCutPlanesInScene = function (planes) {
        _renderer.toggleTwoSided(_materials.setCutPlanes(planes));
        this.sceneUpdated();
    };

    this.setCutPlanes = function (planes) {
        this.setCutPlanesInScene(planes);
        this.api.dispatchEvent({ type: et.CUTPLANES_CHANGE_EVENT, planes: planes });
    };

    this.fireRenderOptionChanged = function () {

        //If SAO is changing and we are using multiple
        //render targets in the main material pass, we have
        //to update the materials accordingly.
        _materials.toggleMRTSetting(_renderer.mrtFlags());

        this.api.dispatchEvent({ type: et.RENDER_OPTION_CHANGED_EVENT });
    };

    this.viewportToRay = function (vpVec, ray, camera = this.camera) {
        return camera.viewportToRay(vpVec, ray);
    };

    // Add "meshes" parameter, after we get meshes of the object using id buffer,
    // then we just need to ray intersect this object instead of all objects of the model.
    this.rayIntersect = function (ray, ignoreTransparent, dbIds, modelIds, intersections, options) {

        const getDbIdAtPointFor2D = (point) => {
            const vpVec = new THREE.Vector3().copy(point);
            vpVec.project(this.camera);
            const res = [];
            _renderer.idAtPixel(vpVec.x, vpVec.y, res);

            return res;
        };

        var result = _modelQueue.rayIntersect(ray.origin, ray.direction, ignoreTransparent, dbIds, modelIds, intersections, getDbIdAtPointFor2D, options);

        var extraScenes = [this.scene, this.sceneAfter];
        const tmpSize = new THREE.Vector3();

        for (let i = 0; i < extraScenes.length; i++) {
            let scene = extraScenes[i];
            if (scene.children.length) {
                var raycaster = new THREE.Raycaster(ray.origin, ray.direction, this.camera.near, this.camera.far);

                computeObjectBounds(_bounds, scene);
                //TODO: This math approximately matches the heuristic in RenderScene.recomputeLinePrecision
                //but it applies per scene. It might be good to unify the two once we know this works well.
                raycaster.params.Line.threshold = Math.min(1.0, _bounds.getSize(tmpSize).length() * 0.5 * 0.001);

                var intersects = intersections || [];
                VBIntersector.intersectObject(scene, raycaster, intersects, true);

                if (intersects.length) {
                    const intersectRes = intersects[0];

                    if (!result || intersectRes.distance < result.distance) {
                        if (intersectRes.modelId !== undefined) {
                            intersectRes.model = this.findModel(intersectRes.modelId);
                        }
                        result = intersectRes;
                    }
                }
            }
        }

        if (!result)
            return null;

        if (result.dbId === undefined && result.fragId !== undefined /* 0 is a valid fragId */) {

            result.dbId = result.model.getFragmentList().getDbIds(result.fragId);

            if (!result.model.getData().instanceTree) {
                //Case where there is no dbid to fragment id map. Create a 'virtual' node
                //with node Id = fragment Id, so that selection works like
                //each scene fragment is a scene node by itself.
                result.dbId = result.fragId;
            }
        }

        result.intersectPoint = result.point; // Backwards compatibility 

        return result;
    };

    this.castRayViewport = function () {

        var _ray;

        // Add "meshes" parameter, after we get meshes of the object using id buffer,
        // then we just need to ray intersect this object instead of all objects of the model.
        return function (vpVec, ignoreTransparent, dbIds, modelIds, intersections, options) {

            _ray = _ray || new THREE.Ray();

            if (!_modelQueue) {
                return {};
            }

            this.viewportToRay(vpVec, _ray);

            return this.rayIntersect(_ray, ignoreTransparent, dbIds, modelIds, intersections, options);
        };

    }();

    this.getCanvasBoundingClientRect = function () {
        if (this.canvasBoundingclientRectDirty) {
            this.canvasBoundingclientRectDirty = false;
            this.boundingClientRect = this.canvas.getBoundingClientRect();
        }
        return this.boundingClientRect;
    };

    this.clientToViewport = function (clientX, clientY) {
        var rect = this.getCanvasBoundingClientRect();
        return new THREE.Vector3(
            ((clientX + 0.5) / rect.width) * 2 - 1,
            -((clientY + 0.5) / rect.height) * 2 + 1, 1);
    };

    this.viewportToClient = function (viewportX, viewportY) {
        var rect = this.getCanvasBoundingClientRect();
        return new THREE.Vector3(
            (viewportX + 1) * 0.5 * rect.width - 0.5,
            (viewportY - 1) * -0.5 * rect.height - 0.5, 0);
    };

    this.castRay = function (clientX, clientY, ignoreTransparent, options) {
        // Use the offsets based on the client rectangle, which is relative to the browser's client
        // rectangle, unlike offsetLeft and offsetTop, which are relative to a parent element.
        //
        return this.castRayViewport(this.clientToViewport(clientX, clientY), ignoreTransparent, undefined, undefined, undefined, options);
    };

    // Note: The camera world matrix must be up-to-date
    this.intersectGroundViewport = function (vpVec) {

        var worldUp = "z";

        //In 2D mode, the roll tool can be used to change the orientation
        //of the sheet, which will also set the world up vector to the new orientation.
        //However, this is not what we want in case of a 2d sheet -- its ground plane is always Z.
        //TODO: It's not clear if checking here or in setWorldUp is better. Also I don't see
        //a way to generalize the math in a way to make it work without such check (e.g. by using camera up only).
        if (!this.is2d) {
            worldUp = _worldUpName;
        }

        var modelBox = this.model && this.model.getBoundingBox();
        return SceneMath.intersectGroundViewport(vpVec, this.camera, worldUp, modelBox);
    };

    this.intersectGround = function (clientX, clientY) {
        return this.intersectGroundViewport(this.clientToViewport(clientX, clientY));
    };

    this._2dHitTestViewport = function (vpVec, searchRadius, minPixelId) {
        const _idRes = [0, 0]; // idAtPixels will write the result into this array.
        const pixelId = _renderer.idAtPixels(vpVec.x, vpVec.y, searchRadius, _idRes);
        if (pixelId < minPixelId)
            return null;

        const model = _modelQueue.findModel(_idRes[1]) || this.model;
        if (!model)
            return null;

        //Note this function will destructively modify vpVec,
        //so it's unusable after that.
        const point = this.intersectGroundViewport(vpVec);

        // get fragment ID if there is a fragment list
        const fragments = model.getData().fragments;
        const fragId = (fragments ? fragments.dbId2fragId[pixelId] : -1);

        return {
            intersectPoint: point,
            dbId: model.remapDbIdFor2D(pixelId),
            fragId: fragId,
            model: model
        };
    };

    // Filter to exclude 3D line hit tests if they are outside the given searchRadius
    const getSearchRadiusFilter = (searchRadius) => {

        return (hit) => {

            // We only care for line hits. Note that we exclude wideLines here as well, because
            // (unlike regular ones), they have a true world-space width. 
            const isLine = hit && hit.object && hit.object.isLine;
            if (!isLine) {
                return true;
            }

            // Exclude its if projected distance from ray is beyond search radius 
            const unitsPerPixel = 1.0 / _this.camera.pixelsPerUnitAtDistance(hit.distance);
            const maxWorldDist = searchRadius * unitsPerPixel;
            return hit.distanceToRay < maxWorldDist;
        };
    };

    this.hitTestViewport = function (vpVec, ignoreTransparent, dbIds, modelIds, intersections) {
        let result;

        if (this.is2d) {
            const searchRadius = isMobileDevice() ? 45 : 5;
            result = this._2dHitTestViewport(vpVec, searchRadius, 1);
        }
        else {
            result = this.castRayViewport(vpVec, ignoreTransparent, dbIds, modelIds, intersections);
        }

        return result;
    };

    this.hitTest = function (clientX, clientY, ignoreTransparent, dbIds, modelIds) {

        return _this.hitTestViewport(this.clientToViewport(clientX, clientY), ignoreTransparent, dbIds, modelIds);
    };

    this.hitBoxTestViewport = function (vpVec, widthRatio, heightRatio) {
        const results = [];
        const ids = [];
        _renderer.idsAtPixelsBox(vpVec.x, vpVec.y, widthRatio, heightRatio, ids);

        for (let i = 0; i < ids.length; i++) {
            const model = _modelQueue.findModel(ids[i][1]) || this.model;
            if (model) {
                const dbId = model.remapDbIdFor2D(ids[i][0]);
                results.push({ dbId, model });
            }
        }

        return results;
    };

    this.snappingHitTestViewport = function (vpVec, ignoreTransparent) {
        let result;

        //Notice: The amount of pixels per line should correspond to pixelSize in setDetectRadius of Snapper.js,
        //the shape of detection area is square in idAtPixels, but circle in snapper, should make their areas match roughly.
        const searchRadius = isMobileDevice() ? 45 : 17;

        if (this.is2d) {
            if (this.model && this.model.isLeaflet()) { // Assumming that in 2d there's only one model
                let point = this.intersectGroundViewport(vpVec);
                result = { intersectPoint: point };
            } else {
                result = this._2dHitTestViewport(vpVec, searchRadius, 0);
            }
        } else { // Is 3d
            const res = [];
            const dbId = _renderer.idAtPixels(vpVec.x, vpVec.y, searchRadius, res);

            // Adjust vp position according to hit.
            if (res[2] && res[3]) {
                vpVec.setX(res[2]);
                vpVec.setY(res[3]);
            }

            const options = {
                filter: getSearchRadiusFilter(searchRadius)
            };
            result = this.castRayViewport(vpVec, ignoreTransparent, dbId > 0 ? [dbId] : null, undefined, undefined, options);
        }

        return result;
    };

    // Used for snapping
    // firstly, find the intersect object using pre-computed ID buffer
    // secondly, find the intersect point and face using intersection test
    this.snappingHitTest = function (clientX, clientY, ignoreTransparent) {

        return this.snappingHitTestViewport(this.clientToViewport(clientX, clientY), ignoreTransparent);
    };

    /**
     * Clears the current highlighted object.
     */
    this.clearHighlight = function () {
        _renderer.rolloverObjectId(-1);
        this.invalidate(false, false, true);
    };

    this.rollOverIdChanged = function () {
        this.api.fireEvent({
            type: et.OBJECT_UNDER_MOUSE_CHANGED,
            dbId: _renderer.getRollOverDbId(),
            modelId: _renderer.getRollOverModelId()
        });
        this.invalidate(false, false, true);
    };

    //Used for rollover highlighting using pre-computed ID buffer
    this.rolloverObjectViewport = function (vpVec) {

        // Handles BLMV-5652, we falsely continue to highlight PDF if underlayRaster exists
        if (!this.model) {
            return;
        }

        if (this.is2d && this.model &&
            (this.model.isLeaflet() ||
                this.model.isPdf(true) && this.api.prefs.get(Prefs2D.DISABLE_PDF_HIGHLIGHT)
            )
        )
            return;

        const _idRes = [];

        // Disable highlight for dbids that have a selection lock.
        const dbId = _renderer.idAtPixel(vpVec.x, vpVec.y, _idRes);

        if (this.selector && this.selector.isNodeSelectionLocked(dbId, this.model)) {
            this.clearHighlight();
            return;
        }

        const modelId = _idRes[1];
        const hoveredModel = this.findModel(modelId);

        // Since Leaflet has only one fragment, highlight it entirely.
        if (hoveredModel?.isLeaflet()) {
            if (_renderer.rollOverModelId(modelId)) {
                this.rollOverIdChanged();
            }

            return;
        }

        // Otherwise, highlight the hovered object only.
        if (_renderer.rolloverObjectViewport(vpVec.x, vpVec.y))
            this.rollOverIdChanged();
    };

    this.rolloverObject = function (clientX, clientY) {

        if (!this.selector.highlightPaused && !this.selector.highlightDisabled)
            this.rolloverObjectViewport(this.clientToViewport(clientX, clientY));
    };

    //This method is intended to be used by Tools
    this.pauseHighlight = function (disable) {

        this.selector.highlightPaused = disable;
        if (disable) {
            this.clearHighlight();
        }
    };

    this.disableHighlight = function (disable) {

        this.selector.highlightDisabled = disable;
        if (disable) {
            this.clearHighlight();
        }
    };

    this.disableSelection = function (disable) {

        this.selector.selectionDisabled = disable;
    };

    // Downloading all the relevant leaflet tiles might take time, so canceling it in the middle should be an option.
    // Using this API, the screenshot calculation will be canceled.
    // Note that this function is only for the old getScreenShot function. getScreenShotProgressive() returns a control object for canceling.
    this.cancelLeafletScreenshot = function () {
        _this.api.dispatchEvent({ type: et.CANCEL_LEAFLET_SCREENSHOT });
    };

    // See ScreenShot.js for documentation
    this.getScreenShotProgressive = function (w, h, onFinished, options) {
        return ScreenShot.getScreenShot(w, h, onFinished, options, this);
    };

    //This accessor is only used for debugging purposes a.t.m.
    this.modelQueue = function () { return _modelQueue; };

    this.glrenderer = function () { return _webglrender; };

    this.renderer = function () { return _renderer; };

    this.setGeomCache = function (geomCache) {
        _geomCache = geomCache;
        _geomCache.addViewer(_this.api);
    };

    this.geomCache = function () {
        // OtgResourceCache should be generated only when OTG loader starts to request for geometries.
        // Otherwise, there is a bug related to the web-workers creation time: https://git.autodesk.com/A360/firefly.js/pull/4163.
        if (!_geomCache) {
            this.setGeomCache(new OtgResourceCache());
        }

        return _geomCache;
    };

    // only for debugging purposes
    this.shadowMaps = function () { return _shadowMaps; };

    this.worldUp = function () { return _worldUp; };
    this.worldUpName = function () { return _worldUpName; };

    this.setUserRenderContext = function (ctx, isInitialized) {
        _renderer = (ctx) ? ctx : new RenderContext();
        if (!isInitialized) {
            _renderer.init(_webglrender, this.canvas.clientWidth, this.canvas.clientHeight);
            _renderer.setClearColors(this.clearColorTop, this.clearColorBottom);
        }
        this.invalidate(true);
        this.sceneUpdated(false); //to reset world boxes needed by new RenderContext for shadows, etc
    };

    this.setUserGroundShadow = function (groundShadow) {
        var replaced = _groundShadow;
        _groundShadow = groundShadow;
        return replaced; // Return GroundShadow object that we replaced.
    };

    this.invalidate = function (needsClear, needsRender, overlayDirty) {
        _needsClear = needsClear || _needsClear;
        _needsRender = needsRender || _needsRender;
        _overlayDirty = overlayDirty || _overlayDirty;
    };

    // needed for command system
    this.isOverlayDirty = function () {
        return _overlayDirty;
    };

    this.clearOverlayDirtyFlag = function () {
        _overlayDirty = false;
    };

    this.sceneUpdated = function (objectsMoved, skipRepaint) {

        this.invalidate(!skipRepaint, false, !skipRepaint);

        // Mark the scene bounds for update
        if (_modelQueue && objectsMoved) {
            _modelQueue.invalidateVisibleBounds();
            this.zoomBoundsChanged = true;
        }

        _sceneDirty = true;

        invalidateShadowMap();
    };

    // immediately restart rendering, make it interruptible like progressive, displaying only when done
    this.requestSilentRender = function () {
        _deferredSilentRender = _immediateSilentRender = true;
    };

    // restart rendering only when the previous render is done, make it interruptible like progressive, itself displaying only when done
    this.requestDeferredSilentRender = function () {
        _deferredSilentRender = true;   // but not immediate
    };

    this.currentLightPreset = function () { return _currentLightPreset; };

    /**
     * @private
     */
    this.saveLightPreset = function () {
        _oldLightPreset = _currentLightPreset;
    };

    this.matman = function () { return _materials; };

    this.fps = function () { return 1000.0 / _frameTimeAvg; };

    this.setFPSTargets = function (min, target, max) {
        MAX_FRAME_BUDGET = 1000 / max;
        MIN_FRAME_BUDGET = 1;
        TARGET_FRAME_TIME = 1000 / target;
        // TODO mismatch! Why / 4 here, and / 2 below (search on targetFrameBudget)?
        this.targetFrameBudget = isMobileDevice() ? TARGET_FRAME_TIME / 4 : TARGET_FRAME_TIME;
    };

    //========================================================================


    // Record fragments transformation in explode mode for RaaS rendering
    //this.fragTransformConfig = [];

    this.track = function (event) {
        logger.track(event);
    };

    this.worldToClient = function (point, camera = this.camera) {
        var p = new THREE.Vector4(point.x, point.y, point.z, 1);
        p.applyMatrix4(camera.matrixWorldInverse);
        p.applyMatrix4(camera.projectionMatrix);

        // Don't want to mirror values with negative z (behind camera)
        if (p.w > 0) {
            p.x /= p.w;
            p.y /= p.w;
            p.z /= p.w;
        }

        return this.viewportToClient(p.x, p.y);
    };

    this.clientToWorld = function (clientX, clientY, ignoreTransparent, ignore2dModelBounds) {

        var result = null;
        var model = this.model;
        var modelData = model.getData();

        if (model.is2d()) {

            var collision = this.intersectGround(clientX, clientY);
            if (collision) {
                collision.z = 0;
                var bbox = modelData.bbox;
                if (ignore2dModelBounds || modelData.hidePaper || bbox.containsPoint(collision)) {
                    result = {
                        point: collision,
                        model: model
                    };
                }
            } else if (ignore2dModelBounds) {
                // clientToWorld() should usually never return null for 2d and ignore2dModelBounds=true,
                // particularly because the view direction is normally supposed to be orthogonal to the sheet plane.
                //
                // This section is only entered in the rare edge case that the view direction is orthogonal to the plane.
                // To avoid an exception for that case (https://sentry.io/organizations/fluent-y0/issues/2392259972/?referrer=slack)
                // we just fall back by using camera-position x/y, which corresponds to projecting the camera position to the sheetplane z=0.
                result = { point: this.camera.position.clone(), model };
            }
        } else {

            // hitTest handles multiple scenes
            result = this.hitTest(clientX, clientY, ignoreTransparent);
            if (result) {
                result.point = result.intersectPoint; // API expects attribute point to have the return value too.
            }
        }

        return result;
    };

    /**
     * Sets selection highlight color and opacity for 2D models
     * @param {THREE.Color} color
     * @param {number} opacity
     */
    this.set2dSelectionColor = function (color, opacity) {
        this.matman().set2dSelectionColor(color, opacity);
        this.invalidate(false, false, true /* overlay */);
    };

    /**
     * Sets selection highlight color for 3D models
     * @param {THREE.Color} color
     * @param {number} selectionType
     */
    this.setSelectionColor = function (color, selectionType) {
        selectionType = selectionType || SelectionType.MIXED;
        var emissive = new THREE.Color(color);
        emissive.multiplyScalar(0.5);

        var setColors = function (material) {
            material.color.set(color);
            material.emissive.set(emissive);
            material.variants && material.variants.forEach(setColors);
        };

        switch (selectionType) {
            default:
            case SelectionType.MIXED:
                setColors(this.selectionMaterialBase);
                setColors(this.selectionMaterialTop);
                _renderer.setSelectionColor(color);
                setColors(this.highlightMaterial);
                this.invalidate(true);
                break;
            case SelectionType.REGULAR:
                setColors(this.highlightMaterial);
                this.invalidate(true);
                break;
            case SelectionType.OVERLAYED:
                setColors(this.selectionMaterialBase);
                setColors(this.selectionMaterialTop);
                _renderer.setSelectionColor(color);
                this.invalidate(false, false, true);
                break;
        }
    };

    // Update the viewport Id for the first selection in 2d measure
    this.updateViewportId = function (vpId) {
        _materials.updateViewportId(vpId);
        this.invalidate(true);
    };

    /**
     * Find model based on modelId, BubbleNode, or filter function.
     *  @param {number|av.BubbleNode|function(av.Model)} value
     *  @param {boolean}[includeHidden] - By default, we only consider visible models for search
     *  @returns {RenderModel|null}
     */
    this.findModel = function (value, includeHidden) {

        // define filter function
        let filter;
        if (typeof value == 'number') {
            filter = m => m.id == value;
        } else if (value instanceof BubbleNode) {
            filter = m => m.getDocumentNode() == value;
        } else {
            if (!value) {
                return null;
            }

            filter = value; // value must be a filter function already
        }        

        // Search visible models
        let model = _modelQueue.getModels().find(filter);

        // Optional: Search hidden models
        if (includeHidden && !model) {
            model = _modelQueue.getHiddenModels().find(filter);
        }

        return model;
    };

    /**
     *  get frame rate for progressive rendering, i.e, how many ticks go by before an update occurs
     *  @returns {number}
     */
    this.getFrameRate = function () {
        return this.frameDisplayRate;
    };

    /**
     * set frame rate for progressive rendering, i.e, how many ticks go by before an update occurs
     *  @param   {number} rate
     */
    this.setFrameRate = function (rate) {
        // don't let rate < 1, just in case user sets 0.
        this.frameDisplayRate = (rate < 1) ? 1 : rate;
    };

    /**
     *  For shadow casting, we assume a single directional light. Shadow light direction is the direction
     *  that this light comes from, i.e., shadows are casted to the opposite direction.
     *  This function changes the direction and triggers a shadow update.
     *
     *  Note that the directional light source is only assumed for shadow casting. The actual lighting usually comes from
     *  several directions when using environment lighting, but we need a fixed direction for shadow mapping.
     *
     *   @param {THREE.Vector3} lightDir - direction in world space
     */
    this.setShadowLightDirection = function (lightDir) {
        _shadowLightDir.copy(lightDir);
        invalidateShadowMap();
        this.invalidate(true, false, false);

        // update ground transform to make sure that the ground shape is large enough
        // to make the whole shadow visible.
        updateGroundTransform();
    };

    /**
     *  The result is either returned as a new vector or written to 'target' (if specified)
     *  @param {THREE.Vector3} [target]
     *  @returns {THREE.Vector3} Either target object or new Vector3 instance.
     */
    this.getShadowLightDirection = function (target) {
        var dir = (target ? target : new THREE.Vector3());
        dir.copy(_shadowLightDir);
        return dir;
    };

    /**
     * @param {boolean} enable
     * Note that viewer must be initialized first.
     */
    this.toggleShadows = function (enable) {
        if (!!_shadowMaps == !!enable) {
            // no change
            return;
        }

        if (enable) {
            _shadowMaps = new shadow.ShadowMaps(_webglrender);
        } else {
            _shadowMaps.cleanup(_materials);
            _shadowMaps = null;
        }

        // Adjust ground plane box if the shadows are getting turned on.
        updateGroundTransform();

        this.invalidate(true, true, false);
    };

    this.showTransparencyWhenMoving = function (enabled) {
        _modelQueue.enableNonResumableFrames = enabled;
    };


    this.fitToView = function (aggregateSelection, immediate) {

        immediate = !!immediate;
        if (aggregateSelection.length === 0) {
            // If the array is empty, assume that we want
            // all models and no selection
            var allModels = _modelQueue.getModels();
            aggregateSelection = allModels.map(function (model) {
                return {
                    model: model,
                    selection: []
                };
            });
        }
        
        if (aggregateSelection.length === 0) {
            return false;
        }

        // Early exit if parameters are not right
        var count2d = 0;
        for (var i = 0; i < aggregateSelection.length; ++i) {

            var model = aggregateSelection[i].model;
            if (!model)
                return false;

            if (model.is2d()) {
                count2d++;
            }
        }

        // Start processing.
        var processed = false;
        if (count2d === aggregateSelection.length) {
            // Aggregate selection on 2d models.
            processed = this._fitToView2d(aggregateSelection, immediate);
        } else {
            // Aggregate selection on 3d models or 2d/3d hybrid.
            processed = this._fitToView3d(aggregateSelection, immediate);
        }

        if (!processed)
            return false;

        if (_modelQueue.getModels().length === 1) {
            // Single Model (backwards compatibility)
            this.api.dispatchEvent({
                type: et.FIT_TO_VIEW_EVENT,
                nodeIdArray: aggregateSelection[0].selection,
                immediate: immediate,
                model: aggregateSelection[0].model
            });
        }

        // Dispatches in both single and multi-model context
        this.api.dispatchEvent({
            type: et.AGGREGATE_FIT_TO_VIEW_EVENT,
            selection: aggregateSelection,
            immediate: immediate
        });

        return true;
    };

    /**
     * Used internally only by Viewer3DImpl::fitToView()
     * For now, only support a single 2D model.
     * @private
     */
    this._fitToView2d = function (aggregateSelection, immediate) {

        if (aggregateSelection.length > 1) {
            logger.warn('fitToView() doesn\'t support multiple 2D models. Using the first one...');
        }

        // Selection
        var model = aggregateSelection[0].model;
        var selection = aggregateSelection[0].selection;

        // Helpers
        var bounds = new THREE.Box3();
        var bc = new BoundsCallback(bounds);

        if (!selection || selection.length === 0) {
            if (this.api.anyLayerHidden()) {

                // Fit only to the visible layers
                var frags = model.getData().fragments;
                var visibleLayerIndices = this.getVisibleLayerIndices();
                for (var i = 0; i < frags.length; i++) {
                    find2DLayerBounds(model, i, visibleLayerIndices, bc);
                }

            } else {
                // Fit to the whole page
                bounds = this.getFitBounds(true);
            }
        }
        else {
            this.computeSelectionBounds(selection, model, bc);
        }


        if (!bounds.isEmpty()) {
            this.api.navigation.fitBounds(immediate, bounds);
            return true;
        }

        // Unhandled 2D
        return false;
    };

    /**
     * Compute the 2d bounds of selected object.
     * @public
     * @param {Array} selection array of object's ids
     * @param {RenderModel} model
     * @param {BoundsCallback} bc
     */
    this.computeSelectionBounds = function (dbIds, model, bc) {

        if (!bc) {
            bc = new BoundsCallback(new THREE.Box3());
        }

        var dbId2fragId = model.getData().fragments?.dbId2fragId;

        // Leaflets dont have fragments. In that case, just return the entire bounding box of the model.
        if (!dbId2fragId) {
            bc.bounds.copy(model.getBoundingBox());
        } else {
            for (var i = 0; i < dbIds.length; i++) {
                var remappedId = model.reverseMapDbIdFor2D(dbIds[i]);
                var fragIds = dbId2fragId[remappedId];
                // fragId is either a single vertex buffer or an array of vertex buffers
                if (Array.isArray(fragIds)) {
                    for (var j = 0; j < fragIds.length; j++) {
                        // go through each vertex buffer, looking for the object id
                        find2DBounds(model, fragIds[j], remappedId, bc);
                    }
                } else if (typeof fragIds === 'number') {
                    // go through the specific vertex buffer, looking for the object id
                    find2DBounds(model, fragIds, remappedId, bc);
                }
            }

            // Apply model transform to the bounds, since in find2DBounds the transform is not being taken into account.
            bc.bounds.applyMatrix4(model.getPlacementTransform());
        }

        return bc.bounds;
    };

    /**
    * Used internally only by Viewer3DImpl::get3DBounds()
    * Support multiple 3D models.
    * @private
    */
    this.get3DBounds = function (aggregateSelection) {

        // First, check if there's anything selected.
        var bNodeSelection = false;
        for (var j = 0; j < aggregateSelection.length; ++j) {
            if (aggregateSelection[j].selection.length > 0) {
                bNodeSelection = true;
                break;
            }
        }

        var bounds = new THREE.Box3();
        var box = new THREE.Box3();

        if (!bNodeSelection) {
            // When there is no node selection, then we need to fit to the whole model(s)
            bounds.union(this.getVisibleBounds(false, false));
        } else {

            // Fit to selected elements only
            for (var i = 0; i < aggregateSelection.length; ++i) {

                var selection = aggregateSelection[i].selection;
                if (selection.length === 0)
                    continue;

                // Specific nodes
                var model = aggregateSelection[i].model;
                var instanceTree = model.getInstanceTree();
                var fragList = model.getFragmentList();

                // instanceTree may be null, e.g., if instanceTree is not loaded yet
                if (!instanceTree) {
                    continue;
                }

                for (var s = 0; s < selection.length; ++s) {
                    var dbId = parseInt(selection[s]);
                    instanceTree.enumNodeFragments(dbId, function (fragId) {
                        fragList.getWorldBounds(fragId, box);
                        bounds.union(box);
                    }, true);
                }
            }

        }

        return bounds;
    };

    // Must be triggered if the transform of a model has changed while viewing it. 
    this.onModelTransformChanged = function (model) {

        // Needed in order to invalidate scene and shadow map.
        this.sceneUpdated();

        // The code below is only needed for selection proxies of consolidated meshes
        if (model.isConsolidated()) {
            // Invalidate affected selection proxies, so that they are updated on next overlay render
            for (var id in _this.selectionMeshes) {
                var proxy = _this.selectionMeshes[id];
                if (proxy.model === model) {
                    proxy.needsUpdate = true;
                }
            }
        }

        this.invalidate(true, true, true);

        this.api.fireEvent({ type: et.MODEL_TRANSFORM_CHANGED_EVENT, model, matrix: model.getModelTransform() });
    };

    /**
     * Change the placement matrix of the model. This overrides the placement transform applied at loadTime.
     *  @param {LmvMatrix4} matrix         - Note that you need 64-Bit precision for large values.
     *  @param {Vector3}    [globalOffset] - Optionally, the globalOffset can be reset in the same step.
     */
    this.setPlacementTransform = function (model, matrix) {
        model.setPlacementTransform(matrix);

        this.api.fireEvent({ type: et.MODEL_PLACEMENT_CHANGED_EVENT, model, matrix: model.getPlacementTransform() });

        this.onModelTransformChanged(model);
    };

    /**
     * Used internally only by Viewer3DImpl::fitToView()
     * Support multiple 3D models.
     * @private
     */
    this._fitToView3d = function (aggregateSelection, immediate) {

        const bounds = this.get3DBounds(aggregateSelection);

        if (!bounds.isEmpty()) {
            this.api.navigation.fitBounds(immediate, bounds);
            return true;
        }

        // Unhandled 3D
        return false;
    };

    /**
     * Supports Fit-To-View for 2D models
     * @private
     */
    function find2DLayerBounds(model, fragId, visibleLayerIds, bc) {
        var mesh = model.getFragmentList().getVizmesh(fragId);
        var vbr = new VertexBufferReader(mesh.geometry);
        vbr.enumGeomsForVisibleLayer(visibleLayerIds, bc);
    }

    /**
     * Supports Fit-To-View for 2D models
     * @private
     */
    function find2DBounds(model, fragId, dbId, bc) {
        var mesh = model.getFragmentList().getVizmesh(fragId);
        var vbr = new VertexBufferReader(mesh.geometry);
        vbr.enumGeomsForObject(dbId, bc);
    }

    /**
     * Invoked when WebGL loses the rendering context.
     * Only happens during an unrecoverable error.
     */
    this.onWebGLcontextLost = function () {

        // Drop any model consolidations, because they contain GPU-only meshes
        // If the context restores, we recompute them.
        if (_webglrender.enableContextRestore) {
            this._reconsolidateOnRestore = unconsolidateModels(this.api);
        }

        this.stop();
        this.api.fireEvent({ type: et.WEBGL_CONTEXT_LOST_EVENT });
    };

    this.onWebGLcontextRestored = function () {

        // recompute consolidations
        reconsolidateModels(this.api, this._reconsolidateOnRestore);
        this._reconsolidateOnRestore = null;

        // Clear overlays, because old overlay target renderings cannot be used anymore.
        _renderer.clearAllOverlays();

        // shadow and reflection targets must be re-rendered before next use
        _groundShadow.setDirty();
        _groundReflection && _groundReflection.setDirty();

        // Bring image back
        this.invalidate(true, true, true);

        this.run();

        this.api.fireEvent({ type: et.WEBGL_CONTEXT_RESTORED_EVENT });
    };

    /** @returns {bool} Check if the model is in the array of visible ones */
    this.modelVisible = function (modelId) {
        var model = _modelQueue.findModel(modelId);
        return !!model;
    };

    /**
     * Set initial visibility state of nodes
     * This ensures the UI (Model Browser) matches the main display
     * @private
     */
    this.handleInitialVisibility = function (model) {
        var viewer = this.api;

        // If the model is just loaded, but not shown, selector is null and this
        // function would crash.
        // Todo: The whole initialVisibility handling needs some major revision in order to properly
        //       work - particularly for aggregated viewing scenarios:
        //        - It doesn't work if a model was toggled off (in an AggregatedView) before the geometry-load was finished.
        //        - It doesn't work if models are just loaded without showing (e.g. diff support models)
        //        - Whether it's applied or not depends on whether a model was in cache or not. Actually, the application
        //          should control it, so that it is applied on an actual view switch, but not when toggling visibility of a model on/off.
        //        - Since it is triggered after geometry loading, but assumes that the model visibility is untouched so far.
        //          But: Since geomLoadDone() may happen much later than model-root load, user or client code may already have modified visibility.
        //          So, handleInitialVisiblity() overwrites this and there is a race condition.
        if (!model.visibilityManager) {
            return;
        }

        function hideInvisibleNodes(instanceTree) {
            // a node is visible if any of its fragments are
            // the LMVTK propagates visibility downwards, and doesn't allow the
            // visibility to be set for fragments directly, so we can infer the visibility
            // of the geometry node

            var frags = model.getFragmentList();
            if (frags.areAllVisible()) {
                return;
            }

            var invisibleNodes = [];

            if (!instanceTree) {
                return;
            }

            instanceTree.enumNodeChildren(model.getRootId(), function (dbId) {
                var visible = instanceTree.enumNodeFragments(dbId, function (fragId) {
                    return frags.isFragVisible(fragId);
                }, true);
                if (!visible && !instanceTree.isNodeHidden(dbId) && !instanceTree.isNodeOff(dbId)) {
                    invisibleNodes.push(dbId);
                }
            }, true);

            if (invisibleNodes.length) {
                viewer.hide(invisibleNodes, model);
            }
        }

        model.getObjectTree(hideInvisibleNodes);
    };

    /**
     * Changes the paper visibility for a 2D sheet
     * @param {Autodesk.Viewing.Model} model - the 2D sheet
     * @param {boolean} show
     * @param {boolean} [withTransition] - whether to use optional fading animation
     * @param {function} [onTransitionFinished] - optional callback
     * @param {number} [transitionDuration] - in seconds
     */
    this.changePaperVisibility = function (model, show, withTransition = false, onTransitionFinished = null, transitionDuration = 1) {
        if (model.is3d()) {
            onTransitionFinished?.();
            return;
        }

        const frags = model.getFragmentList();

        // Model doesn't have fragments (probably Leaflet). No paper fragment to hide.
        if (!frags) {
            onTransitionFinished?.();
            return;
        }

        if (model.paperVisibilityAnim) {
            model.paperVisibilityAnim.stop();
            model.paperVisibilityAnim = null;
        }

        if (!withTransition || !transitionDuration) {
            model.changePaperVisibility(show);
            this.invalidate(true);
            onTransitionFinished?.();
            return;
        }

        const paperDbId = -1;
        const start = frags.dbIdOpacity[paperDbId] !== undefined ?
            frags.dbIdOpacity[paperDbId] :
            (show ? 0 : 1);
        const end = show ? 1 : 0;
        const duration = transitionDuration; // seconds
        const onTimer = t => {
            t = Autodesk.Viewing.Private.smootherStep(t);
            frags.setObject2DOpacity(paperDbId, t);
            this.invalidate(true);
        };
        const onFinished = () => {
            model.paperVisibilityAnim = null;
            onTransitionFinished?.();
        };

        model.paperVisibilityAnim = Autodesk.Viewing.Private.fadeValue(start, end, duration, onTimer, onFinished);
    };

    /**
     * Used by Loaders to indicate that the model loading process has began 
     * and no geometry is available yet.
     * Works only when there are no models in the scene.
    */
    this._signalNoMeshes = function () {
        if (_modelQueue.isEmpty()) {
            this._geometryAvailable = 0;
        }
    };

    /**
     * Fires an event signaling that model data is available for rendering.
     * Called repeatedly whenever new geometry data is available for rendering, 
     * but only a single event will get fired. 
     */
    this._signalMeshAvailable = function () {
        if (this._geometryAvailable === 0) {
            this._geometryAvailable = 1;
            this.api.fireEvent({ type: et.RENDER_FIRST_PIXEL });
        }
    };

    /**
     * Whether any models have been loaded already.
     * A model is considered loaded as soon as the Model instance has
     * been added to RenderScene.
     */
    this.hasModels = function () {
        return !_modelQueue.isEmpty();
    };

    // Update loadingAnimationDuration according to preferences.
    this.onLoadingAnimationChanged = function (value) {
        _webglrender.setLoadingAnimationDuration(value ? this.defaultLoadingAnimationDuration : -1);
        this.invalidate(false, true, false);
    };

    this.isLoadingAnimationEnabled = function () {
        return this.api.prefs.get(Prefs2D.LOADING_ANIMATION) && (!this.model || this.model.is2d());
    };

    // Optional: Exclude all models from near/farPlane computation whose camera distance is beyond the given threshold. 
    // This avoids rendering artifacts for aggregated views that contain models with broken georeferencing, so that they
    // are too far away to be rendered properly together with closer content.
    // Note: Make sure that the value is not too small, because this also puts a general limit on the zoom-out distance.
    this.setMaxModelDistance = function (maxDist = 1e+5) {
        this.maxModelDistance = maxDist;
    };

    // Internally applied during near/far-computation. Only used if a maxModelDistance is set (off by default).
    // No effect as long as near/far distance is uncritical. If the near/far difference is above the threshold,
    // it recomputes the near/far while excluding models that are far away.
    this._applyMaxModelDistanceToNearFar = function () {

        // Do nothing unless we expect z-buffer artifacts: Even a huge far-value is not a problem
        // as long as the near value is large as well.
        var camera = this.camera;
        if (camera.far <= camera.near + this.maxModelDistance) {
            return null;
        }

        // Define bboxFilter that excludes models that are far away
        const dMax = camera.near + this.maxModelDistance;
        var bboxFilter = function (bbox) {
            // Check box distance
            var dist2 = SceneMath.pointToBoxDistance2(camera.position, bbox);
            return dist2 < dMax * dMax;
        };

        // Recompute near/far while excluding models that are too far away
        const worldBox = this.getVisibleBounds(true, _overlayDirty, bboxFilter);
        this.updateNearFarValues(camera, worldBox);
    };

    // see RenderModel.consolidate()
    this.consolidateModel = function (model, byteLimit) {
        model.consolidate(_materials, byteLimit, _webglrender);
    };

    this.setDoNotCut = function (model, doNotCut) {
        model.setDoNotCut(_materials, doNotCut);
    };

    this.setViewportBounds = function (model, bounds) {
        model.setViewportBounds(_materials, bounds);
        this.invalidate(true);

        this.api.fireEvent({ type: et.MODEL_VIEWPORT_BOUNDS_CHANGED_EVENT, model, bounds });
    };

    // Only for debugging with Spector browser extension: Capture the next frame.
    // this.startSpectorCapture = function() {
    //     _spectorDump = true;
    // };
}

Viewer3DImpl.prototype.constructor = Viewer3DImpl;
GlobalManagerMixin.call(Viewer3DImpl.prototype);
