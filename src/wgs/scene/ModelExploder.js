import * as THREE from "three";


var pt = new THREE.Vector3();
var tmpBox = new Float32Array(6);


const STRATEGY_HIERARCHY = 'hierarchy'; // InstanceTree-approach
const STRATEGY_RADIAL    = 'radial';    // FragList-approach

var _strategy = STRATEGY_HIERARCHY; 

/**
 * Contains logic for exploding a model, which separate model parts away from the
 * center, by using the model's hierarchy to drive the displacement.
 *
 * @private
 */
export class ModelExploder {

    constructor() {

    }

    /**
     * Sets the algorithm identifier that will explode all models.
     *
     * @param {string} newStrategy - Algorithm identifier. Refer to STRETEGY_XXXX const values above.
     *
     * @returns {boolean} true if the strategy changed
     */
    static setStrategy(newStrategy) {
        if (_strategy !== newStrategy) {
            _strategy = newStrategy;
            return true;
        }
    }

    /**
     * @returns {string} An identifier for the algorithm being used to explode models.
     */
    static getStrategy() {
        return _strategy;
    }

    /**
     * @param {Autodesk.Viewing.Model} model - The model that will get its parts (dbIds) exploded.
     * @param {Number} scale - Value between 0 (no explotion) to 1 (fully exploded).
     */
    static explode(model, scale) {

        var it = model.getData().instanceTree;

        var fragList = model.getFragmentList();

        var mc = model.getVisibleBounds(true).getCenter(new THREE.Vector3());

        //If we have a full part hierarchy we can use a
        //better grouping strategy when exploding
        if (_strategy === STRATEGY_HIERARCHY && it && scale !== 0) {
            
            _explodeWithInstanceTree(it, fragList, scale, mc);
        }
        else {

            // _strategy === STRATEGY_RADIAL
            _explodeWithFragList(fragList, it, scale, mc);
        }
    }
}


/**
 * Applies explotion by leveraging the instanceTree.
 *
 * @param {InstanceTree} it
 * @param {FragmentList} fragList
 * @param {number} scale - Value between 0 and 1.
 * @param {THREE.Vector3} mc - Model's Center point
 *
 * @private
 */
