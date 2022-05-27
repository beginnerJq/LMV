
import { PropertyPanel } from "./PropertyPanel";
import { ViewerPanelMixin } from "./ViewerPanelMixin";
import * as et from "../application/EventTypes";
import { DockingPanel } from "./DockingPanel";
import { logger } from '../logger/Logger';


/** @constructor */
export function ViewerPropertyPanel(viewer) {
    this.viewer = viewer;
    this.setGlobalManager(viewer.globalManager);
    this.currentNodeIds = [];
    this.currentModel = null;

    this.currentSelections = [];
    this.isDirty = true;
    this.propertyNodeId = null;
    this.normalTitle = 'Properties';
    this.loadingTitle = 'Object Properties Loading';
    this._viewDbId = null;

    this.onProperties = this.onProperties.bind(this);
    this.onPropertySet = this.onPropertySet.bind(this);
    this.onPropError = this.onPropError.bind(this);
    this.setPropertiesIntoUI = this.setPropertiesIntoUI.bind(this);
    this.setAggregatedPropertiesIntoUI = this.setAggregatedPropertiesIntoUI.bind(this);
    this._onDisplayUnitPreferenceChanged = this._onDisplayUnitPreferenceChanged.bind(this);

    PropertyPanel.call(this, viewer.container, 'ViewerPropertyPanel', this.loadingTitle);
}

ViewerPropertyPanel.prototype = Object.create(PropertyPanel.prototype);
ViewerPropertyPanel.prototype.constructor = ViewerPropertyPanel;
ViewerPanelMixin.call( ViewerPropertyPanel.prototype );

function isSolidWorks(model) {
    var docNode = model.getDocumentNode();
    var viewable = docNode && docNode.findViewableParent();

    if (viewable && viewable.name().toLocaleLowerCase().indexOf(".sld") !== -1) {
        return true;
    }

    return false;
}

ViewerPropertyPanel.prototype._onDisplayUnitPreferenceChanged = function () {
    this.isDirty = true;
    const rootId = this.currentModel ? this.currentModel.getRootId() : null;
    // If a non-root's property is currently displayed, continue showing it
    if (this.propertyNodeId !== null && this.propertyNodeId !== rootId) {
        const aggSelectObj = { model: this.currentModel };//
        aggSelectObj.selection = Array.isArray(this.propertyNodeId) ? this.propertyNodeId : [this.propertyNodeId];
        this.requestAggregatedNodeProperties(aggSelectObj);
    } else {
        this.requestProperties();
    }
};

ViewerPropertyPanel.prototype.initialize = function () {
    PropertyPanel.prototype.initialize.call(this);

    var that = this;

    this.viewer.prefs.addListeners(Autodesk.Viewing.Private.Prefs.DISPLAY_UNITS, this._onDisplayUnitPreferenceChanged);

    this.viewer.prefs.addListeners(Autodesk.Viewing.Private.Prefs.DISPLAY_UNITS_PRECISION, this._onDisplayUnitPreferenceChanged);

    that.addEventListener(that.viewer, et.AGGREGATE_SELECTION_CHANGED_EVENT, function (event) {

        if (event.selections && event.selections.length) {
            that.currentNodeIds = event.selections[0].dbIdArray;
            that.currentModel = event.selections[0].model;
            
            that.currentSelections = [];
            event.selections.forEach((entry) => {
                that.currentSelections.push({model: entry.model, selection: entry.dbIdArray});
            });
        } else {
            that.resetCurrentModel();
        }

        that.isDirty = true;
        that.requestProperties();
    });

    // Handles showing properties for the dbIds provided for a model
    that.addEventListener(that.viewer, et.SHOW_PROPERTIES_EVENT,function (event) {

        if(event && event.dbId) {
            that.currentModel = event.model;
            that.requestAggregatedNodeProperties({ model: event.model, selection: [event.dbId] });
        }
    });

    that.addEventListener(that.viewer, et.HIDE_EVENT, function (e) {
        that.isDirty = true;
        that.requestProperties();
    });

    // Make sure that props are refreshed if instanceTree was not available before.
    that.addEventListener(that.viewer, et.OBJECT_TREE_CREATED_EVENT, function (e) {
        if (that.currentModel === e.model) {
            that.isDirty = true;
            that.requestProperties();
        }
    });

    that.addEventListener(that.viewer, et.SHOW_EVENT, function (e) {
        that.isDirty = true;
        that.requestProperties();
    });

    // Populate the ids with the current selection.
    //
    var aggregateSelection = this.viewer.getAggregateSelection();
    if (aggregateSelection.length) {
        this.currentModel = aggregateSelection[0].model;
        this.currentNodeIds = aggregateSelection[0].selection;
        this.currentSelections = aggregateSelection;
    } else {
        this.resetCurrentModel();
    }

};

