import { RenderBatch } from './RenderBatch';
import { isMobileDevice } from '../../compat';
import {FrustumIntersector} from "./FrustumIntersector";

//TODO: better heuristic for group size might be needed
//But it should be based on polygon count as well as
//fragment count. But polygon count is not known
//until we get the meshes later on.
let MAX_FRAGS_PER_GROUP = 500;

let calculateFragsPerScene = function(is2d) {
        // choose _fragsPerScene based on scene type and device
        let fragsPerScene = MAX_FRAGS_PER_GROUP;
        if (is2d)
            fragsPerScene /= 6; //2d meshes are all fully packed, so we can't draw so many per batch.
        if (isMobileDevice()) {
            fragsPerScene /= 3; //This is tuned for ~15fps on Nexus 7.
        }
        fragsPerScene = Math.floor(fragsPerScene);
        return fragsPerScene > 0 ? fragsPerScene : MAX_FRAGS_PER_GROUP;
};

/**
 * All rendering and other scene related data associated with a 3D model or 2D Drawing.
 * The "linear" variant uses simple non-hierarchical linear scene traversal when rendering a frame.
 * Good for small scenes, incrementally loaded scenes, and 2D drawings where draw order matters.
 * @constructor
 */
export class ModelIteratorLinear {

    constructor(renderModel) {

        this._frags    = renderModel.getFragmentList();
        // Take the RenderBatch class from the model, so on demand loading can
        // use a different class to handle redraws properly
        this._RenderBatch = renderModel.RenderBatch;
        this._model    = renderModel;
        this._is2d = this._model.is2d();
        this._fragsPerScene = calculateFragsPerScene(renderModel.is2d());
        this._fragOrder = [];
        this._geomScenes = [];
        this._secondPassIndex = null; // Used to mark where in _geomScenes the second pass scenes start.

        const fragCount = this._frags.getCount();

        // index of the scene in _geomScenes that the next nextBatch() call will return.
        this._currentScene = 0;

        //Custom re-order of the fragments for optimized rendering.
        //those are indices into the immutable vizmeshes fragment list.
        //Trivial largest to smallest order
        let fragOrder = new Int32Array(fragCount);
        for (let i=0; i<fragCount; i++) {
            fragOrder[i] = i;
        }

        this.setFragmentOrder(fragOrder, fragCount);
    }

    dtor() {
        this.model = null;
        this._RenderBatch = null;
        this._frags = null;
    }

    setFragmentOrder(fragOrder, fragmentCount) {
        this._fragCount = fragmentCount;

        //NOTE: We use the array container as reference to pass to RenderBatches, because the
        //typed array can get resized when loading data with unknown size
        this._fragOrder[0] = fragOrder;

        //Create a RenderBatch for each batch of fragments.
        //We will then draw each batch in turn to get a progressive
        //effect. The number of fragments per batch should be close
        //to what we can draw in a single frame while maintaining interactivity.
        //This linear list of batches is used for 2D scenes and for 3D scenes
        //while they are loading. After load is done, the linear traversal is replaced
        //by a view-based bounding volume hierarchy traversal.

        // Given the maximum fragCount per batch, compute the required number of batches to fit in all fragments
        var numScenes = Math.floor((this._fragCount + this._fragsPerScene - 1) / this._fragsPerScene);

        // create array with a RenderBatch per fragment group.
        // Note that this will only create all batches if the full fragCount is known in advance. Otherwise, they have to be created
        // later via addFragment() calls.
        this._geomScenes.length = numScenes;
        for (let i=0; i<numScenes; i++) {
            let startIndex = i * this._fragsPerScene;
            let scene      = this._geomScenes[i] = new this._RenderBatch(this._frags, this._fragOrder, startIndex, this._fragsPerScene);
            let lastIndex  = startIndex + this._fragsPerScene;

            // Crop last batch at the end, so that it does not exceed the fragment count. The last batch has usually not full
            // length, unless fragCount is a multiple of
            if (lastIndex > this._fragCount)
                lastIndex = this._fragCount;
            scene.lastItem = lastIndex;
        }
    }

