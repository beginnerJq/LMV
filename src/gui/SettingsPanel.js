

import { DockingPanel } from "./DockingPanel";
import i18n from "i18next";
import { touchStartToClick } from "../compat";
import { OptionCheckbox, OptionSlider, OptionDropDown, OptionLabel, OptionButton, OptionRow, SimpleList } from "./CommonWidgets";


const TAB_BAR_HEIGHT = 40;//px


/**
 * UI panel specifically designed for application settings.
 *
 * The user can add new options to each of the tabs.
 *
 * @augments Autodesk.Viewing.UI.SettingsPanel
 * @param {HTMLElement} parentContainer - The container for this panel.
 * @param {string} id - The id to assign this panel.
 * @param {string} title - The title of this panel.
 * @param {object} [options] - An optional dictionary of options.
 * @param {number} [options.width] - Override panel's minimum width
 * @param {number} [options.heightAdjustment] - Override panel's extra content height, to account for non-scrolling elements.
 * @class
 * @alias Autodesk.Viewing.UI.SettingsPanel
 */
export function SettingsPanel(parentContainer, id, title, options) {


    DockingPanel.call(this, parentContainer, id, title, options);

    this.panelTabs      = [];
    this.tabIdToIndex   = {};
    this.controls       = {};
    this.controlIdCount = 0;    // to generate unique ids for controls.
    this.shown          = false;

    var settings = this;

    var minWidth = options && options.width !== undefined ? options.width : 340;

    this.container.style.maxWidth = "800px";
    this.container.style.minWidth = minWidth + "px";
    this.container.style.top = "10px";
    this.container.style.left = (parentContainer.offsetWidth/2 - 170) + "px"; //center it horizontally
    this.container.style.position = "absolute";

    var _document = this.getDocument();
    this.tabContainer = _document.createElement("div");
    this.tabContainer.classList.add("docking-panel-container-solid-color-b");
    this.tabContainer.classList.add("settings-tabs");
    this.tabContainer.classList.add("docking-panel-delimiter-shadow");
    this.container.appendChild(this.tabContainer);

    this.tabs = _document.createElement("ul");
    this.tabContainer.appendChild(this.tabs);

    this.heightAdjustment = options && options.heightAdjustment ? options.heightAdjustment : 179;
    if (options && options.hideTabBar) {
        this.heightAdjustment -= TAB_BAR_HEIGHT;
        this.tabContainer.style.display = 'none';
        this.tabContainer.style.height = 0;
    }
    this.createScrollContainer({left: false, heightAdjustment: this.heightAdjustment, marginTop:0});

    this.tablesContainer = _document.createElement("div");
    this.tablesContainer.classList.add("settings-tabs-tables-container");

    if (options && options.hideTabBar) {
        this.scrollContainer.style.top = (90 - TAB_BAR_HEIGHT) + 'px';
    }
    this.scrollContainer.appendChild(this.tablesContainer);

    // Add hovering effect.
    //
    this.mouseOver = false;
    this.addEventListener( this.container, "mouseover", function(event) {
        // This is the original element the event handler was assigned to
        var e = event.toElement || event.relatedTarget;
        if ( settings.mouseOver )
            return true;

        // Check for all children levels (checking from bottom up)
        var _window = settings.getWindow();
        while(e && e.parentNode && e.parentNode != _window) {
            if (e.parentNode == this || e == this) {
                if(e.preventDefault) e.preventDefault();
                settings.mouseOver = true;

                for (var index = 0; index<settings.panelTabs.length; index++)
                    settings.panelTabs[index].classList.remove("selectedmouseout");
                return true;
            }
            e = e.parentNode;
        }
    });

    this.addEventListener( this.container, "mouseout", function(event) {
        // This is the original element the event handler was assigned to
        var e = event.toElement || event.relatedTarget;
        if (!settings.mouseOver)
            return;

        var _window = settings.getWindow();
        // Check for all children levels (checking from bottom up)
        while(e && e.parentNode && e.parentNode != _window) {
            if (e.parentNode == this ||  e == this) {
                if(e.preventDefault) e.preventDefault();
                    return false;
            }
            e = e.parentNode;
        }
        settings.mouseOver = false;

        for (var index=0; index<settings.panelTabs.length; index++) {
            if (settings.panelTabs[index].classList.contains("tabselected"))
                settings.panelTabs[index].classList.add("selectedmouseout");
        }
    });

    this.expandID = function( controlID ) { return id + '-' + controlID; };
}

