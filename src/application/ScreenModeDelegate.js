/* eslint-disable no-unused-vars */

import { inFullscreen, launchFullscreen, exitFullscreen } from "../compat";
import * as et from "./EventTypes";
import { logger } from "../logger/Logger";

var fsNames = ['fullscreenchange', 'mozfullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange'];

function addListener(listener, globalManager) {
    for (var i=0; i<fsNames.length; ++i)
        globalManager.addDocumentEventListener(fsNames[i], listener, false);
}

function removeListener(listener, globalManager) {
    for (var i=0; i<fsNames.length; ++i)
        globalManager.removeDocumentEventListener(fsNames[i], listener, false);
}


/**
 * List of available screen modes: 
 * - kNormal: 0 
 * - kFullBrowser: 1
 * - kFullScreen: 2
 * @readonly
 * @enum {number}
 * @alias Autodesk.Viewing.ScreenMode
 * @see Autodesk.Viewing.ScreenModeDelegate
 */
export const ScreenMode = {
    /** normal */
    kNormal: 0,
    /** full browser */ 
    kFullBrowser: 1, 
    /** full screen */
    kFullScreen: 2
};


/**
 * Virtual base class for screen mode manipulation.
 *
 * Derive from this class and use it to allow viewer to go full screen.
 * @constructor
 * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer instance.
 * @alias Autodesk.Viewing.ScreenModeDelegate
 */
export function ScreenModeDelegate(viewer) {
    this.viewer = viewer;
    this.bindFullscreenEventListener = this.fullscreenEventListener.bind(this);

    if (this.getMode() === ScreenMode.kFullScreen) {
        addListener(this.bindFullscreenEventListener, this.viewer.globalManager);
    }
}

/**
 * Perform any cleanup required for a {@link Autodesk.Viewing.ScreenModeDelegate} instance.
 */
ScreenModeDelegate.prototype.uninitialize = function () {

    removeListener(this.bindFullscreenEventListener, this.viewer.globalManager);
    this.viewer = null;
};

/**
 * Is screen mode supported?
 * Returning false for normal mode means no screen mode changes are supported.
 * @param {Autodesk.Viewing.ScreenMode} mode - Desired screen mode.
 * @returns {boolean} True if screen mode is supported.
 */
ScreenModeDelegate.prototype.isModeSupported = function (mode) {
    return true;
};

/**
 * Set new screen mode.
 * @param {Autodesk.Viewing.ScreenMode} mode - New screen mode.
 * @returns {boolean} True if screen mode was changed.
 */
ScreenModeDelegate.prototype.setMode = function (mode) {
    var currentMode = this.getMode();
    if ((mode !== currentMode) && this.isModeSupported(mode)) {
        this.doScreenModeChange(currentMode, mode);
        this.onScreenModeChanged(currentMode, mode);
        return true;
    }
    return false;
};

/**
 * Override this method to get the current screen mode.
 * @returns {Autodesk.Viewing.ScreenMode} Current screen mode.
 */
ScreenModeDelegate.prototype.getMode = function () {
    throw 'Implement getMode() in derived class';
};

/**
 * Return next screen mode in sequence.
 * Depending on what modes are supported, this may be a toggle or a 3-state.
 * @returns {Autodesk.Viewing.ScreenMode|undefined} Next screen mode in sequence or undefined if no change.
 */
ScreenModeDelegate.prototype.getNextMode = function () {
    var currentMode = this.getMode(),
        newMode;

    var SM = ScreenMode;

    if (currentMode === SM.kNormal &&
        this.isModeSupported(SM.kFullBrowser)) {

        newMode = SM.kFullBrowser;

    } else if (currentMode === SM.kNormal &&
        this.isModeSupported(SM.kFullScreen)) {

        newMode = SM.kFullScreen;

    } else if (currentMode === SM.kFullBrowser &&
        this.isModeSupported(SM.kFullScreen)) {

        newMode = SM.kFullScreen;

    } else if (currentMode === SM.kFullBrowser &&
        this.isModeSupported(SM.kNormal)) {

        newMode = SM.kNormal;

    } else if (currentMode === SM.kFullScreen &&
        this.isModeSupported(SM.kNormal)) {

        newMode = SM.kNormal;

    } else if (currentMode === SM.kFullScreen &&
        this.isModeSupported(SM.kFullBrowser)) {

        newMode = SM.kFullBrowser;
    }
    return newMode;
};

