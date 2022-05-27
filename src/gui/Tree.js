
import { isTouchDevice, isIE11 } from "../compat";
import { GestureRecognizers } from "../tools/GestureHandler";
import { GlobalManagerMixin } from '../application/GlobalManagerMixin';

const Hammer = require('../../thirdparty/hammer/hammer.js');


/**
 * Tree view control
 * 
 * @class
 * @param {object} delegate TreeDelegate instance
 * @param {object} root - A node in the model Document
 * @param {HTMLElement|string} parentContainer - Or parentContainerId
 * @param {object} options
 * @alias Autodesk.Viewing.UI.Tree
 */
export function Tree(delegate, root, parentContainer, options) {
    this.myDelegate = delegate;
    this.mySelectedNodes = [];
    this.myOptions = options || {};
    this.parentContainer = parentContainer;

    var className = 'treeview';

    this.groupClassName = this.myOptions.groupClassName || 'expanded';
    this.leafClassName = this.myOptions.leafClassName || 'expanded';
    this.selectedClassName = this.myOptions.selectedClassName || 'selected';

    this.myGroupNodes = []; // <group> HTML elements in the tree

    this.nodeToElement = {};
    this.nodeIdToNode = {};

    var rootContainer = this.myRootContainer = this.createHtmlElement_(parentContainer, 'div', className);

    var rootElem = this.rootElem = this.createElement_(root, rootContainer, options, 0);

    this.setInputHandlers_();

    if(options && options.excludeRoot) {
        rootElem.classList.add("exclude");
    }

}

Tree.prototype.constructor = Tree;
GlobalManagerMixin.call(Tree.prototype);

/**
 * Remove tree from DOM.
 *
 * @alias Autodesk.Viewing.UI.Tree#destroy
 */
Tree.prototype.destroy = function () {
    this.myDelegate = null;
    if (this.parentContainer) {
        this.parentContainer.removeChild(this.myRootContainer);
        this.myRootContainer = null;
        this.parentContainer = null;
    }
};

/**
 * Show/hide the tree control
 *
 * @param {boolean} show - true to show the tree control, false to hide it
 *
 * @alias Autodesk.Viewing.UI.Tree#show
 */
Tree.prototype.show = function (show) {
    var rootContainer = this.myRootContainer;
    if (show) {
        rootContainer.style.display = 'block'; // TODO: want fade in
    } else {
        rootContainer.style.display = 'none';
    }
};

/**
 * Get the root container
 *
 * @nosideeffects
 * @returns {string}
 *
 * @alias Autodesk.Viewing.UI.Tree#getRootContainer
 */
Tree.prototype.getRootContainer = function () {
    return this.myRootContainer;
};

/**
 * Get DOM element for a given logical tree node (or its integer id)
 *
 * @nosideeffects
 * @param {object} node - Tree node element
 * @returns {HTMLElement}
 *
 * @alias Autodesk.Viewing.UI.Tree#getElementForNode
 */
Tree.prototype.getElementForNode = function (node) {

    //TODO: Remove this section once all places that hit it are gone
    if (typeof node !== "number" && typeof node !== "string") {
        //avp.logger.warn("Node object used where node ID should have");
        node = this.myDelegate.getTreeNodeId(node);
    }

    return this.nodeToElement[node];
};

/**
 * Get the tree delegate
 *
 * @nosideeffects
 * @returns {object} TreeDelegate instance
 *
 * @alias Autodesk.Viewing.UI.Tree#delegate
 */
Tree.prototype.delegate = function () {
    return this.myDelegate;
};

/**
 * Is the given group node in the tree collapsed?
 *
 * @nosideeffects
 * @param {object} group -The group node
 * @returns {boolean} true if group node is collapsed, false if expanded
 *
 * @alias Autodesk.Viewing.UI.Tree#isCollapsed
 */
Tree.prototype.isCollapsed = function (group) {
    return this.hasClass(group, 'collapsed');
};

/**
 * Collapse/expand the given group node in the tree
 *
 * @param {object} group - the group node
 * @param {boolean} collapsed - Set to true to collapse the group node, false to expand it
 * @param {boolean} recursive - Set to true to make it recursive
 * @alias Autodesk.Viewing.UI.Tree#setCollapsed
 */
Tree.prototype.setCollapsed = function (group, collapsed, recursive) {
    if (collapsed) {
        this.addClass(group, 'collapsed', recursive);
        this.removeClass(group, 'expanded', recursive);
    } else {
        this.addClass(group, 'expanded', recursive);
        this.removeClass(group, 'collapsed', recursive);
    }
};

/**
 * Collapse/expand all group nodes in the tree
 *
 * @param {boolean} collapsed - true to collapse tree, false to expand it
 *
 * @alias Autodesk.Viewing.UI.Tree#setAllCollapsed
 */
