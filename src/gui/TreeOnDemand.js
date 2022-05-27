
import { isTouchDevice, isIE11 } from "../compat";
import { GestureRecognizers } from "../tools/GestureHandler";
import { LoadingSpinner } from "./LoadingSpinner";
import i18n from "i18next";
import { GlobalManagerMixin } from '../application/GlobalManagerMixin';
const Hammer = require('../../thirdparty/hammer/hammer.js');


var ELEMENT_POOL_LENGHT = 150;
var SCROLL_SAFE_PADDING = 300; // Pixels

/**
 * TreeOnDemand view control
 * It takes ownership of the contents in parentContainer.
 * 
 * @constructor
 * @param {HTMLElement} scrollContainer - DOM element parent of the tree.
 */
 export function TreeOnDemand(scrollContainer, options) {

    this.dirty = false;
    this.nextFrameId = 0;
    this.scrollY = 0;
    this.delegates = [];
    this.idToDelegate = {};
    this.options = options;

    var _document = this.getDocument();

    // Initialize root container.
    this.rootContainer = _document.createElement('div');
    this.rootContainer.classList.add('docking-panel-container-gradient');
    this.rootContainer.classList.add('treeview');
    this.rootContainer.classList.add('on-demand');
    scrollContainer.appendChild(this.rootContainer);

    this.paddingDiv = _document.createElement('div');
    this.paddingDiv.style['border'] = 0;
    this.paddingDiv.style['margin'] = 0;
    this.paddingDiv.style['padding'] = 0;
    this.sizedDiv = scrollContainer.parentNode; // Just a reference, we are not supposed to change it.

    // Initialize common tables across all delegates.
    // These are tables to share CSS strings between nodes.
    this.nodeCssTable = [[], ['group'], ['leaf']];
    this.cssStringToNodeCssTable = {'': 0, 'group': 1, 'leaf': 2};
    this.nodeIndexToNodeCssTables = {}; // Contains Typed-Arrays per model id.

    // Creates element pools.
    var elementsPool = [];
    var elementsPoolCount = ELEMENT_POOL_LENGHT;

    for (var i = 0; i < elementsPoolCount; ++i) {
        var element = createNodeHTmlElement(_document);
        elementsPool[i] = element;
    }

    this.elementsPool = elementsPool;
    this.elementsUsed = 0;

    this.spinner = new LoadingSpinner(scrollContainer);
    this.spinner.setGlobalManager(this.globalManager);
    this.spinner.addClass('tree-loading-spinner');

    // Add input event listeners.
    var touchDevice = isTouchDevice();

    if (touchDevice) {
        this.hammer = new Hammer.Manager(this.rootContainer, {
            recognizers: [
                GestureRecognizers.doubletap,
                GestureRecognizers.press
            ],
            handlePointerEventMouse: false,
            inputClass: isIE11 ? Hammer.PointerEventInput : Hammer.TouchInput
        });
    }

    for (var i = 0; i < elementsPoolCount; ++i) {
        var element = elementsPool[i];

        if (touchDevice) {
            this.hammer.on('doubletap', onElementDoubleTap.bind(this));
            this.hammer.on('press', onElementPress.bind(this));
        }

        element.addEventListener('click', onElementClick.bind(this));
        element.addEventListener('dblclick', onElementDoubleClick.bind(this));
        element.addEventListener('contextmenu', onElementContextMenu.bind(this));

        element.icon.addEventListener('click', onElementIconClick.bind(this));
        element.icon.addEventListener('mousedown', onElementIconMouseDown.bind(this));
    }

    redraw(this);
};

var proto = TreeOnDemand.prototype;
proto.constructor = TreeOnDemand;
GlobalManagerMixin.call(proto);


/**
 * A delegate is added whenever a new model is loaded into the scene.
 * The instanceTree is not available at this point.
 */
proto.pushDelegate = function(delegate) {

    this.delegates.push(delegate);
    this.idToDelegate[delegate.model.id] = delegate;
    redraw(this);
};

/**
 * Removes the delegate and tree-ui for a given model id.
 */
