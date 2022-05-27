
import { DockingPanel } from "./DockingPanel";
import { TreeOnDemand } from "./TreeOnDemand";
import { ModelStructureTreeDelegate } from "./ModelStructureTreeDelegate";


/**
 * The Model Structure Panel allows users to explore and set the visibility and selection states of the nodes defined in the loaded model.
 *
 * @alias Autodesk.Viewing.UI.ModelStructurePanel
 * @augments Autodesk.Viewing.UI.DockingPanel
 * @param {HTMLElement} parentContainer - The container for this panel.
 * @param {string} id - The id for this panel.
 * @param {string} title - The initial title for this panel.
 * @param {object} [options] - An optional dictionary of options.
 * @param {boolean} [options.startCollapsed=true] - When true, collapses all of the nodes under the root.
 * @class
 */
export function ModelStructurePanel(parentContainer, id, title, options)
{
    DockingPanel.call(this, parentContainer, id, title, options);

    this.container.classList.add('model-structure-panel');
    
    options = options || {};
    if (!options.heightAdjustment)
        options.heightAdjustment = 40;
    if (!options.marginTop)
        options.marginTop = 0;
    options.left = true;
    
    this.createScrollContainer(options);
    this.onScroll = this.onScroll.bind(this);
    this.scrollContainer.addEventListener('scroll', this.onScroll);
    this.scrollContainer.style['overflow-x'] = 'hidden';

    this.options = options;
    this.tree = null;
    this._pendingModels = [];
    this.uiCreated = false;

    var that = this;
    this.addVisibilityListener(function (show) {
        if (show) {
            if (!that.uiCreated) {
                that.createUI();                
            }
            
            that.resizeToContent();
        }
    });
}

ModelStructurePanel.prototype = Object.create(DockingPanel.prototype);
ModelStructurePanel.prototype.constructor = ModelStructurePanel;

ModelStructurePanel.prototype.uninitialize = function() {
    this.scrollContainer.addEventListener('scroll', this.onScroll);
    this.scrollContainer.parentNode.removeChild(this.scrollContainer);

    this.tree?.destroy();

    DockingPanel.prototype.uninitialize.call(this);
};

/**
 * Handler for when a model gets added into the scene.
 *
 * @param {Autodesk.Viewing.Model} model - The model being added into the scene.
 */
ModelStructurePanel.prototype.addModel = function(model)
{
    if (!model)
        return;

    if (this.uiCreated) {
        this.createTreeUI(model);
    } else {
        var index = this._pendingModels.indexOf(model);
        if (index !== -1)
            return;
        this._pendingModels.push(model);
    }
};

/**
 * Handler for when a model gets removed from the scene.
 * 
 * @param {Autodesk.Viewing.Model} model - The model being added into the scene.
 */
ModelStructurePanel.prototype.unloadModel = function(model)
{
    if (!model)
        return;

    if (this.uiCreated) {
        this.removeTreeUI(model);
    } else {
        var index = this._pendingModels.indexOf(model);
        if (index === -1)
            return;
        this._pendingModels.splice(index, 1);
    }
};

/**
 * Used for delayed initialization of the HTML DOM tree
 *
 * @private
 */
ModelStructurePanel.prototype.createUI = function()
{    
    if (this.uiCreated)
        return;

    // Title
    var title = "";
    var localizeTitle;
    if (this.options && this.options.defaultTitle) {
        title = this.options.defaultTitle;
        localizeTitle = this.options.localizeTitle !== undefined ? !!this.options.localizeTitle : true;
    } else {
        title = this.modelTitle;
        localizeTitle = false;
    }
    if (!title) {
        title = "Browser";
        localizeTitle = true;
    }

    this.setTitle(title, {localizeTitle: localizeTitle});
    this.uiCreated = true;

    this.tree = new TreeOnDemand(this.scrollContainer, this.options);
    this.tree.setGlobalManager(this.globalManager);

    if (this._pendingModels.length === 0) {
        // Do nothing, we get an empty model browser panel.
        return;
    }

    // Create Tree UI for models
    for (var i=0; i<this._pendingModels.length; ++i) {
        this.createTreeUI(this._pendingModels[i]);
    }
    this._pendingModels = [];
};

ModelStructurePanel.prototype.createTreeUI = function(model) {
    if (this.tree.getDelegate(model.id)) {
        // Don't allow register a second delegate for the same model.
        return false;
    }

    var delegate = new ModelStructureTreeDelegate(this, model);
    delegate.setGlobalManager(this.globalManager);
    this.tree.pushDelegate(delegate);

    var _this = this;
    model.getObjectTree(
        function onSuccess(instanceTree){
            _this.setInstanceTree(delegate, instanceTree);
        },
        function onFailure() {
            _this.setInstanceTree(delegate, null);
        }
    );
    return true;
};

/**
 * Can be overriden by sub-classes
 *
 * @param delegate
 * @param instanceTree
 */
ModelStructurePanel.prototype.setInstanceTree = function(delegate, instanceTree) {
    this.tree.setInstanceTree(delegate, instanceTree);
};

ModelStructurePanel.prototype.removeTreeUI = function(model) {
    if (this.tree.removeDelegate(model.id)) {
        this.scrollContainer.scrollTop = 0;
        this.onScroll();
    }
};

ModelStructurePanel.prototype.onScroll = function() {
    this.tree.setScroll(this.scrollContainer.scrollTop);
};

/**
 * Override this method to specify the label for a node.
 * By default, this is the node's name, or 'Object ' + object id if the name
 * is blank.
 *
 * @param {object} node - A node in an Autodesk.Viewing.Model
 * @returns {string} Label of the tree node
 */
ModelStructurePanel.prototype.getNodeLabel = function(node)
{
    return this.myDelegate.getNodeLabel(node);
};

/**
 * Override this method to do something when the user clicks on a tree node
 * @param {Tree} tree
 * @param {*} dbId
 * @param {*} model
 * @param {Event} event
 */
ModelStructurePanel.prototype.onTreeNodeClick = function() 
{
    throw new Error('Method must be overriden.');
};

/**
 * Override this to do something when the user right-clicks on a tree node
 * @param {Tree} tree
 * @param {*} node
 * @param {*} model
 * @param {Event} event
 */
ModelStructurePanel.prototype.onTreeNodeRightClick = function()
{
    throw new Error('Method must be overriden.');
};

/**
 * Override this method to be notified when the user clicks on the title.
 *
 * @override
 * @param {Event} event
 */
ModelStructurePanel.prototype.onTitleClick = function()
{
    // Do nothing by default.
};

/**
 * Override this method to be notified when the user double-clicks on the title.
 *
 * @override
 * @param {Event} event
 */
ModelStructurePanel.prototype.onTitleDoubleClick = function()
{
    // Do nothing by default.
};
