
import { SettingsPanel } from "./SettingsPanel";
import * as et from "../application/EventTypes";
import { logger } from "../logger/Logger";
import { LightPresets } from "../application/LightPresets";
import i18n from "i18next";
import { isMobileDevice, touchStartToClick } from "../compat";
import { ViewerPanelMixin } from "./ViewerPanelMixin";
import { LightPresetThumbnails } from "./LightPresetThumbnails";
import debounce from "lodash/debounce";
import { Prefs3D, Prefs2D, Prefs } from '../application/PreferenceNames';
import { EnumType } from "../application/ProfileSettings";
import { displayUnitsEnum, displayUnitsPrecisionEnum } from '../../src/measurement/DisplayUnits';

const avp = Autodesk.Viewing.Private;
let idCounter = 0;

/**
 * Viewer3dSettings Tabs.
 *
 * These constants are used to define the tabs in the ViewerSettingsPanel.
 *
 * @enum {number}
 * @readonly
 */
export let ViewerSettingTab = {
    Navigation : "navigationtab",
    Configuration: "performancetab",
    Appearance: "appearance",
    Environment: "environment"
};

var viewerSettingsPanelInstanceCnt = 0;

/**
 * Options object for settings panel
 * @typedef {Object} ViewerSettingsPanelOptions
 * @property {Preferences} pref - Preferences instance object
 * @property {GlobalManager} globalManager - GlobalManager instance object
  * @property {function} removeEventListener - Event dispatcher function for removing listeners
 * @property {function} addEventListener - Event dispatcher function for adding listeners
 * @property {HTMLElement} container - The container for this panel.
 * @property {function} onRestoreDefaults - Callback for resetting settings to default
 * @property {function} detectIfModelsHaveEdge - Query if current models have edges
 * @property {string} [version] - Version to show on the footer
 * @property {number} [options.width] - Override panel's minimum width
 * @property {number} [options.heightAdjustment] - Override panel's extra content height, to account for non-scrolling elements.
 * /

/**
 * ViewerSettingsPanel
 * This is a panel for displaying the settings for the viewer.
 * @class
 *
 * @param {Autodesk.Viewing.Viewer3D|ViewerSettingsPanelOptions} viewer - the parent viewer
 * @param {Autodesk.Viewing.Model} model - Model to detect whether the viewer renders in 2D or 3D
 * @constructor
 */
export function ViewerSettingsPanel(opts, model) {
    let options = {...opts};

    if (opts instanceof Autodesk.Viewing.GuiViewer3D ||
        opts instanceof Autodesk.Viewing.Viewer3D) {
        const viewer = opts;
        options = {
            preferences: viewer.prefs,
            globalManager: viewer.globalManager,
            addEventListener: viewer.addEventListener.bind(viewer),
            removeEventListener: viewer.removeEventListener.bind(viewer),
            container: viewer.container,
            version: viewer.config.viewerVersion,
            onRestoreDefaults: viewer.restoreDefaultSettings.bind(viewer),
            detectIfModelsHaveEdge: () => {
                if (model.is2d()) {
                    return false;
                }
            
                let hasEdges = false;
                const models = viewer.impl.modelQueue().getModels();
                for (let i=0; i<models.length; i++) {
                    let model = models[i];
                    if (model.hasEdges) {
                        hasEdges = true;
                        break;
                    }
                }

                return hasEdges;
            },
            loadExtension: (extensionId) => {
                viewer.loadExtension(extensionId);
            },
            unloadExtension: (extensionId) => {
                viewer.unloadExtension(extensionId);
            },
            width: 400,
            heightAdjustment: 50/*title-bar*/+40/*tab-bar*/+20/*footer*/,
        };
    }


    this.options = options;
    this.preferences = options.preferences;

    this.is3dMode = !model.is2d();
    this.visible =  false;

    // Keeps track of external registered buttons.
    this._externalButtonIds = [];
    this._externalButtonsLabel = null;

    SettingsPanel.call(
        this,
        this.options.container,
        'ViewerSettingsPanel' + idCounter++ + '-' + viewerSettingsPanelInstanceCnt++, 'Settings',
        options
    );
    this.container.classList.add('viewer-settings-panel');
    this.setGlobalManager(this.options.globalManager);


    this.addTab( ViewerSettingTab.Configuration, "Configuration", { className: "performance" } );
    this.addTab( ViewerSettingTab.Navigation, "Navigation", { className: "navigation" } );
    this.addTab( ViewerSettingTab.Appearance, "Appearance", { className: "appearance"} );
    if(this.is3dMode) {
        this.addTab( ViewerSettingTab.Environment, "Environment", { className: "environment"} );
    } else {
        this.container.classList.add('for-2d-model');
    }

    this.createRestoreDefaultSettingsButton();

    this.modelPreferenceCount = 0;
    this.createNavigationPanel();
    this.createConfigurationPanel();
    this.createAppearancePanel();
    
    if (this.modelPreferenceCount) {
        logger.log('Model locked (' + this.modelPreferenceCount + ') render settings in UI.');
    }
    // Setting Configuration as the default tab
    this.selectTab(ViewerSettingTab.Configuration);

    this.footer = this.createFooter();
    this.createVersionLabel(this.footer);

    // Add events
    this.syncUI = this.syncUI.bind(this);
    this.options.addEventListener(et.RESTORE_DEFAULT_SETTINGS_EVENT, this.syncUI);
    this.options.addEventListener(et.VIEWER_STATE_RESTORED_EVENT, this.syncUI);
    
    this.updateEdgeToggle = this.updateEdgeToggle.bind(this);
    this.options.addEventListener(et.GEOMETRY_LOADED_EVENT, this.updateEdgeToggle);

    this.sendAnalyticsDebounced = debounce((name, value) => {
        avp.analytics.track('viewer.settings.changed', {
            setting_name: name,
            setting_value: value,
        });
    }, 500);
}

