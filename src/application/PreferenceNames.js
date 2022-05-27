/**
 * Contains viewer setting preference names for 3D models.
 * @typedef {Object} Prefs3D
 * @property {string} VIEW_CUBE - Sets the visibility of the viewcube.
 * @property {string} VIEW_CUBE_COMPASS - Sets the visibility of the viewcube compass. The compass will only be displayed if model contains orientation data.
 * @property {string} VIEW_TYPE - Sets the view to orthographic or perspective.
 * @property {string} ALWAYS_USE_PIVOT - Orbit controls always orbit around the currently set pivot point.
 * @property {string} ZOOM_TOWARDS_PIVOT - Default direction for camera dolly (zoom) operations to be towards the camera pivot point.
 * @property {string} SELECTION_SETS_PIVOT - Sets selection / un-selection action to automatically reset the orbit pivot to be the center of the multiple selection.
 * @property {string} REVERSE_HORIZONTAL_LOOK_DIRECTION - Sets a view navigation option to reverse the default direction for horizontal look operations.
 * @property {string} REVERSE_VERTICAL_LOOK_DIRECTION - Sets a view navigation option to reverse the default direction for vertical look operations.
 * @property {string} ORBIT_PAST_WORLD_POLES - Set a view navigation option to allow the orbit controls to move the camera beyond the north and south poles (world up/down direction).
 * @property {string} CLICK_TO_SET_COI - Modify the default click behavior for the viewer.
 * @property {string} GHOSTING - Toggles ghosting during search and isolate.
 * @property {string} OPTIMIZE_NAVIGATION - Toggles whether the navigation should be optimized for performance.
 * @property {string} AMBIENT_SHADOWS - Enables or disables ambient shadows.
 * @property {string} ANTIALIASING - Enables or disables antialiasing.
 * @property {string} GROUND_SHADOW - Toggles ground shadow.
 * @property {string} GROUND_REFLECTION - Toggles ground reflection.
 * @property {string} LINE_RENDERING - Hides all lines in the scene.
 * @property {string} EDGE_RENDERING - Turns edge topology display on/off (where available).
 * @property {string} LIGHT_PRESET - Sets the Light Presets (Environments) for the Viewer.
 * @property {string} ENV_MAP_BACKGROUND - Toggles environment map for background.
 * @property {string} FIRST_PERSON_TOOL_POPUP - Toggles first person tool popup.
 * @property {string} BIM_WALK_TOOL_POPUP - Toggles the bimwalk tool popup.
 * @property {string} BIM_WALK_NAVIGATOR_TYPE - Identifier for the bimWalkNavigatorType preference. This is used to set the BimWalk tool navigator.
 * @property {string} BIM_WALK_GRAVITY - Identifier for the bimWalkGravity preference. This is used to toggle the BimWalk tool's gravity.
 * @property {string} DEFAULT_NAVIGATION_TOOL_3D - identifier for the toolToUse preference. This is used to set which navigation tool will be used.
 * @property {string} SELECTION_MODE - identifier for the selectionMode preference. This is used to set which selection mode (Leaf, First, Last object) wil be used by the viewer.
 * @property {string} ENABLE_CUSTOM_ORBIT_TOOL_CURSOR - identifier for whether the OrbitDollyPanTool will customize the cursor visuals.
 * @property {string} EXPLODE_STRATEGY - Specifies which algorithm is used when exploding the model. Supported values are 'hierarchy' (default) and 'radial'. Other values are treated as 'radial'.
 * @property {string} FORCE_DOUBLE_SIDED - Forces the viewer to render materials as double sided. Otherwise it uses the model specified value.
 */

/**
 * Preference names that can be used to set {@link Autodesk.Viewing.Private.Preferences}
 * These preference names only apply for 3D models. 
 * @type {Prefs3D}
 * @alias Autodesk.Viewing.Private.Prefs3D
 */
export const Prefs3D = {
    VIEW_CUBE:                         'viewCube',
    VIEW_CUBE_COMPASS:                 'viewCubeCompass',
    VIEW_TYPE:                         'viewType',
    ALWAYS_USE_PIVOT:                  'alwaysUsePivot',
    ZOOM_TOWARDS_PIVOT:                'zoomTowardsPivot',
    SELECTION_SETS_PIVOT:              'selectionSetsPivot',
    REVERSE_HORIZONTAL_LOOK_DIRECTION: 'reverseHorizontalLookDirection',
    REVERSE_VERTICAL_LOOK_DIRECTION:   'reverseVerticalLookDirection',
    ORBIT_PAST_WORLD_POLES:            'orbitPastWorldPoles',
    CLICK_TO_SET_COI:                  'clickToSetCOI',
    GHOSTING:                          'ghosting',
    OPTIMIZE_NAVIGATION:               'optimizeNavigation',
    AMBIENT_SHADOWS:                   'ambientShadows',
    ANTIALIASING:                      'antialiasing',
    GROUND_SHADOW:                     'groundShadow',
    GROUND_REFLECTION:                 'groundReflection',
    LINE_RENDERING:                    'lineRendering',
    EDGE_RENDERING:                    'edgeRendering',
    LIGHT_PRESET:                      'lightPreset',
    ENV_MAP_BACKGROUND:                'envMapBackground',
    FIRST_PERSON_TOOL_POPUP:           'firstPersonToolPopup',
    BIM_WALK_TOOL_POPUP:               'bimWalkToolPopup',
    BIM_WALK_NAVIGATOR_TYPE:           'bimWalkNavigatorType',
    BIM_WALK_GRAVITY:                  'bimWalkGravity',
    DEFAULT_NAVIGATION_TOOL_3D:        'defaultNavigationTool3D',
    SELECTION_MODE:                    'selectionMode',
    ENABLE_CUSTOM_ORBIT_TOOL_CURSOR:   'enableCustomOrbitToolCursor',
    EXPLODE_STRATEGY:                  'explodeStrategy',
    FORCE_DOUBLE_SIDED:                'forceDoubleSided',
    DISPLAY_SECTION_HATCHES:           'displaySectionHatches'
};

