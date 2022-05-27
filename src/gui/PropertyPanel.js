
import { DockingPanel } from "./DockingPanel";
import { TreeDelegate } from "./TreeDelegate";
import { Tree } from "./Tree";
import { formatValueWithUnits, calculatePrecision, convertToDisplayUnits } from "../measurement/UnitFormatter";
import i18n from "i18next";
import { isNumericProperty } from '../file-loaders/lmvtk/common/PropdbEnums';


/**
 * The Property Panel displays properties from the whole model or specific parts of it.
 * 
 * @alias Autodesk.Viewing.UI.PropertyPanel
 * @augments Autodesk.Viewing.UI.DockingPanel
 * @param {HTMLElement} parentContainer - The container for this panel.
 * @param {string} id - The id for this panel.
 * @param {string} title - The initial title for this panel.
 * @param {object} [options] - An optional dictionary of options. Currently unused.
 * @class
 */
export function PropertyPanel(parentContainer, id, title, options) {
    DockingPanel.call(this, parentContainer, id, title, options);

    this.title.classList.add("docking-panel-delimiter-shadow");
    this.container.classList.add('property-panel');
    this.container.dockRight = true;

    this.createScrollContainer({left: false, heightAdjustment: 70, marginTop:0});

    this.highlightableElements = {};

    var that = this;

    /**
     *
     */
    function createDelegate() {
        var delegate = new TreeDelegate();
        delegate.setGlobalManager(that.globalManager);

        /**
         * @param object
         * @private
         */
        function isCategory(object) {
            return object.type === 'category';
        }

        delegate.getTreeNodeId = function (node) {
            return node.name + (Object.prototype.hasOwnProperty.call(node, 'value') ? node.value : '') + (Object.prototype.hasOwnProperty.call(node, 'category') ? node.category : '');
        };

        delegate.getTreeNodeClass = function (node) {
            return isCategory(node) ? that.getCategoryClass(node) : that.getPropertyClass(node);
        };

        delegate.isTreeNodeGroup = function (node) {
            return isCategory(node);
        };

        delegate.onTreeNodeClick = function (tree, node, event) {
            if (isCategory(node)) {
                that.onCategoryClick(node, event);
            } else {
                that.onPropertyClick(node, event);
            }
        };

        delegate.onTreeNodeRightClick = function (tree, node, event) {
            if (isCategory(node)) {
                that.onCategoryRightClick(node, event);
            } else {
                that.onPropertyRightClick(node, event);
            }
        };

        delegate.onTreeNodeDoubleClick = function (tree, node, event) {
            if (isCategory(node)) {
                that.onCategoryDoubleClick(node, event);
            } else {
                that.onPropertyDoubleClick(node, event);
            }
        };

        delegate.onTreeNodeIconClick = function (tree, node, event) {
            if (isCategory(node)) {
                that.onCategoryIconClick(node, event);
            } else {
                that.onPropertyIconClick(node, event);
            }
        };

        delegate.createTreeNode = function (node, parent, options) {
            var highlightableElements = null;
            if (isCategory(node)) {
                highlightableElements = that.displayCategory(node, parent, options);
            } else {
                highlightableElements = that.displayProperty(node, parent, options);
            }

            if (highlightableElements) {
                that.highlightableElements[this.getTreeNodeId(node)] = highlightableElements;
            }
        };

        return delegate;
    }

    var delegate = createDelegate();
    this.tree = new Tree(delegate, null, this.scrollContainer, {});
    this.tree.setGlobalManager(this.globalManager);
}

PropertyPanel.prototype = Object.create(DockingPanel.prototype);
PropertyPanel.prototype.constructor = PropertyPanel;


/**
 * Parses the given property set and adds the results to the display panel.
 *
 * @param {Autodesk.Viewing.PropertySet} propSet - A PropertySet containing a map of properties.
 */
