/**
 * BVH definitions:
 *
 * BVH Node: if this was C (the only real programming language), it would go something like this,
 * but with better alignment.
 *
 * This is definition for "fat" nodes (for rasterization),
 * i.e. when inner nodes also contain primitives.
 * struct Node {                                                            byte/short/int offset
 *      float worldBox[6]; //world box of the node node                         0/0/0
 *      int leftChildIndex; //pointer to left child node (right is left+1)     24/12/6
 *      ushort primCount; //how many fragments are at this node                28/14/7
 *      ushort flags; //bitfield of good stuff                                 30/15/7.5
 *
 *      int primStart; //start of node's own primitives (fragments) list       32/16/8
 * };
 * => sizeof(Node) = 36 bytes

 * Definition for lean nodes (for ray casting): when a node is either inner node (just children, no primitives)
 * or leaf (just primitives, no children).
 * struct Node {
 *      float worldBox[6]; //world box of the node
 *      union {
 *          int leftChildIndex; //pointer to left child node (right is left+1)
 *          int primStart; //start of node's own primitives (fragments) list
 *      };
 *      ushort primCount; //how many fragments are at this node
 *      ushort flags; //bitfield of good stuff
 * };
 * => sizeof(Node) = 32 bytes
 *
 * The class below encapsulates an array of such nodes using ArrayBuffer as backing store.
 *
 * @param {ArrayBuffer|number} initialData  Initial content of the NodeArray, or initial allocation of empty nodes
 * @param {boolean} useLeanNode Use minimal node structure size. Currently this parameter must be set to false.
 * @constructor
 */
export function NodeArray(initialData, useLeanNode) {
    'use strict';

    if (useLeanNode) {
        this.bytes_per_node = 32;
    } else {
        this.bytes_per_node = 36;
    }

    var initialCount;
    var initialBuffer;

    if (initialData instanceof ArrayBuffer) {
        initialCount = initialData.byteLength / this.bytes_per_node;
        initialBuffer = initialData;
        this.nodeCount = initialCount;
    }
    else {
        initialCount = initialData | 0;
        initialBuffer =  new ArrayBuffer(this.bytes_per_node * initialCount);
        this.nodeCount = 0;
    }

    this.nodeCapacity = initialCount;
    this.nodesRaw = initialBuffer;

    this.is_lean_node = useLeanNode;
    this.node_stride = this.bytes_per_node  / 4;
    this.node_stride_short = this.bytes_per_node / 2;

    //Allocate memory buffer for all tree nodes
    this.nodesF = new Float32Array(this.nodesRaw);
    this.nodesI = new Int32Array(this.nodesRaw);
    this.nodesS = new Uint16Array(this.nodesRaw);
}

NodeArray.prototype.setLeftChild = function(nodeidx, childidx) {
    this.nodesI[nodeidx * this.node_stride + 6] = childidx;
};
NodeArray.prototype.getLeftChild = function(nodeidx) {
    return this.nodesI[nodeidx * this.node_stride + 6];
};

NodeArray.prototype.setPrimStart = function(nodeidx, start) {
    if (this.is_lean_node)
        this.nodesI[nodeidx * this.node_stride + 6] = start;
    else
        this.nodesI[nodeidx * this.node_stride + 8] = start;
};
NodeArray.prototype.getPrimStart = function(nodeidx) {
    if (this.is_lean_node)
        return this.nodesI[nodeidx * this.node_stride + 6];
    else
        return this.nodesI[nodeidx * this.node_stride + 8];
};

NodeArray.prototype.setPrimCount = function(nodeidx, count) {
    this.nodesS[nodeidx * this.node_stride_short + 14] = count;
};
NodeArray.prototype.getPrimCount = function(nodeidx) {
    return this.nodesS[nodeidx * this.node_stride_short + 14];
};

NodeArray.prototype.setFlags = function(nodeidx, axis, isFirst, isTransparent) {
    this.nodesS[nodeidx * this.node_stride_short + 15] = (isTransparent << 3) | (isFirst << 2) | (axis & 0x3);
};
NodeArray.prototype.getFlags = function(nodeidx) {
    return this.nodesS[nodeidx * this.node_stride_short + 15];
};

