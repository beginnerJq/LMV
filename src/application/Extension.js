import { extendLocalization } from "../globalization/i18init";
import { GlobalManagerMixin } from "../application/GlobalManagerMixin";

/**
 * Base class for extending the functionality of the viewer.
 *
 * Derive from this class and implement methods `load()` and `unload()`.
 *
 * Register this extension by calling:
 * `Autodesk.Viewing.theExtensionManager.registerExtension('your_extension_id', YOUR_EXTENSION_CLASS); `
 *
 * Extensions are registered and loaded automatically by adding the Extension ID to the
 * config object passed to the viewer constructor.
 *
 * @alias Autodesk.Viewing.Extension
 * @param {Autodesk.Viewing.Viewer3D} viewer - The viewer to be extended.
 * @param {object} options - An optional dictionary of options for this extension.
 * 
 * @property {Autodesk.Viewing.Viewer3D} viewer - The viewer instance passed in during construction.
 * @property {object} options - The optional dictionary of options for this extension passed in during construction.
 * @property {string} id - An identifier used to load the extension. Populated automatically by {@link Autodesk.Viewing.ExtensionManager}.
 * @property {string[]} modes - A collection of activation modes the extension supports.
 * @property {boolean} activeStatus - Reflects whether the extension has been activated, see {@link Autodesk.Viewing.Extension#activate}.
 * 
 * @constructor
 */
export var Extension = function (viewer, options) {
    this.viewer = viewer;
    GlobalManagerMixin.call(this);
    this.setGlobalManager(viewer.globalManager);
    this.options = options || {};
    this.id = ''; // Populated by theExtensionManager
    this.modes = [];
    this.mode = '';
    this.name ='';
    this.activeStatus = false;
};


/**
 * Override the load method to add functionality to the viewer.
 * Use the Viewer's APIs to add/modify/replace/delete UI, register event listeners, etc.
 * @returns {boolean | Promise} True if the load was successful. Optionally, the function can return a Promise which resolves when load succeeds and rejects in case of failure.
 * @virtual
 * @alias Autodesk.Viewing.Extension#load
 */
Extension.prototype.load = function () {
    return true;
};

/**
 * Override the unload method to perform some cleanup of operations that were done in load.
 * @returns {boolean} True if the unload was successful.
 * @virtual
 * @alias Autodesk.Viewing.Extension#unload
 */
Extension.prototype.unload = function () {
    return true;
};

/**
 * Override the activate method to enable the functionality of the extension.
 * @param {string} [mode] - An optional mode that indicates a different way the extension can function.
 * @see {@link Autodesk.Viewing.Extension#getModes }
 * @returns {boolean} True if the extension activation was successful.
 * @virtual
 * @alias Autodesk.Viewing.Extension#activate
 */
Extension.prototype.activate = function (mode) {
    return true;
};

/**
 * Override the deactivate method to disable the functionality of the extension.
 * @returns {boolean} True if the extension deactivation was successful.
 * @virtual
 * @alias Autodesk.Viewing.Extension#deactivate
 */
Extension.prototype.deactivate = function () {
    return true;
};

/**
 * Activates the extension if the enable parameter is set to true.
 * Deactivates the extension if the enable parameter is set to true.
 * @param {boolean} enable - flag to activate or deactivate the extension.
 * @param {string} [mode] - An optional mode that indicates a different way the extension can function.
 * @virtual
 * @alias Autodesk.Viewing.Extension#setActive 
 */
Extension.prototype.setActive = function (enable, mode) {
    if (enable) {
        this.activate(mode);
    } else {
        this.deactivate();
    }
};

/**
 * Gets the name of the extension.
 * @returns {string} Returns the name of the extension.
 * @alias Autodesk.Viewing.Extension#getName
 */
Extension.prototype.getName = function () {
    return this.name;
};

/**
 * Gets an array of modes available for the extension.
 * @returns {Array} Returns an array of modes.
 * @alias Autodesk.Viewing.Extension#getModes
 */
Extension.prototype.getModes = function () {
    return this.modes;
};

/**
 * Check if the extension is active and optionally check if the specified mode is active for that extension.
 * @param mode - An optional mode that indicates a different way the extension can function.
 * @see {@link Autodesk.Viewing.Extension#getModes }
 * @returns {boolean} Default - True if the extension is active.
 * When optional argument mode is specified, returns true if both extension and the mode are active, false otherwise.
 * @alias Autodesk.Viewing.Extension#isActive
 */
Extension.prototype.isActive = function (mode) {
    if(mode) {
        return this.activeStatus && this.mode === mode;
    } else {
        return this.activeStatus;
    }
};

/**
 * Gets the extension state as a plain object. Intended to be called when viewer state is requested.
 * @param {object} viewerState - Object to inject extension values.
 * @virtual
 * @alias Autodesk.Viewing.Extension#getState
 */
Extension.prototype.getState = function( viewerState ) {
};

/**
 * Restores the extension state from a given object.
 * @param {object} viewerState - Viewer state.
 * @param {boolean} immediate - Whether the new view is applied with (true) or without transition (false).
 * @returns {boolean} True if restore operation was successful.
 * @virtual
 * @alias Autodesk.Viewing.Extension#restoreState
 */
Extension.prototype.restoreState = function (viewerState, immediate) {
    return true;
};

/**
 * Add localization strings to the viewer. 
 * This method can override localization keys already loaded.
 * There is no API method to remove localization strings added with this method.
 * 
 * @example
 * var locales = {
        en: { my_tooltip: "CUSTOM_TOOLTIP" },
        de: { my_tooltip: "BENUTZERDEFINIERTE_TOOLTIP" }
   };
   ext.extendLocalization(locales);
 *  
 * @param {object} locales The set of localized strings keyed by language
 * @returns {boolean} True if localization was successfully updated
 * @alias Autodesk.Viewing.Extension#extendLocalization
 */
Extension.prototype.extendLocalization = function (locales) {
    return extendLocalization(locales);
};


/**
 * Returns an object that persists throughout an extension's unload->load operation sequence. 
 * Cache object is kept by the {@link Autodesk.Viewing.Viewer3D} instance.
 * Cache object lives only in RAM, there is no localStorage persistence.
 * @returns {object} The cache object for a given extension.
 * @alias Autodesk.Viewing.Extension#getCache
 */
Extension.prototype.getCache = function() {
    if (!this.viewer.extensionCache) {
        this.viewer.extensionCache = {};
    }
    var cache = this.viewer.extensionCache[this.id];
    if (!cache) {
        cache = this.viewer.extensionCache[this.id] = {};
    }
    return cache;
};

/**
 * Invoked after the Toolbar UI gets created. Extensions can extend (or remove) its content from this point forward.
 * The method is invoked after {@link TOOLBAR_CREATED_EVENT} gets fired. 
 * It is also invoked right after {@link Autodesk.Viewing.Extension#load} if the toolbar was already created.
 *
 * Must be overriden by subclasses.
 *
 * @param {Autodesk.Viewing.UI.ToolBar} toolbar - toolbar instance.
 *
 * @alias Autodesk.Viewing.Extension#onToolbarCreated
 */
Extension.prototype.onToolbarCreated = function(toolbar) {
    // no content
};


//Have to export to the global namespace in order for class inheritance
//for non-modular objects to work.
if (typeof Autodesk !== "undefined") {
    Autodesk.Viewing.Extension = Extension;
}