    // Only needed if the full fragment count is not known in advance.
    // For incremental loading, this method makes sure that 
    //  - fragOrder has required size 
    //  - fragOrder defines trivial ordering of all frags added so far
    //  - _geomScenes contains a batch containing the new fragment
    //
    // Assumptions: Fragments are currently added by increasing fragId. Otherwise, _geomScenes might contain null-elements,
    //              which may cause exceptions, e.g., in nextBatch() and getVisibleBounds().
    addFragment(fragId) {
        //The frag order indices array will not auto-resize (it's ArrayBuffer)
        //so we have to do it manually
        if (this._fragOrder[0].length <= fragId)
        {
            var nlen = 2 * this._fragOrder[0].length;
            if (nlen <= fragId)
                nlen = fragId + 1;

            var ninds = new Int32Array(nlen);
            ninds.set(this._fragOrder[0]);
            this._fragOrder[0] = ninds;

            //We only set this when the fragment index goes
            //beyond the initial fragment size -- assuming
            //that the initial bounds passed into the RenderQueue constructor
            //is valid for the initial fragment list.
            this.visibleBoundsDirty = true;
        }
        //Note: this assumes trivial ordering
        //We cannot set/add meshes if reordering of the indices has already happened.
        //This is OK, because trivial ordering with unknown initial fragment count
        //happens only for 2D models where we preserve trivial draw order anyway.
        this._fragOrder[0][fragId] = fragId;


        //Find a parent for the mesh -- in the case of SVF
        //fragments we just map fragment index to increasing
        //scene index, since fragments are already ordered
        //in the way we want to draw them
        var sceneIndex = Math.floor(fragId / this._fragsPerScene);
        if (this._geomScenes) {
            var scene = this._geomScenes[sceneIndex];
            if (!scene || scene.isSecondPass) {
                // Note that it's okay that the batch may also reference fragments that were not added yet. 
                // The RenderBatch does not require all fragments to be in memory already.
                scene = new this._RenderBatch(this._frags, this._fragOrder, sceneIndex * this._fragsPerScene, this._fragsPerScene);

                if (this._secondPassIndex === null) {
                    this._geomScenes[sceneIndex] = scene;
                } else {
                    // If we are already using a second pass, need to add this new scene as well. This will most probably
                    // rarely happen, but this should cover that case anyway.
                    this.insertSceneToSecondPass(sceneIndex, scene);
                }
            }
            // Did scene get set reasonably?
            if (scene) {
                // Notify batch about new fragment, so that the batch updates internal state like summed bbox and material sorting
                scene.onFragmentAdded(fragId);
                if (this._secondPassIndex !== null) {
                    this._geomScenes[this._secondPassIndex + sceneIndex].onFragmentAdded(fragId);
                }
            }
        }
    }

    insertSceneToSecondPass(sceneIndex, scene) {
        // The two passes are located one after the other in geomScenes, to keep the iterator logic simple.
        // That means that if we need to add a scene, we first split the two passes, insert the scene into
        // each pass, and join them again.
        // This makes no assumption where in the array the scene is added. The only assumption is that the two
        // passes are in sync, that is, they are of the same length.
        const firstPassScenes = this._geomScenes.slice(0, this._secondPassIndex);
        const secondPassScenes = this._geomScenes.slice(this._secondPassIndex);

        firstPassScenes[sceneIndex] = scene;
        secondPassScenes[sceneIndex] = this.cloneForSecondPass(scene);
        this._secondPassIndex = firstPassScenes.length;
        this._geomScenes = firstPassScenes.concat(secondPassScenes);
    }

    // restart iterator
    reset(frustum, camera) {
        this._currentScene = 0;
        if (this._is2d && this._geomScenes[0]) {
            this._geomScenes[0].drawEnd = 0;
            if (this._secondPassIndex !== null) {
                this._geomScenes[this._secondPassIndex].drawEnd = 0;
            }
        }

        if (this._resetVisStatus) {
            let scenes = this._geomScenes;	    
            let len = scenes.length;	
            for (let i = 0; i < len; ++i) {	
                var scene = scenes[i];	
                if (scene && scene.resetVisStatus) {	
                    scene.resetVisStatus();	
                }	
            }	
            this._resetVisStatus = false;	
        }	
    }
    
    getSceneCount() {
        return this._geomScenes.length;
    }
    
    getGeomScenes() {
        return this._geomScenes;
    }

    resetVisStatus() {	
      this._resetVisStatus = true;	
    }
    
    done() {
        // If we are filling f2d batches, then we aren't done until the model is loaded
        if (this._is2d && !this._model.isLoadDone())
            return false;
        // Once the model is loaded, we are done when the last batch is drawn
        var res;
        return (this._currentScene >= this._geomScenes.length - 1) &&
               (!(res = this._geomScenes[this._currentScene]) || res.drawStart >= res.lastItem);
    };

