import { Prefs, Prefs2D, Prefs3D, VIEW_TYPES } from './PreferenceNames';
import { logger } from "../logger/Logger";

import { SelectionMode } from '../wgs/scene/SelectionMode';
import { isMobileDevice, getGlobal } from '../compat';
import { DefaultLightPreset } from './LightPresets';

import { displayUnitsEnum, displayUnitsPrecisionEnum } from '../measurement/DisplayUnits';

// For enum type values
export class EnumType {
    constructor(values, current) {
        if (!Array.isArray(values) || values.length === 0) {
            throw new Error(`Invalid ${values}`);
        }
        
        this.values = new Set(values);
        this.current = values.includes(current) ? current : values[0];
    }

    get value() {
        return this.current;
    }

    set value(newValue) {
        if (this.values.has(newValue)) {
            this.current = newValue;
        }
    }

    clone() {
        return EnumType.deSerialize(JSON.parse(this.toString()));
    }

    // for serializing
    toString() {
        return JSON.stringify({
            type: '__enum',
            values: Array.from(this.values),
            current: this.current
        });
    }

    static deSerialize(obj) {
        if (obj.type !== '__enum') {
            return;
        }

        return new EnumType(obj.values, obj.current);
    }
}

/**
 * Object used to apply the preferences by a Profile 
 * @typedef {Object} Settings
 * @property {boolean} viewCube - Sets the visibility of the viewcube.
 * @property {boolean} viewCubeCompass - Sets the visibility of the viewcube compass. The compass will only be displayed if model contains orientation data.
 * @property {number} viewType - Sets the view to default (0), orthographic (1), perspective (2) or perspective with ortho faces (3).
 * @property {boolean} alwaysUsePivot - Orbit controls always orbit around the currently set pivot point.
 * @property {boolean} zoomTowardsPivot - default direction for camera dolly (zoom) operations to be towards the camera pivot point.
 * @property {boolean} reverseHorizontalLookDirection - Sets a view navigation option to reverse the default direction for horizontal look operations.
 * @property {boolean} reverseVerticalLookDirection - Sets a view navigation option to reverse the default direction for vertical look operations.
 * @property {boolean} orbitPastWorldPoles - Set a view navigation option to allow the orbit controls to move the camera beyond the north and south poles (world up/down direction).
 * @property {boolean} clickToSetCOI - Modify the default click behavior for the viewer.
 * @property {boolean} ghosting - Toggles ghosting during search and isolate.
 * @property {boolean} optimizeNavigation - Toggles whether the navigation should be optimized for performance.
 * @property {boolean} ambientShadows - Enables or disables ambient shadows.
 * @property {boolean} antialiasing - Enables or disables antialiasing.
 * @property {boolean} groundShadow - Toggles ground shadow.
 * @property {boolean} groundReflection - Toggles ground reflection.
 * @property {boolean} lineRendering - Hides all lines in the scene.
 * @property {boolean} edgeRendering - Turns edge topology display on/off (where available).
 * @property {number|string} lightPreset - Sets the Light Presets (Environments) for the Viewer.
 * @property {boolean} envMapBackground - Toggles environment map for background.
 * @property {boolean} firstPersonToolPopup - Toggles first person tool popup.
 * @property {boolean} bimWalkToolPopup - Toggles the bimwalk tool popup.
 * @property {boolean} grayscale - Overrides line colors in 2D models to render in shades of gray.
 * @property {boolean} swapBlackAndWhite - Will switch to white lines on a black background.
 * @property {boolean} progressiveRendering - Toggles whether progressive rendering is used.
 * @property {boolean} openPropertiesOnSelect - Open property panel when selecting an object (Only for GuiViewer3D).
 * @property {boolean} pointRendering - Hides all points in the scene.
 * @property {*} backgroundColorPreset - Sets a color to the background.
 * @property {boolean} reverseMouseZoomDir - Reverse the default direction for camera dolly (zoom) operations.
 * @property {boolean} leftHandedMouseSetup - Reverse mouse buttons from their default assignment (i.e. Left mouse operation becomes right mouse and vice versa).
 * @property {boolean} fusionOrbit - Sets the orbit to fusion orbit.
 * @property {boolean} fusionOrbitConstrained - Sets the the orbit to the contrained fusion orbit.
 * @property {boolean} wheelSetsPivot - Sets wheel-zoom action to automatically reset the orbit pivot to the location under the cursor.
 * @property {boolean} selectionSetsPivot - Sets selection / un-selection action to automatically reset the orbit pivot to be the center of the multiple selection.
 * @property {string} bimWalkNavigatorType - Sets the BimWalk tool navigator.
 * @property {boolean} bimWalkGravity - Toggles the BimWalk tool's gravity.
 * @property {string} defaultNavigationTool3D - Sets which navigation tool will be used by the viewer. (ie: 'extractor_defined' || 'bimwalk')
 * @property {string} explodeStrategy - Sets which algorithm is used when exploding a model. Supported values are 'hierarchy' (default) and 'radial'. Other values are treated as 'radial'.
 * @property {boolean} loadingAnimation - Toggles loading animation for 2D Models.
 * @property {boolean} forcePDFCalibration - Force PDF calibration before measuring.
 * @property {boolean} forceLeafletCalibration - Force Leaflet calibration before measuring.
 * @property {boolean} restoreMeasurements - When opening the measure tool restore any existing measurements that where created during the session.
 * @property {boolean} forceDoubleSided - Force the render to use double sided materials.
 * @property {boolean} keyMapCmd - Force mapping CMD key to Ctrl in Mac.
 * @property {boolean} displaySectionHatches - Display the hatch pattern for planes in the section tool. This does not apply to the section box.
 */

