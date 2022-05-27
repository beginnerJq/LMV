
import { logger } from "../logger/Logger";
import * as et from "../application/EventTypes";

    export function VisibilityManager(viewerImpl, model) {
        this.viewerImpl = viewerImpl;

        //Currently the visibility manager works on a single model only
        //so we make this explicit here.
        this.model = model;

        // Keep track of isolated nodes
        this.isolatedNodes = [];

        // Keeps track of hidden nodes. Only applies when there's no isolated node being tracked.
        this.hiddenNodes = [];
    }

    VisibilityManager.prototype.getInstanceTree = function () {
        if (this.model)
            return this.model.getData().instanceTree;
        else
            return null;
    };

    VisibilityManager.prototype.getIsolatedNodes = function () {
        return this.isolatedNodes.slice(0);
    };

    VisibilityManager.prototype.getHiddenNodes = function () {
        return this.hiddenNodes.slice(0);
    };

    /** @params {bool} - visible flag applied to all dbIds/fragments. */
    VisibilityManager.prototype.setAllVisibility = function (visible) {

        var root = this.model ? this.model.getRootId() : null;
        if (root) {
            // if we have an instance tree, we call setVisible on the root node
            this.setVisibilityOnNode(root, visible);
        }

        // 2D datasets may need to call setAllVisibility on the model. This can have two possible reasons:
        //  a) they may have no instance tree, so that setting visibility on root (as above) is not possible.
        //  b) even if they have an instance tree, setting visibility on root node will only reach selectable ids.
        //     2D datasets may also contain unselectable objects with id <=0. In this case, the call below
        //     is needed to hide/show these as well when using isolate/show-all.
        var is2d = this.model.getData().is2d;
        if (is2d) {
            this.model.setAllVisibility(visible);
        }
    };

    VisibilityManager.prototype.isNodeVisible = function(dbId) {
        var it = this.getInstanceTree();
        if (it) {
            // get visibility from instance tree
            return !it.isNodeHidden(dbId);
        } else {
            // If there is no instance tree, we have ids, but no hierarchy.
            // Therefore, an id is only hidden if it appears in hiddenNodes or
            // if there are isolated nodes and dbId is not among these.
            return (this.hiddenNodes.indexOf(dbId)==-1 && (this.isolatedNodes.length==0 || this.isolatedNodes.indexOf(dbId)!=-1));
        }
    };

    VisibilityManager.prototype.isolate = function (node) {
        var it     = this.getInstanceTree();
        var rootId = (it ? it.getRootId() : null);
        var isRoot = (typeof node == "number" && node === rootId)
            || (typeof node == "object" && node.dbId === rootId);

        if (node && !isRoot) {
            this.isolateMultiple(Array.isArray(node) ? node : [node]);
        } else {
            this.isolateNone();
        }
    };

    VisibilityManager.prototype.isolateNone = function () {

        this.model.setAllVisibility(true);
        this.viewerImpl.sceneUpdated(true);

        this.setAllVisibility(true);

        this.hiddenNodes = [];
        this.isolatedNodes = [];
        this.viewerImpl.invalidate(true);
    };

//Makes the children of a given node visible and
//everything else not visible
    VisibilityManager.prototype.isolateMultiple = function (nodeList) {

        //If given nodelist is null or is an empty array or contains the whole tree
        if (!nodeList || nodeList.length == 0) {
            this.isolateNone();
        }
        else {

            // For 3D, visibility is controlled via MESH_VISIBLE flag.
            // For 2D, visibility can only be contolled via a texture in MaterialManager. This already
            // happens in the setVisibilityOnNode(..) call above.
            if (!this.model.getData().is2d) {
                this.model.setAllVisibility(false);
                this.viewerImpl.sceneUpdated(true);
            }

            // Call this.setAllVisibility after this.model.setAllVisibility so
            // the locked visibility flag can be used to display locked dbids
            // after they are hidden by this.model.setAllVisibility.
            this.setAllVisibility(false);

            // Needs to happen after setVisibilityOnNode(root).
            this.isolatedNodes = nodeList.slice(0);
            this.hiddenNodes = [];

            for (var i = 0; i < nodeList.length; i++) {
                this.setVisibilityOnNode(nodeList[i], true);
            }
        }
        //force a repaint and a clear
        this.viewerImpl.invalidate(true);
    };


