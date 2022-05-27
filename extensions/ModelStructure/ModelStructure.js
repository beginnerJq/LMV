
import { Extension } from "../../src/application/Extension";
import { ViewerModelStructurePanel, generateDefaultViewerHandlerOptions } from "../../src/gui/ViewerModelStructurePanel";
import { isMobileDevice } from "../../src/compat";
import { Button } from "../../src/gui/controls/Button";
import * as et from "../../src/application/EventTypes";

const avp = Autodesk.Viewing.Private;


    /**
     * Adds a toolbar button for accessing the Model Browser panel.
     *
     * Use its `activate()` method to open the Model Browser panel.
     * The Model Browser is only available to 3D models.
     *
     * The extension id is: `Autodesk.ModelStructure`
     *
     * {@link Autodesk.Viewing.GuiViewer3D} loads this extension by default.
     *
     * @param {Viewer3D} viewer - Viewer instance
     * @param {object} options - Configurations for the extension
     * @example 
     * viewer.loadExtension('Autodesk.ModelStructure')
     * @memberof Autodesk.Viewing.Extensions
     * @alias Autodesk.Viewing.Extensions.ModelStructureExtension
     * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
     * @class
     */
    export function ModelStructureExtension(viewer, options) {
        Extension.call(this, viewer, options);
        this.viewer = viewer;
        this.options = options;
        this.name = "modelstructure";
        this._modelstructure = null;

        this._onLoadModel = this._onLoadModel.bind(this);
        this._onUnloadModel = this._onUnloadModel.bind(this);
    }
    ModelStructureExtension.prototype = Object.create(Extension.prototype);
    ModelStructureExtension.prototype.constructor = ModelStructureExtension;

    var proto = ModelStructureExtension.prototype;

    /**
     * Invoked automatically when the extension is loaded.
     * 
     * @memberof Autodesk.Viewing.Extensions.ModelStructureExtension
     * @alias Autodesk.Viewing.Extensions.ModelStructureExtension#load
     */
    proto.load = function() {
        this.viewer.addEventListener(et.MODEL_ADDED_EVENT, this._onLoadModel);
        this.viewer.addEventListener(et.MODEL_ROOT_LOADED_EVENT, this._onLoadModel);
        this.viewer.addEventListener(et.MODEL_UNLOADED_EVENT, this._onUnloadModel);
        this.viewer.addEventListener(et.MODEL_REMOVED_EVENT, this._onUnloadModel);
        return true;
    };

    /**
     * Invoked automatically when the extension is unloaded.
     * 
     * @memberof Autodesk.Viewing.Extensions.ModelStructureExtension
     * @alias Autodesk.Viewing.Extensions.ModelStructureExtension#unload
     */
    proto.unload = function() {
        this.deactivate();
        this.setModelStructurePanel(null);
        if (this._structureButton) {
            this.viewer.settingsTools.removeControl(this._structureButton);
            this.viewer.settingsTools.structurebutton = null;
            this._structureButton = null;
        }
        this.viewer.removeEventListener(et.MODEL_ADDED_EVENT, this._onLoadModel);
        this.viewer.removeEventListener(et.MODEL_ROOT_LOADED_EVENT, this._onLoadModel);
        this.viewer.removeEventListener(et.MODEL_UNLOADED_EVENT, this._onUnloadModel);
        this.viewer.removeEventListener(et.MODEL_REMOVED_EVENT, this._onUnloadModel);
        return true;
    };


    /**
     * Invoked after the Toolbar UI gets created. Adds toolbar button.
     *
     * @param {Autodesk.Viewing.UI.ToolBar} toolbar - toolbar instance.
     *
     * @alias Autodesk.Viewing.Extensions.ModelStructureExtension#onToolbarCreated
     */
    proto.onToolbarCreated = function() {
        
        // Toolbar button
        const structureButton = new Button('toolbar-modelStructureTool');
        structureButton.setToolTip('Model browser');
        structureButton.setIcon("adsk-icon-structure");
        structureButton.onClick = () => {
            var newVisible = !this._modelstructure.isVisible();
            if (newVisible) {
                this.activate();
            } else {
                this.deactivate();
            }
        };

        const settingTools = this.viewer.settingsTools;
        settingTools.addControl(structureButton, {index: 0});
        settingTools.structurebutton = structureButton; // legacy... remove in v8.0
        this._structureButton = structureButton;

        // Panel instance 
        this.restoreDefaultPanel();
    };


    /**
     * Opens the Model Browser UI.
     * 
     * @memberof Autodesk.Viewing.Extensions.ModelStructureExtension
     * @alias Autodesk.Viewing.Extensions.ModelStructureExtension#activate
     */
    proto.activate = function() {
        if (this._modelstructure) {
            this._modelstructure.setVisible(true);
            avp.analytics.track('viewer.model_browser', {
                action: 'View List',
            });
            return true;
        }
        return false;
    };

    /**
     * Closes the Model Browser UI.
     * 
     * @memberof Autodesk.Viewing.Extensions.ModelStructureExtension
     * @alias Autodesk.Viewing.Extensions.ModelStructureExtension#deactivate
     */
    proto.deactivate = function() {
        if (this._modelstructure) {
            this._modelstructure.setVisible(false);
        }
        return true; // always
    };

    /**
     * @returns {boolean} true when the panel is visible.
     *
     * @alias Autodesk.Viewing.Extensions.ModelStructureExtension#isActive
     */
    proto.isActive = function() {
        if (this._modelstructure) {
            return this._modelstructure.isVisible();
        }
        return false;
    };

    /**
     * Sets the panel instance to open when clicking the toolbar button.
     * Use the API to override the default panel with a custom one.
     *
     * @param {Autodesk.Viewing.UI.ModelStructurePanel} modelStructurePanel - The model structure panel to use, or null.
     * @returns {boolean} True if the panel, or null, was set successfully; false otherwise.
     *
     * @alias Autodesk.Viewing.Extensions.ModelStructureExtension#setModelStructurePanel
     */
    proto.setModelStructurePanel = function(modelStructurePanel) {

        if (modelStructurePanel === this._modelstructure)
            return false;

        if (this._modelstructure) {
            this._modelstructure.setVisible(false);  // This ensures the button is in the correct state.
            this.viewer.removePanel(this._modelstructure);
            this._modelstructure.uninitialize();
        }

        this._modelstructure = modelStructurePanel;
        this.viewer.modelstructure = modelStructurePanel; // legacy compatibility; removed after v8.0.0
        if (!modelStructurePanel) {
            return true;
        }

        this.viewer.addPanel(this._modelstructure);

        // Notify of all models already loaded
        var models = this.viewer.impl.modelQueue().getModels();
        for (var i=0; i<models.length; ++i) {
            this._modelstructure.addModel(models[i]);
        }

        this._modelstructure.addVisibilityListener(visible => {
            if (visible) {
                this.viewer.onPanelVisible(this._modelstructure);
            }
            this._structureButton.setState(visible ? Button.State.ACTIVE : Button.State.INACTIVE);
        });

        return true;
    };

    /**
     * Removes custom panel and restores the default one.
     *
     * @alias Autodesk.Viewing.Extensions.ModelStructureExtension#restoreDefaultPanel 
     */
    proto.restoreDefaultPanel = function() {

        const config = this.viewer.config;
        var options = {
            docStructureConfig: config.docStructureConfig,
            hideSearch: isMobileDevice(),
            excludeRoot: config.modelBrowserExcludeRoot,
            startCollapsed: config.modelBrowserStartCollapsed,
        };
        var modelTitle = config.defaultModelStructureTitle || 'Browser';
        var panelInstance = new ViewerModelStructurePanel({
            ...options,
            ...generateDefaultViewerHandlerOptions(this.viewer)
            }, modelTitle);
        this.setModelStructurePanel(panelInstance);
    };

    /**
     * @param event
     * @private
     */
    proto._onLoadModel = function(event) {
        if (this._modelstructure) {
            this._modelstructure.addModel(event.model);
        }
    };

    /**
     * @param event
     * @private
     */
    proto._onUnloadModel = function(event) {
        if (this._modelstructure) {
            this._modelstructure.unloadModel(event.model);
        }
    };