ViewerSettingsPanel.prototype = Object.create(SettingsPanel.prototype);
ViewerSettingsPanel.prototype.constructor = ViewerSettingsPanel;
ViewerPanelMixin.call( ViewerSettingsPanel.prototype );

/**
 * Clean up when the viewer setting  is about to be removed.
 * @override
 */
ViewerSettingsPanel.prototype.uninitialize = function () {
    if (this._onBgEnvironmentChange && this._onBgEnvironmentReset) {
        this.preferences.removeListeners(avp.Prefs3D.LIGHT_PRESET, this._onBgEnvironmentChange, this._onBgEnvironmentReset);
        this._onBgEnvironmentChange = null;
        this._onBgEnvironmentReset = null;
    }
    this.options.removeEventListener?.(et.RESTORE_DEFAULT_SETTINGS_EVENT, this.syncUI);
    this.options.removeEventListener?.(et.VIEWER_STATE_RESTORED_EVENT, this.syncUI);
    this.options.removeEventListener?.(et.GEOMETRY_LOADED_EVENT, this.updateEdgeToggle);
    SettingsPanel.prototype.uninitialize.call(this);
    this.envSelect = null;
};


ViewerSettingsPanel.prototype.setVisible = function(show) {
    this.visible = show;
    SettingsPanel.prototype.setVisible.call(this, show);
    show && this.sizeToContent();

    if (show) {
        this.createEnvironmentPanel();
    }
};

/**
 * Creates a checkbox element and adds it to the given tab.
 *
 * @param {number} tabId - tab id
 * @param {string} description - the text associated with the checkbox
 * @param {boolean} initialState - initial value for the checkbox (checked or not)
 * @param {function} onchange - callback that is called when the checkbox is changed
 * @param {string} saveKey - name of the preference associated with this checkbox.
 * @returns {string} - it returns the checkbox element.
 *
 */
ViewerSettingsPanel.prototype.addCheckbox = function(tabId, name, description, initialState, onchange, saveKey)
{
    const { preferences } = this;
    // Use the stored settings or defaults
    var storedState = preferences[saveKey];
    initialState = (typeof storedState === 'boolean') ? storedState : initialState;

    function onChangeCB(checked) {
        if(saveKey){
            preferences.set(saveKey, checked);
            avp.analytics.track('viewer.settings.changed', {
                setting_name: saveKey,
                setting_value: checked,
            });
        }
        onchange && onchange(checked);
    }

    var checkboxId = SettingsPanel.prototype.addCheckbox.call(this, tabId, name, initialState, onChangeCB, description);
    var checkBoxElem = this.getControl(checkboxId);
    checkBoxElem.saveKey = saveKey;

    if(saveKey) {
        preferences.addListeners(saveKey, function (value) {
            checkBoxElem.setValue(value);
        }, function (value) {
            checkBoxElem.setValue(value);
            onchange && onchange(value);
        });
    }
    else {
        checkBoxElem.sliderRow.classList.add('logical-group');
    }

    if (preferences.hasTag(saveKey, 'no-storage')){
        checkBoxElem.sliderRow.classList.add('no-storage');
        this.modelPreferenceCount++;
    }
    return checkboxId;
};

