
import { SelectionMode } from "../wgs/scene/SelectionMode";
import { SelectionType } from './SelectionType';
import { errorCodeString, ErrorCodes } from "../file-loaders/net/ErrorCodes";
import { logger } from "../logger/Logger";
import * as et from "../application/EventTypes";
import * as THREE from "three";

/**
 * The selector class doesn't fire any events.
 * All events get fired by the MultiSelector class, instead.
 * 
 * @param {*} viewer 
 * @param {*} model 
 */
export function Selector(viewer, model) {

    //Selection support
    var _this = this;
    this.selectedObjectIds = {}; // Stores selectionType per dbId (or 0 if not selected)
    this.selectionCount = 0;
    this.selectionMode = SelectionMode.LEAF_OBJECT;
    this.lockedNodes = []; // Keep track of the locked dbIds

    var selectedParentMap = {};

    function getInstanceTree() {
        return model.getData().instanceTree;
    }
    
    function unmarkObject(dbId) {

        var it = getInstanceTree();

        if (selectedParentMap[dbId] > 0) {
            selectedParentMap[dbId]--;
            if (selectedParentMap[dbId] == 0) {
                viewer.highlightObjectNode(model, dbId, false);
            }

        } else if (selectedParentMap[dbId] < 0) {
            throw ("Selection State machine broken. Negatively selected object!");
        }

        if (it) {
            it.enumNodeChildren(dbId, function(childId) {
                unmarkObject(childId);
            }, false);
        }
    }
    

    function markObject(dbId, isChild, selectionType) {

        var it = getInstanceTree();

        if (selectedParentMap[dbId]) {
            selectedParentMap[dbId]++;
        } else {
            switch(selectionType) {
                default:
                case SelectionType.MIXED:
                    viewer.highlightObjectNode(model, dbId, true, isChild);
                    break;
                case SelectionType.REGULAR:
                    viewer.highlightObjectNode(model, dbId, true, true);
                    break;
                case SelectionType.OVERLAYED:
                    viewer.highlightObjectNode(model, dbId, true, false);
                    break;
            }
            selectedParentMap[dbId] = 1;
        }

        if (it) {
            it.enumNodeChildren(dbId, function(childId) {
                markObject(childId, true, selectionType);
            }, false);
        }
    }

    function isSelected(dbId) {

        if ((dbId !== undefined) && _this.selectedObjectIds[dbId])
            return true;
    }

    function getSelectionMode() {
        const isIfc = model.getData()?.loadOptions?.fileExt === 'ifc';
        const selectionModeChosen = viewer.api.prefs.getPrefFromLocalStorage(Autodesk.Viewing.Private.Prefs3D.SELECTION_MODE) !== undefined;

        // https://jira.autodesk.com/browse/BLMV-6235
        //
        // Following some research and experimentation with IFC object hierarchy and properties,
        // the recommendation is to change the default selection mode setting for IFC files only to "First Object".
        // If the user changed the default settings in the settings panel - the selected setting should be persisted in browser cache and applied to all file types (both IFC and non-IFC).
        if (isIfc && !selectionModeChosen) {
            return Autodesk.Viewing.SelectionMode.FIRST_OBJECT;
        } else {
            return _this.selectionMode;
        }
    }


    function select(dbId, selectionType) {
        // Make sure that the node selection is not turned on.
        const isLocked = _this.isNodeSelectionLocked(dbId);
        if (isLocked) return;
        var it = getInstanceTree();
        selectionType = selectionType || SelectionType.MIXED;
                                            
        if (it) {
            const selectionMode = getSelectionMode();
            dbId = it.findNodeForSelection(dbId, selectionMode);
            if (!it.isNodeSelectable(dbId))
                return;
        }

        var found = isSelected(dbId);
        if (!found) {
            _this.selectedObjectIds[dbId] = selectionType;
            _this.selectionCount++;
            markObject(dbId, false, selectionType);
        }
    }

    function deselect(dbId) {

        var found = isSelected(dbId);
        if (found) {
            unmarkObject(dbId);
            _this.selectedObjectIds[dbId] = 0;
            _this.selectionCount--;
        }
    }

    function selectionIsEqual(dbNodeArray) {
        if( _this.selectionCount !== dbNodeArray.length )
            return false;

        for (var i = 0; i < dbNodeArray.length; i++) {
            if (!isSelected(dbNodeArray[i]))
                return false;
        }
        return true;
    }


    this.getInstanceTree = getInstanceTree;

    // @returns {boolean} true when a part of the model is selected
    this.hasSelection = function() {
        return _this.selectionCount > 0;
    }

    this.getSelectionLength = function() {
        return _this.selectionCount;
    };


    this.getSelection = function() {
        var ret = [];
        var sset = _this.selectedObjectIds;
        for (var p in sset) {
            if (sset[p]) {
                var dbId = parseInt(p);
                ret.push(dbId);
            }
        }

        return ret;
    };

    this.isSelected = function(dbId) {
        return isSelected(dbId);
    };

    this.clearNodeSelection = function(dbId) {
        if (dbId === undefined || this.selectionCount === 0) return false;
        unmarkObject(dbId);
        delete _this.selectedObjectIds[dbId];
        return true;
    };

    this.clearSelection = function(nofire) {
        if (this.selectionCount > 0) {
            var sset = _this.selectedObjectIds;
            for (var p in sset) {
                var dbId = parseInt(p);
                if (dbId !== undefined)
                    unmarkObject(dbId);
            }
            _this.selectedObjectIds = {};
            _this.selectionCount = 0;
            return true;
        }
    };

    this.deselectInvisible = function() {
        var changed = false;

        var sset = _this.selectedObjectIds;
        var visMan = viewer.visibilityManager;
        for (var p in sset) {
            var dbId = parseInt(p);
            if (dbId && !visMan.isNodeVisible(model, dbId)) {
                deselect(dbId);
                changed = true;
            }
        }

        return changed;
    };


    // TODO: Optimize this so both select and toggleSelection don't have to lookup the node index.
    this.toggleSelection = function(dbId, selectionType) {

        // Notice that for Leaflets, it's ok to select dbId 0 - that's the only single id.
        if (!dbId && !model.isLeaflet()) {
            logger.error("Attempting to select node 0.", errorCodeString(ErrorCodes.VIEWER_INTERNAL_ERROR));
            return;
        }

        if (!isSelected(dbId)) {
            select(dbId, selectionType);
        } else {
            deselect(dbId);
        }
    };


    this.setSelectionMode = function(mode) {
        this.clearSelection(true);
        this.selectionMode = mode;
    };

    this.isNodeSelectionLocked = function(dbId) {
        if (dbId === -1) return false;
        var instanceTree = getInstanceTree();
        if (instanceTree) {      
            return instanceTree.isNodeSelectionLocked(dbId);
        } else {
            // Hypothetically, the logic for selection locking can be removed from InstanceTree.js 
            // This approach can be used for models that do contain an instance tree.
            return _this.lockedNodes.indexOf(dbId) !== -1;
        }
        
    }

    this.lockSelection = function(nodeList, locked) {
        var instanceTree = getInstanceTree();
        nodeList = Array.isArray(nodeList) ? nodeList : [nodeList];

        function updateLock(dbId, locked) {
            if (!dbId || dbId === -1) return;
            if (locked) {
                if (_this.lockedNodes.indexOf(dbId) === -1) {
                    _this.lockedNodes.push(dbId);
                    _this.clearNodeSelection(dbId);
                }
            } else {
                const index = _this.lockedNodes.indexOf(dbId);
                _this.lockedNodes.splice(index, 1);
            }
        }

        if (instanceTree) {
            nodeList.forEach(function(node) {
                instanceTree.enumNodeChildren(
                    node,
                    function(dbId) {
                        instanceTree.lockNodeSelection(dbId, false);
                        updateLock(dbId, locked);
                        if (locked) {
                            instanceTree.lockNodeSelection(dbId, locked);
                        }
                    },
                    true
                );
            });
        } else {
            // For models that do not contain an instance tree.
            nodeList.forEach((dbId) => {
                updateLock(dbId, locked);
            });
        }
    };

    this.setSelection = function(dbNodeArray, selectionType) {
        if( selectionIsEqual( dbNodeArray ) )
            return;

        this.clearSelection(true);

        if (dbNodeArray == null || dbNodeArray.length === 0)
            return;

        for (var i = 0; i < dbNodeArray.length; i++) {
            select(dbNodeArray[i], selectionType);
        }
    };


    this.getSelectionBounds = function() {
        var bounds = new THREE.Box3();
        var box = new THREE.Box3();

        var instanceTree = getInstanceTree();
        if (instanceTree) {
            var fragList = model.getFragmentList();
            
            var sset = _this.selectedObjectIds;
            for (var p in sset) {
                var dbId = parseInt(p);
                instanceTree.enumNodeFragments(dbId, function(fragId) {
                    fragList.getWorldBounds(fragId, box);
                    bounds.union(box);
                }, true);
            }
        }
        
        return bounds;
    };

    this.getSelectionVisibility = function () {
        var hasVisible = false,
            hasHidden = false;

        var sset = _this.selectedObjectIds;
        for (var p in sset) {
            var dbId = parseInt(p);
            if (dbId) {
                var instanceTree = getInstanceTree();
                if (!instanceTree || !instanceTree.isNodeHidden(dbId)) {
                    hasVisible = true;
                } else {
                    hasHidden = true;
                }
                if (hasVisible && hasHidden) {
                    break;
                }
            }
        }

        return { 
            hasVisible: hasVisible, 
            hasHidden: hasHidden,
            model: model
        };
    };

    // If a selection is made right after adding a model, selection highlight might not work
    // yet, because...
    //  a) SelectionTexture may not be initialized yet
    //  b) idRemap may not loaded yet.
    // This function makes sure that the corresponding highlighting is applied as soon as all
    // required data are available.
    this.update2DSelectionHighlighting = function () {
        // See comment about updated2DSelectionHighlighting below.
        if (_this._2DSelectionHighlightingUpdated) {
            return;
        }

        // SelectionTexture does only exist if the full model geometry is loaded. 
        // This is because selectionTexture size depends on maxObjectNumber - which is dynamically tracked during loading.
        if (!model.isLoadDone()) {
            return;
        }
        
        // F2D models with OTG databases require a dbId remapping. The remapping is only available if the instance tree is loaded.
        // Note that it's okay if there is no remapping in some cases. The only problem is if there is one, but just not loaded yet.
        var dbLoader = model.getPropertyDb();
        if (dbLoader && !dbLoader.isLoadDone()) {
            return;
        }

        // We will mark all selected objects again. So, we have to reset the map that tracks which nodes are already highlighted.
        // Otherwise, the loop below would not trigger any highlighting update.
        selectedParentMap = {};

        // Update this.selectedObjectIds keys with new dbIds. Otherwise, the values that getSelection returns will be incorrect.
        const tempMap = {};
        Object.keys(_this.selectedObjectIds).forEach(dbId => {
            tempMap[model.remapDbId(dbId)] = _this.selectedObjectIds[dbId];
        });
        _this.selectedObjectIds = tempMap;

        // Trigger highlighting for all selected objects
        var sel = _this.getSelection();
        for (var i=0; i<sel.length; i++) {
            var dbId = sel[i];
            var selectionType = _this.selectedObjectIds[dbId];
            markObject(dbId, false, selectionType);
        }

        // Make sure that this function was fully executed only once.
        // Basically it shouldn't happen, but in case that this function was somehow being called again
        // after it already transformed the selected objectIds, they might get remapped multiple times and
        // get incorrect values as a result.
        _this._2DSelectionHighlightingUpdated = true;
    };

    this.dtor = function () {
        this.selectedObjectIds = null;
    };

}