Tree.prototype.setAllCollapsed = function (collapsed) {
    var wantNode, changeNode;

    if (collapsed) {
        wantNode = function (node) {
            return node.classList.contains('expanded');
        };
        changeNode = function (node) {
            node.classList.add('collapsed');
            node.classList.remove('expanded');
        };

    } else {
        wantNode = function (node) {
            return node.classList.contains('collapsed');
        };
        changeNode = function (node) {
            node.classList.add('expanded');
            node.classList.remove('collapsed');
        };
    }

    for (var i = 0; i < this.myGroupNodes.length; ++i) {
        var node = this.myGroupNodes[i];
        if (wantNode(node)) {
            changeNode(node);
        }
    }
};

/**
 * Add the given nodes to the current selection
 *
 * @param {Array.<object>} nodes - nodes to add to the current selection
 *
 * @alias Autodesk.Viewing.UI.Tree#addToSelection
 */
Tree.prototype.addToSelection = function (nodes) {
    var tree = this;

    /**
     * @param node
     * @private
     */
    function addSingle(node) {
        var index = tree.mySelectedNodes.indexOf(node);
        if (index === -1) {
            tree.mySelectedNodes.push(node);
            return true;
        }
        return false;
    }

    var numNodes = nodes.length;
    for (var i = 0; i < numNodes; ++i) {
        var node = nodes[i];
        if (addSingle(node)) {
            this.addClass(node, this.selectedClassName);
        }
    }
};

/**
 * Remove the given nodes from the current selection
 *
 * @param {Array.<object>} nodes - The nodes to remove from the current selection
 *
 * @alias Autodesk.Viewing.UI.Tree#removeFromSelection
 */
Tree.prototype.removeFromSelection = function (nodes) {
    var tree = this;

    /**
     * @param node
     * @private
     */
    function removeSingle(node) {
        var index = tree.mySelectedNodes.indexOf(node);
        if (index !== -1) {
            tree.mySelectedNodes.splice(index, 1);
            return true;
        }
        return false;
    }

    for (var i = nodes.length - 1; i >= 0; --i) {
        var node = nodes[i];
        if (removeSingle(node)) {
            this.removeClass(node, this.selectedClassName);
        }
    }
};

/**
 * Set the current selection
 *
 * @param {Array.<object>} nodes - nodes to make currently selected
 *
 * @alias Autodesk.Viewing.UI.Tree#setSelection
 */
Tree.prototype.setSelection = function (nodes) {
    this.removeFromSelection(this.mySelectedNodes);
    this.addToSelection(nodes);
    return this.mySelectedNodes;
};

/**
 * Get the current selection
 *
 * @returns {Array.<object>} selected nodes.
 *
 * @alias Autodesk.Viewing.UI.Tree#getSelection
 */
Tree.prototype.getSelection = function () {
    return this.mySelectedNodes.concat(); // shallow copy
};

/**
 * Clear the current selection
 *
 * @alias Autodesk.Viewing.UI.Tree#clearSelection
 */
Tree.prototype.clearSelection = function () {
    this.removeFromSelection(this.mySelectedNodes);
};

/**
 * Is the given node selected?
 *
 * @nosideeffects
 * @param {object} node - The tree node
 * @returns {boolean} - true if node is selected, false otherwise
 *
 * @alias Autodesk.Viewing.UI.Tree#isSelected
 */
Tree.prototype.isSelected = function (node) {
    return this.hasClass(node, this.selectedClassName);
};

/**
 * Scrolls the container to reveal the node's DOM element.
 *
 * @param {object} node - the Tree node
 *
 * @alias Autodesk.Viewing.UI.Tree#scrollTo
 */
Tree.prototype.scrollTo = function (node) {
    var elem = this.getElementForNode(node);

    if (elem) {
        var total = elem.offsetTop;
        elem = elem.parentNode;
        while (elem && elem != this.myRootContainer) {
            total += elem.offsetTop;
            elem = elem.parentNode;
        }

        var scrollContainer = this.myRootContainer.parentNode;
        if (this.myDelegate.getScrollContainer()) {
            // The scroll container may be above the root container.
            // For such cases, we need to rely on the delegate to tell us 
            // which div to scroll.
            scrollContainer = this.myDelegate.getScrollContainer();
        }
        scrollContainer.scrollTop = total;
    }
};


/**
 * Add a CSS class to a node
 *
 * @param {number | object} node - The tree node
 * @param {string} className
 * @param recursive
 * @returns {boolean} - true if the class was added, false otherwise
 * @alias Autodesk.Viewing.UI.Tree#addClass
 */