/*
 * @param {string} tabId - Tab to add the new control
 * @param {string} caption - The text associated with the dropdown
 * @param {array} items - List of items for the menu
 * @param {array} values - values corresponding to each item in items
 * @param {number} initialItemIndex - Initial choice.
 * @param {function} onchange - Callback that is called when the menu selection is changed.
 * @param {string} preferenceKey - name of the preference associated with this dropdown.
 * @param {object|undefined} options - Additional options:
 * - insertAtIndex - index at which to insert a new drop down menu
 * @returns {string} ID of a new control.
*/
ViewerSettingsPanel.prototype.addDropDownMenu = function(tabId, caption, items, values, initialItemIndex, preferenceKey, options)
{
    const { preferences } = this;
   if (preferenceKey) {
     // initial value is from preference
     initialItemIndex = values.indexOf(preferences.get(preferenceKey));
   }
   
   // wrapper to set the preference
   function onChangeCB(evt) {
       if(preferenceKey){
            if (preferenceKey == "displayUnits"){
                preferences.set(preferenceKey, new EnumType(displayUnitsEnum, values[evt.detail.value]));
            }
            else if (preferenceKey == "displayUnitsPrecision") {
                preferences.set(preferenceKey, new EnumType(displayUnitsPrecisionEnum, values[evt.detail.value]));
            }
            else {
                preferences.set(preferenceKey, values[evt.detail.value]);
            }
            
           avp.analytics.track('viewer.settings.changed', {
            setting_name: preferenceKey,
            setting_value: values[evt.detail.value],
        });
       }       
   }

   const dropDownId = SettingsPanel.prototype.addDropDownMenu.call(this, tabId, caption, items, initialItemIndex, onChangeCB, options);
   const dropDownElem = this.getControl(dropDownId);

   if(preferenceKey) {
       preferences.addListeners(preferenceKey, function (value) {
           dropDownElem.setSelectedIndex(values.indexOf(value));
       }, function (value) {
           dropDownElem.setSelectedIndex(values.indexOf(value));
       });
   }
   else {
        dropDownElem.sliderRow.classList.add('logical-group');
   }

   if (preferences.hasTag(preferenceKey, 'no-storage')){
        dropDownElem.sliderRow.classList.add('no-storage');
       this.modelPreferenceCount++;
   }
   return dropDownId;
};

/**
 * Creates a row and a slider element and adds it to the given tab.
 *
 * @param {number} tabId - tab id
 * @param {string} caption - the caption associated with the slider
 * @param {string} description - the text associated with the slider
 * @param {boolean} initialValue - initial value for the slider (checked or not)
 * @param {function} onchange - callback that is called when the slider is changed
 * @param {string} saveKey - name of the preference associated with this slider.
 * @returns {string[]} - it returns the row and slider control ids.
 */
ViewerSettingsPanel.prototype.addSliderV2 = function(tabId, caption, description, min, max, initialValue, options, saveKey)
{
    // Use the stored settings or defaults
    const { preferences } = this;
    var storedState = preferences.get(saveKey);
    initialValue = (typeof storedState === 'number') ? storedState : initialValue;

    if (saveKey && !Object.prototype.hasOwnProperty.call(preferences, saveKey)) {
        // Add the preferences.
        preferences.add(saveKey, initialValue, ['2d', '3d']);
    }

    function onChangeCB(event) {
        var value = typeof event === 'number' ? event : Number(event.detail.value);
        if(saveKey){
            preferences.set(saveKey, value);
        }        
    }

    var sliderId = SettingsPanel.prototype.addSliderV2.call(this, tabId, caption, description, min, max, initialValue, onChangeCB, options );
    var sliderElem = this.getControl(sliderId[1]);
    sliderElem.saveKey = saveKey;

    if(saveKey) {
        preferences.addListeners(saveKey, function (value) {
            sliderElem.setValue(value);
        });
    }
    else {
        sliderElem.sliderRow.classList.add('logical-group');
    }

    if (preferences.hasTag(saveKey, 'no-storage')){
        sliderElem.sliderRow.classList.add('no-storage');
        this.modelPreferenceCount++;
    }
    return sliderId;
};

