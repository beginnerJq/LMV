import * as globals from '../globals';
import { GeometryList } from './GeometryList';
import { FragmentList } from './FragmentList';
import { RenderBatch } from './RenderBatch';
import { consolidateFragmentList } from './consolidation/FragmentListConsolidation';
import { ConsolidationIterator } from './consolidation/ConsolidationIterator';
import { ModelIteratorLinear } from './ModelIteratorLinear';
import { ModelIteratorBVH } from './ModelIteratorBVH';
import { VBIntersector } from './VBIntersector';
import * as THREE from "three";
import { MeshFlags } from "./MeshFlags";
import { RenderFlags } from "./RenderFlags";
import { logger } from "../../logger/Logger";
import {LmvMatrix4} from "./LmvMatrix4";
import {DynamicGlobalOffset} from "../../application/DynamicGlobalOffset";

// TODO: move the logic that decides whether or not to stream somewhere closer to SVF;
// Ideally, RenderModel and GeometryList should be agnostic to the file format.
/*
 * Helper function to determine whether we should enable streamingDraw or upload the whole model to GPU.
 *
 * This function uses values from an SVF package to estimate the expected GPU load. If it is
 * small enough, it returns false. This means that the whole model is uploaded to GPU.
 *
 * If the model size is larger or unknown, we use a heuristic to determine which models are uploaded
 * to GPU and which are rendered from CPU-memory using the (slower) streamingDraw.
 *  @param {number} packFileTotalSize
 *  @param {number} numPrimitives
 *  @param {number} numObjects
 */
function needsStreamingDraw(packFileTotalSize, numPrimitives, numObjects) {
    if (packFileTotalSize) {
        //In pack files, primitive indices use 4 byte integers,
        //while we use 2 byte integers for rendering, so make this
        //correction when estimating GPU usage for geometry
        var estimatedGPUMem = packFileTotalSize - numPrimitives * 3 * 2;

        //If the model is certain to be below a certain size,
        //we will skip the heuristics that upload some meshes to
        //GPU and keep other in system mem, and just push it all to the GPU.
        if (estimatedGPUMem <= globals.GPU_MEMORY_LIMIT && numObjects < globals.GPU_OBJECT_LIMIT) {
            // We don't need streaming draw - model is small enough
            return false;
        }
    }

    return true;
}

var isPointOutsidePlanecuts = (() => {
    const v = new THREE.Vector4();
    return (point, cutplanes) => {
        v.copy(point); // copy already sets w=1 when copying from a Vector3
        for (let i = 0; i < cutplanes.length; i++) {
            if (cutplanes[i].dot(v) > 1e-6) {
                return true;
            }
        }
        
        return false;
    };
})();

// Counter to assign individual numbers to RenderModel in order of their creation
var nextModelId = 1;

/** @class Extends application Model class by functionality for WebGL rendering.
 *         Currently produced by loaders (F2DLoader, SvfLoader)
 *
 *  @constructor
 */