proto.removeDelegate = function(modelId) {
    for (var i=0; i<this.delegates.length; ++i) {
        var delegate = this.delegates[i];
        if (delegate.model.id === modelId) {
            this.delegates.splice(i, 1);
            delete this.idToDelegate[modelId];
            delete this.nodeIndexToNodeCssTables[modelId];
            redraw(this);
            return true;
        }
    }
    return false;
};

/**
 * Specifies that the model associated to the delegate doesn't have a tree structure.
 * Probably because the property database wasn't loaded or is broken somehow.
 */
proto.setInstanceTree = function(delegate, instanceTree) {

    delegate.setInstanceTree(instanceTree);
    redraw(this);

    if (!instanceTree)
        return;


    // Initialize per/delegate table mapping.
    // It complements the CSS tables created in the constructor.
    var nodeIndexToNodeCssTable = new Uint8Array(delegate.getTreeNodeCount());
    
    var createTables = function(nodeId) {
        var nodeIndex = delegate.getTreeNodeIndex(nodeId);
        nodeIndexToNodeCssTable[nodeIndex] = delegate.isTreeNodeGroup(nodeId) ? 1 : 2;
    };

    var rootId = delegate.instanceTree.getRootId();
    delegate.forEachChild(rootId, createTables, true);

    var modelId = delegate.model.id;
    this.nodeIndexToNodeCssTables[modelId] = nodeIndexToNodeCssTable;



    var childId = 0;
    var childCount = 0;
    instanceTree.enumNodeChildren(rootId, function(child) {
        if (!childCount) {
            childId = child;
        }
        childCount++;
    });

    // Initialize collapsed states.
    this.setAllCollapsed(delegate, true);

    var excludeRoot = this.options.excludeRoot;
    var startCollapsed = this.options.startCollapsed;

    if (excludeRoot) {
        this.setCollapsed(delegate, rootId, false);
        if(!startCollapsed) {
            this.setCollapsed(delegate, childId, false);
        }
    } else {
        if(!startCollapsed) {
            this.setCollapsed(delegate, delegate.rootId, false);
        }
    }

    redraw(this, true);
};

/**
 * Show/hide the tree control
 * @param {boolean} show - true to show the tree control, false to hide it
 */
proto.show = function (show) {

    this.rootContainer.style.display = 'show' ? block : 'none';
};

/**
 * Get the root container
 * @nosideeffects
 * @returns {string}
 */
proto.getRootContainer = function () {

    return this.rootContainer;
};

/**
 * Get the tree delegate
 * 
 * @nosideeffects
 * @returns {TreeDelegate}
 */
proto.getDelegate = function (modelId) {

    return this.idToDelegate[parseInt(modelId)];
};

/**
 * Is the given group node in the tree collapsed?
 * @nosideeffects
 * @param {Object} group -The group node
 * @returns {boolean} true if group node is collapsed, false if expanded
 */
proto.isCollapsed = function(delegate, group) {

    var css = getNodeCss(this, delegate, group);
    return css && css.indexOf('collapsed') !== -1;
};

/**
 * Collapse/expand the given group node in the tree
 * @param {Object} delegate
 * @param {Object} group - the group node
 * @param {boolean} collapsed - true to collapse the group node, false to expand it
 */
proto.setCollapsed = function(delegate, group, collapsed, recursive) {

    // TODO: If need, we can optimize going trough the tree only once.
    if (collapsed) {
        this.addClass(delegate, group, 'collapsed', recursive);
        this.removeClass(delegate, group, 'expanded', recursive);
    } else {
        this.addClass(delegate, group, 'expanded', recursive);
        this.removeClass(delegate, group, 'collapsed', recursive);
    }
};

/**
 * Collapse/expand all group nodes in the tree
 * @param {object} delegate
 * @param {boolean} collapsed - true to collapse tree, false to expand it
 */
proto.setAllCollapsed = function(delegate, collapsed) {

    var collapse = collapsed ?
        function(node) {
            this.addClass(delegate, node, 'collapsed', false);
            this.removeClass(delegate, node, 'expanded', false);
        }.bind(this) :
        function(node) {
            this.addClass(delegate, node, 'collapsed', false);
            this.removeClass(delegate, node, 'expanded', false);
        }.bind(this);

    var rootId = delegate.instanceTree.getRootId();
    this.iterate(delegate, rootId, function(node) {
        delegate.isTreeNodeGroup(node) && collapse(node);
        return true;
    });
};