/**
 * @private
 */
function generateEnvThumbnail(generator, image, preset) {
    generator.createThumbnail(preset).then((url)=>{
        image.src = url;
        image.onload = function(){
            URL.revokeObjectURL(url);
        };
    });
}

ViewerSettingsPanel.prototype.addGrid = function(parentTable, items, onChange, saveKey) {
    const { preferences } = this;
    var table = parentTable;

    var _document = this.getDocument();
    var envContainer = _document.createElement("div");
    envContainer.classList.add("environments-container");
    table.appendChild(envContainer);

    var envRow = _document.createElement("div");
    envRow.classList.add("environments-lighting-table");
    envContainer.appendChild(envRow);

    var generator = new LightPresetThumbnails(42, 26);
    generator.setGlobalManager(this.globalManager);

    for (var i = 0; i < items.length; i++) {

        let preset = items[i];

        var cell = _document.createElement("div");
        cell.classList.add("settings-environment-cell");
        cell.index = i;

        var image = _document.createElement("img");
        image.classList.add("settings-environment-image");
        generateEnvThumbnail(generator, image, preset);

        cell.appendChild(image);

        var name = _document.createElement("span");
        name.textContent = i18n.t(preset.name);
        name.classList.add("settings-environment-name");
        name.setAttribute('data-i18n', preset.name);
        cell.appendChild(name);

        cell.addEventListener("click", function () {
            preferences.set(saveKey, this.index);
        });

        envRow.appendChild(cell);
    }

    this.preferences.addListeners(saveKey, onChange);
    return envRow;
};


ViewerSettingsPanel.prototype.updateEnvironmentSelection = function() {
    if (!this.is3dMode) {
        return;
    }

    if (!this.envTabCreated)
        return;

    var index = this.preferences.get('lightPreset');

    // Get the index of the lightPreset name
    // This is done because the Prefs3D.LIGHT_PRESET can either be a string or an integer.
    if (typeof(index) === "string") {
        // Create an array of light preset names
        const indices = LightPresets.map(lightObj => lightObj.name);
        // Set the index to 
        index = indices.indexOf(index);
    }
    var cells = this.gridTable.querySelectorAll(".settings-environment-cell");
    for(var j =0; j<cells.length;j++) {
        if(cells[j].index === index) {
            cells[j].classList.add("border-select");
        } else {
            cells[j].classList.remove("border-select");
        }
    }
};

/**
 * Removes an option from the given tab.
 *
 * @param {HTMLElement} checkBoxElem - checkbox to remove.
 * @returns {boolean} - True if the checkbox was removed.
 */
ViewerSettingsPanel.prototype.removeCheckbox = function(checkBoxElem)
{
    this.preferences.removeListeners(checkBoxElem.saveKey);
    this.removeEventListener(checkBoxElem, "change", checkBoxElem.changeListener);

    return SettingsPanel.prototype.removeCheckbox.call(this, checkBoxElem);
};

/**
 *  Populates the navigation tab with the appropriate checkboxes.
 */