// Reset current model to the only visible one (or null if there is no unique visible model)
ViewerPropertyPanel.prototype.resetCurrentModel = function() {
    // If only a single model is visible, show model props by default
    var visibleModels = this.viewer ? this.viewer.getVisibleModels() : [];
    this.currentModel = visibleModels.length === 1 ? visibleModels[0] : null;

    this.currentNodeIds = [];
    this.currentSelections = [];
};

ViewerPropertyPanel.prototype.setTitle = function (title, options) {
    if (!title) {
        title = 'Object Properties';  // localized by DockingPanel.prototype.setTitle
        options = options || {};
        options.localizeTitle = true;
    }
    PropertyPanel.prototype.setTitle.call(this, title, options);
};

ViewerPropertyPanel.prototype.setVisible = function (show) {
    DockingPanel.prototype.setVisible.call(this, show);
    this.requestProperties();
};

ViewerPropertyPanel.prototype.visibilityChanged = function() {
    DockingPanel.prototype.visibilityChanged.call(this);
    if (this.isVisible())
        this.requestProperties();
};

ViewerPropertyPanel.prototype.requestProperties = function () {
    if (this.isVisible() && this.isDirty) {
        if (this.currentSelections.length > 0) {
            this.requestAggregatedNodeProperties(this.currentSelections);
        } else {
            this.showDefaultProperties();
        }
        this.isDirty = false;
    }
};

/**
 * Populates property data into the UI.
 * It might fetch additional data for particular dbIds.
 *
 * @param {object} result - Value passed back from the property worker.
 * @private
 */
ViewerPropertyPanel.prototype.onProperties = function (result) {
    // Prevent trying to make changes after dialog was uninitialized.
    if (!this.viewer || !this.currentModel)
        return;

    // Ignore callback if outdated: Another id/model may have been selected meanwhile.
    // Note that that.currentModel may also be null meanwhile if selection was cleared
    // and the number of visible models is !=1.
    if (result.dbId !== this.propertyNodeId) {
        return;
    }

    // Handle __internalref__ properties to support Solidworks
    // And for finding Revit sheet properties, which are children
    // of the root model properties.
    var internalRefIds = [];
    var props = result.properties;
    if (props) {
        for (var i=0, len=props.length; i<len; ++i) {
            var prop = props[i];
            if (prop.displayCategory === "__internalref__") {
                internalRefIds.push(prop.displayValue);
            }
        }
    }

    var prom;
    const model = this.currentModel;
    
    if (model.is3d() && isSolidWorks(model) && internalRefIds.length > 0) {
        // Solidworks or similar file type containing a Configuration __internalref__
        // Get the properties of all the internalref nodes and merge them with the properties already fetched.
        prom = fetchAndMerge(model, internalRefIds, result);
    } /*else if (model.is2d() && !that.isSelection) {
        // for sheets return only the sheet properties, if we can find them
        // and if it is not a selection
        prom = getSheetProperties(model, internalRefIds);
    }*/
    else {
        //All other cases, just return the node properties
        prom = Promise.resolve(result);
    }

    prom.then( this.setPropertiesIntoUI )
        .catch(() => {
            this.setProperties([]);
            this.highlight('');
            this.resizeToContent();
            this.respositionPanel();
        }
    );
};

/**
 * Populates property set data into the UI.
 * It might fetch additional data for particular dbIds.
 *
 * @param {Autodesk.Viewing.PropertySet} propSet - Value passed back from the property worker.
 * @private
 */
ViewerPropertyPanel.prototype.onPropertySet = function (propSet) {
    // Prevent trying to make changes after dialog was uninitialized.
    if (!this.viewer || !this.currentModel) return;

    const visibleKeys = propSet.getVisibleKeys();
    if (visibleKeys.length === 0) {
        this.onPropError();
        this.resizeToContent();
        this.respositionPanel();
        return;
    }

    // Handle __internalref__ properties to support Solidworks
    // And for finding Revit sheet properties, which are children
    // of the root model properties.
    const map = propSet.map;
    const internalRefIds = [];
    const ids = propSet.getValidIds(null, '__internalref__');
    ids.forEach((id) => {
        const props = map[id];
        props.forEach((prop) => {
            // Add the internalref dbid only if is unique.
            if (!internalRefIds.includes(prop.displayValue)) {
                internalRefIds.push(prop.displayValue);
            }
        });
    });

    let prom;
    const model = this.currentModel;

    if (model.is3d() && isSolidWorks(model) && internalRefIds.length > 0) {
        // Solidworks or similar file type containing a Configuration __internalref__
        // Get the properties of all the internalref nodes and merge them with the properties already fetched.
        prom = fetchAndMergePropSet(model, internalRefIds, propSet);
    } else {
        //All other cases, just return the node properties
        prom = Promise.resolve(propSet);
    }

    prom.then(this.setAggregatedPropertiesIntoUI).catch((err) => {
        logger.error(err);
        this.setProperties([]);
        this.highlight('');
        this.resizeToContent();
        this.respositionPanel();
    });
};

