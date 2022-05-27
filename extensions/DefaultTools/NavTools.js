
import { Extension } from "../../src/application/Extension";
import { TOOL_CHANGE_EVENT, NAVIGATION_MODE_CHANGED_EVENT, CAMERA_CHANGE_EVENT } from "../../src/application/EventTypes";
import { TOOLBAR } from "../../src/gui/GuiViewerToolbarConst";
import { ComboButton } from "../../src/gui/controls/ComboButton";
import { Button } from "../../src/gui/controls/Button";
import { FovTool } from "../../src/tools/FovTool";
import { WorldUpTool } from "../../src/tools/WorldUpTool";
import i18n from "i18next";
import { RadioButtonGroup } from "../../src/gui/controls/RadioButtonGroup";
import { isTouchDevice } from "../../src/compat";
import { HudMessage } from "../../src/gui/HudMessage";


var MODE_PAN = 'pan';
var MODE_DOLLY = 'dolly';
var MODE_FREE_ORBIT = 'freeorbit';
var MODE_ORBIT = 'orbit';
var MODE_FOV = 'fov'; // it's actually just an action.
var MODE_WORLD_UP = 'worldup';
var MODE_FIT_TO_VIEW = 'fittoview';

/**
 * Adds toolbar buttons to Orbit, Pan and Dolly.
 * It also adds camera interaction buttons for Fit to View, Focal Length and Roll
 *
 * The extension id is: `Autodesk.DefaultTools.NavTools`
 *
 * @param {Viewer3D} viewer - Viewer instance
 * @param {object} options - Configurations for the extension
 * @example 
 * viewer.loadExtension('Autodesk.DefaultTools.NavTools')
 * @memberof Autodesk.Viewing.Extensions
 * @alias Autodesk.Viewing.Extensions.NavToolsExtension
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @class
 */
export function NavToolsExtension(viewer, options) {
    Extension.call(this, viewer, options);
    this.name = 'navtools';
    this.modes = [MODE_PAN, MODE_DOLLY, MODE_FREE_ORBIT, MODE_ORBIT, MODE_FOV, MODE_WORLD_UP, MODE_FIT_TO_VIEW];
    this.onToolChanged = this.onToolChanged.bind(this);
    this.onNavigationModeChanged = this.onNavigationModeChanged.bind(this);
    this.navToolsConfig = options.navToolsConfig || {};
}

NavToolsExtension.prototype = Object.create(Extension.prototype);
NavToolsExtension.prototype.constructor = NavToolsExtension;

var proto = NavToolsExtension.prototype;

/**
 * @param self
 * @param button
 * @param mode
 * @private
 */
function createNavToggler(self,button, mode) {
    return function() {
        if (self.isActive(mode)) {
            self.deactivate();
        } else {
            self.activate(mode);
        }
    };
}

proto.load = function() {
    var viewer = this.viewer;

    // Register tools
    var fovtool  = new FovTool(viewer);
    viewer.toolController.registerTool( fovtool );

    if (!this.navToolsConfig.isAECCameraControls) {
        var rolltool = new WorldUpTool(viewer.impl, viewer);
        viewer.toolController.registerTool(rolltool);
    }

    this.initFocalLengthOverlay();

    viewer.addEventListener(TOOL_CHANGE_EVENT, this.onToolChanged);
    viewer.addEventListener(NAVIGATION_MODE_CHANGED_EVENT, this.onNavigationModeChanged);

    return true;
};

// Ensure that toolbar is properly configured for 2d/3d
proto.updateUI = function(is3d) {
    if (is3d !== this.is3d) {
        this._destroyUI();
        this._createUI(is3d);
    }
};

proto.onToolbarCreated = function() {
    var is3d = !this.viewer.impl.is2d;
    this._createUI(is3d);
};

proto.navActionDisplayMode = function(action) {
    return this.viewer.navigation.isActionEnabled(action) ? 'block' : 'none';
};