ViewerSettingsPanel.prototype.createNavigationPanel = function()
{
    var navTab = ViewerSettingTab.Navigation;

    if (this.is3dMode) {

        this.addLabel(navTab, "ViewCube");

        this.addCheckbox(navTab, "Show ViewCube", "Toggles availability of the ViewCube navigation control" , true, undefined, Prefs3D.VIEW_CUBE);

        if(!isMobileDevice()) {
          this.addCheckbox(navTab, "ViewCube acts on pivot",
          "When enabled, the ViewCube orbits the view around the active pivot point When disabled, it orbits around the center of the view",
          false,
          undefined, Prefs3D.ALWAYS_USE_PIVOT);
        }

        this.addLabel(navTab, "Orbit");

        this.addCheckbox(navTab, "Fusion style orbit", "Enables Fusion-style orbit overlay and gives the ability to lock orbit axis", false, (checked) => {
            // This is a hack
            // We want the extension to be loaded and unloaded by preferences, but unloading Fusion orbit when entering 2D
            // has a side effect of restoring default state of the 'orbit' tool, causing orbit to be active in 2D mode
            // Instead of preferences, we let fusion orbit extension loading controlled by the toggle only
            if (checked) {
                this.options.loadExtension('Autodesk.Viewing.FusionOrbit', null);	
            } else	{
                this.options.unloadExtension('Autodesk.Viewing.FusionOrbit', null);	
            }
        }, Prefs.FUSION_ORBIT);

        this.addCheckbox(navTab, "Orbit past world poles", "Allows view rotation to continue past the model’s North Pole", true, undefined, Prefs3D.ORBIT_PAST_WORLD_POLES);

        this.addLabel(navTab, "Zoom");

        if(!isMobileDevice()) {
            this.addCheckbox(navTab, "Zoom towards pivot", "When disabled, zooming operations are centered at the current cursor location", false, undefined, Prefs3D.ZOOM_TOWARDS_PIVOT);

            this.addCheckbox(navTab, "Reverse mouse zoom direction", "Toggles direction of zooming in and out", false, undefined, Prefs.REVERSE_MOUSE_ZOOM_DIR);
            
            this.scrollSpeed = initScrollSpeed.call(this);
        }

        this.dragSpeed = initDragSpeed.call(this);

        // This label should probably be called something else for mobile.
        this.addLabel(navTab, "Mouse");
        if(!isMobileDevice()) {
            this.addCheckbox(navTab, "Left handed mouse setup", "Swaps the buttons on the mouse", false, undefined, Prefs.LEFT_HANDED_MOUSE_SETUP);

            this.addCheckbox(navTab, "Set pivot with left mouse button", "Change left-click behavior to set new pivot point (overrides select object)", false, undefined, Prefs3D.CLICK_TO_SET_COI);
        }
        this.addCheckbox(navTab, "Open properties on select", "Always show properties upon selecting object", true, undefined, Prefs.OPEN_PROPERTIES_ON_SELECT);
    }

    if(!this.is3dMode) {

        this.addLabel(navTab, "Zoom");

        this.addCheckbox(navTab, "Reverse mouse zoom direction", "Toggles direction of zooming in and out", false, undefined, Prefs.REVERSE_MOUSE_ZOOM_DIR);

        if(!isMobileDevice()) {
            this.scrollSpeed = initScrollSpeed.call(this);
        }

        this.dragSpeed = initDragSpeed.call(this);

        this.addLabel(navTab, "Mouse");

        this.addCheckbox(navTab, "Open properties on select", "Always show properties upon selecting object", true, undefined, Prefs.OPEN_PROPERTIES_ON_SELECT);
        
        if(!isMobileDevice()) {
            this.addCheckbox(navTab, "Left handed mouse setup", "Swaps the buttons on the mouse", false, undefined, Prefs.LEFT_HANDED_MOUSE_SETUP);
        }

    }
    
    // Creates the drag speed slider
    function initDragSpeed() {
        return this.addSliderV2(navTab, 'Drag Speed', 'Changes sensitivity of mouse movement with the zoom tool', 5, 300, this.options.initialZoomDragSpeed,
        { step: 5 }, Prefs.ZOOM_DRAG_SPEED)[1];
    }

    // Creates the scroll speed slider
    function initScrollSpeed() {
        return this.addSliderV2(navTab, 'Scroll Speed', 'Changes sensitivity of the mouse scroll wheel when zooming', 0.1, 3.0, this.options.initialZoomScrollScale,
        { step: 0.1 }, Prefs.ZOOM_SCROLL_SPEED)[1];
    }
};

/**
 * Adds a button to the configuration tab. Invokes a callback when end-users click on the button.
 * @param {string} label - Button's user-facing text
 * @param {function} onClickCb - Callback that will be called when the tool is clicked.
 * @returns {string} An identifier required to remove the button from the panel.
 */
ViewerSettingsPanel.prototype.addConfigButton = function(label, onClickCb) {

    if (!onClickCb)
        throw new Error('Must register a function callback.');

    // Add the Tools label to the Configuration tab
    if (!this._externalButtonsLabel) 
        this._externalButtonsLabel = this.addLabel(ViewerSettingTab.Configuration, 'More');
        
    // Add button
    var btnId = this.addButton(ViewerSettingTab.Configuration, label);
    var btn = this.getControl(btnId);
    btn.setOnClick(()=>{
        this.setVisible(false);
        onClickCb();
    });
    this._externalButtonIds.push(btnId);
    return btnId;
};