NodeArray.prototype.setBox0 = function(nodeidx, src) {
    var off = nodeidx * this.node_stride;
    var dst = this.nodesF;
    dst[off] = src[0];
    dst[off+1] = src[1];
    dst[off+2] = src[2];
    dst[off+3] = src[3];
    dst[off+4] = src[4];
    dst[off+5] = src[5];
};
NodeArray.prototype.getBoxThree = function(nodeidx, dst) {
    var off = nodeidx * this.node_stride;
    var src = this.nodesF;
    dst.min.x = src[off];
    dst.min.y = src[off+1];
    dst.min.z = src[off+2];
    dst.max.x = src[off+3];
    dst.max.y = src[off+4];
    dst.max.z = src[off+5];
};
NodeArray.prototype.getBoxArray = function(nodeidx, dst, offset) {
    var off = nodeidx * this.node_stride;
    var src = this.nodesF;
    offset = offset || 0;
    dst[0+offset] = src[off];
    dst[1+offset] = src[off+1];
    dst[2+offset] = src[off+2];
    dst[3+offset] = src[off+3];
    dst[4+offset] = src[off+4];
    dst[5+offset] = src[off+5];
};
NodeArray.prototype.setBoxThree = function(nodeidx, src) {
    var off = nodeidx * this.node_stride;
    var dst = this.nodesF;
    dst[off] = src.min.x;
    dst[off+1] = src.min.y;
    dst[off+2] = src.min.z;
    dst[off+3] = src.max.x;
    dst[off+4] = src.max.y;
    dst[off+5] = src.max.z;
};




NodeArray.prototype.makeEmpty = function(nodeidx) {

    var off = nodeidx * this.node_stride;
    var dst = this.nodesI;

    //No point to makeEmpty here, because the box gets set
    //directly when the node is initialized in bvh_subdivide.
    //box_make_empty(this.nodesF, off);

    //_this.setLeftChild(nodeidx,-1);
    dst[off + 6] = -1;

    //both prim count and flags to 0
    dst[off + 7] = 0;

    //_this.setPrimStart(nodeidx, -1);
    if (!this.is_lean_node)
        dst[off + 8] = -1;

};

NodeArray.prototype.realloc = function(extraSize) {
    if (this.nodeCount + extraSize > this.nodeCapacity) {
        var nsz = 0 | (this.nodeCapacity * 3 / 2);
        if (nsz < this.nodeCount + extraSize)
            nsz = this.nodeCount + extraSize;

        var nnodes = new ArrayBuffer(nsz * this.bytes_per_node);
        var nnodesI = new Int32Array(nnodes);
        nnodesI.set(this.nodesI);

        this.nodeCapacity = nsz;
        this.nodesRaw = nnodes;
        this.nodesF = new Float32Array(nnodes);
        this.nodesI = nnodesI;
        this.nodesS = new Uint16Array(nnodes);
    }
};

NodeArray.prototype.nextNodes = function(howMany) {

    this.realloc(howMany);

    var res = this.nodeCount;
    this.nodeCount += howMany;

    for (var i=0; i<howMany; i++) {
        this.makeEmpty(res+i);
    }

    return res;
};

NodeArray.prototype.getRawData = function() {
    return this.nodesRaw.slice(0, this.nodeCount * this.bytes_per_node);
};

var POINT_STRIDE = 3;
var BOX_EPSILON = 1e-5;
var BOX_SCALE_EPSILON = 1e-5;
var MAX_DEPTH = 15; /* max tree depth */
var MAX_BINS = 16;