/**
 * Helper method to update UI panel with property data.
 *
 * @param {object} result - Value passed back from the property worker.
 *
 * @private
 */
ViewerPropertyPanel.prototype.setAggregatedPropertiesIntoUI = function (propSet) {
    const numSelection = propSet.getDbIds().length;
    if (numSelection === 1) {
        let hasName = Object.prototype.hasOwnProperty.call(propSet.map, 'Name');
        let title = hasName ? propSet.map['Name'][0] : this.normalTitle;

        if (typeof title === 'object' && Object.prototype.hasOwnProperty.call(title, 'displayValue')) {
            hasName = true;
            title = title.displayValue;
        }
        this.setTitle(title, {localizeTitle: !hasName} );
    } else {
        this.setTitle('Properties %(value)', { localizeTitle: true, i18nOpts: { value: `(${numSelection})` } });
    }
    this.setAggregatedProperties(propSet);
    this.highlight(this.viewer.searchText);
    this.resizeToContent();
    this.respositionPanel();
};

/**
 * Helper method to update UI panel with property data.
 *
 * @param {object} result - Value passed back from the property worker.
 *
 * @private
 */
ViewerPropertyPanel.prototype.setPropertiesIntoUI = function(result) {
    var title = result.name || this.normalTitle;
    var doLocalize = !result.name;
    this.setTitle(title, {localizeTitle: doLocalize});
    if ('name' in result && result.properties) {
        // name is displayed in the title,but ctrl/cmd+c doesn't work there
        // So we include it again in the property list
        result.properties.splice(0, 0, {
            "displayName": 'Name',
            "displayValue": result.name,
            "displayCategory": null,
            "attributeName": 'Name',
            "type": 20,
            "units": null,
            "hidden": false,
            "precision": 0
        });
    }
    this.setProperties(result.properties);
    this.highlight(this.viewer.searchText);

    this.resizeToContent();
    this.respositionPanel();
};

/**
 * The on error callback for the getProperties function.
 * This will set the property panel for models that do not contain any properties.
 * @private
 */
ViewerPropertyPanel.prototype.onPropError = function() {
    this.setTitle(this.normalTitle, { localizeTitle: true });
    this.showNoProperties();
};

/**
 * Requests properties for the specified aggregate selection objects. This method will populate the result into the UI.
 * This works for multiple models
 * 
 * @private
 */
ViewerPropertyPanel.prototype.requestAggregatedNodeProperties = function(aggregatedSelection) {
    aggregatedSelection = Array.isArray(aggregatedSelection) ? aggregatedSelection : [aggregatedSelection];

    // Assign the propertyNodeId, to keep the previous functionality as in requestNodeProperties
    if (aggregatedSelection.length === 1 && aggregatedSelection[0].selection?.length === 1) {
        this.propertyNodeId = aggregatedSelection[0].selection[0];
    }

    const promises = [];
    aggregatedSelection.forEach((entry) => {
        promises.push(entry.model.getPropertySetAsync(entry.selection, {fileType: entry.model.getData()?.loadOptions?.fileExt, needsExternalId: entry.model.getData()?.loadOptions?.needsExternalId}));
    });

    Promise.all(promises).then((propSets) => {
        const propSet = propSets[0];
        for (let i = 1; i < propSets.length; i++) {
            propSet.merge(propSets[i]);
        }

        this.onPropertySet(propSet);
    }).catch(this.onPropError);
};

/**
 * Requests properties from the property worker and populates the result into the UI.
 * This only applies to a single model loaded into the viewer.
 * 
 * @private
 */
ViewerPropertyPanel.prototype.requestNodeProperties = function (nodeId) {
    const model = this.currentModel;
    this.propertyNodeId = nodeId;

    const isPropSet = Array.isArray(nodeId);
    const propApi = isPropSet ? model.getPropertySet.bind(model) : model.getProperties2.bind(model);

    // For multiple nodeIds we want to call the getPropertySet and the onPropertySet methods.
    propApi(
        nodeId,
        (results) => {
            if (!this.viewer || model !== this.currentModel) return;

            if (isPropSet) {
                this.onPropertySet(results);
            } else {
                this.onProperties(results);
            }
        },
        this.onPropError
    );
};