/**
 * Removes a config button from the Configuration tab.
 * @param {string} buttonId - Identifier obtained via {@link #addConfigButton}.
 * @returns {boolean} True if the button was removed.
 */
ViewerSettingsPanel.prototype.removeConfigButton = function(buttonId) {
    
    var index = this._externalButtonIds.indexOf(buttonId);
    if (index === -1) 
        return false;

    var btn = this.getControl(buttonId); // btn should always be present at this stage.
    if (!btn)
        return false;

    this.removeControl(btn);
    this._externalButtonIds.splice(index, 1);

    // Remove label when no config buttons are present
    if (this._externalButtonIds.length === 0 && this._externalButtonsLabel !== null) {
        this._externalButtonsLabel.removeFromParent();
        this._externalButtonsLabel = null;
    }
    return true;
};

ViewerSettingsPanel.prototype.updateEdgeToggle = function() {
    const ctrl = document.getElementById(this.edgeCheckboxName+"_check");
    if (!ctrl) {
        // ctrl can be undefined when GEOMETRY_LOADED_EVENT event is fired before the config panel is initialized
        // It is ok to skip updating the toggle
        return;
    }
    if (!this.is3dMode) {
        return;
    }
    const hasEdges = this.options.detectIfModelsHaveEdge();
    if (hasEdges) {
        ctrl.disabled = false;
    } else {
        ctrl.disabled = true;
        ctrl.checked = false;
    }
};

/** Populates the Configuration tab with the appropriate checkboxes.
 *
 */
ViewerSettingsPanel.prototype.createConfigurationPanel = function() {
    var configTab = ViewerSettingTab.Configuration;

    if (this.is3dMode) {

        this.addLabel(configTab, "Performance Optimization");

        this.optimizeNavigationhkBoxId = this.addCheckbox(configTab, "Smooth navigation", "Provides faster response(but degrades quality) while navigating",
            isMobileDevice(), undefined, Prefs3D.OPTIMIZE_NAVIGATION);

        this.progressiveRenderChkBoxId = this.addCheckbox(configTab, "Progressive display", "Shows incremental updates of the view and allows for more responsive interaction with the model (some elements may flicker) This improves perceived waiting time",
            true, undefined, Prefs.PROGRESSIVE_RENDERING);

        this.addLabel(configTab, "Display");

        this.ghosthiddenChkBoxId = this.addCheckbox(configTab, "Ghost hidden objects", "Leave hidden objects slightly visible",
            true, undefined, Prefs3D.GHOSTING);

        this.displayLinesId = this.addCheckbox(configTab,"Display Lines", "Toggles display of line objects", true, undefined, Prefs3D.LINE_RENDERING);


        this.displayPointsId = this.addCheckbox(configTab,"Display Points", "Toggles display of point objects", true, undefined, Prefs.POINT_RENDERING);

        this.edgeCheckboxName = "Display edges";
        this.displayEdgesId = this.addCheckbox(configTab, this.edgeCheckboxName, "Shows outline of model surfaces", false, (value) => {
            const edgeCheckbox = this.getControl(this.displayEdgesId);
            edgeCheckbox.setValue(value);
            this.updateEdgeToggle();
        }, Prefs3D.EDGE_RENDERING);
        this.updateEdgeToggle();
        
        this.displaySectionHatchesId = this.addCheckbox(
            configTab,
            'Display Section Hatches',
            'Shows hatch pattern for section planes this does not apply to section boxes',
            true,
            null,
            avp.Prefs3D.DISPLAY_SECTION_HATCHES
        );
    } else {
        // 2D only

        this.addLabel(configTab, "Performance Optimization");

        this.progressiveRenderChkBoxId = this.addCheckbox(configTab, "Progressive display", "Shows incremental updates of the view and allows for more responsive interaction with the model (some elements may flicker) This improves perceived waiting time",
           true, undefined, Prefs.PROGRESSIVE_RENDERING);

        this.addLabel(configTab, "Display");
    }

    // 2d or 3d
    // Anything added below this line applies to "Display" subtitle
    this.displayUnitsId = this.addDropDownMenu(configTab, 'Display Units', avp.displayUnits, avp.displayUnitsEnum, null,  avp.Prefs.DISPLAY_UNITS);
    this.displayUnitsPrecisionId = this.addDropDownMenu(configTab, 'Precision', avp.displayUnitsPrecision, avp.displayUnitsPrecisionEnum, null, avp.Prefs.DISPLAY_UNITS_PRECISION);

    if (this.is3dMode) {
        this._addSelectionModeOption();
    }
};