/**
* Bounding Volume Hierarchy build algorithm.
* Uses top down binning -- see "On fast Construction of SAH-based Bounding Volume Hierarchies" by I.Wald
* Ported from the C version here: https://git.autodesk.com/stanevt/t-ray/blob/master/render3d/t-ray/t-core/t-bvh.c
* Optimized for JavaScript.
*/
var BVHModule = function() {
    //There be dragons in this closure.

"use strict";


/**
 * Utilities for manipulating bounding boxes stored
 * in external array (as sextuplets of float32)
 */


function box_get_centroid(dst, dst_off, src, src_off) {
    dst[dst_off] = 0.5*(src[src_off] + src[src_off + 3]);
    dst[dst_off+1] = 0.5*(src[src_off + 1] + src[src_off + 4]);
    dst[dst_off+2] = 0.5*(src[src_off + 2] + src[src_off + 5]);
}

function box_add_point_0(dst, src, src_off) {

    if (dst[0] > src[src_off])   dst[0] = src[src_off];
    if (dst[3] < src[src_off])   dst[3] = src[src_off];

    if (dst[1] > src[src_off+1]) dst[1] = src[src_off+1];
    if (dst[4] < src[src_off+1]) dst[4] = src[src_off+1];

    if (dst[2] > src[src_off+2]) dst[2] = src[src_off+2];
    if (dst[5] < src[src_off+2]) dst[5] = src[src_off+2];

}

function box_add_box_0(dst, src, src_off) {

    if (dst[0] > src[src_off]) dst[0] = src[src_off];
    if (dst[1] > src[src_off+1]) dst[1] = src[src_off+1];
    if (dst[2] > src[src_off+2]) dst[2] = src[src_off+2];

    if (dst[3] < src[src_off+3]) dst[3] = src[src_off+3];
    if (dst[4] < src[src_off+4]) dst[4] = src[src_off+4];
    if (dst[5] < src[src_off+5]) dst[5] = src[src_off+5];
}

function box_add_box_00(dst, src) {
    if (dst[0] > src[0]) dst[0] = src[0];
    if (dst[1] > src[1]) dst[1] = src[1];
    if (dst[2] > src[2]) dst[2] = src[2];

    if (dst[3] < src[3]) dst[3] = src[3];
    if (dst[4] < src[4]) dst[4] = src[4];
    if (dst[5] < src[5]) dst[5] = src[5];
}

function box_get_size(dst, dst_off, src, src_off) {
    for (var i=0; i<3; i++) {
        dst[dst_off+i] = src[src_off+3+i] - src[src_off+i];
    }
}

//function box_copy(dst, dst_off, src, src_off) {
//    for (var i=0; i<6; i++) {
//        dst[dst_off+i] = src[src_off+i];
//    }
//}

// unwound version of box_copy
function box_copy_00(dst, src) {
    dst[0] = src[0];
    dst[1] = src[1];
    dst[2] = src[2];
    dst[3] = src[3];
    dst[4] = src[4];
    dst[5] = src[5];
}

var dbl_max = Infinity;

//function box_make_empty(dst, dst_off) {
//        dst[dst_off]   =  dbl_max;
//        dst[dst_off+1] =  dbl_max;
//        dst[dst_off+2] =  dbl_max;
//        dst[dst_off+3] = -dbl_max;
//        dst[dst_off+4] = -dbl_max;
//        dst[dst_off+5] = -dbl_max;
//}

function box_make_empty_0(dst) {
    dst[0] =  dbl_max;
    dst[1] =  dbl_max;
    dst[2] =  dbl_max;
    dst[3] = -dbl_max;
    dst[4] = -dbl_max;
    dst[5] = -dbl_max;
}

function box_area(src, src_off) {

    var dx = src[src_off+3] - src[src_off];
    var dy = src[src_off+4] - src[src_off+1];
    var dz = src[src_off+5] - src[src_off+2];

    if (dx < 0 || dy < 0 || dz < 0)
        return 0;

    return 2.0 * (dx * dy + dy * dz + dz * dx);
}

function box_area_0(src) {

    var dx = src[3] - src[0];
    var dy = src[4] - src[1];
    var dz = src[5] - src[2];

    if (dx < 0 || dy < 0 || dz < 0)
        return 0;

    return 2.0 * (dx * dy + dy * dz + dz * dx);
}





function bvh_split_info() {
    this.vb_left = new Float32Array(6);
    this.vb_right = new Float32Array(6);
    this.cb_left = new Float32Array(6);
    this.cb_right = new Float32Array(6);
    this.num_left = 0;
    this.best_split = -1;
    this.best_cost = -1;
    this.num_bins = -1;
}

bvh_split_info.prototype.reset = function () {
    this.num_left = 0;
    this.best_split = -1;
    this.best_cost = -1;
    this.num_bins = -1;
};


function bvh_bin() {
    this.box_bbox = new Float32Array(6); // bbox of all primitive bboxes
    this.box_centroid = new Float32Array(6); // bbox of all primitive centroids
    this.num_prims = 0; // number of primitives in the bin
}

bvh_bin.prototype.reset = function() {
    this.num_prims = 0; // number of primitives in the bin
    box_make_empty_0(this.box_bbox);
    box_make_empty_0(this.box_centroid);
};

function accum_bin_info() {
    this.BL = new Float32Array(6);
    this.CL = new Float32Array(6);
    this.NL = 0;
    this.AL = 0;
}

accum_bin_info.prototype.reset = function() {
    this.NL = 0;
    this.AL = 0;

    box_make_empty_0(this.BL);
    box_make_empty_0(this.CL);
};


//Scratch variables used by bvh_bin_axis
//TODO: can be replaced by a flat ArrayBuffer
var bins = [];
var i;
for (i=0; i<MAX_BINS; i++) {
    bins.push(new bvh_bin());
}

//TODO: can be replaced by a flat ArrayBuffer
var ai = [];
for (i=0; i<MAX_BINS-1; i++)
    ai.push(new accum_bin_info());

var BR = new Float32Array(6);
var CR = new Float32Array(6);


function assign_bins(bvh, start, end, axis, cb, cbdiag, num_bins) {

    var centroids = bvh.centroids;
    var primitives = bvh.primitives;
    var boxes = bvh.finfo.boxes;
    var boxStride = bvh.finfo.boxStride;

    /* bin assignment */
    var k1 = num_bins * (1.0 - BOX_SCALE_EPSILON) / cbdiag[axis];
    var cbaxis = cb[axis];
    var sp = bvh.sort_prims;

    for (var j = start; j <= end; j++)
    {
        /* map array index to primitive index -- since primitive index array gets reordered by the BVH build*/
        /* while the primitive info array is not reordered */
        var iprim = primitives[j]|0;

        var fpbin = k1 * (centroids[iprim * 3/*POINT_STRIDE*/ + axis] - cbaxis);
        var binid = fpbin|0; //Truncate to int is algorithmic -> not an optimization thing!

        /* possible floating point problems */
        if (binid < 0)
        {
            binid = 0;
            //debug("Bin index out of range " + fpbin);
        }
        else if (binid >= num_bins)
        {
            binid = num_bins-1;
            //debug("Bin index out of range. " + fpbin);
        }

        /* Store the bin index for the partitioning step, so we don't recompute it there */
        sp[j] = binid;

        /* update other bin data with the new primitive */
        //var bin = bins[binid];
        bins[binid].num_prims ++;

        box_add_box_0(bins[binid].box_bbox, boxes, iprim * boxStride);
        box_add_point_0(bins[binid].box_centroid, centroids, iprim * 3 /*POINT_STRIDE*/);
    }
    /* at this point all primitves are assigned to a bin */
}


function bvh_bin_axis(bvh, start, end, axis, cb, cbdiag, split_info) {

    /* if size is near 0 on this axis, cost of split is infinite */
    if (cbdiag[axis] < bvh.scene_epsilon)
    {
        split_info.best_cost = Infinity;
        return;
    }

    var num_bins = MAX_BINS;
    if (num_bins > end-start+1)
        num_bins = end-start+1;

    var i;
    for (i=0; i<num_bins; i++)
        bins[i].reset();

    for (i=0; i<num_bins-1; i++)
        ai[i].reset();

    split_info.num_bins = num_bins;

    assign_bins(bvh, start, end, axis, cb, cbdiag, num_bins);


    /* now do the accumulation sweep from left to right */
    box_copy_00(ai[0].BL, bins[0].box_bbox);
    box_copy_00(ai[0].CL, bins[0].box_centroid);
    ai[0].AL = box_area_0(ai[0].BL);
    ai[0].NL = bins[0].num_prims;
    var bin;
    for (i=1; i<num_bins-1; i++)
    {
        bin = bins[i];
        var aii = ai[i];
        box_copy_00(aii.BL, ai[i-1].BL);
        box_add_box_00(aii.BL, bin.box_bbox);
        aii.AL = box_area_0(aii.BL);

        box_copy_00(aii.CL, ai[i-1].CL);
        box_add_box_00(aii.CL, bin.box_centroid);

        aii.NL = ai[i-1].NL + bin.num_prims;
    }

    /* sweep from right to left, keeping track of lowest cost and split */
    i = num_bins - 1;
    box_copy_00(BR, bins[i].box_bbox);
    box_copy_00(CR, bins[i].box_centroid);
    var AR = box_area_0(BR);
    var NR = bins[i].num_prims;

    var best_split = i;
    var best_cost = AR * NR + ai[i-1].AL * ai[i-1].NL;
    box_copy_00(split_info.vb_right, BR);
    box_copy_00(split_info.cb_right, bins[i].box_centroid);
    box_copy_00(split_info.vb_left, ai[i-1].BL);
    box_copy_00(split_info.cb_left, ai[i-1].CL);
    split_info.num_left = ai[i-1].NL;

    for (i=i-1; i>=1; i--)
    {
        bin = bins[i];
        box_add_box_00(BR, bin.box_bbox);
        box_add_box_00(CR, bin.box_centroid);
        AR = box_area_0(BR);
        NR += bin.num_prims;

        var cur_cost = AR * NR + ai[i-1].AL * ai[i-1].NL;

        if (cur_cost <= best_cost)
        {
            best_cost = cur_cost;
            best_split = i;

            box_copy_00(split_info.vb_right, BR);
            box_copy_00(split_info.cb_right, CR);
            box_copy_00(split_info.vb_left, ai[i-1].BL);
            box_copy_00(split_info.cb_left, ai[i-1].CL);
            split_info.num_left = ai[i-1].NL;
        }
    }

    split_info.best_split = best_split;
    split_info.best_cost = best_cost;
}

function bvh_partition(bvh, start, end, axis, cb, cbdiag, split_info) {

    //At this point, the original algorithm does an in-place NON-STABLE partition
    //to move primitives to the left and right sides of the split plane
    //into contiguous location of the primitives list for use by
    //the child nodes. But, we want to preserve the ordering by size
    //without having to do another sort, so we have to use
    //a temporary storage location to copy into. We place right-side primitives
    //in temporary storage, then copy back into the original storage in the right order.
    //Left-side primitives are still put directly into the destination location.
    var primitives = bvh.primitives;
    //var centroids = bvh.centroids;
    var i,j;

    //sort_prims contains bin indices computed during the split step.
    //Here we read those and also use sort_prims as temporary holding
    //of primitive indices. Hopefully the read happens before the write. :)
    //In C it was cheap enough to compute this again...
    //var k1 = split_info.num_bins * (1.0 - BOX_SCALE_EPSILON) / cbdiag[axis];
    //var cbaxis = cb[axis];
    var sp = bvh.sort_prims;

    var right = 0;
    var left = start|0;
    var best_split = split_info.best_split|0;

    for (i=start; i<=end; i++) {
        var iprim = primitives[i]|0;
        //var fpbin = (k1 * (centroids[3/*POINT_STRIDE*/ * iprim + axis] - cbaxis));
        var binid = sp[i]; /* fpbin|0; */

        if (binid < best_split) {
            primitives[left++] = iprim;
        } else {
            sp[right++] = iprim;
        }
    }

    //if ((left-start) != split_info.num_left)
    //    debug("Mismatch between binning and partitioning.");

    //Copy back the right-side primitives into main primitives array, while
    //maintaining order
    for (j=0; j<right; j++) {
        primitives[left+j] = sp[j];
    }
    /* at this point the binning is complete and we have computed a split */
}


function bvh_fatten_inner_node(bvh, nodes, nodeidx, start, end, cb, cbdiag, poly_cut_off) {

    var primitives = bvh.primitives;
    var centroids = bvh.centroids;

    //Take the first few items to place into the inner node,
    //but do not go over the max item or polygon count.
    var prim_count = end - start + 1;

    if (prim_count > bvh.frags_per_inner_node)
        prim_count = bvh.frags_per_inner_node;

    if (prim_count > poly_cut_off)
        prim_count = poly_cut_off;


    nodes.setPrimStart(nodeidx, start);
    nodes.setPrimCount(nodeidx, prim_count);
    start += prim_count;

    //Because we take some primitives off the input, we have to recompute
    //the bounding box used for computing the node split.
    box_make_empty_0(cb);
    for (var i=start; i<=end; i++) {
        box_add_point_0(cb, centroids, 3/*POINT_STRIDE*/ * primitives[i]);
    }

    //Also update the split axis -- it could possibly change too.
    box_get_size(cbdiag, 0, cb, 0);
    //Decide which axis to split on. Done purely by longest.
    var axis = 0;
    if (cbdiag[1] > cbdiag[0])
        axis = 1;
    if (cbdiag[2] > cbdiag[axis])
        axis = 2;

    return axis;
}


var cbdiag = new Float32Array(3); //scratch variable used in bvh_subdivide

function bvh_subdivide(bvh,
                       nodeidx, /* current parent node to consider splitting */
                       start, end, /* primitive sub-range to be considered at this recursion step */
                       vb, /* bounding volume of the primitives' bounds in the sub-range */
                       cb, /* bounding box of primitive centroids in this range */
                       transparent, /* does the node contain opaque or transparent objects */
                       depth /* recursion depth */
                       )
{
    box_get_size(cbdiag, 0, cb, 0);
    var nodes = bvh.nodes;
    var frags_per_leaf = transparent ? bvh.frags_per_leaf_node_transparent : bvh.frags_per_leaf_node;
    var frags_per_inner = transparent ? bvh.frags_per_inner_node_transparent : bvh.frags_per_inner_node;
    var polys_per_node = bvh.max_polys_per_node;

    //Decide which axis to split on.
    var axis = 0;
    if (cbdiag[1] > cbdiag[0])
        axis = 1;
    if (cbdiag[2] > cbdiag[axis])
        axis = 2;

    //Whether the node gets split or not, it gets
    //the same overall bounding box.
    nodes.setBox0(nodeidx, vb);

    //Check the expected polygon count of the node. This figures out the maximum number of fragments
    // we can put at the node as determined by polys_per_node
    var poly_count = 0;
    var poly_cut_off = 0;
    var prim_count = end - start + 1;

    // If we have the number of triangles in each mesh, limit the number of primitives in an inner node.
    if (bvh.finfo.hasPolygonCounts && bvh.frags_per_inner_node) {
        // Walk through primitives, add up the counts until we reach polys_per_node (10000), or run through
        // frags_per_inner_node (usually 32).
        // We know that later on we'll limit the number to frags_per_inner_node, so also do it here.
        var shorten_end = (prim_count <= bvh.frags_per_inner_node) ? end : start + bvh.frags_per_inner_node - 1;
        for (var i=start; i<=shorten_end; i++) {
            poly_count += bvh.finfo.getPolygonCount(bvh.primitives[i]);
            poly_cut_off++;
            if (poly_count > polys_per_node)
                break;
        }
    }

    var isSmall = ((prim_count <= frags_per_leaf) && (poly_count < polys_per_node)) ||
                  (prim_count === 1);

    //Decide whether to terminate recursion
    if (isSmall ||
      depth > MAX_DEPTH || //max recursion depth
      cbdiag[axis] < bvh.scene_epsilon) //node would be way too tiny for math to make sense (a point)
    {
        nodes.setLeftChild(nodeidx, -1);
        nodes.setPrimStart(nodeidx, start);
        nodes.setPrimCount(nodeidx, end-start+1);
        nodes.setFlags(nodeidx, 0, 0, transparent ? 1 : 0);
        return;
    }

    //Pick the largest (first) primitives to live in this node
    //NOTE: this assumes primitives are sorted by size.
    //NOTE: This step is an optional departure from the original, and we also do a check for it above
    // to compute poly_cut_off.
    if (frags_per_inner) {
        axis = bvh_fatten_inner_node(bvh, nodes, nodeidx, start, end, cb, cbdiag, poly_cut_off);
        start = start + nodes.getPrimCount(nodeidx);
    }

    var split_info = new bvh_split_info();

    //Do the binning of the remaining primitives to go into child nodes
    bvh_bin_axis(bvh, start, end, axis, cb, cbdiag, split_info);

    if (split_info.num_bins < 0) {
        //Split was too costly, so add all objects to the current node and bail
        nodes.setPrimCount(nodeidx, nodes.getPrimCount(nodeidx) + end - start + 1);
        return;
    }

    bvh_partition(bvh, start, end, axis, cb, cbdiag, split_info);

    var child_idx = nodes.nextNodes(2);

    /* set info about split into the node */
    var cleft = (split_info.vb_left[3+axis] + split_info.vb_left[axis]) * 0.5;
    var cright = (split_info.vb_right[3+axis] + split_info.vb_right[axis]) * 0.5;

    nodes.setFlags(nodeidx, axis, cleft < cright ? 0 : 1, transparent ? 1 : 0);
    nodes.setLeftChild(nodeidx, child_idx);


    /* validate split */
    /*
    if (true) {
        for (var i=start; i< start+num_left; i++)
        {
            //int binid = (int)(k1 * (info->prim_info[info->bvh->iprims[i]].centroid.v[axis] - cb->min.v[axis]));
            var cen = primitives[i] * POINT_STRIDE;
            if (   centroids[cen] < split_info.cb_left[0]
                || centroids[cen] > split_info.cb_left[3]
                || centroids[cen+1] < split_info.cb_left[1]
                || centroids[cen+1] > split_info.cb_left[4]
                || centroids[cen+2] < split_info.cb_left[2]
                || centroids[cen+2] > split_info.cb_left[5])
            {
                debug ("wrong centroid box");
            }
        }

        for (i=start+num_left; i<=end; i++)
        {
            //int binid = (int)(k1 * (info->prim_info[info->bvh->iprims[i]].centroid.v[axis] - cb->min.v[axis]));
            var cen = primitives[i] * POINT_STRIDE;
            if (   centroids[cen] < split_info.cb_right[0]
                || centroids[cen] > split_info.cb_right[3]
                || centroids[cen+1] < split_info.cb_right[1]
                || centroids[cen+1] > split_info.cb_right[4]
                || centroids[cen+2] < split_info.cb_right[2]
                || centroids[cen+2] > split_info.cb_right[5])
            {
                debug ("wrong centroid box");
            }
        }
    }
    */

    /* recurse */
   //bvh_subdivide(bvh, child_idx, start, start + split_info.num_left - 1, split_info.vb_left, split_info.cb_left, transparent, depth+1);
   //bvh_subdivide(bvh, child_idx + 1, start + split_info.num_left, end, split_info.vb_right, split_info.cb_right, transparent, depth+1);

    //Iterative stack-based recursion for easier profiling
   bvh.recursion_stack.push([bvh, child_idx + 1, start + split_info.num_left, end, split_info.vb_right, split_info.cb_right, transparent, depth+1]);
   bvh.recursion_stack.push([bvh, child_idx, start, start + split_info.num_left - 1, split_info.vb_left, split_info.cb_left, transparent, depth+1]);

}


function compute_boxes(bvh) {

    var boxv_o = bvh.boxv_o;
    var boxc_o = bvh.boxc_o;
    var boxv_t = bvh.boxv_t;
    var boxc_t = bvh.boxc_t;

    box_make_empty_0(boxv_o);
    box_make_empty_0(boxc_o);
    box_make_empty_0(boxv_t);
    box_make_empty_0(boxc_t);

    var c = bvh.centroids;
    var b = bvh.finfo.boxes;
    var boxStride = bvh.finfo.boxStride;

    for (var i=0, iEnd=bvh.prim_count; i<iEnd; i++) {

        // find which primitive in the sorted list to use next
        var p = bvh.primitives[i];
        box_get_centroid(c, 3/*POINT_STRIDE*/*p, b, boxStride*p);

        if (i >= bvh.first_transparent) {

            box_add_point_0(boxc_t, c, 3/*POINT_STRIDE*/*p);
            box_add_box_0(boxv_t, b, boxStride*p);

        } else {

            box_add_point_0(boxc_o, c, 3/*POINT_STRIDE*/*p);
            box_add_box_0(boxv_o, b, boxStride*p);

        }
    }

    box_get_size(cbdiag, 0, bvh.boxv_o, 0);
    var maxsz = Math.max(cbdiag[0], cbdiag[1], cbdiag[2]);
    bvh.scene_epsilon = BOX_EPSILON * maxsz;
}




    //Module exports
    return {
        bvh_subdivide : bvh_subdivide,
        compute_boxes : compute_boxes,
        box_area : box_area
    };

}();