PropertyPanel.prototype.setAggregatedProperties = function (propSet) {
    this.removeAllProperties();

    const avp = Autodesk.Viewing.Private;
    const unitsPreference = this.viewer.prefs.get(avp.Prefs.DISPLAY_UNITS);
    let precisionPreference = this.viewer.prefs.get(avp.Prefs.DISPLAY_UNITS_PRECISION);

    const names = Object.prototype.hasOwnProperty.call(propSet.map, "Name") ? propSet.map["Name"].map((entry) => entry.displayValue) : []; 

    function format(val, firstProperty) {
        const valToNum = Number(val);
        // Convert the val to number.
        val = isNaN(valToNum) ? val : valToNum;
        var precision =
            typeof precisionPreference === 'number'
                ? precisionPreference
                : firstProperty.precision || calculatePrecision(val);
        var display = convertToDisplayUnits(val, firstProperty.type, firstProperty.units, unitsPreference);
        return formatValueWithUnits(display.displayValue, display.displayUnits, firstProperty.type, precision);
    }

    // Add the names as the first entry in the Property Panel
    const commonValues = propSet.getValue2PropertiesMap('Name');
    if (commonValues) {
        const commonValueEntries = Object.keys(commonValues);
        if (commonValueEntries.length === 1) {
            // Value will be a string. No need to format
            const value = commonValueEntries[0];
            const css = { name: 'aggregate-name' };
            this.tree.createElement_(
                {
                    name: 'Name',
                    value,
                    type: 'property',
                    category: '',
                    css,
                },
                this.tree.myRootContainer
            );
        } else {
            const node = { name: 'Name', type: 'category', value: 'Varies' };
            const parent = this.tree.createElement_(node, this.tree.myRootContainer);

            // Collapse the name drop down
            this.setCategoryCollapsed(node, true);

            for (let val in commonValues) {
                // Output the common values
                this.tree.createElement_({ name: val, value: '', type: 'property', category: 'Name' }, parent);
            }
        }
    }

    let hasCategories = propSet.getKeysWithCategories().length > 0;

    // Process all of the other displayNames
    propSet.forEach((key, props) => {
        // The name is added as the first entry to the property panel
        if (key === 'Name') {
            return;
        }
        const aggregation = propSet.getAggregation(key);
        const commonValues = propSet.getValue2PropertiesMap(key);

        if (!aggregation && !commonValues) {
            return;
        }

        // The displayName, displayCategory, attributeName, hidden flag should all be the same across all of the props
        const firstProperty = props[0];

        if (firstProperty.hidden) {
            return;
        }
        const hasCategory = !!firstProperty.displayCategory;

        let parent;
        let category = '';

        if (hasCategory) {
            // The property has a displayCategory.
            category = firstProperty.displayCategory;

            parent = this.tree.getElementForNode({ name: category });
            parent =
                parent || this.tree.createElement_({ name: category, type: 'category' }, this.tree.myRootContainer);
        } else if (hasCategories) {
            // The current key doesn't have a category, but if others have a category, we will add the "Other" category
            category = 'Other';

            parent = this.tree.getElementForNode({ name: category });
            if (!parent) {
                let name = category;
                parent = this.tree.createElement_({ name, type: 'category' }, this.tree.myRootContainer);
                // Localize the "Other" category
                const nameElem = parent.children[0].children[1];
                nameElem.setAttribute('data-i18n', name);
                name = i18n.t(name);
                nameElem.textContent = name;
                nameElem.title = name;
            }
        } else {
            parent = this.tree.myRootContainer;
        }

        const commonValueEntries = Object.keys(commonValues);
        if (commonValueEntries.length === 1) {
            let value = commonValueEntries[0];
            value = isNumericProperty(props[0].type) ? format(Number(value), firstProperty) : value;
            parent = this.tree.createElement_(
                {
                    name: firstProperty.displayName,
                    value: value,
                    type: 'property',
                    category: category,
                    css: {
                        name: 'aggregate-name',
                    },
                },
                parent
            );
            return;
        }

        const parentNode = { name: firstProperty.displayName, value: 'Varies', type: 'category', category };

        parent = this.tree.createElement_(parentNode, parent);

        this.setCategoryCollapsed(parentNode, true);

        category = firstProperty.displayName;

        if (hasCategory || hasCategories) {
            parent.classList.add('indented');
        }

        if (aggregation) {
            // Output the aggregation values
            const map = {};
            // format the entries in the aggregation map to contain the precision and units
            for (let entry in aggregation) {
                if (entry === 'count') {
                    map[entry] = aggregation[entry];
                    continue;
                }

                if (entry === 'mode') {
                    map[entry] = aggregation[entry].map((val) => format(val, firstProperty)).join(', ');
                    continue;
                }

                const aggVal = aggregation[entry];
                map[entry] = format(aggVal, firstProperty);
            }
            this.tree.createElement_({ map, default: 'sum', type: 'property', category }, parent);
        }

        const treeNodes = [];

        
        for (let val in commonValues) {
            const value = format(val, firstProperty);
            const name = commonValues[val];

            for (let i = 0; i < name.length; ++i) {
                const idx = names.indexOf(name[i]);
                if (idx > -1) {
                    names.splice(idx, 1);
                }
            }
            treeNodes.push({ name, value, type: 'property', category });
        }

        // Show values that do not have this property.
        if (names.length > 0) {
            this.tree.createElement_({ name: names, value: '--', type: 'property', category }, parent);
        }

        // Output the common values
        treeNodes.forEach((node) => {
            this.tree.createElement_(node, parent);
        });
    });
};