/**
 * Add the given nodes to the current selection
 * @param {Array.<Object>} nodes - nodes to add to the current selection
 */
proto.addToSelection = function(delegate, nodes) {

    var nodesCount = nodes.length;

    for (var i = 0; i < nodesCount; ++i) {
        this.addClass(delegate, nodes[i], 'selected', false);
    }

    redraw(this);
};

/**
 * Remove the given nodes from the current selection
 * @param {Array.<Object>} nodes - The nodes to remove from the current selection
 */
proto.removeFromSelection = function(delegate, nodes) {

    var nodesCount = nodes.length;

    for (var i = 0; i < nodesCount; ++i) {
        this.removeClass(delegate, nodes[i], 'selected', false);
    }

    redraw(this);
};

/**
 * Set the current selection
 * @param {Array.<Object>} nodes - nodes to make currently selected
 */
proto.setSelection = function(delegate, nodes) {

    this.clearSelection(delegate);
    this.addToSelection(delegate, nodes);

    return this.selectedNodes;
};

/**
 * Clear the current selection
 */
proto.clearSelection = function (delegate) {

    // In order to optimize memmory, we send one at a time (the whole model could be selected).
    var nodeToRemove = [];
    var unselect = function(nodeId) {

        var css = getNodeCss(this, delegate, nodeId);

        if (css && css.indexOf('selected') !== -1) {
             nodeToRemove[0] = nodeId;
             this.removeFromSelection(delegate, nodeToRemove);
        }
    }.bind(this);
    
    var rootId = delegate.instanceTree.getRootId();

    delegate.forEachChild(rootId, unselect, true);
};

/**
 * Is the given node selected?
 * @nosideeffects
 * @param {Object} node - The tree node
 * @returns {boolean} - true if node is selected, false otherwise
 */
proto.isSelected = function(node) {

    var css = getNodeCss(this, delegate, node)
    return css && css.indexOf('selected') !== -1;
};

/**
 * Expands the Tree to have the node UI be visible.
 * It also returns the pixel height required to scroll in orther to get the element visible. 
 * 
 * @param {Object} nodeId - The node id
 * @param {Autodesk.Viewing.Model} model - The model that owns the id.
 * 
 * @returns {number} the pixel height required to scroll the container to allow the nodeId to be visible.
 */
proto.scrollTo = function(nodeId, model) {

    var delegate = this.getDelegate(model.id);
    if (delegate && delegate.isNotAvailable()) {
        // There is no tree for the model and so
        // no target to scroll to
        return;
    }
    var nodeFound = false;
    var expandedHeightStack = []; // Heights of the visible branches and nodes before node.

    var getNodeScrollTop = function(candidateId, iDelegate) {

        nodeFound = nodeFound || nodeId === candidateId;
        if (nodeFound) {
            return;
        }

        expandedHeightStack.push(iDelegate.getTreeNodeClientHeight(candidateId));

        var stackSize = expandedHeightStack.length;
        var elementExpanded = (
            iDelegate.isTreeNodeGroup(candidateId) &&
            getNodeCss(this, iDelegate, candidateId).indexOf('expanded') !== -1);

        iDelegate.forEachChild(candidateId, function(id){
            getNodeScrollTop(id, iDelegate);
        });

        if (!elementExpanded && !nodeFound) {
            if (expandedHeightStack.length > stackSize) {
                expandedHeightStack.splice(stackSize);
            }
        }
    }.bind(this);
    this.setCollapsed(delegate, nodeId, false, true);

    // Calculate and set the container's parent scroll top.
    var rootId = delegate.getRootId();
    getNodeScrollTop(rootId, delegate);
    if (!nodeFound) {
        return -1;
    }

    var scrollTop = 0;
    var expandedHeightStackCount = expandedHeightStack.length;
    for (var i = this.isExcludeRoot() ? 1 : 0; i < expandedHeightStackCount; ++i) {
        scrollTop += expandedHeightStack[i];
    }

    // If single model, early return...
    if (this.delegates.length === 1) {
        redraw(this, true);
        return scrollTop;        
    }


    // Multi model treatment, take into account other models on top
    for (var i=0; i<this.delegates.length; ++i) {
        
        var otherDelegate = this.delegates[i];
        if (otherDelegate === delegate) {
            break;
        }
        
        expandedHeightStack = [];
        nodeId = -1;
        nodeFound = false;
        rootId = otherDelegate.getRootId();
        getNodeScrollTop(rootId, otherDelegate);

        expandedHeightStackCount = expandedHeightStack.length;
        var othersHeight = 0;
        for (var j = 0; j < expandedHeightStackCount; ++j) {
            othersHeight += expandedHeightStack[j];
        }
        scrollTop += othersHeight;
    }

    // Avoid scrolling
    redraw(this, true);
    return scrollTop;
};