//Makes the children of a given node visible and
//everything else not visible
    VisibilityManager.prototype.hide = function (node, fireEvent=true) {

        var event;

        if (Array.isArray(node)) {
            for (var i = 0; i < node.length; ++i) {
                this.setVisibilityOnNode(node[i], false);
            }

            if (node.length > 0) {
                event = {type: et.HIDE_EVENT, nodeIdArray: node, model: this.model};
            }
        } else {
            this.setVisibilityOnNode(node, false);
            event = {type: et.HIDE_EVENT, nodeIdArray: [node], model: this.model};
        }

        if (event && fireEvent)
            this.viewerImpl.api.dispatchEvent(event);
    };

    VisibilityManager.prototype.show = function (node) {

        var event;

        if (Array.isArray(node)) {
            for (var i = 0; i < node.length; ++i) {
                this.setVisibilityOnNode(node[i], true);
            }

            if (node.length > 0) {
                event = {type: et.SHOW_EVENT, nodeIdArray: node, model: this.model};
            }
        } else {
            this.setVisibilityOnNode(node, true);
            event = {type: et.SHOW_EVENT, nodeIdArray: [node], model: this.model};
        }

        if (event)
            this.viewerImpl.api.dispatchEvent(event);
    };

    VisibilityManager.prototype.toggleVisibility = function (node) {
        var instanceTree = this.getInstanceTree();
        if (!instanceTree) {
            return;
        }
        
        var hidden = instanceTree.isNodeHidden(node);
        this.setVisibilityOnNode(node, hidden); //Note -- toggle visibility, so we want !!hidden => hidden

        var event = {type: hidden ? et.SHOW_EVENT : et.HIDE_EVENT, nodeIdArray: [node], model: this.model};
        this.viewerImpl.api.dispatchEvent(event);
    };

    VisibilityManager.prototype.setVisibilityOnNode = function (node, visible) {

        var viewer = this.viewerImpl;
        var model = this.model;
        var instanceTree = this.getInstanceTree();
        var hidden = !visible;
        var is2d   = model.getData().is2d;
        var matMan = this.viewerImpl.matman();

        if (instanceTree) {
            //Recursively process the tree under the root (recursion is inclusive of the root)
            instanceTree.enumNodeChildren(node, function (dbId) {

                var visibleLocked = instanceTree.isNodeVisibleLocked(dbId);

                instanceTree.setNodeHidden(dbId, hidden && !visibleLocked);

                if (is2d) {
                    // If dbId is otg, we need to map back to original dbIds, because the
                    // vertex buffer contain original dbIds.
                    var origDbId = model.reverseMapDbIdFor2D(dbId);

                    model.getFragmentList().setObject2DGhosted(origDbId, !visible && !visibleLocked);
                } else {
                    instanceTree.enumNodeFragments(dbId, function (fragId) {
                        model.setVisibility(fragId, visible || visibleLocked);
                    }, false);
                }
            }, true);
        } else {
            //No instance tree, assume fragId = dbId
            if (is2d) {
                if (model.isLeaflet()) {
                    model.setVisibility(null, visible);
                } else {
                    model.getFragmentList()?.setObject2DGhosted(node, !visible);
                }
            } else {
                model.setVisibility(node, visible);
            }
        }

        viewer.sceneUpdated(true);
        this.updateNodeVisibilityTracking(node, visible);
    };

    VisibilityManager.prototype.updateNodeVisibilityTracking = function(node, visible) {

        // Update hidden tracking array.
        var toVisible = visible;
        if (this.isolatedNodes.length > 0) {
            var isoIndex = this.isolatedNodes.indexOf(node);
            if (toVisible && isoIndex === -1) {
                this.isolatedNodes.push(node);
            }
            else if (!toVisible && isoIndex !== -1) {
                this.isolatedNodes.splice(isoIndex, 1);

                // When there are no more isolated nodes, it means that the whole model is now invisible
                if (this.isolatedNodes.length === 0) {
                    this.hiddenNodes = [ this.model.getRootId() ];
                }
            }
        } else {
            var hidIndex = this.hiddenNodes.indexOf(node);
            if (!toVisible && hidIndex === -1) {
                this.hiddenNodes.push(node);
            }
            else if (toVisible && hidIndex !== -1) {
                this.hiddenNodes.splice(hidIndex, 1);
            }
        }

        // When operating with the node, we can get simplify stuff.
        var instanceTree = this.getInstanceTree();
        if (instanceTree && instanceTree.root && instanceTree.root.dbId === node) {
            if (visible) {
                this.isolatedNodes = [];
                this.hiddenNodes = [];
            } else {
                this.isolatedNodes = [];
                this.hiddenNodes = [node];
            }
        }
    };

    VisibilityManager.prototype.toggleNodeVisibleLocked = function (node) {
        var locked = this.getInstanceTree().isNodeVisbileLocked(node);
        this.lockNodeVisible(node, !locked);
    };

    VisibilityManager.prototype.lockNodeVisible = function (nodeList, locked) {

        var viewer = this.viewerImpl;
        var model = this.model;
        var instanceTree = this.getInstanceTree();
        var is2d   = model.getData().is2d;

        if (instanceTree) {
            var lockOneNode = node => {
                //Recursively process the tree under the root (recursion is inclusive of the root)
                instanceTree.enumNodeChildren(node, function (dbId) {

                    instanceTree.lockNodeVisible(dbId, locked);
                    if (locked) {
                        instanceTree.setNodeHidden(dbId, false);

                        if (is2d) {
                            // If dbId is otg, we need to map back to original dbIds, because the
                            // vertex buffer contain original dbIds.
                            var origDbId = model.reverseMapDbIdFor2D(dbId);

                            model.getFragmentList().setObject2DGhosted(origDbId, false);
                        } else {
                            instanceTree.enumNodeFragments(dbId, function (fragId) {
                                model.setVisibility(fragId, true);
                            }, false);
                        }
                    }
                }, true);

                if (locked) {
                    viewer.sceneUpdated(true);
                    this.updateNodeVisibilityTracking(node, locked);
                }
            };

            if (Array.isArray(nodeList)) {
                nodeList.forEach(lockOneNode);
            } else {
                lockOneNode(nodeList);
            }
        }
    };

    VisibilityManager.prototype.isNodeVisibleLocked = function(node) {
        var instanceTree = this.getInstanceTree();
        return instanceTree && instanceTree.isNodeVisibleLocked(node);
    };

    VisibilityManager.prototype.setNodeOff = function (node, isOff, nodeChildren, nodeFragments) {
        var viewer = this.viewerImpl;
        var model = this.model;
        var instanceTree = this.getInstanceTree();
        var is2d   = model.getData().is2d;

        if (!instanceTree) {
            if (is2d) {
                model.getFragmentList().setObject2DVisible(node, !isOff);
            } else {
                model.getFragmentList().setFragOff(node, isOff);
            }
            viewer.sceneUpdated(true);
            return;
        }

        if (nodeChildren && nodeFragments) {
            let dbId, fragId;
            if (is2d) {
                for (let i = 0; i < nodeChildren.length; ++i) {
                    dbId = nodeChildren[i];
                    instanceTree.setNodeOff(dbId, isOff);
                    // If dbId is otg, we need to map back to original dbIds, because the
                    // vertex buffer contain original dbIds.
                    var origDbId = model.reverseMapDbIdFor2D(dbId);
                    model.getFragmentList().setObject2DVisible(origDbId, !isOff);
                }
            } else {
                for (let i = 0; i < nodeChildren.length; ++i) {
                    dbId = nodeChildren[i];
                    instanceTree.setNodeOff(dbId, isOff);
                }
                for (let i = 0; i < nodeFragments.length; ++i) {
                    fragId = nodeFragments[i];
                    model.getFragmentList().setFragOff(fragId, isOff);
                }
            }
        } else {
            //Recursively process the tree under the root (recursion is inclusive of the root)
            instanceTree.enumNodeChildren(node, function (dbId) {

                instanceTree.setNodeOff(dbId, isOff);

                if (is2d) {
                    // If dbId is otg, we need to map back to original dbIds, because the
                    // vertex buffer contain original dbIds.
                    var origDbId = model.reverseMapDbIdFor2D(dbId);

                    model.getFragmentList().setObject2DVisible(origDbId, !isOff);
                } else {
                    instanceTree.enumNodeFragments(dbId, function (fragId) {
                        model.getFragmentList().setFragOff(fragId, isOff);
                    }, false);
                }

            }, true);
        }

        viewer.sceneUpdated(true);
    };


    export function MultiModelVisibilityManager(viewer) {
    
        this.viewerImpl = viewer;
        this.models = [];
    
    }
    
    MultiModelVisibilityManager.prototype.addModel = function(model) {
        if (this.models.indexOf(model) == -1) {
            model.visibilityManager = new VisibilityManager(this.viewerImpl, model);
            this.models.push(model);
        }
    };

    MultiModelVisibilityManager.prototype.removeModel = function(model) {
        var idx = this.models.indexOf(model);

        // clear visibility states (revert all ghosting)
        model.visibilityManager.isolateNone();

        model.visibilityManager = null;
        this.models.splice(idx, 1);
    };

    MultiModelVisibilityManager.prototype.warn = function() {
        if (this.models.length > 1) {
            logger.warn("This selection call does not yet support multiple models.");
        }
    };

    /**
     * Get a list of all dbIds that are currently isolated, grouped by model.
     *
     * @returns {Array} Containing objects with `{ model: <instance>, ids: Number[] }`.
     * @private
     */
    MultiModelVisibilityManager.prototype.getAggregateIsolatedNodes = function() {
        
        var res = [];
        var _models = this.models;
        for (var i=0; i<_models.length; i++) {
            var nodes = _models[i].visibilityManager.getIsolatedNodes();
            if (nodes && nodes.length)
                res.push( { model:_models[i], ids: nodes } );
        }
        return res;
    };
    
    MultiModelVisibilityManager.prototype.getIsolatedNodes = function (model) {
        if (!model) {
            this.warn();
            model = this.models[0];
        }
        return model.visibilityManager.getIsolatedNodes();
    };

    MultiModelVisibilityManager.prototype.getAggregateHiddenNodes = function() {
        var res = [];
        var _models = this.models;
        for (var i=0; i<_models.length; i++) {
            var nodes = _models[i].visibilityManager.getHiddenNodes();
            if (nodes && nodes.length)
                res.push( { model:_models[i], ids: nodes } );
        }
        return res;
    };

    MultiModelVisibilityManager.prototype.getHiddenNodes = function (model) {
        if (!model) {
            this.warn();
            model = this.models[0];
        }
        return model.visibilityManager.getHiddenNodes();
    };

    MultiModelVisibilityManager.prototype.isNodeVisible = function(model, dbId) {
        if (!model) {
            this.warn();
            model = this.models[0];
        }
        return model.visibilityManager.isNodeVisible(dbId);
    };

    MultiModelVisibilityManager.prototype.isolate = function (node, model) {
        if (!model) {
            this.warn();
            model = this.models[0];
        }
        model.visibilityManager.isolate(node);
        fireAggregateIsolationChangedEvent(this);
    };

    /**
     * Isolate nodes (dbids) associated with a model.
     * @param {object} isolation - isolation object. contains a model and dbids to isolate
     * @param {Autodesk.Viewing.Model} isolation.model - Model
     * @param {number[]} isolation.ids - dbids to hide
     * @param {object} [options] - custom options
     * @param {boolean} [options.hideLoadedModels] - if set to true the visibility of the other loaded models will not change. 
     */
    MultiModelVisibilityManager.prototype.aggregateIsolate = function (isolation, options) {
        if (!isolation || isolation.length === 0) {
            // all visible
            for (var i=0; i<this.models.length; ++i) {
                this.models[i].visibilityManager.isolateNone();
            }
        } else {
            // Something's isolated
            var modelsCopy = this.models.concat();
            for (var i=0; i<isolation.length; ++i) {
                var model = isolation[i].model;
                var ids = isolation[i].ids || isolation[i].selection;
                
                var index = modelsCopy.indexOf(model);
                modelsCopy.splice(index, 1);

                model.visibilityManager.isolate(ids);
            }

            var hideLoadedModels = options
                ? options.hideLoadedModels !== undefined && options.hideLoadedModels
                : true;

            while (modelsCopy.length && hideLoadedModels) {
                modelsCopy.pop().visibilityManager.setAllVisibility(false);
            }
        }
        fireAggregateIsolationChangedEvent(this);
    };