/**
 * Adds the given properties to the display panel.
 *
 * @param {Array} properties - An array of properties, each property represented as {displayName: name, displayValue: value}.
 */
PropertyPanel.prototype.setProperties = function (properties) {
    this.removeAllProperties();

    // Check if any categories need to be displayed.
    //
    var withCategories = [];
    var withoutCategories = [];

    for (let i = 0; i < properties.length; i++) {
        let property = properties[i];
        if (!property.hidden) {
            var category = properties[i].displayCategory;
            if (category && typeof category === 'string' && category !== '') {
                withCategories.push(property);
            } else {
                withoutCategories.push(property);
            }
        }
    }

    if ((withCategories.length + withoutCategories.length) === 0) {
        this.showNoProperties();
        return;
    }

    if (withoutCategories[0] && withoutCategories[0].displayName === 'Name') {
        // The category-less 'Name' property is shown at the top
        this.addProperty(withoutCategories[0].displayName, withoutCategories[0].displayValue);
        withoutCategories.shift();
    }

    const avp = Autodesk.Viewing.Private;
    const unitsPreference = this.viewer.prefs.get(avp.Prefs.DISPLAY_UNITS);
    let precisionPreference = this.viewer.prefs.get(avp.Prefs.DISPLAY_UNITS_PRECISION);

    for (let i = 0; i < withCategories.length; i++) {
        let property = withCategories[i];
        let precision = typeof precisionPreference === 'number' ? precisionPreference : (property.precision || calculatePrecision(property.displayValue));
        let display = convertToDisplayUnits(property.displayValue, property.type, property.units, unitsPreference);
        let value = formatValueWithUnits(display.displayValue, display.displayUnits, property.type, precision);
        this.addProperty(property.displayName, value, property.displayCategory);
    }

    var hasCategories = (withCategories.length > 0);
    for (var i = 0; i < withoutCategories.length; i++) {
        let property = withoutCategories[i];
        let precision = typeof precisionPreference === 'number' ? precisionPreference : (property.precision || calculatePrecision(property.displayValue));
        let display = convertToDisplayUnits(property.displayValue, property.type, property.units, unitsPreference);
        let value = formatValueWithUnits(display.displayValue, display.displayUnits, property.type, precision);
        this.addProperty(property.displayName, value, hasCategories ? 'Other' : '', hasCategories ? {localizeCategory: true} : {});
    }
};

/**
 * Displays only the "No properties" item.
 */
