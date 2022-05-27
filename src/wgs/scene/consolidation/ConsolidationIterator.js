import { mergeGeometries } from './Consolidation';
import { InstanceBufferBuilder } from './InstanceBufferBuilder';
import * as THREE from "three";
import { MeshFlags } from "../MeshFlags";
import { logger } from "../../../logger/Logger";


/**
 *  ConsolidationIterator is used by by RenderModel to replace groups of fragments by consolidated meshes whenever possible.
 *
 *  Note that it is not a ModelIterator - just a helper to iterate over the consolidation in parallel to replace the
 *  results of ModelIterators.
 *
 * Why is it needed?
 * -----------------
 *
 * A consolidated fragment list can strongly accelerate rendering for some models by reducing the per-shape work of the
 * WebGLRenderer.
 *
 * However, just putting the consolidated meshes into a scene and rendering it would introduce several problems:
 *  1. Progressive rendering would not work anymore.
 *  2. We could not use the BVH for hierarchical visibility culling anymore.
 *  3. All individual stuff (setFragOff, ghosting, theming) would stop working.
 *
 * These problems are addressed by ConsolidationIterator.
 *
 * How does it work?
 * -----------------
 *
 * There is no perfect solution for the problems above. E.g., progressive rendering with a fine-grained BVH would require
 * to permanently vary the shape order - which would completely revert the performance benefit of consolidation.
 * Therefore, the goal is to achieve a balanced trade-off between a) consolidating as much as possible and b) keeping
 * the advantages of the BVH traversal that is used normally.
 *
 * For this, the BVHIterator traverses the scene as usual. The normal behavior is to return a RenderBatch with
 * individual fragments on each nextBatch call. When using consolidation, we replace each such RenderBatch
 * by a THREE scene in a way that:
 *
 *  - For each fragment f that has not been rendered yet, it contains the consolidated mesh containing f
 *  - It is ensured that each consolidated batch is only used once in a traversal.
 *
 * Note that this means that we have a bit less granularity, i.e., some fragments will be rendered that would be
 * culled otherwise, and progressive rendering will render some fragments earlier than normally. However,
 * this is a necessary trade-off as explained above.
 *
 * What about hiding/ghosting/theming?
 * ------------------------------------
 *
 * Another purpose of this class is to keep per-fragment hiding/ghosting/theming working when using a consolidated FragmentList.
 * At the moment, we use a very simple fallback for this: Whenever a fragment needs any special treatment
 * (e.g., is ghosted), we temporarily disable consolidated meshes and fall back to individual fragments.
 *
 * Limitation: An obvious drawback of this straightforward solution is that consolidation only improves the
 * rendering speed as long as no fragment needs special treatment. As soon as any ghosting/hiding/theming is used,
 * we fall back to original speed.
 *
 * Supporting consolidation and individual fragment modification at once will require some extra work.
 *
 *
 * @constructor
 *  @param {FragmentList}  fragList          - Original fragment list
 *  @param {Consolidation} fragConsolidation - Consolidated representation of a full FragmentList
 */