export function MultiModelSelector(viewer) {

    var _models = [];

    this.highlightDisabled = false;
    this.highlightPaused   = false;
    this.selectionDisabled = false;

    this.addModel = function(model) {
        if (_models.indexOf(model) == -1) {
            model.selector = new Selector(viewer, model);
            _models.push(model);
        }
    };

    this.removeModel = function(model) {
        var idx = _models.indexOf(model);

        // make sure that we don't keep any highlighting proxy
        var selected = model.selector.getSelection();
        model.selector.clearSelection();
        model.selector = null;
        _models.splice(idx, 1);
    };

    function warn() {
        if (_models.length > 1) {
            logger.warn("This selection call does not yet support multiple models.");
        }
    }

    function fireAggregateSelectionChangedEvent() {

        var perModel = [];

        for (var i=0; i<_models.length; i++) {
            var dbIdArray = [];
            var fragIdsArray = [];

            var sset = _models[i].selector.selectedObjectIds;
            var instanceTree = _models[i].selector.getInstanceTree();
            for (var p in sset) {
                if (sset[p]) {
                    var dbId = parseInt(p);
                    if (dbId) {
                        dbIdArray.push(dbId);

                        if (instanceTree) {
                            instanceTree.enumNodeFragments(dbId, function (fragId) {
                                fragIdsArray.push(fragId);
                            }, false);
                        }
                    }
                }
            }

            if (dbIdArray.length) {
                perModel.push({
                    fragIdsArray: fragIdsArray,
                    dbIdArray: dbIdArray,
                    nodeArray: dbIdArray,
                    model: _models[i]
                });
            }
        }

        var event;

        //For backwards compatibility, fire the old selection change event
        //when there is just one model in the scene
        if (_models.length === 1) {
            event = {
                type: et.SELECTION_CHANGED_EVENT,
                fragIdsArray: perModel[0] ? perModel[0].fragIdsArray : [],
                dbIdArray: perModel[0] ? perModel[0].dbIdArray : [],
                nodeArray: perModel[0] ? perModel[0].dbIdArray : [],
                model: _models[0]
            };
            viewer.api.dispatchEvent(event);
        }

        //Always fire the aggregate selection changed event
        event = {
            type: et.AGGREGATE_SELECTION_CHANGED_EVENT,
            selections: perModel
        };
        viewer.api.dispatchEvent(event);

    }


    function deselectInvisible() {

        var changed = false;

        for (var i=0; i<_models.length; i++) {
            changed = _models[i].selector.deselectInvisible() || changed;
        }

        if (changed)
            fireAggregateSelectionChangedEvent();
    }

    // @returns {boolean} true when a part is selected in any scene model.
    this.hasSelection = function() {
        for (var i=0; i<_models.length; i++) {
            if (_models[i].selector.hasSelection()) 
                return true;
        }
        return false;
    }

    this.getSelectionLength = function() {
        var total = 0;

        for (var i=0; i<_models.length; i++) {
            total += _models[i].selector.getSelectionLength();
        }

        return total;
    };

    this.getSelection = function() {
        warn();
        if (_models.length > 1)
            logger.warn("Use getAggregateSelection instead of getSelection when there are multiple models in the scene.");
        
        return _models[0] ? _models[0].selector.getSelection() : [];
    };

    this.getAggregateSelection = function() {
        var res = [];
        for (var i=0; i<_models.length; i++) {
            var selset = _models[i].selector.getSelection();
            if (selset && selset.length)
                res.push( { model:_models[i], selection:selset } );
        }

        return res;
    };

    this.clearSelection = function(nofire) {
      let selectionCleared;
        for (var i=0; i<_models.length; i++) {
          if (_models[i].selector.clearSelection(nofire)) {
            selectionCleared = true;
          }
        }
        if (!nofire && selectionCleared)
            fireAggregateSelectionChangedEvent();
    };

    this.toggleSelection = function(dbId, model, selectionType) {
        if(this.selectionDisabled) {
            return;
        }

        if (!model) {
            warn();
            model = _models[0];
        }
        model.selector.toggleSelection(dbId, selectionType);

        fireAggregateSelectionChangedEvent();
    };

    this.setSelectionMode = function(mode) {
        for (var i=0; i<_models.length; i++)
            _models[i].selector.setSelectionMode(mode);
    };

    this.isNodeSelectionLocked = function(dbId, model) {
        if (!model) {
            warn();
            model = _models[0];
        }
        return model && model.selector.isNodeSelectionLocked(dbId);
    }
    
    this.lockSelection = function(nodeList, locked, model) {
        if (!model) {
            warn();
            model = _models[0];
        }
        model && model.selector.lockSelection(nodeList, locked);
    }

    /**
     * Unlocks nodes in models.
     * @param {Number[]} [nodeList] - dbIds to unlock. If undefined, all model dbIds are unlocked
     * @param {Autodesk.Viewing.Model} [model] - The model associated to the model
     */
    this.unlockSelection = function(nodeList, model) {
        // Unlock all nodes for all models if both the parameters are missing
        if (!nodeList && !model) {
            _models.forEach((model) => {
                const lockedNodes = model.selector.lockedNodes.slice();
                this.lockSelection(lockedNodes, false, model);
            });
            return;
        }
        if (!model) {
            warn();
            model = _models[0];
        }
        nodeList = nodeList || model.selector.lockedNodes.slice();
        this.lockSelection(nodeList, false, model);
    };

    this.setSelection = function(dbNodeArray, model, selectionType) {
        if(this.selectionDisabled) {
            return;
        }

        if (!dbNodeArray || dbNodeArray.length === 0)
            this.clearSelection(true);
        else {
            if (!model) {
                warn();
                model = _models[0];
            } else {
                for (var i=0; i<_models.length; i++)
                    if (_models[i] !== model)
                         _models[i].selector.clearSelection();
            }
            model.selector.setSelection(dbNodeArray, selectionType);
        }

        fireAggregateSelectionChangedEvent();
    };


    this.setAggregateSelection = function(selection) {

        if (this.selectionDisabled) {
            return;
        }

        if (!selection || selection.length === 0) {
            this.clearSelection(true);            
        } else {
            for (var i=0; i<selection.length; ++i) {
                var model = selection[i].model;
                var ids = selection[i].ids;
                var selectionType = selection[i].selectionType;
                model.selector.setSelection(ids, selectionType);
            }
        }

        fireAggregateSelectionChangedEvent();        
    };

    this.getSelectionBounds = function() {
        if (_models.length == 1)
            return _models[0].selector.getSelectionBounds();
        else {
            var bbox = new THREE.Box3();
            for (var i=0; i<_models.length; i++) {
                var tmp = _models[i].selector.getSelectionBounds();
                bbox.union(tmp);
            }
            return bbox;
        }
    };

    this.getSelectionVisibility = function () {

        var res = { 
            // Aggregated results
            hasVisible: false, 
            hasHidden: false,
            // per model specifics 
            details: [] 
        };
        for (var i=0; i<_models.length; i++) {
            var subRes = _models[i].selector.getSelectionVisibility();
            res.hasVisible = res.hasVisible || subRes.hasVisible;
            res.hasHidden = res.hasHidden || subRes.hasHidden;
            res.details.push(subRes);
        }
        return res;
    };

    this.dtor = function () {
        for (var i=0; i<_models.length; i++)
            _models[i].selector.dtor();
    };


    viewer.api.addEventListener( et.ISOLATE_EVENT, function(event) {
        deselectInvisible();
    });

    viewer.api.addEventListener( et.HIDE_EVENT, function(event) {
        deselectInvisible();
    });

    // Make sure that selection highlighting is updated when all required data are ready.
    function update2DSelectionHighlighting(e) {
        // Selector may be null if model has been removed meanwhile
        if (e.model.is2d() && e.model.selector) {
            e.model.selector.update2DSelectionHighlighting();
        }
    }
    viewer.api.addEventListener( et.GEOMETRY_LOADED_EVENT, update2DSelectionHighlighting);
    viewer.api.addEventListener( et.OBJECT_TREE_CREATED_EVENT, update2DSelectionHighlighting);
    viewer.api.addEventListener( et.OBJECT_TREE_UNAVAILABLE_EVENT, update2DSelectionHighlighting);
}
