
import { ScreenMode } from "../../application/ScreenModeDelegate";
import { Button } from "../controls/Button";
import { ControlGroup } from "../controls/ControlGroup";
import { RadioButtonGroup } from "../controls/RadioButtonGroup";
import { TOOLBAR } from "../GuiViewerToolbarConst";
import { ToolBar } from "./ToolBar";
import { GlobalManagerMixin } from '../../application/GlobalManagerMixin';

/**
 * Especialized Viewer toolbar class
 *
 * @alias Autodesk.Viewing.UI.ViewerToolBar
 * @param {string} id - The id for this toolbar.
 * @param {object} [options] - An optional dictionary of options.
 * @param {GlobalManager} [globalManager] - GlobalManager instance object
 * @param {AppScreenModeDeletate} screenModeDelegate - AppScreenModeDelegate instance object
 * @param {function} [onToolbarUpdated] - Callback function for when updating toolbar buttons
 * @param {function} [onClickViewerOption] - On click callback function for 3d options button
 * @param {function} [onClickRenderOptions] - On click callback function for 3d options button
 * @param {function} [onClickFullScreen] - On click callback function for 3d options button
 * @param {Autodesk.Viewing.Navigation} [navigation] - Navigation instance object
 * @class
 * @augments Autodesk.Viewing.UI.ControlGroup
 * @memberof Autodesk.Viewing.UI
 */
export function ViewerToolBar(id, options) {
  if (options?.globalManager) {
    this.setGlobalManager(options.globalManager);
  }
  ToolBar.call(this, id, options);
  this.onToolbarUpdated = options?.onToolbarUpdated || function () { };
  this.screenModeDelegate = options?.screenModeDelegate;
  this.navigation = options?.navigation;
  this.onClickViewerOption = options?.onClickViewerOption || function () { };
  this.onClickRenderOptions = options?.onClickRenderOptions || function () { };
  this.onClickFullScreen = options?.onClickFullScreen || function () { };
  this.navTools = new RadioButtonGroup(TOOLBAR.NAVTOOLSID);
  this.modelTools = new ControlGroup(TOOLBAR.MODELTOOLSID);
  this.settingsTools = new ControlGroup(TOOLBAR.SETTINGSTOOLSID);

  this.addControl(this.navTools);
  this.addControl(this.modelTools);
  this.addControl(this.settingsTools);
}


GlobalManagerMixin.call(ViewerToolBar.prototype);
ViewerToolBar.prototype = Object.create(ToolBar.prototype);
ViewerToolBar.prototype.constructor = ViewerToolBar;

ViewerToolBar.prototype.initRenderOptionsButton = function () {
  if (this.settingsTools && !this.renderOptionsButton) {
    this.renderOptionsButton = new Button('toolbar-renderOptionsTool');
    this.renderOptionsButton.setToolTip('Rendering options');
    this.renderOptionsButton.setIcon("adsk-icon-settings-render");
    this.renderOptionsButton.onClick = this.onClickRenderOptions;
    this.settingsTools.addControl(this.renderOptionsButton);
  }
};

ViewerToolBar.prototype.initSettingsOptionsButton = function () {
  var viewerOptionButton = new Button('toolbar-settingsTool');
  this.viewerOptionButton = viewerOptionButton;
  viewerOptionButton.setIcon("adsk-icon-settings");
  viewerOptionButton.setToolTip("Settings");
  this.viewerOptionButton.onClick = this.onClickViewerOption;
  this.settingsTools.addControl(viewerOptionButton);
};

ViewerToolBar.prototype.initModelTools = function () {
  // LMV-5562 do not show the full screen button if document.fullscreenEnabled is set to false.
  if (!this.settingsTools.fullscreenbutton) {
    var fullscreenButton = new Button('toolbar-fullscreenTool', { collapsible: false });
    fullscreenButton.setToolTip('Full screen');
    fullscreenButton.setIcon("adsk-icon-fullscreen");
    fullscreenButton.onClick = this.onClickFullScreen;
    this.settingsTools.addControl(fullscreenButton);
    this.settingsTools.fullscreenbutton = fullscreenButton;

    this.updateFullscreenButton(this.screenModeDelegate.getMode());
  }
};

