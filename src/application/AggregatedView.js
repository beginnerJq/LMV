import { getParameterByName } from "../globals";
import { isMobileDevice } from "../compat";
import { DynamicGlobalOffset } from "./DynamicGlobalOffset";
import i18n from "i18next";

const av  = Autodesk.Viewing;
const avp = av.Private;

const track = (...args) => avp.analytics.track(...args);

// Enum for all extension names we are using here
const ExtNames = {
    BimWalk:        'Autodesk.BimWalk',
    Bookmarks:      'Autodesk.AEC.CanvasBookmarkExtension',
    Levels:         'Autodesk.AEC.LevelsExtension',
    CrossFade:      'Autodesk.CrossFadeEffects',
    Hyperlinks:     'Autodesk.AEC.HyperlinkExtension',
    Minimap:        'Autodesk.AEC.Minimap3DExtension',
    DropMe:         'Autodesk.AEC.DropMeExtension',
    ZoomWindow:     'Autodesk.Viewing.ZoomWindow',
    FusionOrbit:    'Autodesk.Viewing.FusionOrbit',
    Disciplines:    'Autodesk.AEC.DisciplinesExtension',
    DiffTool:       'Autodesk.DiffTool',
    ModelStructure: 'Autodesk.ModelStructure',
    ModelAlignment: 'Autodesk.ModelAlignment',
    SheetAlignment: 'Autodesk.SheetAlignment',
    ModelSheetTransition: 'Autodesk.ModelSheetTransition'
};

const Events = {
    // Fired when we had to disable alignment because of failures. I.e., at least one model had to be loaded without
    // checking for an alignment transform.
    ALIGNMENT_SERVICE_FAILED: 'alignmentServiceFailure',
    ENVIRONMENT_CHANGED: 'environmentChanged',
};

// Alignment Services:
// The client can choose the backend that is used to load/save alignment transforms.
//
// Example 1: Use a Default Service
//  options.createModelAlignmentService = av.AggregatedView.AlignmentServices.LocalStorage;
//
// Example 2: Implement your own
//  options.createModelAlignmentService = () => new MyOwnAlignmentService();
//
// where cfg is options.modelAlignmentConfig in your AggregatedView options.
//
// Note: You can assume the ModelAlignmentExtension code to be available when the callback
//       is executed, but not earlier.
const AlignmentServices = {
    LocalStorage: () => new Autodesk.ModelAlignmentService.AlignmentServiceLS()
};

// Default list of extensions who require to know the alignment service.
//  - Each listed extension must provide a setAlignmentService() function that takes an AlignmentService instance as parameter
//  - AggregatedView makes sure that ext.setAlignmentService(service) is called as soon as alignmentService and extension are ready
const AlignmentClientExtensions = [
    ExtNames.ModelAlignment,
    ExtNames.SheetAlignment,
];

// Get model key. Input may be bubbleNode, Model, or model key already.
const makeKey = (value) => {

    if (value instanceof av.BubbleNode) {
        return value.getModelKey();
    }

    // For LMV models, get bubbleNode first
    if (value instanceof av.Model) {
        return value.getDocumentNode()?.getModelKey();
    }

    if (typeof value === 'string') {
        return value;
    }
    console.error("makeKey: Input must be key, model, or BubbleNode");
};

const createModelItem = (node) => {
    return {
        // av.Model or null (if the model root is loading)
        model: null, // av.Model

        // Same as model.getDocumentNode(), but model may be null if the root is not loaded yet.
        node: node, // av.BubbleNode

        // A model is "set to be visible" if either
        //  a) model is already displayed
        //  b) model will be displayed as soon as model root is loaded
        visible: false,

        // Url used for the loadModel - needed for cancelling loads if model root is not available yet
        url: null,

        // Indicates that the model root of this model is currently loading
        loadingPromise: null,

        // Indicates that we already tried loading this model, but failed
        error: false
    };
};

// Empty 3D views may be confusing and easily mistaken for a bug.
// Therefore, we notify the user if the shown model is empty.
const warnIfModelEmpty = (model) => {
    const data = model.getData();
    const bubbleNode = data.loadOptions.bubbleNode;
    const modelEmpty = (model.is3d() && data.metadata.stats && !data.metadata.stats.num_fragments);
    if (modelEmpty) {
        const viewName  = bubbleNode.name();
        const modelName = bubbleNode.getRootNode().children[0].name();
        console.warn(`Empty View "${viewName}" in model "${modelName}".`);
    }
};

const isVectorFinite = (vec) => {
    return isFinite(vec.x) && isFinite(vec.y) && isFinite(vec.z);
};

const isBoxFinite = (box) => {
    return isVectorFinite(box.min) && isVectorFinite(box.max);
};

const getUpVector = (model) => {
    let upVectorArray = model.getUpVector();
    return upVectorArray && new THREE.Vector3().fromArray(upVectorArray);
};

const isCameraValid = (camera) => {
    return (
        isVectorFinite(camera.position) &&
        isVectorFinite(camera.target) &&
        isVectorFinite(camera.up) &&
        isFinite(camera.orthoScale)
    );
};

// Helper function for home camera:
// Check how many models are intersecting the frustum when using a certain camera.
const countCatchedModels = (models, camPos, frustum) => {

    let catchedModels = 0;
    const tmpSize = new THREE.Vector3();
    for (let i=0; i<models.length; i++) {

        // model outside frustum? => consider as missed
        const model = models[i];
        const bbox  = model.getBoundingBox();
        if (frustum.intersectsBox(bbox) === Autodesk.Viewing.Private.FrustumIntersector.OUTSIDE) {
            continue;
        }

        // also consider models as missed if they are extremely far away from the camera
        const diag = bbox.getSize(tmpSize).length;
        const dist = bbox.distanceToPoint(camPos);
        if (dist > diag * 50) {
            continue;
        }

        catchedModels++;
    }

    return catchedModels;
};

const defaultDiffOptions = {
    enabled            : false,
    diffBubbles        : undefined,
    primaryBubbles     : undefined,
    diffBubbleLabel    : undefined,
    primaryBubbleLabel : undefined,
    progressCallback   : undefined,
    supportBubbles     : undefined,
    refNames           : undefined,
    customCompute      : undefined,
};

// As home camera for aggregated views, we use the default camera of one of the visible models.
// The choice is done in a way that we have as many visible models in frustum as possible.
const updateHomeCamera = (viewer, cameraValidator) => {

    // Filter out any crappy models in advance (empty or infinite bbox)
    let models = viewer.getVisibleModels();
    models = models.filter(model => isBoxFinite(model.getBoundingBox()));

    let tmpCam     = viewer.impl.camera.clone();
    let frustum = new Autodesk.Viewing.Private.FrustumIntersector();

    // Get model from the first model that defines it (must match anyway).
    // For the camera, we choose the default cam of the largest model (wrt. to data size).
    let upVector  = undefined;
    let camera    = undefined;
    let bestScore = undefined;
    let ownerModel = undefined; // The model that we took the default camera from
    const tmpSize = new THREE.Vector3();
    for (let i = 0; i < models.length; i++) {
        const model = models[i];

        // Choose the first up-vector we get
        // We assume identical ones - otherwise, the aggregated model would be weird anyway.
        if (!upVector) {
            upVector = getUpVector(model);
        }

        // Consider default cam if valid
        const modelCam = model.getDefaultCamera();
        if (!modelCam || !isCameraValid(modelCam)) {
            continue;
        }

        const modelBox = model.getBoundingBox();

        // Configure frustum test for this camera
        tmpCam.position.copy(modelCam.position);
        tmpCam.target.copy(modelCam.target);
        tmpCam.up.copy(modelCam.up);
        tmpCam.isPerspective = modelCam.isPerspective;
        tmpCam.near = modelBox.distanceToPoint(tmpCam.position);
        tmpCam.far  = tmpCam.near + modelBox.getSize(tmpSize).length;
        tmpCam.updateMatrixWorld();
        tmpCam.updateProjectionMatrix();
        frustum.reset(tmpCam);

        // Choose camera that catched most models
        const score = countCatchedModels(models, modelCam.position, frustum);
        if (!camera || score >= bestScore) {
            camera = modelCam;
            bestScore = score;
            ownerModel = model;
        }
    }

    if (!camera) {
        return;
    }

    // Extend camera by...
    //  1. pivot: Otherwise, autocam may leave the pivot point at some far-away position
    //     and the camera will orbit into void on next move.
    //  2. worldup: To make sure that we are not using the wrong axis for orbiting
    //  3. fov: always use reasonable default
    camera.pivot = camera.target;
    camera.worldup = upVector;
    camera.fov    = 45.0;

    // apply optional custom repair
    cameraValidator && cameraValidator(camera, ownerModel);

    viewer.autocam.setHomeViewFrom(camera);
};

// Helper class to manage modelTheming state for a single model
class ModelThemingState {

    constructor(color) {
        // Currently assigned theming color
        this.color = color; // Vector4

        // Used to avoid conflicts with DiffTool: If false, we don't touch theming colors until enabled again.
        this.enabled = true;

        // indiciates if the theming colors of the
        // model are currently applied
        this.active = false;
    }

    setEnabled(model, enable) {
        if (enable === this.enabled) {
            return;
        }
        this.enabled = enable;

        // revert theme colors if needed
        if (this.active && !enable) {
            model.clearThemingColors();
            this.active = false;
        } else {
            this.update(model);
        }
    }

    update(model) {
        // Don't change theming if already applied or disabled
        if (this.active || !this.enabled) {
            return;
        }

        // set color for all dbIds that are associated with shapes. Note that some dbIds may appear more
        // than once, but this is not a problem here.
        const dbIds = model.myData.fragments.fragId2dbId;
        for (let i=0; i<dbIds.length; i++) {
            const dbId = dbIds[i];
            model.setThemingColor(dbId, this.color);
        }

        this.active = true;
    }
}

/**
 * AggregatedView implements a viewing application based on Viewer3D. Its purpose is to provide functionality around Viewer3D to facilitate implementation of viewer application workflows like switching between different views or toggling models on/off dynamically.
 *
 * Examples of AggregatedView functionality include:
 *
 * 1. __Faciliate use in react__: Just set an array of nodes from React property and AggregatedView takes care to make sure that models are loaded and shown/hidden as needed.
 * 2. __LRU-Caching of models__: Keep models in memory for fast switches, but unload unsused models if memory is critical
 * 3. __Extensions__: Setting up a couple of useful default extensions (can be customized or switched off where wanted)
 * 4. __Home camera__: Setting a home view camera that considers multiple models.
 * 5. __Application State management__: Facilitates some state management, e.g.
 *    a. _Setting a camera without having to care whether the model is already loaded or not.
 *    b. Starting Walk-mode without having to care whether BIMWalk extension is already loaded.
 *    c. Allow toggling visibility of a model without having to care about the loading state of the model.
 * 6. __GlobalOffsets__: Choose globalOffset automatically, but identically for all models to make sure that they are placed consistently.
 * 7. __View Switches__: Allow visibility toggling (`hide`/`show`) versus full view switches (`switchView(nodes)`), the latter including proper reset of camera, UI, and extensions
 * 8. __Diff Setups__: Just set diffOptions to setup change visualization of aggregated views.
 *
 * @example
 *   const view = new Autodesk.Viewing.AggregatedView();
 *   // Initialize the aggregatedView with the HTML element and the options object
 *   await view.init(viewerElement, options);
 *
 * @memberof Autodesk.Viewing
 * @alias Autodesk.Viewing.AggregatedView
 * @class
 */
export class AggregatedView {