const defaultSettings = {};
defaultSettings[Prefs3D.AMBIENT_SHADOWS] = true;
defaultSettings[Prefs3D.ANTIALIASING] = !isMobileDevice();
defaultSettings[Prefs3D.GROUND_SHADOW] = true;
defaultSettings[Prefs3D.GROUND_REFLECTION] = false;
defaultSettings[Prefs3D.GHOSTING] = true;
defaultSettings[Prefs3D.VIEW_CUBE] = !isMobileDevice();
defaultSettings[Prefs3D.VIEW_CUBE_COMPASS] = false;
defaultSettings[Prefs3D.VIEW_TYPE] = VIEW_TYPES.DEFAULT;
defaultSettings[Prefs3D.LINE_RENDERING] = true;
defaultSettings[Prefs3D.LIGHT_PRESET] = DefaultLightPreset;
defaultSettings[Prefs3D.EDGE_RENDERING] = false;
defaultSettings[Prefs3D.REVERSE_HORIZONTAL_LOOK_DIRECTION] = false;
defaultSettings[Prefs3D.REVERSE_VERTICAL_LOOK_DIRECTION] = false;
defaultSettings[Prefs3D.ALWAYS_USE_PIVOT] = false;
defaultSettings[Prefs3D.ZOOM_TOWARDS_PIVOT] = false;
defaultSettings[Prefs3D.ORBIT_PAST_WORLD_POLES] = true;
defaultSettings[Prefs3D.CLICK_TO_SET_COI] = false;
defaultSettings[Prefs3D.OPTIMIZE_NAVIGATION] = isMobileDevice();
defaultSettings[Prefs3D.ENV_MAP_BACKGROUND] = false;
defaultSettings[Prefs3D.FIRST_PERSON_TOOL_POPUP] = true;
defaultSettings[Prefs3D.BIM_WALK_TOOL_POPUP] = true;
defaultSettings[Prefs3D.BIM_WALK_NAVIGATOR_TYPE] = 'default';
defaultSettings[Prefs3D.BIM_WALK_GRAVITY] = true;
defaultSettings[Prefs3D.DEFAULT_NAVIGATION_TOOL_3D] = 'default';
defaultSettings[Prefs3D.SELECTION_MODE] = SelectionMode.LEAF_OBJECT;
defaultSettings[Prefs3D.ENABLE_CUSTOM_ORBIT_TOOL_CURSOR] = true;
defaultSettings[Prefs3D.EXPLODE_STRATEGY] = 'hierarchy';
defaultSettings[Prefs3D.SELECTION_SETS_PIVOT] = false;
defaultSettings[Prefs3D.FORCE_DOUBLE_SIDED] = false;
defaultSettings[Prefs3D.DISPLAY_SECTION_HATCHES] = true;