export function ConsolidationIterator(fragList, fragConsolidation) {

    // FragmentList
    var _frags = fragList;

    // Consolidated fragment list
    var _fragConsolidation = fragConsolidation;

    // {Bool[]} Used to track which consolidated shapes have been rendered in the current traversal.
    var _shapeDone = [];

    // If true, we must use original fragments in the current traversal. This flag is determined at the beginning
    // of a traversal and is set whenever a fragment needs special treatment (ghosting/hiding etc.).
    var _consolidationDisabled  = false;

    // Each scene replaces a RenderBatch that represents a node in the BVH hierarchy.
    // The RenderBatch of a BVHNode is always the same object. This allows RenderScene to track
    // average fragment times by attaching the avgFrameTime to each object.
    // To keep this working when replacing RenderBatches by THREE.Scenes, the THREE.Scene object of a BVHNode
    // must also keep the same object per bvh node. Therefore, we index the cache by bvhNode index.
    var _sceneCache         = []; // {THREE.Scene[]} Reused per traversal

    var _specialHandling = []; // Bool[] to mark meshes that need special handling

    // some reused temp objects
    var _tempMatrix = new THREE.Matrix4();
    var _tempBox    = new THREE.Box3();

    // Apply optional model matrix. Note:
    //  - We assume here that the consolidation was computed using the original fragment matrices without considering a model transform.
    //  - We cannot set the modelTransform on the meshes themselves: Reason is that single-fragment meshes still have the transform of the original fragment
    function applyModelMatrix(scene) {
        const modelMatrix = _frags.matrix;
        if (modelMatrix) {
            scene.matrixWorld.copy(modelMatrix);
            scene.matrixAutoUpdate = false; // Avoid worldMatrix from being recomputed by THREE based on pos/rotation/scale
        } else {
            scene.matrixWorld.identity();
        }
    }

    // get next scene from cache
    function acquireScene(index) {
        // create new scee on first use
        if (!_sceneCache[index]) {
            _sceneCache[index] = new THREE.Scene();

            // Make sure that current model matrix is applied to each scene
            applyModelMatrix(_sceneCache[index]);
        }
        var scene = _sceneCache[index];
        scene.children.length = 0;
        return scene;
    }

    // Make sure mesh worldMatrix is updated on next frame.
    //
    // Why needed:
    //   This is essential for any meshes that only have one fragment: For these, mesh.matrix stores the initial
    //   fragment matrix. Therefore, matrixAutoUpdate is set to false, so that mesh.matrix is not recomputed/overwritten by THREE.js.
    //
    //   However, this also avoids the automatic recomputation of mesh.matrixWorld.
    //
    //   This function ensures that all mesh world-matrices are updated on first render and whenever the model transform changes.
    function worldMatricesDirty() {

        const meshes = _fragConsolidation.meshes;
        for (let i=0; i<meshes.length; i++) {
            meshes[i].matrixWorldNeedsUpdate = true;
        }
    }

    // ensure up-to-date world-matrices on first render
    worldMatricesDirty();

    this.modelMatrixChanged = function() {

        // Set scene matrices
        for (let i=0; i<_sceneCache.length; i++) {
            // Note that _sceneCache may contain null elements, because elements are indexed by BVH nodeIdx 
            const scene = _sceneCache[i];
            if (scene) {
                applyModelMatrix(scene);
            }
        }

        worldMatricesDirty();
    };

    this.getConsolidation = function() {
        return _fragConsolidation;
    };

    /**
     * Called at the beginning of a scene traversal.
     */
    this.reset = function() {

        // reset state to "not used yet" for all consolidated meshes
        _shapeDone.length = null;
        _specialHandling.length = 0;

        var fragCount = _frags.getCount();
        var moved = MeshFlags.MESH_MOVED;
        var flagsOK = MeshFlags.MESH_VISIBLE;
        var flagsMask = flagsOK | MeshFlags.MESH_HIDE | MeshFlags.MESH_HIGHLIGHTED;
        var vizflags = _frags.vizflags;

        var fragId2MeshIndex = _fragConsolidation.fragId2MeshIndex;
        var meshes = _fragConsolidation.meshes;

        _consolidationDisabled = false;
        var themingActive = _frags.db2ThemingColor.length > 0;
        for (var fragId=0; fragId<fragCount; fragId++) {

            var flags     = vizflags[fragId];
            if (flags & moved) {
                _consolidationDisabled = true;
                break;
            }

            // consider color theming
            var themingColor;
            if (themingActive) {
                var dbId = _frags.fragments.fragId2dbId[fragId];
                themingColor = _frags.db2ThemingColor[dbId];
            }

            var index = fragId2MeshIndex[fragId];
            _specialHandling[index] = _specialHandling[index] || !!(themingColor || ((flags & flagsMask) ^ flagsOK));
        }
    };

    this.dispose = function() {

        var DISPOSE_EVENT = {type: 'dispose'};
        var REMOVED_EVENT = {type: 'removed'};

        for (var i=0; i<_fragConsolidation.meshes.length; i++) {
            var mesh = _fragConsolidation.meshes[i];
            var geom = mesh.geometry;
            if (geom) {
                //Both of these are needed -- see also how it's done in FragmentList dispose
                mesh.dispatchEvent(REMOVED_EVENT);
                geom.dispatchEvent(DISPOSE_EVENT);

                // In case of later reuse, setting needsUpdate is essential to render it again.
                geom.needsUpdate = true;
            }
        }

        // Note that all consolidation materials are associated with the owning RenderModel and
        // are automatically disposed with the other RenderModel resources.
        // Therefore, we don't dispose them here.
    };

    /**
     * Given a RenderBatch that would normally be rendered next, this function
     * creates a consolidated scene to replace it in a way that:
     *
     *  1. Each fragment f in the batch is included (unless it has already been rendered in this traveral)
     *  2. During traversal, each consolidated mesh is only used once.
     *
     *  @param   {RenderBatch}          renderBatch
     *  @param   {FrustumInstersector}  frustum
     *  @param   {number}               drawMode
     *  @returns {THREE.Scene|RenderBatch} If fragments must be rendered individually, the input RenderBatch
     *           is returned. This happens, e.g., if one or more fragments is ghosted.
     */
    this.consolidateNextBatch = function(renderBatch, frustum, drawMode) {

        // get bvh node index associated with this RenderBatch. We need this to make sure that
        // a RenderBatch is always replaced by the same THREE.Scene object.
        var nodeIndex = renderBatch.nodeIndex;

        // Fallback: Just use original fragments to make sure that ghosting/hiding/theming keeps working.
        if (_consolidationDisabled || nodeIndex === undefined) {
            return renderBatch;
        }

        // If we used multithreaded consolidation, we must use standard geometry until precomputation is finished.
        if (_fragConsolidation.inProgress) {
            return renderBatch;
        }

        var scene = acquireScene(nodeIndex);

        // For each fragment: Find the consolidated shape that contains it and add it to the scene.
        for (var i=renderBatch.start; i<renderBatch.lastItem; i++) {

            var fragId = renderBatch.indices ? renderBatch.indices[i] : i;

            // find consolidated shape containing this fragment
            var meshIndex = _fragConsolidation.fragId2MeshIndex[fragId];
            var mesh      = null;

            if (meshIndex === -1) {

                // If the original geometry was missing already, just skip the fragment
                if (!_frags.getGeometry(fragId)) {
                    continue;
                }

                // By design, a FragmentList consolidation must always have replacements for
                // each fragment. So, something must have failed here.
                // Note that we cannot simply add single meshes by _frags.getVisMesh(),
                // because getVizMesh() always return the same (reused) object.
                logger.warn("Warning: Missing fragment in consolidation. Consolidation disabled.");
                return renderBatch;
            }

            // Skip consolidated shape if it has already been used in this traversal.
            if (_shapeDone[meshIndex]) {
                continue;
            }

            // Apply frustum culling. Some related considerations:
            //
            //  1. Instead of culling per container mesh, we apply culling based on original fragments.
            //     Advantages:
            //      - Since merged fragments may be arbitrarily distributed, the culling granularity
            //        of original fragments is significantly higher.
            //      - When using progressive rendering, the per-fragment culling avoids that we
            //        are rendering containers too early if only distant fragments of them are visible.
            //
            //  2. Simply using RenderBatch.applyVisibility() on the original batch caused some noticable
            //     frame rate hickups for some test models (e.g. NWD with ~284K fragments). Also because the
            //     BVH cannot be too fine-grained when using consolidation.
            //
            //     The advantage of doing it here is: As soon as a single fragment of a consolidated mesh
            //     passes the frustum test, the frustum check is skipped for all other contained fragments.
            _frags.getWorldBounds(fragId, _tempBox);
            if (!frustum.intersectsBox(_tempBox)) {
                continue;
            }

            // mark container mesh as used so that we don't render it again in this traversal
            _shapeDone[meshIndex] = true;

            // use this consolidated mesh
            mesh = _fragConsolidation.applyAttributes(meshIndex, _frags, drawMode, _specialHandling[meshIndex]);
            if (!mesh.visible) {
                // If mesh is not visible, then skip it.
                continue;
            }

            // Check if this mesh contains a primitive type that is currently switched off
            var geom = mesh && mesh.geometry;
            var isLines  = geom && (geom.isLines || geom.isWideLines);
            var isPoints = geom && geom.isPoints;
            var isHiddenPrimitive = (_frags.linesHidden && isLines) || (_frags.pointsHidden && isPoints);
            if (isHiddenPrimitive) {
                continue;
            }

            // add container. 
            // Note that we must use .add here instead of children.push. Otherwise, mesh.parent is not set
            // and mesh wouldn't inherit the model matrix from the parent scene.
            scene.add(mesh);
        }

        // use original bbox, renderImportance, and camera distance. Note that the consolidation may actually have another bbox,
        // because it doesn't contain exactly the same fragments. However, recomputing it would
        // just inappropriately distort priorities, because it may contain instances far outside
        // the current bvh node.
        //scene here is a THREE.Scene which has no boundingBox by default and we have to create it
        if (!scene.boundingBox) {
            scene.boundingBox = new THREE.Box3();
        }

        // Note: The model matrix is included in the renderBatch bbox already. It is not affected by the scene.matrix.
        renderBatch.getBoundingBox(scene.boundingBox);

        scene.renderImportance = renderBatch.renderImportance;

        // adopt sortObjects flag from original RenderBatch - so that RenderScene can use it to detect which
        // scenes contain transparency.
        scene.sortObjects = renderBatch.sortObjects;

        return scene;
    };

    // enum to describe in which way a fragment has been rendered.
    var ConsolidationType = {

        Merged:    1, // Fragment is represented by a merged geometry composed from different fragment geometries.
        Instanced: 2, // Fragment is represented by an instanced shape that represents multiple fragments that
                      // are sharing the same geometry.
        Original:  3  // Fragment was not combined with others and is still sharing the original fragment's geometry
                      // and material.
    };

    /**
     *  Checks if a given geometry is instanced, the result of merging, or original fragment geometry.
     *
     *   @param {THREE.Mesh} currently used render proxy
     *   @param {Number}     fragId represented by this proxy
     **/
    function getConsolidationType(geom) {
        if (geom.numInstances) {
            // This geom combines multiple fragments using instancing
            // Note that we also enter this section if numInstances==1. This is correct, because numInstances
            // is always undef if no instance buffer is used.
            return ConsolidationType.Instanced;
        } else if (geom.attributes.id) {
            // When merging fragments, we always use per-vertex ids.
            return ConsolidationType.Merged;
        }
        return ConsolidationType.Original;
    }

    /**
     *   Checks which type of consolidation has been used to represent a given fragment in the last
     *  rendering traversal.
     *
     *   @returns {ConsolidationType}
     */
    function getFragmentConsolidationType(fragId) {

        // Check if consolidation was used for this fragment in last frame.
        if (_consolidationDisabled) {
            // The container was not used last frame. The fragment was rendered with original geometry.
            return ConsolidationType.Original;
        }

        // Find consolidated mesh that contains fragId.
        var meshIndex = _fragConsolidation.fragId2MeshIndex[fragId];

        // This fragment was represented using a container mesh from the consolidated scene.
        // If this mesh was created by instancing or merging, it is tagged with a consolidation type.
        var container = _fragConsolidation.meshes[meshIndex];
        var geom      = container.geometry;
        return getConsolidationType(geom);
    }

    /** Updates a given render proxy mesh to make sure that it matches exactly with the fragment's representation
     *  used in the last rendered frame.
     *
     *   @param {THREE.Mesh} proxy  - currently used render proxy
     *   @param {Number}     fragId - fragment represented by this proxy
     **/
    this.updateRenderProxy = function(proxy, fragId) {

        // if the proxy has no valid geometry, do nothing
        if (!proxy.geometry || !proxy.geometry.attributes) {
            return;
        }

        // check which type of geometry has been used in last rendering traversal (See ConsolidationType enum)
        var requiredType = getFragmentConsolidationType(fragId);
        var currentType  = getConsolidationType(proxy.geometry);

        // if type is already correct, we are done.
        if (!proxy.needsUpdate && currentType == requiredType) {
            return;
        }

        // get original fragment geometry
        var origGeom = _frags.getGeometry(fragId);

        // get container geometry that represents the fragment in the consolidation
        var containerIndex = _fragConsolidation.fragId2MeshIndex[fragId];
        var container      = _fragConsolidation.meshes[containerIndex];

        if (requiredType === ConsolidationType.Original) {

            // recover original geometry, material, and matrix
            proxy.geometry = origGeom;
            proxy.material = _frags.getMaterial(fragId);
            _frags.getWorldMatrix(fragId, proxy.matrix);


        } else if (requiredType === ConsolidationType.Instanced) {

            // This fragment was rendered using an instanced shape.

            // replace proxy geometry by instanced mesh with single instance
            _frags.getWorldMatrix(fragId, _tempMatrix);
            var dbId = _frags.fragments.fragId2dbId[fragId];

            // create proxy mesh with 1-element instance buffer
            var builder = new InstanceBufferBuilder(origGeom, 1);
            builder.addInstance(_tempMatrix, dbId);
            proxy.geometry = builder.finish();

            // use container material (needed to activate instancing)
            proxy.material = Array.isArray(container.material) ? container.material[0] : container.material;

            // reset matrix to identity, because the transform is done per instance
            proxy.matrix.identity();

        } else { // ConsolidationType.Merged:

            // This fragment was rendered using a merged shape

            // create consolidation proxy which just contains the single fragment with baked matrix
            _frags.getWorldMatrix(fragId, _tempMatrix);
            _frags.getWorldBounds(fragId, _tempBox);
            dbId = _frags.fragments.fragId2dbId[fragId];
            proxy.geometry = mergeGeometries([origGeom], _tempMatrix.elements,  [dbId], _tempBox);

            // share container material
            proxy.material = Array.isArray(container.material) ? container.material[0] : container.material;

            // reset matrix to identity, because the transform is baked into the vertex buffer
            proxy.matrix.identity();
        }

        // Make sure we don't create the proxy mesh again until actually needed.
        proxy.needsUpdate = false;

        // make sure that WebGLRenderer does not keep an outdated cache object. Without this line,
        // WebGLRenderer will still use the previous GeometryBuffer if it is already cached.
        proxy.dispatchEvent( { type: 'removed' } );
    };
}