/**
 * Add a class to a node
 * @param {object} delegate
 * @param {Number|Object} node - The tree node
 * @param {string} className
 * @returns {boolean} - true if the class was added, false otherwise
 */
proto.addClass = function(delegate, node, className, recursive) {

     function add(tree, nodeId, className) {

        var css = getNodeCss(tree, delegate, nodeId);
        if (!css) {
            return;
        }

        var cssIndex = css.indexOf(className);
        if (cssIndex !== -1) {
            return;
        }

        css = css.slice(0);
        css.push(className);
        css.sort();

        setNodeCss(tree, delegate, nodeId, css);
    }

    // It is intentional that the recursive add starts at the parent.
    if (recursive) {
        var parentId = delegate.getTreeNodeParentId(getNodeId(this, node));
        while (parentId) {
            add(this, parentId, className);
            parentId = delegate.getTreeNodeParentId(parentId);
        }
    } else {
        add(this, node, className);
    }

    redraw(this);
    return true;
};

/**
 * Remove a class from a node
 * @param {object} delegate
 * @param {Number|Object} node - The tree node or its dbId
 * @param {string} className
 * @returns {boolean} - true if the class was removed, false otherwise
 */
proto.removeClass = function (delegate, node, className, recursive) {

    function remove(tree, nodeId, className) {

        var css = getNodeCss(tree, delegate, nodeId);

        if (!css) {
            return;
        }

        var cssIndex = css.indexOf(className);

        if (cssIndex === -1) {
            return;
        }

        css = css.slice(0);
        css.splice(cssIndex, 1);

        setNodeCss(tree, delegate, nodeId, css);
    };

    //It is intentional that the recursive add starts at the parent.
    if (recursive) {
        var parentId = delegate.getTreeNodeParentId(getNodeId(this, node));
        while (parentId) {
            remove(this, parentId, className);
            parentId = delegate.getTreeNodeParentId(parentId);
        }
    } else {
        remove(this, node, className);
    }

    redraw(this);
    return true;
};

/**
 * Does the node have the given class?
 * @nosideeffects
 * @param {Number|Object} node - The node or its dbId
 * @param {string} className
 * @returns {boolean} true if the node has the given class, false otherwise
 */
proto.hasClass = function(node, className) {

    return getNodeCss(this, delegate, node).indexOf(className) !== 1;
};

/**
 * Clears the contents of the tree
 */
proto.clear = function() {

    var container = this.rootContainer;
    var child;
    while (child = container.lastChild) {
        container.removeChild(child);
    }

    // clear children of delegate divs
    for (var i=0; i<this.delegates.length; ++i) {
        this.delegates[i].clean();
    }

    this.elementsUsed = 0;
};

/**
 * Iterates through nodes in the tree in pre-order.
 * @param {Object} delegate
 * @param {Object|Number} node - node at which to start the iteration.
 * @param {function(Object)} callback - callback function for each iterated node, if callbak returns false, node's chidren are not visited.
 */
