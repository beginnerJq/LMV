
    import { Extension } from "../../src/application/Extension";
    import { PropertyPanel } from "../../src/gui/PropertyPanel";
    import { ViewerPropertyPanel } from "../../src/gui/ViewerPropertyPanel";
    import { Button } from "../../src/gui/controls/Button";
    import * as et from "../../src/application/EventTypes";
    import { Prefs } from '../../src/application/PreferenceNames';

    /**
     * Use its `activate()` method to open the Properties UI.
     *
     * The extension id is: `Autodesk.PropertiesManager`
     *
     * @param {Viewer3D} viewer - Viewer instance
     * @param {object} options - Configurations for the extension
     * @example 
     * viewer.loadExtension('Autodesk.PropertiesManager')
     * @memberof Autodesk.Viewing.Extensions
     * @alias Autodesk.Viewing.Extensions.PropertiesManagerExtension
     * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
     * @class
     */
    export function PropertiesManagerExtension(viewer, options) {
        Extension.call(this, viewer, options);
        this.name = "propertiesmanager";
        this._panel = null;
        this._onIsolateEvent = this._onIsolateEvent.bind(this);
        this._onSelectionChangeEvent = this._onSelectionChangeEvent.bind(this);
        this._onPrefChange = this._onPrefChange.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
    }

    PropertiesManagerExtension.prototype = Object.create(Extension.prototype);
    PropertiesManagerExtension.prototype.constructor = PropertiesManagerExtension;
    var proto = PropertiesManagerExtension.prototype;
    const avp = Autodesk.Viewing.Private;


    /**
     * Invoked when the extension gets loaded.
     *
     * @returns {boolean} true when the extension loaded successfully.
     * @alias Autodesk.Viewing.Extensions.PropertiesManagerExtension#load
     */
    proto.load = function() {
        this.viewer.addEventListener(et.ISOLATE_EVENT, this._onIsolateEvent);        
        this.viewer.addEventListener(et.AGGREGATE_SELECTION_CHANGED_EVENT, this._onSelectionChangeEvent);

        this.viewer.prefs.addListeners(Prefs.OPEN_PROPERTIES_ON_SELECT, this._onPrefChange);

        this.viewer.registerContextMenuCallback(this.name, this._onContextMenu);

        return true;
    };

    /**
     * Invoked when the extension gets unloaded.
     *
     * @alias Autodesk.Viewing.Extensions.PropertiesManagerExtension#unload
     */
    proto.unload = function() {
        this.viewer.removeEventListener(et.ISOLATE_EVENT, this._onIsolateEvent);
        this.viewer.removeEventListener(et.AGGREGATE_SELECTION_CHANGED_EVENT, this._onSelectionChangeEvent);

        this.viewer.prefs.removeListeners(Prefs.OPEN_PROPERTIES_ON_SELECT, this._onPrefChange);

        this.viewer.unregisterContextMenuCallback(this.name);

        this.deactivate();
        this.setPanel(null);
        
        if (this._toolbarButton) {
            this.viewer.settingsTools.removeControl(this._toolbarButton);
            this.viewer.settingsTools.propertiesbutton = null;  // for backwards compatibility, remove in v8.0.0
            this._toolbarButton = null;
        }
    };

    /**
     * Invoked by the Viewer as soon as the toolbar is available.
     */
    proto.onToolbarCreated = function() {
        this.setDefaultPanel();
        this._addToolbarButton();
    };

    /**
     * Opens the Properties UI.
     * 
     * @alias Autodesk.Viewing.Extensions.PropertiesManagerExtension#activate
     */
    proto.activate = function() {
        if (this._panel) {
            this._panel.setVisible(true);
            return true;
        }
        return false;
    };

    /**
     * Closes the Properties UI.
     * 
     * @alias Autodesk.Viewing.Extensions.PropertiesManagerExtension#deactivate
     */
    proto.deactivate = function() {
        if (this._panel) {
            this._panel.setVisible(false);
        }
        return true;
    };

    /**
     * @returns {boolean} true is the properties panel is open.
     * 
     * @alias Autodesk.Viewing.Extensions.PropertiesManagerExtension#isActive
     */
    proto.isActive = function() {
        if (this._panel) {
            return this._panel.isVisible();
        }
        return false;
    };


    /**
     * Overrides the property panel instance.
     *
     * @param propertyPanel
     * @returns {boolean} True if the panel or null was set successfully, and false otherwise.
     * @alias Autodesk.Viewing.Extensions.PropertiesManagerExtension#setPanel
     * @private
     */
    proto.setPanel = function (propertyPanel) {
        if (propertyPanel instanceof PropertyPanel || !propertyPanel) {
            if (this._panel) {
                this._panel.setVisible(false);
                this.viewer.removePanel(this._panel);
                this._panel.uninitialize();
            }

            this._panel = propertyPanel;
            
            if (propertyPanel) {
                this.viewer.addPanel(propertyPanel);
                propertyPanel.addVisibilityListener(visible => {
                    if (visible) {
                        this.viewer.onPanelVisible(this._panel);
                    }
                    this._toolbarButton.setState(visible ? Button.State.ACTIVE : Button.State.INACTIVE);
                });

            }
            return true;
        }
        return false;
    };

    /**
     * Resets the panel to its default instance.
     *
     * @alias Autodesk.Viewing.Extensions.PropertiesManagerExtension#setDefaultPanel
     */
    proto.setDefaultPanel = function() {
        this.setPanel(new ViewerPropertyPanel(this.viewer));
    };

    /**
     * Sets the property panel instance.
     *
     * @returns {object} The panel instance.
     *
     * @alias Autodesk.Viewing.Extensions.PropertiesManagerExtension#getPanel
     */
    proto.getPanel = function() {
        return this._panel;
    };

    /**
     * @returns {Autodesk.Viewing.UI.Button|null} the instance of the button.
     */
    proto.getToolbarButton = function() {
        return this._toolbarButton;
    };



    /**
     * Adds a button to the toolbar.
     * Invoked automatically as soon as the toolbar is available.
     *
     * @private
     */
    proto._addToolbarButton = function() {

        if (this._toolbarButton)
            return;

        var propertiesButton = this._toolbarButton = new Button('toolbar-propertiesTool');
        propertiesButton.setToolTip('Properties');
        propertiesButton.setIcon("adsk-icon-properties");
        propertiesButton.onClick = () => {
            this._panel.setVisible(!this._panel.isVisible());
            if (this._panel.isVisible()) {
                avp.analytics.track('viewer.properties', {
                    action: 'View List',
                    from: 'Toolbar',
                });
            }
        };
        propertiesButton.setVisible(!this.viewer.prefs.get('openPropertiesOnSelect'));
        this.viewer.settingsTools.addControl(propertiesButton, { index: 1 }); 
        this.viewer.settingsTools.propertiesbutton = propertiesButton; // for backwards compatibility, remove in v8.0.0
    };

    /**
     * @param event
     * @private
     */
    proto._onIsolateEvent = function(event) {
        if (!this._panel)
            return;
        if (this.viewer.prefs.get('openPropertiesOnSelect') || event.nodeIdArray[0] === event.model.getRootId()) {
            this._panel.setVisible(event.nodeIdArray.length > 0 || this.viewer.impl.selector.hasSelection());
        }
    };

    /**
     * Opens the panel when a selection is made AND the corresponding preference is true.
     *
     * @param event
     * @private
     */
    proto._onSelectionChangeEvent = function(event) {

        if (!this.viewer.prefs.get('openPropertiesOnSelect'))
            return;
        
        let hasSelection = false;
        for (let i = 0; i < event.selections.length; ++i) {
            if (event.selections[i].dbIdArray.length > 0) {
                hasSelection = true;
                break;
            }
        }
         
        if (hasSelection) {
            this.activate();
        } else {
            this.deactivate();
        }
    };

    /**
     * Invoked when the preference for whether the Panel gets automatically
     * opened on selection is true or not.
     *
     * @param {boolean} displayOnSelection - true to automatically open the panel when a part is selcted.
     *
     * @private
     */
    proto._onPrefChange = function(displayOnSelection) {

        // When Properties are displayed on selection, 
        // hide the toolbar button (because UX).
        if (this._toolbarButton) {
            this._toolbarButton.setVisible(!displayOnSelection);
        }
    };

    /**
     * Invoked when contextual menu is about to open.
     * Adds a "Show properties" option to the contextual menu.
     * 
     * @param {Array} menu - context menu items.
     * @param {Object} status - Information about nodes: numSelected, hasSelected, hasVisible, hasHidden.
     */
    proto._onContextMenu = function (menu, status) {
        // Properties panel is already open - no need to add "Show Properties" option to the contextual menu.
        if (this.isActive()) {
            return;
        }

        // No object selected - no need to add "Show Properties" option to the contextual menu.
        if (!status.hasSelected) {
            return;
        }

        const menuEntry = {
            title: 'Show Properties',
            target: () => {
                this.activate();
                avp.analytics.track('viewer.properties', {
                    action: 'View List',
                    from: 'Contextual',
                });
            }
        };

        // Put this entry at the beginning of the list.
        menu.unshift(menuEntry);
    };
