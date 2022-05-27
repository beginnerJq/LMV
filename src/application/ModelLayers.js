
import { logger } from "../logger/Logger";
import * as et from "./EventTypes";

    var BatchSize = 1024;
    var ZeroLayers = {name: 'root', id: 'root', isLayer: false, children: [], childCount: 0};

    export function ModelLayers(viewer) {

        this.viewer = viewer;
        this.matman = viewer.matman();
        this.model = null;
        this.root = null;
        this.initialized = false;

        this.layerToIndex = {};
        this.indexToLayer = [null];

        this.nodeToLayer = [];
    }

    var proto = ModelLayers.prototype;

    proto.addModel = function(model, defer3d = false) {
        // TODO: Only single model supported, extend to support several.
        if (this.initialized) {
            return;
        }

        // Loading 3d layers does propdb loading, 
        // which is deferred to LayerManager extension
        if (!model.is2d() && defer3d) {
            return;
        }

        var onCreateLayers = function(root) {

            if (!root) {
                return;
            }

            var data = this.model.getData();
            var tree = data.instanceTree;

            // Normalize children array, some roots come without children.
            root.children = root.children || [];

            // Copy children into flat array
            var childrenFlat = _flattenChildren(root.children);
            root.childCount = childrenFlat.length;

            // Layer to index, index to layer.
            this.indexToLayer = new Array(root.childCount+1);
            this.indexToLayer[0] = null;

            for (var i = 0; i < root.childCount; ++i) {

                var layer = childrenFlat[i];
                var visible = layer.visible == undefined ? true : layer.visible;

                this.layerToIndex[layer.name] = layer.index;
                this.indexToLayer[layer.index] = /*layerInfo*/ {
                    layer: layer,
                    visible: visible // copy visibilty to avoid altering the initial state
                };
            }

            // The rest is needed only for 3d models.        
            if (this.model.is2d()) {
                return;
            }

            // Map node ids with their corresponding layers, only if present.
            if (root.childCount === 0) {
                return;
            }

            // Assign nodes to layers.
            this.nodeToLayer = (root.childCount <= 256
                ? new Uint8Array(tree.nodeAccess.getNumNodes())
                : new Uint16Array(tree.nodeAccess.getNumNodes())
            );

            var onLayerNodes = function(mapping) {

                if (!this.model)
                    return;

                var data = this.model.getData();
                var tree = data.instanceTree;

                for (var layerName in mapping) {
                    if (Object.prototype.hasOwnProperty.call(mapping, layerName)) {
                        var layerIndex = this.layerToIndex[layerName];
                        var ids = mapping[layerName];
                        for (var i=0, len=ids.length; i<len; ++i) {
                            var nodeIndex = tree.nodeAccess.getIndex(ids[i]);
                            this.nodeToLayer[nodeIndex] = layerIndex;
                        }
                    }
                }
            }.bind(this);

            var onError = function() {
                logger.warn("ModelLayers error: coudn't get layers from property database.");
            }.bind(this);

            model.getLayerToNodeIdMapping(onLayerNodes, onError);
        }.bind(this);
 
        var onCreateLayersComplete = function(root) {
            this.root = root;
            this.initialized = true;
            const visibilityChanged = this.activateLayerState("Initial");
            if (!visibilityChanged && this.model?.is2d()) {
                // activateLayerState changes visibility from the metadata.layer_states
                // If this is not available, set initial visibility for layers that are disabled under layersRoot
                this.indexToLayer.forEach(val => {
                    if (val && !val.visible) {
                        this.setLayerVisible(val.layer, false);
                    }
                });
            }
            this.viewer.api.dispatchEvent({
                type: et.MODEL_LAYERS_LOADED_EVENT,
                model: model,
                root: root
            });
        }.bind(this);

        this.model = model;
        (model.is2d() ? get2dLayers(model) : get3dLayers(model))
            .then(function(root) {
                onCreateLayers(root);
                onCreateLayersComplete(root);
            })
            .catch(function(error) {
                logger.warn(error);
                onCreateLayersComplete(ZeroLayers);
            });
    };

    proto.removeModel = function(model) {

        if (this.model !== model) {
            return;
        }

        this.model = null;
        this.root = null;
        this.initialized = false;

        this.layerToIndex = {};
        this.indexToLayer = [null];

        this.nodeToLayer = [];
    };

    proto.getRoot = function() {

        if(!this.initialized) {
             logger.warn("Autodesk.Viewing.ModelLayers.getRoot couldn't peform action, layers are still being loaded");
        }
        return this.root;
    };

    proto.showAllLayers = function() {
        if(!this.initialized) {
            logger.warn("Autodesk.Viewing.ModelLayers.showAllLayers couldn't peform action, layers are still being loaded");
            return;
        }
        showAllLayers(this, true);
    };

    proto.hideAllLayers = function() {
        if(!this.initialized) {
            logger.warn("Autodesk.Viewing.ModelLayers.hideAllLayers couldn't peform action, layers are still being loaded");
            return;
        }
        showAllLayers(this, false);
    };

    /**
     * @param {object|number} layer - The layer object or index.
     * @returns {boolean} true is the layer is visible. For parent layers, it returns true when at least one child layer is visible.
     */
    proto.isLayerVisible = function(layer) {

        if(!this.initialized) {
            logger.warn("Autodesk.Viewing.ModelLayers.isLayerVisible couldn't peform action, layers are still being loaded");
            return false;
        }

        let layerIndex = getLayerIndex(this, layer);
        const layerInfo = this.indexToLayer[layerIndex];

        if (_isParentLayerInfo(layerInfo)) {
            // It is visibile if at least one child layer is visible
            const children = layerInfo.layer.children;
            for (var i=0; i<children.length; ++i) {
                let childIndex = children[i].index;
                let childLayerInfo = this.indexToLayer[childIndex];
                if (childLayerInfo.visible) {
                    return true;
                }
            }
            return false;
        }
        
        return layerInfo.visible;
    };

    /**
     * @param {object|number|object[]|number[]} layer - The layer object or index.
     * @param {boolean} visible
     */
    proto.setLayerVisible = function(layers, visible) {

        if(!this.initialized) {
            logger.warn("Autodesk.Viewing.ModelLayers.setLayersVisible couldn't peform action, layers are still being loaded");
            return;
        }

        // Get layer indices.
        layers = Array.isArray(layers) ? layers :[layers];
        var layerIndices = layers.map(function(layer) {
            return getLayerIndex(this, layer);
        }.bind(this));

        // Append child indices for each parent index encountered.
        // It's not a problem including duplicate indices.
        const len = layerIndices.length;
        for (var i=0; i<len; ++i) {
            let layerIndex = layerIndices[i];
            let layerInfo = this.indexToLayer[layerIndex];
            if (_isParentLayerInfo(layerInfo)) {
                // append children indices
                let children = layerInfo.layer.children;
                children.forEach(childData => {
                    layerIndices.push(childData.index);
                });
            }
        }


        // Hide / Show nodes.
        var model = this.model;
        var indexToLayer = this.indexToLayer;

        if (model.is2d()) {
            this.matman.setLayerVisible(layerIndices, visible, model.id);
            this.viewer.invalidate(true);
        } else {
            var skiptable = indexToLayer.map(function(layerInfo) {
                return !!(layerInfo === null || layerIndices.indexOf(layerInfo.layer.index) === -1 || layerInfo.visible === visible);
            });

            var nodeIdBatch = [];
            var action = visible
                ? this.viewer.visibilityManager.show
                : this.viewer.visibilityManager.hide;

            forEachNode(this, function(dbId, layerIndex) {
                if (skiptable[layerIndex]) {
                    return;
                }

                nodeIdBatch.push(dbId);

                if (nodeIdBatch.length === BatchSize) {
                    action(nodeIdBatch, model);
                    nodeIdBatch.length = 0;
                }
            });

            nodeIdBatch.length > 0 && action(nodeIdBatch, model);
        }

        // Mark layers as visible / invisible.
        var layerIndicesCount = layerIndices.length;
        for (let i = 0; i < layerIndicesCount; ++i) {
            const layerInfo = this.indexToLayer[layerIndices[i]];
            if (layerInfo) {
                layerInfo.visible = visible;
            }
        }
    };

    proto.getVisibleLayerIndices = function() {

        if(!this.initialized) {
            logger.warn("Autodesk.Viewing.ModelLayers.getVisibleLayerIndices couldn't peform action, layers are still being loaded");
            return [];
        }

        var visibleLayerIndices = [];

        var indexToLayer = this.indexToLayer;
        var indexTolayerCount = indexToLayer.length;

        for (var i = 1; i < indexTolayerCount; ++i) {
            var layerInfo = indexToLayer[i];
            if (layerInfo && layerInfo.visible && !_isParentLayerInfo(layerInfo)) {
                visibleLayerIndices.push(layerInfo.layer.index);
            }
        }

        return visibleLayerIndices;
    };

    proto.allLayersVisible = function() {
        // Before init, assume all layers to be visible (because setLayerVisible would not work yet anyway)
        if (!this.initialized) {
            return true;
        }

        var indexToLayer = this.indexToLayer;
        var indexTolayerCount = indexToLayer.length;

        for (var i = 1; i < indexTolayerCount; ++i) {
            var layerInfo = indexToLayer[i];
            if (layerInfo && !layerInfo.visible) {
                return false;
            }
        }
        return true;
    };

    /**
     * Changes the active layer state.
     * Get a list of all available layerStates and their active status through
     *
     * @param {string} stateName - Name of the layer state to activate.
     * 
     * @returns {bool} - true if visibility was changed
     */
    proto.activateLayerState = function(stateName) {

        if (!this.initialized) {
            logger.warn("Autodesk.Viewing.ModelLayers.activateLayerState couldn't peform action, layers are still being loaded");
            return false;
        }

        if (!this.model || this.model.is3d() || !stateName) {
            return false;
        }

        var metadata = this.model.getData().metadata;
        var states = metadata?.layer_states;

        if (!states) {
            return false;
        }

        let j;
        for (j = 0; j < states.length; j++) {
            if (states[j].name === stateName) {
                break;
            }
        }

        if (j >= states.length) {
            return false;
        }

        var layer_state = states[j];
        var visible = layer_state.visible_layers;

        var visibilityMap = {};
        if (visible && 0 < visible.length) {
            for (var k = 0; k < visible.length; k++)
                visibilityMap[visible[k]] = 1;
        }

        var onlayers = [];
        var offlayers = [];

        for (var l in metadata.layers) {
            var lname = metadata.layers[l].name;
            l = l | 0x0;
            if (visibilityMap[lname] === 1) {
                onlayers.push(l);
            } else {
                offlayers.push(l);
            }
        }

        this.setLayerVisible(onlayers, true);
        this.setLayerVisible(offlayers, false);

        return true;
    };

    /**
     * Returns information for each layer state: name, description, active.
     * Activate a state through {@link Autodesk.Viewing.Viewer3D#activateLayerState}.
     * @returns {array}
     */
    proto.getLayerStates = function () {

        // Shallow equal.
        function equal(a, b) {
            var aProps = Object.getOwnPropertyNames(a);
            var bProps = Object.getOwnPropertyNames(b);

            if (aProps.length !== bProps.length) {
                return false;
            }

            for (var i = 0; i < aProps.length; ++i) {
                var propName = aProps[i];
                if (a[propName] !== b[propName]) {
                    return false;
                }
            }

            return true;
        }

        if(!this.initialized) {
            logger.warn("Autodesk.Viewing.ModelLayers.getLayerStates couldn't peform action, layers are still being loaded");
            return null;
        }

        var model = this.model;
        var metadata = model ? model.getData().metadata : null;
        var layers = metadata ? metadata.layers : null;
        var layer_states = metadata ? metadata.layer_states : null;

        // 3d model or no layers or no layer states? Nothing to do.
        if (this.model.is3d() || !layers || !layer_states) {
            return null;
        }

        // Which layers are currently visible?
        var layerName;
        var layerNames = {};
        var currentVisibleLayers = {};

        for (var layer in layers) {
            if (Object.prototype.hasOwnProperty.call(layers, layer)) {
                var index = parseInt(layer);
                var defn = layers[layer];

                layerName = (typeof defn === 'string') ? defn : defn.name;
                layerNames[layerName] = true;

                if (this.isLayerVisible(index)) {
                    currentVisibleLayers[layerName] = true;
                }
            }
        }

        var layerStates = [];
        for (var i = 0; i < layer_states.length; ++i) {
            var layer_state = layer_states[i];
            var visible_layers = layer_state.visible_layers;
            var layerStateVisibleLayers = {};

            // Ignore hidden layer states.
            if (!layer_state.hidden) {
                if (visible_layers && 0 < visible_layers.length) {
                    for (var j = 0; j < visible_layers.length; ++j) {
                        layerName = visible_layers[j];
                        // Ignore layers we don't know about.
                        if (Object.prototype.hasOwnProperty.call(layerNames, layerName)) {
                            layerStateVisibleLayers[layerName] = true;
                        }
                    }
                }

                layerStates.push({
                    name: layer_state.name,
                    description: layer_state.description,
                    active: equal(currentVisibleLayers, layerStateVisibleLayers)
                });
            }
        }
        return (0 < layerStates.length) ? layerStates : null;
    };

    /**
     * Retrieves layer root from model data.
     *
     * @returns {Promise} that resolves with an Array of layer objects.
     * @private
     */
    function get2dLayers(model) {

        var data = model.getData();
        var root = ZeroLayers;

        if (data && data.layersRoot) {
            root = data.layersRoot;
        }

        return Promise.resolve(root);
    }

    /**
     * Scans the property database to find all available Layers.
     * This feature is avilable for AutoCAD and DGN files.
     *
     * @returns {Promise} that resolves with an Array of layer objects.
     * @private
     */
    function get3dLayers(model) {

        if (model.getData().loadOptions.skipPropertyDb) {
            return Promise.resolve(null);
        }

        var pdb = model.getPropertyDb();
        if(!pdb || (model.getData().loadOptions.disable3DModelLayers)) {
            return Promise.resolve(ZeroLayers);
        }
        return pdb.findLayers();
    }

    function showAllLayers(self, show) {

        var model = self.model;
        var indexToLayer = self.indexToLayer;

        // Hide / Show nodes.
        if (model.is2d()) {
            // Note that some files may not have layers at all, e.g., leaflets.
            if (!model.getData().layerCount) {
                return;
            }
            var layerIndices = [];
            for(var layer in self.layerToIndex) {
                layerIndices.push(self.layerToIndex[layer]);
            }
            self.matman.setLayerVisible(layerIndices, show, model.id);
            self.viewer.invalidate(true);
        } else {
            var nodeIdBatch = [];
            var action = show
                ? self.viewer.visibilityManager.show
                : self.viewer.visibilityManager.hide;

            forEachNode(self, function(dbId, layerIndex) {
                if (indexToLayer[layerIndex].visible === show) {
                    return;
                }

                nodeIdBatch.push(dbId);

                if (nodeIdBatch.length === BatchSize) {
                    action(nodeIdBatch, model);
                    nodeIdBatch.length = 0;
                }
            });

            nodeIdBatch.length > 0 && action(nodeIdBatch, model);
        }

        // Update layers state.
        var indexToLayerCount = indexToLayer.length;
        for (var i = 1; i < indexToLayerCount; ++i) {
            var currentLayer = indexToLayer[i];
            if (currentLayer) {
                currentLayer.visible = show;
            }
        }
    }

    function forEachNode(self, callback) {

        var nodeToLayer = self.nodeToLayer;

        // if there are no layers, layerIndex is not set for any dbId and we are done.
        if (!nodeToLayer || !nodeToLayer.length) {
            return;
        }

        var access = self.model.getData().instanceTree.nodeAccess;

        for (var dbId in access.dbIdToIndex) {
            var dbIdIndex = access.dbIdToIndex[dbId];
            var layerIndex = nodeToLayer[dbIdIndex] || 0;
            if (layerIndex !== 0) {
                callback(dbId | 0x0, layerIndex);
            }
        }
    }

    /**
     * 
     * @param {*} self 
     * @param {*} layer 
     * @private
     */
    function getLayerIndex(self, layer) {

        if (typeof layer === 'number')
            return layer;

        return self.layerToIndex[layer.name || layer] || 0;
    }

    /**
     * Parent layers are not considered layers.
     * @param {object} layerInfo 
     * @private
     */
    function _isParentLayerInfo(layerInfo) {
        return !layerInfo.layer.isLayer;
    }
      

    /**
     * For some 2D models, the layer metadata may contain child elements that
     * contain additional children with more layers.
     * This function flattens the data into a single array.
     *
     * @private
     */
    function _flattenChildren(childrenArray) {

        if (!childrenArray) 
            return [];

        var ret = [];
        var maxIndex = 0;
        _traverse(childrenArray, (child) => {
            ret.push(child);
            if (child.isLayer) {
                maxIndex = Math.max(maxIndex, child.index | 0);
            }
        });

        // Assign a layer number value to parent nodes.
        for (var i=0; i<ret.length; ++i) {
            if (!ret[i].isLayer) {
                ret[i].index = ++maxIndex;
            }
        }

        return ret; 
    }

    /**
     * @private
     */
    function _traverse(array, callback) {
        for (var i=0; i<array.length; ++i) {
            var elem = array[i];
            callback(elem);
            if (elem.children) {
                _traverse(elem.children, callback);
            }
        }
    }