export function RenderModel() {

    // Cached bboxes.
    var _visibleBounds           = new THREE.Box3();    // excluding ghosted once
    var _visibleBoundsWithHidden = new THREE.Box3();    // full bbox
    var _tmpBox                  = new THREE.Box3();    // temp for internal use

    this.visibleBoundsDirty = false; // triggers recomputation of _visibleBounds and _visibleBoundsWithHidden, e.g., if fragment visibility changes.
    this.enforceBvh         = false; // currently ignored, see this.resetIterator()

    var _numHighlighted = 0; // number of currently highlighted fragments.    

    this.id = nextModelId++; // use next free Model id

    var _geoms = null; // {GeometryList} 
    var _frags = null; // {FragmentList}
    
    // Iterators used for scene traversal. 
    var _linearIterator = null;  // {ModelIteratorLinear}, used by default and created in this.initialize()
    var _bvhIterator    = null;  // {ModelIteratorBVH},    used if setBVH() has been called and no new fragments have been added since then.
    var _iterator       = null;  // currently used iterator. points to one of the iterators above
    var _raycastIterator = null; // an optional iterator used for ray intersection tests

    // Only used for consolidated models.
    var _consolidationIterator = null; // {ConsolidationIterator}
    var _consolidationMap      = null; // cached intermediate results of consolidation pre-processing. Enables to quickly rebuild
                                       // _consolidationIterator when we had to temporarily remove it to free memory.

    // Maintained per scene traversal, initialized in ResetIterator()
    var _renderCounter  = 0;                 // number of batches rendered since last resetIterator() call. Used to indicate rendering progress for progressive rendering.
    var _frustum        = null;              // {FrustumIntersector}. Assigned in this.ResetIterator(). Passed to RenderBatches for culling and depth-sorting. 
    var _drawMode       = RenderFlags.RENDER_NORMAL; // drawMode used in this traversal. See Viewer3DImpl.js
    var _bvhOn          = false;             // true when using _bvhiterator in the current traversal. [HB:] Shouldn't this better be local variable in ResetIterator()?

    // Cache for transform matrices
    let _identityMatrix = null;   // {LmvMatrix4}
    let _modelAndPlacementTransform = null;   // {LmvMatrix4}
    let _invModelAndPlacementTransform = null;   // {LmvMatrix4}

    // Dynamic Placement: These settings override the corresponding cameras and matrices in this.getData if placement or globalOffset are modified after loading.
    //                    Only used if dynamic placement or offset changes are actually done. Note that placementTransform and globalOffset in this.getData always
    //                    store the values applied during loading and are not affected by setGlobalOffset() or setPlacementTransform() calls.
    this._placementTransform;   // {LmvMatrix4}
    this._globalOffset;         // {Vector3}

    // Cached inverse of all loader-baked transforms
    this._invPlacementWithOffset;

    // Note: GeometryList or FragmentList are maintained by the RenderModel and should not be modified from outside.
    //       E.g., setting visibility or highlighting flags on FragmentList directly would break some state tracking. (e.g. see this.setVibility or this.setHighlighted)
    //       The only current exception is done by loaders that add geometry to _geoms directly.
    this.getGeometryList = function() { return _geoms; };
    this.getFragmentList = function() { return _frags; };
    this.getModelId = function() { return this.id; };
    this.RenderBatch = RenderBatch;     // This will be used by the model iterators
                                        // to create batches. Limited memory will change it.

    let _doNotCut = false;  // When enabled, cutplanes should not affect the visibility of the model

    this.initialize = function() {
        // alloc GeometryList. Initially empty, but exposed via GetGeometryList().
        // The loaders use this to add LmvGeometryBuffers directly to the GeometryList later.
        // TODO: Make RenderModel agnostic to the SVF file format.
        var svf = this.getData();

        var numObjects = svf.numGeoms || 0;
        var disableStreaming = !needsStreamingDraw(svf.packFileTotalSize, svf.primitiveCount, numObjects);
        _geoms = new GeometryList(numObjects, this.is2d(), disableStreaming, this.isOTG());

        _frags = new FragmentList(this);

        var initialBbox = this.getBoundingBox();
        if (initialBbox) {
            _visibleBounds.copy(initialBbox);
            _visibleBoundsWithHidden.copy(initialBbox);
        }

        _iterator = _linearIterator = new ModelIteratorLinear(this);
    };

    this.getIterator = function() {
        return _iterator;
    };

    /**
     * Initialize from custom iterator. In this case, _geoms and _frags are not used and the 
     * iterator implementation is responsible for producing and maintaining the geometry.
     *
     *  @param {ModelIterator} iterator - iterator.nextBatch may return RenderBatch or THREE.Scene instances.
     *
     * Note: When using a custom iterator, per-fragment visiblity is not supported.
     */
    this.initFromCustomIterator = function(iterator) {
        _iterator = iterator;
        this.visibleBoundsDirty = true; // make sure that bbox is obtained from iterator
    };

    /** 
     *  Deletes all GPU resources.
     *
     *  @param {FireflyWebGLRenderer} glRenderer
     */
    this.dtor = function(glrenderer) {
        _geoms = null;
        
        if (_frags) {
            _frags.dtor(glrenderer);
            _frags = null;
        }
        // Custom iterators may have own GPU resources (see ModelIteratorTexQuad)
        if (_iterator && _iterator.dtor) {
            _iterator.dtor();
            _iterator = null;
        }

        if (_linearIterator) {
            _linearIterator.dtor();
            _linearIterator = null;
        }

        // If this model was consolidated, dispose GPU memory of consolidation as well
        if (_consolidationIterator) {
            _consolidationIterator.dispose();
            _consolidationIterator = null;
        }

        this.dispose();
    };
    

    /** 
     * Activating a fragment means:
     *  - Store geometry in the FragmentList
     *  - Update summed RenderModel boxes
     *  - Add fragment to iterator, so that it is considered in next traversal
     * See FragmentList.setMesh(..) for param details.
     *
     * Note:
     *  - Can only be used with LinearIterator
     */
    this.activateFragment = function(fragId, meshInfo, overrideTransform) {
        if (!_frags) {
            return;
        }

        _frags.setMesh(fragId, meshInfo, overrideTransform);

        //The linear iterator can be updated to add meshes incrementally.
        //The BVH iterator is not mutable, yet.
        _iterator.addFragment(fragId);

        //update the world bbox
        {
            _frags.getWorldBounds(fragId, _tmpBox);
            _visibleBounds.union(_tmpBox);
            _visibleBoundsWithHidden.union(_tmpBox);
        }

    };

    // Used by the Fusion collaboration client
    this.setFragment = function(fragId, mesh, retainMesh) {
    
        if (fragId === undefined)
            fragId = this.getFragmentList().getNextAvailableFragmentId();

        _frags.setMesh(fragId, mesh, true, retainMesh);

        //The linear iterator can be updated to add meshes incrementally.
        //The BVH iterator is not mutable, yet.
        if (_linearIterator)
            _linearIterator.addFragment(fragId);
        if (_bvhIterator && !_frags.fragmentsHaveBeenAdded())
            _bvhIterator.addFragment(fragId);

        //update the world bbox
        {
            _frags.getWorldBounds(fragId, _tmpBox);
            _visibleBounds.union(_tmpBox);
            _visibleBoundsWithHidden.union(_tmpBox);
        }

        return fragId;
    };

    
    /** Replaces the default LinearIterator by a BVH iterator. */
    this.setBVH = function(nodes, primitives, options) {

        // Note that ResetIterator() might still set _iterator back to 
        // the linear one if the BVH one cannot be used.
        _iterator = _bvhIterator = new ModelIteratorBVH();

        _iterator.initialize(this, nodes, primitives, options);

        // By default, the BVH contains boxes "as loaded", i.e. not consdering any model matrix.
        // If a model transform is applied, we have to make sure that the bvh boxes are recomputed.
        if (_frags?.matrix) {
            this.invalidateBBoxes();
        }
    };
    
    /** 
     *  Starts the scene draw traversal, so that nextBatch() will return the first batch to render.
     *   @param: {UnifiedCamera}      camera       - camera.position was needed for the heuristic to choose between linear iterator and BVH.
     *                                               [HB:] The code is currently outcommented, so the param is currently unused.
     *   @param: {FrustumIntersector} frustum      - used by RenderBatches for frustum culling and z-sorting.
     *   @param: {number}             drawMode     - E.g., RENDER_NORMAL. See RenderFlags.js
     */  
    this.resetIterator = function(camera, frustum, drawMode) {
        
        //Decide whether to use the BVH for traversal
        //If we are far out from the scene, use pure big-to-small
        //importance order instead of front to back.
        _bvhOn = false;
        if (_bvhIterator && !_frags.fragmentsHaveBeenAdded()) {
            //TODO: BVH always on when available, because the linear iteration
            //does not respect transparent objects drawing last -- it just
            //draws in the order the fragments come in the SVF package
            _bvhOn = true;
        }

        // Note _linearIterator may also be null if a custom iterator is used.
        // in this case, we must leave _iterator unchanged.
        if (_bvhOn) {
            _iterator = _bvhIterator;
        } else if (_linearIterator) {            
            _iterator = _linearIterator;
        }
        
        _renderCounter = 0;
        _drawMode = drawMode;
        _frustum = frustum;
        _iterator.reset(frustum, camera);

        // notify consolidation iterator that a new traversal has started
        if (_consolidationIterator) {
            _consolidationIterator.reset();
        }
        return _iterator;
    };

    /**
     * Sets a dedicated iterator for ray intersections. This can be useful when models need to be intersected
     * frequently. The default iterator is optimized for rasterization, not ray casting.
     * @param {Iterator} iterator The iterator to use for ray intersections.
     */
    this.setRaycastIterator = function(iterator) {
        _raycastIterator = iterator;
    };

    /** Returns the next RenderBatch for scene rendering travseral. Used in RenderScene.renderSome().
     *   Use this.resetIterator() to start traversal first.
     *
     *   @returns {RenderBatch|null} Next batch to render or null if traversal is finished.
     */
    this.nextBatch = function() {

        // If the next batch of the iterator is fully invisble, we inc it until we 
        // find a relevant batch to render or reach the end.
        while(1) {
            // get next batch from iterator
            var scene = _iterator.nextBatch();

            // update render progress counter
            _renderCounter++;
 
            // stop if iterator reached the end           
            if (!scene)
               return null;

            // replace RenderBatch (= individual fragments) by consolidated scene, if available
            if (_consolidationIterator && (scene instanceof RenderBatch)) {
                scene = _consolidationIterator.consolidateNextBatch(scene, _frustum, _drawMode);
            }

            // Tag all produced scenes with modelId. This is used for cross-fading between models by
            // rendering them to separate targets.
            scene.modelId = this.id;

            if (scene instanceof THREE.Scene) { 
                // The code for fragment visibility and sorting is only defined if scene is a RenderBatch.
                // For the case of THREE.Scene, we are done here, because
                //   - Sorting in THREE.Scene is done by FireFlyRenderer.
                //   - Per-fragment visiblity is not supported in this case
                return scene;
            }

            if (!this.applyVisibility(scene, _drawMode, _frustum))
                return scene;
        }
    };

    /**
     * Set the MESH_RENDERFLAG based on the current render phase
     * while frustum culling the fragments in the scene.
     * @param {RenderBatch} scene The scene to calculate the visibility for
     * @param {number}             drawMode     - E.g., RENDER_NORMAL. See RenderFlags.js
     * @param {FrustumIntersector} frustum      - used by RenderBatches for frustum culling and z-sorting.
     * @return {boolean} True if all fragments in the scene are not visibile. False otherwise.
     */
    this.applyVisibility = function(scene, drawMode, frustum) {
        //TODO: move this into the iterator?
        var allHidden = scene.applyVisibility(
            drawMode, 
            frustum);

        // For 3D scenes, sort fragments of this batch. 
        // Note that fragments of F2D scenes must be drawn in original order.
        //TODO: Move this to the iterator?
        if (!allHidden && !this.is2d()) {
            //Generally opaque batches are sorted once by material, while
            //transparent batches are sorted back to front each frame
            if (scene.sortObjects && !this.getFragmentList().useThreeMesh)
                scene.sortByDepth(frustum);
            else if (!scene.sortDone)
                scene.sortByMaterial();
        }

        return allHidden;
    }

    /**
     * Remove shadow geometry (if exists) from model bounds.
     * 
     * @param {THREE.Box3} bounds 
     */
    this.trimPageShadowGeometry = function(bounds) {
        if (this.hasPageShadow()) {
            const shadowRatio = Autodesk.Viewing.Private.F2dShadowRatio;
            bounds = bounds.clone();

            // If we have pageShadow, we must have page_dimensions & page_width.
            const pageWidth = this.getMetadata('page_dimensions', 'page_width');
            bounds.max.x -= pageWidth * shadowRatio;
            bounds.min.y += pageWidth * shadowRatio;
        }

        return bounds;
    }

    /**
     * @param:  {bool}        includeGhosted
     * @param:  {bool}        excludeShadow - Remove shadow geometry (if exists) from model bounds.
     * @returns {THREE.Box3} 
     *
     * NOTE: The returned box is just a pointer to a member, not a copy!
     */
    this.getVisibleBounds = function(includeGhosted, excludeShadow) {

        if (this.visibleBoundsDirty) {

            _visibleBounds.makeEmpty();
            _visibleBoundsWithHidden.makeEmpty();

            _iterator.getVisibleBounds(_visibleBounds, _visibleBoundsWithHidden, includeGhosted);
            _raycastIterator?.getVisibleBounds(_visibleBounds, _visibleBoundsWithHidden, includeGhosted);


            this.visibleBoundsDirty = false;

        }

        let bounds = includeGhosted ? _visibleBoundsWithHidden : _visibleBounds;

        if (excludeShadow) {
            bounds = this.trimPageShadowGeometry(bounds);
        }

        return bounds;
    };

    this.rayIntersect2D = (() => {
        const plane = new THREE.Plane();
        const pointOnSheet = new THREE.Vector3();

        return (raycaster, dbIds, intersections, getDbIdAtPointFor2D) => {
            // A sheet is assumed to be, when loaded, pointing z-up on 0,0;
            const bbox = this.getBoundingBox(true); // Get original bounding box
            const center = bbox.getCenter(new THREE.Vector3());
            let point = new THREE.Vector3();
            plane.normal.set(0, 0, 1);
            plane.constant = -center.z;

            const tr = this.getModelToViewerTransform();
            if (tr) {
                plane.applyMatrix4(tr);
            }

            point = raycaster.ray.intersectPlane(plane, point);
            if (point) {
                pointOnSheet.copy(point);
                const invTr = this.getInverseModelToViewerTransform();
                if (invTr) {
                    pointOnSheet.applyMatrix4(invTr);
                    pointOnSheet.z = center.z; // Avoid numerical problems
                }
                if (bbox.containsPoint(pointOnSheet)) {
                    const cutplanes = _frags?.getMaterial(0)?.cutplanes; // Get cutplanes from first material
                    if (cutplanes && isPointOutsidePlanecuts(point, cutplanes)) {
                        return;
                    }
                    const distance = raycaster.ray.origin.distanceTo(point);
                    if (distance < raycaster.near || distance > raycaster.far) {
                        return;
                    }

                    let dbId, fragId;
                    if (getDbIdAtPointFor2D) { // This is an optional callback
                        const res = getDbIdAtPointFor2D(point);
                        dbId = res[0];
                        if (dbIds && dbIds.length > 0 && !dbIds.includes(dbId)) { // Filter according to passed array
                            return;
                        }

                        const modelId = res[1]; // modelId is 0 if the idtarget[1] is not used
                        if (modelId !== 0 && modelId !== this.id) {
                            // In the case where another model is in front of this one, the dbId we get here
                            // will be for that model instead, so just ignore this result
                            return;
                        } else {
                            fragId = _frags?.fragments.dbId2fragId[dbId];
                        }
                    }

                    const intersection = {
                        intersectPoint: point, // Backwards compatibility
                        point,
                        distance,
                        dbId: dbId && this.remapDbIdFor2D(dbId),
                        fragId,
                        model: this,
                    };

                    if (intersections) {
                        intersections.push(intersection);
                    }

                    return intersection;
                }
            }
        }
    })();

    /**
     * Performs a raytest and returns an object providing information about the closest hit. 
     * 
     * NOTE: We currently ignore hitpoints of fragments that are visible (MESH_VISIBLE==true) and not highlighted (MESH_HIGHLIGHTED==false). 
     *
     * @param {THREE.RayCaster} raycaster
     * @param {bool}            ignoreTransparent
     * @param {number[]}        [dbIds]             - Array of dbIds. If specified, only fragments with dbIds inside the filter are checked.
     *                                                If the model data has no instanceTree, this is just a whitelist of explicit fragment ids.
     *                                                Note that a hitpoint will also be returned if it's actually occluded by a fragment outside the filter.
     * @param {Array}           [intersections]     - Optional return array with all found intersections.
     * @param {function}        [getDbIdAtPointFor2D] - Optional callback. For 2D models, to return the dbId and modelId in an array.
     * @param {Object}          [options]           - Additional ray intersection options
     * @param {function}        [options.filter]    - Optional filter function (hitResult) => bool. (see VBIntersector for hitresult content)
     *
     * @returns {Object|null}   Intersection result object providing information about closest hit point. Properties:
     *                           - {number}   fragId
     *                           - {Vector3}  point
     *                           - {number}   dbId
     *                           - {model}    model - pointer to this RenderModel
     *                          (created/filled in VBIntersector.js, see for details)
     */
    // Add "meshes" parameter, after we get meshes of the object using id buffer,
    // then we just need to ray intersect this object instead of all objects of the model.
    this.rayIntersect = function(raycaster, ignoreTransparent, dbIds, intersections, getDbIdAtPointFor2D, options) {
        if(this.ignoreRayIntersect) {
            return null;
        }
        
        if (this.is2d()) {
            return this.rayIntersect2D(raycaster, dbIds, intersections, getDbIdAtPointFor2D);
        }
        // make sure that the cached overall bboxes are up-to-date.
        // [HB:] Why are they updated here, but not used in this method?
        if (this.visibleBoundsDirty)
            this.getVisibleBounds();

        // alloc array to collect intersection results
        var intersects = [];
        var i;

        // Restrict search to certain dbIds if specified...
        if (dbIds && dbIds.length > 0) {

            //Collect the mesh fragments for the given database ID node filter.
            var instanceTree = this.getInstanceTree();
            var fragIds = [];
            if (instanceTree) {
                for (i=0; i<dbIds.length; i++) {
                    instanceTree.enumNodeFragments(dbIds[i], function(fragId) {
                        fragIds.push(fragId);
                    }, true);
                }
            } else {
                //No instance tree -- treat dbIds as fragIds
                fragIds = dbIds;
            }

            //If there are multiple fragments it pays to still use
            //the bounding volume hierarchy to do the intersection,
            //because it can cull away entire fragments by bounding box,
            //instead of checking every single fragment triangle by triangle
            if (fragIds.length > 2) { //2 is just an arbitrary value, assuming checking 2 fragments is still cheap than full tree traversal
                let iterator = _raycastIterator || _iterator;
                iterator.rayCast(raycaster, intersects, dbIds);
            } else {
                // The filter restricted the search to a very small number of fragments.
                // => Perform raytest on these fragments directly instead.
                for (i=0; i<fragIds.length; i++) {
                    var mesh = _frags.getVizmesh(fragIds[i]);
                    if (!mesh)
                        continue;
                    var res = VBIntersector.rayCast(mesh, raycaster, intersects, options);
                    if (res) {
                        intersects.push(res);
                    }
                }
            }

        } else {
            // no filter => perform raytest on all fragments
            let iterator = _raycastIterator || _iterator;
            iterator.rayCast(raycaster, intersects, undefined, options);
        }

        // stop here if no hit was found
        if (!intersects.length)
            return null;

        // sort results by distance. 
        intersects.sort(function(a, b) { return a.distance - b.distance; });

        //pick the nearest object that is visible as the selected.
        var allIntersections = !!intersections;
        intersections =  intersections || [] ;

        for (i=0; i<intersects.length; i++) {

            var fragId = intersects[i].fragId;
            var isVisible = this.isFragVisible(fragId); //visible set,

            // [HB:] Since we skip all meshes that are not flagged as visible, shouldn't we 
            //       better exclude them from the raycast in the first place?
            if (isVisible) {

                // skip transparent hits if specified
                var material = _frags.getMaterial(fragId);
                if (ignoreTransparent && material.transparent)
                    continue;

                var intersect = intersects[i];

                // check against cutplanes
                var isCut = false;
                if (material && material.cutplanes) {
                    isCut = isPointOutsidePlanecuts(intersect.point, material.cutplanes);
                }

                if (!isCut) {
                    intersections.push(intersect);
                }

                intersect.model = this;

                if (!allIntersections && intersections.length > 0) {
                    // result is the closest hit that passed all tests => done.
                    break;
                }
            }
        }

        var result = intersections[0] || null;

        if (result) {
            // We might use multiple RenderModels => add this pointer as well.
           result.model = this;
        }

        return result;
    };


    /** Set highlighting flag for a fragment. 
     *   @param   {number} fragId
     *   @param   {bool}   value
     *   @returns {bool}   indicates if flag state changed
     */  
    this.setHighlighted = function(fragId, value) {
        if (!_frags) {
            return false;
        }

        var changed = _frags.setFlagFragment(fragId, MeshFlags.MESH_HIGHLIGHTED, value);

        if (changed) {
            if (value)
                _numHighlighted++;
            else
                _numHighlighted--;
        }

        return changed;
    };

    /** Sets MESH_VISIBLE flag for a fragment (true=visible, false=ghosted) */
    // This function should probably not be called outside VisibityManager
    // in order to maintain node visibility state.
    this.setVisibility = function(fragId, value) {
        if (_frags) {
            _frags.setVisibility(fragId, value);
        } else if (this.isLeaflet()) {
            _iterator.setVisibility(value);
        }

        this.invalidateBBoxes();
    };

    /** Sets MESH_VISIBLE flag for all fragments (true=visible, false=ghosted) */
    this.setAllVisibility = function(value) {
        if (_frags) {
            _frags.setAllVisibility(value);
        } else if (this.isLeaflet()) {
            _iterator.setVisibility(value);
        }

        this.invalidateBBoxes();
    };

    /** Sets the MESH_HIDE flag for all fragments that a flagged as line geometry. 
     *  Note that the MESH_HIDE flag is independent of the MESH_VISIBLE flag (which switches between ghosted and fully visible) 
     *
     *  @param {bool} hide - value to which the MESH_HIDE flag will be set. Note that omitting this param would SHOW the lines, so
     *                       that you should always provide it to avoid confusion.
     */
    this.hideLines = function(hide) {
        if (_frags) {
            _frags.hideLines(hide);
        }
    };

    /** Sets the MESH_HIDE flag for all fragments that a flagged as point geometry. 
     *  Note that the MESH_HIDE flag is independent of the MESH_VISIBLE flag (which switches between ghosted and fully visible) 
     *
     *  @param {bool} hide - value to which the MESH_HIDE flag will be set. Note that omitting this param would SHOW the points, so
     *                       that you should always provide it to avoid confusion.
     */
    this.hidePoints = function(hide) {
        if (_frags) {
            _frags.hidePoints(hide);
        }
    };

    /** Returns if one or more fragments are highlighed. 
     *   returns {bool}
     *
     * Note: This method will only work correctly as long as all highlighting changes are done via this.setHighlighted, not on FragmentList directly.
     */    
    this.hasHighlighted = function() {
        return !!_numHighlighted;
    };

    /** Returns true if a fragment is tagged as MESH_VISIBLE and not as MESH_HIGHLIGHTED. */
    // 
    // [HB:] It's seems a bit unintuitive that the MESH_HIGHLIGHTED flag is checked here, but not considered by the other visibility-related methods.
    //       For instance, consider the following scenarioes:
    //        - After calling setVibility(frag, true), isFragVisible(frag) will still return false if frag was highlighed.
    //        - If areAllVisible() returns true, there may still be fragments for which isFragVisible(frag) returns false.
    this.isFragVisible = function(frag) {
        return _frags.isFragVisible(frag);
    };

    /** Returns true if MESH_VISIBLE flag is set for all fragments. */
    this.areAllVisible = function() {

        // When using a custom iterator, we don't have per-fragment visibility control. 
        // We assume constantly true in this case.
        if (!_frags) {
            return true;
        }

        return _frags.areAllVisible();
    };

    /** Direct access to all RenderBatches. Used by ground shadows and ground reflection.
      * @returns {RenderBatch[]}
      */ 
    this.getGeomScenes = function() {
        if (!_iterator || !_iterator.getGeomScenes) {
            return []; // Leaflet doesn't have geomScenes
        }

        return _iterator.getGeomScenes();
    };

    /** Get progress of current rendering traversal.
      *  @returns {number} in [0,1]
      */
    this.getRenderProgress = function() {
        var progress = _renderCounter / _iterator.getSceneCount();
        // the renderCounter can become > scene count.
        return ( progress > 1.0 ) ? 1.0 : progress;
    };

    /**
     *  @params  {number} timeStamp
     *  @returns {bool}   true if the model needs a redraw
     */
    this.update = function(timeStamp) {
        // if there is an iterator that implements update method...
        if (_iterator && _iterator.update) {
            return _iterator.update(timeStamp);
        }
        // assume constant scene otherwise
        return false;
    };


    /** Highlight an object with a theming color that is blended with the original object's material.
     *   @param {number}        dbId
     *   @param {THREE.Vector4} themingColor (r, g, b, intensity), all in [0,1]
     *   @param {boolean} [recursive] - Should apply theming color recursively to all child nodes.
     */
    this.setThemingColor = function(dbId, color, recursive) {
        if (_frags) {
            // When using 2d with Otg db, we need to remap, because the vertex-buffers still contain otg.
            dbId = this.reverseMapDbIdFor2D(dbId);

            var it = this.getInstanceTree();
            if (recursive && it) {
                it.enumNodeChildren(dbId, function(childDbId) {
                    _frags.setThemingColor(childDbId, color);
                }, true);
            } else {
                _frags.setThemingColor(dbId, color);
            }
        } else if (_iterator.isModelIteratorTexQuad) {
            // dbId is ignored in this case, as well as intensity. Apply theming to whole model
            _iterator.setThemingColor(color);
        } else {
            logger.warn("Theming colors are not supported by this model type.");
        }
    };

    /** Revert all theming colors.
     */
    this.clearThemingColors = function() {
        if (_frags) {
            _frags.clearThemingColors();
        } else if (_iterator.isModelIteratorTexQuad) {
            _iterator.clearThemingColor();

        }
    };

    /** Access to leaflet-specific functionality. Returns null if RenderModel is no leaflet. */
    this.getLeaflet = function() {
        if (_iterator.isModelIteratorTexQuad) {
            return _iterator;
        }
        return null;
    };

    /**
     * This function creates an internal copy of the FragmentList that is consolidated to reduce the
     * shape count as far as possible. This takes more memory, but may strongly accelerate rendering
     * for models with many small shapes.
     *
     * NOTE: For making consolidation effective, it should ideally be activated via the load options already.
     *       This will automatically adjust the depth of the spatial hierarchy. Without that, the scene traversal
     *       may still be slow and the performance gain much smaller.
     *
     * @param {MaterialManager} materials
     * @param {number}          [byteLimit = 100 << 20] - Merging geometries is the most efficient technique in terms
     *                                                    of rendering performance. But, it can strongly increase
     *                                                    the memory consumption, particularly because merged
     *                                                    geometry cannot be shared, i.e. multiple instances of
     *                                                    a single geometry must be replicated per instance for merging.
     *                                                    Therefore, the memory spent for merging is restricted.
     *                                                    A higher value may make rendering faster, but increases (also GPU) memory
     *                                                    workload.
     * @param {boolean}         [multithreaded]         - Optional: If true, a part of the work is delegated to a worker thread.
     *                                                    This function will return faster, but the consolidation is marked as not usable
     *                                                    (see Consolidation.inProgress) until all worker results are returned.
     *
     * @param {FireFlyWebGLRenderer} glRenderer
     */
    this.consolidate = function(materials, byteLimit, glRenderer) {

        // consolidate fragment list
        var consolidation = consolidateFragmentList(this, materials, byteLimit, glRenderer, _consolidationMap);

        // make BVHIterator use the consolidation when possible
        _consolidationIterator = new ConsolidationIterator(_frags, consolidation);

        // cache some intermediate results. Consolidations are memory-intensive, so it can be necessary to temporarily
        // remove them to free memory. By caching intermediate results, we can rebuild them faster.
        _consolidationMap = consolidation.consolidationMap;
    };

	/**
	 * Removes consolidation to free memory. Just some compact intermediate results are cached, so that the
     * consolidation can be rebuilt quickly.
     */
    this.unconsolidate = function() {
        if (!_consolidationIterator) {
            return;
        }

        _consolidationIterator.dispose();
        _consolidationIterator = null;
    };

    this.isConsolidated = function() {
        return !!_consolidationIterator;
    };

    this.getConsolidation = function() {
        return _consolidationIterator ? _consolidationIterator.getConsolidation() : null;
    };

    // Store mapping of F2D/PDF/SVF dbids to OTG property database v2 dbids
    this.setDbIdRemap = function(dbidOldToNew) {
            this.idRemap = dbidOldToNew;
    };

    // Map old SVF dbId to actual dbId as used
    //by v2/OTG property databases.
    this.remapDbId = function(dbId) {
        if (this.idRemap && dbId > 0 && dbId < this.idRemap.length)
            return this.idRemap[dbId];

        return dbId;
    };

    //F2D only -- maps ID stored in F2D vertex buffers to actual dbId as used
    //by v2/OTG property databases.
    this.remapDbIdFor2D = function(dbId) {
        if (this.is2d()) return this.remapDbId(dbId);

        return dbId;
    };

    this.reverseMapDbId = function(dbId) {
        if (!this.idRemap || dbId <=0)
            return dbId;

        if (!this.reverseMap) {
            this.reverseMap = {};
            for (var i=0; i<this.idRemap.length; i++)
                this.reverseMap[this.idRemap[i]] = i;
        }

        return this.reverseMap[dbId];
    };

    this.reverseMapDbIdFor2D = function(dbId) {
        if (this.is2d()) return this.reverseMapDbId(dbId);

        return dbId;
    };


    /**
     * This function is only needed if...
     *
     *   1. You want to draw a fragment to an overlay scene that overdraws the original fragment, and
     *   2. Consolidation is used for this model.
     *
     *  To avoid flickering artifacts, the geometry used for the overlay scene must exactly match with the
     *  one used for the main scene rendering. However, when consolidation is used, this geometry may vary
     *  and (slightly) differ from the original fragment geometry.
     *
     *  This function updates the given render proxy to make it exactly match with the geometry used for the
     *  the last main scene rendering. This involves to replace geometry, material, and matrix when necessary.
     *
     *  NOTE: An updated proxy can exclusively be used for rendering. Do not use this function if you want to
     *        access any vertex data directly.
     *
     *   @param {THREE.Mesh} proxy  - currently used proxy mesh to represent the fragment
     *   @param {Number}     fragId - fragment represented by this proxy */
    this.updateRenderProxy = function(proxy, fragId) {

        if (!_consolidationIterator) {
            // nothing to do - rendering will always use the original geometry anyway.
            return;
        }

        // fragment might be consolidated.
        _consolidationIterator.updateRenderProxy(proxy, fragId);
    };

    this.skipOpaqueShapes = function() {
        if (_iterator && _iterator.skipOpaqueShapes) {
            _iterator.skipOpaqueShapes();
        }
    };

    // Call this whenever you modifed shapes, e.g., by setting/changing an animation transform.
    // This makes sure that all hierarchical bboxes are updated.
    // Without this, shapes may incorrectly classified as invisble, so that they may disappear or are missed by selection.
    this.invalidateBBoxes = function() {
        this.visibleBoundsDirty = true;
    };

    /**
     * Change the paper visibility for a 2D sheet
     */
    this.changePaperVisibility = function(show) {
        if (this.is2d()) {
            _frags?.setObject2DVisible(-1, show);
        }
    };

    this.hasPaperTransparency = function() {
        if (!this.is2d()) {
            return false;
        }

        const paperOpacity = _frags?.dbIdOpacity[-1] ?? 1;

        return paperOpacity > 0 && paperOpacity < 1;
    };


    // Set a new model transform.
    //  @param {THREE.Matrix4} [matrix] - If null, model matrix is cleared.
    this.setModelTransform = function(matrix) {
        if (_iterator.isModelIteratorTexQuad) { // Leaflet
            _iterator.setModelMatrix(matrix);
        } else {
            _frags.setModelMatrix(matrix);
            _consolidationIterator && _consolidationIterator.modelMatrixChanged();
        }
        // Recompute all bboxes
        this.invalidateBBoxes();
        this.getVisibleBounds(true);
        _modelAndPlacementTransform = null;
        _invModelAndPlacementTransform = null;
    };

    this.getModelTransform = function() {
        if (_iterator?.isModelIteratorTexQuad) { // Leaflet
            return _iterator.getModelMatrix();
        }

        return _frags?.matrix;
    };

    this.getInverseModelTransform = function() {
        if (_iterator?.isModelIteratorTexQuad) { // Leaflet
            return _iterator.getInverseModelMatrix();
        }

        return _frags?.getInverseModelMatrix();
    };

    /*
     * Returns current placementTransform. By default, this is the placementMatrix applied at load time,
     * but may be overriden if resetPlacement was called after loading.
     * Returned value must not be modified from outside.
     */
    this.getPlacementTransform = function() {
        _identityMatrix = _identityMatrix || new LmvMatrix4(true);
        return this._placementTransform || this.getData().placementTransform || _identityMatrix;
    };

    /*
     * Returns the globalOffset applied to the model. This may be the one applied at load time or
     * a dynamic globalOffset applied afterwards.
     *  @returns {Vector3}
     */
    this.getGlobalOffset = function() {
        return this._globalOffset || this.getData().globalOffset;
    };

    /**
     * Change the placement matrix of the model. This overrides the placement transform applied at loadTime.
     *  @param {LmvMatrix4} matrix         - Note that you need 64-Bit precision for large values.
     *  @param {Vector3}    [globalOffset] - Optionally, the globalOffset can be reset in the same step.
     */
    this.setPlacementTransform = function(matrix) {

        // Create/Set override placementTransform
        this._placementTransform = (this._placementTransform || new LmvMatrix4(true)).copy(matrix);

        // Update dynamic model matrix based on current placementMatrix and globalOffset
        DynamicGlobalOffset.updateModelMatrix(this, matrix, this.getGlobalOffset());
    };

    /**
     * Change globalOffset that is applied to transform this model from global to viewer coordinates.
     */
    this.setGlobalOffset = function(newOffset) {
        this._globalOffset = this._globalOffset || new THREE.Vector3();
        this._globalOffset.copy(newOffset);

        // Update dynamic model matrix based on current placementMatrix and globalOffset
        var pt = this.getPlacementTransform();
        DynamicGlobalOffset.updateModelMatrix(this, pt, newOffset);
    };

    /**
     * Returns the model transform combined with placementWithOffset.
     * It converts the source model coordinate system to viewer coordinates
     * (the coordinates used for rendering, also including subtracted globalOffset)
     * @returns {THREE.Matrix4|null}
     */
    this.getModelToViewerTransform = function() {
        if (_modelAndPlacementTransform) { // Return cached value if available
            return _modelAndPlacementTransform;
        }

        const modelTransform = this.getModelTransform();
        const placementWithOffset = this.getData()?.placementWithOffset;

        if (modelTransform || placementWithOffset) {
            _modelAndPlacementTransform = new THREE.Matrix4();

            if (modelTransform) {
                _modelAndPlacementTransform.multiply(modelTransform);
            }
            if (placementWithOffset) {
                _modelAndPlacementTransform.multiply(placementWithOffset);
            }
        }

        return _modelAndPlacementTransform;
    };

    /**
     * Returns the inverse of the model transform combined with placementWithOffset.
     * @returns {THREE.Matrix4|null}
     */
    this.getInverseModelToViewerTransform = function() {
        if (_invModelAndPlacementTransform) { // Return cached value if available
            return _invModelAndPlacementTransform;
        }

        const tr = this.getModelToViewerTransform();
        if (tr) {
            _invModelAndPlacementTransform = tr.clone().invert();
        }

        return _invModelAndPlacementTransform;
    };

    /**
     * Returns the inverse of placementWithOffset. Left-multiplying with this transform inverts
     * all transforms that are 'baked' into the mesh transforms by the loader. This excludes the dynamic model transform.
     * May return null if placementWithOffset is null as well.
     */
    this.getInversePlacementWithOffset = function() {
        if (!this.myData.placementWithOffset) {
            return null;
        }

        if (!this._invPlacementWithOffset) {
            this._invPlacementWithOffset = new LmvMatrix4(true).copy(this.myData.placementWithOffset).invert();
        }
        return this._invPlacementWithOffset;
    };

    // Overrides inner state of RenderModel.
    this.setInnerAttributes = function(attributes) {
        this.id = attributes._id;
        _visibleBounds = attributes._visibleBounds;
        _visibleBoundsWithHidden = attributes._visibleBoundsWithHidden;
        _tmpBox = attributes._tmpBox;
        this.enforceBvh = attributes._enforceBvh;
        _numHighlighted = attributes._numHighlighted;
        _geoms = attributes._geoms;
        _frags = attributes._frags;
        _consolidationIterator = attributes._consolidationIterator;
        _consolidationMap = attributes._consolidationMap;
        _renderCounter = attributes._renderCounter;
        _frustum = attributes._frustum;
        _drawMode = attributes._drawMode;
        _bvhOn = attributes._bvhOn;
        this.idRemap = attributes._idRemap;
        this._reverseMap = attributes._reverseMap;

        // Deep copy linearIterator if it's not initialized yet.
        if (!_linearIterator && attributes._linearIterator) {
            _linearIterator = attributes._linearIterator.clone();

            // Update current iterator pointer only if this is the current iterator on source model.
            if (attributes._linearIterator === attributes._iterator) {
                _iterator = _linearIterator;
            }
        }

        // Deep copy bvhIterator if it's not initialized yet.
        if (!_bvhIterator && attributes._bvhIterator) {
            _bvhIterator = attributes._bvhIterator.clone();

            // Update current iterator pointer only if this is the current iterator on source model.
            if (attributes._bvhIterator === attributes._iterator) {
                _iterator = _bvhIterator;
            }
        }

        // If both linearIterator & bvhIterator aren't available, it means that we used a custom iterator.
        // For example, ModelIteratorTexQuad. In this case, try cloning it if is has a clone method.
        // Otherwise, shallow copy is good enough.
        if (!_iterator) {
            _iterator = attributes._iterator?.clone ? attributes._iterator.clone() : attributes._iterator;
        }
    };

    // Get inner state of RenderModel.
    this.getInnerAttributes = function() {
        return {
            _id: this.id,
            _visibleBounds,
            _visibleBoundsWithHidden,
            _tmpBox,
            _enforceBvh: this.enforceBvh,
            _numHighlighted,
            _geoms,
            _frags,
            _linearIterator,
            _bvhIterator,
            _iterator,
            _consolidationIterator,
            _consolidationMap,
            _renderCounter,
            _frustum,
            _drawMode,
            _bvhOn,
            _idRemap: this.idRemap,
            _reverseMap: this.reverseMap,
        };
    };

    /**
     * Changes whether cutplanes should affect the visibility of the model.
     * Works only for 2D models (in OTG the materials are shared).
     * @param {MaterialManager} materialsManager
     * @param {boolean}         doNotCut
     */
    this.setDoNotCut = function(materialsManager, doNotCut) {
        if (_doNotCut === doNotCut) {
            return;
        }

        _doNotCut = doNotCut;
        if (_frags) {
            _frags.setDoNotCut(doNotCut);
        } else if (this.isLeaflet()) {
            _iterator.setDoNotCut(doNotCut);
        }

        const cb = material => {
            material.doNotCut = doNotCut;
            const updateNeeded = (material.cutplanes?.length > 0) === doNotCut;
            if (updateNeeded) {
                materialsManager._applyCutPlanes(material);
                material.needsUpdate = true;
            }
        };

        materialsManager.forEachInModel(this, false, cb);
    };

    this.getDoNotCut = function() {
        return _doNotCut;
    };

    /**
     * Sets the viewport bounds for a model, effectively cropping it. Relevant for sheets.
     * @param {MaterialManager} materialsManager 
     * @param {THREE.Box3|THREE.Box2|null} bounds - passing null resets the viewport
     */
    this.setViewportBounds = function (materialsManager, bounds) {
        if (this.isLeaflet()) {
            _iterator.setViewBounds(bounds);
        } else if (_frags) {
            // For PDFs, there's always a viewport bounds which is the original bounding box (see LmvCanvasContext)
            bounds = bounds || (this.isPdf() && this.getBoundingBox(true, true));

            // Set bounds in fragment list to update visibility bounds
            _frags.setViewBounds(bounds);

            // Set in materials since actual cropping is done in the shader
            materialsManager.setViewportBoundsForModel(this, bounds);
        }

        this.invalidateBBoxes();
    };

    this.getViewportBounds = function () {
        return this.isLeaflet() ? _iterator.getViewBounds() : _frags?.getViewBounds();
    };
}