// Settings for 2D
defaultSettings[Prefs2D.GRAYSCALE] = false;
defaultSettings[Prefs2D.SWAP_BLACK_AND_WHITE] = false;
defaultSettings[Prefs2D.LOADING_ANIMATION] = false;
defaultSettings[Prefs2D.FORCE_PDF_CALIBRATION] = false;
defaultSettings[Prefs2D.FORCE_LEAFLET_CALIBRATION] = true;
defaultSettings[Prefs2D.DISABLE_PDF_HIGHLIGHT] = false;

// Settings that are shared between 2D and 3D
defaultSettings[Prefs.PROGRESSIVE_RENDERING] = true;
defaultSettings[Prefs.OPEN_PROPERTIES_ON_SELECT] = false;
defaultSettings[Prefs.POINT_RENDERING] = true;
defaultSettings[Prefs.BACKGROUND_COLOR_PRESET] = null;
defaultSettings[Prefs.REVERSE_MOUSE_ZOOM_DIR] = false;
defaultSettings[Prefs.LEFT_HANDED_MOUSE_SETUP] = false;
defaultSettings[Prefs.FUSION_ORBIT] = true;
defaultSettings[Prefs.FUSION_ORBIT_CONSTRAINED] = true;
defaultSettings[Prefs.WHEEL_SETS_PIVOT] = false;
defaultSettings[Prefs.RESTORE_SESSION_MEASUREMENTS] = true;
defaultSettings[Prefs.DISPLAY_UNITS] = new EnumType(displayUnitsEnum);
defaultSettings[Prefs.DISPLAY_UNITS_PRECISION] = new EnumType(displayUnitsPrecisionEnum);
defaultSettings[Prefs.KEY_MAP_CMD] = true;