proto._createUI = function(is3d)
{
    // Adds the UI for the default navigation tools (orbit, pan, dolly, camera controls)
    var viewer = this.viewer;
    var toolbar = viewer.getToolbar();
    var navTools = toolbar.getControl(TOOLBAR.NAVTOOLSID);

    if (is3d) {
        var orbitToolsButton = new ComboButton('toolbar-orbitTools');
        orbitToolsButton.setToolTip('Orbit');
        orbitToolsButton.setIcon("adsk-icon-orbit-constrained");
        orbitToolsButton.setDisplay(this.navActionDisplayMode('orbit'));

        this.createOrbitSubmenu(orbitToolsButton);

        navTools.addControl(orbitToolsButton);
        navTools.orbittoolsbutton = orbitToolsButton;
        orbitToolsButton.setState(Button.State.ACTIVE);

        navTools.returnToDefault = function() {
            orbitToolsButton.setState(Button.State.ACTIVE);
        };
    }

    var panButton = new Button('toolbar-panTool');
    panButton.setToolTip('Pan');
    panButton.setIcon("adsk-icon-pan");
    panButton.onClick = createNavToggler(this, panButton, MODE_PAN);
    panButton.setDisplay(this.navActionDisplayMode('pan'));

    navTools.addControl(panButton);
    navTools.panbutton = panButton;

    if (!is3d) {
        navTools.returnToDefault = function() {
            panButton.setState(Button.State.ACTIVE);
        };
        navTools.returnToDefault(); // Assume 'pan' is the default navigation tool.
    }

    var dollyButton = new Button('toolbar-zoomTool');
    dollyButton.setToolTip('Zoom');
    dollyButton.setIcon("adsk-icon-zoom");
    dollyButton.onClick = createNavToggler(this, dollyButton, MODE_DOLLY);
    dollyButton.setDisplay(this.navActionDisplayMode('zoom'));

    navTools.addControl(dollyButton);
    navTools.dollybutton = dollyButton;

    if (this.navToolsConfig.isAECCameraControls) {
        // AEC applications such as Docs and Design Collaboration only have a need for Fit to View
        navTools.addControl(this.createFitViewButton(navTools));
    } else {
        var cameraButton = new ComboButton('toolbar-cameraSubmenuTool');
        cameraButton.setToolTip('Camera interactions');
        cameraButton.setIcon("adsk-icon-camera");
        cameraButton.saveAsDefault();
        this.createCameraSubmenu(cameraButton, is3d);
        navTools.addControl(cameraButton);
        navTools.camerabutton = cameraButton;
    }

    // remember if we initialized for 3d or 2d
    this.is3d = is3d;
};

proto.createOrbitSubmenu = function(parentButton) {
    var viewer = this.viewer;
    var toolbar = viewer.getToolbar();
    var navTools = toolbar.getControl(TOOLBAR.NAVTOOLSID);

    var freeOrbitButton = new Button('toolbar-freeOrbitTool');
    freeOrbitButton.setToolTip('Free orbit');
    freeOrbitButton.setIcon("adsk-icon-orbit-free");
    freeOrbitButton.onClick = createNavToggler(this, freeOrbitButton,  MODE_FREE_ORBIT);

    parentButton.addControl(freeOrbitButton);
    navTools.freeorbitbutton = freeOrbitButton;

    var orbitButton = new Button('toolbar-orbitTool');
    orbitButton.setToolTip('Orbit');
    orbitButton.setIcon("adsk-icon-orbit-constrained");
    orbitButton.onClick = createNavToggler(this, orbitButton, MODE_ORBIT);

    parentButton.addControl(orbitButton);
    navTools.orbitbutton = orbitButton;

    parentButton.onClick = orbitButton.onClick; // default

};

proto.createFitViewButton = function(navTools, parentButton) {
    //options = { defaultTooltipValue : "Fit to view (F)" };
    var viewer = this.viewer;
    var fitToViewButton = new Button('toolbar-fitToViewTool');
    fitToViewButton.setToolTip('Fit to view');
    fitToViewButton.setIcon("adsk-icon-fit-to-view");
    fitToViewButton.onClick = function() {
        viewer.impl.fitToView(viewer.impl.selector.getAggregateSelection());
        const analytics = Autodesk.Viewing.Private.analytics;
        analytics.track('viewer.fit_to_view', {
            from: 'UI',
        });
        var defaultNavToolName = viewer.getDefaultNavigationToolName();
        viewer.setActiveNavigationTool(defaultNavToolName);
        parentButton && parentButton.restoreDefault();
    };
    fitToViewButton.setDisplay(this.navActionDisplayMode('gotoview'));

    navTools.fittoviewbutton = fitToViewButton;

    return fitToViewButton;
};