function FragInfo(fragments, materialDefs) {
    //Invariants
    this.boxes = fragments.boxes; //Array of Float32, each bbox is a sextuplet
    this.polygonCounts = fragments.polygonCounts;
    this.hasPolygonCounts = !!this.polygonCounts;
    this.materials = fragments.materials; //material indices (we need to know which fragments are transparent)
    this.materialDefs = materialDefs;
    this.count = fragments.length;
    this.boxStride = 6;
    this.wantSort = true;
}

FragInfo.prototype.getCount = function() {
    return this.count;
};

FragInfo.prototype.isTransparent = function(i) {
    return this.materialDefs && this.materialDefs[this.materials[i]] ? this.materialDefs[this.materials[i]].transparent : false;
};

FragInfo.prototype.getPolygonCount = function(i) {
    return this.polygonCounts[i];
};

/**
 * Given a list of LMV fragments, builds a spatial index for view-dependent traversal and hit testing.
 * @constructor
 */
export function BVHBuilder(fragments, materialDefs, finfo) {

    //Initialize the inputs (bboxes, transparent flags, polygon counts)
    this.finfo = finfo || new FragInfo(fragments, materialDefs);

    this.prim_count = this.finfo.getCount();

    //To be initialized by build() function based on build options
    this.frags_per_leaf_node = -1;
    this.frags_per_inner_node = -1;
    this.nodes = null;

    this.work_buf = new ArrayBuffer(this.prim_count * 4);
    this.sort_prims = new Int32Array(this.work_buf);

    //Allocate memory buffer for re-ordered fragment primitive indices,
    //which will be sorted by node ownership and point to the index
    //of the fragment data.
    this.primitives = new Int32Array(this.prim_count);

    //The BVH split algorithm works based on centroids of the bboxes.
    this.centroids = new Float32Array(POINT_STRIDE * this.prim_count);

    //BBoxes and centroid bboxes for opaque and transparent primitive sets
    this.boxv_o = new Float32Array(6);
    this.boxc_o = new Float32Array(6);
    this.boxv_t = new Float32Array(6);
    this.boxc_t = new Float32Array(6);


    this.recursion_stack = [];
}