/**
 * Default settings of the viewer. 
 * For more information about each setting, please reference the {@link Settings}.
 * @typedef {Settings} DefaultSettings
 * @property {boolean} viewCube - Default Value: true. Sets the visibility of the viewcube. Set to false for mobile devices.
 * @property {boolean} alwaysUsePivot - Default Value: false. Orbit controls always orbit around the currently set pivot point.
 * @property {boolean} zoomTowardsPivot - Default Value: false. default direction for camera dolly (zoom) operations to be towards the camera pivot point.
 * @property {boolean} reverseHorizontalLookDirection - Default Value: false. Sets a view navigation option to reverse the default direction for horizontal look operations.
 * @property {boolean} reverseVerticalLookDirection - Default Value: false. Sets a view navigation option to reverse the default direction for vertical look operations.
 * @property {boolean} orbitPastWorldPoles - Default Value: true. Set a view navigation option to allow the orbit controls to move the camera beyond the north and south poles (world up/down direction).
 * @property {boolean} clickToSetCOI - Default Value: false. Modify the default click behavior for the viewer.
 * @property {boolean} ghosting - Default Value: true. Toggles ghosting during search and isolate.
 * @property {boolean} optimizeNavigation - Default Value: false. Toggles whether the navigation should be optimized for performance. Set to true for mobile devices.
 * @property {boolean} ambientShadows - Default Value: true. Enables or disables ambient shadows.
 * @property {boolean} antialiasing - Default Value: true. Enables or disables antialiasing. Set to false for mobile devices.
 * @property {boolean} groundShadow - Default Value: true. Toggles ground shadow.
 * @property {boolean} groundReflection - Default Value: false. Toggles ground reflection.
 * @property {boolean} lineRendering - Default Value: true. Hides all lines in the scene.
 * @property {boolean} edgeRendering - Default Value: false. Turns edge topology display on/off (where available).
 * @property {number} lightPreset - Default Value: 1. Sets the Light Presets (Environments) for the Viewer.
 * @property {boolean} envMapBackground - Default Value: false. Toggles environment map for background.
 * @property {boolean} firstPersonToolPopup - Default Value: true. Toggles first person tool popup.
 * @property {boolean} bimWalkToolPopup - Default Value: true. Toggles the bimwalk tool popup.
 * @property {boolean} grayscale - Default Value: false. Overrides line colors in 2D models to render in shades of gray.
 * @property {boolean} swapBlackAndWhite - Default Value: false. Will switch to white lines on a black background for 2D models.
 * @property {boolean} progressiveRendering - Default Value: true. Toggles whether progressive rendering is used.
 * @property {boolean} openPropertiesOnSelect - Default Value: false. Open property panel when selecting an object (Only for GuiViewer3D).
 * @property {boolean} pointRendering - Default Value: true. Hides all points in the scene.
 * @property {*} backgroundColorPreset - Default Value: null. Sets a color to the background.
 * @property {boolean} reverseMouseZoomDir - Default Value: false. Reverse the default direction for camera dolly (zoom) operations.
 * @property {boolean} leftHandedMouseSetup - Default Value: false. Reverse mouse buttons from their default assignment (i.e. Left mouse operation becomes right mouse and vice versa).
 * @property {boolean} fusionOrbit - Default Value: true. Sets the orbit to fusion orbit.
 * @property {boolean} fusionOrbitConstrained - Default Value: true. Sets the the orbit to the contrained fusion orbit.
 * @property {boolean} wheelSetsPivot - Default Value: false. Sets wheel-zoom action to automatically reset the orbit pivot to the location under the cursor.
 * @property {boolean} selectionSetsPivot - Default Value: false. Sets selection / un-selection action to automatically reset the orbit pivot to be the center of the multiple selection.
 * @property {string} bimWalkNavigatorType - Default Value: 'default'. Sets the BimWalk tool navigator.
 * @property {string} defaultNavigationTool3D - Default Value: 'default'. Sets which navigation tool will be used by the viewer. (ie: 'extractor_defined' || 'bimwalk')
 * @property {boolean} loadingAnimation - Default Value: true. Toggles loading animation for 2D Models.
 * @constant
 * @type {ProfileSettings}
 * @memberof Autodesk.Viewing
 * @default
 */
export const DefaultSettings = defaultSettings;

// Contains Profile Settings that can be used to initialize Profiles.

/**
 * Contains information about which extension should or should not be loaded.
 * @typedef {Object} Extensions
 * @property {string[]} load - An array of extension ids that should be loaded.
 * @property {string[]} unload - An array of extension ids that should not be loaded.
 */

/**
 * Object used for setting a viewer profile.
 * @typedef {Object} ProfileSettings
 * @property {string} name - Name of the profile settings.
 * @property {string} [label] - Optional. An end-user string to use instead of the name.
 * @property {string} [description] - Optional. A description about the profile.
 * @property {Settings} settings - Used by the Profile to apply to the viewer preferences.
 * @property {String[]} persistent - An array of setting ids to keep in localStorage.
 * @property {Extensions} extensions - Extensions that should or should not be loaded.
 */

const defaults = {};

// Settings for 3D
defaults.name = 'Default';
defaults.label = 'Manufacturing (Default)';
defaults.description = 'Default Viewer settings';

defaults.settings = defaultSettings;

