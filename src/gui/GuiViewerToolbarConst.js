

/**
 * Fired after the toolbar UI gets instantiated.
 *
 * @event Autodesk.Viewing#TOOLBAR_CREATED_EVENT
 */
export const TOOLBAR_CREATED_EVENT = 'toolbarCreated';

/**
 * Fired after the Settings panel gets instantiated.
 *
 * @event Autodesk.Viewing#SETTINGS_PANEL_CREATED_EVENT
 */
export const SETTINGS_PANEL_CREATED_EVENT = 'settingsPanelCreated';
/**
 * Fired after the ViewCube gets instantiated.
 *
 * @event Autodesk.Viewing#VIEW_CUBE_CREATED_EVENT
 */
export const VIEW_CUBE_CREATED_EVENT = 'viewCubeCreated';

/**
 * Viewer tools sets.
 *
 * These constants are used to define the standard set of tools.
 *
 * @enum {string}
 * @readonly
 * @memberof Autodesk.Viewing
 */
export const TOOLBAR = {
    NAVTOOLSID:      "navTools",
    MODELTOOLSID:    "modelTools",
    SETTINGSTOOLSID: "settingsTools",
    MEASURETOOLSID:      "measureTools",
};