proto.createCameraSubmenu = function(parentButton, is3d)
{
    var self = this;
    var viewer = this.viewer;
    var toolbar = viewer.getToolbar();
    var navTools = toolbar.getControl(TOOLBAR.NAVTOOLSID);

    if (isTouchDevice()) {
        var homeButton = new Button('toolbar-homeTool');
        homeButton.setToolTip('Home');
        homeButton.setIcon("adsk-icon-home");
        homeButton.onClick = function () {
            viewer.navigation.setRequestHomeView(true);
            var defaultNavToolName = viewer.getDefaultNavigationToolName();
            self.activate(defaultNavToolName);
            parentButton.restoreDefault();
        };
        homeButton.setDisplay(this.navActionDisplayMode('gotoview'));

        parentButton.addControl(homeButton);
        navTools.homebutton = homeButton;
    }

    parentButton.addControl(this.createFitViewButton(navTools, parentButton));

    if (is3d) {
        //options.defaultTooltipValue = "Focal length (Ctrl+Shift drag)";
        var fovButton = new Button('toolbar-focalLengthTool');
        fovButton.setToolTip('Focal length');
        fovButton.setIcon("adsk-icon-fov");
        fovButton.onClick = createNavToggler(this, fovButton, MODE_FOV);
        fovButton.setDisplay(this.navActionDisplayMode('fov'));

        parentButton.addControl(fovButton);
        navTools.fovbutton = fovButton;
    }

    //options.defaultTooltipValue = "Roll (Alt+Shift drag)";
    var rollButton = new Button('toolbar-rollTool');
    rollButton.setToolTip('Roll');
    rollButton.setIcon("adsk-icon-roll");
    rollButton.onClick = createNavToggler(this,rollButton, MODE_WORLD_UP);
    rollButton.setDisplay(this.navActionDisplayMode('roll'));

    parentButton.addControl(rollButton);
    navTools.rollbutton = rollButton;
};

proto.onToolChanged = function(event) {
    
    if (event.toolName === "fov") {
        this.showFocalLengthOverlay(event.active);
    }

    // Special case for ALT-drag-release
    if (event.active) {
        switch (event.toolName) {
            case "dolly":
                this.handleAltRelease('dollybutton');
                break;
            case "pan":
                this.handleAltRelease('panbutton');
                break;
            case "worldup":
                this.handleAltRelease('rollbutton');
                break;
            case "fov":
                this.handleAltRelease('fovbutton');
                break;
        }
    }
};

proto.onNavigationModeChanged = function(event) {
    var defaultNavToolName = this.viewer.getDefaultNavigationToolName();
    if (defaultNavToolName === event.id) {
        var toolbar = this.viewer.getToolbar();
        if (!toolbar)
            return;
        var navTools = toolbar.getControl(TOOLBAR.NAVTOOLSID);
        if (!navTools)
            return;
        navTools.returnToDefault && navTools.returnToDefault();
    }
};

proto.handleAltRelease = function(buttonName) {
    var toolbar = this.viewer.getToolbar();
    if (!toolbar)
        return;
    var navTools = toolbar.getControl(TOOLBAR.NAVTOOLSID);
    var button = navTools && navTools[buttonName];
    button && button.setState(Button.State.ACTIVE);
};

proto.initFocalLengthOverlay = function() {

    const _document = this.getDocument();
    var container = this.focallength = _document.createElement("div");

    container.classList.add("message-panel");
    container.classList.add("docking-panel");
    container.classList.add("focal-length");
    container.classList.add("docking-panel-container-solid-color-b");

    var table = _document.createElement("table");
    var tbody = _document.createElement("tbody");
    table.appendChild(tbody);

    container.appendChild(table);
    this.viewer.container.appendChild(container);

    var row = tbody.insertRow(-1);
    var cell = row.insertCell(0);
    cell.classList.add("name");
    cell.setAttribute( "data-i18n", "Focal Length" );
    cell.textContent = i18n.t( "Focal Length" );

    cell = row.insertCell(1);
    cell.classList.add("value");
    cell.textContent = '';
    this.fovCell = cell;

    container.style.visibility = "hidden";
};

proto.showFocalLengthOverlay = function(state) {
    var self = this;
    var viewer = this.viewer;
    var myFocalLength = 0;

    /**
     * @param yes
     * @private
     */
    function showFovHudMessage(yes) {
        if( yes ) {
            // Display a hud messages.
            var messageSpecs = {
                "msgTitleKey"   : "Orthographic View Set",
                "messageKey"    : "The view is set to Orthographic",
                "messageDefaultValue" : "The view is set to Orthographic. Changing the focal length will switch to Perspective."
            };
            HudMessage.displayMessage(viewer.container, messageSpecs);
        }
        else {
            HudMessage.dismiss();
        }
    }

    /**
     * @param yes
     * @private
     */
    function showFov(yes) {
        if (yes) updateFOV();

        if( self.focallength )
            self.focallength.style.visibility = yes ? "visible" : "hidden";
    }

    /**
     * @private
     */
    function updateFOV() {
        var camFocalLength = viewer.getFocalLength();
        if( myFocalLength !== camFocalLength )
        {
            myFocalLength = camFocalLength;
            self.fovCell.textContent = camFocalLength.toString() + " mm";
        }
    }

    /**
     * @private
     */
    function watchFOV() {
        updateFOV();
        // If camera changed to ORTHO and we are still in FOV mode
        // put up the warning message that the system will switch to perspective.
        //
        if (viewer.toolController.getActiveToolName() === "fov") {
            var camera = viewer.navigation.getCamera();
            var isOrtho = camera && !camera.isPerspective;

            showFov(!isOrtho);
            showFovHudMessage(isOrtho);
        }
    }
    var camera = viewer.navigation.getCamera();
    var isOrtho = camera && !camera.isPerspective;

    showFov(state && !isOrtho);
    showFovHudMessage(state && isOrtho);

    if( state ) {
        viewer.addEventListener(CAMERA_CHANGE_EVENT, watchFOV);
    }
    else {
        viewer.removeEventListener(CAMERA_CHANGE_EVENT, watchFOV);
    }
};

