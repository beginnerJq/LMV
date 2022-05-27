
import { TreeDelegate } from "./TreeDelegate";
import { logger } from "../logger/Logger";
import { getResourceUrl } from "../globals";
import i18n from "i18next";


    // Constants - State
    var STATE_LOADING = 1;
    var STATE_AVAILABLE = 2;
    var STATE_NOT_AVAILABLE = 3;

    // Constants - ids
    // All valid ids in the instanceTree are based off of 1.
    // Using negative values to detect special situations.
    var ID_LOADING = -1;
    var ID_NOT_AVAILABLE = -2;

    // Dummy root - See PropWorker.js
    const SYNTHETIC_ROOT_ID = -1e10;
    

    export function ModelStructureTreeDelegate(panel, model) {
        TreeDelegate.call(this);

        this.panel = panel;
        this.model = model;
        
        let _document = this.getDocument();
        this.modelDiv = _document.createElement('div');
        this.modelDiv.classList.add('model-div');
        this.modelDiv.setAttribute('lmv-modelId', model.id);

        this.instanceTree = null;
        this.rootId = ID_LOADING;
        this.state = STATE_LOADING;
    }

    ModelStructureTreeDelegate.prototype = Object.create(TreeDelegate.prototype);
    ModelStructureTreeDelegate.prototype.constructor = ModelStructureTreeDelegate;


    ModelStructureTreeDelegate.prototype.isLoading = function() {
        return this.state === STATE_LOADING;
    };
    
    ModelStructureTreeDelegate.prototype.isAvailable = function() {
        return this.state === STATE_AVAILABLE;
    };
    
    ModelStructureTreeDelegate.prototype.isNotAvailable = function() {
        return this.state === STATE_NOT_AVAILABLE;
    };

    ModelStructureTreeDelegate.prototype.isControlId = function(dbId) {
        return dbId === ID_LOADING || dbId === ID_NOT_AVAILABLE;
    };

    ModelStructureTreeDelegate.prototype.getControlIdCss = function(dbId) {
        if (dbId === ID_LOADING) {

        }
        if (dbId === ID_NOT_AVAILABLE) {

        }
        return null;
    };

    ModelStructureTreeDelegate.prototype.getRootId = function()
    {
        return this.rootId;
    };

    ModelStructureTreeDelegate.prototype.getTreeNodeId = function(node)
    {
        if (typeof node == "object") {
            logger.warn("Object used instead of dbId. Fix it.");
            return node.dbId;
        } else
            return node;
    };

    ModelStructureTreeDelegate.prototype.getTreeNodeIndex = function(nodeId)
    {
        return this.instanceTree.nodeAccess.dbIdToIndex[nodeId];
    };

    ModelStructureTreeDelegate.prototype.getTreeNodeLabel = function(dbId)
    {
        if (dbId === ID_LOADING){
            var modelName = getModelName(this.model);
            return i18n.t('Loading model', { name: modelName });
        }

        if (dbId === ID_NOT_AVAILABLE) {
            var modelName = getModelName(this.model);
            return modelName; // Just show the file name, without any children.
        }

        // For multi-model cases allow overriding of the model display name.
        // Used where only host application knows true model display name.
        if (dbId === this.getRootId()) {
            var modelName = getModelName(this.model);
            return modelName;
        }

        // Special case...
        if (dbId == SYNTHETIC_ROOT_ID) {
            return 'Object 0';
        }

        var res = this.instanceTree.getNodeName(dbId, true);
        return res || ('Object ' + dbId);
    };

    ModelStructureTreeDelegate.prototype.getTreeNodeClass = function(dbId)
    {
        if (dbId === ID_LOADING || dbId === ID_NOT_AVAILABLE)
            return 'message-unexpected';

        return '';
    };

    ModelStructureTreeDelegate.prototype.getTreeNodeParentId = function(nodeId)
    {
        // Required to abort parent traversal
        if (nodeId === SYNTHETIC_ROOT_ID) {
            return 0;
        }

        let parentId = this.instanceTree.nodeAccess.getParentId(nodeId);

        // UI handles parent 0 via the synthetic id.
        if (parentId === 0) {
            return SYNTHETIC_ROOT_ID;
        }

        return parentId;
    }

    ModelStructureTreeDelegate.prototype.getTreeNodeCount = function()
    {
        return this.instanceTree.nodeAccess.getNumNodes();
    }
    
    ModelStructureTreeDelegate.prototype.getTreeNodeClientHeight = function (dbId)
    {
        return 36;
    }

    ModelStructureTreeDelegate.prototype.getTreeNodeDepthOffset = function (node, depth)
    {
        return 13 + 25 * depth;
    }

    ModelStructureTreeDelegate.prototype.isTreeNodeGroup = function(dbId)
    {
        if (this.isControlId(dbId)) {
            return false;
        }
        return this.instanceTree.getChildCount(dbId) > 0;
    };

    ModelStructureTreeDelegate.prototype.shouldCreateTreeNode = function(dbId)
    {
        return true;
    };

    ModelStructureTreeDelegate.prototype.createTreeNode = function(id, parent) {
        
        let self = this;
        let _document = self.getDocument();
        // hightlight.
        parent.addEventListener('mousedown', function() {
            
            var onMouseUp = function() {
                this.classList.remove('highlight');
                self.removeDocumentEventListener('mouseup', onMouseUp);
            }.bind(parent);

            parent.classList.add('highlight');
            self.addDocumentEventListener('mouseup', onMouseUp);
        });

        // visibility button.
        if (!this.isControlId(id)) {
            var button = _document.createElement('div');
            button.dbId = id;
            button.classList.add('visibility');

            button.addEventListener('mousedown', function(event) {
                event.preventDefault();
                event.stopPropagation();
            });

            button.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopPropagation();
                var dbId = parseInt(event.target.dbId);
                this.panel.onEyeIcon(dbId, this.model);
            }.bind(this));

            parent.appendChild(button);
        }

        // Add loading spinner
        if (id === ID_LOADING) {
            var img = _document.createElement('img');
            img.src = getResourceUrl('res/ui/spinner.png');
            img.style.animation = 'loading-spinner-perpetual-motion 1s infinite linear';
            img.style.float = 'right';
            img.style.marginRight = '5px';
            img.style.width = '20px';
            parent.appendChild(img);
        }

        // Delegate rest of the node creation.
        var opts = { localize: (id === ID_LOADING || id === ID_NOT_AVAILABLE) };
        TreeDelegate.prototype.createTreeNode.call(this, id, parent, opts);
    };

    ModelStructureTreeDelegate.prototype.onTreeNodeRightClick = function(tree, node, event)
    {
        if (!this.isControlId(node)) {
            this.panel.onTreeNodeRightClick(tree, node, this.model, event);
        }
    };

    
    ModelStructureTreeDelegate.prototype.onTreeNodeClick = function(tree, dbId, event)
    {
        if (!this.isControlId(dbId)) {
            this.panel.onTreeNodeClick(tree, dbId, this.model, event);
        }
    };

    ModelStructureTreeDelegate.prototype.onTreeNodeDoubleClick = function(tree, node, event)
    {
        // nothing.
    };

    ModelStructureTreeDelegate.prototype.onTreeNodeIconClick = function(tree, node, event)
    {        
        if (this.isTreeNodeGroup(node)) {
            var isCollapsed = tree.isCollapsed(this, node);
            tree.setCollapsed(this, node, !isCollapsed);
        }
    };

    ModelStructureTreeDelegate.prototype.onTreeNodeReized = function(tree)
    {
        // nothing.
    };

    ModelStructureTreeDelegate.prototype.forEachChild = function(dbId, callback, recursive)
    {
        if (!this.isControlId(dbId)) {
            this.instanceTree.enumNodeChildren(dbId, callback, recursive);
        }
    };


    ModelStructureTreeDelegate.prototype.setInstanceTree = function(instanceTree)
    {
        this.instanceTree = instanceTree;
        this.state = instanceTree ? STATE_AVAILABLE : STATE_NOT_AVAILABLE;
        this.rootId = instanceTree ? instanceTree.getRootId() : ID_NOT_AVAILABLE;
        setInstanceTreeAux(this)
    };

    function setInstanceTreeAux(delegate) {
        var instanceTree = delegate.instanceTree;
        
        if (!instanceTree)
            return;
        
        var rootId = delegate.rootId;
        var rootName = instanceTree.getNodeName(rootId);
        var childName;
        var childId = 0;
        var childCount = 0;
        instanceTree.enumNodeChildren(rootId, function(child) {
            if (!childCount) {
                childName = instanceTree.getNodeName(child);
                childId = child;
            }
            childCount++;
        });
    
        // Detect Fusion models which have a root inside a root
        delegate.hasDoubleRoot = (childCount === 1 && rootName === childName);
        delegate.rootId = delegate.hasDoubleRoot ? childId : rootId;
    };

    ModelStructureTreeDelegate.prototype.clean = function()
    {
        var container = this.modelDiv;
        var child;
        while (child = container.lastChild) {
            container.removeChild(child);
        }
    };

    /**
     * Helper function that returns the name of the seed file as registered in DS/OSS.
     * @param {*} model 
     */
    function getModelName(model) {

        // Use name override if specified
        var modelName = getModelNameOverride(model);
        if (modelName) {
            return modelName;
        }

        var modelData = model.getData();
        if (!modelData) {
            return '';
        }

        // Standard case: For models loaded with loadDocumentNode(), we obtain the name from the manifest.
        var node = model.getDocumentNode();
        if (node) {
            return node.getModelName();
        }

        // We cannot determine the model name. Just display a dummy placeholder.
        return 'Model';
    };

    /**
     * Helper function that returns model name override.
     * Used for cases where only the host application knows the true model name.
     * @param {*} model 
     */
    function getModelNameOverride(model) {
        var modelData = model.getData();
        if (modelData && modelData.loadOptions && modelData.loadOptions.modelNameOverride) {
            return modelData.loadOptions.modelNameOverride;
        }
        return '';
    };