// Stores the preference (settings) values in localStorage  
defaults.persistent = [
    // 3D
    Prefs3D.ALWAYS_USE_PIVOT,
    Prefs3D.ZOOM_TOWARDS_PIVOT,
    Prefs3D.REVERSE_HORIZONTAL_LOOK_DIRECTION,
    Prefs3D.REVERSE_VERTICAL_LOOK_DIRECTION,
    Prefs3D.ORBIT_PAST_WORLD_POLES,
    Prefs3D.CLICK_TO_SET_COI,
    Prefs3D.GHOSTING,
    Prefs3D.OPTIMIZE_NAVIGATION,
    Prefs3D.AMBIENT_SHADOWS,
    Prefs3D.ANTIALIASING,
    Prefs3D.GROUND_SHADOW,
    Prefs3D.GROUND_REFLECTION,
    Prefs3D.FIRST_PERSON_TOOL_POPUP,
    Prefs3D.BIM_WALK_TOOL_POPUP,
    Prefs3D.BIM_WALK_GRAVITY,
    Prefs3D.VIEW_TYPE,
    Prefs3D.SELECTION_MODE,
    // 2D
    Prefs2D.SWAP_BLACK_AND_WHITE,
    Prefs2D.LOADING_ANIMATION,
    // 3D and 2D
    Prefs.OPEN_PROPERTIES_ON_SELECT,
    Prefs.REVERSE_MOUSE_ZOOM_DIR,
    Prefs.LEFT_HANDED_MOUSE_SETUP,
    Prefs.WHEEL_SETS_PIVOT,
    Prefs.KEY_MAP_CMD,
    Prefs.DISPLAY_UNITS,
    Prefs.DISPLAY_UNITS_PRECISION,
];

defaults.extensions = {
    load: [],
    unload: []
};

/******************* AEC Profile Settings *******************/

const aec = clone(defaults);
aec.name = 'AEC';
aec.label = 'Construction (AEC)';
aec.description = 'A common set of preferences designed for the Construction industry';
aec.settings[Prefs.REVERSE_MOUSE_ZOOM_DIR] = true;
aec.settings[Prefs3D.EDGE_RENDERING] = !isMobileDevice();
aec.settings[Prefs3D.LIGHT_PRESET] = getGlobal().DefaultLightPresetAec || "Boardwalk";
aec.settings[Prefs3D.ENV_MAP_BACKGROUND] = true;
aec.settings[Prefs3D.VIEW_CUBE_COMPASS] = true;
aec.settings[Prefs3D.SELECTION_SETS_PIVOT] = true;
aec.extensions = {
    load: [],
    unload: []
};


/******************* Fluent Profile Settings *******************/

const fluent = clone(aec);
fluent.name = 'Fluent';
fluent.label = 'Design Collaboration'; // this one gets displayed and localized.
fluent.description = 'User experience that matches Design Collaboration';
fluent.settings[Prefs.WHEEL_SETS_PIVOT] = true;
fluent.settings[Prefs.RESTORE_SESSION_MEASUREMENTS] = false;
fluent.settings[Prefs2D.FORCE_PDF_CALIBRATION] = true;
fluent.settings[Prefs3D.ALWAYS_USE_PIVOT] = true;
fluent.settings[Prefs3D.ENABLE_CUSTOM_ORBIT_TOOL_CURSOR] = false;
fluent.extensions = {
    load: [],
    unload: []
};

fluent.persistent.splice(fluent.persistent.indexOf(Prefs3D.VIEW_TYPE), 1);


/******************* Navis Profile Settings *******************/

// Cloned from the AEC Profile Settings
const navis = clone(aec);
navis.name = 'Navis';
navis.label = 'Navisworks';
navis.description = 'Provides a user experience similar to Autodesk Navisworks desktop application';
navis.settings[Prefs3D.BIM_WALK_TOOL_POPUP] = false;
navis.settings[Prefs3D.BIM_WALK_NAVIGATOR_TYPE] = 'aec';
navis.settings[Prefs3D.DEFAULT_NAVIGATION_TOOL_3D] = 'extractor_defined';


/******************* Helper Functions *******************/

/**
 * Copies a profile settings object.
 * @param {ProfileSettings} [profileSettings] - profile settings to copy, otherwise uses the Autodesk.Viewing.ProfileSettings.Default
 * 
 * @returns {ProfileSettings} - profile settings object.
 *
 * @private
 */