proto.unload = function () {
    this._destroyUI();

    return true;
};

proto._destroyUI = function () {
    // Removes the UI created in createUI
    var viewer = this.viewer;
    var toolbar = viewer.getToolbar();

    if (!toolbar) {
        return true;
    }

    var navTools = toolbar.getControl(TOOLBAR.NAVTOOLSID);

    if (!navTools) {
        return true;
    }

    /**
     * @param button
     * @private
     */
    function destroyComboButton(button) {
        if (button) {
            button.subMenu.removeEventListener(RadioButtonGroup.Event.ACTIVE_BUTTON_CHANGED, button.subMenuActiveButtonChangedHandler(navTools));
            navTools.removeControl(button.getId());
            button.onClick = null;
        }
    }

    /**
     * @param button
     * @private
     */
    function destroyButton(button) {
        if (button) {
            navTools.removeControl(button.getId());
            button.onClick = null;
        }
    }

    if (this.is3d) {
        destroyComboButton(navTools.orbittoolsbutton);
        navTools.orbittoolsbutton = null;

        destroyButton(navTools.orbitbutton);
        navTools.orbitbutton = null;

        destroyButton(navTools.freeorbitbutton);
        navTools.freeorbitbutton = null;

        destroyButton(navTools.fovbutton);
        navTools.fovbutton = null;
    }

    destroyButton(navTools.panbutton);
    navTools.panbutton = null;

    destroyButton(navTools.dollybutton);
    navTools.dollybutton = null;

    destroyComboButton(navTools.camerabutton);
    navTools.camerabutton = null;

    destroyButton(navTools.rollbutton);
    navTools.rollbutton = null;

    destroyButton(navTools.fittoviewbutton);
    navTools.fittoviewbutton = null;

    if (this.focallength) {
        viewer.container.removeChild(this.focallength);
        this.focallength = null;
    }

    // Remove Listeners
    viewer.removeEventListener(TOOL_CHANGE_EVENT, this.onToolChanged);
    this.onToolChanged = null;
    viewer.removeEventListener(NAVIGATION_MODE_CHANGED_EVENT, this.onNavigationModeChanged);
    this.onNavigationModeChanged = null;

    return true;
};

/**
 * Performs the corresponding button action.
 *
 * @param {string} mode - one of the supported modes, see getModes().
 * 
 * @memberof Autodesk.Viewing.Extensions.NavToolsExtension
 * @alias Autodesk.Viewing.Extensions.NavToolsExtension#activate
 */
proto.activate = function(mode) {
    if (this.isActive(mode)) {
        return false;
    }
    if (mode === MODE_FIT_TO_VIEW) {
        this.viewer.impl.fitToView(this.viewer.impl.selector.getAggregateSelection());
        return true;
    }
    if (this.modes.indexOf(mode) != -1) {
        const defaultTool = this.viewer.getDefaultNavigationToolName();
        // NOTE: Dirty Hack
        // LMV-4998: Set the defaultTool to one of the NavTool if the default navigation tool is set by a different extension.
        if (this.modes.indexOf(defaultTool) === -1) {
            this.viewer.activateDefaultNavigationTools(this.viewer.model.is2d());
        }
        this.viewer.setActiveNavigationTool(mode);
        return true;
    }
    return false;
};

/**
 * Deactivates the current mode and activates the default viewer's navigation tool.
 *
 * @returns {boolean} true when deactivation is successful.
 * 
 * @memberof Autodesk.Viewing.Extensions.NavToolsExtension
 * @alias Autodesk.Viewing.Extensions.NavToolsExtension#deactivate
 */
proto.deactivate = function () {
    this.viewer.setActiveNavigationTool();
    return true;
};

/**
 * Checks whether a specific supported mode is currently active.
 * 
 * @param {string} mode - one of the supported modes.
 * @returns {boolean} true is the mode queried is currently active.
 * 
 * @memberof Autodesk.Viewing.Extensions.NavToolsExtension
 * @alias Autodesk.Viewing.Extensions.NavToolsExtension#isActive
 */
proto.isActive = function (mode) {
    var currMode = this.viewer.getActiveNavigationTool();
    return (currMode === mode);
};

