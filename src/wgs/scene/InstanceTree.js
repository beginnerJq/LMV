import { SelectionMode } from "./SelectionMode";
import { logger } from "../../logger/Logger";

/* eslint-disable no-unused-vars */

/**
 * @readonly
 * @enum {number}
 * @alias NODE_TYPE
 * @property {number} NODE_TYPE_ASSEMBLY Real world object as assembly of sub-objects
 * @property {number} NODE_TYPE_INSERT Insert of multiple-instanced object
 * @property {number} NODE_TYPE_LAYER A layer (specific abstraction collection)
 * @property {number} NODE_TYPE_COLLECTION An abstract collection of objects (e.g. “Doors”)
 * @property {number} NODE_TYPE_COMPOSITE A real world object whose internal structure is not relevant to end user
 * @property {number} NODE_TYPE_MODEL Root of tree representing an entire Model. An aggregate model can contain multiple nested models.
 * @property {number} NODE_TYPE_GEOMETRY Leaf geometry node
 * @property {number} NODE_TYPE_BITS mask for all bits used by node type
 */
export const NODE_TYPE = {
    NODE_TYPE_ASSEMBLY   : 0x0,
    NODE_TYPE_INSERT     : 0x1,
    NODE_TYPE_LAYER      : 0x2,
    NODE_TYPE_COLLECTION : 0x3,
    NODE_TYPE_COMPOSITE  : 0x4,
    NODE_TYPE_MODEL      : 0x5,
    NODE_TYPE_GEOMETRY   : 0x6,
    NODE_TYPE_BITS       : 0x7
};

var NODE_FLAG_NOSELECT   = 0x20000000,
    NODE_FLAG_OFF        = 0x40000000,
    NODE_FLAG_HIDE       = 0x80000000,

    // Flags defined and used in LMV
    NODE_FLAG_LOCK_VISIBLE = 0x00001000,
    NODE_FLAG_LOCK_EXPLODE = 0x00002000,
    NODE_FLAG_LOCK_SELECT = 0x00004000;

/* eslint-enable no-unused-vars */

/**
 * @param nodeAccess
 * @param objectCount
 * @param maxDepth
 * @class
 * @memberof Autodesk.Viewing.Private
 * @alias Autodesk.Viewing.Private.InstanceTree
 */
export function InstanceTree(nodeAccess, objectCount, maxDepth) {

    this.nodeAccess = nodeAccess;
    this.maxDepth = maxDepth;
    this.objectCount = objectCount;
    this.numHidden = 0;
    this.numOff = 0;

    // when not using precomputed nodeBoxes, fragments are used for on-the-fly bbox computation
    this.fragList = null;
}

InstanceTree.prototype.dtor = function() {
    this.nodeAccess.dtor();
    this.nodeAccess = null;

    this.fragList = null;
};

InstanceTree.prototype.setFlagNode = function(dbId, flag, value) {

    var old = this.nodeAccess.getNodeFlags(dbId);

    // "!!" converts to bool
    if (!!(old & flag) == value)
        return false;

    if (value)
        this.nodeAccess.setNodeFlags(dbId, old | flag);
    else
        this.nodeAccess.setNodeFlags(dbId, old & ~flag);

    return true;
};

InstanceTree.prototype.setFlagGlobal = function(flag, value) {
    var na = this.nodeAccess;

    var i=0, iEnd = na.numNodes;
    if (value) {
        for (; i<iEnd; i++) {
            na.setNodeFlags(i, na.getNodeFlags(i) | flag);
        }
    } else {
        var notflag = ~flag;
        for (; i<iEnd; i++) {
            na.setNodeFlags(i, na.getNodeFlags(i) & notflag);
        }
    }
};

/**
 * When a node is OFF, it is completely skipped for display purposes
 *
 * @param {number} dbId - database id
 * @param {boolean} value - Value to set
 */
InstanceTree.prototype.setNodeOff = function(dbId, value) {
    var res = this.setFlagNode(dbId, NODE_FLAG_OFF, value);
    if (res) {
        if (value)
            this.numOff++;
        else
            this.numOff--;
    }
    return res;
};

InstanceTree.prototype.isNodeOff = function(dbId) {
    return !!(this.nodeAccess.getNodeFlags(dbId) & NODE_FLAG_OFF);
};


/**
 * When a node is HIDDEN it will display in ghosted style
 * if display of hidden objects is on
 *
 * @param {number} dbId - database id
 * @param {boolean} value - Value to set
 */
InstanceTree.prototype.setNodeHidden = function(dbId, value) {
    var res = this.setFlagNode(dbId, NODE_FLAG_HIDE, value);
    if (res) {
        if (value)
            this.numHidden++;
        else
            this.numHidden--;
    }
    return res;
};

/**
 * Whether a node id is hidden.
 *
 * @param {number} dbId - The node's database id
 * @returns {boolean} 
 * @alias Autodesk.Viewing.Private.InstanceTree#isNodeHidden
 */
InstanceTree.prototype.isNodeHidden = function(dbId) {
    return !!(this.nodeAccess.getNodeFlags(dbId) & NODE_FLAG_HIDE);
};

