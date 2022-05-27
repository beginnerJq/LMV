

    "use strict";

    var av = module.exports;

    /**
     * Fired when the ESC key is pressed.
     * @event Autodesk.Viewing#ESCAPE_EVENT
     */
    av.ESCAPE_EVENT                   = 'escape';
    /**
     * Fired repeatedly throughout the process of opening a model/drawing.
     * @event Autodesk.Viewing#PROGRESS_UPDATE_EVENT
     * @property {number} percent - Estimated progress.
     * @property {number} state - Value from Autodesk.Viewing.ProgressState, providing details on the progress state.
     * @property {object} model - Model being loaded.
     */
    av.PROGRESS_UPDATE_EVENT          = 'progress';
    /**
     * Fired when the screen mode changes.
     * @event Autodesk.Viewing#FULLSCREEN_MODE_EVENT
     * @property {Autodesk.Viewing.ScreenMode} mode - New screen mode.
     */
    av.FULLSCREEN_MODE_EVENT          = 'fullScreenMode';
    /**
     * Fired then the navigation tool changes.
     * @event Autodesk.Viewing#NAVIGATION_MODE_CHANGED_EVENT
     * @property {string} id - Tool identifier.
     */
    av.NAVIGATION_MODE_CHANGED_EVENT  = 'navmode';
    /**
     * Fired when the viewer state is restored.
     * @event Autodesk.Viewing#VIEWER_STATE_RESTORED_EVENT
     * @property {boolean} value - Success of the state restoration.
     */
    av.VIEWER_STATE_RESTORED_EVENT    = 'viewerStateRestored';
    /**
     * Fired when the viewer size changes.
     * @event Autodesk.Viewing#VIEWER_RESIZE_EVENT
     * @property {number} width - New width of the viewer.
     * @property {number} height - New height of the viewer.
     */
    av.VIEWER_RESIZE_EVENT            = 'viewerResize';
    /**
     * Fired when the viewer is fully initialized.
     * @event Autodesk.Viewing#VIEWER_INITIALIZED
     */
    av.VIEWER_INITIALIZED             = 'viewerInitialized';
    /**
     * Fired when the viewer is fully uninitialized.
     * @event Autodesk.Viewing#VIEWER_UNINITIALIZED
     */
    av.VIEWER_UNINITIALIZED           = 'viewerUninitialized';

    /**
     * Fired when the viewer begins loading a model, before the
     * Model instance gets created.
     *
     * @event Autodesk.Viewing#LOADER_LOAD_FILE_EVENT
     * @property {object} loader - Instance of the Loader class
     */
    av.LOADER_LOAD_FILE_EVENT = 'loaderLoadFile';

    /**
     * Fired when an error is detected during a load.
     *
     * @event Autodesk.Viewing#LOADER_LOAD_ERROR_EVENT
     * @property {object} loader - Instance of the Loader class
     * @property {object} error - The error reported by the loader.
     */
    av.LOADER_LOAD_ERROR_EVENT = 'loaderLoadError';

    /**
     * Fired when the viewer receives and parses the initial model manifest.
     * @event Autodesk.Viewing#MODEL_ROOT_LOADED_EVENT
     * @property {object} svf - Parsed SVF/F2D JSON.
     * @property {object} model - Model data.
     */
    av.MODEL_ROOT_LOADED_EVENT        = 'svfLoaded';

    /**
     * Fired when the model/drawing finishes loading.
     * @event Autodesk.Viewing#GEOMETRY_LOADED_EVENT
     * @property {object} model - Model data.
     */
    av.GEOMETRY_LOADED_EVENT          = 'geometryLoaded';

     /**
     * Fired when the model/drawing textures finish loading.
     * @event Autodesk.Viewing#TEXTURES_LOADED_EVENT
     * @property {object} model - Model data.
     */
    av.TEXTURES_LOADED_EVENT          = 'texturesLoaded';
    /**
     * Fired when the instance tree is successfully created.
     * @event Autodesk.Viewing#OBJECT_TREE_CREATED_EVENT
     * @property {object} svf - Parsed SVF/F2D JSON.
     * @property {object} model - Model data.
     */
    av.OBJECT_TREE_CREATED_EVENT      = 'propertyDbLoaded';
    /**
     * Fired when there's an error while parsing the instance tree.
     * @event Autodesk.Viewing#OBJECT_TREE_UNAVAILABLE_EVENT
     * @property {object} svf - Parsed SVF/F2D JSON.
     * @property {object} model - Model data.
     */
    av.OBJECT_TREE_UNAVAILABLE_EVENT  = 'propertyDbUnavailable';
    /**
     * Fired when there's a progress event during propertyDB loading.
     * @event Autodesk.Viewing#OBJECT_TREE_LOAD_PROGRESS_EVENT
     * @property {object} svf - Parsed SVF/F2D JSON.
     * @property {object} model - Model data.
     */
    av.OBJECT_TREE_LOAD_PROGRESS_EVENT  = 'propertyDbLoadProgress';

    /**
     * Fired when a model is removed from the viewer.
     * Note that this event fires _after_ destructor. If
     * you need to access the model, e.g. via model.getData(), use
     * BEFORE_MODEL_UNLOADED instead.
     * @event Autodesk.Viewing#MODEL_UNLOADED_EVENT
     * @property {object} model - Model data (after disposing data)
     */
    av.MODEL_UNLOADED_EVENT           = 'modelUnloaded';

    /**
     * Fired if a model unload is about to happen, but the model is still fully available.
     * @event Autodesk.Viewing#BEFORE_MODEL_UNLOAD_EVENT
     * @property {object} model - Model data.
     */
    av.BEFORE_MODEL_UNLOAD_EVENT = 'beforeModelUnload';

    /**
     * Fired when a model is added to model queue so as to be visible.
     * @event Autodesk.Viewing#MODEL_ADDED_EVENT
     * @property {object} model - Model data.
     */
    av.MODEL_ADDED_EVENT              = 'modelAdded';

    /**
     * Fired when a model is removed from model queue, i.e. changed to invisible.
     * @event Autodesk.Viewing#MODEL_REMOVED_EVENT
     * @property {object} model - Model data.
     */
    av.MODEL_REMOVED_EVENT            = 'modelRemoved';

    /**
     * Fired when the layers of the model are successfully loaded.
     * @event Autodesk.Viewing#MODEL_LAYERS_LOADED_EVENT
     * @property {object} root - Model layers root.
     * @property {object} model - Model data.
     */
    av.MODEL_LAYERS_LOADED_EVENT = 'modelLayersLoaded';
    
    /**
     * Fired a when model transform matrix has been changed. This usually happens if either placement or globalOffset
     * has changed for a model.
     * @event Autodesk.Viewing#MODEL_TRANSFORM_CHANGED_EVENT
     * @property {object} model - Model data.
     * @property {object} matrix - Transform matrix.
     */
    av.MODEL_TRANSFORM_CHANGED_EVENT = 'modelTransformChanged',

    /**
     * Fired if placementTransform was changed. 
     */
    av.MODEL_PLACEMENT_CHANGED_EVENT = 'placementTransformChanged',

    /**
     * Fired if viewportBounds was changed. 
     */
    av.MODEL_VIEWPORT_BOUNDS_CHANGED_EVENT = 'viewportBoundsChanged',

    /**
     * Fired before a viewer extension is loaded.
     * @event Autodesk.Viewing#EXTENSION_PRE_LOADED_EVENT
     * @property {string} extensionId - Extension identifier.
     */
    av.EXTENSION_PRE_LOADED_EVENT    = 'extensionPreLoaded';
    /**
     * Fired when a viewer extension is successfully loaded.
     * @event Autodesk.Viewing#EXTENSION_LOADED_EVENT
     * @property {string} extensionId - Extension identifier.
     */
    av.EXTENSION_LOADED_EVENT         = 'extensionLoaded';
    /**
     * Fired before a viewer extension is unloaded.
     * @event Autodesk.Viewing#EXTENSION_PRE_UNLOADED_EVENT
     * @property {string} extensionId - Extension identifier.
     */
    av.EXTENSION_PRE_UNLOADED_EVENT    = 'extensionPreUnloaded';
    /**
     * Fired when a viewer extension is successfully unloaded.
     * @event Autodesk.Viewing#EXTENSION_UNLOADED_EVENT
     * @property {string} extensionId - Extension identifier.
     */
    av.EXTENSION_UNLOADED_EVENT       = 'extensionUnloaded';
    /**
     * Fired before a viewer extension is activated.
     * @event Autodesk.Viewing#EXTENSION_PRE_ACTIVATED_EVENT
     * @property {string} extensionId - Extension identifier.
     * @property {string} mode - Activated mode.
     */
    av.EXTENSION_PRE_ACTIVATED_EVENT      = 'extensionPreActivated';
    /**
     * Fired after a viewer extension is activated.
     * @event Autodesk.Viewing#EXTENSION_ACTIVATED_EVENT
     * @property {string} extensionId - Extension identifier.
     * @property {string} mode - Activated mode.
     */
    av.EXTENSION_ACTIVATED_EVENT      = 'extensionActivated';
    /**
     * Fired before a viewer extension is deactivated.
     * @event Autodesk.Viewing#EXTENSION_PRE_DEACTIVATED_EVENT
     * @property {string} extensionId - Extension identifier.
     */
    av.EXTENSION_PRE_DEACTIVATED_EVENT      = 'extensionPreDeactivated';
    /**
     * Fired after a viewer extension is deactivated.
     * @event Autodesk.Viewing#EXTENSION_DEACTIVATED_EVENT
     * @property {string} extensionId - Extension identifier.
     */
    av.EXTENSION_DEACTIVATED_EVENT      = 'extensionDeactivated';
    /**
     * Fired when the list of selected objects changes.
     * @event Autodesk.Viewing#SELECTION_CHANGED_EVENT
     * @property {number[]} fragIdsArray - Fragment IDs of selected objects.
     * @property {number[]} dbIdArray - dbIDs of selected objects.
     * @property {number[]} nodeArray - Same as dbIdArray.
     * @property {object} model - Model data.
     */
    av.SELECTION_CHANGED_EVENT     = 'selection';
    /**
     * Fired when the list of selected objects changes in a multi-model context.
     * @event Autodesk.Viewing#AGGREGATE_SELECTION_CHANGED_EVENT
     * @property {object[]} selections - List of objects containing the typical selection properties
     *   of {@link Autodesk.Viewing#SELECTION_CHANGED_EVENT} for each model.
     */
    av.AGGREGATE_SELECTION_CHANGED_EVENT = 'aggregateSelection';
    /**
     * Fired when the viewer isolates a set of objects (i.e., makes everything else invisible or ghosted).
     * @event Autodesk.Viewing#ISOLATE_EVENT
     * @property {number[]} nodeIdArray - List of isolated node IDs.
     * @property {object} model - Model data.
     */
    av.ISOLATE_EVENT               = 'isolate';
    /**
     * Fired when the list of isolated objects changes in a multi-model context.
     * @event Autodesk.Viewing#AGGREGATE_ISOLATION_CHANGED_EVENT
     * @property {object[]} isolation - List of objects containing the typical selection properties
     *   of {@link Autodesk.Viewing#ISOLATE_EVENT} for each model.
     */
    av.AGGREGATE_ISOLATION_CHANGED_EVENT = 'aggregateIsolation';
    /**
     * Fired when the viewer hides a set of objects.
     * @event Autodesk.Viewing#HIDE_EVENT
     * @property {number[]} nodeIdArray - List of hidden node IDs.
     * @property {object} model - Model data.
     */
    av.HIDE_EVENT                  = 'hide';
    /**
     * Fired when the list of hidden objects changes in a multi-model context.
     * @event Autodesk.Viewing#AGGREGATE_HIDDEN_CHANGED_EVENT
     * @property {object[]} hidden - List of objects containing the typical selection properties
     *   of {@link Autodesk.Viewing#HIDE_EVENT} for each model.
     */
    av.AGGREGATE_HIDDEN_CHANGED_EVENT = 'aggregateHidden';
    
    /**
     * Fired when the viewer shows a set of objects.
     * @event Autodesk.Viewing#SHOW_EVENT
     * @property {number[]} nodeIdArray - List of shown node IDs.
     * @property {object} model - Model data.
     */
    av.SHOW_EVENT                  = 'show';

    /**
     * Fired to show the properties of the object.
     * @event Autodesk.Viewing#SHOW_PROPERTIES_EVENT
     * @property {number} dbId - dbId of the object.
     * @property {object} model - Model data.
     */
    av.SHOW_PROPERTIES_EVENT       = 'showProperties';

    /**
     * Fired whenever `viewer.showAll()` is used.
     *
     * @event Autodesk.Viewing#SHOW_ALL_EVENT
     */
    av.SHOW_ALL_EVENT                  = 'showAll';

     /**
     * Fired whenever `viewer.hideAll()` is used.
     *
     * @event Autodesk.Viewing#HIDE_ALL_EVENT
     */
      av.HIDE_ALL_EVENT                  = 'hideAll';

    /**
     * Fired when a camera changes.
     * @event Autodesk.Viewing#CAMERA_CHANGE_EVENT
     * @property {object} camera - Affected camera.
     */
    av.CAMERA_CHANGE_EVENT         = 'cameraChanged';
    /**
     * Fired whenever the Explode tool is used.
     * @event Autodesk.Viewing#EXPLODE_CHANGE_EVENT
     * @property {number} scale - Scale of the current exploded state.
     */
    av.EXPLODE_CHANGE_EVENT        = 'explodeChanged';
    /**
     * Fired when a ``fitToView`` operation is applied.
     * @event Autodesk.Viewing#FIT_TO_VIEW_EVENT
     * @property {boolean} immediate - True if the change was immediate.
     * @property {number[]} nodeIdArray - List of node IDs fitted. Array is empty when fitting to the whole model.
     * @property {object} model - Model data.
     */
    av.FIT_TO_VIEW_EVENT           = 'fitToView';
    /**
     * Fired when ``fitToView`` operation is applied, supports multi-model contexts.
     * @event Autodesk.Viewing#AGGREGATE_FIT_TO_VIEW_EVENT
     * @property {object[]} selection - List of objects each containing a ``model`` instance and a ``selection`` array of ids.
     */
    av.AGGREGATE_FIT_TO_VIEW_EVENT = 'aggregateFitToView';
    /**
     * Fired when the cutting planes change.
     * @event Autodesk.Viewing#CUTPLANES_CHANGE_EVENT
     * @property {object[]} planes - List of cutplanes.
     */
    av.CUTPLANES_CHANGE_EVENT      = 'cutplanesChanged';
    /**
     * Fired when a tool is activated or deactivated.
     * @event Autodesk.Viewing#TOOL_CHANGE_EVENT
     * @property {string} toolName - Name of a specific mode of a tool.
     * @property {object} tool - Tool object.
     * @property {boolean} active - Current status of the tool.
     */
    av.TOOL_CHANGE_EVENT           = 'toolChanged';
    /**
     * Fired when rendering options change.
     * @event Autodesk.Viewing#RENDER_OPTION_CHANGED_EVENT
     */
    av.RENDER_OPTION_CHANGED_EVENT = 'renderOptionChanged';
    /**
     * Fired when the render frame shown by the Viewer is final or complete (it has
     * no more pending geometry or post processing effects which delay incoming frames),
     * or when the Viewer stops showing final frames. The name refers to when the
     * state changes from busy to idle for the renderer, or vice versa. To know
     * when all geometry is fully displayed, also check for GEOMETRY_LOADED_EVENT.
     *
     * @event Autodesk.Viewing#FINAL_FRAME_RENDERED_CHANGED_EVENT
     * @property {boolean} finalFrame - final frame is displayed this tick.
     */
    av.FINAL_FRAME_RENDERED_CHANGED_EVENT = 'finalFrameRenderedChanged';
    /**
     * Fired when the render has presented to the screen.
     * @event Autodesk.Viewing#RENDER_PRESENTED_EVENT
     */
    av.RENDER_PRESENTED_EVENT = 'renderPresented';
    /**
     * Fired when visibility of a 2D layer changes.
     * @event Autodesk.Viewing#LAYER_VISIBILITY_CHANGED_EVENT
     */
    av.LAYER_VISIBILITY_CHANGED_EVENT  = 'layerVisibility';

    /**
     * Fired when a user preference property changes.
     * @event Autodesk.Viewing#PREF_CHANGED_EVENT
     * @property {string} name - Property name.
     * @property {object} value - New property value.
     */
    av.PREF_CHANGED_EVENT = 'PrefChanged';
    /**
     * Fired when a user preference property is reset.
     * @event Autodesk.Viewing#PREF_RESET_EVENT
     * @property {string} name - Property name.
     * @property {object} value - New property value.
     */
    av.PREF_RESET_EVENT = 'PrefReset';

    /**
     * Fired as a result of invoking `viewer.restoreDefaultSettings()` to restore default settings.
     * Will get fired after all other Autodesk.Viewing.PREF_CHANGED_EVENT get fired.
     * @event Autodesk.Viewing#RESTORE_DEFAULT_SETTINGS_EVENT
     */
    av.RESTORE_DEFAULT_SETTINGS_EVENT = 'restoreDefaultSettings';

    /**
     * Fired when animations are successfully initialized.
     * @event Autodesk.Viewing#ANIMATION_READY_EVENT
     */
    av.ANIMATION_READY_EVENT = 'animationReady';

    /**
     * Fired whenever a camera transition is finished, such as Focus, Go to Home View,
     * Restore State, restore Named Views, and others.
     * @event Autodesk.Viewing#CAMERA_TRANSITION_COMPLETED
     */
    av.CAMERA_TRANSITION_COMPLETED = 'cameraTransitionCompleted';

    /**
     * Fired when user clicks on a hyperlink embedded in the model.
     * @event Autodesk.Viewing#HYPERLINK_EVENT
     * @property {object} data - Hyperlink data.
     */
    av.HYPERLINK_EVENT = 'hyperlink';

    av.HYPERLINK_NAVIGATE = 'hyperlink_navigate';

    av.LOAD_GEOMETRY_EVENT = 'load_geometry';

     /**
     * Fired when something in the view changes that may expose missing geometry.
     * @event Autodesk.Viewing#LOAD_MISSING_GEOMETRY
     * @property {boolean} [delay] - A flag used to aggregate multiple events during user interactions.
     *                               Defaults to true.
     */
    av.LOAD_MISSING_GEOMETRY           = 'loadMissingGeometry';

    /**
     * Fired when the drawing buffer associated with a WebGLRenderingContext object has been lost
     * 
     * @event Autodesk.Viewing#WEBGL_CONTEXT_LOST_EVENT
     */
    av.WEBGL_CONTEXT_LOST_EVENT  = 'webglcontextlost';

    /**
     * Fired when the WebGLRenderingContext was restored
     * 
     * @event Autodesk.Viewing#WEBGL_CONTEXT_RESTORED_EVENT
     */
    av.WEBGL_CONTEXT_RESTORED_EVENT  = 'webglcontextrestored';

    /**
     * Fired when a leaflet screenshot needs to be canceled before downloading all required / pending tiles.
     * 
     * @event Autodesk.Viewing#CANCEL_LEAFLET_SCREENSHOT
     */
    av.CANCEL_LEAFLET_SCREENSHOT  = 'cancelLeafletScreenshot';

    
    /**
     * Fired after a successful call into {Autodesk.Viewing.Viewer3D#setView}.
     * 
     * @event Autodesk.Viewing#SET_VIEW_EVENT
     * @property {Autodesk.Viewing.BubbleNode} view - The view object that was applied.
     */
    av.SET_VIEW_EVENT  = 'setView';

    
    /**
     * Fired when the first pixel of the model is ready to be rendered.
     * 
     * @event Autodesk.Viewing#RENDER_FIRST_PIXEL
     */
    av.RENDER_FIRST_PIXEL = 'renderFirstPixel';

    /**
     * Fired when a profile is added to the viewer.profileManager
     * @event Autodesk.Viewing#PROFILE_CHANGE_EVENT
     */
    av.PROFILE_CHANGE_EVENT = 'profileChanged';

    /**
     * Fired when a scene part is about to be rendered
     * @event Autodesk.Viewing#PROFILE_CHANGE_EVENT
     */
    av.RENDER_SCENE_PART = 'renderScenePart';

    /**
     * Fired when object under mouse changed.
     * @event Autodesk.Viewing#OBJECT_UNDER_MOUSE_CHANGED
     */
    av.OBJECT_UNDER_MOUSE_CHANGED = 'hoverObjectChanged';

    /**
     * Fired when AnimController calls Autodesk.Viewing.Private.fadeValue
     * @event Autodesk.Viewing#ANIM_ENDED
     */
    av.ANIM_ENDED = 'animEnded';

    /** Fired when transition started
     * @event Autodesk.Viewing#TRANSITION_STARTED
     * @property {object} sceneAnimState // scene state of transition
     */
    av.TRANSITION_STARTED = 'transitionStarted';

    /** Fired when transition ended
     * @event Autodesk.Viewing#TRANSITION_ENDED
     * @property {object} sceneAnimState // scene state of transition, this will be null for models that do not have any clusters or animations
     */
    av.TRANSITION_ENDED = 'transitionEnded';