PropertyPanel.prototype.showNoProperties = function () {
    this.removeAllProperties();
    var rootContainer = this.tree.myRootContainer;

    var _document = this.getDocument();
    var message = _document.createElement('div');
    message.className = 'no-properties';

    var text = 'No properties to display';  // string localized below
    message.setAttribute('data-i18n', text);
    message.textContent = i18n.t(text);

    rootContainer.appendChild(message);
};

/**
 * Override this to display the default properties.  The current default is to display no properties.
 */
PropertyPanel.prototype.showDefaultProperties = function () {
    this.showNoProperties();

    this.resizeToContent();
};

/**
 * Override this to return true if the default properties are being displayed.
 */
PropertyPanel.prototype.areDefaultPropertiesShown = function () {
    return !this.hasProperties();
};

/**
 * Adds a property to this panel.  The property is defined by its name, value, and category.  The
 * add will fail if a property with the same name, value, and category already exists.
 *
 * @param {string} name - The name of the property to add.
 * @param {string} value - The value of the property to add.
 * @param {string} category - The category of the property to add.
 * @param {object=} [options] - An optional dictionary of options.
 * @param {boolean} [options.localizeCategory=false] - When true, localization is attempted for the given category
 * @param {boolean} [options.localizeProperty=false] - When true, localization is attempted for the given property
 * @returns {boolean} - true if the property was added, false otherwise.
 */
PropertyPanel.prototype.addProperty = function (name, value, category, options) {
    var element = this.tree.getElementForNode({name: name, value: value, category: category});
    if (element) {
        return false;
    }

    var parent = null;
    var property = {name: name, value: value, type: 'property'};

    if (category) {
        parent = this.tree.getElementForNode({name: category});
        if (!parent) {
            parent = this.tree.createElement_({name: category, type: 'category'}, this.tree.myRootContainer, options && options.localizeCategory ? {localize: true} : null);
        }
        property.category = category;
    } else {
        parent = this.tree.myRootContainer;
    }

    this.tree.createElement_(property, parent, options && options.localizeProperty ? {localize: true} : null);

    return true;
};

/**
 * Returns whether this property panel currently has properties.
 *
 * @returns {boolean} - true if there are properties to display, false otherwise.
 */
PropertyPanel.prototype.hasProperties = function () {
    for (var property in this.highlightableElements) {
        return true;
    }
    return false;
};

/**
 * Removes a property from this panel.  The property is defined by its name, value, and category.
 *
 * @param {string} name - The name of the property to remove.
 * @param {string} value - The value of the property to remove.
 * @param {string} category - The category of the property to remove.
 * @param {object=} [options] - An optional dictionary of options.  Currently unused.
 * @returns {boolean} - true if the property was removed, false otherwise.
 */
PropertyPanel.prototype.removeProperty = function (name, value, category) {
    var property = {name: name, value: value, category: category};
    var element = this.tree.getElementForNode(property);
    if (element) {
        delete this.highlightableElements[this.tree.delegate().getTreeNodeId(property)];
        element.parentNode.removeChild(element);
        return true;
    }
    return false;
};

/**
 * Removes all properties from the panel.
 */
PropertyPanel.prototype.removeAllProperties = function () {
    this.highlightableElements = {};
    this.tree.clear();
};

/**
 * Sets the collapse state of the given category.
 *
 * @param {object} category - A category object.
 * @param {boolean} collapsed - The new collapse state.
 */
PropertyPanel.prototype.setCategoryCollapsed = function (category, collapsed) {
    var id = this.tree.delegate().getTreeNodeId(category);
    this.tree.setCollapsed(id, collapsed);
};

/**
 * Returns whether the given category is currently collapsed.
 *
 * @param {object} category - A category object.
 * @returns {boolean} - true if the category is collapsed, false otherwise.
 */
PropertyPanel.prototype.isCategoryCollapsed = function (category) {
    var id = this.tree.delegate().getTreeNodeId(category);
    return this.tree.isCollapsed(id);
};

/**
 * Returns the width and height to be used when resizing the panel to the content.
 *
 * @returns {{height: number, width: number}}
 */