function _explodeWithInstanceTree(it, fragList, scale, mc) {

    //Input scale is in the range 0-1, where 0
    //means no displacement, and 1 maximum reasonable displacement.
    scale *= 2;

    // If scale is small (close to 0), the shift is only applied to the topmost levels of the hierarchy.
    // With increasing s, we involve more and more hierarchy levels, i.e., children are recursively shifted 
    // away from their parent node centers.
    // Since explodeValue is integer, it will behave discontinous during a transition from s=0 to s=1.
    // To keep the overall transition continuous, we use the fractional part of scaledExplodeDepth
    // to smoothly fade-in the transition at each hierarchy level. 

    // levels beyond explodeDepth, we stop shifting children away from their parent.
    // 
    var scaledExplodeDepth     = scale * (it.maxDepth - 1) + 1; // [1, 2 * it.maxDepth - 1]
    if (it.maxDepth === 1) {
        // Hack to get flat-instanceTrees to explode
        scaledExplodeDepth = scale;
    }
    var explodeDepth           = 0 | scaledExplodeDepth;        // [1, 2 * it.maxDepth - 1]
    var currentSegmentFraction = scaledExplodeDepth - explodeDepth; // [0, 1)

    // Define recursive function to traverse object hierarchy. Each object is shifted away 
    // from the bbox center of its parent.
    //  number nodeId:   dbId of the current instanceTree node
    //  int depth:       tracks hierarchy level (0 for root)
    //  vec3 (cx,cy,cz): center of the parent object (after applying the displacement to the parent object) 
    //  vec3 (ox,oy,oz): accumuled displacement from all parents on the path to root
    function explodeRec(nodeId, depth, cx, cy, cz, ox, oy, oz) {

        var oscale = scale*2; //TODO: also possibly related to depth
        if (depth == explodeDepth)
            oscale *= currentSegmentFraction; //smooth transition of this tree depth from non-exploded to exploded state

        // get bbox center of this node
        it.getNodeBox(nodeId, tmpBox);
        var mycx = 0.5 * (tmpBox[0] + tmpBox[3]);
        var mycy = 0.5 * (tmpBox[1] + tmpBox[4]);
        var mycz = 0.5 * (tmpBox[2] + tmpBox[5]);

        // The root node (depth==0) has no parent to shift away from.
        // For child nodes with level > explodDepth, we don't apply additional displacement anymore - just pass the displacement of the parents.
        if (depth > 0 && depth <= explodeDepth) {
            // add displacement to move this object away from its parent's bbox center (cx, cy, cz)
            var dx = (mycx - cx) * oscale;
            var dy = (mycy - cy) * oscale;
            var dz = (mycz - cz) * oscale;

            //var omax = Math.max(dx, Math.max(dy, dz));
            // sum up offsets: The final displacement of a node is accumulated by its own shift and 
            // the shifts of all nodes up to the root.
            ox += dx;
            oy += dy;
            oz += dz;
        }

        if (it.isNodeExplodeLocked(nodeId)) {
            ox = oy = oz = 0;
        }

        // continue recursion with child objects (if any)
        it.enumNodeChildren(nodeId, function(dbId) {
            explodeRec(dbId, depth+1, mycx, mycy, mycz, ox, oy, oz);
        }, false);

        pt.x = ox;
        pt.y = oy;
        pt.z = oz;

        // set translation as anim transform for all fragments associated with the current node
        it.enumNodeFragments(nodeId, function(fragId) {

            fragList.updateAnimTransform(fragId, null, null, pt);

        }, false);

    }

    explodeRec(it.getRootId(), 0, mc.x, mc.y, mc.z, 0, 0, 0); // run on root to start recursion
}


/**
 * Applies explotion by leveraging the FragmentList (no hierarchy). 
 *
 * @param {FragmentList} fragList
 * @param {InstanceTree} it - Only used to check whether a dbId is "locked" and should not be exploded.
 * @param {number} scale - Value between 0 and 1.
 * @param {THREE.Vector3} mc - Model's Center point
 */
function _explodeWithFragList(fragList, it, scale, mc) {

    // Float32Array array with 6 floats per bbox.
    var boxes = fragList.fragments.boxes;

    // The dbId to check for locked explode may come from the vizmesh
    // or the fragId2dbId array, depending on how the model was loaded.
    var vizmeshes;
    var dbIds;
    if (fragList.useThreeMesh)
        vizmeshes = fragList.vizmeshes;
    else
        dbIds = fragList.fragments.fragId2dbId;

    for (var i= 0, iEnd=fragList.getCount(); i<iEnd; i++) {

        // For scale to 0, if the node explode is locked.
        if (scale == 0 || (it && it.isNodeExplodeLocked(
            vizmeshes ? (vizmeshes[i] && vizmeshes[i].dbId) : dbIds[i]))) {
            // reset to unexploded state, i.e., remove all animation transforms
            fragList.updateAnimTransform(i);

        } else {

            // get start index of the bbox for fragment i. 
            var box_offset = i * 6;

            // get bbox center of fragment i
            var cx = 0.5 * (boxes[box_offset]     + boxes[box_offset + 3]);
            var cy = 0.5 * (boxes[box_offset + 1] + boxes[box_offset + 4]);
            var cz = 0.5 * (boxes[box_offset + 2] + boxes[box_offset + 5]);

            // compute translation vector for this fragment:
            // We shift the fragment's bbox center c=(cx,cy,cz) away from the overall model center mc,
            // so that the distance between the two will finally be scaled up by a factor of (1.0 + scale).
            //
            pt.x = scale * (cx - mc.x);
            pt.y = scale * (cy - mc.y);
            pt.z = scale * (cz - mc.z);

            fragList.updateAnimTransform(i, null, null, pt);
        }
    }
}