//Makes the children of a given node visible and
//everything else not visible
    MultiModelVisibilityManager.prototype.hide = function (node, model) {
        if (!model) {
            this.warn();
            model = this.models[0];
        }
        model.visibilityManager.hide(node);

    };

    /**
     * Hide the dbids associated in a model
     * Fires the Autodesk.Viewing.AGGREGATE_HIDDEN_CHANGED_EVENT.
     * @param {Object[]} hide - [ { model: Model, ids: [ Number, ... ] }, ... ]
     */
    MultiModelVisibilityManager.prototype.aggregateHide = function (hide) {
        if (!hide || hide.length === 0) return;
        for (var i = 0; i < hide.length; ++i) {
            var model = hide[i].model;
            var ids = hide[i].ids || hide[i].selection;
            // Fire the av.HIDE_EVENT only if there is one entry.
            model.visibilityManager.hide(ids, this.models.length === 1);
        }

        // Get the hidden nodes
        var hidden = this.getAggregateHiddenNodes();
        // Dispatch the aggregate hidden event
        var event = { 
            type: et.AGGREGATE_HIDDEN_CHANGED_EVENT,
            hidden: hidden 
        };
        this.viewerImpl.api.dispatchEvent(event);
    };

    MultiModelVisibilityManager.prototype.show = function (node, model) {
        if (!model) {
            this.warn();
            model = this.models[0];
        }
        model.visibilityManager.show(node);
    };

    MultiModelVisibilityManager.prototype.toggleVisibility = function (node, model) {
        if (!model) {
            this.warn();
            model = this.models[0];
        }
        model.visibilityManager.toggleVisibility(node);        
    };

    MultiModelVisibilityManager.prototype.setVisibilityOnNode = function (node, visible, model) {
        if (!model) {
            this.warn();
            model = this.models[0];
        }
        model.visibilityManager.setVisibilityOnNode(node, visible);
    };

    MultiModelVisibilityManager.prototype.toggleVisibleLocked = function (node, model) {
        if (!model) {
            this.warn();
            model = this.models[0];
        }
        model.visibilityManager.toggleVisibleLocked(node);        
    };

    MultiModelVisibilityManager.prototype.lockNodeVisible = function (node, locked, model) {
        if (!model) {
            this.warn();
            model = this.models[0];
        }
        model.visibilityManager.lockNodeVisible(node, locked);
    };

    MultiModelVisibilityManager.prototype.isNodeVisibleLocked = function(node, model) {
        if (!model) {
            this.warn();
            model = this.models[0];
        }
        return model.visibilityManager.isNodeVisibleLocked(node, model);
    };

    MultiModelVisibilityManager.prototype.setNodeOff = function (node, isOff, model, nodeChildren, nodeFragments) {
        if (!model) {
            this.warn();
            model = this.models[0];
        }
        model.visibilityManager.setNodeOff(node, isOff, nodeChildren, nodeFragments);
    };

    function fireAggregateIsolationChangedEvent(_this) {

        var isolation = _this.getAggregateIsolatedNodes();

        // Legacy event
        if (_this.models.length === 1) {
            var event = { 
                type: et.ISOLATE_EVENT,
                nodeIdArray: isolation.length ? isolation[0].ids : [], 
                model: _this.models[0]
            };
            _this.viewerImpl.api.dispatchEvent(event);
        }

        // Always fire
        var event = { 
            type: et.AGGREGATE_ISOLATION_CHANGED_EVENT,
            isolation: isolation 
        };
        _this.viewerImpl.api.dispatchEvent(event);
    };
