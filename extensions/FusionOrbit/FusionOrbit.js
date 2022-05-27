
import { Extension } from "../../src/application/Extension";
import { TOOLBAR } from "../../src/gui/GuiViewerToolbarConst";
import { Button } from "../../src/gui/controls/Button";
import { FusionOrbitTool } from "./FusionOrbitTool";

import "./FusionOrbit.css"; // IMPORTANT!!

const FREE_ORBIT_MODE = 'fusionfreeorbit';
const ORBIT_MODE = 'fusionorbit';

/**
 * Provides a customization to the orbit tool.
 *
 * The extension id is: `Autodesk.Viewing.FusionOrbit`
 *
 * @param {Viewer3D} viewer - Viewer instance
 * @param {object} options - Configurations for the extension
 * @example 
 * viewer.loadExtension('Autodesk.Viewing.FusionOrbit')
 * @memberof Autodesk.Viewing.Extensions
 * @alias Autodesk.Viewing.Extensions.FusionOrbitExtension
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @class
 */
export function FusionOrbitExtension(viewer, options) {
    Extension.call(this, viewer, options);
    this.name = ORBIT_MODE;
    this.modes = [ORBIT_MODE,FREE_ORBIT_MODE];
}

FusionOrbitExtension.prototype = Object.create(Extension.prototype);
FusionOrbitExtension.prototype.constructor = FusionOrbitExtension;

var proto = FusionOrbitExtension.prototype;

proto.load = function() {
    var viewer = this.viewer;

    this.tool = new FusionOrbitTool();
    this.tool.setViewer(viewer);
    viewer.toolController.registerTool(this.tool);

    this._onToolChanged = this._onToolChanged.bind(this);

    return true;
};

proto._updateActiveState = function(isActive, mode) {
    this.activeStatus = isActive;
    this.mode = mode;
};

 /**
   * Handles the TOOL_CHANGE_EVENT event
   * @param {*} event
   * @private
   */
proto._onToolChanged = function (event) {
    if (event.toolName === 'fusion orbit constrained' || event.toolName === 'fusion orbit') {
        const navTools = this._toolbar.getControl(TOOLBAR.NAVTOOLSID);
        const btn = event.toolName === 'fusion orbit' ? navTools.freeorbitbutton : navTools.orbitbutton;

        const state = event.active ? Button.State.ACTIVE : Button.State.INACTIVE;
        btn.setState(state);
        // This will ensure that the active state of the extension matches the tool. eg. this.isActive('box-selection')
        this._updateActiveState(!state);
    }
};

proto.onToolbarCreated = async function(toolbar)
{
    var self   = this;
    var viewer = this.viewer;
    var navTools = toolbar.getControl(TOOLBAR.NAVTOOLSID);

    if (!navTools || !navTools.orbitbutton) {
        await viewer.loadExtension('Autodesk.DefaultTools.NavTools', viewer.config);
    }

    this._toolbar = toolbar;
    this.viewer.addEventListener(Autodesk.Viewing.TOOL_CHANGE_EVENT, this._onToolChanged);
    
    // save button behaviors, before modifying them
    this.classicBehavior = {};
    this.classicBehavior.orbitOnClick = navTools.orbitbutton.onClick;
    this.classicBehavior.freeorbitOnClick = navTools.freeorbitbutton.onClick;
    this.classicBehavior.returnToDefault = navTools.returnToDefault;

    navTools.freeorbitbutton.onClick = function() {
        var state = navTools.freeorbitbutton.getState();
        if (state === Button.State.INACTIVE) {
            self.activate(FREE_ORBIT_MODE);
        } else if (state === Button.State.ACTIVE) {
            self.deactivate();
        }
    };

    navTools.orbitbutton.onClick = function() {
        var state = navTools.orbitbutton.getState();
        if (state === Button.State.INACTIVE) {
            self.activate(ORBIT_MODE);
        } else if (state === Button.State.ACTIVE) {
            self.deactivate();
        }
    };

    navTools.returnToDefault = function() {
        if (navTools.orbittoolsbutton) {    // can be null when switching sheets
            // clear active button
            navTools.orbittoolsbutton.setState(Button.State.ACTIVE);
        }
    };

    // set combo button
    navTools.orbittoolsbutton.setState(Button.State.INACTIVE);
    if (viewer.prefs.get('fusionOrbitConstrained')) {
        navTools.orbittoolsbutton.onClick = navTools.orbitbutton.onClick;
        navTools.orbittoolsbutton.setIcon(navTools.orbitbutton.iconClass);
        viewer.setDefaultNavigationTool("orbit");
    } else {
        navTools.orbittoolsbutton.onClick = navTools.freeorbitbutton.onClick;
        navTools.orbittoolsbutton.setIcon(navTools.freeorbitbutton.iconClass);
        viewer.setDefaultNavigationTool("freeorbit");
    }

    // reset
    viewer.setActiveNavigationTool();
    navTools.returnToDefault && navTools.returnToDefault();
};