ViewerToolBar.prototype.updateFullscreenButton = function (mode) {
  var cls = "adsk-icon-fullscreen";

  switch (mode) {
    case ScreenMode.kNormal:
      if (!this.screenModeDelegate.isModeSupported(ScreenMode.kFullBrowser)) {
        cls = 'adsk-icon-fullscreen';
      }
      break;
    case ScreenMode.kFullBrowser:
      if (this.screenModeDelegate.isModeSupported(ScreenMode.kFullScreen)) {
        cls = 'adsk-icon-fullscreen';
      } else {
        cls = 'adsk-icon-fullscreen-exit';
      }
      break;
    case ScreenMode.kFullScreen:
      cls = 'adsk-icon-fullscreen-exit';
      break;
  }

  this.settingsTools.fullscreenbutton.setIcon(cls);
};

/**
 * Changes visibility of buttons in toolbar to accommodate as many as possible
 * given the available space.  Think of it as a media query applied to the viewer
 * canvas only (as opposed to the whole website).
 *
 * @param {number} width - Width
 * @param {number} height - Height
 */
ViewerToolBar.prototype.updateToolbarButtons = function (width, height) {

  var ctrl, display;

  // 310px threshold
  display = width > 310 ? true : false;
  ctrl = this.modelTools.getControl('toolbar-explodeTool');
  if (ctrl) ctrl.setVisible(display);

  // 380px threshold
  display = width > 380 ? "block" : "none";
  ctrl = this.modelTools.getControl('toolbar-collaborateTool');
  if (ctrl) ctrl.setDisplay(display);

  // 515px threshold
  display = width > 515 ? "block" : "none";
  var camMenu = this.navTools.getControl('toolbar-cameraSubmenuTool');
  if (camMenu) {
    camMenu.setDisplay(display);
    ctrl = camMenu.subMenu.getControl('toolbar-homeTool');
    if (ctrl) ctrl.setDisplay(this.navigation.isActionEnabled('gotoview') ? 'block' : 'none');
    ctrl = camMenu.subMenu.getControl('toolbar-fitToViewTool');
    if (ctrl) ctrl.setDisplay(this.navigation.isActionEnabled('gotoview') ? 'block' : 'none');
    ctrl = camMenu.subMenu.getControl('toolbar-focalLengthTool');
    if (ctrl) ctrl.setDisplay(this.navigation.isActionEnabled('fov') ? 'block' : 'none');
    ctrl = camMenu.subMenu.getControl('toolbar-rollTool');
    if (ctrl) ctrl.setDisplay(this.navigation.isActionEnabled('roll') ? 'block' : 'none');
  }

  // 700px threshold
  display = width > 700 ? "block" : "none";
  ctrl = this.modelTools.getControl('toolbar-measureTool');
  if (ctrl) ctrl.setDisplay(display);
  ctrl = this.modelTools.getControl('toolbar-sectionTool');
  if (ctrl) ctrl.setDisplay(display);

  // 740px threshold
  display = width > 740 ? "block" : "none";
  ctrl = this.navTools.getControl('toolbar-beelineTool');
  if (ctrl) ctrl.setDisplay(this.navigation.isActionEnabled('walk') ? display : 'none');
  ctrl = this.navTools.getControl('toolbar-firstPersonTool');
  if (ctrl) ctrl.setDisplay(this.navigation.isActionEnabled('walk') ? display : 'none');
  ctrl = this.navTools.getControl('toolbar-zoomTool');
  if (ctrl) ctrl.setDisplay(this.navigation.isActionEnabled('zoom') ? display : 'none');
  ctrl = this.navTools.getControl('toolbar-panTool');
  if (ctrl) ctrl.setDisplay(this.navigation.isActionEnabled('pan') ? display : 'none');
  ctrl = this.navTools.getControl('toolbar-orbitTools');
  if (ctrl) ctrl.setDisplay(this.navigation.isActionEnabled('orbit') ? display : 'none');

  this.onToolbarUpdated?.(width, height);
};

/**
 * Register the function called after updateToolbarButtons. This allows the developer to customize the toolbar layout if needed.
 * The callback will be called with the parameters (viewer_object, panel_width, panel_height). Its return type can be undefied and is ignored.
 *
 * @param {Function} callbackFunction - Callback
 */
ViewerToolBar.prototype.registerCustomizeToolbarCB = function (callbackFunction) {
  this.onToolbarUpdated = callbackFunction;
};