    // Returns the next RenderBatch from _geomScenes or null when reaching the end.
    nextBatch() {
        if (this._currentScene >= this.getSceneCount())
            return null;

        // As long as fragments are added in order of increasing id, res will never be null.
        let res = this._geomScenes[this._currentScene];

        if (!this._is2d) {
            // Render importance is used to decide what to render next when using progressive rendering with multiple models. (see RenderScene.renderSome)
            // For linear iterator, is treated as equally important.
            res.renderImportance = 0;
            ++this._currentScene;
        } else {
            const needsTwoPasses = this.areTwoPassesNeeded();
            // 2D scene, so we only want to proceed to the next batch when this current batch is filled.
            if (res.lastItem >= res.start + res.count) {
                ++this._currentScene;
                if (this._geomScenes[this._currentScene])
                    this._geomScenes[this._currentScene].drawEnd = this._geomScenes[this._currentScene].start;
            }
            res.drawStart = res.drawEnd;
            res.drawEnd = res.lastItem;
            if (res.hasOwnProperty("drawStart") && res.lastItem <= res.drawStart) {
                const isEndOfFirstPass = needsTwoPasses && !this._isSecondPass;
                if (isEndOfFirstPass) {
                    // Start the second pass
                    this._currentScene = this._secondPassIndex;
                    return this.nextBatch();
                }
                return null;   // all object in the batch have been drawn
            }

            // For the first pass change it to a large number to make sure it's rendered before 3D models (fixes transparency issues when mixing 2D/3D models)
            // For the second pass, set it to -1, so it's rendered after 3D models that are being loaded, since those also use the linear iterator and set
            // the importance to 0.
            const renderLast = !this._model.areAllVisible() || this._isSecondPass; // When the whole page is ghosted also render last
            res.renderImportance = renderLast ? -1.0 : 1e20;
            res.needsTwoPasses = needsTwoPasses;
        }

        return res;
    }

    areTwoPassesNeeded() {
        // Currently used only for paper transparency.
        // Could be expanded for any case with transparency.
        const needsTwoPasses = this._model.hasPaperTransparency();
        if (needsTwoPasses && this._secondPassIndex === null) {
            // Add the second pass scenes only when deemed necessary
            this.addSecondPassScenes();
        }

        this._isSecondPass = !!(needsTwoPasses && this._currentScene >= this._secondPassIndex);

        return needsTwoPasses;
    }

    cloneForSecondPass(scene) {
        if (!scene) return;

        const clone = scene.clone();
        clone.isSecondPass = true;
        return clone;
    }

    addSecondPassScenes() {
        const numScenes = this._geomScenes.length;
        if (!numScenes) {
            return;
        }

        this._geomScenes = this._geomScenes.concat(this._geomScenes.map(this.cloneForSecondPass));
        this._secondPassIndex = numScenes;
    }

    // Computes the summed bboxes of all batches of the iterator and writes them to the out params:
    // - visibleBounds:           instanceof THREE.Box3, bbox of all fragments excluding the ghosted ones.
    // - visibleBoundsWithHidden: instanceof THREE.Box3, bbox of all fragments 
    //
    // [HB:] BBoxes are computed without considering MESH_HIDE flag in any way, see RenderBatch.calculateBounds(). Is this intended?
    getVisibleBounds(visibleBounds, visibleBoundsWithHidden) {

        //Case where we are not using BVH

        var len = this.getSceneCount();
        for (var i=0; i<len; i++) {

            // make sure that the bboxes of the batch is up-to-date
            this._geomScenes[i].calculateBounds();

            // sum up bbox of fragments excluding ghosted
            var bb = this._geomScenes[i].getBoundingBox();
            visibleBounds.union(bb);

            // sum up bbox of all fragments
            visibleBoundsWithHidden.union(bb);
            visibleBoundsWithHidden.union(this._geomScenes[i].getBoundingBoxHidden());

        }
    }
    
    // Perform raycast on all batches. See RenderBatch.raycast() for params.
    rayCast(raycaster, intersects, dbIdFilter) {
        var len = this.getSceneCount();
        for (var i = 0; i < len; i++) {
            this._geomScenes[i].raycast(raycaster, intersects, dbIdFilter);
        }
    }

    intersectFrustum(frustumIntersector, callback) {

        for (let geomScene of this._geomScenes) {

            if (!geomScene) {
                continue;
            }

            let res = frustumIntersector.intersectsBox(geomScene.getBoundingBox());

            if (res === FrustumIntersector.OUTSIDE) {
                continue;
            }

            geomScene.intersectFrustum(frustumIntersector, callback, res === FrustumIntersector.CONTAINS);
        }
    }

    clone() {
        return new ModelIteratorLinear(this._model);
    }
}