proto.unload = function () {
    
    var viewer = this.viewer;
    
    viewer.removeEventListener(Autodesk.Viewing.TOOL_CHANGE_EVENT, this._onToolChanged);
    
    // restore LMV Classic button behaviors
    if (this.classicBehavior) {
        var toolbar = viewer.getToolbar();
        var navTools = toolbar.getControl(TOOLBAR.NAVTOOLSID);

        if (navTools) {
            if (navTools.orbitbutton)
                navTools.orbitbutton.onClick = this.classicBehavior.orbitOnClick;

            if (navTools.freeorbitbutton)
                navTools.freeorbitbutton.onClick = this.classicBehavior.freeorbitOnClick;

            navTools.returnToDefault = this.classicBehavior.returnToDefault;

            if (navTools.orbittoolsbutton) {    // can be null when switching sheets
                if (navTools.orbitbutton)
                    navTools.orbittoolsbutton.onClick = navTools.orbitbutton.onClick;
                else
                    navTools.orbittoolsbutton.onClick = null;
                navTools.orbittoolsbutton.setIcon("adsk-icon-orbit-constrained");
                navTools.orbittoolsbutton.setState(Button.State.ACTIVE);
            }
        } 
        this.classicBehavior = null;
    }
    
    viewer.setActiveNavigationTool("orbit");
    viewer.setDefaultNavigationTool("orbit");

    // Deregister tool
    viewer.toolController.deregisterTool(this.tool);
    this.tool.setViewer(null);
    this.tool = null;

    this._toolbar = null;

    return true;
};

/**
 * Activates the extension's tool.
 * 
 * @param {string} [mode] - Either 'fusionorbit' (default) or 'fusionfreeorbit'. 
 * 
 * @memberof Autodesk.Viewing.Extensions.FusionOrbitExtension
 * @alias Autodesk.Viewing.Extensions.FusionOrbitExtension#activate
 */
proto.activate = function (mode) {
    if (this.isActive(mode)) {
        return;
    }
    switch (mode) {
        default:
        case ORBIT_MODE:
            this.viewer.setActiveNavigationTool("fusion orbit constrained");
            this.mode = ORBIT_MODE;
            break;
        case FREE_ORBIT_MODE:
            this.viewer.setActiveNavigationTool("fusion orbit");
            this.mode = FREE_ORBIT_MODE;
            break;
    }
    this.activeStatus = true;
    return true;
};

/**
 * Deactivates the extension's tool.
 * 
 * @memberof Autodesk.Viewing.Extensions.FusionOrbitExtension
 * @alias Autodesk.Viewing.Extensions.FusionOrbitExtension#deactivate
 */
proto.deactivate = function () {
    if(this.activeStatus) {
        this.viewer.setActiveNavigationTool();
        this.activeStatus = false;
    }
    return true;
};