proto.iterate = function(delegate, node, callback) {

    // roodId === 0 is a valid root node
    if (node === undefined || node === null) {
        return;
    }

    if(!delegate.shouldCreateTreeNode(node)) {
        return;
    }

    if(!callback(node)) {
        return;
    }

    delegate.forEachChild(node, function(child) {
        this.iterate(delegate, child, callback);
    }.bind(this));
};

proto.forEachDelegate = function(callback) {

    for (var i=0; i<this.delegates.length; ++i) {
        callback(this.delegates[i]);
    }
};

proto.destroy = function() {
    this.clear();
    cancelAnimationFrame(this.nextFrameId);
    
    var scrollContainer = this.rootContainer.parentNode;
    scrollContainer.removeChild(this.rootContainer);

    this.rootContainer = null;
    this.rootId = -1;
    this.nodeCssTable = null;
    this.nodeIndexToNodeCssTables = null;
    this.cssStringToNodeCssTable = null;
    this.elementsPool = null;
    this.elementsUsed = -1;
    this.scrollY = -1;

    if (this.hammer) {
        this.hammer.destroy();
        this.hammer = null;
    }
};

proto.setScroll = function(scrollY) {

    // Avoid re-building the tree unless we have scrolled far enough.
    if (Math.abs(this.scrollY - scrollY) > SCROLL_SAFE_PADDING) {
        this.scrollY = scrollY;
        redraw(this);
    }
};

proto.displayNoProperties = function(display) {

    var _document = this.getDocument();
    if (display) {
        if (!this.divNoProps) {
            this.divNoProps = _document.createElement('div');
            var msgKey = 'Model Browser is not available';
            this.divNoProps.innerText = i18n.t(msgKey);
            this.divNoProps.setAttribute('data-i18n', msgKey);
            this.divNoProps.classList.add('lmv-no-properties');
        }
        if (!this.divNoProps.parentNode) {
            var scrollContainer = this.rootContainer.parentNode;
            scrollContainer.appendChild(this.divNoProps);
        }
    } else {
        if (this.divNoProps && this.divNoProps.parentNode) {
            this.divNoProps.parentNode.removeChild(this.divNoProps);
        }
    }
};

proto.isExcludeRoot = function() {
    return this.delegates.length === 1 ? this.options.excludeRoot : false;
};

proto.getDelegateCount = function() {
    return this.delegates.length;
};

function getTreeNodeParentMaxSize(tree)
{
    return {
        width:  tree.sizedDiv.clientWidth  | 0x0,
        height: tree.sizedDiv.clientHeight | 0x0
    }
}

/**
 * @private
 * Renders the current state of the tree and its delegates (if any)
 * Handles rendering when there are no delegates and when there is only 1 in loading state.
 * Delegates most of the hard rendering to createVisibleElements()
 * 
 * @param {*} tree 
 */
function renderNow(tree) {

    // Clear
    tree.dirty = false;
    clearElementTree(tree);
    tree.displayNoProperties(false);

    // Special case 1: There are no models loaded into LMV
    if (tree.delegates.length === 0) {
        // An empty panel is all we want.
        tree.spinner.setVisible(false);
        return;
    }

    // Special case 2: Single model, properties are still loading
    if (tree.delegates.length === 1 && tree.delegates[0].isLoading()) {
        tree.spinner.setVisible(true);
        return;
    }

    // Special case 3: Single model, properties failed to load
    if (tree.delegates.length === 1 && tree.delegates[0].isNotAvailable()) {
        tree.spinner.setVisible(false);
        tree.displayNoProperties(true);
        return;
    }

    // Will render the tree delegate items at this point...
    tree.spinner.setVisible(false);

    // Render InstanceTree nodes
    createVisibleElements(tree);
}

/**
 * @private
 * Generates the visible DIVs for the model browser.
 * 
 * @param {*} tree 
 */
