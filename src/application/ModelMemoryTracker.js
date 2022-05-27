
"use strict";

// ModelMemoryTracker is a utility class to support applications to...
//
//  1. Estimate the overall memory consumption of all models in memory
//  2. Decide when/how to free memory if memory is critical - based on LRU timestamps.
//
// Estimating means here to sum up the byte size of the largest arrays of geometry, instancetree, bvh etc.
//
// How to use:
// If you just want to know the summed memory consumptions of all models, just call:
//   estimateMemUsage(viewer)
//
// If you want to use LRU caching to decide when to unload invisible/unused models:
//
//  1. Create a memTracker instance at startup and call initialize once the viewer is available
//
//  2. Updating Timestamps:
//     Whenever the set of 'models-in-use' change, call memTracker.updateModelTimestamps(modelsInUse).
//
//     This assigns/updates lru timestamps for all models to track which one to remove first when memory gets critical.
//     'Models in use' include all models that shouldn't be deleted. This should always include all visible models,
//     but may also include hidden ones that the application wants to protect from memory cleanup.
//
//  3. Cache cleanup:
//     Cache cleanup should be called whenever 
//      a) memory consumption increased (e.g. model consolidated, all model geometry loaded)
//      b) a previously used model changes to hidden/unused. (This may allow to unload it if a previous cleanup call failed, because there was nothing to remove)
//


// Default value for the amount of memory that we allow to consume before removing 
// models from memory.
var MB = 1024 * 1024;
var DefaultMemLimitInBytes = 1000 * MB;

// Shortcut to get byteLength of an array/buffer that might be null
function getByteLength(obj) {
    return (obj && obj.byteLength) || 0;
}

// Summed byteSize of all arrays directly contained in Fragments struct
// @param {Fragments} frags - referenced by otg/svfPackage and FragmentList
// @returns {number}
function getFragmentsBytes(frags) {
    return (
        getByteLength(frags.boxes) +
        getByteLength(frags.transforms) +
        getByteLength(frags.fragId2dbId) +
        getByteLength(frags.geomDataIndexes) + 
        getByteLength(frags.materials)
    );
}

// Summed byteSize of all arrays directly contained in FragmentList,
// excluding those that are shared with Fragments.
//
// @param {FragmentList} fragList
// @returns {number} Memory consumed by FragList (excluding data of fragments)
function getFragmentListBytes(fragList) {
    return (
        getByteLength(fragList.geomids) + 
        getByteLength(fragList.materialids) + 
        getByteLength(fragList.vizflags) + 
        // boxes/transforms may or may not be shared with fragments - depending on model type
        (fragList.boxes      !== fragList.fragments.boxes      ? getByteLength(fragList.boxes)      : 0) +
        (fragList.transforms !== fragList.fragments.transforms ? getByteLength(fragList.transforms) : 0)
    );
}

// @param {BVHBuilder} bvh - as contained in otg/svfPackage
function getBVHBytes(bvh) {

    // bvh.nodes may either be an ArrayBuffer or a NodeArray.
    // If it is a NodeArray, we use the nodesRaw Array to check the byte length
    var nodes = (bvh.nodes.nodesRaw ? bvh.nodes.nodesRaw : bvh.nodes);

    return (
        getByteLength(nodes) +
        getByteLength(bvh.primitives)
    );
}

// @param {InstanceTree}
function getInstanceTreeBytes(instTree) {
    var na = instTree.nodeAccess;
    return (
        getByteLength(na.children)     + 
        getByteLength(na.nameSuffixes) +
        getByteLength(na.names)        +
        getByteLength(na.nodeBoxes)    + 
        getByteLength(na.nodes)
    );
}

// Warn once when used for leaflets, because memory would currently underestimated for this case.
var _noLeafletSupportWarningShown = false;

// Sums up memory consumption by each model - excluding shared geometry
// @param {av.Model[]}
function sumModelMemory(models) {
    var avp = Autodesk.Viewing.Private;

    var bytesTotal = 0;

    for (var i=0; i<models.length; i++) {
        var model = models[i];
        var data  = model.getData();
        if (!data) {
            // Skip models that are unloaded in the mean time
            continue;
        }

        // if model is consolidated, add costs of consolidation
        var cons = model.getConsolidation();
        if (cons) {
            bytesTotal += cons.byteSize;
        }

        // TODO: Consider leaflets for mem tracking
        if (model.isLeaflet()) {
            if (!_noLeafletSupportWarningShown) {
                console.warn("Memory tracking not implemented for leaflets.");
                _noLeafletSupportWarningShown = true;
            }
            continue;
        }

        // F2D and SVF have own geometry
        if (!data.isOTG) {
            var geomList = model.getGeometryList();
            bytesTotal += geomList.geomMemory;
        }

        // FragmentData
        var frags = data.fragments;
        if (frags) {
            bytesTotal += getFragmentsBytes(frags);
        }

        // FragmentList (excluding Fragments struct)
        var fragList = model.getFragmentList();
        if (fragList) {
            bytesTotal += getFragmentListBytes(fragList);
        }

        // BVH
        var bvh = data.bvh;
        if (bvh) {
            bytesTotal += getBVHBytes(bvh);            
        }

        // InstanceTree
        var it = data.instanceTree;
        if (it) {
            bytesTotal += getInstanceTreeBytes(it);
        }
    }

    // Verify that result makes sense
    if (!isFinite(bytesTotal)) {
        // If you see this warning, some code may have changed, so that some memory check
        // code used above needs to be updated as well.
        avp.logger.warn('Memory estimate result was not a number');
    }

    return bytesTotal;
}