    constructor() {

        // The purpose of the global offset is to avoid float inaccuracies for georeferenced
        // models with large offset. Note that we only use (0,0,0) as long as we don't
        // know anything better (see resetRefPoint())
        //
        // By default, LMV chooses the center of the model. This is okay for
        // a single model. But for multiple ones, it would mean to center all models
        // independently, so that their relative placement would be lost.
        this.globalOffset = undefined;

        // refPoint is chosen once per view switch and determined from the first model
        // to be shown. The globalOffset is only reset if too far away from the current refPoint.
        this.refPoint = undefined;

        // Contains modelItems for all models that are in memory or currently loading.
        // Indexed by modelKey (string).
        this.modelItems = {};

        // Indicates whether we have to setup LMV for a new view on next model add,
        // e.g., creating/updating the LMV toolbar and reset tools. We want to do this only
        // on startup or after an explicit view switch by the user.
        this.resetOnNextModelAdd = true;

        // In case resetOnNextModelAdd was triggered by showing a model, we save it here. This helps
        // avoids concurrency problems where more than one model is loaded at a time, i.e. a 2D sheet is loaded and
        // immediately a 3D model as well, but the 3D model triggers a reset, and only then the 2D sheet triggers it again
        // In that case, the UI will be reset according to the 2D, whereas the 3D model was loaded last. This variable
        // will ensure the last one that updated it will have the last word.
        this.resetTriggeringBubble = null;

        this.memTracker = null;

        this.cameraInitialized = false;

        // If true, the viewer is configured for 3D viewing, otherwise for 2d.
        // This flag is determined whenever adding the first model to an empty view.
        this.is3D = undefined;

        // If a camera is set before the global offset is determined, we keep it here and
        // apply it as soon as globalOffset is initialized.
        this.pendingCamera = null;

        // Since extension load is async, viewer.getExtension() may return null although we called loadExtension already.
        // For extensions that we load/unload dynamically, we track the state here - to avoid loading the same extension twice.
        this.extensionLoaded = {};

        this.loadersInProgress = {};

        // Current diff-view configuration.
        this.diff = {...defaultDiffOptions};

        // Keys of all models that we keep ghosted during diff mode
        // (if they are not participating in the diff)
        this.modelIsGhosted = {};

        // Cache diffs to avoid frequent recomputation
        this.diffCache = [];

        // Set this to be notified when diff load/computation is finished
        this.onDiffDone = undefined;

        // Indicates that the first 3D model is loading and we have to wait for it
        // to finish before we can load another model. This is needed to determine a consistent globalOffset.
        this.waitForFirstModel = false;

        // Mapping from modelKey to an object with {resolve, reject}, that will fulfill a pending load promise
        // when waitForFirstModel is done.
        this.loadPendingPromises = {};

        // Internally used array of callbacks that are triggered when a model is loaded.
        this.onLoad = [];

        // Internally used array of callbacks that are triggered when a model is unloaded.
        this.onUnload = [];

        // Optional: Assign theming color based on model (for 3D aggregated views)
        this.modelThemingStates = {}; // keys: modelId, values: ModelThemingState

        // Simplify debugging.
        // Note: This value is ONLY for debugging purposes and not supposed to be used in production code.
        window.LMV_MAIN_VIEW = this;

        // Only used if fetchAlignment is called before AlignmentService is ready
        this.pendingAlignmentFetches = []; // Promise[]

        Autodesk.Viewing.EventDispatcher.prototype.apply(this);
    }

    /**
     * Initializes the AggregatedView and loads the following predefined extensions: `Autodesk.CrossFadeEffects`, `Autodesk.AEC.LevelsExtension`, `Autodesk.ModelStructure`, `Autodesk.AEC.HyperlinkExtension`, `Autodesk.AEC.Minimap3DExtension`, `Autodesk.AEC.CanvasBookmarkExtension` and `Autodesk.AEC.DropMeExtension`
     * The initialization can also be customized with the options object.
     *
     * To initialize the viewer without loading the specified extension please reference {@link Autodesk.Viewing.AggregatedView#initViewerInstance|initViewerInstance}.
     *
     * @param {HTMLDivElement} parentDiv - The div element in which the viewer will be initialized
     * @param {Object} [options={}] - Configuration options for aggregated view
     * @param {Object} [options.viewerConfig] - Used for initializing GuiViewer3D. This is the options object that is passed into either av.Viewer3D or av.GuiViewer3D
     * @param {boolean} [options.disableBookmarks] - Disable display of visual bookmarks
     * @param {Object} [options.clusterfck] - Dependency-Injection of clusterfck library (enables clustering of Bookmark icons)
     * @param {Object} [options.viewerStartOptions] - Options passed to the viewer initialization process
     * @param {boolean} [options.ignoreGlobalOffset] - Forces globalOffset to undefined for all loaded models. Effect of this is that all models are auto-centered using the model bbox. Note that this does only work if you never show more than one 3D viewable at once
     * @param {boolean} [options.unloadUnfinishedModels] - By setting unloadUnfinishedModels, when calling hide(bubbleNode), it will unload models that haven't been fully loaded. Used in order to reduce amount of file loaders when switching between models
     * @param {boolean} [options.useDynamicGlobalOffset] - If true, the globalOffset is applied dynamically after loading
     * @param {boolean} [options.cameraValidator] - Called with a (camera, model) when using a model camera as start or home camera. This allows for clients to apply optional custom repairs for models with messy camera data
     * @param {string[]} [options.propagateInputEventTypes] - By default, LMV ToolController "eats" all handled events so that they don't reach any other widgets. Specify an array of event types that you want this behaviour disabled for. For example ['mouseup', 'mousedown'] allows alloy to detect mouse outside clicks to close pending dropdown menus
     * @param {function} options.createModelAlignmentService - Factory function to create AlignmentService implementation for loading/saving model transforms. See AlignmentServices above for details
     * @param {function} [options.getCustomLoadOptions] - Allows for applying custom options to be used for all model loading. The callback returns an options object that is applied by default in all model-load calls. The signature should look like: function(av.BubbleNode)=>Object
     * @param {string} [options.viewerUnits] - If specified, all models are re-scaled from model units to this unit. Must be a GNU unit format string, e.g. "m".
     * @param {Autodesk.Viewing.MultiViewerFactory} [options.multiViewerFactory] - Optional multi viewer factory. Used to create multiple viewers with shared resources
     * @param {boolean} [options.useConsolidation] - Optional flag to enable / disable mesh consolidation. Defaults to true.
     *
     * @returns {Promise} - returns a promise once all of the specified extensions are loaded.
     * @alias Autodesk.Viewing.AggregatedView#init
     */
    init(parentDiv, options = {}) {
        options.useConsolidation = options.useConsolidation !== undefined ? options.useConsolidation : true;
        this.initViewerInstance(parentDiv, options);

        this.memTracker = new av.ModelMemoryTracker(this.viewer, options.memoryLimit);

        // Activate transparency improvement by default
        this.viewer.impl.showTransparencyWhenMoving();

        // Activate dynamic globalOffset if wanted
        if (options.useDynamicGlobalOffset) {
            this.dynamicGlobalOffset = new DynamicGlobalOffset(this.viewer);
        }

        this.options = options;

        this._registerLmvEventListeners();
        return this._loadExtensions();
    }

    /**
     * Initialize a new viewer instance.
     *
     * To initialize the viewer and load the default extensions please see {@link Autodesk.Viewing.AggregatedView#init|init}.
     * @param {HTMLDivElement} parentDiv - The div element in which the viewer will be initialized
     * @param {Object} [options={}] - The same options object that is passed into the init method
     * @alias Autodesk.Viewing.AggregatedView#initViewerInstance
     */
    initViewerInstance(parentDiv, options = {}) {
        const ViewerClass = options.viewerClass || (options.headlessViewer ? av.Viewer3D : av.GuiViewer3D);

        // Disable auto-load of default hyperlink extension. Reasons:
        //  a) It produces asserts for background loading, because it assumes 'viewer.model' to exist
        //  b) Design Collaboration are using AEC hyperlink extension instead, and Docs are using
        //  another custom extension
        let config = options.viewerConfig || {};
        config.disabledExtensions = config.disabledExtensions || {};
        config.disabledExtensions.hyperlink = true;

        if (options.multiViewerFactory) {
            this.viewer = options.multiViewerFactory.createViewer(parentDiv, options.viewerConfig, ViewerClass);
        } else {
            this.viewer = new ViewerClass(parentDiv, options.viewerConfig);
        }

        this.viewer.start(undefined, undefined, undefined, undefined, options.viewerStartOptions);

        // Optional: Avoid ToolController from hijacking input events
        if (options.propagateInputEventTypes) {
            this.viewer.toolController.propagateInputEventTypes = options.propagateInputEventTypes;

            // Workaround: Avoid annoying browser-invoked outline if the canvas element gets focus.
            // TODO: Find a cleaner way to solve this. I didn't want change the css, because this
            //       might cause side effects on other clients that maybe don't care about the propagateInputEventTypes option.
            this.viewer.canvas.style.outline = 'none';
        }
    }

    destroy() {        
        this.dynamicGlobalOffset = null;
        this.memTracker = null;
        this.modelItems = null;

        this.viewer?.finish();
        this.viewer = null;

        window.LMV_MAIN_VIEW = null;
    }

    /**
     * Method that can be overwritten to log errors to service. Default implementation just logs to console.error.
     * @param args The messages and other things that should be logged
     * @private
     */
    _onError(...args) {
        console.error(...args);
    }

    /**
     * Resets tools, UI, camera, and refPoint.
     * This method should be called when an explicit view switch occurred instead of just toggling visibility of models.
     * @alias Autodesk.Viewing.AggregatedView#reset
     */
    reset() {

        // hide all previously visible models, so that there are no visible models in the viewer anymore.
        // This will make sure that the viewer will configured itself properly when adding the first new model.
        this.hideAll();

        // make sure that the camera is reset when new models are added
        this.pendingCamera     = null;
        this.cameraInitialized = false;

        // Reset UI and tools on next model-add
        this.resetOnNextModelAdd = true;

        // Make sure that no LMV tools remain in the middle of an interaction - like measurements, sections etc.
        this._stopActiveTools();

        // Finish previous diff and discard cached diff results when switching to another view
        this._unloadDiffTool(true);

        // Consider that refPoint may change with next viewable
        this.refPoint = undefined;

        this.loadersInProgress = {};
    }

    /**
     * Finds a model for the given bubbleNode or key.
     * To get multiple models reference {@link Autodesk.Viewing.AggregatedView#getModels|getModels}.
     * To make sure that the model is loaded reference {@link Autodesk.Viewing.AggregatedView#getModelAndWait|getModelAndWait}.
     *
     * @example
     *   const nodes = view.getVisibleNodes();
     *   // Get the model of the first bubble node.
     *   const model = view.getModel(nodes[0]);
     *
     * @param {Autodesk.Viewing.BubbleNode} - The Bubble node to use to get the model
     * @returns {Autodesk.Viewing.Model} - The model that corresponds to the bubbleNode
     * @alias Autodesk.Viewing.AggregatedView#getModel
     */
    getModel(node) {
        const item = this._getItem(node);
        return item && item.model;
    }