Tree.prototype.addClass = function (node, className, recursive) {

    var elem = this.getElementForNode(node);
    if (elem) {

        if (recursive) {
            //It is intentional that the recursive add starts at the parent.
            elem = elem.parentNode;
            var top = this.myOptions.excludeRoot ? this.rootElem : this.myRootContainer;
            while (elem && elem !== top) {
                elem.classList.add(className);
                elem = elem.parentNode;
            }
        } else {
            elem.classList.add(className);
        }

        return true;
    }

    return false;
};

/**
 * Remove a class from a node
 *
 * @param {number | object} node - The tree node or its dbId
 * @param {string} className - Class name
 * @param {boolean} recursive - Set to true to make it recursive
 * @returns {boolean} - true if the class was removed, false otherwise
 * @alias Autodesk.Viewing.UI.Tree#removeClass
 */
Tree.prototype.removeClass = function (node, className, recursive) {
    var elem = this.getElementForNode(node);
    if (elem) {

        if (recursive) {
            //It is intentional that the recursive add starts at the parent.
            elem = elem.parentNode;
            var top = this.myOptions.excludeRoot ? this.rootElem : this.myRootContainer;
            while (elem && elem !== top) {
                elem.classList.remove(className);
                elem = elem.parentNode;
            }
        } else {
            elem.classList.remove(className);
        }

        return true;
    }

    return false;
};

/**
 * Does the node have the given class?
 *
 * @nosideeffects
 * @param {number | object} node - The node or its dbId
 * @param {string} className
 * @returns {boolean} true if the node has the given class, false otherwise
 *
 * @alias Autodesk.Viewing.UI.Tree#hasClass
 */
Tree.prototype.hasClass = function (node, className) {
    return this.getElementForNode(node).classList.contains(className);
};


/**
 * Clears the contents of the tree
 *
 * @alias Autodesk.Viewing.UI.Tree#clear
 */
Tree.prototype.clear = function () {

    var rootContainer = this.myRootContainer;
    while (rootContainer.hasChildNodes()) {
        rootContainer.removeChild(rootContainer.lastChild);
    }

    this.nodeToElement = {};
    this.nodeIdToNode = {};
};

/**
 * Given a node, create the corresponding HTML elements for the node and all of its descendants
 *
 * @private
 * @param {object} node - Node in the model Document
 * @param {HTMLElement} parentElement
 * @param {object=} [options] - An optional dictionary of options.  Current parameters:
 *                              {boolean} [localize] - when true, localization is attempted for the given node; false by default.
 * @param {number} [depth]
 *
 * @private
 */
Tree.prototype.createElement_ = function (node, parentElement, options, depth) {
    if (node === undefined || node === null) {
        return null;
    }

    if (!this.myDelegate.shouldCreateTreeNode(node)) {
        return null;
    }

    var tree = this;
    var elem;

    /**
     * @param parentElement
     * @param type
     * @param classes
     * @param theNode
     * @private
     */
    function createElementForNode(parentElement, type, classes, theNode) {
        var root = tree.createHtmlElement_(parentElement, type, classes);
        var nodeId = tree.myDelegate.getTreeNodeId(theNode);
        root.setAttribute("lmv-nodeId", nodeId);

        var header = tree.createHtmlElement_(root, 'lmvheader');
        var icon = tree.createHtmlElement_(header, 'icon');

        icon.addEventListener('mousedown', function (e) {
            e.stopPropagation();
            e.preventDefault();
        }, false);

        icon.addEventListener('click', function (e) {
            tree.myDelegate.onTreeNodeIconClick(tree, node, e);
            e.stopPropagation();
            e.preventDefault();
        }, false);

        tree.myDelegate.createTreeNode(node, header, options, type, depth);
        return root;
    }

    var nodeId = this.myDelegate.getTreeNodeId(node);
    var whichDepth = tree.myOptions.excludeRoot ? 1 : 0;

    if (tree.myDelegate.isTreeNodeGroup(node)) {
        elem = createElementForNode(parentElement, 'group', tree.groupClassName, node);
        tree.nodeToElement[nodeId] = elem;
        tree.nodeIdToNode[nodeId] = node;

        if (depth == whichDepth)
            elem.style.left = "0px";

        // Remember this group node for use by setAllCollapsed().
        //
        tree.myGroupNodes.push(elem);

        tree.myDelegate.forEachChild(node, function(child) {
            tree.createElement_(child, elem, options, depth+1);
        });

    } else {
        elem = createElementForNode(parentElement, 'leaf', tree.leafClassName, node);
        tree.nodeToElement[nodeId] = elem;
        tree.nodeIdToNode[nodeId] = node;

        if (depth == whichDepth)
            elem.style.marginLeft = "0px";
    }

    var c = tree.myDelegate.getTreeNodeClass(node);
    if (c) {
        elem.classList.add(c);
    }

    return elem;
};

