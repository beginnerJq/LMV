
import { utf16to8, utf8BlobToStr } from "../../file-loaders/lmvtk/common/StringUtils";


    export class FlatStringStorage {

        constructor(initial) {
            if (initial) {
                this.buf = initial.buf;
                this.idx = initial.idx;
                this.next = initial.next;
            } else {
                this.buf = new Uint8Array(256);
                this.next = 0;
                this.idx = [0];
            }
        }

        allocate(len) {
            if (this.buf.length - this.next < len) {
                var nsz = Math.max(this.buf.length * 3 / 2, this.buf.length + len);
                var nb = new Uint8Array(nsz);
                nb.set(this.buf);
                this.buf = nb;
            }
        }

        add(s) {
            if (s === null || (typeof s  === "undefined")) {
                return 0;
            }

            if (!s.length) {
                this.idx.push(this.next);
                return this.idx.length - 1;
            }

            var len = utf16to8(s, null);
            this.allocate(len);
            this.next += utf16to8(s, this.buf, this.next);
            this.idx.push(this.next);
            return this.idx.length - 1;
        }

        get(i) {
            if (!i) {
                return undefined;
            }

            var start = this.idx[i-1];
            var end = this.idx[i];
            if (start === end)
                return "";
            return utf8BlobToStr(this.buf, start, end - start);
        }

        flatten() {
            this.idx = arrayToBuffer(this.idx);
            //TODO: we could also clip this.buf to the actually used size, but that requires reallocation
        }
    }



    //
    // struct Node {
    //     int dbId;
    //     int parentDbId;
    //     int firstChild; //if negative it's a fragment list
    //     int numChildren;
    //     int flags;   
    // };
    // sizeof(Node) == 20
    var SIZEOF_NODE = 5, //integers
        OFFSET_DBID = 0,
        OFFSET_PARENT = 1,
        OFFSET_FIRST_CHILD = 2,
        OFFSET_NUM_CHILD = 3,
        OFFSET_FLAGS = 4;

    export function InstanceTreeStorage() {

        this.nodes = [];
        this.nextNode = 0;
        
        this.children = [];
        this.nextChild = 0;

        this.dbIdToIndex = {};

        this.names = [];
        this.s2i = {}; //duplicate string pool
        this.strings = new FlatStringStorage();
        this.nameSuffixes = []; //integers

        //Occupy index zero so that we can use index 0 as undefined
        this.getIndex(0);
    }

    InstanceTreeStorage.prototype.getIndex = function(dbId) {

        var index = this.dbIdToIndex[dbId];

        if (index)
            return index;

        index = this.nextNode++;

        //Allocate space for new node
        this.nodes.push(dbId); //store the dbId as first integer in the Node structure
        //Add four blank integers to be filled by setNode
        for (var i=1; i<SIZEOF_NODE; i++)
            this.nodes.push(0);

        this.dbIdToIndex[dbId] = index;

        return index;
    };

    InstanceTreeStorage.prototype.setNode = function(dbId, parentDbId, name, flags, childrenIds, fragIds) {

        var index = this.getIndex(dbId);

        var baseOffset = index * SIZEOF_NODE;

        var numChildren = childrenIds.length;
        var hasFragments = fragIds && fragIds.length;
        if (hasFragments) {
            numChildren += fragIds.length;
        }

        this.nodes[baseOffset+OFFSET_PARENT] = parentDbId;
        this.nodes[baseOffset+OFFSET_FIRST_CHILD] = this.nextChild;
        this.nodes[baseOffset+OFFSET_NUM_CHILD] = hasFragments ? -numChildren : numChildren;
        this.nodes[baseOffset+OFFSET_FLAGS] = flags;

        var i;
        for (i=0; i<childrenIds.length; i++)
            this.children[this.nextChild++] = this.getIndex(childrenIds[i]);

        //Store fragIds as negative numbers so we can differentiate them when looking through
        //the array later.
        if (hasFragments) {
            for (i=0; i<fragIds.length; i++)
                this.children[this.nextChild++] = -fragIds[i]-1; //index 0 stored as -1, etc., since 0 is not negative
        }

        if (this.nextChild > this.children.length) {
            // TODO: this code may run in a worker, replace console with something else
            console.error("Child index out of bounds -- should not happen");
        }
    
        this.processName(index, name);
    };

    InstanceTreeStorage.prototype.processName = function(index, name) {

        //Attempt to decompose the name into a base string + integer,
        //like for example "Base Wall [12345678]" or "Crank Shaft:1"
        //We will try to reduce memory usage by storing "Base Wall" just once.
        var base;
        var suffix;

        //Try Revit style [1234] first
        var iStart = -1;
        var iEnd = -1;

        if (name) { //name should not be empty, but hey, it happens.
            iEnd = name.lastIndexOf("]");
            iStart = name.lastIndexOf("[");

            //Try Inventor style :1234
            if (iStart === -1 || iEnd === -1) {
                iStart = name.lastIndexOf(":");
                iEnd = name.length;
            }       
        }

        //TODO: Any other separators? What does AutoCAD use?

        if (iStart >= 0 && iEnd > iStart) {
            base = name.slice(0, iStart+1);
            var ssuffix = name.slice(iStart+1, iEnd);
            suffix = parseInt(ssuffix, 10);
            
            //make sure we get the same thing back when
            //converting back to string, otherwise don't 
            //decompose it.
            if (!suffix || suffix+"" !== ssuffix) {
                base = name;
                suffix = 0;
            }
        } else {
            base = name;
            suffix = 0;
        }


        var idx = this.s2i[base];
        if (idx === undefined) {
            idx = this.strings.add(base);
            this.s2i[base] = idx;
        }

        this.names[index] = idx;
        this.nameSuffixes[index] = suffix;
    };


    function arrayToBuffer(a) {
        var b = new Int32Array(a.length);
        b.set(a);
        return b;
    }

    InstanceTreeStorage.prototype.flatten = function() {
        this.nodes = arrayToBuffer(this.nodes);
        this.children = arrayToBuffer(this.children);
        this.names = arrayToBuffer(this.names);
        this.nameSuffixes = arrayToBuffer(this.nameSuffixes);
        this.strings.flatten();
        this.s2i = null; //we don't need this temporary map once we've built the strings list
    };



    export function InstanceTreeAccess(nodeArray, rootId, nodeBoxes) {
        this.nodes = nodeArray.nodes;
        this.children = nodeArray.children;
        this.dbIdToIndex = nodeArray.dbIdToIndex;
        this.names = nodeArray.names;
        this.nameSuffixes = nodeArray.nameSuffixes;
        this.strings = new FlatStringStorage(nodeArray.strings);
        this.rootId = rootId;
        this.numNodes = this.nodes.length / SIZEOF_NODE;
        this.visibleIds = null;

        // only used if bboxes are precomputed
        this.nodeBoxes = nodeBoxes;
    }

    InstanceTreeAccess.prototype.dtor = function() {
        this.nodes = null;
        this.children = null;
        this.dbIdToIndex = null;
        this.names = null;
        this.nameSuffixes = null;
        this.strings = null;
        this.visibleIds = null;
        this.nodeBoxes = null;
    }

    InstanceTreeAccess.prototype.getNumNodes = function() {
        return this.numNodes;
    };

    InstanceTreeAccess.prototype.getIndex = function(dbId) {
        return this.dbIdToIndex[dbId];
    };

    InstanceTreeAccess.prototype.name = function(dbId, includeCount) {
        var idx = this.dbIdToIndex[dbId];
        var base = this.strings.get(this.names[idx]);
        var suffix = this.nameSuffixes[idx];
        var name;
        if (suffix) {
            //NOTE: update this logic if more separators are supported in processName above
            var lastChar = base.charAt(base.length-1);
            if (lastChar === "[")
                name = base + suffix + "]";
            else
                name = base + suffix;
        } else {
            name = base;
        }

        if (includeCount) {
            if (!this.childCounts) {
                this.computeChildCounts();
            }
            if (this.childCounts[dbId] > 0) {
                name += " (" + this.childCounts[dbId] + ")";
            }
        }

        return name;
    };

    InstanceTreeAccess.prototype.getParentId = function(dbId) {
        var idx = this.dbIdToIndex[dbId];
        return this.nodes[idx * SIZEOF_NODE + OFFSET_PARENT];
    };

    InstanceTreeAccess.prototype.getNodeFlags = function(dbId) {
        var idx = this.dbIdToIndex[dbId];
        return this.nodes[idx * SIZEOF_NODE + OFFSET_FLAGS];
    };

    InstanceTreeAccess.prototype.setNodeFlags = function(dbId, flags) {
        var idx = this.dbIdToIndex[dbId];
        if (idx) {
            this.nodes[idx * SIZEOF_NODE + OFFSET_FLAGS] = flags;
        }
    };

    InstanceTreeAccess.prototype.getNumChildren = function(dbId) {

        var idx = this.dbIdToIndex[dbId];
        var numChildren = this.nodes[idx * SIZEOF_NODE + OFFSET_NUM_CHILD];

        //If numChildren is non-negative, then all children are nodes (not fragments)
        if (numChildren >= 0)
            return numChildren;

        //Node has mixed fragments and child nodes, so we have to loop and collect just the node children
        var firstChild = this.nodes[idx * SIZEOF_NODE + OFFSET_FIRST_CHILD];

        numChildren = Math.abs(numChildren);

        var numNodeChildren = 0;

        for (var i=0; i<numChildren; i++) {
            var childIdx = this.children[firstChild+i];

            //did we reach the fragment ids sub-list?
            if (childIdx < 0)
                break;

            numNodeChildren++;
        }

        return numNodeChildren;
    };

    InstanceTreeAccess.prototype.getNumFragments = function(dbId) {
        var idx = this.dbIdToIndex[dbId];

        var numChildren = this.nodes[idx * SIZEOF_NODE + OFFSET_NUM_CHILD];

        //If numChildren is non-negative, there aren't any fragments belonging to this node
        if (numChildren >= 0)
            return 0;

        //Node has mixed fragments and child nodes, so we have to loop and collect just the node children
        var firstChild = this.nodes[idx * SIZEOF_NODE + OFFSET_FIRST_CHILD];

        numChildren = Math.abs(numChildren);

        var numFragChildren = 0;

        //Iterate backwards, because fragment children are at the back of the children list
        for (var i=numChildren-1; i>=0; i--) {
            var childIdx = this.children[firstChild+i];

            //did we reach the inner node children ids sub-list?
            if (childIdx >= 0)
                break;

            numFragChildren++;
        }

        return numFragChildren;
    };

    // NOTE: This can only be used if precomputed bboxes are available.
    InstanceTreeAccess.prototype.getNodeBox = function(dbId, dst) {
        var idx = this.getIndex(dbId);
        var off = idx * 6;
        for (var i=0; i<6; i++)
            dst[i] = this.nodeBoxes[off+i];
    };

    //Returns an array containing the dbIds of all objects
    //that are physically represented in the scene. Not all
    //objects in the property database occur physically in each graphics viewable.
    InstanceTreeAccess.prototype.getVisibleIds = function() {
        if (!this.visibleIds) {
            this.visibleIds = Object.keys(this.dbIdToIndex).map(function(k) { return parseInt(k); });
        }

        return this.visibleIds;
    };


    InstanceTreeAccess.prototype.enumNodeChildren = function(dbId, callback) {
        var idx = this.dbIdToIndex[dbId];
        var firstChild = this.nodes[idx * SIZEOF_NODE + OFFSET_FIRST_CHILD];
        var numChildren = this.nodes[idx * SIZEOF_NODE + OFFSET_NUM_CHILD];

        numChildren = Math.abs(numChildren);

        for (var i=0; i<numChildren; i++) {
            var childIdx = this.children[firstChild+i];

            //did we reach the fragment ids sub-list?
            if (childIdx < 0)
                break;

            var childDbId = this.nodes[childIdx * SIZEOF_NODE + OFFSET_DBID];
            if (callback(childDbId, dbId, idx)) {
                return dbId;
            }
        }
    };

    InstanceTreeAccess.prototype.enumNodeFragments = function(dbId, callback) {
        var idx = this.dbIdToIndex[dbId];
        var firstChild = this.nodes[idx * SIZEOF_NODE + OFFSET_FIRST_CHILD];
        var numChildren = this.nodes[idx * SIZEOF_NODE + OFFSET_NUM_CHILD];

        //If numChildren is negative, it means there are fragments in the node
        if (numChildren < 0) {
            numChildren = -numChildren;
            for (var i=0; i<numChildren; i++) {
                var childIdx = this.children[firstChild+i];

                //skip past children that are inner nodes (not fragments)
                if (childIdx > 0)
                    continue;

                //Convert fragId from -1 based negative back to the actual fragId
                if (callback(-childIdx-1, dbId, idx)) {
                    return dbId;
                }
            }
        }
    };

    InstanceTreeAccess.prototype.computeBoxes = function(fragBoxes) {

        if (!this.nodeBoxes) {
            this.nodeBoxes = new Float32Array(6 * this.numNodes);
        }

        var nodeAccess = this;
        var idx = nodeAccess.getIndex(nodeAccess.rootId);
        var nodeBoxes = nodeAccess.nodeBoxes;

        function traverseChildren(child_dbId, parentDbID, parentIdx) {

            var childIdx = nodeAccess.getIndex(child_dbId);

            //Recurse, then add all child boxes to make this node's box
            computeTreeBBoxesRec(child_dbId, childIdx);

            var box_offset = parentIdx * 6;
            var child_box_offset = childIdx * 6;
            for (var k=0; k<3; k++) {
                if (nodeBoxes[box_offset+k] > nodeBoxes[child_box_offset+k])
                    nodeBoxes[box_offset+k] = nodeBoxes[child_box_offset+k];
                if (nodeBoxes[box_offset+k+3] < nodeBoxes[child_box_offset+k+3])
                    nodeBoxes[box_offset+k+3] = nodeBoxes[child_box_offset+k+3];
            }
        }

        function traverseFragments(fragId, dbId, idx){
            var frag_box_offset = fragId * 6;
            var box_offset = idx * 6;

            for (var k=0; k<3; k++) {
                if (nodeBoxes[box_offset+k] > fragBoxes[frag_box_offset+k])
                    nodeBoxes[box_offset+k] = fragBoxes[frag_box_offset+k];
                if (nodeBoxes[box_offset+k+3] < fragBoxes[frag_box_offset+k+3])
                    nodeBoxes[box_offset+k+3] = fragBoxes[frag_box_offset+k+3];
            }
        }

        function computeTreeBBoxesRec(dbId, idx) {

            var box_offset = idx * 6;
            nodeBoxes[box_offset]   = nodeBoxes[box_offset+1] = nodeBoxes[box_offset+2] =  Infinity;
            nodeBoxes[box_offset+3] = nodeBoxes[box_offset+4] = nodeBoxes[box_offset+5] = -Infinity;

            if (nodeAccess.getNumChildren(dbId)) {
                nodeAccess.enumNodeChildren(dbId, traverseChildren, true);
            }

            //Leaf node -- don't think it's possible for a node to have
            //both children and leaf fragments, but we do handle that here.
            if (nodeAccess.getNumFragments(dbId)) {
                nodeAccess.enumNodeFragments(dbId, traverseFragments);
            }

        }

        computeTreeBBoxesRec(nodeAccess.rootId, idx);
    };

    InstanceTreeAccess.prototype.computeChildCounts = function() {
        if (!this.childCounts) {
            this.childCounts = new Uint32Array(this.numNodes);
        }

        var nodeAccess = this;
        var idx = nodeAccess.getIndex(nodeAccess.rootId);
        var childCounts = nodeAccess.childCounts;

        function traverseChildren(child_dbId, parentDbID, parentIdx) {

            var childIdx = nodeAccess.getIndex(child_dbId);

            //Recurse, then add all child boxes to make this node's box
            let count = computeChildCountsRec(child_dbId, childIdx);

            childCounts[parentDbID] += count;
        }


        function computeChildCountsRec(dbId, idx) {

            let flags = nodeAccess.getNodeFlags(dbId);
            let myCount = 0;

            if (flags === 0x4/*NODE_TYPE_COMPOSITE*/) {
                //If it's a composite node, treat it as a single
                //opaque object whose contents don't matter to the user
                //for counting purposes.
                myCount = 1;
            } else {

                if (nodeAccess.getNumChildren(dbId)) {
                    nodeAccess.enumNodeChildren(dbId, traverseChildren, true);
                }

                //Leaf node
                if (nodeAccess.getNumFragments(dbId)) {
                    myCount = 1;
                }
            }

            return myCount + childCounts[dbId];
        }

        computeChildCountsRec(nodeAccess.rootId, idx);
    };