// backwards compatibility. Remove in v8.0.
ViewerPropertyPanel.prototype.setNodeProperties = ViewerPropertyPanel.prototype.requestNodeProperties;

/**
 * Requests properties for the specified BubbleNode.
 * @param {Autodesk.Viewing.BubbleNode} bubbleNode - the model's bubble node.
 */
ViewerPropertyPanel.prototype.requestViewProperties = function (bubbleNode) {
    // Set the node properties to the cached view dbid.
    if (this._viewDbId !== null) {
        const aggSelectObj = { model: this.currentModel, selection: [this._viewDbId] };
        this.requestAggregatedNodeProperties(aggSelectObj);
        return;
    }

    const model = this.currentModel;
    const rootId = model.getRootId();
    this.propertyNodeId = rootId;

    model.getPropertySet(
        [rootId],
        (propSet) => {
            // Prevent trying to make changes after dialog was uninitialized.
            if (!this.viewer) return;
            if (model !== this.currentModel) return;
            this._viewDbId = rootId;
            const docName = bubbleNode.name();
            const isSheet = bubbleNode.isSheet();
            const viewIds = [];
            const sheetIds = [];

            const sheetKeys = propSet.getValidIds('Sheet');
            const viewKeys = propSet.getValidIds('View');

            sheetKeys.forEach((key) => {
                propSet.map[key].forEach((prop) => {
                    // store the sheet dbid
                    sheetIds.push(prop.displayValue);
                });
            });

            viewKeys.forEach((key) => {
                propSet.map[key].forEach((prop) => {
                    // store the sheet dbid
                    viewIds.push(prop.displayValue);
                });
            });

            const viewableIds = isSheet ? sheetIds : viewIds;
            // Set the properties to the root id if no view or sheet properties were found.
            if (viewableIds.length === 0) {
                this.onPropertySet(propSet);
                return;
            }
            // Get the properties associated with the view dbIds or sheet dbIds.
            var that = this;
            model.getBulkProperties2(viewableIds, { propFilter: ['name', 'dbId'], ignoreHidden: true }, function (res) {
                const foundIds = [];
                for (let i = 0; i < res.length; ++i) {
                    if (docName.indexOf(res[i].name) !== -1) {
                        const nodeId = res[i].dbId;
                        // Views will not have duplicate names.
                        if (!isSheet) {
                            // cache the view dbid
                            that._viewDbId = nodeId;
                            that.requestAggregatedNodeProperties({ model: that.currentModel, selection: [nodeId] });
                            return;
                        }
                        // There might be multiple sheets with the same name
                        foundIds.push(nodeId);
                    }
                }

                if (foundIds.length === 0) {
                    that.onPropertySet(propSet);
                    return;
                }

                // Make sure that the sheet number property matches.
                // There might be duplicate sheet names, the only difference will be the sheet number.
                getSheetProperties(model, foundIds, docName).then(function (prop) {
                    if (prop && prop.dbId && prop.dbId !== rootId) {
                        that._viewDbId = prop.dbId;
                        that.requestAggregatedNodeProperties({ model: that.currentModel, selection: [prop.dbId] });
                    } else {
                        that.onPropertySet(propSet);
                    }
                });
            });
        },
        this.onPropError
    );
};

/*
Call this method when the current model is a sheet and its default properties are required.
If the sheet could not be found, result is null.
 */
function getSheetProperties(model, dbIds, sheetName) {
    return new Promise(function(resolve, reject){
        // given sheet name of the 2d model
        sheetName = sheetName || model.myData.metadata.title;
        model.getBulkProperties2(dbIds, {ignoreHidden: true}, function(bulkResults){

            for (var x=0, xLen=bulkResults.length; x<xLen; ++x) {
                var result = bulkResults[x];
                // property name occurs in the sheet name
                if (result.name && sheetName.indexOf(result.name) !== -1) {

                    for (var i=0, len=result.properties.length; i<len; ++i) {
                        var prop = result.properties[i];
                        // sheet number additionally occurs in the sheet name
                        if (prop.displayName === 'Sheet Number' && sheetName.indexOf(prop.displayValue) !== -1) {
                            return resolve(result);
                        }
                    }
                }
            }

            return resolve(null);
        });
    });
}

function fetchAndMergePropSet(model, dbIds, previousPropSet) {
    return new Promise((resolve, reject) => {
        model.getPropertySet(
            dbIds,
            (propSet) => {
                resolve(previousPropSet.merge(propSet));
            },
            reject,
            { ignoreHidden: true }
        );
    });
}