    /**
     * Find a model for given bubbleNode or key.
     * If the model is not available yet, wait until it's ready.
     * @example
     *   const model = await view.getModelAndWait(node);
     *
     * @param {Autodesk.Viewing.BubbleNode} node - The Bubble node to use to get the model
     * @param {Boolean} [checkIfVisible=false] - If true, will wait until model is also visible
     * @returns {Promise} - the promise resolves once the model is loaded with the model instance
     * @alias Autodesk.Viewing.AggregatedView#getModelAndWait
     */
    getModelAndWait(node, checkIfVisible = false) {
        return new Promise((resolve) => {
            const onEvent = () => {
                const model = this.getModel(node);

                if (model) {
                    this.viewer.removeEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, onEvent);
                    this.onLoad.splice(this.onLoad.indexOf(onEvent), 1);
                    return resolve(model);
                }
            };

            const waitForVisible = checkIfVisible && !this.isVisible(node);

            if (!waitForVisible) {
                const model = this.getModel(node);
                if (model) {
                    return resolve(model);
                }
            }

            this.viewer.addEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, onEvent);
            this.onLoad.push(onEvent);
        });
    }

    /**
     * Returns true if there are no visible bubble nodes.
     * @returns {Boolean} - returns true if all nodes are invisible
     * @alias Autodesk.Viewing.AggregatedView#isEmpty
     */
    isEmpty() {
        return !this.getVisibleNodes().length;
    }

    // - If showing a 3D model, and until now all are 2D -> reset and set is3D = true
    //   (In this case areAllNodes2D doesn't include the newly added 3D model yet)
    // - If hiding a 3D model, and now all are 2D -> reset and set is3D = false
    //   (If we call this function after already hiding the 3D model, areAllNodes2D won't include it)
    _initForEnvironmentChange(bubbleNode, isShowing) {
        if (this.areAllNodes2D() && bubbleNode.is3D()) {
            this.is3D = isShowing;

            let item;
            if (!isShowing) {
                // When hiding a 3D model, we need to update using one of the 2D models
                const filter2D = item => item.visible && item.node && item.node.is2D();
                item = Object.values(this.modelItems).filter(filter2D)[0];
                bubbleNode = item.node;
            }

            // Make sure that the right extensions are loaded/unloaded
            this._updateExtensions(bubbleNode);
            // Before loading a 3D viewable, we must choose a refPoint for the view.
            this._updateRefPoint(bubbleNode);
            // Make sure the UI is reset for the correct mode
            if (isShowing) {
                this.resetOnNextModelAdd = true;
                this.resetTriggeringBubble = bubbleNode;
            } else if (item.model) {
                this._resetOnModeSwitch(item.model);
                this.viewer.impl.setUp2DMode(item.model, false);
                this.viewer.getExtension('Autodesk.ViewCubeUi', ext => ext.displayViewCube(false, false));
            }

            this.fireEvent({ type: Events.ENVIRONMENT_CHANGED, is3D: this.is3D });
        }
    }

    _needsReset(bubbleNode) {
        if (!this.resetOnNextModelAdd) {
            return false;
        }

        if (this.resetTriggeringBubble && this.resetTriggeringBubble !== bubbleNode) {
            return false;
        }

        return true;
    }

    /**
     * Makes sure that a model is loaded and shown
     *
     * To get the bubbleNode from a URN please reference {@link Autodesk.Viewing.Document#load|Document#load}.
     *
     * @example
     *   // Load a document from a documentId/URN
     *   Autodesk.Viewing.Document.load(documentId, (doc) => {
     *     // Find all of the 3D bubble nodes
     *     var nodes3D = doc.docRoot.search({ role: '3d', type: "geometry" });
     *
     *     // Using aggregated view load and show the model.
     *     const model = await view.show(nodes3D[0]);
     *   });
     *
     *
     * @param {Autodesk.Viewing.BubbleNode} bubbleNode - The node to load and show in the viewer
     * @param {Object} [customLoadOptions] - Optional extra loadOptions to override/extend the default ones
     * @returns {Promise} - Returns a promise which resolves with the model
     * @alias Autodesk.Viewing.AggregatedView#show
     */
    show(bubbleNode, customLoadOptions) {

        // Auto-Configure for 2D or 3D based on first node to show
        const isFirstViewable = this.isEmpty();
        if (isFirstViewable) {
            this._initForFirstViewable(bubbleNode);
        } else {
            this._initForEnvironmentChange(bubbleNode, true);
        }

        const modelKey = bubbleNode.getModelKey();

        // Either load model or show it directly
        let model = this.getModel(modelKey);
        let promise;
        if (model) {
            // Need to set before the call to _showModel here, since _updateUpVector needs the updated value
            this.modelItems[modelKey].visible = true;
            this._showModel(model);
            promise = Promise.resolve(model);
        } else {
            // load model (if not loading already)
            promise = this.modelItems[modelKey]?.loadingPromise;
            if (!promise) {
                // Model will be added later when root is loaded
                promise = this.load(bubbleNode, customLoadOptions);
            }

            // After load(), the model item always exists
            this.modelItems[modelKey].visible = true;
        }

        // keep memTracker up-to-date about visible/used models
        this._updateModelTimestamps();

        // consolidate new models if possible
        this._consolidateVisibleModels();

        return promise;
    }

    /**
     * Hides the model associated from the supplied bubble node.
     *
     * To show the model reference {@link Autodesk.Viewing.AggregatedView#show|show}.
     *
     * @example
     *   view.hide(node);
     *
     * @param {Autodesk.Viewing.BubbleNode} bubbleNode - The node to hide in the viewer
     * @alias Autodesk.Viewing.AggregatedView#hide
     */
    hide(bubbleNode) {
        let item = this._getItem(bubbleNode);
        if (!item) {
            return;
        }

        if (this.options.unloadUnfinishedModels && (!item.model || !item.model.isLoadDone())) {
            this.unload(item.node); // Unload will cancel pending loaders in case there's no model yet
        } else if (item.model) {
            // Note that the model root might not be loaded yet. In this case, we don't need to call hideModel:
            // onModelLoaded() callback takes care that new models are only added if still set to visible.
            this.viewer.hideModel(item.model.id);
        }

        item.visible = false;

        updateHomeCamera(this.viewer, this.options.cameraValidator); // Recompute home-view for remaining visible models
        this._updateUpVector();

        // Make sure that a model is unloaded immediately if memory is low
        this._cleanupModels();

        this._initForEnvironmentChange(item.node, false);
    }

    /**
     * Returns true if the supplied bubble node is currently visible.
     * @param {Autodesk.Viewing.BubbleNode} bubbleNode - The BubbleNode to check the visibility of
     * @returns {Boolean} - true if the specified node is visible, false otherwise
     * @alias Autodesk.Viewing.AggregatedView#isVisible
     */
    isVisible(bubbleNode) {
        const item = this._getItem(bubbleNode);
        return item && item.visible;
    }

    /**
     * Hide all of the models in the viewer.
     * @alias Autodesk.Viewing.AggregatedView#hideAll
     */
    hideAll() {
        for (let key in this.modelItems) {
            this.hide(key);
        }
    }

    /**
     * Returns all of the visible bubble nodes.
     * @returns {Autodesk.Viewing.BubbleNode[]} - An array of all of the visible nodes
     * @alias Autodesk.Viewing.AggregatedView#getVisibleNodes
     */
    getVisibleNodes() {

        let nodes = [];
        for (let key in this.modelItems) {
            // Note that item.model may be null during loading, so we cannot use item.model.getDocumentNode()
            let item = this.modelItems[key];
            if (item.visible) {
                nodes.push(item.node);
            }
        }
        return nodes;
    }

    /**
     * Returns true if all of the nodes are 2D.
     * @returns {Boolean} - returns true if all nodes are 2D, false otherwise.
     * @alias Autodesk.Viewing.AggregatedView#areAllNodes2D
     */
    areAllNodes2D() {
        const nodes = this.getVisibleNodes();
        if (nodes.length) {
            // If the node is not a BubbleNode, it is an image, and it should be considered as 2d as well.
            return nodes.every(node => !(node instanceof Autodesk.Viewing.BubbleNode) || node.is2D());
        }

        return false;
    }

    /**
     * Checks if the Otg manifest for a 3D viewable is available and complete. If not, it reports an error and returns false.
     * @param {Autodesk.Viewing.BubbleNode} bubbleNode - The BubbleNode
     * @returns {Boolean} - true if the OTG manifest is missing.
     * @alias Autodesk.Viewing.AggregatedView#isOtgManifestMissing
     */
    isOtgManifestMissing(bubbleNode) {

        if (bubbleNode.is2D()) {
            return false;
        }

        let otgNode = bubbleNode.getOtgGraphicsNode();
        if (otgNode && !otgNode.error) {
            return false;
        }

        // This can only happen if the overall manifest conversion
        // succeeded, but conversion failed for some of its viewables.
        // A failure of the whole document conversion should have been handled outside on manifest load already.
        if (!otgNode) {
            this._onError(`Otg node missing for viewable '${bubbleNode.name()}'.`);
        } else {
            this._onError(`Otg translation failed for viewable '${bubbleNode.name()}'. Error:`, otgNode.error);
        }

        if (this.onViewerNotification) {
            const msg = av.i18n.t("Model translation failed for view '%(viewableName)'", {
               viewableName: bubbleNode.name()
            });
            this.onViewerNotification('error', msg);
        }

        return true;
    }

    /**
     * Loads the model that is specified by the passed in bubbleNode parameter. Note this function will not show the model once it is loaded.
     * To load and show the model reference the {@link Autodesk.Viewing.AggregatedView#show|show} method.
     * @param {Autodesk.Viewing.BubbleNode} bubbleNode - The BubbleNode
     * @param {Object} [customLoadOptions] - Optional extra loadOptions to override/extend the default ones
     * @returns {Promise} - The promise resolves with the loaded model
     * @alias Autodesk.Viewing.AggregatedView#load
     */
    load(bubbleNode, customLoadOptions = null) {

        // get or create model item
        const modelKey = makeKey(bubbleNode);
        let item = this.modelItems[modelKey];
        if (!item) {
            item = createModelItem(bubbleNode);
            this.modelItems[modelKey] = item;
        }

        // do nothing if model load was triggered before
        if (item.model) {
            return Promise.resolve(item.model);
        }

        // If client requires Otg for 3D viewables, check if Otg manifest is available and complete for 3D case.
        if (this.options.disableSvf && this.isOtgManifestMissing(bubbleNode)) {
            // LMV-5879: When the otg manifest is missing do not block other nodes from being loaded.
            item.error = true;
            return Promise.reject('OTG manifest missing');
        }

        if (item.loadingPromise || item.error) {
            return Promise.reject('Model load was already triggered');
        }

        // For 3D models, we need some extra code for globalOffset handling
        if (bubbleNode.is3D()) {

            // Defer loading if necessary
            if (this.waitForFirstModel) {
                // Another 3D viewable is loading. We have to wait for it, so that we
                // know which globalOffset to use. Loading will be triggered in _modelRootLoadEnded() later.
                return new Promise((resolve, reject) => {
                    this.loadPendingPromises[modelKey] = { resolve, reject };
                });
            }

            // If globalOffset is not initialized yet, block other models until this one is finished
            if (!this.options.ignoreGlobalOffset && !this.globalOffset) {
                this.waitForFirstModel = true;
            }
        }

        // Get LMV document to obtain acm session
        let root = bubbleNode.getRootNode();
        let doc  = root.getDocument();

        const loadOptions = {
            // model is translated by -globalOffset. If undefined, LMV uses the model center.
            globalOffset: this.globalOffset,

            // consider geo-referencing for consistent placement: If the model contains a georeferencing transform,
            // it is applied by LMV at load-time.
            applyRefPoint: true,

            // Optional: Scale all models from model-file units to viewer units.
            applyScaling: this.options.viewerUnits,

            isAEC: true,

            // A too fine-grained BVH reduces the performance gain when using consolidation. This is avoided by using the recommended BVH defaults.
            // When setting useConsolidation to true (default for AEC), this would be done automatically. But this would also run consolidation preprocessing when
            // a model is loaded, which may temporarily affect the framerate and bypass the memory tracking. Therefore, we run consolidation
            // later as soon as all animations are finished.
            bvhOptions: avp.Consolidation.getDefaultBVHOptions(),
            useConsolidation: false,

            // We don't want LMV to auto-add models on load, but control adding of models ourselves instead. E.g., because:
            //  - The user might have toggled the model off or done a view switch meanwhile
            //  - The model might just be loaded for other purposes than show (e.g. support models for 2D diff)
            loadAsHidden: true,

            // Remember bubble node. This simplifies debugging, e.g. by helping to get the view name for a model.
            bubbleNode: bubbleNode,

            // Reduce memory consumption by computing bounding boxes on-the-fly. This is only a problem for the model explode tool, which we do not use.
            disablePrecomputedNodeBoxes: true,

            // Avoid LMV from auto-resetting the camera on model-add. E.g., we don't want to jump the camera around just because we toggled visibility of a model.
            preserveView: true,

            // Track progress of fragment list loading (used for diff progress bar)
            onFragmentListLoadProgress: () => this._updateDiffLoadProgress(),

            // Finding layers in propDb adds significant effort to the worker. If any client of AggregatedView wants to use 3DModelLayers,
            // we can add an option for that - or allow some general customization of load options.
            disable3DModelLayers: true,

            // Avoid loadDocumentNode() from auto-unloading all other models
            keepCurrentModels: true,

            // Prevent the creation of LMV's default UI.
            headlessViewer: this.options.headlessViewer,

            // Load Leaflet models in page coordinates by default.
            leafletOptions: { fitPaperSize: true },
        };

        const onModelLoaded = this._onModelLoaded.bind(this);
        const onModelLoadFailed = (errorCode) => this._onModelLoadFailed(bubbleNode, errorCode);

        // customLoadOptions is only provided if the client calls load() manually from outside. Usually, load() is rather called internally
        // by AggregatedView whenever we show a model that is not cached yet. For those internal load() calls, custom loadOptions are controlled
        // via a callback specified in AggregatedView options.
        const globalCustomLoadOptions = this.options.getCustomLoadOptions?.(bubbleNode);

        if (globalCustomLoadOptions) {
            Object.assign(loadOptions, globalCustomLoadOptions);
        }

        if (customLoadOptions) {
            Object.assign(loadOptions, customLoadOptions);
        }

        item.loadingPromise = new Promise((resolve, reject) => {

            // Allow alignmentService to customize the refPointTransform in the loadOptions. If no service or no matrix is specified,
            // applyAlignmentservice() just resolves immediately (default).
            this._applyAlignmentService(bubbleNode, loadOptions).then(
                () => this.viewer.loadDocumentNode(doc, bubbleNode, loadOptions)
            ).then((model) => {
                onModelLoaded(model);
                resolve(model);
            }).catch((error) => {
                onModelLoadFailed(error);
                reject(error);
            });
        });
        return item.loadingPromise;
    }

    /**
     * @private
     */
    unloadUnderlayRaster(bubbleNode) {
        const underlayRasterModel = this.viewer.getUnderlayRaster(bubbleNode);

        if (underlayRasterModel) {
            this.viewer.unloadModel(underlayRasterModel);
        }
    }

    /**
     * Unload the model that corresponds with the passed in bubbleNode.
     *
     * @example
     *   const nodes = view.getVisibleNodes();
     *   // Unload the first model
     *   view.unload(nodes[0]);
     *
     * @param {Autodesk.Viewing.BubbleNode} bubbleNode - The BubbleNode to unload
     * @alias Autodesk.Viewing.AggregatedView#unload
     */
    unload(bubbleNode) {
        this.unloadUnderlayRaster(bubbleNode);

        this.viewer.unloadDocumentNode(bubbleNode);

        // Usually, item will exist - unless the model was not loaded via AggregatedView.
        const item = this._getItem(bubbleNode);
        if (item) {
            // Signal that model loading was cancelled.
            // Why needed?: The model we just unloaded might have been the first one - and others might be waiting for it to obtain the globalOffset.
            if (item.loading) {
                this._onModelLoadEnded(item);
            }

            // Remove model from overall geometry-load progress tracking.
            // TODO: We shouldn't have to care for this here. We should better add general support of aggregated load progress in Viewer3D directly.
            if (item.model) {
                delete this.loadersInProgress[item.model.id];
            }
        }

        // delete item state
        let key  = makeKey(bubbleNode);
        delete this.modelItems[key];

        // set themingState to inactive, so that colors are re-applied in case the model is reloaded
        const state = this.modelThemingStates[key];
        if (state) {
            state.active = false;
        }

        // Notify listener callbacks
        this.onUnload.forEach(cb => cb(bubbleNode));
    }

    /**
     * Unload all of the models that are currently in the view.
     *
     * @example
     *   // This example will unload all invisible models.
     *   view.unloadAll((item) => {
     *     return !item.visible
     *   });
     *
     * @param {Function} [itemFilter] - This callback is used to check if a model needs to be unloaded. This callback recieves an object describing the current view item and it should return a boolean
     * @alias Autodesk.Viewing.AggregatedView#unloadAll
     */
    unloadAll(itemFilter) {
        let keys = Object.keys(this.modelItems).slice();
        for (var i = 0; i < keys.length; i++) {
          let key  = keys[i];
            let item = this.modelItems[key];

            if (!itemFilter || itemFilter(item)) {
                this.unload(item.node);
            }
        }
    }

    /**
     * Set camera in global coords.
     * - The current global offset is automatically subtracted
     * - You don't have to specify all members, e.g., can leave out up or fov. Only defined values are replaced.
     * - You can call it independent of loading state: If no model is loaded yet, the camera change is applied after first model add
     * - Note that the call only has effect on current view, i.e., is discarded on reset/viewSwitch calls.
     *
     * @param {THREE.Camera} camera - Camera instance that will be used to apply to global camera
     * @alias Autodesk.Viewing.AggregatedView#setCameraGlobal
     */
    setCameraGlobal(camera) {
        // We copy the vector-values to avoid time-dependent traps if input vectors are changed after the call
        this.pendingCamera = {
            position:      camera.position && new THREE.Vector3().copy(camera.position),
            target:        camera.target   && new THREE.Vector3().copy(camera.target),
            up:            camera.up       && new THREE.Vector3().copy(camera.up),
            fov:           camera.fov,
            isPerspective: camera.isPerspective,
            ignoreGlobalOffset: camera.ignoreGlobalOffset,
        };

        // Apply camera right now if possible - otherwise later after camera initialize on first model add
        this._applyPendingCameraWhenReady();
    }

    /**
     * Set the view from the passed in camera.
     *
     * @param {THREE.Camera} camera - Camera instance
     * @alias Autodesk.Viewing.AggregatedView#setCamera
     */
    setCamera(camera) {
        this.viewer.impl.setViewFromCamera(camera, true);
        this.cameraInitialized = true;
    }

    /**
     * Starts the BIM walk tool. Under the hood this method will activate the BimWalk extension.
     * @alias Autodesk.Viewing.AggregatedView#startBimWalk
     */
    startBimWalk() {
        this.bimWalkStartPending = true;
        this._startBimWalkWhenReady();
    }

    /**
     * Stop the BIM walk tool. Under the hood this method will deactivate the BimWalk extension.
     * @alias Autodesk.Viewing.AggregatedView#stopBimWalk
     */
    stopBimWalk() {
        let ext = this.viewer.getExtension(ExtNames.BimWalk);
        if (ext && ext.isActive()) {
            ext.deactivate();
        }
        // If a start was pending, cancel it.
        this.bimWalkStartPending = false;
    }

    /**
     * Returns true if the BimWalk tool is active.
     * @returns {Boolean} - true if the tool is active, false otherwise.
     * @alias Autodesk.Viewing.AggregatedView#isBimWalkActive
     */
    isBimWalkActive() {
        let ext = this.viewer.getExtension('Autodesk.BimWalk');
        return (ext && ext.activeStatus) || this.bimWalkStartPending;
    }



    /**
     * Switches between bubble node models. This method will reset the view and then set the passed in nodes.
     *
     * Use this for explicit view switches. See {@link Autodesk.Viewing.AggregatedView#setNodes|setNodes()} for params.
     * @param {Autodesk.Viewing.BubbleNode|Autodesk.Viewing.BubbleNode[]} bubbleNodes  - The nodes to be shown
     * @param {Object} [diffConfig] - see the setNodes method for the diffConfig parameter
     * @returns {Promise} - The promise resolves with the loaded models
     * @alias Autodesk.Viewing.AggregatedView#switchView
     */
    switchView(bubbleNodes, diffConfig) {
        this.reset();
        return this.setNodes(bubbleNodes, diffConfig);
    }

    /**
     * Load/Unload models so that the currently loaded models matches with the given list of svfs.
     *
     * Note: Use {@link Autodesk.Viewing.AggregatedView#switchView|switchView()} to do an explicit view switch (including resetting tools/camera).
     * Use {@link Autodesk.Viewing.AggregatedView#setModels|setModels()} to reconfiguring which models are visible in the current view.
     * @param {Autodesk.Viewing.BubbleNode|Autodesk.Viewing.BubbleNode[]} bubbleNodes  - The nodes to be shown
     * @param {Object} [diffConfig] - Options to activate diff views.
     * @param {Autodesk.Viewing.BubbleNode[]} [diffConfig.primaryBubbles]      - A subset of 'bubbleNodes' that participates in the diff. If 'bubbleNodes' contains more, these will be ghosted. These nodes represent the current/as-is state
     * @param {Autodesk.Viewing.BubbleNode[]} [diffConfig.diffBubbles] - Length must match primaryBubbles. For each node primaryBubbles[i], diffBubbles[i] provides the corresponding "before" state to compare against
     * @param {Autodesk.Viewing.BubbleNode} [diffConfig.supportBubbles.diff] - If svfs are sheet nodes, diff.supportModels must provide the bubbleNodes for the corresponding 3D support models. { diff, primary }
     * @param {Autodesk.Viewing.BubbleNode} [diffConfig.supportBubbles.primary] - Primary bubble node to do the diff comparison on
     * @param {boolean} [diffConfig.supportBubbles.autoDetect] - If true, support models are automatically found - works for Revit models with master views
     * @returns {Promise} - The promise resolves with the loaded models
     * @alias Autodesk.Viewing.AggregatedView#setNodes
     */
    setNodes(bubbleNodes, diffConfig) {

        // Don't be pedantic if just called with a single node or null
        bubbleNodes = bubbleNodes || [];
        bubbleNodes = bubbleNodes instanceof av.BubbleNode ? [bubbleNodes] : bubbleNodes;

        // Do batch-request for all alignment transforms that we may need
        this.fetchAlignmentsForNodes(bubbleNodes);

        // Collect nodes that are to be changed to visible
        const modelMustBeShown = node => !this.isVisible(node);
        const modelsToShow     = bubbleNodes.filter(modelMustBeShown); // {LMVModelLink[]}

        // Create temp object to check which nodes finally to be shown
        let newModelKeys = {}; // {string[]}
        bubbleNodes.forEach(node => { newModelKeys[node.getModelKey()] = true; });

        // Collect nodes to be unloaded
        const modelMustBeHidden = ( node => (newModelKeys[node.getModelKey()] === undefined) );
        const modelsToHide = this.getVisibleNodes().filter(modelMustBeHidden); // {av.BubbleNode[]}

        // Unload first. This will also reset the global offset if the set of model changed completely
        modelsToHide.forEach(svf => { this.hide(svf); });

        // Load all new models
        const loadingPromises = modelsToShow.map(node => this.show(node));

        // Enable and configure diff, or disable if diffConfig is null.
        this._setDiff(diffConfig);

        return Promise.all(loadingPromises);
    }

    /**
     * TODO: Make this a public method once the levels extension is documented.
     * Get the floor selector from the loaded levels extension.
     * May be null if extension is not loaded yet.
     *
     * @returns {Object} - The current FloorSelector instance from the levels extension. Note, the levels extension is not yet documented.
     * @alias Autodesk.Viewing.AggregatedView#getFloorSelector
     * @private
     */
    getFloorSelector() {
        return this.levelsExtension && this.levelsExtension.floorSelector;
    }

    /**
     * TODO: Make this a public method once the bookmarks extension is documented.
     * Define the set of BubbleNodes for which we create InCanvas-Bookmarks.
     * @param {Autodesk.Viewing.BubbleNode[]} bookmarks - Updates the bookmarks from the bookmark extension with the specified bubbleNodes
     * @alias Autodesk.Viewing.AggregatedView#setBookmarks
     * @private
     */
    setBookmarks(bookmarks) {
        this.bookmarks = bookmarks;
        this._updateBookmarks();
    }

    /**
     * Returns true if all pending loading is finished. More concrete, it means that there is no...
     *  - model-root loading
     *  - geometry loading, or
     *  - propDbLoading
     * pending or in progress.
     *
     * Reference {@link Autodesk.Viewing.AggregatedView#waitForLoadDone|waitForLoadDone}.
     * @returns {Boolean} - Returns true if all of the models in the view are fully loaded, false otherwise.
     * @alias Autodesk.Viewing.AggregatedView#isLoadDone
     */
    isLoadDone() {
        for (let key in this.modelItems) {
            const item = this.modelItems[key];
            const model = item && item.model;
            const modelRootPending = !model && !item.error;
            const geomPending      =  model && !model.isLoadDone();
            const propDbPending    =  model &&  model.getPropertyDb() && !model.getPropertyDb().isLoadDone();
            const texLoading       =  (avp.TextureLoader.requestsInProgress() > 0);

            if (modelRootPending || geomPending || propDbPending || texLoading) {
                return false;
            }
        }
        return true;
    }


    /**
     * Returns a promise that resolves when {@link Autodesk.Viewing.AggregatedView#isLoadDone|isLoadDone()} returns true.
     * @returns {Promise} - resolves when all isLoadDone returns true.
     * @alias Autodesk.Viewing.AggregatedView#waitForLoadDone
     */
    waitForLoadDone() {
        return new Promise((resolve) => {

            if (this.isLoadDone()) {
                resolve();
            }

            // On each load-relevant event, check if loading is finished.
            const onEvent = () => {

                if (!this.isLoadDone()) {
                    return;
                }

                this.viewer.removeEventListener(av.GEOMETRY_LOADED_EVENT, onEvent);
                this.viewer.removeEventListener(av.OBJECT_TREE_CREATED_EVENT, onEvent);
                this.viewer.removeEventListener(av.TEXTURES_LOADED_EVENT, onEvent);
                this.onUnload.splice(this.onUnload.indexOf(onEvent), 1);

                resolve();
            };

            // register event listeners to try again if something changes
            this.viewer.addEventListener(av.GEOMETRY_LOADED_EVENT, onEvent);
            this.viewer.addEventListener(av.OBJECT_TREE_CREATED_EVENT, onEvent);
            this.viewer.addEventListener(av.TEXTURES_LOADED_EVENT, onEvent);
            this.onUnload.push(onEvent);
        });
    }

    /**
     * TODO: Make this a public method once the alignmentService extension is documented.
     * Register a service to load custom alignment transforms. Must be specified before model loading starts.
     * @param {AlignmentService} alignmentService - Must implement alignmentService.loadTransform() function
     * @alias Autodesk.Viewing.AggregatedView#setAlignmentService
     * @private
     */
    setAlignmentService(alignmentService) {
        this.alignmentService = alignmentService;

        // If ModelAlignment extension is used (for editing), connect it with the service as well
        AlignmentClientExtensions.forEach(extName => this._connectModelAlignment(extName));
    }

    /**
     * TODO: Make this a public method once the alignmentService extension is documented.
     * Make batch request to get alignment transforms for all models that we are going to display.
     * This avoids that we do not make individual requests for each model to be loaded.
     *
     * Note:
     *   If you use setNodes() or switchView() with all nodes to be shown at once, this function is called automatically
     *   You only need to call fetchAlignmets() yourself if you call show/load directly or if the first call to setNodes() doesn't contain
     *   all models yet (e.g. because only a subset of manifests is loaded).
     *
     * @param {string[]} versionUrns
     * @alias Autodesk.Viewing.AggregatedView#fetchAlignments
     * @private
     */
    async fetchAlignments(urns) {

        // Nothing to do if no alignmentService is used
        if (!this.isUsingAlignmentService()) {
            return;
        }

        const doFetch = async () => {

            // Wait until alignmentService is initialized
            const alignmentService = await this.getAlignmentService();

            // Trigger a batch request for all urns we need. When loading an urn,
            // the loadTransform() call will then just wait for the batch result instead of triggering an own request.
            // Note that already AlignmentCache takes care that we don't request the same urns twice.
            await alignmentService.fetchItems(urns);
        };

        // Keep promise, so that we can wait for it before we load anything.
        const promise = doFetch();
        this.pendingAlignmentFetches.push(promise);

        // Resolve afer fetch is done
        return await promise;
    }

    /**
     * TODO: Make this a public method once the alignmentService extension is documented.
     * Shortcut to fetch alignments for BubbleNodes
     * @alias Autodesk.Viewing.AggregatedView#fetchAlignmentsForNodes
     * @private
     */
    fetchAlignmentsForNodes(nodes) {

        // Prefetching is only used for 3D aggregated views.
        const nodes3D = nodes?.filter(node => node.is3D());

        const urns = nodes3D?.map(node => node.getRootNode().urn());
        this.fetchAlignments(urns);
    }

    /**
     * "Support models" are 3D models that augment 2D diffs for better results: Instead of comparing the 2D objects directly,
     * the correspodning 3D counterparts are compared. This is more reliable and avoids false positives due to irrelevant plotting differences.
     * We use master views as support models, because they contain all objects of a given phase.
     *
     * Given a bubble node referring to a 2D sheet node, this function returns
     * the bubbleNode of the corresponding 3D master view that belongs to the same phase.
     * This can be used as "support model" to obtain better results for 2D diff.
     *
     * @param {Autodesk.Viewing.BubbleNode} sheetNode - A 2d bubble node
     * @returns {Autodesk.Viewing.BubbleNode} - the coresponding 3d bubble node
     *
     * @alias Autodesk.Viewing.AggregatedView#findDiffSupportModel
     *
     */
    static findDiffSupportModel(sheetNode) {
        // Support model is needed only for 2D sheet nodes.
        if (!sheetNode.is2D()) {
            return null;
        }

        // get phase name (or first one if there are actually multiple ones)
        const phases = sheetNode.data.phaseNames;
        const phase  = Array.isArray(phases) ? phases[0] : phases;

        if (!phase) {
            console.warn(`A sheet node must have a phase name. Missing for sheet: ${sheetNode.name}`);
            return null;
        }

        return sheetNode.getMasterView(phase);
    }

    /**
     * Find corresponding 3D model for each diff/primary
     * The result will be stored in the passed in diffConfig. The results will be in diffConfig.supportBubbles.diff and diffConfig.supportBubbles.primary.
     *
     * For the diffConfig parameter reference {@link Autodesk.Viewing.AggregatedView#setNodes|setNodes}.
     * @param {Object} diffConfig - see the setNodes method for the diffConfig parameter
     * @alias Autodesk.Viewing.AggregatedView#findDiffSupportModels
     */
    static findDiffSupportModels(diffConfig) {
        // Note that 2D diff is never aggregated.
        diffConfig.supportBubbles.diff = AggregatedView.findDiffSupportModel(diffConfig.diffBubbles[0]);
        diffConfig.supportBubbles.primary = AggregatedView.findDiffSupportModel(diffConfig.primaryBubbles[0]);
    }

    // Reset view-cube home-camera based on currently visible models.
    updateHomeCamera() {
        updateHomeCamera(this.viewer, this.options.cameraValidator);
    }

    // ---------------------------
    // Internal member functions:
    // ---------------------------

    _setDiff(diff) {
        if (diff) {
            Object.assign(this.diff, diff, {enabled: true});

            // If support models are needed, make sure that they are loaded (if necessary)
            const support = diff.supportBubbles;
            if (support) {
                // Detect support bubbles if wanted
                support.autoDetect && AggregatedView.findDiffSupportModels(diff);

                // Only use support models if we succeeded to find them for diff and primary
                if (support.diff && support.primary) {
                    // Load support models
                    this.load(support.primary);
                    this.load(support.diff);
                } else {
                    // We couldn't find support models

                    // Check if it's a 2D Diff (otherwise we don't need supportBubbles)
                    const node = diff.diffBubbles && diff.diffBubbles[0];
                    const is2D = node && node.is2D();

                    // If we have to run 2D diff without support models, we better warn,
                    // because the diff results may not be ideal.
                    is2D && console.warn('Could not find support models for 2D diff.');
                    this.diff.supportBubbles = null;
                }
            }

            // start progress bar right now - so that it is also visible if
            // we have to load some models first.
            if (!diff.empty && diff.progressCallback) {
                this._signalDiffLoadProgress(0, true);
            }

            this.diffStartTime = performance.now();
        }
        else {
            Object.assign(this.diff, defaultDiffOptions);
        }
        this.diffNeedsUpdate = true;
        this._updateDiff();
    }

    // Set the correct world up vector when switching from 3D to 2D
    _updateUpVector() {
        let worldUpVector;
        if (this.areAllNodes2D()) {
            worldUpVector = new THREE.Vector3(0, 1, 0);
        } else {
            // Get vector from the first 3D model
            const filter3D = item => item.visible && item.node && item.node.is3D();
            const item = Object.values(this.modelItems).filter(filter3D)[0];
            if (item && item.model) {
                worldUpVector = getUpVector(item.model);
            } else {
                worldUpVector = new THREE.Vector3(0, 0, 1); // A default up vector for 3D
            }
        }
        this.viewer.navigation.setWorldUpVector(worldUpVector, false, true);
    }

    // add model to LMV scene (must be in memory)
    _showModel(model) {

        // In rare cases, the model geometry might be empty. For this case, we don't add the model to LMV.
        // This avoids the pedantic "Model is empty" warning and possibly other detail issues due to an empty model bbox.
        // Note that we don't want this warning, because it is not a big problem if one out of many models is empty.
        // E.g., this may happen if a model has no geometry for the selected phase.
        if (model.is3d() && !model.hasGeometry()) {
            const modelName = model.getDocumentNode().getRootNode().children[0].name();
            console.warn('Ignored model with empty geometry: ', modelName);
            return;
        }

        // Skip any automatic tool reset from LMV. We trigger these explicitly,
        // but only if an explicit view switch (=> LMVViewer.reset()) has occurred.
        // Reason: We only want tool resets on explicit view switches. The scene may
        //         also be just temporarily empty when toggling visibility of models.
        //         In this case, we don't want any automagic resets.
        const preserveTools = true;
        this.viewer.showModel(model.id, preserveTools);

        // Consider new visible model for home camera
        updateHomeCamera(this.viewer, this.options.cameraValidator);
        this._updateUpVector();
    }

    // Reset UI when switching from 2D or 3D (or when loading for the first time)
    _resetOnModeSwitch(model) {
        // Unload ZoomWindow and reload after recreating UI
        if (this.viewer.getExtension(ExtNames.ZoomWindow)) {
            this.viewer.unloadExtension(ExtNames.ZoomWindow);
        }

        if (!this.options.headlessViewer) {
            this.viewer.createUI(model, true);
        }

        // Temporarily remove lock to make sure the navigation tool is changed
        const prevLock = this.viewer.setNavigationLock(false);
        this.viewer.activateDefaultNavigationTools(!this.is3D);
        this.viewer.setNavigationLock(prevLock);

        this.viewer.navigation.setIs2D(!this.is3D);

        // Integrate the zoom window functionality. This also automatically
        // moves the Zoom tool into this submenu.
        this._loadExtension(ExtNames.ZoomWindow).catch(err => this._onError(err));

        // If startBimWalk() was called for this view, activate it
        this._startBimWalkWhenReady();
    }

    _onModelAdded(event) {

        const model = event.model;

        // if camera is not initialized yet, use default camera from the first added model.
        // TODO: Think about some cleaner choice of the start camera that doesn't depend on
        //       what is loaded first. But it's not fully clear how to define it, because
        //       the list of displayed models may change arbitrarily and we don't know bboxes in advance...
        if (!this.cameraInitialized) {
            this._initCamera(model);
        }

        if (model.getData().underlayRaster) {
            return;
        }

        // make sure that the model is rendered using the current viewer's globalOffset
        if (model.is3d() && this.options.useDynamicGlobalOffset) {
            model.setGlobalOffset(this.viewer.impl.camera.globalOffset);
            this.viewer.impl.onModelTransformChanged(model);
        }

        const node = event.model.getDocumentNode();

        if (this._needsReset(node)) {
            this.resetTriggeringBubble = null;
            this.resetOnNextModelAdd = false;
            this._resetOnModeSwitch(model);
        }

        // log console warning if model is empty
        warnIfModelEmpty(model);

        // Image files don't have a document node. In that case, skip ghosting part, which is not relevant to images anyway.
        if (node) {
            // Make sure that ghosting is applied if needed. Removing a model resets visibility,
            // so we assume isModelGhosted as false.

            const modelKey = node.getModelKey();
            delete this.modelIsGhosted[modelKey];
            this._updateGhosting();
        }
    }

    // Called whenever the geometry of a model has finished loading.
    _onGeometryLoaded(event) {
        this._consolidateVisibleModels();
        this._updateDiff();
        this.loadersInProgress[event.model.id] = 100;
    }

    _onExtensionLoaded(event) {
        const extName = event.extensionId;

        // If startBimWalk has been called before BimWalk was loaded, start it when ready
        this._startBimWalkWhenReady();

        if (extName === ExtNames.Levels) {
            this.levelsExtension = this.viewer.getExtension(ExtNames.Levels);
        }

        // Make sure that BookmarksExtension gets current bookmarks when loaded
        if (extName === ExtNames.Bookmarks) {
            this._updateBookmarks();
        }

        // Make sure that ModelAlignment extension is connected to the same alignment service
        if (AlignmentClientExtensions.includes(extName) && this.alignmentService) {
            this._connectModelAlignment(extName);
        }
    }

    _registerLmvEventListeners() {
        // As soon as all geometry is loaded, make sure that consolidation is triggered if the transition is already finished.
        // Note that this also includes to cleanup memory if necessary.
        this.viewer.addEventListener(av.GEOMETRY_LOADED_EVENT, this._onGeometryLoaded.bind(this));

        // Update UI if a new model is added
        this.viewer.addEventListener(av.MODEL_ADDED_EVENT, this._onModelAdded.bind(this));

        this.viewer.addEventListener(av.EXTENSION_LOADED_EVENT, this._onExtensionLoaded.bind(this));

        // Compute overall loading progress
        this.viewer.addEventListener(av.PROGRESS_UPDATE_EVENT, this._onProgressUpdate.bind(this));

        // If diff is enabled, make sure that it starts as soon as all required models are loaded
        // For this, we don't need all geometry, but other data (fragments loaded + propDbLoader created).
        // NOTE: We cannot do this in the onModelLoaded() callback, because only the MODEL_ROOT_LOADED_EVENT
        //       is called AFTER loading the whole fragment list and creating the propDbLoader.
        this.viewer.addEventListener(av.MODEL_ROOT_LOADED_EVENT, this._updateDiff.bind(this));
    }

    // Makes sure that all visible models and fully loaded models are consolidated if memory allows it.
    // Triggered whenever a model finished loading, added, or if new memory gets available.
    _consolidateVisibleModels() {

        // Free some memory if needed and possible
        this._cleanupModels();

        //Skip consolidation on mobile due to more limited memory on weaker devices.
        if (isMobileDevice())
            return;

        //This duplicates logic from Viewer3D.loadDocumentNode, because AggregateView does its
        //loadModel calls manually. We need this flag to be able to debug memory issues in Design Collab
        //The url parameter takes precedence over the options object
        let cparam = getParameterByName("useConsolidation");
        if (cparam === "false" || (this.options.useConsolidation === false && cparam !== "true"))
            return;

        // For each 3D model, trigger consolidation if needed and possible
        const visibleModels = this.viewer.getVisibleModels();
        for (let i=0; i<visibleModels.length; i++) {
            const model = visibleModels[i];

            // Don't consolidate anything if we are running out of memory
            if (this.memTracker.memoryExceeded()) {
                return;
            }

            // Consolidation requires model + all geometry to be loaded
            const modelLoaded = model && model.isLoadDone();
            if (!modelLoaded) {
                return;
            }

            // Skip anything 2D (sheets/leaflets)
            if (model.is2d()) {
                return;
            }

            // Consolidate it if not done already
            if (!model.isConsolidated()) {
                // consolidate model
                this.viewer.impl.consolidateModel(model);

                // Consolidation raises mem-consumption. => Run cleanup again.
                this._cleanupModels();
            }
        }
    }

    // Makes sure that long unused models are removed deleted to free memory if needed.
    //
    // It is called whenever either...
    //  a) A model goes out of use (hideModel() call)
    //  b) Memory consumption has grown (model geometry loaded or model consolidation was run)
    _cleanupModels() {

        // Make sure that LRU timestamps are up-to-date.
        this._updateModelTimestamps();

        // define customized unloadModel function
        const unloadModel = (model) => {
            const node = model.getDocumentNode();

            // Usually, the model supposed to be uploaded will not be in use.
            // But: In rare cases, the geometryLoaded event of a model might arrive earlier than the onDone() callback.
            // Reason is that the onDone() callback is delayed by a setTimeout in GuiViewer.onSuccessChanged().
            // Such a model is added to the viewer before we even know about it. Therefore, it doesn't have any timestamp yet.
            //
            // If this happens in combination with a "close to memory limit" scenario, the model is incorrectly classified as "unused"
            // by ModelMemoryTracker. TODO: Check if we can find a more elegant solution to prevent this problem.
            const item = this._getItem(node);
            if (item && item.visible) {
                return;
            }

            this.unload(node);
        };

        // let memTracker free memory if necessary
        this.memTracker.cleanup(unloadModel);
    }

    // Update LRU timestamps for all models that are currently in use.
    // We must overload/customize this function to consider the 2d support models
    _updateModelTimestamps() {
        let visibleModels = this.viewer.getVisibleModels().slice();

        // Consider diff support models if 2D diff is active
        const supp = this._getDiffSupportModels();
        if (this.diff.enabled && supp) {
            if (supp.diff)    visibleModels.push(supp.diff);
            if (supp.primary) visibleModels.push(supp.primary);
        }

        this.memTracker.updateModelTimestamps(visibleModels);
    }

    _stopActiveTools() {
        const sectionExtension = this.viewer.getExtension('Autodesk.Section');
        if (sectionExtension && sectionExtension.isActive()) {
            sectionExtension.enableSectionTool(false);
        }

        this.stopBimWalk();

        // Pass false to the getPropertyPanel() method, otherwise it would try to create the
        // property panel if not yet existing.
        const propertyPanel = !this.options.headlessViewer && this.viewer.getPropertyPanel(false);
        if (propertyPanel && propertyPanel.isVisible()) {
            propertyPanel.setVisible(false);
        }
    }

    _onModelLoaded(model) {

        // get model item
        let item = this._getItem(model);
        if (!item) {
            // This can only happen if unload() has been called after load meanwhile.
            // In this case, we don't need the model anymore.
            return;
        }

        // GlobalOffset handling
        if (model.is3d()) {

            // When using dynamic globalOffset, we don't have to care about consistent globalOffsets before model loading, but just apply the consistent offset after loading.
            if (this.options.useDynamicGlobalOffset) {
                // Dynamic globalOffset handling

                // Apply current globalOffset value of the viewer camera.
                model.setGlobalOffset(this.viewer.impl.camera.globalOffset);
            } else {
                // Static globalOffset handling

                // If this is the first viewable, we use it to initialize the global offset.
                // We don't need this if we use dynamic global offsets.
                if (this.waitForFirstModel && !this.options.ignoreGlobalOffset) {
                    this.globalOffset = new THREE.Vector3().copy(model.myData.globalOffset);
                    this._onGlobalOffsetChanged();
                }
            }
        }

        // Store model in modelItem
        item.model = model;

        // If item is still set to visible, add it
        if (item.visible) {
            this._showModel(item.model);
        }

        // Make sure that the new model gets latest timestamp for LRU caching
        this._updateModelTimestamps();

        // Update diff progress bar if a model-root of a diffModel was loaded
        this._updateDiffLoadProgress();

        // Make sure that latest theming state is applied
        this._updateModelTheming(model);

        this._onModelLoadEnded(item);
    }

    _onModelLoadFailed(bubbleNode, errorCode) {
        this._onError(`Failed to load model: ${bubbleNode.name()}. Error code: ${errorCode}`);
        const item = this._getItem(bubbleNode);
        if (item) {
            item.error = true;
            this._onModelLoadEnded(item);
        }
    }

    // Called if model-root load succeeded, failed, or was cancelled
    _onModelLoadEnded(item) {
        item.loadingPromise = null;
        const bubbleNode = item.node;

        // Allow other models to load
        if (bubbleNode.is3D() && this.waitForFirstModel) {
            // Unblock 3D model loading
            this.waitForFirstModel = false;

            // Trigger loading of any models for which loading was deferred.
            Object.keys(this.loadPendingPromises).forEach(key => {
                const node = this.modelItems[key]?.node;
                if (!node) return;

                const { resolve, reject } = this.loadPendingPromises[key];
                this.load(node).then(model => {
                    resolve(model);
                }).catch(e => {
                    reject(e);
                });
            });

            this.loadPendingPromises = {};
        }

        // Notify listener callbacks
        this.onLoad.forEach(cb => cb(bubbleNode));
    }

    /* @param {av.Model} */
    _initCamera(model, withTransition) {
        this.viewer.impl.setViewFromFile(model, !withTransition);

        // apply optional custom repair
        this.options.cameraValidator && this.options.cameraValidator(this.viewer.impl.camera, model);

        // Makes sure that the viewer home button is also properly working for 2D sheets.
        this.viewer.impl.controls.recordHomeView();

        this.cameraInitialized = true;

        // If there was a setCameraGlobal that we couldn't apply immediately, do it now
        if (this.pendingCamera) {
            this._applyPendingCameraWhenReady();
        }
    }

    // Returns item for a given bubbleNode/key/model - or undefined if unknown.
    _getItem(bubbleNode) {
        let key = makeKey(bubbleNode);
        return this.modelItems[key];
    }

    // The refPoint is a 3d position from which we know that all 3d viewables to display must be close to it.
    // We use the refPoint to determine the globalOffset that we use in LMV for loadOptions.
    // If the refPoint changes slightly, globalOffset may remain the same. But if it is by a large value,
    // the global offset needs to be updated - which requires a reload for all models.
    //
    // Purpose of all this is to determine in advance which globalOffset we have to use for loading. The globalOffset must be...
    //    1. close to the geo-coords of each displayed model
    //    2. known in advance (because it is used for loadOptions)
    //    3. identical for all models displayed at once
    //
    // @param {BubbleNode} bubbleNode - node that is about to be shown
    _updateRefPoint(bubbleNode) {

        // We don't need to do anything here if we use dynamic global offsets.
        if (this.options.useDynamicGlobalOffset) {
            return;
        }

        const isFirst3DViewable = this.isEmpty() || this.areAllNodes2D();
        if (!isFirst3DViewable || !bubbleNode.is3D() || this.options.ignoreGlobalOffset) {
            return;
        }

        // Following code assumes that getAecModelData is called after AecModelMata was downloaded.
        // Having no AECModelData in this case means that this is a model other than Revit
        // and setting globalOffset to zero will essentially reset the potentially existing correct global offset
        // If we encounter such a scenario (e.g. IFC model), we just skip updating global offset here
        const aecModelData = bubbleNode.getAecModelData();
        if (!aecModelData) {
            return;
        }

        // get file-placement from aecModelData
        let tf = aecModelData && aecModelData.refPointTransformation; // Matrix4x3 as array[12]
        let refPoint = tf ?
            { x: tf[9], y: tf[10], z: 0.0 } :    // refPoint = refPointTransform * (0,0,0)
            { x: 0, y: 0, z: 0 };                // fallback: use origin if we have no aecModelData

        // If we use model-alignment, an alignment transform
        // might override the actual placementTransform.
        if (this.isUsingAlignmentService()) {

            // Try to get alignment in memory
            const urn = bubbleNode.getRootNode().urn();
            const alignmentTf = this.alignmentService?.getTransform(urn);

            // Undefined indicates that we don't know the alignment yet.
            // In this case, we cannot say where the model is places, so we have to stop here.
            // This will fall-back to the default solution to obtain the globalOffset from the first model we load.
            if (alignmentTf === undefined) {
                return;
            }

            // If there is an alignment, it replaces the file-refPointTransform.
            // If alignmentTf is null, no alignment is assigned and we can safely proceed with the initial
            // file transform we got from AecModelData.
            if (alignmentTf) {
                // get refpoint from alignment transform
                refPoint.x = alignmentTf.elements[12];
                refPoint.y = alignmentTf.elements[13];
            }
        }

        this.refPoint = refPoint;

        // When using unit-scaling, we have to apply it to the refPoint as well
        if (this.options.viewerUnits) {

            // Scale from model units to viewer units. viewer unit is always meter.
            //
            // Note:
            // The proper way would be to determine the scale factor based on the model
            // units. However, we would need the main model in memory for this,
            // which we don't always have.
            //
            // Therefore, we must exploit some assumptions here:
            //  - AECModelData is only provided by Revit models.
            //  - 3D viewables from Revit extractor are always in feet (even if the Revit file is metric)
            const feetToViewerUnits = Autodesk.Viewing.Private.convertUnits('ft', this.options.viewerUnits, 1, 1);

            // Apply unitScaling to refPoint, because this will happen to the model as well.
            this.refPoint.x *= feetToViewerUnits;
            this.refPoint.y *= feetToViewerUnits;
            this.refPoint.z *= feetToViewerUnits;
        }

        // Workaround: We apply the global offset only in (x,y), because:
        //  a) The large offsets are usually only happening for (x,y)
        //  b) An offset in z would need special handling in the LevelsExtension

        // Check if the current globalOffset is sufficiently close to the refPoint to avoid inaccuracies.
        const MaxDistSqr = 4.0e6;
        const distSqr    = this.globalOffset && THREE.Vector3.prototype.distanceToSquared.call(this.refPoint, this.globalOffset);
        if (!this.globalOffset || distSqr > MaxDistSqr) {

            this.globalOffset = new THREE.Vector3().copy(this.refPoint);

            // unload all previous 3D models that we loaded with previous geo offset
            this.unloadAll((item) => item.model && item.model.is3d());

            this._onGlobalOffsetChanged();
        }
    }

    _onGlobalOffsetChanged() {
        // Make sure that bookmark positions are calculated based on the latest global offset
        const bookmarkExt = this.viewer.getExtension(ExtNames.Bookmarks);
        if (bookmarkExt) {
            bookmarkExt.resetGlobalOffset(this.globalOffset);
        }
    }

    // Default extensions as used by Design Collaboration
    _getDefaultExtensions() {
        return [
            {
                name: ExtNames.CrossFade,
                getLoadingCondition: () => !av.isMobileDevice()
            },
            {
                name: ExtNames.Levels,
                getOptions: () => this.viewer.config
            },
            {
                name: ExtNames.ModelStructure,
                getOptions: () => this.viewer.config
            },
            {
                name: ExtNames.Hyperlinks,
                getOptions: () => ({
                    // Connect hyperlink handler
                    loadViewableCb: (bubbleNode, numHyperlinks) => {
                        if (this.onHyperlink) {
                            this.onHyperlink(bubbleNode, numHyperlinks);
                        } else {
                            // default-handler: Trigger view switch to linked sheet
                            this.switchView([bubbleNode]);
                        }
                    }
                })
            },
            {
                name: ExtNames.Minimap,
                getLoadingCondition: () => !this.options.disableMinimap,
                getOptions: () => ({
                    // Allow clients to track minimap usage.
                    // Todo: Finally, tracking should be consistently handled automatically inside LMV.
                    trackUsage: this._trackMinimapUsage ? this._trackMinimapUsage.bind(this) : undefined
                })
            },
            {
                name: ExtNames.Bookmarks,
                getLoadingCondition: () => this.is3D,
                getOptions: () => ({
                    // Share global offset, so that bookmarks are placed correctly
                    globalOffset: this.globalOffset,

                    onBookmark: (bookmark, camera) => {
                        // Forward to handler to invoke view switch
                        if (this.onBookmark) {
                            this.onBookmark(bookmark, camera);
                        } else {
                            // default handler: Invoke view-switch to selected bookmark
                            this.switchView([bookmark]);
                        }

                        // Activate BIMWalk for perspective views. It is important to do that
                        // after invoking the handler to switch views.
                        // Otherwise, BimWalk would be switched off again.
                        if (camera.isPerspective) {
                            this.startBimWalk();
                        }
                    },

                    clusterfck: this.options.clusterfck,
                    clusteringThreshold: 110, // threshold is (icon_width * 5), depends on "THREE.Vector3.distanceTo()"
                })
            },
            {
                name: ExtNames.DropMe,
                getLoadingCondition: () => this.is3D === false,
                getOptions: () => ({
                    enableGuidance: true,
                    onDrop: this._handleDropMe.bind(this),  // connect DropMe handler
                    getTransformForNode: this._getTransformForNode.bind(this),
                    getMain3DView: this._findMain3DView.bind(this),
                    onHandleViewIn3D: this._handleViewIn3D.bind(this),
                })
            }
        ];
    }

    // The extensions array contains objects with the following spec:
    //   name {string} - The extension's name to be loaded
    //   getLoadingCondition {function|optional} - under what conditions the extension should be loaded. If they are not
    //                                             met, the extension will be unloaded on _updateExtensions.
    //                                             Receives the AggregateView instance as parameter, and the bubble node.
    //   getOptions {function|optional} - Options to pass to the extension. Receives the AggregateView instance as parameter.
    //   onLoadedCB {function|optional} - Called when the extension's load promise was resolved. Receives the AggregateView instance as parameter,
    //                                    and the extension. If the promise is rejected, it passes the error instead.
    //   onBeforeUnloadCB {function|optional} - Called when the extension is about to be unloaded. Receives the AggregateView instance as parameter.
    async _loadExtensions() {
        this.extensions = this.options.extensions || this._getDefaultExtensions();

        const loadingPromises = [];

        this.extensions.forEach(extension => {
            if (!extension.getLoadingCondition || extension.getLoadingCondition(this)) {
                loadingPromises.push(this._loadExtension(extension.name,
                    extension.getOptions && extension.getOptions(this),
                    extension.onLoadedCB));
                this.extensionLoaded[extension.name] = true;
            }
        });

        return Promise.all(loadingPromises);
    }

    // Load LMV extension with given options + optional options specified via this.options.extensionOptions
    async _loadExtension(extName, options, onLoadedCB) {
        const extOptions      = this.options.extensionOptions;
        const customOptions   = extOptions && extOptions[extName];
        const combinedOptions = Object.assign({}, options, customOptions);
        const promise = this.viewer.loadExtension(extName, combinedOptions);
        if (onLoadedCB) {
            promise.then(extension => {
                onLoadedCB(this, extension);
            }).catch(error => {
                // If extension loading failed, pass null to the callback, and the error as third parameter
                onLoadedCB(this, null, error);
            });
        }
        return promise;
    }

    // Load/Unload extensions depending on whether we are entering a 2D or 3D view
    _updateExtensions(bubbleNode) {
        const toggleExtension = (extName, options, enable, onLoadedCB, onBeforeUnloadCB) => {

            const extLoaded = this.extensionLoaded[extName];
            if (!extLoaded && enable) {
                this._loadExtension(extName, options, onLoadedCB).catch(err => this._onError(err));
            } else if (extLoaded && !enable) {
                if (onBeforeUnloadCB) {
                    onBeforeUnloadCB(this);
                }
                this.viewer.unloadExtension(extName);
            }
            this.extensionLoaded[extName] = enable;
        };

        this.extensions.forEach(extension => {
            if (extension.getLoadingCondition) {
                toggleExtension(extension.name,
                    extension.getOptions && extension.getOptions(this),
                    extension.getLoadingCondition(this, bubbleNode),
                    extension.onLoadedCB,
                    extension.onBeforeUnloadCB);
            }
        });
    }

    _initForFirstViewable(bubbleNode) {

        // Check if we are about to switch between 2D and 3D view
        const dimChanged = (this.is3D !== bubbleNode.is3D());
        if (dimChanged) {

            // Make sure that UI, camera, tools etc. are reset on next model-add.
            // This is only for convenience, so that the client doesn't have to care to call reset() from outside on 2D/3D switches.
            // If reset() was already called, we don't do it again, because this would
            // revert some settings (setCameraGlobal or startBimWalk) that the user might have done for this view already.
            if (!this.resetOnNextModelAdd) {
                this.reset();
                this.resetTriggeringBubble = bubbleNode;
            }

            this.is3D = bubbleNode.is3D();
        }

        // Make sure that the right extensions are loaded/unloaded
        this._updateExtensions(bubbleNode);

        // Before loading a 3D viewable, we must choose a refPoint for the view.
        this._updateRefPoint(bubbleNode);
    }

    _updateBookmarks() {
        let ext = this.viewer.getExtension(ExtNames.Bookmarks);
        if (!ext) {
            // Extension is only loaded in 3D mode
            return;
        }

        ext.resetBookmarks(this.bookmarks);
    }

    // Modify current camera based on the one specified in last setCameraGlobal call.
    _applyPendingCameraWhenReady() {

        // Applying the user camera requires the viewer camera to be default-initialized first.
        // This also implies that the viewer global offset is already determined.
        if (!this.cameraInitialized) {
            return;
        }

        // consume pending camera overrides
        let newCam = this.pendingCamera;
        this.pendingCamera = null;

        let cam = this.viewer.impl.camera;
        if (newCam.position) cam.position.copy(newCam.position);
        if (newCam.target)   cam.target.copy(newCam.target);
        if (newCam.up)       cam.up.copy(newCam.up);
        if (newCam.fov)      cam.fov = newCam.fov;
        if (newCam.isPerspective !== undefined) cam.isPerspective = newCam.isPerspective;

        const globalOffset = this.globalOffset || this.viewer.model.getData().globalOffset;

        // GlobalOffset only affects 3D models
        if (this.is3D && !this.options.ignoreGlobalOffset && !newCam.ignoreGlobalOffset) {
            cam.position.sub(globalOffset);
            cam.target.sub(globalOffset);
        }

        this.viewer.impl.syncCamera();
    }

    // Default handler: Purpose is to enable use of AggregatedView on its own and to test/demonstrate its usage.
    //
    // The DropMe defines the camera for the 3D view.
    // But: What 3D view is used for that may finally vary depending on application context.
    // For the default handler, we have no unique definition what 3D view we want to switch to. So, we have to use some heuristic choices.
    _findMain3DView(sheetNode) {
        const masterViews = sheetNode.getMasterViews();

        if (masterViews[0]) {
            return masterViews[0];
        }

        const root = sheetNode?.getRootNode();

        if (!root) {
            return;
        }

        const views = root?.search(av.BubbleNode.MODEL_NODE);

        // Check if there is some view with Revit default name "{3D}" or  "{3d - <username>}"
        const isDefault3DView = node => node.name().toLowerCase().startsWith('{3d');
        const default3DView = views.filter(isDefault3DView)[0];

        if (default3DView) {
            return default3DView;
        }

        // last fallback - just return first 3D view we find
        return views[0];
    }

    _handleDropMe(pos, dir, mode, bubbleNode, ignoreGlobalOffset) {
        if (this.onDrop) {
            this.onDrop(pos, dir, mode, bubbleNode);
            return;
        }

        // No 3D view that we can switch to
        if (!bubbleNode) {
            console.warn("DropMe handler: Document does not contain a 3D view to switch to");
            return;
        }
        this.switchView(bubbleNode);

        // Setup perspective camera from DropMe input
        if (pos && dir) {
            let camera = {
                position: pos,
                target: pos.clone().add(dir),
                isPerspective: true, // Note that DropMeTool usually produces "inside" views, which are not possible with ortho cameras
                ignoreGlobalOffset,
            };
            this.setCameraGlobal(camera);
        }
    }

    // Standard handler for view in 3D (available through the Drop me extension).
    // In the case this option was selected, first the dropMe callback is called without a position
    // (because it can only be found once the 3D model is loaded). Then this callback is called
    // with the found position.
    async _handleViewIn3D(position, target, applyGlobalOffset, applySelectionCB) {
        if (applyGlobalOffset && !this.options.ignoreGlobalOffset) {
            const globalOffset = this.globalOffset || this.viewer.model.getData().globalOffset;
            position = position.clone().add(globalOffset);
            target = target.clone().add(globalOffset);
        }

        let camera = {
            position,
            target,
            isPerspective: true
        };

        this.setCameraGlobal(camera);

        const bimWalk = await this.viewer.getExtensionAsync(ExtNames.BimWalk);

        bimWalk.activate();
        bimWalk.disableGravityUntilNextMove();
        applySelectionCB && applySelectionCB();

    }

    // All we want is to make sure that BIMWalk will actually start if startBimWalk was called - independent of timing.
    _startBimWalkWhenReady() {
        if (!this.bimWalkStartPending) {
            return;
        }

        let viewReady   = !this.resetOnNextModelAdd; // tools/UI are ready for this view
        let bimWalk     = this.viewer.getExtension(ExtNames.BimWalk);

        // Make sure that FusionOrbit doesn't switch BimWalk off again, because it resets NavTools on load
        let fusionOrbit = this.viewer.getExtension(ExtNames.FusionOrbit);
        if (viewReady && bimWalk && fusionOrbit) {
            bimWalk.activate();
            this.bimWalkStartPending = false;
        }
    }

    _unloadDiffTool(clearCache) {
        const ext = this.viewer.getExtension(ExtNames.DiffTool);
        if (ext) {
            if (clearCache) {
                // discard cached diffs
                this.diffCache.length = 0;
            }

            this.viewer.unloadExtension(ExtNames.DiffTool);
        }
    }

    // currently used for load progress for 2d diff (as long as we need full geometry)
    _onProgressUpdate(event) {

        if (!event.model || event.state !== av.ProgressState.LOADING) {
            return;
        }

        // debugging hint: use 'event.model.myData.basePath' as a key
        this.loadersInProgress[event.model.id] = event.percent;

        this._updateDiffLoadProgress();
    }

    _getDiffSupportModels() {
        const supp = this.diff.supportBubbles;
        if (!supp) {
            return;
        }
        return {
            diff:    this.getModel(this.diff.supportBubbles.diff),
            primary: this.getModel(this.diff.supportBubbles.primary)
        };
    }

    // For 2D diff: Checks if the required support models for current diff mode are fully available.
    // If so, they are returned, otherwise it returns null.
    _diffSupportModelsReady() {
        const supportModels = this._getDiffSupportModels();
        const diffLoaded    = supportModels.diff    && supportModels.diff.isLoadDone();
        const primaryLoaded = supportModels.primary && supportModels.primary.isLoadDone();
        return diffLoaded && primaryLoaded;
    }

    // If diff mode is active, all models that are not participating in the diff are
    // rendered in ghosted style.
    _updateGhosting() {

        // keys of all models used in diff
        let usedInDiff = {};
        if (this.diff.enabled && this.diffBubbles) {
            usedInDiff = this.diffBubbles.forEach( (b) => usedInDiff[b.getModelKey()] );
        }

        for (let key in this.modelItems) {
            // skip models if root is not loaded yet
            let model = this.getModel(key);
            if (!model) {
                continue;
            }

            let ghosted    = this.diff.enabled && !usedInDiff[key];
            let wasGhosted = !!this.modelIsGhosted[key];
            if (ghosted != wasGhosted) {
                model.setAllVisibility(!ghosted);

                // keep track which models are ghosted
                if (ghosted) {
                    this.modelIsGhosted[key] = true;
                } else {
                    delete this.modelIsGhosted[key];
                }
            }
        }
    }

    // Get array of models from given bubbleNode array.
    // NOTE: This will be removed, because the only difference to viewer.getVisibleModels() is that it may contain null-entries
    //       for models that are still loading. Note that _updateDiffLoadProgress() then needs some revision too, because it currently relies on these null-entries.
    getModels(bubbleNodes) {
        return bubbleNodes.map( (node) => this.getModel(node) );
    }

    // Configures current modelTheming.
    //  @param {Object|null} nodeToColor - maps model keys to theming colors. Use node.getModelKey() to get key of a BubbleNode.
    setModelTheming(nodeToColor) {

        // accept null/undefined to clear model theming
        nodeToColor = nodeToColor || {};

        const oldStates = this.modelThemingStates;
        this.modelThemingStates = {};

        // update theming states for all models to be colored
        for (let key in nodeToColor) {
            let state = oldStates[key];
            const newColor = nodeToColor[key];
            const model = this.getModel(key);

            // Create new state or update existing one
            if (!state) {
                state = new ModelThemingState(newColor);
            } else {
                // set new color
                const changed = !state.color.equals(newColor);
                if (changed) {
                    // apply new color
                    state.color.copy(newColor);

                    // If the old color was active, make sure we apply the new one
                    // when we update below.
                    state.active = false;
                }
            }

            // Store new state
            this.modelThemingStates[key] = state;

            // make sure colors are applied as specified
            model && this._updateModelTheming(model);
        }

        // Make sure that we don't leak any outdated theming colors
        for (let key in oldStates) {
            const state = oldStates[key];
            const removed = !nodeToColor[key];
            const model = this.getModel(key);
            if (removed && state.active) {
                model && this.viewer.clearThemingColors(model);
            }
        }
    }

    _signalDiffLoadProgress(percent, force) {
        if (force || percent !== this._lastDiffLoadPercent) {
            // update progress bar
            const msg = av.i18n.t('Loading Model for Change Visualization');
            this.diff.progressCallback(percent, msg);

            this._lastDiffLoadPercent = percent;
        }
    }

    _updateDiffLoadProgress() {
        // Do nothing if we are not waiting for a diff
        if (!this.diffNeedsUpdate || !this.diff.enabled || this.diff.empty || !this.diff.progressCallback) {
            return;
        }

        // get array of all models
        const diffModels = this.getModels(this.diff.diffBubbles);
        const primModels = this.getModels(this.diff.primaryBubbles);
        const allModels = diffModels.concat(primModels);

        // for 2d, also consider support models
        const supportModels = this._getDiffSupportModels();
        if (supportModels) {
            allModels.push(
                supportModels.diff,
                supportModels.primary
            );
        }

        // check how many models roots need to be loaded
        const loadedModels = allModels.filter(Boolean).length;

        // Reserve the first 10% progress bar for loading model roots
        const ModelRootPercent = 10;

        // As long as not all roots are loaded, just track model-root loading
        if (loadedModels < allModels.length) {
            const percent = Math.floor(ModelRootPercent * loadedModels / allModels.length);
            this._signalDiffLoadProgress(percent);
            return;
        }

        // For 2D diff, we track the model-load progress including geometry
        // This can be changed as soon as we eliminate geom loading from 2d too.
        if (!this.is3D) {
            // sum up progress percent of all models we need
            const countPercentDone = (acc, model) => acc + (this.loadersInProgress[model.id] | 0);
            const geomPercentDone  = allModels.reduce(countPercentDone, 0);
            const geomPercentTotal = allModels.length * 100;

            // map average loader percent to the upper 90%, because we had reserved some percentage
            // for the model root loading already.
            const percent = ModelRootPercent + Math.floor((100 - ModelRootPercent) * geomPercentDone / geomPercentTotal);
            this._signalDiffLoadProgress(percent);

            return;
        }

        // Track fragment list loading
        const countLoadedFrags = (acc, model) => (acc + model.getData().fragsLoadedNoGeom);
        const countFragsTotal  = (acc, model) => (acc + model.getData().metadata.stats.num_fragments);
        const fragsLoaded = allModels.reduce(countLoadedFrags, 0);
        const fragsTotal  = allModels.reduce(countFragsTotal, 0);

        const percent = ModelRootPercent + Math.floor((100 - ModelRootPercent) * fragsLoaded / fragsTotal);
        this._signalDiffLoadProgress(percent);
    }

    _updateDiff() {

        if (!this.diffNeedsUpdate) {
            return;
        }

        this._updateGhosting();

        this._updateDiffLoadProgress();

        if (!this.diff.enabled) {
            // Unload extension if needed on DiffMode disabling
            this._unloadDiffTool();
            this._updateAllModelTheming(); // reactive modelTheming
            return;
        }

        // collect all models participating in the diff
        const diffModels = this.getModels(this.diff.diffBubbles);
        const primModels = this.getModels(this.diff.primaryBubbles);

        if (this.diff.customCompute) {
            let prim = primModels;
            let diff = diffModels;
            const customComputes = [this.diff.customCompute].flat();
            for (const customCompute of customComputes) {
                [prim, diff] = customCompute.init(prim, diff);
            }
        }

        for (let i=0; i<diffModels.length; i++) {
            const diffModel = diffModels[i];
            const primModel = primModels[i];

            // If loading is in progress, modelA or modelB might just be a boolean value
            const diffModelLoaded = (diffModel instanceof av.Model) && (diffModel.isOTG() || diffModel.isLoadDone());
            const primModelLoaded = (primModel instanceof av.Model) && (primModel.isOTG() || primModel.isLoadDone());
            if (!diffModelLoaded || !primModelLoaded) {
                // We cannot start diff until all models are loaded (for 2D, we also need geometry)
                return;
            }

            // Make sure that the property db is loaded. Otherwise, we will retry on next
            // MODEL_ROOT_LOADED event.
            if (!diffModel.getPropertyDb() || !primModel.getPropertyDb()) {
                return;
            }
        }

        // If we need support models (for 2D diff), make sure that these are reday too
        let supportModels = undefined;
        const supportModelsNeeded = !!this.diff.supportBubbles;
        if (supportModelsNeeded) {

            if (!this._diffSupportModelsReady()) {
                // We cannot start diff before support models (incl. geometry)
                // are fully available. So stop here and wait until called again by
                // next geometry-loaded event.
                return;
            }
            supportModels = this._getDiffSupportModels();
        }

        const elapsed = performance.now() - this.diffStartTime;
        console.log('Time for loading diff models: ', elapsed);

        // Make sure that all model-theming is reverted before activating DiffToolExtension
        this._updateAllModelTheming();

        this._setDiffModels(diffModels, primModels, supportModels);
    }

    _setDiffModels(diffModels, primaryModels, supportModels) {

        // don't reset diff again until next setModels() call
        this.diffNeedsUpdate = false;

        // If we are in DiffMode, but no model version changed, we just show
        // all in ghosted and are done.
        if (!primaryModels.length) {
            this._unloadDiffTool();
            return;
        }

        const ext = this.viewer.getExtension(ExtNames.DiffTool);
        if (ext) {
            ext.replaceModels(diffModels, primaryModels, supportModels);
        } else {

            const cfg = {
                diffModels: diffModels,
                primaryModels: primaryModels,
                supportModels: supportModels, // = { primary: av.Model, diff: av.Model }
                diffadp: false,
                availableDiffModes: [ 'overlay', 'sidebyside' ],
                diffMode: 'overlay',

                customCompute: this.diff.customCompute,

                versionA: this.diff.primaryBubbleLabel,
                versionB: this.diff.diffBubbleLabel,
                refNames: this.diff.refNames,
                mimeType: 'application/vnd.autodesk.revit', // change to "C4R or Revit"
                hotReload: true,
                diffCache: this.diffCache,

                // To run with OTG, we need to use the new code path for side-by-side that uses a single viewer instance.
                useSplitScreenExtension: true,

                // Add a section with details, such as which versions are compared.
                // If activated, the overlay displaying the version labels is not
                // rendered as that information is already contained in the panel.
                // This option is disabled by default for backwards compatibility.
                showDetailsSection: true,

                progress: (percent, state) => {

                    // Diff progress might be null if diffConfig has changed already. This may happen when clicking ('Exit Changes')
                    // while waiting for the diff.
                    if (!this.diff.progressCallback) {
                        return;
                    }

                    if (state ===  Autodesk.DiffTool.DIFFTOOL_PROGRESS_STATES.LoadingPropDb) {
                        this.diff.progressCallback(percent, av.i18n.t('Loading element properties'));
                        return;
                    }

                    if (percent === 100 && this.onDiffDone) {
                        this.onDiffDone();
                    }
                    this.diff.progressCallback(percent, av.i18n.t('Computing change visualization'));
                },
                // Exclude objects based on selected level
                excludeFromDiff: (model, dbId) => {
                    return this.levelsExtension && !this.levelsExtension.floorSelector.isVisible(model, dbId);
                },
                // Whenever the DiffTools sets dbIds to visible for a model,
                // we rerun the current FloorSelectionFilter to make sure that
                // an object is only shown if both - FloorSelectionFilter and
                // DiffTool allow it.
                setNodesOff: (model) => {
                    const levelExt = this.levelsExtension;
                    if (levelExt) {
                        levelExt.floorSelector._floorSelectorFilter.reApplyFilter(model);
                    }
                },
                hideModeSwitchButton: true,
                externalUi: this.diff.externalUi,
                attachDetachViewerEventHandlers: this.diff.attachDetachViewerEventHandlers,
                onDiffModeChanged: this.diff.onDiffModeChanged,
                onInitialized: this.diff.onInitialized,
            };

            this._loadExtension(ExtNames.DiffTool, cfg).catch(err => this._onError(err));
        }
    }

    // Make sure that modelTheming colors are applied/cleared according to current modelTheming state
    _updateModelTheming(model) {
        const key = makeKey(model);
        const state = this.modelThemingStates[key];

        // If there is no state, the model was not affected by modelTheming and leave theming as it is
        if (!state) {
            return;
        }

        // Suppress all diff as long as diff is active
        const diffExt = this.viewer.getExtension(ExtNames.DiffTool);
        const enableTheming = !diffExt;
        state.setEnabled(model, enableTheming);

        // make sure that theming is applied if enabled
        state.update(model);

        this.viewer.impl.invalidate(true);
    }

    _updateAllModelTheming() {
        for (let key in this.modelItems) {
            let model = this.getModel(key);
            model && this._updateModelTheming(model);
        }
    }

    async getAlignmentService() {
        // If service initialized, return it
        if (this.alignmentService) {
            return this.alignmentService;
        }

        // If there was a previous call to this function that has a pending init,
        // return the current promise to avoid repeated init calls
        if (this._alignmentServicePromise) {
            await this._alignmentServicePromise;
        } else {
            // Init alignment service at first use
            this._alignmentServicePromise = this._initAlignmentService();
            await this._alignmentServicePromise;
            this._alignmentServicePromise = null;
        }

        return this.alignmentService;
    }

    // Check if we have to care for alignment services.
    isUsingAlignmentService() {
        // Note that alignmentService may also be specified in the options,
        // but the createAlignmentService() call might not be finished yet.
        return this.options.createModelAlignmentService || this.alignmentService;
    }

    async _initAlignmentService() {
        // Stop here if service is not needed
        const createService = this.options.createModelAlignmentService;
        if (!createService) {
            return;
        }

        // Set alignmentService when ready.
        const initService = async () => {
            const service = await createService();
            this.setAlignmentService(service);
        };

        // Load AlignmentService extension
        await this.viewer.loadExtension('Autodesk.ModelAlignmentService').then(initService);
    }

    // Use alignment service to load a transform matrix for a given node.
    async _getTransformForNode(bubbleNode) {
        const alignmentService = await this.getAlignmentService();

        if (!alignmentService) {
            return;
        }

        // Make sure that all initial batch-requests are done before we start loading transforms
        await Promise.all(this.pendingAlignmentFetches);

        // get base64-encoded versionUrn
        const versionUrn = bubbleNode.getRootNode().urn();
        const viewableName = bubbleNode.is2D() ? bubbleNode.name() : undefined;

        // get override transform (may be null)
        const matrix = await alignmentService.loadTransform(versionUrn, viewableName);

        return matrix;
    }

    // If an alignment service is set and specifies a transform for this model,
    // the loadOptions are modified to replace refPointTransform by the alignment matrix specified by the service.
    //  @param {BubbleNode}  bubbleNode  - documentNode to be loaded
    //  @param {loadOptions} loadOptions - modified in-place if an override alignment transform is specified
    async _applyAlignmentService(bubbleNode, loadOptions) {

        // For regular sheet loading, we don't apply alignment transforms. For 2D viewables, alignment transforms
        // are only relevant for hypermodel views - which handle the 2D/3D transforms separately.
        if (bubbleNode.is2D()) {
            return;
        }

        // Don't try to get alignment service if we are already in degraded mode.
        if (this.alignmentServiceFailed) {
            // If we get here, the alignment service failed in a previous load, i.e. >=1 model was already loaded
            // without alignment transform. So, we are in degraded mode anyway and had to disable alignment,
            // so that it wouldn't help to try getting the transform for other models.
            return;
        }

        const matrix = await this._getTransformForNode(bubbleNode);

        // Check if alignment service is consistenly working. If not, continue without alignment transforms.
        // Note that we don't strictly change if the error actually happened while trying this specific transform
        // or at an earlier time. However, having a half-working alignment service doesn't help anyone, so either
        // we can rely on it 100% or we fall-back to loading without alignment transforms.
        if (!this._checkAlignmentService()) {
            return;
        }

        // Track if models are loaded with or without transforms
        track('viewer.modelalignment.alignment_loaded', { hasAlignmentTransform: Boolean(matrix) });

        // If there is an override transform...
        if (matrix) {
            // use this transform instead of the source-file's refPointTransform
            loadOptions.applyRefPoint = false;
            loadOptions.placementTransform = matrix;

            // Important if the client uses unit scaling (otherwise it has no effect):
            //
            // If unitScaling is used, LMV treats refPointTransforms and loadOptions.placemenTransform differently by default:
            //  - For refPointTransforms, the application order is:             1. refPointTransform, 2. unitScaling
            //  - For loadOptions.placementTransform, the application order is: 1. scaling,           2. placementTransform
            //
            // In our case, the alignmentTransform is supposed to replace the refPointTransform. So, it needs to be applied _before_ the scaling,
            // so that it would be handled in the same way as the refPointTransform would be. This is achieved by this flag,
            // which flips the application order of placementTransform and unit scaling.
            loadOptions.applyPlacementInModelUnits = true;
        }
    }

    // Check if the alignment service is working. If there are any errors, we continue without alignment. In this case,
    // we need to notify the user and disable any alignment editing.
    _checkAlignmentService() {

        // Already failed or unused
        if (this.alignmentServiceFailed || !this.alignmentService) {
            return false;
        }

        if (this.alignmentService.isWorking()) {
            return true;
        }

        // Fire event, so that the application can respond by showing a notification and disabling alignment editing UI.
        const message = i18n.t('Failed to connect to alignment service: Model alignment support is temporarily unavaible. Models with alignment transforms may not appear correctly and alignment editing is disabled.');
        this.fireEvent({ type: Events.ALIGNMENT_SERVICE_FAILED, message });

        // Report warning on console
        avp.logger.error('AggregatedView: Disabled alignment due to alignment service connection error.');

        // Stop using alignment service from now on.
        this.alignmentServiceFailed = true;
    }

    // Connect an extension with alignmentService (or disconnect if service is set to null)
    _connectModelAlignment(extName) {
        const ext = this.viewer.getExtension(extName);
        if (ext) {
            ext.setAlignmentService(this.alignmentService);
        }
    }
}

AggregatedView.ExtNames = ExtNames;
AggregatedView.AlignmentServices = AlignmentServices;
AggregatedView.Events = Events;
