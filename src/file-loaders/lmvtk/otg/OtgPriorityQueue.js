import {LmvVector3 as Vector3} from "../../../wgs/scene/LmvVector3";
import {LmvBox3 as Box3} from "../../../wgs/scene/LmvBox3";
import {CONTAINS, OUTSIDE} from "../../../wgs/scene/FrustumIntersector";
import {SceneMath} from "../../../wgs/scene/SceneMath";

// Returns the surface area of a THREE.Box3.
function getBoxSurfaceArea(box) {
    var dx = box.max.x - box.min.x;
    var dy = box.max.y - box.min.y;
    var dz = box.max.z - box.min.z;
    return 2.0 * (dx * dy + dy * dz + dz * dx);
}

/** Read fragment from Float32-Array (storing each box as 6 floats)
 *  @param {Float32Array} boxes
 *  @param {number}       index
 *  @param {THREE.Box3}   outBox
 *  @returns {THREE.Box3} outBox
 */
function readFragmentBox(boxes, index, outBox) {
    var offset = 6 * index;
    outBox.min.y = boxes[offset+1];
    outBox.min.z = boxes[offset+2];
    outBox.min.x = boxes[offset+0];
    outBox.max.x = boxes[offset+3];
    outBox.max.y = boxes[offset+4];
    outBox.max.z = boxes[offset+5];
    return outBox;
}

// Helper function to compare two THREE.Vector3
function fuzzyEquals(a, b, eps) {
    return (
        Math.abs(a.x - b.x) < eps &&
        Math.abs(a.y - b.y) < eps &&
        Math.abs(a.z - b.z) < eps
    );
}

// Sort requests by decreasing importance
function compareRequests(req1, req2) {
    return req2.importance - req1.importance;
}


var _tmpBox = new Box3();

/**
 * @param {number}            fragId
 * @param {Float32Array}      boxes
 * @param {FrustumInersector} frustum
 */
export function computeFragImportance(fragId, boxes, frustum) {

    // get fragment box
    var fragBox = readFragmentBox(boxes, fragId, _tmpBox);

    // frustum test
    var cullResult = frustum.intersectsBox(fragBox);

    // outside frustum => no importance
    if (cullResult === OUTSIDE) {
        return 0.0;
    }

    // Estimate projected area. For shapes fully inside the frustum, we can
    // skip the clipping step.
    var noClip = (cullResult === CONTAINS);
    var area = frustum.projectedBoxArea(fragBox, noClip);

    var dist = SceneMath.pointToBoxDistance2(frustum.eye, fragBox);
    dist = Math.max(dist, 0.01);

    return area / dist;
}

export function updateGeomImportance(model, fragId) {

    // get geom and bbox of this fragment
    var frags = model.getFragmentList();
    var geom  = frags.getGeometry(fragId);
    frags.getWorldBounds(fragId, _tmpBox);

    // Geoms may be null by design, if the original geometry was degenerated before OTG translation
    if (!geom) {
        return;
    }

    var oldImportance  = geom.importance || 0;
    var fragImportance = getBoxSurfaceArea(_tmpBox);
    geom.importance = Math.max(oldImportance, fragImportance);
}

export class OtgPriorityQueue {

    constructor() {

        this.viewers = [];

        // If the number of requests in progress exceeds _maxRequests, all remaining ones are enqueued in this array.
        // Requests outside the worker can be rearranged based on priority changes (if model visibility changes).
        this.waitingTasks = []; // enqueued task messages to OtgLoadWorker, as defined in requestGeometry(...)

        // Optional: Specifies hashes that should be loaded with maximum priority. (e.g., if quickly needed for a computation)
        this.urgentHashes = {};

        this.prevNumTasks = 0;
        this.fullSortDone = false;

        // Whenever the camera or set of visible models change, we have to update request priorities.
        // These members are used to track relevant changes.
        this.lastCamPos          = {}; // map of Vector3, indexed by viewer.id
        this.lastCamTarget       = {}; // map of Vector3, indexed by viewer.id
        this.lastVisibleModelIds = {}; // map of model ids, indexed by viewer.id, of all visible RenderModels that we considered for last update
    }