InstanceTree.prototype.lockNodeSelection = function(dbId, value) {
    return this.setFlagNode(dbId, NODE_FLAG_LOCK_SELECT, value);
};

InstanceTree.prototype.isNodeSelectionLocked = function(dbId) {
    return !!(this.nodeAccess.getNodeFlags(dbId) & NODE_FLAG_LOCK_SELECT);
};

/**
 * When a node's visibility is locked it can not be hidden
 *
 * @param {number} dbId - database id
 * @param {boolean} value - Value to set
 */
InstanceTree.prototype.lockNodeVisible = function(dbId, value) {
    return this.setFlagNode(dbId, NODE_FLAG_LOCK_VISIBLE, value);
};

/**
 * Whether a node id's visiblitly is locked.
 *
 * @param {number} dbId - The node's database id
 * @returns {boolean} 
 * @alias Autodesk.Viewing.Private.InstanceTree#isNodeVisibleLocked
 */
InstanceTree.prototype.isNodeVisibleLocked = function(dbId) {
    return !!(this.nodeAccess.getNodeFlags(dbId) & NODE_FLAG_LOCK_VISIBLE);
};

/**
 * Whether a node id's explode is locked.
 *
 * @param {number} dbId - The node's database id
 * @returns {boolean} 
 * @alias Autodesk.Viewing.Private.InstanceTree#isNodeExplodeLocked
 */
InstanceTree.prototype.isNodeExplodeLocked = function(dbId) {
    return !!(this.nodeAccess.getNodeFlags(dbId) & NODE_FLAG_LOCK_EXPLODE);
};

/**
 * When a node's explode is locked it won't explode
 *
 * @param {number} dbId - database id
 * @param {boolean} value - Value to set
 */
InstanceTree.prototype.lockNodeExplode = function(dbId, value) {
    return this.setFlagNode(dbId, NODE_FLAG_LOCK_EXPLODE, value);
};

/**
 * Gets the type associated with the node, such as assmebly, layer, model, geometry, etc.
 * 
 * @param {number} dbId - The node's database id
 * @returns {number} one of {@link NODE_TYPE}
 * @alias Autodesk.Viewing.Private.InstanceTree#getNodeType
 */
InstanceTree.prototype.getNodeType = function(dbId) {
    return this.nodeAccess.getNodeFlags(dbId) & NODE_TYPE.NODE_TYPE_BITS;
};

/**
 * Whether the node is a selectable entity.
 * 
 * @param {number} dbId - The node's database id
 * @returns {boolean} 
 * @alias Autodesk.Viewing.Private.InstanceTree#isNodeSelectable
 */
InstanceTree.prototype.isNodeSelectable = function(dbId) {
    return !(this.nodeAccess.getNodeFlags(dbId) & NODE_FLAG_NOSELECT);
};

/**
 * Gets the database id of the node's parent.
 * 
 * @param {number} dbId - The node's database id
 * @returns {number} 
 * @alias Autodesk.Viewing.Private.InstanceTree#getNodeParentId
 */
InstanceTree.prototype.getNodeParentId = function(dbId) {
    return this.nodeAccess.getParentId(dbId);
};

/**
 * Gets the model's root database id.
 * 
 * @returns {number} 
 * @alias Autodesk.Viewing.Private.InstanceTree#getRootId
 */
InstanceTree.prototype.getRootId = function() {
    return this.nodeAccess.rootId;
};

/**
 * Gets the name associated to the id.
 *
 * @param {number} dbId - The node's database id
 * @param {boolean} includeCount - True if must include count
 * @returns {string}
 * @alias Autodesk.Viewing.Private.InstanceTree#getNodeName
 */
InstanceTree.prototype.getNodeName = function(dbId, includeCount) {
    return this.nodeAccess.name(dbId, includeCount);
};

/**
 * Gets get number of children under the specified id.
 * 
 * @param {number} dbId - The node's database id
 * @returns {number} 
 * @alias Autodesk.Viewing.Private.InstanceTree#getChildCount
 */
InstanceTree.prototype.getChildCount = function(dbId) {
    return this.nodeAccess.getNumChildren(dbId);
};


var _tmpArray = new Array(6);

/**
 * Sets the bounding box values for a particular id on the 2nd argument provided.
 * There is no return value.
 * 
 * @param {number} dbId - The node's database id
 * @param {Float32Array} dst - An array holding 6 number values: (min-x, min-y, min-z, max-x, max-y, max-z)
 * 
 * @alias Autodesk.Viewing.Private.InstanceTree#getNodeBox
 */
InstanceTree.prototype.getNodeBox = function(dbId, dst) {

    // If precomputed boxes are available, just return the box directly.
    if (this.nodeAccess.nodeBoxes) {
        this.nodeAccess.getNodeBox(dbId, dst);
        return;
    }

    // If fragList is available, compute nodeBox recursively from fragBoxes
    if (this.fragList) {
        dst[0] = dst[1] = dst[2] = Infinity;
        dst[3] = dst[4] = dst[5] = -Infinity;
        this.enumNodeFragments(dbId, (fragId) => {
            this.fragList.getOriginalWorldBounds(fragId, _tmpArray);
            dst[0] = Math.min(dst[0], _tmpArray[0]);
            dst[1] = Math.min(dst[1], _tmpArray[1]);
            dst[2] = Math.min(dst[2], _tmpArray[2]);
            dst[3] = Math.max(dst[3], _tmpArray[3]);
            dst[4] = Math.max(dst[4], _tmpArray[4]);
            dst[5] = Math.max(dst[5], _tmpArray[5]);
        }, true);
        return;
    }

    logger.error('getNodeBox() requires fragBoxes or nodeBoxes');
};