SettingsPanel.prototype = Object.create(DockingPanel.prototype);
SettingsPanel.prototype.constructor = SettingsPanel;

/**
 * Sets the new visibility state of this SettingsPanel.
 *
 * @param {boolean} show - The desired visibility state.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#setVisible
 */
SettingsPanel.prototype.setVisible = function(show)
{
    if (show) {
        // Since the container does not have width and when display set to none
        // getBoundingClientRect() returns 0, set the display to block before the
        // parent calculates the position and the panel.
        // NOTE: Setting the width for the container does not work here.
        this.container.style.display = "block";
        if(!this.shown) {
            this.resizeToContent();
            this.container.style.left = (this.parentContainer.offsetWidth/2 - this.container.getBoundingClientRect().width/2) + "px"; //center it horizontally
        }
        this.shown = true;
    }

    DockingPanel.prototype.setVisible.call( this, show );
};

/**
 * Adds a new tab to the panel.
 *
 * @param {string} tabId - id for the tab (DOM element will have an extended ID to ensure uniqueness).
 * @param {string} tabTitle
 * @param {object} [options] - optional parameter that allows for additional options for the tab:
 * - tabClassName - class name for the Dom elements
 * - minWidth - min width for the tab
 * - index - index if the tab should be inserted instead of added at the end.
 * @returns {boolean} True if the tab was added to the panel, false otherwise.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#addTab
 */
SettingsPanel.prototype.addTab = function( tabId, tabTitle, options ) {
    var settings = this;

    if (this.tabIdToIndex[tabId] !== undefined )
        return false;

    var tabDomClass = options && options.className !== undefined ? options.className : null;
    var minWidth    = options && options.width !== undefined ? options.width : 200;
    var tabIndex    = options && options.index !== undefined ? options.index : this.panelTabs.length;

    /**
     * @private
     */
    function select() {
        settings.selectTab( tabId );
    }

    var _document = this.getDocument();
    var tab = _document.createElement("li");
    tab._id = tabId; // local ID
    tab.id = this.expandID(tab._id); // DOM ID
    tab.classList.add(tabDomClass);

    var title = _document.createElement("a");
    var span  = _document.createElement("span");
    span.setAttribute("data-i18n", tabTitle);
    span.textContent = i18n.t(tabTitle);
    title.appendChild(span);
    tab.appendChild(title);

    this.tabs.appendChild( tab );

    var table = _document.createElement("table");
    table._id  = tabId + "-table"; // local ID
    table.id = this.expandID(table._id); // DOM ID
    table.classList.add("settings-table");
    table.classList.add("adsk-lmv-tftable");
    table.classList.add(tabDomClass);

    var tbody = _document.createElement("tbody");
    tbody.style.display = 'table';
    tbody.style.width = '100%';
    table.appendChild(tbody);

    this.tablesContainer.appendChild( table );

    this.addEventListener( tab, "touchstart", touchStartToClick );
    this.addEventListener( tab, "click", select );

    this.panelTabs.push( tab );
    this.tabIdToIndex[tabId] = tabIndex;

    // Adjust the panel's minWidth.
    var currentMinWidth = this.container.style.minWidth ? parseInt(this.container.style.minWidth) : 0;
    if (minWidth > currentMinWidth)
        this.container.style.minWidth = minWidth + "px";

    return true;
};

/**
 * Removes the given tab from the panel.
 *
 * @param {string} tabId - Tab to remove.
 * @returns {boolean} True if the tab was successfully removed, false otherwise.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#removeTab
 */
SettingsPanel.prototype.removeTab = function( tabId ) {

    var tabIndex = this.tabIdToIndex[tabId];
    if (!tabIndex)
        return false;

    this.panelTabs.splice(tabIndex, 1);

    var _document = this.getDocument();
    var tabDom = _document.getElementById(this.expandID(tabId));
    this.tabs.removeChild(tabDom);

    // Adjust the idToIndex table and add space (right margin) to all tabs except the last one.
    this.tabIdToIndex = {};
    var tabCount = this.panelTabs.length;
    for (var index=0; index<tabCount; index++) {
        var tab = this.panelTabs[index];
        this.tabIdToIndex[tab._id] = index;

        // Remove the event listeners for these tabs
        this.removeEventListener(tab, 'touchstart', touchStartToClick);
    }
    return true;
};