BVHBuilder.prototype.sortPrimitives = function(wantSort) {

    var prim_sizes = new Float32Array(this.work_buf);
    var primitives = this.primitives;
    var numTransparent = 0;

    //Sort the input objects by size
    //We assume all LMV SVF files come
    //sorted by draw priority already, so in theory we can skip this step.
    //This turns out to not be the case - some fragments are badly sorted.
    //Part of the reason may be that the surface area of the geometry itself,
    //not its bounding box, is used to sort by physical size in LMVTK.
    //In any case, the transparent objects do not always come last (bug in LMVTK?),
    //so we still have to pull them out to the end of the list, so some sorting
    //takes place no matter how this value is set.
    // Turning this option on will mean that the BVH building process as a whole
    // will be 45% to 75% longer, for large models - full sorting takes awhile.
    // In absolute terms this is an increase of a maximum of 1.15 seconds for a
    // very large model (one with over 1 million fragments, i.e., mesh instances).
    // This cost may be acceptable. For smaller models - "only" 70K instances -
    // the cost is 0.05 seconds. For 130k instances, 0.1 seconds. The rise is
    // slightly more than linear, but not excessively slow. I think it's acceptable,
    // given that the cost is still much less than loading even a small part of the
    // model.
    var doSort = wantSort;

    // console.log("BVH sort is " + WANT_SORT);

    var i, iEnd;
    for (i=0, iEnd=this.prim_count; i<iEnd; i++) {

        //Start with trivial 1:1 order of the indices array
        primitives[i] = i;

        var transparent = this.finfo.isTransparent(i);

        if (transparent)
            numTransparent++;

        if (doSort) {
            prim_sizes[i] = BVHModule.box_area(this.finfo.boxes, this.finfo.boxStride*i);

            //In order to make transparent objects appear last,
            //we give them a negative size, so that they are naturally
            //sorted last in the sort by size.
            if (transparent)
                prim_sizes[i] = -prim_sizes[i];
        } else {
            //We still need the transparency flag for the loop below
            //where we find the last opaque item, but we can
            //short-cut the size computation.
            prim_sizes[i] = transparent ? -1 : 1;
        }
    }


    if (doSort) {
        Array.prototype.sort.call(this.primitives, function(a, b) {
            return prim_sizes[b] - prim_sizes[a];
        });
    } else {
        if (numTransparent && numTransparent < this.prim_count) {

            var tmpTransparent = new Int32Array(numTransparent);
            var oidx = 0, tidx = 0;

            for (i=0, iEnd = this.prim_count; i<iEnd; i++) {
                if (prim_sizes[i] >= 0)
                    primitives[oidx++] = primitives[i];
                else
                    tmpTransparent[tidx++] = primitives[i];
            }

            primitives.set(tmpTransparent, this.prim_count - numTransparent);
        }
    }

    this.first_transparent = this.prim_count - numTransparent;
};