/**
 * Return new screen mode on escape.
 * @returns {Autodesk.Viewing.ScreenMode|undefined} New screen mode or undefined if no change.
 */
ScreenModeDelegate.prototype.getEscapeMode = function () {
    return (this.getMode() !== ScreenMode.kNormal) ?
        ScreenMode.kNormal : undefined;
};

/**
 * Full screen event listener.
 */
ScreenModeDelegate.prototype.fullscreenEventListener = function () {
    var _document = this.viewer.globalManager.getDocument();
    if (inFullscreen(_document)) {
        this.viewer.resize();
    } else {
        this.doScreenModeChange(ScreenMode.kFullScreen, ScreenMode.kNormal);
        this.onScreenModeChanged(ScreenMode.kFullScreen, ScreenMode.kNormal);
    }
};

/**
 * Override this method to make the screen mode change occur.
 * @param {Autodesk.Viewing.ScreenMode} oldMode - Old screen mode.
 * @param {Autodesk.Viewing.ScreenMode} newMode - New screen mode.
 */
ScreenModeDelegate.prototype.doScreenModeChange = function (oldMode, newMode) {
    throw 'Implement doScreenModeChange() in derived class';
};

/**
 * Called after the screen mode changes.
 * @param {Autodesk.Viewing.ScreenMode} oldMode - Old screen mode.
 * @param {Autodesk.Viewing.ScreenMode} newMode - New screen mode.
 */
ScreenModeDelegate.prototype.onScreenModeChanged = function (oldMode, newMode) {
    if (oldMode === ScreenMode.kFullScreen) {
        removeListener(this.bindFullscreenEventListener, this.viewer.globalManager);
    } else if (newMode === ScreenMode.kFullScreen) {
        addListener(this.bindFullscreenEventListener, this.viewer.globalManager);
    }

    this.viewer.resize();
    this.viewer.dispatchEvent({type: et.FULLSCREEN_MODE_EVENT, mode: newMode});
};





/**
 * Screen mode delegate allowing the viewer to go full screen.
 *
 * Unlike ViewerScreenModeDelegate class, this delegate
 * doesn't use the full browser state, and it takes the entire page full screen, not just
 * the viewer.
 * @constructor
 * @extends Autodesk.Viewing.ScreenModeDelegate
 * @memberof Autodesk.Viewing
 * @alias Autodesk.Viewing.AppScreenModeDelegate
 * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer instance.
 */
export function AppScreenModeDelegate(viewer) {
    ScreenModeDelegate.call(this, viewer);
}

AppScreenModeDelegate.prototype = Object.create(ScreenModeDelegate.prototype);
AppScreenModeDelegate.prototype.constructor = AppScreenModeDelegate;

AppScreenModeDelegate.prototype.isModeSupported = function (mode) {
    return mode !== ScreenMode.kFullBrowser;
};

AppScreenModeDelegate.prototype.getMode = function () {
    var _document = this.viewer.globalManager.getDocument();
    return inFullscreen(_document) ?
        ScreenMode.kFullScreen :
        ScreenMode.kNormal;
};

AppScreenModeDelegate.prototype.doScreenModeChange = function (oldMode, newMode) {
    var container = this.viewer.container;
    if (newMode === ScreenMode.kNormal) {
        container.classList.remove('viewer-fill-browser');
        var _document = this.viewer.globalManager.getDocument();
        exitFullscreen(_document);
    } else if (newMode === ScreenMode.kFullScreen) {
        container.classList.add('viewer-fill-browser');
        launchFullscreen(container);
    }
};

// Keep the old class name for backwards compatibility
export let ApplicationScreenModeDelegate = AppScreenModeDelegate;


/**
 * Screen mode delegate with no full screen functionality.
 * @constructor
 * @extends Autodesk.Viewing.ScreenModeDelegate
 * @memberof Autodesk.Viewing
 * @alias Autodesk.Viewing.NullScreenModeDelegate
 * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer instance.
 */