/**
 * Resize the tabs, so all tabs have the same width
 *
 * @private
 */
SettingsPanel.prototype.resizeTabs = function() {
    var tab_list = this.tabs.getElementsByTagName("li");
    var tab_width = 100 / tab_list.length;
    for (var i = 0; i < tab_list.length; i++) {
        tab_list[i].style.width = tab_width + "%";
    }
};

/**
 * Returns true if a tab with given id exists.
 *
 * @param {string} tabId - Tab id.
 * @returns {boolean} True if the tab with given id exists, false otherwise.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#hasTab
 */
SettingsPanel.prototype.hasTab = function(tabId) {
    var tabIndex = this.tabIdToIndex[tabId];
    var tab = this.panelTabs[tabIndex];
    return tab !== undefined;
};

/**
 * Makes a given tab visible and hides the other ones.
 *
 * @param {string} tabId - Tab to select.
 * @returns {boolean} True if the tab was selected, false otherwise.
 *
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#selectTab
 */
SettingsPanel.prototype.selectTab = function( tabId )
{
    if (this.isTabSelected(tabId))
        return false;

    var _document = this.getDocument();
    var tabCount = this.panelTabs.length;
    for (var tabIndex=0; tabIndex<tabCount; tabIndex++) {
        var tab = this.panelTabs[tabIndex];
        var table = _document.getElementById( this.expandID(tab._id + "-table") );
        if (tabId===tab._id) {
            tab.classList.add("tabselected");
            table.classList.add('settings-selected-table');
            if (!this.mouseOver) {
                tab.classList.add("selectedmouseout");
            }
        }
        else {
            tab.classList.remove("tabselected");
            table.classList.remove('settings-selected-table');
            if (!this.mouseOver) {
                this.panelTabs[tabIndex].classList.remove("selectedmouseout");
            }
        }
    }

    this.scrollContainer.scrollTop = 0;
    return true;
};

/**
 * Returns true if the given tab is selected (visible).
 *
 * @param {string} tabId - Tab to check.
 * @returns {boolean} True if the tab is selected, false otherwise.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#isTabSelected
 */
SettingsPanel.prototype.isTabSelected = function(tabId) {
    var tabIndex = this.tabIdToIndex[tabId];
    var tab = this.panelTabs[tabIndex];
    return tab && tab.classList.contains('tabselected');
};


/**
 * Gets the id of the selected tab.
 *
 * @returns {string|null} id of the selected tab, or null if none selected. 
 */
SettingsPanel.prototype.getSelectedTabId = function() {
    for (var tabId in this.tabIdToIndex) {
        if (this.isTabSelected(tabId)) {
            return tabId;
        }
    }
    return null;
};

/**
 * Adds a label to the panel.
 *
 * @param {string} tabId - Id of the tab that will contain the button.
 * @param {string} name - User facing text.
 * @returns {object} the label control
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#addLabel
 */
SettingsPanel.prototype.addLabel = function (tabId, name) {
    var table;
    var index = this.tabIdToIndex[tabId];
    if(index === -1) {
        return false;
    }
    table = this.tablesContainer.childNodes[index];
    var settingsLabel = new OptionLabel(name,table.tBodies[0]);
    settingsLabel.setGlobalManager(this.globalManager);
    settingsLabel.sliderRow.classList.add('logical-group');
    return settingsLabel;
};

/**
 * Adds a button to the panel.
 *
 * @param {string} tabId - Id of the tab that will contain the button.
 * @param {string} label - User facing text.
 * @returns {string} ID of a new control.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#addButton
 */
SettingsPanel.prototype.addButton = function(tabId, label) {
    
    var index = this.tabIdToIndex[tabId];
    if (index === undefined)
        return null;

    var table = this.tablesContainer.childNodes[index];
    var btn = new OptionButton(label, table.tBodies[0]);
    btn.setGlobalManager(this.globalManager);

    return this.addControl(tabId, btn);
};

/**
 * Creates a checkbox control and adds it to a given tab.
 *
 * @param {string} tabId - Tab to which to add a new checkbox.
 * @param {string} caption - The text associated with the checkbox.
 * @param {boolean} initialState - Initial value for the checkbox (checked or not).
 * @param {Function} onchange - Callback that is called when the checkbox is changed.
 * @param description
 * @param {object|undefined} options - Additional options:
 * - insertAtIndex - index at which to insert a new checkbox
 * @returns {string} ID of a new control.
 * @alias Autodesk.Viewing.UI.SettingsPanel#addCheckbox
 */