ViewerSettingsPanel.prototype._addSelectionModeOption = function () {
   
    const configTab = ViewerSettingTab.Configuration;

    this.addLabel(configTab, "Selection");

    // Convert enum into arrays
    const selectionModes = [];
    const selectionModeValues = [];
    let i = 0;
    for (let key in Autodesk.Viewing.SelectionMode) {
        selectionModes[i] = key;
        selectionModeValues[i] = Autodesk.Viewing.SelectionMode[key];
        i++;
    }
    // Capitalize the mode names for display
    const names = selectionModes.map(mode =>
      mode
        .split('_')
        .map(str => str.charAt(0) + str.slice(1).toLowerCase())
        .join(' ')
    );
    
    this.selectionModeId = this.addDropDownMenu(configTab, 'Selection Mode', names, selectionModeValues, null, avp.Prefs3D.SELECTION_MODE);
};

    /**
     * Populates the appearance tab with the appropriate checkboxes.
     */

ViewerSettingsPanel.prototype.createAppearancePanel = function () {
    var appearTab = ViewerSettingTab.Appearance;
    if (this.is3dMode) {
       this.addLabel(appearTab, "Visual Quality Optimization");
       this.antialiasingChkBoxId = this.addCheckbox(appearTab, "Anti-aliasing", "Remove jagged edges from lines", true, undefined, Prefs3D.ANTIALIASING);
       this.ambientshadowsChkBoxId = this.addCheckbox(appearTab, "Ambient shadows", "Improve shading of occluded surfaces", true, undefined, Prefs3D.AMBIENT_SHADOWS);
       this.groundShadowChkBoxId = this.addCheckbox(appearTab, "Ground shadow", "Add simulated ground surface shadows", true, undefined, Prefs3D.GROUND_SHADOW);
       this.groundReflectionChkBoxId = this.addCheckbox(appearTab, "Ground reflection", "Add simulated ground surface reflections", false, undefined, Prefs3D.GROUND_REFLECTION);
    } else {
       this.addLabel(appearTab, "Existing behavior");
       this.swapBlackAndWhiteChkBoxId = this.addCheckbox(appearTab, "2D Sheet Color", "Switch sheet color white to black", true, undefined, Prefs2D.SWAP_BLACK_AND_WHITE);
       this.loadingAnimationChkBoxId = this.addCheckbox(appearTab, "Loading Animation", "Animate lines during loading", true, undefined, Prefs2D.LOADING_ANIMATION);
    }
};


ViewerSettingsPanel.prototype.createEnvironmentPanel = function () {
    if (!this.is3dMode || this.envTabCreated) {
        return;
    }

    this.envTabCreated = true;
    var environmentTab = ViewerSettingTab.Environment;
    var table = this.tablesContainer.childNodes[3];
    this.gridTable = table;

    this.addLabel(environmentTab, "Environment");

    this.envMapBackgroundChkBoxId = this.addCheckbox(environmentTab, "Environment Image Visible", "Shows lighting environment as background", true, undefined, Prefs3D.ENV_MAP_BACKGROUND);

    var captionRow = table.tBodies[0].insertRow(-1);

    var cell = captionRow.insertCell(0);
    var _document = this.getDocument();
    this.caption = _document.createElement("div");
    this.caption.setAttribute("data-i18n", "Environments and Lighting Selection");
    this.caption.textContent = i18n.t("Environments and Lighting Selection");
    this.caption.classList.add("settings-row-title");
    cell.appendChild(this.caption);
    cell.colSpan = "3";

    this.envSelect = this.addGrid(
        table,
        LightPresets,
        this.updateEnvironmentSelection.bind(this),
        avp.Prefs3D.LIGHT_PRESET
    );
    this.updateEnvironmentSelection();

    // Only display the icons with environment.
    this.envSelect.classList.add("with-environment");
};

/**
 * Adds viewer version label to Footer div.
 */
