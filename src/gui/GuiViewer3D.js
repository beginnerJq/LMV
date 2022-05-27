
import * as et from "../application/EventTypes";
import { Prefs } from '../application/PreferenceNames';
import { Viewer3D } from "../application/Viewer3D";
import { getGlobal, isFullscreenEnabled, isMobileDevice, isTouchDevice, touchStartToClick } from "../compat";
import { ErrorCodes, errorCodeString } from "../file-loaders/net/ErrorCodes";
import { setLanguage } from "../globalization/i18init";
import i18n from "i18next";
import { Lang } from "../globalization/langs";
import { getParameterByName } from "../globals";
import { logger } from "../logger/Logger";
import { HotGestureTool } from "../tools/HotGestureTool";
import { AlertBox } from "./AlertBox";
import { Button } from "./controls/Button";
import { ControlGroup } from "./controls/ControlGroup";
import { ErrorHandler } from "./ErrorHandler";
import { SETTINGS_PANEL_CREATED_EVENT, TOOLBAR_CREATED_EVENT } from "./GuiViewerToolbarConst";
import { HudMessage } from "./HudMessage";
import { ProgressBar } from "./ProgressBar";
import { RenderOptionsPanel } from "./RenderOptionsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { ViewerToolBar } from "./toolbar/ViewerToolBar";
import { ViewerSettingsPanel } from "./ViewerSettingsPanel";


    /**
     * Viewer component based on {@link Autodesk.Viewing.Viewer3D} with added UI.
     *
     * @class
     * @param {HTMLElement} container - The viewer container.
     * @param {object} config - The initial settings object. See base class for details.
     * @alias Autodesk.Viewing.GuiViewer3D
     * @augments Autodesk.Viewing.Viewer3D
     */
    export function GuiViewer3D(container, config) {
        if (!config) config = {};

        // Explicitly set startOnInitialize = false, as we want to finish some initialization
        // before starting the main loop.
        //
        config.startOnInitialize = false;

        Viewer3D.call(this, container, config);

        this.toolbar = null;

        // Container for the UI docking panels
        this.dockingPanels = [];

        this.onFullScreenModeEvent = this.onFullScreenModeEvent.bind(this);
        this.onProgressBarUpdate = this.onProgressBarUpdate.bind(this);

    }

    GuiViewer3D.prototype = Object.create(Viewer3D.prototype);
    GuiViewer3D.prototype.constructor = GuiViewer3D;

    GuiViewer3D.prototype.initialize = function (initOptions) {
        var viewerErrorCode = Viewer3D.prototype.initialize.call(this, initOptions);

        if (viewerErrorCode > 0)    // ErrorCode was returned.
        {
            ErrorHandler.reportError(this.container, viewerErrorCode); // Show UI dialog
            return viewerErrorCode;
        }

        var viewer = this;

        // Add padding to bottom to account for toolbar, when calling fitToView()
        // TODO: Use pixel size for setting these.
        //---this.navigation.FIT_TO_VIEW_VERTICAL_OFFSET = 0.03;
        //---this.navigation.FIT_TO_VIEW_VERTICAL_MARGIN = 0.0;

        if (this.toolController) {
            var hottouch = new HotGestureTool(this);

            this.toolController.registerTool(hottouch);

            this.toolController.activateTool(hottouch.getName());
        }

        this.addEventListener(et.FULLSCREEN_MODE_EVENT, this.onFullScreenModeEvent);

        // Context menu
        if (!this.contextMenu) {
            this.setDefaultContextMenu();
        }

        // Create a progress bar. Shows streaming.
        //
        this.progressbar = new ProgressBar(this.container);
        this.addEventListener(et.PROGRESS_UPDATE_EVENT, this.onProgressBarUpdate);

        this.addEventListener(et.VIEWER_RESIZE_EVENT, function (event) {
            viewer.resizePanels();
            viewer.toolbar?.updateToolbarButtons(event.width, event.height);
        });

        this.addEventListener(et.NAVIGATION_MODE_CHANGED_EVENT, function () {
            viewer.toolbar?.updateToolbarButtons(viewer.container.clientWidth, viewer.container.clientHeight);
        });

        this.initEscapeHandlers();

        // Now that all the ui is created, localize it.
        this.localize();

        this.addEventListener( et.WEBGL_CONTEXT_LOST_EVENT, function() {
            // Hide all divs
            var div = this.container;
            var divCount = div.childElementCount;
            for (var i=0; i<divCount; ++i) {
                div.children[i].classList.add('hide-while-context-lost');
            }
            ErrorHandler.reportError(this.container, ErrorCodes.WEBGL_LOST_CONTEXT);
        }.bind(this));

        this.addEventListener( et.WEBGL_CONTEXT_RESTORED_EVENT, function() {
            // Show all divs again
            var div = this.container;
            var divCount = div.childElementCount;
            for (var i=0; i<divCount; ++i) {
                div.children[i].classList.remove('hide-while-context-lost');
            }
            ErrorHandler.dismissError(ErrorCodes.WEBGL_CONTEXT_LOST_EVENT);
        }.bind(this));

        // Now that all of our initialization is done, start the main loop.
        //
        this.run();

        return 0;   // No errors initializing.
    };

    GuiViewer3D.prototype.uninitialize = function () {

        if (this.viewerSettingsPanel) {
            this.viewerSettingsPanel.uninitialize();
            this.viewerSettingsPanel = null;
        }

        if (this.renderoptions) {
            this.renderoptions.uninitialize();
            this.renderoptions = null;
        }

        if (this.viewerOptionButton) {

            this.viewerOptionButton = null;
        }

        this.removeEventListener(et.FULLSCREEN_MODE_EVENT, this.onFullScreenModeEvent);
        this.removeEventListener(et.PROGRESS_UPDATE_EVENT, this.onProgressBarUpdate);

        this.progressbar = null;

        this.debugMenu = null;
        this.modelStats = null;

        // Toolbar
        this.toolbar = null;

        Viewer3D.prototype.uninitialize.call(this);
    };

    GuiViewer3D.prototype.setUp = function (config) {
        if (!config) config = {};

        // Explicitly set startOnInitialize = false, as we want to finish some initialization
        // before starting the main loop.
        //
        config.startOnInitialize = false;

        Viewer3D.prototype.setUp.call(this, config);
    };

    GuiViewer3D.prototype.tearDown = function (isUnloadModelsWanted) {

        //TODO: this is unorthodox order of destruction, but we
        //need to call the super first so it unloads the extensions,
        //which need the GUI. We need to resolve this somehow.
        Viewer3D.prototype.tearDown.call(this, isUnloadModelsWanted);


        if (this.toolbar) {
            this.toolbar.container.parentNode.removeChild(this.toolbar.container);
            this.toolbar = null;
        }

        if (this.viewerSettingsPanel) {
            this.setSettingsPanel(null);
        }

        if (this.renderoptions) {
            this.removePanel(this.renderoptions);
            this.renderoptions.uninitialize();
            this.renderoptions = null;
        }

        this.debugMenu = null;

        this.removeEventListener(et.GEOMETRY_LOADED_EVENT, this.checkGeometry);
        this.checkGeometry = null;
    };

    /**
     * Invokes extension's `onToolbarCreated` before `EXTENSION_LOADED_EVENT` gets fired.
     *
     * @param extension
     * @private
     */
    GuiViewer3D.prototype.onPostExtensionLoad = function(extension) {
        var toolbar = this.getToolbar();
        if (toolbar && extension.onToolbarCreated) {
            extension.onToolbarCreated(toolbar);
        }

        this.toolbar?.updateToolbarButtons(this.container.clientWidth, this.container.clientHeight);
    };

    GuiViewer3D.prototype.loadModel = function (url, options, onSuccessCallback, onErrorCallback, initAfterWorker) {

        var viewer = this;

        /**
         * @param model
         * @private
         */
        function createUI(model) {
            if (!viewer.running) {
                logger.error("createUI expects the viewer to be running.", errorCodeString(ErrorCodes.VIEWER_INTERNAL_ERROR));
                return;
            }
            viewer.createUI(model);
        }

        /**
         * @param model
         * @private
         */
        function onSuccessChained(model) {

            //TODO: The exact timeout needs to be tuned for best
            //CPU utilization and shortest frame length during startup.
            setTimeout(function() {
                // Create UI when model is ready (except for headless and background loading)
                const skipCreateUI = options && (options.loadAsHidden || options.headlessViewer);

                if (!skipCreateUI) {
                    createUI(model);
                }

                if (onSuccessCallback)
                    onSuccessCallback.call(onSuccessCallback, model);
            }, 1);
        }

        /**
         * @param errorCode
         * @private
         */
        function onFailureChained(errorCode) {
            if (errorCode !== ErrorCodes.LOAD_CANCELED) {
                ErrorHandler.reportError(viewer.container, errorCode); // Show UI dialog
            } else {
                logger.warn('A load was canceled');
            }
            onErrorCallback && onErrorCallback.apply(onErrorCallback, arguments);
        }

        var res = Viewer3D.prototype.loadModel.call(this, url, options, onSuccessChained, onFailureChained, initAfterWorker);

        return res;
    };

    GuiViewer3D.prototype.createUI = function (model, force) {
        // We only support UI for initially loaded model.
        if (this.model !== model && !force) {
            return;
        }

        var viewer = this;
        const newToolbarCreated = this._createToolbar();

        this.checkGeometry = function (event) {
            // When force==false, the function is called once, for the first loaded model
            // When force==true, the function is called once for every model, in the order they are loaded

            //Delay this to the next frame so that the current frame can render fast and display the geometry.
            setTimeout(function() {

                // The view may have been reconfigured to 2d meanwhile.
                if (viewer.impl.is2d) {
                    return;
                }

                // Piggybacking on handler to handle empty models (rare case)
                //
                // Note that in an aggregated view, viewer.model may be temporarily null, e.g.,
                //  a) if the view was just switched and the models for the new view are not loaded yet
                //  b) if visibility was toggled off for all models by the user
                // In this case, we don't want to report an error.
                if (event.model && !event.model.hasGeometry()) {
                    var errorCode = ErrorCodes.BAD_DATA_MODEL_IS_EMPTY;
                    var errorMsg  = "Model is empty";
                    ErrorHandler.reportError(viewer.container, errorCode, errorMsg);
                    viewer._loadingSpinner.hide();
                }
            }, 1);
        };

        var disabledExtensions = this.config.disabledExtensions || {};
        const canEnableExt = (id) => {
            const extsDisabledByProfile = this.profile && this.profile.extensions.unload ? this.profile.extensions.unload : [];
            return extsDisabledByProfile.indexOf(id) === -1;
        };

        this.initModelTools(model);

        //Optional rendering options panel + button
        if (getGlobal().ENABLE_DEBUG) {
            this.initDebugTools();
        }

        //load debug ext by query param
        //duped from Viewer3D as a workaround for adsk viewer site
        var debugConfig = getParameterByName("lmv_viewer_debug");
        if (debugConfig === "true") {
            this.loadExtension("Autodesk.Debug", this.config);
        }

        // Unload extension if it is loaded.
        var makeSureUnloaded = function(extId) {
            var ext = viewer.getExtension(extId);
            if (ext) {
                viewer.unloadExtension(extId);
            }
        };

        // When switching from 3D to 2d, unload all automatically loaded 3D-only extensions before triggering onToolbarCreated()
        if (model.is2d()) {
            makeSureUnloaded('Autodesk.BimWalk');
            makeSureUnloaded('Autodesk.Section');
            makeSureUnloaded('Autodesk.Viewing.FusionOrbit');
            makeSureUnloaded('Autodesk.Explode');
        }

        // If measure extension will be automatically loaded, unload any previous one first.
        // This makes sure that the measure extension UI is properly configured for 2D/3D.
        if (!disabledExtensions.measure) {
            makeSureUnloaded('Autodesk.Measure');
        }

        if (newToolbarCreated) {
            // Dispatch a toolbar created event
            this.dispatchEvent({type: TOOLBAR_CREATED_EVENT});
            // Notify extensions
            this.forEachExtension((ext) => {
                ext.onToolbarCreated && ext.onToolbarCreated(this.toolbar);
            });
        }

        // Load or update navtools extension
        var navExtName = 'Autodesk.DefaultTools.NavTools';
        var navExt     = this.getExtension(navExtName);
        if (navExt) {
            // If already loaded, just make sure that it is properly configured
            navExt.updateUI(model.is3d());
        } else {
            this.loadExtension(navExtName, viewer.config);
        }

        this.resize();

        if (model.is2d()) {

            // Make pan a default navigation tool.
            this.setDefaultNavigationTool("pan");

            // Make sure view cube and click to set COI are disabled (but don't update the preferences)
            this.setClickToSetCOI(false, false);

            //Load relevant extensions (on the next frame, since creating the UI is already too slow)
            setTimeout(function(){
                const ext2d = {
                    viewcube: 'Autodesk.ViewCubeUi',
                    measure: 'Autodesk.Measure',
                    hyperlink: 'Autodesk.Hyperlink',
                    layerManager: 'Autodesk.LayerManager',
                    propertiesPanel: 'Autodesk.PropertiesManager',
                };

                // Do not load BoxSelection on mobile devices.
                if (!isMobileDevice()) {
                    ext2d.boxSelection = 'Autodesk.BoxSelection';
                }

                for (let key in ext2d) {
                    const extId = ext2d[key];
                    if (!disabledExtensions[key] && canEnableExt(extId)) {
                        viewer.loadExtension(extId, viewer.config);
                    }
                }
            }, 1);

        } else {
            // Make orbit a default navigation tool.
            if (this.getDefaultNavigationToolName().indexOf("orbit") === -1)
                this.setDefaultNavigationTool("orbit");

            //Load relevant extensions (on the next frame, since creating the UI is already too slow)
            setTimeout(function() {

                const ext3d = {
                    viewcube: 'Autodesk.ViewCubeUi',
                    explode: 'Autodesk.Explode',
                    bimwalk: 'Autodesk.BimWalk',
                    fusionOrbit: 'Autodesk.Viewing.FusionOrbit',
                    measure: 'Autodesk.Measure',
                    section: 'Autodesk.Section',
                    layerManager: 'Autodesk.LayerManager',
                    modelBrowser: 'Autodesk.ModelStructure',
                    propertiesPanel: 'Autodesk.PropertiesManager'
                };

                // Do not load BoxSelection on mobile devices.
                if (!isMobileDevice()) {
                    ext3d.boxSelection = 'Autodesk.BoxSelection';
                }

                for (let key in ext3d) {
                    const extId = ext3d[key];
                    if (!disabledExtensions[key] && canEnableExt(extId)) {
                        viewer.loadExtension(extId, viewer.config);
                    }
                }

                // if (!disabledExtensions.hyperlink) {
                //     viewer.loadExtension('Autodesk.Hyperlink', viewer.config);
                // }

                if (!disabledExtensions.scalarisSimulation && canEnableExt('Autodesk.Viewing.ScalarisSimulation')) {
                    // Note that viewer.model might be null if it was removed between createUI and timeout trigger.
                    if (viewer.model && viewer.model.isScalaris) {
                        viewer.loadExtension('Autodesk.Viewing.ScalarisSimulation', viewer.config);
                    }
                }
            }, 1);

            if (model.isLoadDone()) {
                this.checkGeometry({ model });
            } else {
                this.addEventListener(et.GEOMETRY_LOADED_EVENT, this.checkGeometry, { once: true });
            }
        }
    };

    GuiViewer3D.prototype.onFullScreenModeEvent = function(event) {
        this.resizePanels();
        this.toolbar.updateFullscreenButton(event.mode);
    };

    GuiViewer3D.prototype.onProgressBarUpdate = function(event) {
        if (event.percent >= 0) {
            this.progressbar.setPercent(event.percent);
        }
    };

    
    // "tooltip" string is localized by this method.
    GuiViewer3D.prototype.addOptionToggle = function (parent, tooltip, initialState, onchange, saveKey) {

        // Use the stored settings or defaults
        var storedState = saveKey ? this.prefs[saveKey] : null;
        initialState = (typeof storedState === 'boolean') ? storedState : initialState;

        let _document = this.getDocument();
        var li = _document.createElement("li");
        li.className = "toolbar-submenu-listitem";

        var cb = _document.createElement("input");
        cb.className = "toolbar-submenu-checkbox";
        cb.type = "checkbox";
        cb.id = tooltip;
        li.appendChild(cb);

        var lbl = _document.createElement("label");
        lbl.setAttribute('for', tooltip);
        lbl.setAttribute("data-i18n", tooltip);
        lbl.textContent = i18n.t(tooltip);
        li.appendChild(lbl);

        parent.appendChild(li);

        cb.checked = initialState;

        cb.addEventListener("touchstart", touchStartToClick);
        lbl.addEventListener("touchstart", touchStartToClick);
        li.addEventListener("touchstart", touchStartToClick);

        cb.addEventListener("click", function (e) {
            onchange(cb.checked);
            e.stopPropagation();
        });

        lbl.addEventListener("click", function (e) {
            e.stopPropagation();
        });

        li.addEventListener("click", function (e) {
            onchange(!cb.checked);
            e.stopPropagation();
        });

        if (saveKey) {
            this.prefs.addListeners(saveKey, function (value) {
                cb.checked = value;
            }, function (value) {
                cb.checked = value;
                onchange(value);
            });
        }
        return cb;
    };

    // "label" string will be converted to localized string by this method
    GuiViewer3D.prototype.addOptionList = function (parent, label, optionList, initialIndex, onchange, saveKey) {

        // Use the stored settings or defaults
        var storedState = this.prefs[saveKey];
        initialIndex = (typeof storedState === 'number') ? storedState : initialIndex;

        // Wrap the onchange with the update to that setting
        var handler = function (e) {
            var selectedIndex = e.target.selectedIndex;
            onchange(selectedIndex);
            e.stopPropagation();
        };

        let _document = this.getDocument();
        var selectElem = _document.createElement("select");
        selectElem.className = 'option-drop-down';
        selectElem.id = "selectMenu_" + label;
        for (var i = 0; i < optionList.length; i++) {
            var item = _document.createElement("option");
            item.value = i;
            item.setAttribute("data-i18n", optionList[i]);
            item.textContent = i18n.t(optionList[i]);
            selectElem.add(item);
        }

        var li = _document.createElement("li");
        li.className = "toolbar-submenu-select";

        var lbl = _document.createElement("div");
        lbl.className = "toolbar-submenu-selectlabel";
        lbl.setAttribute('for', label);
        lbl.setAttribute("data-i18n", label);
        lbl.textContent = i18n.t(label);
        li.appendChild(lbl);
        li.appendChild(selectElem);

        parent.appendChild(li);

        selectElem.selectedIndex = initialIndex;
        selectElem.onchange = handler;
        selectElem.addEventListener("touchstart", function (e) {
            e.stopPropagation();
        });
        selectElem.addEventListener("click", function (e) {
            e.stopPropagation();
        });

        if (saveKey) {
            this.prefs.addListeners(saveKey, function (value) {
                selectElem.selectedIndex = value;
            }, function (value) {
                selectElem.selectedIndex = value;
                onchange(value);
            });
        }

        return selectElem;
    };

    GuiViewer3D.prototype.showViewer3dOptions = function (show) {
        var settingsPanel = this.getSettingsPanel(true);
        if (show && settingsPanel.isVisible()) {
            settingsPanel.setVisible(false);
        }
        settingsPanel.setVisible(show);
    };

    GuiViewer3D.prototype.showRenderingOptions = function (show) {
        if (show) {
            this._createRenderingOptionsPanel();
        }
        this.renderoptions && this.renderoptions.setVisible(show);
    };

    /**
     * @private
     */
    GuiViewer3D.prototype._createRenderingOptionsPanel = function () {

        if (this.renderoptions || this.model.is2d())
            return;

        // panel
        this.renderoptions = new RenderOptionsPanel(this);
        this.addPanel(this.renderoptions);

        // toolbar button
        this.toolbar.initRenderOptionsButton();
    };

    GuiViewer3D.prototype.showLayerManager = function () {
        logger.warn('viewer.showLayerManager() is now handled the extension "Autodesk.LayerManager" and will be removed in version 8.0.0.');
    };

    /**
     * TODO: Remove on version 8.0.0
     *
     * @deprecated
     * @private
     */
    GuiViewer3D.prototype.initHotkeys = function () {
        // TODO: remove function on version 8.0.0
        logger.warn('viewer.initHotkeys() has been deprecated and will be removed in version 8.0.0.');
    };



    /**
     * Deprecated: Use {@link Autodesk.Viewing.Extensions.ModelStructureExtension} api. Will be removed in (v8.0.0).
     *
     * Sets the model structure panel for displaying the loaded model.
     *
     * @param {Autodesk.Viewing.UI.ModelStructurePanel} modelStructurePanel - The model structure panel to use, or null.
     * @returns {boolean} True if the panel, or null, was set successfully; false otherwise.
     *
     * @deprecated
     */
    GuiViewer3D.prototype.setModelStructurePanel = function (modelStructurePanel) {
        logger.warn('viewer.setModelStructurePanel() is deprecated and will be removed in v8.0.0 - Use extension "Autodesk.ModelStructure".');
        
        var ext = this.getExtension('Autodesk.ModelStructure');
        if (!ext)
            return false;

        return ext.setModelStructurePanel(modelStructurePanel);
    };

    /**
     * Sets the layers panel for display 2d layers.
     *
     * @param {Autodesk.Viewing.UI.LayersPanel} layersPanel - The layers panel to use, or null.
     */
    GuiViewer3D.prototype.setLayersPanel = function () {
        logger.warn('viewer.setLayersPanel() is now handled the extension "Autodesk.LayerManager" and will be removed in version 8.0.0.');
    };

    /**
     * @param propertyPanel
     * @private
     * @deprecated
     */
    GuiViewer3D.prototype.setPropertyPanel = function (propertyPanel) {
        logger.warn('viewer.setPropertyPanel() is now handled by extension "Autodesk.PropertiesManager" and will be removed in version 8.0.0.');
        var ext = this.getExtension('Autodesk.PropertiesManager');
        if (!ext)
            return false;
        return ext.setPanel(propertyPanel);
    };

    /**
     * @param createDefault
     * @deprecated
     * @private
     */
    GuiViewer3D.prototype.getPropertyPanel = function (createDefault) {
        logger.warn('viewer.getPropertyPanel() is now handled the extension "Autodesk.PropertiesManager" and will be removed in version 8.0.0.');
        var ext = this.getExtension('Autodesk.PropertiesManager');
        if (!ext && createDefault) {
            this.loadExtension('Autodesk.PropertiesManager'); // Loads syncronously
            ext = this.getExtension('Autodesk.PropertiesManager');
        }
        return ext ? ext.getPanel() : null;
    };


    /**
     * Sets the viewer's settings panel.
     *
     * @param {Autodesk.Viewing.UI.SettingsPanel} settingsPanel - The settings panel to use, or null.
     * @returns {boolean} True if the panel or null was set successfully, and false otherwise.
     */
    GuiViewer3D.prototype.setSettingsPanel = function (settingsPanel) {
        var self = this;
        if (settingsPanel instanceof SettingsPanel || !settingsPanel) {
            if (this.viewerSettingsPanel ) {
                this.viewerSettingsPanel.setVisible(false);
                this.removePanel(this.viewerSettingsPanel);
                this.viewerSettingsPanel.uninitialize();
            }

            this.viewerSettingsPanel = settingsPanel;
            if (settingsPanel) {
                this.addPanel(settingsPanel);

                settingsPanel.addVisibilityListener(function (visible) {
                    if (visible) {
                        self.onPanelVisible(settingsPanel, self);
                    }
                    self.toolbar?.viewerOptionButton.setState(visible ? Button.State.ACTIVE : Button.State.INACTIVE);
                });
            }
            return true;
        }
        return false;
    };

    GuiViewer3D.prototype.getSettingsPanel = function (createDefault, model) {
        if (!this.viewerSettingsPanel && createDefault) {
            this.createSettingsPanel(model || this.model);
        }
        return this.viewerSettingsPanel;
    };

    GuiViewer3D.prototype.createSettingsPanel = function (model) {
        var settingsPanel = new ViewerSettingsPanel(this, model);
        this.setSettingsPanel(settingsPanel);
        settingsPanel.syncUI();


        this.toolbar.initSettingsOptionsButton();


        this.dispatchEvent({type: SETTINGS_PANEL_CREATED_EVENT});
    };

    GuiViewer3D.prototype.initModelTools = function (model) {
        // New viewer options' panel
        this.createSettingsPanel(model);

        if (getGlobal().ENABLE_DEBUG) {
            this._createRenderingOptionsPanel();
        }

        

        // LMV-5562 do not show the full screen button if document.fullscreenEnabled is set to false.
        if (this.canChangeScreenMode() && isFullscreenEnabled(this.getDocument())) {
            this.toolbar.initModelTools();
            this.toolbar.updateFullscreenButton(this.getScreenMode());
        }
    };

    /**
     * @param onSelect
     * @private
     * @deprecated
     */
    GuiViewer3D.prototype.setPropertiesOnSelect = function (onSelect) {
        logger.warn('viewer.setPropertiesOnSelect() is now handled by viewer.prefs.set("openPropertiesOnSelect", <boolean>) and will be removed in version 8.0.0.');
        this.prefs.set(Prefs.OPEN_PROPERTIES_ON_SELECT, onSelect);
    };

    GuiViewer3D.prototype.addDivider = function (parent) {
        let _document = this.getDocument();
        var item = _document.createElement("li");
        item.className = "toolbar-submenu-horizontal-divider";
        parent.appendChild(item);
        return item;
    };

    GuiViewer3D.prototype.initDebugTools = function () {

        if (this.debugMenu)
            return false;

        var debugGroup = new ControlGroup('debugTools');
        this.debugMenu = debugGroup;

        // Create the debug submenu button and attach submenu to it.
        var debugButton = new Button('toolbar-debugTool');
        debugButton.setIcon("adsk-icon-bug");
        debugGroup.addControl(debugButton);
        this.debugMenu.debugSubMenuButton = debugButton;

        this.createDebugSubmenu(this.debugMenu.debugSubMenuButton);

        this.toolbar.addControl(debugGroup);
        return true;
    };

    GuiViewer3D.prototype.removeDebugTools = function() {
        if (!this.debugMenu)
            return;

        this.debugMenu.removeFromParent();
        this.debugMenu = null;
    };

    GuiViewer3D.prototype.createDebugSubmenu = function (button) {
        // TODO: Refactor into a control
        var viewer = this;

        var _document = this.getDocument();
        var subMenu = _document.createElement('div');
        subMenu.id = 'toolbar-debugToolSubmenu';
        subMenu.classList.add('toolbar-submenu');
        subMenu.classList.add('toolbar-settings-sub-menu');
        subMenu.classList.add('adsk-hidden');

        this.debugMenu.subMenu = subMenu;
        this.debugMenu.subMenu.style.minWidth = "180px";

        // Temp connect to the main container to calculate the correct width
        this.container.appendChild(subMenu);

        this.initModelStats();
        this.addDivider(subMenu);

        // Add the language setting
        this.addDivider(subMenu);
        var langs = Lang.getLanguages();
        var langNames = langs.map(function(elem) { return elem.label; });
        var langSymbols = langs.map(function(elem) { return elem.symbol; });

        /**
         *
         */
        function setLanguageCB() {
            viewer.localize();
        }

        var initialSelection = viewer.selectedLanguage ? viewer.selectedLanguage : 0;
        var langList = this.addOptionList(subMenu, "Language", langNames, initialSelection, function (selectedIndex) {
            var langSymb = langSymbols[selectedIndex];
            viewer.selectedLanguage = selectedIndex;
            setLanguage(langSymb, setLanguageCB);
        }, null);
        langList.parentNode.style.paddingBottom = "15px";

        // Add display of errors
        this.addDivider(this.debugMenu.subMenu);
        var errorNames = ["UNKNOWN FAILURE", "BAD DATA", "NETWORK ERROR", "NETWORK ACCESS DENIED",
            "NETWORK FILE NOT FOUND", "NETWORK SERVER ERROR", "NETWORK UNHANDLED RESPONSE CODE",
            "BROWSER WEBGL NOT SUPPORTED", "BAD DATA NO VIEWABLE CONTENT"];

        var errorList = this.addOptionList(subMenu, "Error", errorNames, 0, function (errorIndex) {
            var errorCode = errorIndex + 1;
            ErrorHandler.reportError(viewer.container, errorCode, "");
        }, null);
        errorList.parentNode.style.paddingBottom = "15px";

        var subMenuBounds = subMenu.getBoundingClientRect();
        this.debugMenu.subMenu.style.width = subMenuBounds.width + "px";
        this.container.removeChild(subMenu);
        button.container.appendChild(subMenu);

        // Check if the menu fits on the right site and if not, adjust the right edge.
        var right = subMenuBounds.left + subMenuBounds.width;
        var rightBoundary = this.container.getBoundingClientRect().right;
        if (right > rightBoundary) {
            var leftAdjustment = -(right - rightBoundary + 10) + "px";
            this.debugMenu.subMenu.style.left = leftAdjustment;
        }

        button.onMouseOver = function () {
            subMenu.classList.remove('adsk-hidden');
        };

        button.onMouseOut = function () {
            subMenu.classList.add('adsk-hidden');
        };

        if (isTouchDevice()) {
            button.onClick = function () {
                subMenu.classList.toggle('adsk-hidden');
            };
        }
    };

    GuiViewer3D.prototype.initModelStats = function () {

        var self = this;

        /**
         * @param message
         */
        function updateModelStatContent(message) {
            var viewer = self.impl;
            var text = "";
            var model = self.model;
            if (model) {
                text += "Geom&nbsp;polys:&nbsp;" + viewer.modelQueue().getGeometryList().geomPolyCount + "<br>";
                text += "Instance&nbsp;polys:&nbsp;" + viewer.modelQueue().getGeometryList().instancePolyCount + "<br>";
                text += "Fragments:&nbsp;" + viewer.modelQueue().getFragmentList().getCount() + "<br>";
                text += "Geoms:&nbsp;" + viewer.modelQueue().getGeometryList().geoms.length + "<br>";
                text += "Loading&nbsp;time:&nbsp;" + (viewer.model.loader.loadTime/1000).toFixed(2) + " s" + "<br>";
            }
            text += "# " + (message || "");

            self.modelStats.innerHTML = text;
        }

        // On progress update debug text.
        //
        /**
         *
         */
        function createModelStats() {
            let _document = self.getDocument();
            self.modelStats = _document.createElement("div");
            self.modelStats.className = "statspanel";
            self.container.appendChild(self.modelStats);

            self.addEventListener(et.PROGRESS_UPDATE_EVENT, function (e) {
                if (e.message) {
                    updateModelStatContent(e.message);
                }
            });


            self.fpsDisplay = _document.createElement("div");
            self.fpsDisplay.className = "fps";
            self.container.appendChild(self.fpsDisplay);
        }

        this.addOptionToggle(this.debugMenu.subMenu, "Model statistics", false, function (checked) {

            if (checked && !self.modelStats) {
                createModelStats();
                updateModelStatContent("");
            }

            self.modelStats.style.visibility = (checked ? "visible" : "hidden");
            self.fpsDisplay.style.visibility = (checked ? "visible" : "hidden");

            if (checked) {
                self.impl.fpsCallback = function(fps) {
                    self.fpsDisplay.textContent = "" + (0|fps);
                };
            } else {
                self.impl.fpsCallback = null;
            }
        });

    };

    GuiViewer3D.prototype.initEscapeHandlers = function () {
        var viewer = this;

        this.addEventListener(et.ESCAPE_EVENT, function () {
            if (viewer.contextMenu && viewer.contextMenu.hide()) {
                return;
            }

            // Render options isn't enabled in release, so don't try to manipulate it
            if (viewer.renderoptions) {
                // Close render settings panel
                if (viewer.renderoptions.isVisible()) {
                    viewer.renderoptions.setVisible(false);
                    return;
                }
            }

            // TODO: stop any active animation
            
            // Deselect
            if (viewer.impl.selector.hasSelection()) {
                viewer.clearSelection();
                return;
            }

            // Reset default navigation mode:
            if (viewer.getActiveNavigationTool() !== viewer.getDefaultNavigationToolName()) {
                // Force unlock active tool:
                if (viewer.toolController)
                    viewer.toolController.setIsLocked(false);

                viewer.setActiveNavigationTool();
                HudMessage.dismiss();
                return;
            }

            // Show all if anything is hidden
            if (!viewer.areAllVisible()) {
                viewer.showAll();
                return;
            }

            // Close open alert windows
            if (AlertBox.dismiss()) {
                return;
            }

            // Close open windows
            for (var i = 0; i < viewer.dockingPanels.length; ++i) {
                var panel = viewer.dockingPanels[i];
                if (panel.container.style.display !== "none" && panel.container.style.display !== "") {
                    panel.setVisible(false);
                    return;
                }
            }

            if (viewer.escapeScreenMode()) {
                return;
            }
        });
    };

    /**
     * Returns a toolbar.
     *
     * @returns {Autodesk.Viewing.UI.ToolBar} Returns the toolbar.
     */
    GuiViewer3D.prototype.getToolbar = function() {
        return this.toolbar;
    };

    GuiViewer3D.prototype._createToolbar = function() {
        
        if (this.toolbar)
            return false;

        const viewer = this;
        this.toolbar = new ViewerToolBar( 'guiviewer3d-toolbar',  {
            globalManager: this.globalManager,
            navigation: this.navigation,
            screenModeDelegate: this.getScreenModeDelegate(),
            onClickFullScreen: viewer.nextScreenMode.bind(viewer),
            onClickRenderOptions: () => {
                var isVisible = this.renderoptions && this.renderoptions.isVisible();
                this.renderoptions.setVisible(!isVisible);
            },
            onClickViewerOption: () => {

                var panel = viewer.getSettingsPanel(true);
                if (!panel.isVisible()) {
                    viewer.showViewer3dOptions(true);
                } else {
                    viewer.showViewer3dOptions(false);
                }
            }
        });

        if (this._forgeLogo) {
            const bb = this._forgeLogo.getBoundingClientRect();
            // Place the toolbar above the forge logo div. 
            this.toolbar.container.style.bottom = `${bb.height + 10}px`;
        }

        this.container.appendChild(this.toolbar.container);

        this.toolbar.updateToolbarButtons(this.container.clientWidth, this.container.clientHeight, this.navigation);

        return true;
    };

    /**
     * Deprecated: Use {@link Autodesk.Viewing.Extensions.ModelStructureExtension} api. Will be removed in (v8.0.0).
     *
     * Sets whether the model browser panel is visible (true) or not (false).
     *
     * @param {boolean} show - true to get the panel visible, false otherwise.
     *
     * @deprecated
     */
    GuiViewer3D.prototype.showModelStructurePanel = function (show) {
        logger.warn('viewer.showModelStructurePanel() is deprecated and will be removed in v8.0.0 - Use extension "Autodesk.ModelStructure".');
        if (show) {
            this.activateExtension('Autodesk.ModelStructure');
        } else {
            this.deactivateExtension('Autodesk.ModelStructure');
        }
    };

    GuiViewer3D.prototype.onPanelVisible = function (panel) {

        // Shift this window to the top of the list, so that it will be closed first
        //
        this.dockingPanels.splice(this.dockingPanels.indexOf(panel), 1);
        this.dockingPanels.splice(0, 0, panel);
    };

    GuiViewer3D.prototype.localize = function () {

        Viewer3D.prototype.localize.call(this);

        if (this.debugMenu && this.debugMenu.debugSubMenuButton) {
            this.debugMenu.debugSubMenuButton.container.removeChild(this.debugMenu.subMenu);
            this.createDebugSubmenu(this.debugMenu.debugSubMenuButton);
        }

        ErrorHandler.localize();
    };


    /**
     * Adds a panel to the viewer. The panel will be moved and resized if the viewer
     * is resized and the panel falls outside of the bounds of the viewer.
     *
     * @param {Autodesk.Viewing.UI.PropertyPanel} panel - The panel to add.
     * @returns {boolean} True if panel was successfully added.
     *
     */
    GuiViewer3D.prototype.addPanel = function(panel) {
        var index = this.dockingPanels.indexOf(panel);
        if(index === -1) {
            this.dockingPanels.push(panel);
            return true;
        }
        return false;
    };

    /**
     * Removes a panel from the viewer. The panel will no longer be moved and
     * resized if the viewer is resized.
     *
     * @param {Autodesk.Viewing.UI.PropertyPanel} panel - The panel to remove.
     * @returns {boolean} True if panel was successfully removed.
     */
    GuiViewer3D.prototype.removePanel = function(panel) {
        var index = this.dockingPanels.indexOf(panel);
        if(index > -1) {
            this.dockingPanels.splice(index, 1);
            return true;
        }
        return false;
    };

    /**
     * Resizes the panels currently held by the viewer.
     *
     * @param {object} [options] - An optional dictionary of options.
     * @param {Array} [options.dockingPanels=all] - A list of panels to resize.
     * @param {object} [options.dimensions] - The area for the panels to occupy.
     * @param {number} options.dimensions.width - Width.
     * @param {number} options.dimensions.height - Height.
     */
    GuiViewer3D.prototype.resizePanels = function (options) {

        options = options || {};

        var toolbarHeight = this.toolbar ? this.toolbar.getDimensions().height : 0;
        var dimensions = this.getDimensions();
        var maxHeight = dimensions.height;

        if (options.dimensions && options.dimensions.height) {
            maxHeight = options.dimensions.height;
        }
        else {
            options.dimensions = {
                height: dimensions.height,
                width: dimensions.width
            };
        }

        options.dimensions.height = maxHeight - toolbarHeight;

        var viewer = this;

        var dockingPanels = options ? options.dockingPanels : null;
        if(!dockingPanels) {
            dockingPanels = viewer.dockingPanels;
        }

        var viewerRect = viewer.container.getBoundingClientRect(),
            vt = viewerRect.top,
            vb = viewerRect.bottom,
            vl = viewerRect.left,
            vr = viewerRect.right,
            vw, vh;

        if (options && options.dimensions) {
            vw = options.dimensions.width;
            vh = options.dimensions.height;
            vb = vt + vh;
        } else {
            vw = viewerRect.width;
            vh = viewerRect.height;
        }

        for (var i = 0; i < dockingPanels.length; ++i) {
            dockingPanels[i].onViewerResize(vt, vb, vl, vr, vw, vh);
        }

    };

    GuiViewer3D.prototype.initExplodeSlider = function () {
        logger.warn('viewer.initExplodeSlider() has been replaced by extension "Autodesk.Explode". initExplodeSlier() will be removed in version 7.0.0.');
    };

    /**
     * Register the function called after updateToolbarButtons. This allows the developer to customize the toolbar layout if needed.
     * The callback will be called with the parameters (viewer_object, panel_width, panel_height). Its return type can be undefied and is ignored.
     *
     * @param {Function} callbackFunction - Callback
     */
    GuiViewer3D.prototype.registerCustomizeToolbarCB = function(callbackFunction) {
        this.toolbar?.registerCustomizeToolbarCB(callbackFunction.bind(null, this));
        this.toolbar?.updateToolbarButtons(this.container.clientWidth, this.container.clientHeight);
    };

    Object.defineProperty(GuiViewer3D.prototype, 'navTools', {
        get() {  return this.toolbar?.navTools; }
    });
    Object.defineProperty(GuiViewer3D.prototype, 'modelTools', {
        get() {  return this.toolbar?.modelTools; }
    });
    Object.defineProperty(GuiViewer3D.prototype, 'settingsTools', {
        get() {  return this.toolbar?.settingsTools; }
    });
    Object.defineProperty(GuiViewer3D.prototype, 'updateFullscreenButton', {
        get() {  return this.toolbar?.updateFullscreenButton.bind(this); }
    });

// Backwards compatibility for pre-v7.0 integrations.
Autodesk.Viewing.Private.GuiViewer3D = GuiViewer3D;