BVHBuilder.prototype.build = function(options) {
    //Kick off the BVH build.

    var useSlimNodes = options && !!options.useSlimNodes;

    var self = this;
    function assign_option(name, defaultVal) {
        if (options.hasOwnProperty(name))
            self[name] = options[name];
        else
            self[name] = defaultVal;
    }

    // note: frags_per_leaf_node does *not* make an upper limit for the number of frags per node.

    //options for build optimized for rasterization renderer scenes
    if (useSlimNodes) {
        assign_option("frags_per_leaf_node", 1);
        assign_option("frags_per_inner_node", 0);
        assign_option("frags_per_leaf_node_transparent", 1);
        assign_option("frags_per_inner_node_transparent", 0);
        assign_option("max_polys_per_node", Infinity);
    } else {
        var multiplier = options.isWeakDevice ? 0.5 : 1.0;

        //TODO: tune these constants
        assign_option("frags_per_leaf_node", 0 | (256 * multiplier));
        //Placing fragments at inner nodes places more emphasis on bigger objects during tree traversal
        //but it can only be done for opaque objects. Transparent objects have to be strictly back to front
        //traversal regardless of size, unless a unified traversal
        assign_option("frags_per_inner_node", 0|(this.frags_per_leaf_node) );
        assign_option("frags_per_leaf_node_transparent", this.frags_per_leaf_node);
        assign_option("frags_per_inner_node_transparent", 0);
        assign_option("max_polys_per_node", 0 | (20000 * multiplier));
    }

    //Reuse existing node array if there
    if (this.nodes && (this.nodes.is_lean_node == useSlimNodes))
        this.nodes.nodeCount = 0;
    else {
        var est_nodes = this.prim_count / this.frags_per_leaf_node;
        var num_nodes = 1;
        while (num_nodes < est_nodes)
            num_nodes *= 2;

        this.nodes = new NodeArray(num_nodes, options ? options.useSlimNodes : false);
    }

    this.sortPrimitives(this.finfo.wantSort);

    BVHModule.compute_boxes(this);

    //Init the root nodes at 0 for opaque
    //and 1 for transparent objects
    var root = this.nodes.nextNodes(2);

    //Now kick off the recursive tree build

    //Opaque
    BVHModule.bvh_subdivide(this, root, 0, this.first_transparent - 1, this.boxv_o, this.boxc_o, false, 0);

    var a;
    while(this.recursion_stack.length) {
        a = this.recursion_stack.pop();
        BVHModule.bvh_subdivide(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]);
    }

    //Transparent
    BVHModule.bvh_subdivide(this, root+1, this.first_transparent, this.prim_count-1, this.boxv_t, this.boxc_t, true, 0);

    while(this.recursion_stack.length) {
        a = this.recursion_stack.pop();
        BVHModule.bvh_subdivide(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]);
    }
};