function createVisibleElements(tree) {
    
    var container = tree.rootContainer;
    var parentDimensions = getTreeNodeParentMaxSize(tree);
    var CONTAINER_HEIGHT = parentDimensions.height;
    var currentHeight = 0;
    var paddingHeight = 0;
    var adding = true;
    
    
    // Add a top-padding element that stretches until the first element shows
    container.appendChild(tree.paddingDiv);


    var delegates = tree.delegates.slice(0);
    var excludeRoot = tree.isExcludeRoot();

    while (delegates.length) {

        var delegate = delegates.shift();

        // Each tree element gets added into its parent model-div
        var modelDiv = delegate.modelDiv;
        container.appendChild(modelDiv);

        var ids = [delegate.getRootId()];
        var depth = {
            curr: excludeRoot ? -1 : 0,
            popIds: []
        };
    
        while (ids.length && adding) {

            // Any more room vertically?
            if (currentHeight > tree.scrollY + CONTAINER_HEIGHT + SCROLL_SAFE_PADDING) {
                adding = false;
                break;
            }

            // Any more DIVs in the pool?
            if (tree.elementsUsed === tree.elementsPool.length) {
                adding = false;
                break;
            }

            var id = ids.shift();
            var elemHeight = depth.curr === -1 ? 0 : delegate.getTreeNodeClientHeight(id);
            var elemTop = currentHeight;
            var elemBtm = elemTop + elemHeight;

            // render this node
            if ((elemHeight > 0) && (elemBtm + SCROLL_SAFE_PADDING) >= tree.scrollY) {

                // Actually add the element...
                var element = tree.elementsPool[tree.elementsUsed++];
                element.setAttribute("lmv-nodeId", id);

                delegate.createTreeNode(id, element.header);
                var css = delegate.getTreeNodeClass(id);
                if (css) {
                    element.classList.add(css);
                }

                var elementClasses = getNodeCss(tree, delegate, id);
                if (elementClasses) {
                    var elementClassesCount = elementClasses.length;
                    for (var i = 0; i < elementClassesCount; ++i) {
                        element.classList.add(elementClasses[i]);
                    }
                }

                var offset = delegate.getTreeNodeDepthOffset(id, depth.curr);
                element.header.style.paddingLeft = offset + 'px';

                modelDiv.appendChild(element);
            }

            if (elemBtm + SCROLL_SAFE_PADDING < tree.scrollY) {
                paddingHeight = elemBtm;
            }

            // move height counter
            currentHeight = elemBtm;

            // Children will get a new level of indentation
            var ignoreCollapsed = (elemHeight === 0);
            var childIds = enqueueChildrenIds(tree, delegate, id, ignoreCollapsed);

            // Inden when id has children and they are visible to the end user
            if (childIds && childIds.length > 0) {
                depth.curr++;

                var lastChildId = childIds[childIds.length-1];

                // Edge case if this node was supposed to pop a level, 
                // then transfer the count to the next generation
                var top = depth.popIds.length - 1;
                while (top >= 0 && depth.popIds[top] === id) {
                    depth.popIds[top--] = lastChildId;
                }

                // Remember when to pop depth back
                depth.popIds.push(lastChildId);

                // Add children to iteration
                ids = childIds.concat(ids);
            }
            
            while (depth.popIds.length > 0 && id === depth.popIds[depth.popIds.length-1]) {
                depth.popIds.pop();
                depth.curr--;
            }
        
        } // while-ids


        // Update top-padding height.
        tree.paddingDiv.style.height = paddingHeight + 'px';


        // If there are ids left, we need to process them to get the total height
        while (ids.length) {
    
            var id = ids.shift();
            var elemHeight = depth.curr === -1 ? 0 : delegate.getTreeNodeClientHeight(id);
            var elemTop = currentHeight;
            var elemBtm = elemTop + elemHeight;
    
            // move height counter
            currentHeight = elemBtm;
    
            // enqueue children (if any)
            var childIds = enqueueChildrenIds(tree, delegate, id);
            if (childIds && childIds.length) {
                ids = childIds.concat(ids);
            }
        }

    
    } // while-delegates

    container.style.height = currentHeight + 'px';
}

function enqueueChildrenIds(tree, delegate, id, ignoreCollapsed) {

    var isGroup = delegate.isTreeNodeGroup(id);
    if (!isGroup)
        return null;

    if (!ignoreCollapsed) {
        var collapsed = tree.isCollapsed(delegate, id);
        if (collapsed)
            return null;
    }
    
    var childIds = [];
    delegate.forEachChild(id, function(cId){
        childIds.push(cId);
    });

    return childIds;
}