// Estimates summed memory usage by all models in memory (visible and hidden)
//  @param {Viewer3D}
export function estimateMemUsage(viewer) {

    // get memory consumed by shared otg geometry
    var geomCache = viewer.impl.geomCache();
    var sharedBytes = geomCache ? geomCache.byteSize : 0;

    // get non-shared memory consumed by all models
    var mq = viewer.impl.modelQueue();
    var visibleModels = mq.getModels();
    var hiddenModels  = mq.getHiddenModels();
    var memVisible = sumModelMemory(visibleModels);
    var memHidden  = sumModelMemory(hiddenModels);

    return sharedBytes + memVisible + memHidden;
}

// Helper class to track memory consumptions and support applications to decide how many models to keep in memory.
//  @param {Viewer3d} viewer
//  @param {number}   [memoryLimit] - in bytes, default 1GB
export function ModelMemoryTracker(viewer, memoryLimit) {

    var _viewer = viewer;
    
    // Used for LRU timestamps to decide which models to unload first.
    var _currentTimestamp = 0;

    var _memLimit = memoryLimit || DefaultMemLimitInBytes;

    // A model has latest timestamp if and only if it was among 'modelsInUse' on last onModelsChanged() call
    // Addendum: in some cases a model is loaded as hidden (e.g. PixelCompare) but we still want to keep it in memory
    // In that case we look for keepHiddenModel=true in the loadOptions.
    function modelInUse(model) {
        return model.lruTimestamp === _currentTimestamp || model.getData()?.loadOptions.keepHiddenModel;
    }

    // Determines candidates for memory cleanup. Returns a list of models
    // that are currently not in-use, sorted by increasing lru timestamp
    function getUnusedModels() {
        // get all hidden models
        var mq = _viewer.impl.modelQueue();
        var hiddenModels = mq.getHiddenModels();

        // collect all models that don't have latest timestamp
        var unusedModels = [];
        for (var i=0; i<hiddenModels.length; i++) {
            var model = hiddenModels[i];
            if (!modelInUse(model)) {
                unusedModels.push(model);
            }
        }

        // sort by increasing timestamp
        var byIncTimestamp = function(a, b) {
            return a.lurTimestamp - b.lruTimestamp;
        };
        unusedModels.sort(byIncTimestamp);
        return unusedModels;
    }

    // Called whenever the set of 'models in use' changes. The modelsInUse is an array of models that the application
    // wants to keep in memory. This must include the set of visible models, but may also include hidden ones,
    // e.g., if a model is hidden, but just about to fade in.
    //  @param {av.Model[]}
    this.updateModelTimestamps = function(modelsInUse) {
        _currentTimestamp++;

        // set latest timestamp for all used models
        for (var i=0; i<modelsInUse.length; i++) {
            var model = modelsInUse[i];
            model.lruTimestamp = _currentTimestamp;
        }
    };

    this.memoryExceeded = function() {
        var mem = estimateMemUsage(_viewer);
        return mem >= _memLimit;
    };

    // @returns {number} memLimit in bytes
    this.getMemLimit = function() {
        return _memLimit;
    };

    // Checks if the memory limit is above the limit and unloads models if necessary.
    // By default, this is done using viewer.impl.unloadModel(). Optionally, an application
    // may customize the model unload to keep its data consistent.
    //   @param {function(av.Model)} [unloadModelFunc] 
    this.cleanup = function(unloadModelFunc) {    

        // set default unload function if undefined
        var unloadModel = unloadModelFunc || _viewer.impl.unloadModel.bind(_viewer.impl);

        if (!this.memoryExceeded()) {
            return;
        }

        // We need memory - get unused models for which we can remove resources.
        var unusedModels = getUnusedModels();

        // 1. Discard consolidations of unused models.
        //    We will recompute them once a model gets visible again.
        for (var i=0; i<unusedModels.length; i++) {
            var model = unusedModels[i];
            if (model.isConsolidated) {
                // Drop consolidation
                model.unconsolidate();
                if (!this.memoryExceeded()) {
                    return;
                }
            }
        }

        // 2. Remove hidden models to free memory
        var geomCache = _viewer.impl.geomCache();
        for (i=0; i<unusedModels.length; i++) {

            // unload next model
            model = unusedModels[i];
            unloadModel(model);

            // Some geometries might be unused now.
            // => Running geomCache cleanup again might gain something.
            if (geomCache) {
                geomCache.cleanup();
            }

            if (!this.memoryExceeded()) {
                return;                
            }
        }

        // If we reach here, only visible models + reserved budget for shared geomCache is left.
        // So, there is nothing we can remove anymore. Handling this case properly will require
        // support to page-out parts of visible models.
    };
}