PropertyPanel.prototype.getContentSize = function () {
    // For the PropertyPanel, it's the size of the tree + some padding value for the height.
    //
    var treeContainer = this.tree.myRootContainer;
    return {height: treeContainer.clientHeight + 55, width: treeContainer.clientWidth};
};

/**
 * Highlights the given text if found in the property name or value.
 *
 * @param {string} text - The text to highlight.
 */
PropertyPanel.prototype.highlight = function (text) {
    /**
     * @param {object} element - Element to hightlight
     */
    function highlightElement(element) {
        var current = element.innerHTML;
        var unhighlighted = current.replace(/(<highlight>|<\/highlight>)/igm, "");
        if (current !== unhighlighted) {
            element.innerHTML = unhighlighted;
        }

        if (text && text !== "") {
            var query = new RegExp("(\\b" + text + "\\b)", "gim");
            var highlighted = unhighlighted.replace(query, "<highlight>$1</highlight>");
            element.innerHTML = highlighted;
        }
    }

    for (var property in this.highlightableElements) {
        var elements = this.highlightableElements[property];
        for (var i = 0; i < elements.length; ++i) {
            highlightElement(elements[i]);
        }
    }
};

/**
 * Creates and adds the HTML elements to display the given category.
 *
 * @param {object} category - A category object.
 * @param {HTMLElement} parent - The parent to attach the new HTML elements.
 * @param {object=} [options] - An optional dictionary of options.
 * @param {boolean} [options.localize=false] - When true, localization is attempted for the given category name.
 *
 * @returns {Array} elementList - the list of HTML elements to include when highlighting.
 *                                Warning:  ensure no event listeners are attached to these elements
 *                                as they will be lost during highlighting.
 */
PropertyPanel.prototype.displayCategory = function (category, parent, options) {
    var _document = this.getDocument();
    var name = _document.createElement('div');

    var text = category.name;
    if (options && options.localize) {
        name.setAttribute('data-i18n', text);
        text = i18n.t(text);
    }

    name.textContent = text;
    name.title = text;
    name.className = 'category-name';
    parent.appendChild(name);

    const ret = [name];

    if (category.value) {
        var value = _document.createElement('div');
        value.textContent = category.value;
        var s = category.value;
        value.title = s;
        s = replaceUrls(s);
        value.innerHTML = s;
        value.className = 'category-value';
        parent.appendChild(value);
        ret.push(value);
    }

    // Make the category name highlightable.
    //
    return ret;
};

/**
 * @param {string} s - String to replace
 * @private
 */