ViewerSettingsPanel.prototype.createVersionLabel = function(parent) {

    if (!parent)
        return;
    var _document = this.getDocument();
    this.versionDiv = _document.createElement('div');
    this.versionDiv.textContent = getVersionString(this.options.version); // No need to localize.
    this.versionDiv.className = 'docking-panel-version-label';
    this.addEventListener(this.versionDiv, 'click', event => {
        if (event.shiftKey) {
            navigator.clipboard.writeText(this.versionDiv.textContent);
        }
    });
    parent.appendChild(this.versionDiv);
};

/**
 * Create a restore default settings button. It is appended to the settings panel
 */
ViewerSettingsPanel.prototype.createRestoreDefaultSettingsButton = function () {
    
    var _document = this.getDocument();
    this.restoreDiv = _document.createElement('div');
    this.restoreDiv.classList.add('docking-panel-container-solid-color-b');
    this.restoreDiv.classList.add('restore-defaults-container');

    this.restoreButton = _document.createElement('div');
    this.restoreButton.className = 'docking-panel-tertiary-button';
    this.restoreButton.setAttribute("data-i18n", "Restore all default settings");
    this.restoreButton.textContent = i18n.t("Restore all default settings");
    this.restoreDiv.appendChild(this.restoreButton);

    this.addEventListener(this.restoreDiv, 'touchstart', touchStartToClick );
    this.addEventListener(this.restoreDiv, 'click', () => {
        this.options.onRestoreDefaults?.();        
        avp.analytics.track('viewer.settings.default');
    }, false);

    this.scrollContainer.appendChild(this.restoreDiv);
};


ViewerSettingsPanel.prototype.selectTab = function( tabId ) {
    SettingsPanel.prototype.selectTab.call(this, tabId);
    this.sizeToContent();
};

/**
 * Resizes panel vertically to wrap around the content.
 * It will always leave some room at the bottom to display the toolbar.
 */
ViewerSettingsPanel.prototype.sizeToContent = function() {
    SettingsPanel.prototype.sizeToContent.call(this, this.options.container);
};

ViewerSettingsPanel.prototype.onViewerResize = function(vt, vb, vl, vr, vw, vh) {
    // Avoid default behavior by overriding inherited implementation.
    this.sizeToContent();
};

/**
 * Updates the values in the checkboxes based on what is in the prefs.
 */
ViewerSettingsPanel.prototype.syncUI = function() {
    var prefs = this.preferences;

    this.setControlValue(this.antialiasingChkBoxId, prefs.get('antialiasing'));
    this.setControlValue(this.ambientshadowsChkBoxId, prefs.get('ambientShadows'));
    this.setControlValue(this.groundShadowChkBoxId, prefs.get('groundShadow'));
    this.setControlValue(this.groundReflectionChkBoxId, prefs.get('groundReflection'));
    this.setControlValue(this.envMapBackgroundChkBoxId, prefs.get('envMapBackground'));
    this.setControlValue(this.progressiveRenderChkBoxId, prefs.get('progressiveRendering'));
    this.setControlValue(this.swapBlackAndWhiteChkBoxId, prefs.get('swapBlackAndWhite'));
    this.setControlValue(this.loadingAnimationChkBoxId, prefs.get('loadingAnimation'));
    this.setControlValue(this.ghosthiddenChkBoxId, prefs.get('ghosting'));
    this.setControlValue(this.displayLinesId, prefs.get('lineRendering'));
    this.setControlValue(this.displayPointsId, prefs.get('pointRendering'));
    this.setControlValue(this.displayEdgesId, prefs.get('edgeRendering'));
    this.setControlValue(this.displaySectionHatchesId, prefs.get('displaySectionHatches'));
    this.setControlValue(this.scrollSpeed, prefs.get('zoomScrollSpeed'));
    this.setControlValue(this.dragSpeed, prefs.get('zoomDragSpeed'));
    
    this.updateEnvironmentSelection();
};


/**
 * Safely sets the value of a checkbox control.
 * 
 * @param {string} ctrlName - The id of the control
 * @param {boolean} value
 */
ViewerSettingsPanel.prototype.setControlValue = function(ctrlName, value) {
    var ctrl = this.getControl(ctrlName);
    if (ctrl) {
        ctrl.setValue(value);
    }
};


function getVersionString(version = LMV_VIEWER_VERSION) {
    if (version.charAt(0) === "@") {
        version = '0.0.0'; // No need to localize.
    }
    return 'v' + version;
}