    addViewer(viewer) {
        this.viewers.push(viewer);
        this.lastCamPos[viewer.id] = new Vector3();
        this.lastCamTarget[viewer.id] = new Vector3();
        this.lastVisibleModelIds[viewer.id] = [];
    }

    removeViewer(viewer) {
        const index = this.viewers.indexOf(viewer);

        if (index !== -1) {
            delete this.lastCamPos[viewer.id];
            delete this.lastCamTarget[viewer.id];
            delete this.lastVisibleModelIds[viewer.id];
            this.viewers.splice(index, 1);
        }
    }

    // Checks if the camera has significantly changed
    checkCameraChanged() {
        var changed = false;

        for (var i=0; i<this.viewers.length; i++) {
            var viewer = this.viewers[i];
            // get current camera pos/target
            var cam    = viewer.impl.camera;
            var newPos    = cam.position;
            var newTarget = cam.target;

            var Tolerance = 0.01;
            if (fuzzyEquals(this.lastCamPos[viewer.id],    newPos,    Tolerance) &&
                fuzzyEquals(this.lastCamTarget[viewer.id], newTarget, Tolerance))
            {
                // no change
                continue;
            }

            this.lastCamPos[viewer.id].copy(newPos);
            this.lastCamTarget[viewer.id].copy(newTarget);

            changed = true;
        }

        return changed;
    }

    // Checks if the set of visible models has changed
    checkModelsChanged() {
        var changed = false;

        for (var i=0; i<this.viewers.length; i++) {
            var viewer = this.viewers[i];
            // get currently visible models
            var mq = viewer.impl.modelQueue();
            var models = mq.getModels();

            // Check if number of visible models changed
            if (models.length !== this.lastVisibleModelIds[viewer.id].length) {
                this.lastVisibleModelIds[viewer.id].length = models.length;
                changed = true;
            }

            // Check if any element of visible models have changed
            for (var j=0; j<models.length; j++) {
                var idOld = this.lastVisibleModelIds[viewer.id][j];
                var idNew = models[j].id;
                if (idOld !== idNew) {
                    this.lastVisibleModelIds[viewer.id][j] = idNew;
                    changed = true;
                }
            } 
        }

        return changed;
    }

    // Checks for any relevant changes that require to recompute request priorities.
    // If found, all requests are marked by the importanceNeedsUpdate flag.
    validateRequestPriorities() {

        // check if camera or set of visible model have changed
        var cameraChanged = this.checkCameraChanged();
        var modelsChanged = this.checkModelsChanged();

        if (cameraChanged || modelsChanged) {

            // invalidate all task priorities
            for (var i=0; i<this.waitingTasks.length; i++) {
                this.waitingTasks[i].importanceNeedsUpdate = true;
            }
        }
    }