export function NullScreenModeDelegate(viewer) {
    ScreenModeDelegate.call(this, viewer);
}

NullScreenModeDelegate.prototype = Object.create(ScreenModeDelegate.prototype);
NullScreenModeDelegate.prototype.constructor = ScreenModeDelegate;


NullScreenModeDelegate.prototype.isModeSupported = function () {
    return false; // No screen modes supported
};

NullScreenModeDelegate.prototype.getMode = function () {
    return ScreenMode.kNormal;
};





export function ScreenModeMixin() {
}


ScreenModeMixin.prototype = {

    /**
     * Set new screen mode delegate.
     * @param {Autodesk.Viewing.ScreenModeDelegate} delegate - New screen mode delegate class.
     */
    setScreenModeDelegate : function (delegate) {
        if (this.screenModeDelegate) {
            this.screenModeDelegate.uninitialize();
            this.screenModeDelegate = null;
        }

        // null -> Fullscreen not available
        // undefined -> Use default AppScreenModeDelegate
        //
        if (delegate) {
            this.screenModeDelegateClass = delegate;
        } else if (delegate === null) {
            this.screenModeDelegateClass = NullScreenModeDelegate;
        } else { // undefined
            this.screenModeDelegateClass = AppScreenModeDelegate;
        }
    },

    /**
     * Get current screen mode delegate.
     * If no screen mode delegate has been set, then use {@link Autodesk.Viewing.ViewerScreenModeDelegate}.
     * @returns {Autodesk.Viewing.ScreenModeDelegate} Current screen mode delegate.
     */
    getScreenModeDelegate : function () {
        if (!this.screenModeDelegate) {
            this.screenModeDelegate = new this.screenModeDelegateClass(this);
        }
        return this.screenModeDelegate;
    },


    /**
     * Is specified screen mode supported?
     * @param {Autodesk.Viewing.ScreenMode} mode - Desired screen mode.
     * @returns {boolean} True if screen mode is supported.
     */
    isScreenModeSupported : function (mode) {
        return this.getScreenModeDelegate().isModeSupported(mode);
    },

    /**
     * Is changing screen modes supported?
     * @returns {boolean} True if viewer supports changing screen modes.
     */
    canChangeScreenMode :  function () {
        return this.isScreenModeSupported(Autodesk.Viewing.ScreenMode.kNormal);
    },

    /**
     * Set new screen mode.
     * @param {Autodesk.Viewing.ScreenMode} mode - New screen mode.
     * @returns {boolean} True if screen mode was changed.
     */
    setScreenMode : function (mode) {
        var msg = {
            category: "screen_mode",
            value: mode
        };
        logger.track(msg);

        return this.getScreenModeDelegate().setMode(mode);
    },

    /**
     * Get current screen mode.
     * @returns {Autodesk.Viewing.ScreenMode} Current screen mode.
     */
    getScreenMode : function () {
        return this.getScreenModeDelegate().getMode();
    },

    /**
     * Set screen mode to next in sequence.
     * @returns {boolean} True if screen mode was changed.
     */
    nextScreenMode : function () {
        var mode = this.getScreenModeDelegate().getNextMode();
        return (mode !== undefined) ? this.setScreenMode(mode) : false;
    },

    /**
     * Screen mode escape key handler.
     * @returns {boolean} True if screen mode was changed.
     */
    escapeScreenMode : function () {
        var mode = this.getScreenModeDelegate().getEscapeMode();
        return (mode !== undefined) ? this.setScreenMode(mode) : false;
    },


    apply : function(object) {

        var p = ScreenModeMixin.prototype;
        object.setScreenModeDelegate = p.setScreenModeDelegate;
        object.getScreenModeDelegate = p.getScreenModeDelegate;
        object.isScreenModeSupported = p.isScreenModeSupported;
        object.canChangeScreenMode = p.canChangeScreenMode;
        object.setScreenMode = p.setScreenMode;
        object.getScreenMode = p.getScreenMode;
        object.nextScreenMode = p.nextScreenMode;
        object.escapeScreenMode = p.escapeScreenMode;
    }

};