SettingsPanel.prototype.addCheckbox = function(tabId, caption, initialState, onchange, description, options )
{
    var tabIndex = this.tabIdToIndex[tabId];
    if (tabIndex === undefined)
        return null;

    var table = this.tablesContainer.childNodes[tabIndex];

    var checkBoxElem = new OptionCheckbox(caption, table.tBodies[0], initialState, description, options);
    checkBoxElem.setGlobalManager(this.globalManager);
    checkBoxElem.changeListener = function(e) {
        var checked = e.detail.target.checked;
        onchange(checked);
    };
    this.addEventListener(checkBoxElem, "change", checkBoxElem.changeListener);

    return this.addControl( tabId, checkBoxElem );
};

/**
 * Creates a row control and adds it to a given tab.
 * A row only contains a caption and a descriptions
 *
 * @param {string} tabId - Tab to which to add a new row.
 * @param {string} caption - The text associated with the row.
 * @param {string} description - Description
 * @param {object|undefined} options - Additional options:
 * - insertAtIndex - index at which to insert a new row
 * @returns {string} ID of a new control.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#addRow
 */
SettingsPanel.prototype.addRow = function(tabId, caption, description, options ) {

    var tabIndex = this.tabIdToIndex[tabId];
    if (tabIndex === undefined)
        return null;

    var _document = this.getDocument();
    var table = _document.getElementById( this.expandID(tabId + "-table") );

    var rowElem = new OptionRow(caption, table.tBodies[0], description, options );
    rowElem.setGlobalManager(this.globalManager);

    return this.addControl(tabId, rowElem);
};

/**
 * Creates a slider control and adds it to a given tab.
 *
 * @param {string} tabId - Tab to which to add a new slider.
 * @param {string} caption - The text associated with the slider
 * @param {number} min - Min value of the slider.
 * @param {number} max - Max value of the slider.
 * @param {number} initialValue - Initial value for the slider.
 * @param {Function} onchange - Callback that is called when the slider value is changed.
 * @param {object|undefined} options - Additional options:
 * - insertAtIndex - index at which to insert a new slider
 * @returns {string} ID of a new control.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#addSlider
 */
SettingsPanel.prototype.addSlider = function(tabId, caption, min, max, initialValue, onchange, options )
{
    var tabIndex = this.tabIdToIndex[tabId];
    if (tabIndex === undefined)
        return null;

    var _document = this.getDocument();
    var table = _document.getElementById( this.expandID(tabId + "-table") );
    var slider = new OptionSlider(caption, min, max, table.tBodies[0], options);
    slider.setGlobalManager(this.globalManager);
    slider.setValue(initialValue);
    var _step = 1;
    if (options && options.step) {
        _step = options.step;
    }
    slider.sliderElement.step = slider.stepperElement.step = _step;
    this.addEventListener(slider, "change", function(e) {
       onchange(e);
    });

    return this.addControl( tabId, slider );
};



/**
 * Creates a row control and a slider control and adds it to a given tab.
 * The slider does not contain the caption or the stepper.
 * 
 * @see Autodesk.Viewing.UI.SettingsPanel#addRow
 * @see Autodesk.Viewing.UI.SettingsPanel#addSlider
 * 
 * @param {string} tabId - Tab to which to add a new slider.
 * @param {string} caption - The text associated with the slider
 * @param {string} description - The description for the slider
 * @param {number} min - Min value of the slider.
 * @param {number} max - Max value of the slider.
 * @param {number} initialValue - Initial value for the slider.
 * @param {Function} onchange - Callback that is called when the slider value is changed.
 * @param {object|undefined} options - Additional options:
 * - insertAtIndex - index at which to insert a new slider
 * @returns {string[]} - an array of control ids
 *
 *  @alias Autodesk.Viewing.UI.SettingsPanel#addSliderV2
 */
SettingsPanel.prototype.addSliderV2 = function(tabId, caption, description, min, max, initialValue, onchange, options) {
    options = !options ? {} : options;
    // We will always hide the caption and the stepper for this version of the slider.
    options.hideStepper = true;
    options.hideCaption = true;
    const controlIds = [];
    controlIds.push(this.addRow(tabId, caption, description, options));
    controlIds.push(this.addSlider(tabId, caption, min, max, initialValue, onchange, options));
    return controlIds;
};

