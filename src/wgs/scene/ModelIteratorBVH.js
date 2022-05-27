import { FrustumIntersector } from './FrustumIntersector';
import * as THREE from "three";

export function ModelIteratorBVH() {

    var _frags;

    // Nodes in the BVH, in an array for easy access to all of them.
    // There are up to two trees, one for opaques, one for transparent objects.
    // These are normally listed top-down, in a flattened list, e.g., if all the objects
    // in the scene were transparent, _bvhNodes[0] = 0, and the 0 node would have not
    // children and no primitives, as this node would contain all the opaque fragments,
    // of which there are none. The transparent tree is always in _bvhNodes[1], and might
    // look something like this:
    //     1
    //  2     3
    // 4 5   6 7
    // with the children 4-7 each containing a RenderBatch of some number of fragments. Note
    // that inner nodes can also have RenderBatches.
	var _bvhNodes = null;
    // There's indirection for each RenderBatch. A RenderBatch contains a number of fragments.
    // Rather than an array per RenderBatch, a single array is accessed by all RenderBatches.
    // The primitives are in a list sorted by surface area. We preserve this. In this
    // _bvhFragOrder array we by a flattened list of children fragment indices. So child 4,
    // above, might have 3 objects, and their indices might be [291 12 55].
    // primStart and primCount access this array.
    // Also see bvh_partition and the comment there.
    var _bvhFragOrder = null;
    // _bvhScenes is a sparse array of RenderBatches, each RenderBatch has a few fragments.
    // Only those elements in the array that have a RenderBatch are defined.
    var _bvhScenes = null;
    // What is the containment state of this node, if known? Is either CONTAINMENT_UNKNOWN
    // or INTERSECTS or CONTAINS. If CONTAINS, we don't have to run the frustum cull
    // test, saving a few percent in speed.
    var _bvhContainment = null;
    var _bvhNodeQueue = null, _bvhNodeAreas = null, _bvhHead, _bvhTail;
    var _bvhLIFO = 1;
    var _bvhPrioritizeScreenSize = true;
    var _bvhOpaqueDone = false;
    var _bvhOpaqueSkipped = false; // true if skipOpaqueShapes has been called in the current traversal.
    var _tmpBox = new THREE.Box3();
    var _tmpBox2 = new THREE.Box3();
    var _frustum;
    var _done = false;
    var _RenderBatch;
    //var _time0 = 0;
    var _resetVisStatus = true;

    var _renderModelLinear = null;
    var _options = null;

    
    this.initialize = function(renderModelLinear, nodes, primitives, options) {
        _renderModelLinear = renderModelLinear;
        _options = options;
        _frags = renderModelLinear.getFragmentList();
        // Take the RenderBatch class from the model, so on demand loading can
        // use a different class to handle redraws propertly
        _RenderBatch = renderModelLinear.RenderBatch;

        if (options && options.hasOwnProperty("prioritize_screen_size")) {
            _bvhPrioritizeScreenSize = options.prioritize_screen_size;
        }

        _bvhFragOrder = primitives;
        _bvhScenes = new Array(nodes.nodeCount);
        _bvhContainment = new Int8Array(nodes.nodeCount);
        _bvhNodes = nodes;
        _bvhNodeQueue = new Int32Array(nodes.nodeCount + 1);
        _bvhNodeAreas = new Float32Array(nodes.nodeCount);

        for (var i=0; i<nodes.nodeCount; i++) {
            var primCount = nodes.getPrimCount(i);
            // does this node have real objects in it?
            if (primCount) {
                _bvhScenes[i] = new _RenderBatch(_frags, _bvhFragOrder, nodes.getPrimStart(i), primCount);
                // These are set manually, because we will not be adding fragments to the
                // render batch one by one -- the fragments are already loaded.
                _bvhScenes[i].lastItem = _bvhScenes[i].start + primCount;
                _bvhScenes[i].numAdded = primCount;
                _bvhScenes[i].nodeIndex = i;
                if (nodes.getFlags(i) & 8) {
                    _bvhScenes[i].sortObjects = true; //scene contains transparent objects
                }
                nodes.getBoxArray(i, _bvhScenes[i].bboxes);
            }
        }
    
    };

    this.dtor = function() {
        _RenderBatch = null;
        _frags = null;
        _renderModelLinear = null;
    };

    // note: fragId and mesh are not used in this function
    this.addFragment = function(fragId, mesh) {
    };


    this.reset = function(frustum) {
        _frustum = frustum;
        _bvhHead = 0; _bvhTail = 0;
        // means "unknown containment state"
        _bvhContainment[0] = _bvhContainment[1] = FrustumIntersector.CONTAINMENT_UNKNOWN;
        // prime the pump: the first entry is set to BVH node 0,
        // which is the first node in the first hierarchy (the opaque one) that we'll examine.
        // The ++ here is just for consistency; we could have set tail to 1
        // and used 0 as the index. _bvhTail will immediately get decremented to 0 by nextBatch;
        // it's incremented here to initially pass the while() loop there.
        _bvhNodeQueue[_bvhTail++] = 0;
        _bvhOpaqueDone = false;
        _bvhOpaqueSkipped = false;
        _done = false;
        //_time0 = Date.now();
        if (_resetVisStatus) {	
          let scenes = _bvhScenes;	
          let len = scenes.length;	
          for (let i = 0; i < len; ++i) {	
              var scene = scenes[i];	
              if (scene && scene.resetVisStatus) {	
                  scene.resetVisStatus();	
              }	
          }	
          _resetVisStatus = false;	
      }
    };
    

    // Used to insert nodes into the (sorted) render queue based on
    // a heuristic other than strict front to back or back to front order.
    // Currently we always use this for sorting by screen area.
    function insertNode(idx) {

        //This is basically a single sub-loop of an insertion sort.

        var val = _bvhNodeAreas[idx];
        var j = _bvhTail;

        if (_bvhLIFO) {
            // For LIFO we insert the largest at the end of the list, since they
            // are the first to be popped
            while (j > _bvhHead && _bvhNodeAreas[_bvhNodeQueue[j - 1]] > val) {
                _bvhNodeQueue[j] = _bvhNodeQueue[j - 1];
                j--;
            }
        } else {
            // For FIFO we insert the largest at the front of the list.
            while (j > _bvhHead && _bvhNodeAreas[_bvhNodeQueue[j - 1]] < val) {
                _bvhNodeQueue[j] = _bvhNodeQueue[j - 1];
                j--;
            }
        }

        _bvhNodeQueue[j] = idx;
        _bvhTail++;
    }

    this.nextBatch = function() {

        if (!_bvhOpaqueSkipped && !_bvhOpaqueDone && _bvhHead === _bvhTail) {
            //If we are done with the opaque nodes, queue the transparent ones
            //before processing the contents of the last opaque node
            _bvhNodeQueue[_bvhTail++] = 1; //root of transparent subtree is at index 1
            _bvhOpaqueDone = true;
        }

        // _bvhHead and _bvhTail are indices into the BVH node list. For the opaque objects
        // these start at 0 and 1, respectively. The idea here is to work through the bounding
        // volume hierarchy, with inner nodes sorted into the list by large-to-small screen area
        // (or front-to-back, or back-to-front) order as we go. The way this loop ends is when
        // nothing is on the BVH node stack, or a render batch of stuff to render is found.
        // The next time this method is called, the current _bvhHead and _bvhTail values pick
        // up where they left off, continuing to traverse the tree, until another batch is found
        // or the stack (list) is emptied.
        // Note: this is a breadth-first traversal, but render batches can and do get returned
        // before the whole tree is traversed, because these can be found in inner nodes.
        // This means that there may be nodes with larger screen areas that come later on.
        while(_bvhHead !== _bvhTail) {

            // Retrieve node index for what to process in the BVH. _bvhNodeQueue contains the indices
            // of the node(s) in the BVH that are to be processed. 
            // For LIFO, for example, when the nodeIdx is first retrieved, _bvhTail initially
            // goes to 0, and so grabs the index at location 0 in _bvhNodeQueue, typically the top of
            // the opaque tree. The rest of this loop may add to this queue, and/or return fragments to
            // render, in which case it exits. If nothing got returned (yet) and the loop continues,
            // the next time around through this loop, the last
            // BVH node put on this _bvhNodeQueue stack (if LIFO is true) is retrieved (if not LIFO,
            // the first object on the list is retrieved and _bvhHead is incremented).
            // Inner nodes will add their two children in proper order to _bvhNodeQueue and increment _bvhTail, twice.
            var nodeIdx = (_bvhLIFO || _bvhOpaqueDone) ? _bvhNodeQueue[--_bvhTail] : _bvhNodeQueue[_bvhHead++];

            // Is box already found to be contained? This happens when a box's parent is fully contained.
            // We can then avoid the frustum test.
            var intersects = _bvhContainment[nodeIdx];
            if ( intersects !== FrustumIntersector.CONTAINS ) {
                // could be outside or intersecting, so do test
                _bvhNodes.getBoxThree(nodeIdx, _tmpBox);
                intersects = _frustum.intersectsBox(_tmpBox);
            }

            //Node is entirely outside, go on to the next node
            if (intersects !== FrustumIntersector.OUTSIDE) {
                var child = _bvhNodes.getLeftChild(nodeIdx);
                var isInner = (child !== -1);
                var firstIdx, secondIdx;

                //Is it inner node? Add children for processing.
                if (isInner) {
                    var flags = _bvhNodes.getFlags(nodeIdx);
                    var reverseAxis = _frustum.viewDir[flags & 3] < 0 ? 1 : 0;
                    var firstChild = (flags >> 2) & 1;
                    var transparent = (flags >> 3) & 1;
                    var depthFirst = (_bvhLIFO || _bvhOpaqueDone) ? 1 : 0;
                    var areaFirst = 0, areaSecond = 0;

                    // For opaque objects, use the screen size to sort the two children,
                    // or front to back order (back to front for transparent objects).
                    if (_bvhPrioritizeScreenSize && !_bvhOpaqueDone) {

                        //If traversing based on visible screen area, we have to
                        //compute the area for each child and insert them into
                        //the queue accordingly.

                        firstIdx = child + firstChild;
                        secondIdx = child + 1 - firstChild;

                        _bvhNodes.getBoxThree(firstIdx, _tmpBox);
                        _bvhNodeAreas[firstIdx] = areaFirst = _frustum.projectedBoxArea(_tmpBox, intersects === FrustumIntersector.CONTAINS);
                        _bvhNodes.getBoxThree(secondIdx, _tmpBox);
                        _bvhNodeAreas[secondIdx] = areaSecond = _frustum.projectedBoxArea(_tmpBox, intersects === FrustumIntersector.CONTAINS);

                        // "worst case" containment is recorded for later examination.
                        _bvhContainment[firstIdx] = _bvhContainment[secondIdx] = intersects;

                        // Insert each node in the right place based on screen area,
                        // so that the queue (or stack, if LIFO traversal) is kept sorted
                        // at every step of the way.
                        // Note that with LIFO, for example, the larger object is put last on
                        // the list (a stack), since we want to pop this one off first.
                        if (areaFirst > 0)
                            insertNode(firstIdx);

                        if (areaSecond > 0)
                            insertNode(secondIdx);
                    } else {

                        //Traversal by view direction.

                        //Reverse order if looking in the negative of the child split axis
                        //Reverse order if we are traversing last first
                        //If node contains transparent objects, then reverse the result so we traverse back to front.
                        //In other words, reverse the order if an odd number of flags are true.
                        if (reverseAxis ^ depthFirst ^ transparent)
                            firstChild = 1 - firstChild;

                        firstIdx = child + firstChild;
                        secondIdx = child + 1 - firstChild;

                        _bvhNodeQueue[_bvhTail++] = firstIdx;
                        _bvhNodeAreas[firstIdx] = -1; //TODO: This has to be something based on camera distance
                                                      //so that we can draw transparent back to front when multiple models are mixed

                        _bvhNodeQueue[_bvhTail++] = secondIdx;
                        _bvhNodeAreas[secondIdx] = -1;
                        
                        // "worst case" containment is recorded for later examination.
                        _bvhContainment[firstIdx] = _bvhContainment[secondIdx] = intersects;
                    }

                }

                // Are there graphics in the node? Then return its scene, i.e. its RenderBatch.
                // Inner nodes with children can and do have render batches of their own.
                // This works against a pure screen=area or front-to-back ordering, as
                // these fragments will always get returned first, before further traversal of the tree.
                var prims = _bvhNodes.getPrimCount(nodeIdx);
                if (prims !== 0) {
                    var scene = _bvhScenes[nodeIdx];

                    scene.renderImportance = _frustum.projectedBoxArea(scene.getBoundingBox(), intersects === FrustumIntersector.CONTAINS);

                    //NOTE: Frustum culling for the RenderBatch is done in
                    //RenderBatch.applyVisibility, so we don't need it here.
                    //Just return the batch and it will get cull checked later.
                    //TODO: May be we want to move the check to here, but then the linear iterator will also need to start checking.
                    /*
                     var whichBox = (_drawMode === RenderFlags.RENDER_HIDDEN) ? scene.getBoundingBoxHidden() : scene.getBoundingBox();

                     //If the geometry is attached to an inner node and we know
                     //it's not fully contained, we can narrow down the intersection
                     //by checking the box of just the inner node's geometry.
                     //The check for the node box itself also includes the children so it could be bigger.
                     if (intersects !== CONTAINS && isInner)
                     intersects = _frustum.intersectsBox(whichBox);

                     //Turn off frustum culling for the batch if it's fully contained
                     scene.frustumCulled = (intersects !== FrustumIntersector.CONTAINS);

                     if (intersects !== FrustumIntersector.OUTSIDE)
                     return scene;
                     */

                    return scene;
                }
            }

            if (!_bvhOpaqueDone && !_bvhOpaqueSkipped && _bvhHead === _bvhTail) {
                //If we are done with the opaque nodes, queue the transparent ones
                //before processing the contents of the last opaque node
                _bvhNodeQueue[_bvhTail++] = 1; //root of transparent subtree is at index 1
                _bvhOpaqueDone = true;
            }

        }

        //var time1 = Date.now();
        //var msg = "BVH traversal time: " + (time1 - _time0);
        //console.log(msg);

        _done = true;
        return null;
    };

    this.skipOpaqueShapes = function() {
        if (!_bvhOpaqueDone && !_bvhOpaqueSkipped) {
            // start traversal of transparent hierarchy
            _bvhHead = 0;
            _bvhTail = 0;
            _bvhNodeQueue[_bvhTail++] = 1; //root of transparent subtree is at index 1
            _bvhOpaqueSkipped = true;
        }
    };

    function updateBVHRec(nodeIdx) {

        var child = _bvhNodes.getLeftChild(nodeIdx);

        if (child !== -1) {
            updateBVHRec(child);
            updateBVHRec(child+1);
        }

        _tmpBox.makeEmpty();

        if (child !== -1) {
            _bvhNodes.getBoxThree(child, _tmpBox2);
            _tmpBox.union(_tmpBox2);

            _bvhNodes.getBoxThree(child+1, _tmpBox2);
            _tmpBox.union(_tmpBox2);
        }

        var prims = _bvhNodes.getPrimCount(nodeIdx);
        if (prims) {
            _tmpBox.union(_bvhScenes[nodeIdx].getBoundingBox());
            _tmpBox.union(_bvhScenes[nodeIdx].getBoundingBoxHidden());
        }

        _bvhNodes.setBoxThree(nodeIdx, _tmpBox);
    }
    
    this.getVisibleBounds = function(visibleBounds, visibleBoundsWithHidden) {

        for (var i=0; i<_bvhScenes.length; i++) {

            var s = _bvhScenes[i];

            if (!s)
                continue;

            s.calculateBounds();

            var bb = s.getBoundingBox();
            visibleBounds.union(bb);

            visibleBoundsWithHidden.union(bb);
            visibleBoundsWithHidden.union(s.getBoundingBoxHidden());
        }

        //Also update all bounding volume tree nodes' bounds.
        //If objects move too much this will make the BVH less effective.
        //However, this only happens during explode or animation, so it shouldn't
        //be an issue. We can always rebuild the BVH in case objects really move a lot.
        updateBVHRec(0); //opaque root
        updateBVHRec(1); //transparent root
        
    };
    
    this.rayCast = function(raycaster, intersects, dbIdFilter, options = {}) {

        var nodeStack = [1, 0];
        var pt = new THREE.Vector3();

        while (nodeStack.length) {
            var nodeIdx = nodeStack.pop();

            _bvhNodes.getBoxThree(nodeIdx, _tmpBox);

            // Expand bounding box a bit, to take into account axis aligned lines
            _tmpBox.expandByScalar(0.5);

            if (options.maxDistance && _tmpBox.distanceToPoint(raycaster.ray.origin) > options.maxDistance) {
                continue;
            }
            
            var xPt = raycaster.ray.intersectBox(_tmpBox, pt);

            if (xPt === null)
                continue;

            var child = _bvhNodes.getLeftChild(nodeIdx);
            if (child !== -1) {
                nodeStack.push(child);
                nodeStack.push(child + 1);
            }

            var prims = _bvhNodes.getPrimCount(nodeIdx);
            if (prims !== 0) {
                var scene = _bvhScenes[nodeIdx];
                scene.raycast(raycaster, intersects, dbIdFilter);
            }
        }
 
    };

    this.intersectFrustum = function(frustumIntersector, callback) {

        var nodeStack = [1, FrustumIntersector.CONTAINMENT_UNKNOWN, 0, FrustumIntersector.CONTAINMENT_UNKNOWN];

        while (nodeStack.length) {

            var parentIntersectionState = nodeStack.pop();
            var nodeIdx = nodeStack.pop();

            //Check if current BVH node intersects the frustum. Take into account
            //the intersection state of the parent node, in case we can short-circuit the frustum check
            //when containment is known.
            var result;
            if (parentIntersectionState === FrustumIntersector.CONTAINS) {
                result = FrustumIntersector.CONTAINS;
            } else {
                _bvhNodes.getBoxThree(nodeIdx, _tmpBox);
                result = frustumIntersector.intersectsBox(_tmpBox);
            }

            if (result === FrustumIntersector.OUTSIDE) {
                continue;
            }

            var child = _bvhNodes.getLeftChild(nodeIdx);
            if (child !== -1) {
                nodeStack.push(child);
                nodeStack.push(result);

                nodeStack.push(child + 1);
                nodeStack.push(result);
            }

            var prims = _bvhNodes.getPrimCount(nodeIdx);
            if (prims !== 0) {
                var scene = _bvhScenes[nodeIdx];
                scene && scene.intersectFrustum(frustumIntersector, callback, result === FrustumIntersector.CONTAINS);
            }
        }

    }

/*
    this.getRenderProgress = function() {
        return _renderCounter / _bvhScenes.length;
    };
*/
    this.getSceneCount = function() {
        return _bvhScenes.length;
    };
    
    this.getGeomScenes = function() {
        return _bvhScenes;
    };
    
    this.done = function() {
        return _done;
    };

    this.resetVisStatus = function() {	
        _resetVisStatus = true;	
    };

    this.clone = function () {
        const clone = new ModelIteratorBVH();
        clone.initialize(_renderModelLinear, _bvhNodes, _bvhFragOrder, _options);

        return clone;
    };
}