    updateRequestPriorities() {

        // We track the time consumed for priority updates. If it exceeds the limit,
        // we stop the updates and continue next cycle.
        var updateStartTime = performance.now();
        var TimeLimit       = 10; // in ms

        // Mark requests as outdated if any relevant changes occurred
        this.validateRequestPriorities();

        var frustums = {};
        var models = [];

        for (var i=0; i<this.viewers.length; i++) {
            var viewer = this.viewers[i];
            var mq = viewer.impl.modelQueue();
            var frustum = mq.frustum();
            models = models.concat(mq.getModels()); // all models (excluding the hidden ones - which will not considered for importance)

            // Make sure that FrustumIntersector is up-to-date.
            frustum.reset(viewer.impl.camera);
            frustums[viewer.id] = frustum;
        }

        // indicates if we stopped due to timeout
        var timeOut = false;


        var useFullSort = (this.prevNumTasks === 0 || this.waitingTasks.length - this.prevNumTasks > 3000) || !this.fullSortDone;
        this.fullSortDone = !useFullSort;
        this.prevNumTasks = this.waitingTasks.length;

        // Update importance for each waiting request
        for (var i=0; i<this.waitingTasks.length; i++) {

            var task = this.waitingTasks[i];

            // only do work for tasks that need it
            if (!task.importanceNeedsUpdate) {
                continue;
            }

            if (this.urgentHashes[task.hash]) {
                task.importance = Infinity;
                continue;
            }

            //Don't check the timer on every spin through the loop
            //as it takes some time.
            if (i % 10 === 0) {
                var elapsed = performance.now() - updateStartTime;
                if (elapsed > TimeLimit) {
                    timeOut = true;
                    break;
                }
            }

            task.importanceNeedsUpdate = false;

            // reset importance to 0.0, because we accumulate frag importances below
            task.importance = 0.0;

            var sumImportances = 0.0;

            // find fragments of all visible models that use geomHash
            var geomHash = task.hash;
            for (var j=0; j<models.length; j++) {
                var model = models[j];

                // we only deal with otg geometries
                if (!model.isOTG()) {
                    continue;
                }

                // Note that we cannot use FragmentLists at this point, because FragmentLists only know about
                // fragments for which geometry is already loaded.
                // => We must use Otg package instead.
                var otg   = model.myData;
                var frags = otg.fragments;
                var boxes = frags.boxes;

                // If the geomHash is used in this model, get its geom index
                var geomIndex = otg.geomMetadata.hashToIndex[geomHash];
                if (!geomIndex) {
                    // geom is not used by this model
                    continue;
                }

                // If all geometry of a model is loaded, mesh2frag will be deleted by OtgLoader.
                // But, this implies that this model cannot be waiting for any geometry. So we can just skip it.
                if (!frags.mesh2frag) {
                    continue;
                }

                // Get list of fragments in 'model' that are using 'geomIndex'
                var fragIds = frags.mesh2frag[geomIndex];

                for (var k=0; k<this.viewers.length; k++) {
                    var viewer = this.viewers[k];
                    if (viewer.impl.modelQueue().getModels().indexOf(model) !== -1) {
                        if (typeof fragIds === 'number') {
                            // single fragId
                            var value = computeFragImportance(fragIds, boxes, frustums[viewer.id]);
                            sumImportances += value;
        
                        } else if (Array.isArray(fragIds)) {
                            // multiple fragIds
                            for (var k=0; k<fragIds.length; k++) {
                                var fragId = fragIds[k];
        
                                var value = computeFragImportance(fragId, boxes, frustums[viewer.id]);
                                sumImportances += value;
                            }
                        }
                    }
                }
            }

            task.importance = sumImportances;

            if (!useFullSort) {
                //Move the task to the correct spot in the list based on its
                //new importance. This is basically insertion sort, but assuming
                //the task list is nearly sorted already it should be quick
                var j=i;
                while (j>0 && sumImportances > this.waitingTasks[j-1].importance) {
                    this.waitingTasks[j] = this.waitingTasks[j-1];
                    j--;
                }
                this.waitingTasks[j] = task;
            }
        }

        if (useFullSort && !timeOut) {
            // sort task queue by descending request priority
            this.waitingTasks.sort(compareRequests);
            this.fullSortDone = true;
        }

        // return true if all request priorities are up-to-date and sorted
        return !timeOut;
    }

    makeUrgent(hashMap) {

        var geomsTodo = 0;

        // Push priority of all hashes that we want
        for (var hash in hashMap) {
            if (hashMap[hash] === true) {
                this.urgentHashes[hash] = true;
                geomsTodo++;
            }
        }

        // avoid hanging if hashMap is empty
        if (geomsTodo === 0) {
            return 0;
        }

        // Sort all related tasks instantly to the front. This would happen automatically,
        // but a while later due to the gradual importance update.
        for (var i=0; i<this.waitingTasks.length; i++) {
            var task = this.waitingTasks[i];
            if (this.urgentHashes[task.hash]) {
                task.importance = Infinity;
            }
        }
        this.waitingTasks.sort(compareRequests);

        return geomsTodo;
    }

    removeUrgent(hash) {
        delete this.urgentHashes[hash];
    }

    addTask(task) {
        this.waitingTasks.push(task);
    }

    takeTask() {
        return this.waitingTasks.shift();
    }

    isEmpty() {
        return this.waitingTasks.length === 0;
    }

}