function clearElementTree(tree) {
    var elementsUsed = tree.elementsUsed;
    var elementsPool = tree.elementsPool;

    // Return used elements to the elements pool.
    for (var i = 0; i < elementsUsed; ++i) {

        // Remove node id, just in case.
        var element = elementsPool[i];
        element.setAttribute('lmv-nodeId', '');

        // Remove css classes.
        element.className = '';

        // Remove all controls and listeners added by tree delegate, we spare the icon.
        var header = element.header;
        var childrenToRemove = header.childNodes.length - 1;

        for (var j = 0; j < childrenToRemove; ++j) {
            header.removeChild(header.lastChild);
        }
    }
    tree.clear();
}

/**
 *
 * @param {*} tree
 * @param {*} initial
 */
function redraw(tree, immediate) {

     // If the panel is not dirty, marked as dirty and schedule an update during next frame.
    if (tree.dirty && !immediate) {
        return;
    }

    if (immediate) {
        renderNow(tree);
    } else {
        tree.dirty = true;

        // All update requests are executed as one during next frame.
        tree.nextFrameId = requestAnimationFrame(function() {
            renderNow(tree);
        });
    }
}

/**
 * Get the id of the node if it's an object or returns input parameter if it's string or number.
 * @private
 * @param {*} node - A node object or a string or number with the id of the node.
 * @returns {number} The id of the node
 */
function getNodeId(tree, node) {

    if (typeof node !== "number" && typeof node !== "string") {
        return tree.threeDelegate.getTreeNodeId(node | 0x0);
    }
    return node;
}

/**
 * Returns the node associated to the html element provided
 * @private
 * @param {*} tree - A TreeOnDemand object instance.
 * @param {*} element - A node object or a string or number with the id of the node.
 * @returns {Number} Node object associated with with the html control.
 */
function getNodeIdFromElement(tree, element) {

    var nodeElement = null;

    while (element && element !== tree.rootContainer) {
        if (element.hasAttribute("lmv-nodeId")) {
            nodeElement = element;
            break;
        }
        element = element.parentElement;
    }

    if(!nodeElement) {
        return null;
    }

    var nodeId = nodeElement.getAttribute("lmv-nodeId");
    return parseFloat(nodeId);
};

function getModelIdFromElement(tree, element) {

    var nodeElement = null;
    
    while (element && element !== tree.rootContainer) {
        if (element.hasAttribute("lmv-modelId")) {
            nodeElement = element;
            break;
        }
        element = element.parentElement;
    }

    if(!nodeElement) {
        return null;
    }

    var modelId = nodeElement.getAttribute("lmv-modelId");
    return parseInt(modelId);
};

/**
 * Get the css array from the css table.
 * @private
 * @param {*} tree - A TreeOnDemand object instance.
 * @param {*} delegate
 * @param {Number} nodeId - A node id to whome state will be retrived.
 * @returns {Array} Array of strings with the css classes
 */
function getNodeCss(tree, delegate, node) {
    if (delegate.isControlId(node)) 
        return delegate.getControlIdCss(node);
    var nodeIndex = delegate.getTreeNodeIndex(node);
    return tree.nodeCssTable[tree.nodeIndexToNodeCssTables[delegate.model.id][nodeIndex]];
}

/**
 * Adds a new css entry table is needed and associate the css table index to node.
 * @private
 * @param {*} tree - A TreeOnDemand object instance.
 * @param {*} delegate
 * @param {Number} nodeId - A node id to whome state will be retrived.
 * @param {string} css
 */
function setNodeCss(tree, delegate, node, css) {

    var key = css.join(' ');
    var index = tree.cssStringToNodeCssTable[key] || tree.nodeCssTable.length;

    if (index === tree.nodeCssTable.length) {
        tree.nodeCssTable.push(css);
        tree.cssStringToNodeCssTable[key] = index;
    }

    var nodeIndex = delegate.getTreeNodeIndex(node);
    tree.nodeIndexToNodeCssTables[delegate.model.id][nodeIndex] = index;
}