function fetchAndMerge(model, dbIds, previousResult) {
    return new Promise(function(resolve, reject){
        model.getBulkProperties2(dbIds, {ignoreHidden: true}, function(bulkResults){
            for (var x=0, xLen=bulkResults.length; x<xLen; ++x) {
                var result = bulkResults[x];
                // Merge additional properties 
                for (var i=0, len=result.properties.length; i<len; ++i) {
                    var prop = result.properties[i];
                    // Only merge new properties
                    var isNewProperty = true;
                    for (var j=0, len2=previousResult.properties.length; j<len2; ++j) {
                        if (previousResult.properties[j].displayName === prop.displayName) {
                            isNewProperty = false;
                            j = len2; // aka: break;
                        }
                    }
                    if (isNewProperty) {
                        previousResult.properties.push(prop);
                    }
                }
            }
            resolve(previousResult);
        });
    });
}

ViewerPropertyPanel.prototype.respositionPanel = function() {
    
    if (!this.isVisible())
        return;

    // Does the property panel overlap the mouse position? If so, then reposition
    // the property panel. Prefer a horizontal vs. vertical reposition.
    //
    var toolController = this.viewer.toolController,
    mx = toolController.lastClickX,
    my = toolController.lastClickY,
    panelRect = this.container.getBoundingClientRect(),
    px = panelRect.left,
    py = panelRect.top,
    pw = panelRect.width,
    ph = panelRect.height,
    canvasRect = this.viewer.impl.getCanvasBoundingClientRect(),
    cx = canvasRect.left,
    cy = canvasRect.top,
    cw = canvasRect.width,
    ch = canvasRect.height;

    if ((px <= mx && mx < px + pw) && (py <= my && my < py + ph)) {
        if ((mx < px + (pw / 2)) && (mx + pw) < (cx + cw)) {
            this.container.style.left = Math.round(mx - cx) + 'px';
            this.container.dockRight = false;
        } else if (cx <= (mx - pw)) {
            this.container.style.left = Math.round(mx - cx - pw) + 'px';
            this.container.dockRight = false;
        } else if ((mx + pw) < (cx + cw)) {
            this.container.style.left = Math.round(mx - cx) + 'px';
            this.container.dockRight = false;
        } else if ((my + ph) < (cy + ch)) {
            this.container.style.top = Math.round(my - cy) + 'px';
            this.container.dockBottom = false;
        } else if (cy <= (my - ph)) {
            this.container.style.top = Math.round(my - cy - ph) + 'px';
            this.container.dockBottom = false;
        }
    }
};

ViewerPropertyPanel.prototype.showDefaultProperties = function () {
    var rootId = this.currentModel ? this.currentModel.getRootId() : null;
    if (rootId) {
        const docNode = this.currentModel.getDocumentNode();
        if (docNode && !docNode.isMasterView()) {
            this.requestViewProperties(docNode);
        } else {
            this.requestAggregatedNodeProperties({ model: this.currentModel, selection: [rootId] });
        }
        
    } else {
        this.propertyNodeId = null;
        this.setTitle(this.normalTitle, {localizeTitle: true});  // localized by DockingPanel.prototype.setTitle
        PropertyPanel.prototype.showDefaultProperties.call(this);
    }
};

ViewerPropertyPanel.prototype.areDefaultPropertiesShown = function () {
    if (!this.currentModel)
        return false;
    var rootId = this.currentModel.getRootId();
    return this.propertyNodeId === rootId;
};

ViewerPropertyPanel.prototype.uninitialize = function () {
    PropertyPanel.prototype.uninitialize.call(this);

    this.viewer.prefs.removeListeners(Autodesk.Viewing.Private.Prefs.DISPLAY_UNITS, this._onDisplayUnitPreferenceChanged);
    this.viewer.prefs.removeListeners(Autodesk.Viewing.Private.Prefs.DISPLAY_UNITS_PRECISION, this._onDisplayUnitPreferenceChanged);

    this.viewer = null;
    this._viewDbId = null;
    this.currentModel = null;
    this.currentSelections = [];
    this.propertyNodeId = null;
    this.currentNodeIds = null;
};

ViewerPropertyPanel.prototype.onCategoryClick = function (category, event) {
    PropertyPanel.prototype.onCategoryClick.call(this, category, event);
    this.resizeToContent();
};

ViewerPropertyPanel.prototype.onCategoryIconClick = function (category, event) {
    PropertyPanel.prototype.onCategoryIconClick.call(this, category, event);
    this.resizeToContent();
};