function replaceUrls(s) {
    s = String(s); // Make sure we only get Strings here!
    var t = ' target="blank" class="propertyLink" ';
    var patternMap = [{
      pattern: /\b(?:https?|ftp):\/\/[a-z0-9-+&@#/%?=~_|()!:,.;]*[a-z0-9-+&@#/%=~_|()]/gim,
      value: '<a' + t + 'href="$&">$&</a>'
    }, {
      pattern: /(^|[^/])(www\.[\S]+(\b|$))/gim,
      value: '$1<a' + t + 'href="http://$2">$2</a>'
    }];
    return patternMap.reduce(function(a, b){
      return a.replace(b.pattern, b.value);
    }, s);
}

/**
 * Creates and adds the HTML elements to display the given property.
 *
 * @param {object} property - A property object.
 * @param {HTMLElement} parent - The parent to attach the new HTML elements.
 * @param {object=} [options] - An optional dictionary of options.
 * @param {boolean} [options.localize=false] - When true, localization is attempted for the given property name.
 *
 * @returns {Array} elementList - the list of HTML elements to include when highlighting.
 *                                Warning:  ensure no event listeners are attached to these elements
 *                                as they will be lost during highlighting.
 */
PropertyPanel.prototype.displayProperty = function (property, parent, options) {
    var _document = this.getDocument();

    var separator = _document.createElement('div');
    separator.className = 'separator';

    var name;
    if (property.map) {
        // Creates a drop down menu for the property name.
        name = _document.createElement('select');
        for (let entry in property.map) {
            var item = _document.createElement('option');
            item.value = entry;
            entry = entry.charAt(0).toUpperCase() + entry.slice(1);
            item.setAttribute('data-i18n', entry);
            item.textContent = i18n.t(entry);
            name.add(item);
        }

        name.value = property.default;
        property.value = property.map[property.default];

        name.className = 'property-drop-down';
        separator.innerText = '=';
    } else {
        // for single object section
        name = _document.createElement('div');
        var text = property.name;
        if (options && options.localize) {
            name.setAttribute('data-i18n', text);
            text = i18n.t(text);
        }

        name.textContent = text;
        name.title = text;
        name.className = 'property-name';
    }
    
    var value = _document.createElement('div');
    value.textContent = property.value;

    var s = property.value;
    value.title = s;
    s = replaceUrls(s);
    value.innerHTML = s;

    value.className = 'property-value';

    if (property.map) {
        name.addEventListener(
            'change',
            (e) => {
                const entry = e.target.value;
                const newVal = property.map[entry];
                value.title = newVal;
                value.innerHTML = newVal;
            },
            false
        );
    }

    const cssMap = property.css;
    if (cssMap) {
        if (cssMap.name) {
            name.classList.add(cssMap.name);
        }

        if (cssMap.value) {
            value.classList.add(cssMap.value);
        }
    }

    parent.appendChild(name);
    parent.appendChild(separator);
    parent.appendChild(value);

    // Make the property name and value highlightable.
    //
    return [name, value];
};

/**
 * Override this to specify the CSS classes of a category. This way, in CSS, the designer
 * can specify custom styling for specific category types.
 *
 * @param {object} category
 * @returns {string} - CSS classes for the category.
 */
PropertyPanel.prototype.getCategoryClass = function () {
    return 'category';
};

/**
 * Override this to specify the CSS classes of a property. This way, in CSS, the designer
 * can specify custom styling for specific property types.
 *
 * @param {object} property
 * @returns {string} - CSS classes for the property.
 */
PropertyPanel.prototype.getPropertyClass = function () {
    return 'property';
};

/**
 * Override this method to do something when the user clicks on a category.  The default
 * implementation is to toggle the collapse state of the category.
 *
 * @param {object} category
 * @param {Event} event
 */
PropertyPanel.prototype.onCategoryClick = function (category) {
    this.setCategoryCollapsed(category, !this.isCategoryCollapsed(category));
};

/**
 * Override this method to do something when the user clicks on a property.
 *
 * @param {object} property
 * @param {Event} event
 */
PropertyPanel.prototype.onPropertyClick = function () {
};

/**
 * Override this method to do something when the user clicks on a category's icon.  The default
 * implementation is to toggle the collapse state of the category.
 *
 * @param {object} category
 * @param {Event} event
 */
PropertyPanel.prototype.onCategoryIconClick = function (category) {
    this.setCategoryCollapsed(category, !this.isCategoryCollapsed(category));
};

/**
 * Override this method to do something when the user clicks on a property's icon.
 *
 * @param {object} property
 * @param {Event} event
 */
PropertyPanel.prototype.onPropertyIconClick = function () {
};

/**
 * Override this method to do something when the user double clicks on a category.
 *
 * @param {object} category
 * @param {Event} event
 */
PropertyPanel.prototype.onCategoryDoubleClick = function () {
};

/**
 * Override this method to do something when the user double clicks on a property.
 *
 * @param {object} property
 * @param {Event} event
 */
PropertyPanel.prototype.onPropertyDoubleClick = function () {
};

/**
 * Override this method to do something when the user right clicks on a category.
 *
 * @param {object} category
 * @param {Event} event
 */
PropertyPanel.prototype.onCategoryRightClick = function () {
};

/**
 * Override this method to do something when the user right clicks on a property.
 *
 * @param {object} property
 * @param {Event} event
 */
PropertyPanel.prototype.onPropertyRightClick = function () {
};