/**
 * Contains viewer setting preference names for 2D models.
 * @typedef {Object} Prefs2D
 * @property {string} GRAYSCALE - Overrides line colors in 2D models to render in shades of gray.
 * @property {string} SWAP_BLACK_AND_WHITE - Will switch to white lines on a black background.
 * @property {string} FORCE_PDF_CALIBRATION - Force PDF calibration before measuring.
 * @property {string} FORCE_LEAFLET_CALIBRATION - Force Leaflet calibration before measuring.
 */

/**
 * Preference names that can be used to set {@link Autodesk.Viewing.Private.Preferences}
 * These preference names only apply for 2D models. 
 * @type {Prefs2D}
 * @alias Autodesk.Viewing.Private.Prefs2D
 */
export const Prefs2D = {
    GRAYSCALE:            'grayscale',
    SWAP_BLACK_AND_WHITE: 'swapBlackAndWhite',
    LOADING_ANIMATION: 'loadingAnimation',
    FORCE_PDF_CALIBRATION:     'forcePDFCalibration',
    FORCE_LEAFLET_CALIBRATION: 'forceLeafletCalibration',
    DISABLE_PDF_HIGHLIGHT: 'disablePdfHighlight'
};

/**
 * Contains viewer setting preference names that are available to both 3D and 2D models.
 * @typedef {Object} Prefs
 * @property {string} PROGRESSIVE_RENDERING - Toggles whether progressive rendering is used.
 * @property {string} OPEN_PROPERTIES_ON_SELECT - Open property panel when selecting an object. (Only for GuiViewer3D)
 * @property {string} POINT_RENDERING - Hides all points in the scene.
 * @property {string} BACKGROUND_COLOR_PRESET - Sets a color to the background.
 * @property {string} REVERSE_MOUSE_ZOOM_DIR - Reverse the default direction for camera dolly (zoom) operations.
 * @property {string} LEFT_HANDED_MOUSE_SETUP - Reverse mouse buttons from their default assignment (i.e. Left mouse operation becomes right mouse and vice versa).
 * @property {string} FUSION_ORBIT - Sets the orbit to fusion orbit.
 * @property {string} FUSION_ORBIT_CONSTRAINED - Sets the the orbit to the contrained fusion orbit.
 * @property {string} WHEEL_SETS_PIVOT - Sets wheel-zoom action to automatically reset the orbit pivot to the location under the cursor.
 * @property {string} RESTORE_SESSION_MEASUREMENTS - When opening the measure tool restore any existing measurements that where created during the session.
 * @property {string} DISPLAY_UNITS - Units for quantities displayed in the property panel
 * @property {string} DISPLAY_UNITS_PRECISION - Precision for quantities displayed in the property panel
 * @property {string} KEY_MAP_CMD - CMD key mapping to CTRL key in Mac
 */

/**
 * Preference names that can be used to set {@link Autodesk.Viewing.Private.Preferences}
 * These preference names are shared between both 3D and 2D models. 
 * @type {Prefs}
 * @alias Autodesk.Viewing.Private.Prefs
 */
export const Prefs = {
    PROGRESSIVE_RENDERING:        'progressiveRendering',
    OPEN_PROPERTIES_ON_SELECT:    'openPropertiesOnSelect',
    POINT_RENDERING:              'pointRendering',
    BACKGROUND_COLOR_PRESET:      'backgroundColorPreset',
    REVERSE_MOUSE_ZOOM_DIR:       'reverseMouseZoomDir',
    LEFT_HANDED_MOUSE_SETUP:      'leftHandedMouseSetup',
    FUSION_ORBIT:                 'fusionOrbit',
    FUSION_ORBIT_CONSTRAINED:     'fusionOrbitConstrained',
    WHEEL_SETS_PIVOT:             'wheelSetsPivot',
    RESTORE_SESSION_MEASUREMENTS: 'restoreMeasurements',
    DISPLAY_UNITS:                'displayUnits',
    DISPLAY_UNITS_PRECISION:      'displayUnitsPrecision',
    KEY_MAP_CMD:                  'keyMapCmd',
    ZOOM_DRAG_SPEED:              'zoomDragSpeed',
    ZOOM_SCROLL_SPEED:            'zoomScrollSpeed'
};


/**
 * ViewCube view types.
 * @typedef {Object} VIEW_TYPES
 * @property {number} DEFAULT - Sets the default view and enables the view preferences.
 * @property {number} ORTHOGRAPHIC - Sets the orthographic view and enables the view preferences.
 * @property {number} PERSPECTIVE - sets the perspective view and enables the view preferences.
 * @property {number} PERSPECTIVE_ORTHO_FACES - sets the perspective with orthographic faces view and enables the view preferences
 */

/**
 * View types used for setting the viewType preference.
 * @type {VIEW_TYPES}
 * @alias Autodesk.Viewing.Private.VIEW_TYPES
 */
export const VIEW_TYPES = {
    DEFAULT: 0,
    ORTHOGRAPHIC: 1,
    PERSPECTIVE: 2,
    PERSPECTIVE_ORTHO_FACES: 3
};