/**
 * @param {string} tabId - Tab to which to add a new slider.
 * @param {string} caption - The text associated with the slider.
 * @param {Array} items - List of items for the menu.
 * @param {number} initialItemIndex - Initial choice.
 * @param {Function} onchange - Callback that is called when the menu selection is changed.
 * @param {object|undefined} options - Additional options:
 * - insertAtIndex - index at which to insert a new drop down menu
 * @returns {string} ID of a new control.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#addDropDownMenu
 */
SettingsPanel.prototype.addDropDownMenu = function(tabId, caption, items, initialItemIndex, onchange, options )
{
    var tabIndex = this.tabIdToIndex[tabId];
    if (tabIndex === undefined)
        return null;

    var _document = this.getDocument();
    var table = _document.getElementById( this.expandID(tabId + "-table") );

    var menu = new OptionDropDown(caption, table.tBodies[0], items, initialItemIndex, null, this.globalManager, options );
    menu.setGlobalManager(this.globalManager);
    
    this.addEventListener(menu, "change", function(e) {
        onchange(e);
    });

    return this.addControl( tabId, menu );
};

/**
 * Adds a new control to a given tab.
 *
 * @param {string} tabId - Tab to which to add a new.
 * @param {object|HTMLElement} control - Control to add to the given tab.
 * @param {object|undefined} options - Additional parameters:
 * - insertAtIndex - index at which to insert a new control
 * - caption - caption for the control
 * @returns {string} ID of the added control.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#addControl
 */
SettingsPanel.prototype.addControl = function(tabId, control, options)
{
    var tabIndex = this.tabIdToIndex[tabId];
    if (tabIndex === undefined)
        return null;

    // If this is a generic control (not created by one of the convenient methods
    // like addCheckbox, addSlider, etc. then add it to the table first.
    //
    if (!Object.prototype.hasOwnProperty.call(control, "sliderRow")) {
        var atIndex = options && options.insertAtIndex ? options.insertAtIndex : -1;
        var caption = options && options.caption ? options.caption : null;

        var _document = this.getDocument();
        var table = _document.getElementById( this.expandID(tabId + "-table") );
        if (atIndex > table.length)
            atIndex = -1; // add it to the end.
        var sliderRow = table.tBodies[0].insertRow(atIndex);

        var cell = sliderRow.insertCell(0);
        if (caption) {
            var domCaption = _document.createElement("div");
            domCaption.setAttribute( "data-i18n", caption );
            domCaption.textContent = i18n.t( caption );
            cell.appendChild( domCaption );
            cell = sliderRow.insertCell(1);
        }
        else {
            // Span the cell into 3 columns
            cell.colSpan = 3;
        }
        cell.appendChild( control );

        control.sliderRow = sliderRow;
        control.tbody = table.tBodies[0];
    }

    var controlId = this.expandID("adsk_settings_control_id_" + this.controlIdCount.toString());
    this.controlIdCount = this.controlIdCount + 1;
    this.controls[controlId] = control;

    control.parent = this;

    return controlId;
};

/**
 * Removes a given button from the settings panel.
 *
 * @param {string|Autodesk.Viewing.UI.Control} buttonId - button, or button id, to remove.
 * @returns {boolean} True if the button was removed, false otherwise.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#removeButton
 */
SettingsPanel.prototype.removeButton = function(buttonId)
{
    return this.removeControl( buttonId );
};

/**
 * Removes a given checkbox from the settings panel.
 *
 * @param {string|Autodesk.Viewing.UI.Control} checkboxId - Checkbox to remove.
 * @returns {boolean} True if the checkbox was removed, false otherwise.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#removeCheckbox
 */
SettingsPanel.prototype.removeCheckbox = function(checkboxId)
{
    return this.removeControl( checkboxId );
};

/**
 * Removes a given slider from the settings panel.
 *
 * @param {string|Autodesk.Viewing.UI.Control} sliderId - Slider control to remove.
 * @returns {boolean} True if the slider control was removed, false otherwise.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#removeSlider
 */
SettingsPanel.prototype.removeSlider = function(sliderId)
{
    return this.removeControl( sliderId );
};