/**
 * Given a node, create the corresponding HTML elements for the node and all of its descendants
 * @private
 * @param {Object} tree - TreeOnDemand node
 * @param {Object=} [options] - An optional dictionary of options.  Current parameters:
 *                              {boolean} [localize] - when true, localization is attempted for the given node; false by default.
 * @param {Number} [depth]
 */
function createNodeHTmlElement(_document, tree, options) {

    var header = _document.createElement('lmvheader');

    var icon = _document.createElement('icon');
    header.appendChild(icon);

    var element = _document.createElement('div');
    element.header = header;
    element.icon = icon;
    element.appendChild(header);

    return element;
};

/**
 *
 * @param {*} event
 */
function onElementDoubleTap(event) {

    var nodeId = getNodeIdFromElement(this, event.target);
    if (!nodeId) {
        return;
    }
    
    var modelId = getModelIdFromElement(this, event.target);
    var delegate = this.getDelegate(modelId);
    if (!delegate) {
        return;
    }
    
    delegate.onTreeNodeDoubleClick(this, nodeId, event);
}

/**
 *
 * @param {*} event
 */
function onElementPress(event) {

    var nodeId = getNodeIdFromElement(this, event.target);
    if (!nodeId) {
        return;
    }
    
    var modelId = getModelIdFromElement(this, event.target);
    var delegate = this.getDelegate(modelId);
    if (!delegate) {
        return;
    }
    
    delegate.onTreeNodeRightClick(this, nodeId, event);
}

/**
 *
 * @param {*} event
 */
function onElementClick(event) {

    // Click has to be done over the children of the tree elements.
    // Group and leaf nodes are only containers to layout consumer content.
    if (event.target.classList.contains('group') ||
        event.target.classList.contains('leaf')) {
        return;
    }

    var nodeId = getNodeIdFromElement(this, event.target);
    if(!nodeId) {
       return;
    }

    var modelId = getModelIdFromElement(this, event.target);
    var delegate = this.getDelegate(modelId);
    if (!delegate) {
        return;
    }

    delegate.onTreeNodeClick(this, nodeId, event);
    event.stopPropagation();
    event.preventDefault();
}

/**
 *
 * @param {*} event
 */
function onElementDoubleClick(event) {

    // Click has to be done over the children of the tree elements.
    // Group and leaf nodes are only containers to layout consumer content.
    if (event.target.classList.contains('group') ||
        event.target.classList.contains('leaf')) {
        return;
    }

    var nodeId = getNodeIdFromElement(this, event.target);
    if(!nodeId) {
        return;
    }

    var modelId = getModelIdFromElement(this, event.target);
    var delegate = this.getDelegate(modelId);
    if (!delegate) {
        return;
    }

    delegate.onTreeNodeDoubleClick(this, nodeId, event);
    event.stopPropagation();
    event.preventDefault();
}

/**
 *
 * @param {*} event
 */
function onElementContextMenu(event) {

    // Click has to be done over the children of the tree elements.
    // Group and leaf nodes are only containers to layout consumer content.
    if (event.target.classList.contains('group') ||
        event.target.classList.contains('leaf')) {
        return;
    }

    var nodeId = getNodeIdFromElement(this, event.target);
    if(!nodeId) {
        return;
    }
    
    var modelId = getModelIdFromElement(this, event.target);
    var delegate = this.getDelegate(modelId);
    if (!delegate) {
        return;
    }

    delegate.onTreeNodeRightClick(this, nodeId, event);
    event.stopPropagation();
    event.preventDefault();
}

/**
 *
 * @param {*} event
 */
function onElementIconClick(event) {

    var nodeId = getNodeIdFromElement(this, event.target);
    if(!nodeId) {
        return;
    }
    
    var modelId = getModelIdFromElement(this, event.target);
    var delegate = this.getDelegate(modelId);
    if (!delegate) {
        return;
    }

    delegate.onTreeNodeIconClick(this, nodeId, event);
    event.stopPropagation();
    event.preventDefault();
}

/**
 *
 * @param {*} event
 */
function onElementIconMouseDown(event) {

    event.stopPropagation();
    event.preventDefault();
}