InstanceTree.prototype.getNodeIndex = function(dbId) {
    return this.nodeAccess.getIndex(dbId);
};

/**
 * Callback function for {@link Autodesk.Viewing.Private.InstanceTree#enumNodeFragments}
 *
 * @callback Autodesk.Viewing.Private.InstanceTree~onEnumNodeFragments
 * @param {number} fragId - The fragment's id.
 */

/**
 * 
 * @param {number} node - The id of a node.
 * @param {Autodesk.Viewing.Private.InstanceTree~onEnumNodeFragments} callback - Function that will be called for each fragment.
 * @param {boolean} [recursive=false] - Whether the callback function gets called for child nodes, too. 
 * 
 * @alias Autodesk.Viewing.Private.InstanceTree#enumNodeFragments
 */
InstanceTree.prototype.enumNodeFragments = function(node, callback, recursive) {

    //TODO: Temporary until we are consistently using dbId
    var dbId;
    if (typeof node == "number")
        dbId = node;
    else if (node)
        dbId = node.dbId;

    /**
     * @param {string} dbId - Database ID
     */
    const traverse = (dbId) => {
        var res = this.nodeAccess.enumNodeFragments(dbId, callback);

        if (res)
            return res;

        if (recursive) {
            res = this.enumNodeChildren(dbId, (child_dbId) => traverse(child_dbId));

            if (res)
                return res;
        }
    };

    return traverse(dbId);

};

/**
 * Callback function for {@link Autodesk.Viewing.Private.InstanceTree#enumNodeChildren}
 *
 * @callback Autodesk.Viewing.Private.InstanceTree~onEnumNodeChildren
 * @param {number} dbId - A database id
 */

/**
 * 
 * @param {number} node - The id of a node.
 * @param {Autodesk.Viewing.Private.InstanceTree~onEnumNodeChildren} callback - Function that will be called for each child node.
 * @param {boolean} [recursive=false] - Whether the callback function gets called for indirect child nodes, too. 
 * 
 * @alias Autodesk.Viewing.Private.InstanceTree#enumNodeChildren
 */
InstanceTree.prototype.enumNodeChildren = function(node, callback, recursive) {

    //TODO: Temporary until we are consistently using dbId
    var dbId;
    if (typeof node == "number")
        dbId = node;
    else if (node)
        dbId = node.dbId;

    if (recursive) {
        if (callback(dbId))
            return dbId;
    }

    /**
     * @param {string} dbId - Database ID
     */
    const traverse = (dbId) => {
        var res = this.nodeAccess.enumNodeChildren(dbId, (childId) => {
            if (callback(childId))
                return childId;

            if (recursive)
                return traverse(childId);
        });

        if (res)
            return res;
    };

    return traverse(dbId);
};


//Given a leaf node, find the correct parent
//node to select according to the given selection mode
InstanceTree.prototype.findNodeForSelection = function(dbId, selectionMode) {

    //Default legacy mode -- select exactly the node we got asked for.
    if (selectionMode === SelectionMode.LEAF_OBJECT)
        return dbId;

    var res = dbId;
    var node, nt;

    if (selectionMode === SelectionMode.FIRST_OBJECT) {
        //1. Find the leaf node of the selection tree containing it and then follow the chain of parents all the way up to the root to get the complete path from root to leaf node.
        //2. Start at the root and walk down the path until the first node that is not a Model, Layer or Collection. Select it.
        var idpath = [];

        node = dbId;
        while (node) {
            idpath.push(node);
            node = this.getNodeParentId(node);
        }

        for (var i=idpath.length-1; i>=0; i--) {
            nt = this.getNodeType(idpath[i]);
            if ( (nt !== NODE_TYPE.NODE_TYPE_MODEL) &&
                 (nt !== NODE_TYPE.NODE_TYPE_LAYER) &&
                 (nt !== NODE_TYPE.NODE_TYPE_COLLECTION) ) {
                res = idpath[i];
                break;
            }
        }
    }

    else if (selectionMode === SelectionMode.LAST_OBJECT) {
        // Start at the leaf and walk up the path until the first node that is Composite. Select it. If there’s no Composite node in the path select the leaf.

        node = dbId;
        while (node) {
            nt = this.getNodeType(node);
            if (nt === NODE_TYPE.NODE_TYPE_COMPOSITE) {
                res = node;
                break;
            }
            node = this.getNodeParentId(node);
        }

    }

    return res;

};

// When not using precomputed bboxes, the fragment boxes are needed for on-the-fly computation of node boxes.
InstanceTree.prototype.setFragmentList = function(fragList) {
    this.fragList = fragList;
};