/**
 * Removes a given dropdown menu from the settings panel.
 *
 * @param {string|Autodesk.Viewing.UI.Control} dropdownMenuId - Dropdown to remove.
 * @returns {boolean} true if the dropdown was removed, false if the dropdown was not removed.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#removeDropdownMenu
 */
SettingsPanel.prototype.removeDropdownMenu = function(dropdownMenuId)
{
    return this.removeControl( dropdownMenuId );
};

/**
 * Removes a given control from the settings panel.
 *
 * @param {string|Autodesk.Viewing.UI.Control} controlId - The control ID or control instance to remove.
 * @returns {boolean} true if the control was removed, false if the control was not removed.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#removeControl
 */
SettingsPanel.prototype.removeControl = function(controlId)
{
    var control;
    if (typeof controlId === "object" && controlId.tbody) {
        control = controlId;
        for (var c in this.controls) {
            if (this.controls[c] === control) {
                controlId = c;
                break;
            }
        }
    } else {
        control = this.controls[controlId];
    }

    if (control === undefined)
        return false;

    // New way is to call a method. 
    if (control.removeFromParent) {
        control.removeFromParent();
    } else {
        var tbody     = control.tbody;
        var sliderRow = control.sliderRow;
        var rowIndex  = sliderRow.rowIndex;
        tbody.deleteRow(rowIndex);
    }

    delete this.controls[controlId];

    control.parent = undefined;

    return true;
};

/**
 * Returns a control with a given id.
 *
 * @param {string} controlId - Checkbox id to return.
 * @returns {object} Control object if found, null otherwise.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#getControl
 */
SettingsPanel.prototype.getControl = function(controlId)
{
    return this.controls[controlId] || null;
};

/**
 * Returns the width and height to be used when resizing the panel to the content.
 *
 * @returns {object} `{height: number, width: number}`.
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#getContentSize
 */
SettingsPanel.prototype.getContentSize = function () {

    var height = this.heightAdjustment;

    // If none of the tabs is selected, then take the fist one (case when
    // there is only one tab).
    var tabHeight = 0;
    var _document = this.getDocument();
    for (var tabIndex = 0; tabIndex < this.panelTabs.length; tabIndex++) {
        var tab = this.panelTabs[tabIndex];
        var table = _document.getElementById(this.expandID(tab._id + "-table")); // TODO: cache elements instead of fetching them from dom.
        var tableHeight = table ? table.clientHeight : 0;
        tabHeight = Math.max(tabHeight, tableHeight);
    }

    return {
        height: height + tabHeight,
        width: this.container.clientWidth
    };
};

/**
 * Resizes panel vertically to wrap around the content.
 * It will always leave some room at the bottom to display the toolbar.
 *
 * @param {HTMLElement} container - parent container of settings panel 
 *
 * @alias Autodesk.Viewing.UI.SettingsPanel#sizeToContent
 */
SettingsPanel.prototype.sizeToContent = function(container) {
    var csize = this.getContentSize();
    var cHeight = csize.height + this.heightAdjustment;
    var maxHeight = container.clientHeight - this.heightAdjustment;
    var minSize = Math.min(cHeight, maxHeight);
    this.container.style.height = parseInt(minSize) + 'px';
};

/**
 * Adds a vertical list UI to the panel.
 *
 * @param {HTMLElement} parentDiv - html element that will contain the list.
 * @param {Function} renderListItem - Callback for rendering list elements with arguments: domElem:HTMLElement, uiItem:Object, options:Object.
 * @param {Function} onClick - callback that gets called when clicking on a grid element. Receives the index that is clicked.
 *
 * @returns {SimpleList}
 *
 * @private
 */
SettingsPanel.prototype.addSimpleList = function(parentDiv, renderListItem, onClick) {

    var simpleList = new SimpleList(parentDiv, renderListItem, onClick);
    simpleList.setGlobalManager(this.globalManager);
    return simpleList;
};

/**
 * Removes a the basic table grid from the supplied parentTable
 *
 * @param {HTMLTableElement} simpleList - parent html table element
 * @returns {boolean} - true if the grid was removed or if there is no grid in the parentTable.
 * @private
 */
SettingsPanel.prototype.removeSimpleList = function(simpleList) {
    if (simpleList) {
        simpleList.removeFromParent();
        return true;
    }
    return false;
};