/**
 * @private
 */
Tree.prototype.setInputHandlers_ = function() {

    var tree = this;
    var rootElem = this.myRootContainer;

    var NODE_NOT_FOUND = null;
    var getNodeFromElement = function(eventTarget) {
        var ret = null;
        var found = false;
        do {
            if (!eventTarget || eventTarget === rootElem) {
                ret = null;
                found = true;  // not found
            } else if (eventTarget.hasAttribute("lmv-nodeId")) {
                ret = eventTarget;
                found = true;
            } else {
                eventTarget = eventTarget.parentElement;
            }
        } while(!found);

        if (ret) {
            var nodeId = ret.getAttribute("lmv-nodeId");
            return tree.nodeIdToNode[nodeId] || NODE_NOT_FOUND;
        }
        return NODE_NOT_FOUND;
    };

    if (isTouchDevice()) {
        this.hammer = new Hammer.Manager(rootElem, {
            recognizers: [
                GestureRecognizers.doubletap,
                GestureRecognizers.press
            ],
            handlePointerEventMouse: false,
            inputClass: isIE11 ? Hammer.PointerEventInput : Hammer.TouchInput
        });
        this.hammer.on("doubletap", function (event) {
            var node = getNodeFromElement(event.target);
            if (node === NODE_NOT_FOUND) return;
            tree.myDelegate.onTreeNodeDoubleClick(tree, node, event);
        });

        this.hammer.on('press', function (event) {
            var node = getNodeFromElement(event.target);
            if (node === NODE_NOT_FOUND) return;
            tree.myDelegate.onTreeNodeRightClick(tree, node, event);
        });
    }

    rootElem.addEventListener('click', function (event) {
        var node = getNodeFromElement(event.target);
        if (node === NODE_NOT_FOUND) return;
        tree.myDelegate.onTreeNodeClick(tree, node, event);
        event.stopPropagation();
        if(!event.target.classList.contains('propertyLink')) {
          event.preventDefault();
        }
    }, false);

    rootElem.addEventListener('dblclick', function (event) {
        var node = getNodeFromElement(event.target);
        if (node === NODE_NOT_FOUND) return;
        tree.myDelegate.onTreeNodeDoubleClick(tree, node, event);
        event.stopPropagation();
        event.preventDefault();
    }, false);

    rootElem.addEventListener('contextmenu', function (event) {
        var node = getNodeFromElement(event.target);
        if (node === NODE_NOT_FOUND) return;
        tree.myDelegate.onTreeNodeRightClick(tree, node, event);
        event.stopPropagation();
        event.preventDefault();
    }, false);

    rootElem.addEventListener('mouseover', function (event) {
        var node = getNodeFromElement(event.target);
        if (node === NODE_NOT_FOUND) return;
        tree.myDelegate.onTreeNodeHover(tree, node, event);
        event.stopPropagation();
        event.preventDefault();
    }, false);

    rootElem.addEventListener('mouseout', function (event) {
        // When the mouse leaves the element, set node to -1 (background), no highlight,
        // If the mouse out event is within the same element. don't do anything.
        var e = event.toElement || event.relatedTarget;
        if (getNodeFromElement(event.target) != getNodeFromElement(e)) {
            var node = -1;
            tree.myDelegate.onTreeNodeHover(tree, node, event);
            event.stopPropagation();
            event.preventDefault();
        }
    }, false);
};

/**
 * Create an HTML element
 *
 * @private
 * @param {HTMLElement} parent - Parent element of the new HTML element
 * @param {string} tagName - New HTML element tag name
 * @param {string=} [className] - New HTML element class
 * @returns {HTMLElement} The newly-created HTML element
 */
Tree.prototype.createHtmlElement_ = function (parent, tagName, className) {
    var _document = this.getDocument();
    var elem = _document.createElement(tagName);
    parent.appendChild(elem);

    if (className) {
        elem.className = className;
    }

    return elem;
};

/**
 * Iterates through nodes in the tree in pre-order.
 *
 * @param {object | number} node - node at which to start the iteration.
 * @param {Function} callback - invoked for each iterated node with (Object, HTMLElement)
 *
 * @alias Autodesk.Viewing.UI.Tree#iterate
 */
Tree.prototype.iterate = function (node, callback) {
    // roodId === 0 is a valid root node
    if (node === undefined || node === null) {
        return;
    }
    if (this.myDelegate.shouldCreateTreeNode(node)) {
        var elem = this.getElementForNode(node);
        if (elem) {
            callback(node, elem);

            var scope = this;
            this.myDelegate.forEachChild(node, function(child) {
                scope.iterate(child, callback);
            });
        }
    }
};