function clone(profileSettings) {
    if (!profileSettings) {
        logger.log("ProfileSettings.clone: missing profileSettings, using DefaultProfileSettings...");
        profileSettings = defaults;
    }
    const newPS = {};
    newPS.settings = Object.assign({}, profileSettings.settings);
    newPS.extensions = {};
    if (Object.prototype.hasOwnProperty.call(profileSettings, 'extensions')) {
        newPS.extensions.load = Object.prototype.hasOwnProperty.call(profileSettings.extensions, 'load') ? profileSettings.extensions.load.slice() : [];
        newPS.extensions.unload = Object.prototype.hasOwnProperty.call(profileSettings.extensions, 'unload') ? profileSettings.extensions.unload.slice(): [];
    } else {
        newPS.extensions = {
            load: [],
            unload: []
        };
    }
    newPS.persistent = profileSettings.persistent.slice();

    return newPS;
}

/**
 * ProfileSettings are used to set the viewer's profile.
 * 
 * To generate a profile from the supplied profile settings, please reference {@link Autodesk.Viewing.Profile}.
 * To set the viewer's profile, use {@link Autodesk.Viewing.Viewer3D#setProfile|viewer.setProfile(profile)}.
 *
 * @namespace Autodesk.Viewing.ProfileSettings
 */
export const ProfileSettings = {
    
    /** 
     * Default profile settings.
     * It uses the preferences described in {@link Autodesk.Viewing.DefaultSettings}.
     * The following preferences will be persisted: alwaysUsePivot, zoomTowardsPivot, reverseHorizontalLookDirection, reverseVerticalLookDirection, orbitPastWorldPoles, clickToSetCOI, ghosting, optimizeNavigation, ambientShadows, antialiasing, groundShadows, groundReflections, firstPersonToolPopup, bimWalkToolPopup, swapBlackAndWhite, openPropertiesOnSelect, reverseMouseZoomDir, leftHandedMouseSetup, wheelSetsPivot
     * 
     * @constant
     * @type {ProfileSettings}
     * @memberof Autodesk.Viewing.ProfileSettings
     * @default
     */
    Default: defaults,


    /** 
     * AEC profile settings. 
     * It inherits the settings from {@link Autodesk.Viewing.ProfileSettings.Default}.
     * The following preferences differ from the Default settings:
     * {
     *    edgeRendering: true, // on desktop, false on mobile.
     *    lightPreset: 'Boardwalk',
     *    envMapBackground: true
     * }
     *  
     * @constant
     * @type {ProfileSettings}
     * @memberof Autodesk.Viewing.ProfileSettings
     * @default
     */
    AEC: aec,


    /** 
     * Design Collaboration profile settings.
     * Inherits the settings from {@link Autodesk.Viewing.ProfileSettings.AEC}.
     * The following preferences differ from the AEC settings:
     * {
     *    reverseMouseZoomDir: true,
     *    wheelSetsPivot: true,
     *    alwaysUsePivot: true,
     *    enableCustomOrbitToolCursor: false
     * }
     * 
     * @constant
     * @type {ProfileSettings}
     * @memberof Autodesk.Viewing.ProfileSettings
     * @default
     */
    Fluent: fluent,


    /** 
     * Navisworks profile settings. 
     * Inherits the settings from {@link Autodesk.Viewing.ProfileSettings.AEC}.
     * The following preferences differ from the AEC settings:
     * {
     *    bimWalkToolPopup: false,
     *    bimWalkNavigatorType: 'aec',
     *    defaultNavigationTool3D: 'extractor_defined'
     * }
     * 
     * @constant
     * @type {ProfileSettings}
     * @memberof Autodesk.Viewing.ProfileSettings
     * @default
     */
    Navis: navis,


    /** 
     * This function is used to clone an existing ProfileSetting.
     * @example
     * const customProfileSettings = Autodesk.Viewing.ProfileSettings.clone(Autodesk.Viewing.ProfileSettings.AEC);
     * 
     * @param {ProfileSettings} [profileSettings] - profile settings to copy, otherwise clones from {@link Autodesk.Viewing.ProfileSettings.Default}.
     * @returns {ProfileSettings} - profile settings object.
     * @type {function}
     * @memberof Autodesk.Viewing.ProfileSettings
     */
    clone: clone
};