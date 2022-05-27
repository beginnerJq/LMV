
import { LmvMatrix4 as Matrix4 } from '../../wgs/scene/LmvMatrix4';
import { LmvBox3 as Box3 } from '../../wgs/scene/LmvBox3';
import { LmvVector3 as Vector3 } from '../../wgs/scene/LmvVector3';
import { logger } from "../../logger/Logger";
import { TextureLoader } from "./TextureLoader";
import { NodeArray } from "../../wgs/scene/BVHBuilder";
import { MeshFlags } from '../../wgs/scene/MeshFlags';
import { PropDbLoader } from "./PropDbLoader";
import { initWorkerScript, createWorkerWithIntercept } from "./WorkerCreator";
import { initLoadContext } from "../net/endpoints";
import { pathToURL, ViewingService } from "../net/Xhr";
import {OtgPackage, FLUENT_URN_PREFIX, DS_OTG_CDN_PREFIX} from "../lmvtk/otg/Otg";
import { FileLoaderManager } from "../../application/FileLoaderManager";
import { Model } from "../../application/Model";
import * as et from "../../application/EventTypes";
import { ProgressState } from '../../application/ProgressState';
import { isMobileDevice } from "../../compat";
import { MESH_RECEIVE_EVENT, MESH_FAILED_EVENT, MATERIAL_RECEIVE_EVENT, MATERIAL_FAILED_EVENT } from "./OtgResourceCache";
import {blobToJson} from "../lmvtk/common/StringUtils";
//import { createWireframe } from "../../wgs/scene/DeriveTopology;

var WORKER_LOAD_OTG_BVH = "LOAD_OTG_BVH";
const av = Autodesk.Viewing;
const avp = Autodesk.Viewing.Private;

/** @constructor */
export function OtgLoader(parent) {
    this.viewer3DImpl = parent;
    this.loading = false;
    this.tmpMatrix = new Matrix4();
    this.tmpBox = new Box3();

    this.logger = logger;
    this.loadTime = 0;

    this.pendingMaterials = {};
    this.pendingMaterialsCount = 0;

    this.pendingMeshes = {};
    this.pendingMeshesCount = 0;

    this.operationsDone = 0;
}


OtgLoader.prototype.dtor = function () {
    // Cancel all potential process on loading a file.

    // 1. init worker script can be cancelled.
    //
    if (this.initWorkerScriptToken) {
        this.initWorkerScriptToken.cancel();
        this.initWorkerScriptToken = null;
        logger.debug("SVF loader dtor: on init worker script.");
    }

    // 2. load model root (aka. svf) can be cancelled.
    //
    if (this.bvhWorker) {
        this.bvhWorker.clearAllEventListenerWithIntercept();
        this.bvhWorker.terminate();
        this.bvhWorker = null;
        logger.debug("SVF loader dtor: on svf worker.");
    }


    if (this.svf) {

        if (!this.svf.loadDone)
            console.log("stopping load before it was complete");

        this.svf.abort();

        if (this.svf.propDbLoader) {
            this.svf.propDbLoader.dtor();
            this.svf.propDbLoader = null;
        }
    }


    // 5. Cancel all running requests in shared geometry worker
    //
    if (this.viewer3DImpl.geomCache() && this.model) {
        if (this.loading)
            this.viewer3DImpl.geomCache().cancelRequests(this.svf.geomMetadata.hashToIndex);

        this.removeMeshReceiveListener();
    }

    // and clear metadata.
    this.viewer3DImpl = null;
    this.model = null;
    this.svf = null;
    this.logger = null;
    this.tmpMatrix = null;

    this.loading = false;
    this.loadTime = 0;
};

OtgLoader.prototype.isValid = function() {
    return this.viewer3DImpl != null;
};

// Stop listening to mesh receive events
OtgLoader.prototype.removeMeshReceiveListener = function() {
    if (this.meshReceiveListener) {
        this.viewer3DImpl.geomCache().updateMruTimestamps();
        this.viewer3DImpl.geomCache().removeEventListener(MESH_RECEIVE_EVENT, this.meshReceiveListener);
        this.viewer3DImpl.geomCache().removeEventListener(MESH_FAILED_EVENT,  this.meshReceiveListener);
        this.viewer3DImpl.geomCache().removeEventListener(MATERIAL_RECEIVE_EVENT, this.materialReceiveListener);
        this.viewer3DImpl.geomCache().removeEventListener(MATERIAL_FAILED_EVENT,  this.materialReceiveListener);
        this.meshReceiveListener = null;
    }
};

function getBasePath(path) {
    var basePath = "";
    var lastSlash = path.lastIndexOf("/");
    if (lastSlash != -1)
        basePath = path.substr(0, lastSlash+1);
    return basePath;
}

function getQueryParams(options) {
    return options.acmSessionId ? "acmsession=" + options.acmSessionId : "";
}

function createLoadContext(options, basePath, queryParams) {
    var loadContext = {
        basePath: basePath,
        objectIds : options.ids,
        globalOffset : options.globalOffset,
        fragmentTransformsDouble: options.fragmentTransformsDouble,
        placementTransform : options.placementTransform,
        applyRefPoint: options.applyRefPoint,
        queryParams : queryParams,
        bvhOptions : options.bvhOptions || {isWeakDevice : isMobileDevice()},
        applyScaling: options.applyScaling,
        applyPlacementInModelUnits: options.applyPlacementInModelUnits,
        loadInstanceTree: options.loadInstanceTree
    };

    return initLoadContext(loadContext);
}

OtgLoader.prototype.loadFile = function(path, options, onDone, onWorkerStart) {
    if (!this.viewer3DImpl) {
        logger.log("SVF loader was already destructed. So no longer usable.");
        return false;
    }

    if (this.loading) {
        logger.log("Loading of SVF already in progress. Ignoring new request.");
        return false;
    }

    // Mark it as loading now.
    this.loading = true;

    //For OTG server, the URN of the manifest is used as part of the ACM session token
    if (options.acmSessionId) {
        //TODO: initWorker should be updated to also send the acmsession when authorizing the web worker,
        //in a followup change.
        this.svfUrn = options.acmSessionId.split(",")[0];
    } else {
        //If the URN is not supplied, we can derive it from the storage path,
        //but that will only work for URNs that are not shallow copies.
        console.warn("DEPRECATED: Automatic derivation of URN will be removed in a future release. Please set the acmSessionId parameter when loading OTG data.");

        var idx = path.indexOf(FLUENT_URN_PREFIX);
        if (idx === -1) {
            idx = path.indexOf(DS_OTG_CDN_PREFIX);
        }

        if (idx !== -1) {

            //This will work for WIP URNs but probably not OSS ones, where
            //the URN is an encoding of the OSS file name or something equally arbitrary
            var parts = path.split("/");
            var seed = parts[1];
            var version = parts[2];
            var urn = seed + "?version=" + version;
            var encoded = av.toUrlSafeBase64(urn);

            this.svfUrn = encoded;
        }
    }

    this.sharedDbPath = options.sharedPropertyDbPath;

    this.currentLoadPath = path;
    
    this.basePath = getBasePath(path);
    this.acmSessionId = options.acmSessionId;

    this.options = options;
    this.queryParams = getQueryParams(options);

    this.loadContext = createLoadContext(options, this.basePath, this.queryParams);

    // The request failure parameters received by onFailureCallback (e.g. httpStatusCode) cannot just be forwarded to onDone().
    // Instead, we have to pass them through ViewingService.defaultFailureCallback, which converts them to error parameters
    // and calls loadContext.raiseError with them.
    this.loadContext.raiseError = function(code, msg, args) {
        var error = { "code": code, "msg": msg, "args": args };
        onDone && onDone(error);
    };
    this.loadContext.onFailureCallback = ViewingService.defaultFailureCallback.bind(this.loadContext);

    this.loadModelRoot(this.loadContext, onDone);

    //We don't use a worker for OTG root load, so we call this back immediately
    //We will use the worker for heavy tasks like BVH compute after we get the model root file.
    onWorkerStart && onWorkerStart();

    return true;
};


OtgLoader.prototype.loadModelRoot = function(loadContext, onDone) {
    this.t0 = new Date().getTime();
    this.firstPixelTimestamp = null;
    var scope = this;

    var WORKER_SCRIPT_READY = false;
    var _pendingMessages = {};

    this.initWorkerScriptToken = initWorkerScript(function() {
        WORKER_SCRIPT_READY = true;

        for (var id in _pendingMessages) {
            if (_pendingMessages.hasOwnProperty(id)) {
                _pendingMessages[id].forEach((data) => {
                    loadContext.onLoaderEvent(id, data);
                });
            }
        }
        _pendingMessages = {};      
    });

    var svf = this.svf = new OtgPackage();

    svf.basePath = loadContext.basePath;

    //Those events happen on the main thread, unlike SVF loading where
    //everything happens in the svfWorker
    loadContext.onLoaderEvent = function(whatIsDone, data) {

        if (!scope.svf) {
            console.error("load callback called after load was aborted");
            return;
        }

        // Make sure that the worker script is ready by the time the messages are processed.
        // This is related to LMV-4719
        if (!WORKER_SCRIPT_READY) {
            if (!_pendingMessages.hasOwnProperty(whatIsDone))
                _pendingMessages[whatIsDone] = [];
            _pendingMessages[whatIsDone].push(data);
            return;
        }

        if (whatIsDone === "otg_root") {

            scope.onModelRootLoadDone(svf);

            if (onDone)
                onDone(null, scope.model);

            scope.makeBVHInWorker();

            // init shared cache on first use
            var geomCache = scope.viewer3DImpl.geomCache();

            if (!geomCache) {
                // If this loader would create an own cache, it could be a hidden memory waste.
                // So it's better to complain.
                logger.error("geomCache is required for loading OTG models.");
            }

            geomCache.initWorker(scope.options.acmSessionId);

            scope.meshReceiveListener = function(data) {
                if (data.error && data.error.args) {
                    scope.onMeshError(data);
                } else {
                    scope.onMeshReceived(data.geom);
                }
            };

            geomCache.addEventListener(MESH_RECEIVE_EVENT, scope.meshReceiveListener);
            geomCache.addEventListener(MESH_FAILED_EVENT, scope.meshReceiveListener);

            scope.materialReceiveListener = function (data) {
                if (data.error || !data.material || !data.material.length) {
                    scope.onMaterialLoaded(null, data.hash);
                } else {
                    scope.onMaterialLoaded(blobToJson(data.material), data.hash);
                }
            };

            geomCache.addEventListener(MATERIAL_RECEIVE_EVENT, scope.materialReceiveListener);
            geomCache.addEventListener(MATERIAL_FAILED_EVENT, scope.materialReceiveListener);

            scope.svf.loadDone = false;

        } else if (whatIsDone === "fragment") {

            if (!scope.options.skipMeshLoad)
                scope.tryToActivateFragment(data, "fragment");

            // Optional: Track fragment load progress separately 
            if (scope.options.onFragmentListLoadProgress) {
                scope.trackFragmentListLoadProgress();
            }

        } else if (whatIsDone === "all_fragments") {

            //For 3D models, we can start loading the property database as soon
            //as we know the fragment list which contains the fragId->dbId map.
            if (!scope.options.skipPropertyDb) {
                scope.loadPropertyDb();
            }

            // If this flag is false, some data is not ready yet. E.g. fragments.fragId2DbId is initially
            // filled with zeros and is only be usable after root looad. Note that fragDataLoaded = true
            // does NOT mean yet that geometry and materials are all loaded.
            scope.fragmentDataLoaded = true;

            scope.viewer3DImpl.api.fireEvent({type:et.MODEL_ROOT_LOADED_EVENT, svf:svf, model:scope.model});


            if (scope.options.skipMeshLoad || !scope.svf.fragments.length) {
                scope.onGeomLoadDone();
            } else
                scope.onOperationComplete();

        } else if (whatIsDone === "bvh") {
            var bvh = data;
            if (scope.model) {

                scope.model.setBVH(bvh.nodes, bvh.primitives, scope.options.bvhOptions);

                if (scope.viewer3DImpl) {

                    // Refresh viewer if model is visible.
                    if (scope.viewer3DImpl.modelVisible(scope.model.id)) {
                        scope.viewer3DImpl.invalidate(false, true);
                    }
                }
            }

            scope.onOperationComplete();

        }
    };

    svf.beginLoad(loadContext, pathToURL(scope.currentLoadPath));

    return true;
};

function copyBoxes(fboxes, e) {

    // Note that the loaded boxes are mixed with flags, so we need to copy them and skip the other data
    var eboxes = e.data.boxes;
    var stride = e.data.boxStride;
    var boxCount = eboxes.length / stride;

    for (let fragId=0, srcOffset=0, dstOffset=0; fragId<boxCount; fragId++, srcOffset += stride, dstOffset += 6) {
        fboxes[dstOffset+0] = eboxes[srcOffset+0];
        fboxes[dstOffset+1] = eboxes[srcOffset+1];
        fboxes[dstOffset+2] = eboxes[srcOffset+2];
        fboxes[dstOffset+3] = eboxes[srcOffset+3];
        fboxes[dstOffset+4] = eboxes[srcOffset+4];
        fboxes[dstOffset+5] = eboxes[srcOffset+5];
    }
}

OtgLoader.prototype.makeBVHInWorker = function() {

    var scope = this;

    scope.bvhWorker = createWorkerWithIntercept();

    var onOtgWorkerEvent = function(e) {
        if (e.data.bvh) {

            console.log("Received BVH from worker");

            var bvh = e.data.bvh;
            if (scope.model) {

                scope.svf.bvh = bvh;
                scope.model.setBVH(new NodeArray(bvh.nodes, bvh.useLeanNodes), bvh.primitives, scope.options.bvhOptions);

                if (scope.viewer3DImpl) {

                    // Refresh viewer if model is visible.
                    if (scope.viewer3DImpl.modelVisible(scope.model.id)) {
                        scope.viewer3DImpl.invalidate(false, true);
                    }
                }
            }

            scope.bvhWorker.clearAllEventListenerWithIntercept();
            scope.bvhWorker.terminate();
            scope.bvhWorker = null;

            scope.onOperationComplete();
        }

        if (e.data.boxes && scope.model) {
            var frags = scope.model.myData.fragments;

            copyBoxes(frags.boxes, e);

            // Make sure that subsequent setMesh() calls don't overwrite the boxes with computed ones.
            // This would happen otherwise as soon as more geometry is loaded.
            frags.boxesLoaded = true;

            // Make sure that model box does not keep outdated values
            scope.model.visibleBoundsDirty = true;
        }
    };

    scope.bvhWorker.addEventListenerWithIntercept(onOtgWorkerEvent);

    //We can kick off the request for the fragments-extra file, needed
    //for the BVH build as soon as we have the metadata (i.e. placement transform)
    //Do this on the worker thread, because the BVH build can take a while.
    var workerContext = Object.assign({}, scope.loadContext);
    workerContext.operation = WORKER_LOAD_OTG_BVH;
    workerContext.raiseError = null;
    workerContext.onFailureCallback = null;
    workerContext.onLoaderEvent = null;
    workerContext.fragments_extra = pathToURL(scope.basePath) + scope.svf.manifest.assets.fragments_extra;
    workerContext.placementTransform = scope.svf.placementTransform;
    workerContext.placementWithOffset = scope.svf.placementWithOffset;
    workerContext.fragmentTransformsOffset = scope.svf.metadata.fragmentTransformsOffset;
    workerContext.globalOffset = scope.svf.globalOffset;

    if (workerContext.fragments_extra) {
        scope.bvhWorker.doOperation(workerContext);
    } else {
        // If the model does not reference a fragment_extra file, the worker would not do anything.
        // This is okay for empty models. For this case, just skip the BVH phase to avoid the load progress from hanging.
        scope.onOperationComplete();
    }
};

//Attempts to turn on display of a received fragment.
//If the geometry or material is missing, issue requests for those
//and delay the activation. Once the material or mesh comes in, they
//will attempt this function again.
OtgLoader.prototype.tryToActivateFragment = function(fragId, whichCaller) {

    var svf = this.svf;
    var rm = this.model;

    //Was loading canceled?
    if (!rm)
        return;

    var flags = svf.fragments.visibilityFlags[fragId];
    var skipLoad = (flags & MeshFlags.MESH_NOTLOADED);
    var isHidden = (flags & MeshFlags.MESH_HIDE);

    // Keep it identical to SvfLoader, where skipHiddenFragments is false by default
    var skipHiddenFragments = svf.loadOptions.skipHiddenFragments ?? false;

    // Skip fragments with hide-flag. (e.g. hidden room geometry)
    // These are not intended for display, but rather for custom tools.
    //TODO: Check if not loading of hidden meshes causes side effects downstream,
    //like in the diff tool which waits for specific meshes to load.
    if (skipLoad || (isHidden && skipHiddenFragments)) {
        rm.getFragmentList().setFlagFragment(fragId, MeshFlags.MESH_NOTLOADED, true);
        this.trackGeomLoadProgress(svf, fragId, false);
        return;
    }

    //Also restore the hide flag
    if (flags & MeshFlags.MESH_HIDE) {
        // Use MESH_VISIBLE flag in favor of MESH_HIDE as Model Browser controls visibility using MESH_VISIBLE
        rm.getFragmentList().setFlagFragment(fragId, MeshFlags.MESH_HIDE, false);
        rm.getFragmentList().setFlagFragment(fragId, MeshFlags.MESH_VISIBLE, false);
    }

    var haveToWait = false;

    //The tryToActivate function can be called up to three times, until all the
    //needed parts are received.
    // Before we can safely consider a fragment as finished, we must make sure that there are no pending
    // tryToActivate(fragId, "material") or "geometry" calls that will come later.

    //1. Check if the material is done

    var materialId = svf.fragments.materials[fragId];
    var matHash = svf.getMaterialHash(materialId);
    var material = this.findOrLoadMaterial(rm, matHash, materialId);
    if (!material) {

        if (whichCaller === "fragment") {
            //Material is not yet available, so we will delay turning on the fragment until it arrives
            this.pendingMaterials[matHash].push(fragId);
        }

        if (whichCaller !== "material") {
            haveToWait = true;
        } else {
            //it means the material failed to load, so we won't wait for it.
        }
    }


    //2. Check if the mesh is done

    // Note that otg translation may assign geomIndex 0 to some fragments by design.
    // This happens when the source fragment geometry was degenerated.
    // Therefore, we do not report any warning or error for this case.
    //don't block overall progress because of this -- mark the fragment as success.
    var geomId = svf.fragments.geomDataIndexes[fragId];
    if (geomId === 0) {
        if (material || whichCaller === "material") {
            // A fragment with null-geom may still have a material. If so, we wait for the material before we consider it as finished.
            // This makes sure that we don't count this fragment twice. Note that we cannot just check whichCaller==="fragment" here:
            // This would still cause errors if the material comes in later after onGeomLoadDone().
            this.trackGeomLoadProgress(svf, fragId, false);
        }
        return;
    }

    //We get the matrix from the fragments and we pass it back into setupMesh
    //with the activateFragment call, but this is to maintain the
    //ability to add a plain THREE.Mesh -- otherwise it could be simpler
    rm.getFragmentList().getOriginalWorldMatrix(fragId, this.tmpMatrix);

    var geom = rm.getGeometryList().getGeometry(geomId);
    if (!geom) {

        if (whichCaller === "fragment") {
            //Mesh is not yet available, so we will request it and
            //delay turning on the fragment until it arrives
            this.loadGeometry(geomId, fragId);
        }

        haveToWait = true;
    }

    if (haveToWait)
        return;

    //if (this.options.createWireframe)
    //    createWireframe(geom, this.tmpMatrix);

    var m = this.viewer3DImpl.setupMesh(rm, geom, matHash, this.tmpMatrix);

    // provide correct geometry id. (see GeometryList.setMesh). Note that we cannot use
    // geom.svfid, because geomIds are model-specific and geometries may be shared.
    m.geomId = geomId;

    //If there is a placement transform, we tell activateFragment to also recompute the
    //world space bounding box of the fragment from the raw geometry model box, for a tighter
    //fit compared to what we get when loading the fragment list initially.
    rm.activateFragment(fragId, m, !!svf.placementTransform);

    // pass new fragment to Geometry cache to update priority
    // TODO: Check if we can determine the bbox earlier, so that we can also use it to prioritize load requests
    //       from different OtgLoaders.
    this.viewer3DImpl.geomCache().updateGeomImportance(rm, fragId);

    this.trackGeomLoadProgress(svf, fragId, false);

};

OtgLoader.prototype.onModelRootLoadDone = function(svf) {

    // Mark svf as Oscar-file. (which uses sharable materials and geometry)
    svf.isOTG = true;

    svf.geomMetadata.hashToIndex = {};

    svf.failedFrags = {};
    svf.failedMeshes = {};
    svf.failedMaterials = {};

    svf.geomMemory = 0;
    svf.gpuNumMeshes = 0;
    svf.gpuMeshMemory = 0;
    
    // counts fully loaded fragments (including geometry and material)
    svf.fragsLoaded = 0; 
    
    // number of loaded fragments (also the ones for which we didn't load material and geom yet)  
    svf.fragsLoadedNoGeom = 0; 
    
    svf.nextRepaintPolys = 0;
    svf.numRepaints = 0;

    svf.urn = this.svfUrn;
    svf.acmSessionId = this.acmSessionId;

    svf.basePath = this.basePath;

    svf.loadOptions = this.options || {};

    var t1 = Date.now();
    this.loadTime += t1 - this.t0;
    logger.log("SVF load: " + (t1 - this.t0));

    // Create the API Model object and its render proxy
    var model = this.model = new Model(svf);
    model.loader = this;

    model.initialize();

    this.t0 = t1;

    logger.log("scene bounds: " + JSON.stringify(svf.bbox));

    var metadataStats = {
        category: "metadata_load_stats",
        urn: svf.urn,
        has_topology: !!svf.topology,
        has_animations: !!svf.animations,
        materials: svf.metadata.stats.num_materials,
        is_mobile: isMobileDevice()
    };
    logger.track(metadataStats);

    this.viewer3DImpl.signalProgress(5, ProgressState.ROOT_LOADED, this.model);

    svf.handleHashListRequestFailures(this.loadContext);

    svf.propDbLoader = new PropDbLoader(this.sharedDbPath, this.model, this.viewer3DImpl.api);

    // We don't call invalidate here: At this point, the model is not added to the viewer yet (see onSuccess()
    // in Viewer3D.loadModel). So, invalidating would just let other models flicker.
};


// Returns geometry loading progress in integer percent
function getProgress(svf) {
    return Math.floor(100 * svf.fragsLoaded / svf.metadata.stats.num_fragments);
}

// Called whenever a geom load request is finished or or has failed.
OtgLoader.prototype.trackGeomLoadProgress = function(svf, fragId, failed) {

    if (failed) {
        //TODO: failedFrags can be removed, once we make sure
        //that we are not calling this function with the same fragment twice.
        if (svf.failedFrags[fragId]) {
            console.log("Double fail", fragId);
            return;
        }

        svf.failedFrags[fragId] = 1;
    }

    // Inc geom counter and track progress in percent
    var lastPercent = getProgress(svf);

    svf.fragsLoaded++;

    var curPercent = getProgress(svf);

    // Signal progress, but not for each single geometry. Just if the percent value actually changed.
    if (curPercent > lastPercent) {
        this.viewer3DImpl.signalProgress(curPercent, ProgressState.LOADING, this.model);
        //console.log(curPercent, "%");
        //console.log(svf.fragsLoaded, svf.metadata.stats.num_fragments);
    }

    //repaint every once in a while -- more initially, less as the load drags on.
    var geomList = this.model.getGeometryList();
    if (geomList.geomPolyCount > svf.nextRepaintPolys) {
        //logger.log("num loaded " + numLoaded);
        this.firstPixelTimestamp = this.firstPixelTimestamp || Date.now();
        svf.numRepaints ++;
        svf.nextRepaintPolys += 100000 * Math.pow(1.5, svf.numRepaints);

        // refresh viewer if model is visible
        if (this.viewer3DImpl.modelVisible(this.model.id)) {
            //console.log("Repaint");

            this.viewer3DImpl.invalidate(false, true);
        }
    }

    //console.log(svf.fragsLoaded, svf.metadata.stats.num_fragments);

    // If this was the last geom to receive...
    if (svf.fragsLoaded === svf.metadata.stats.num_fragments) {
        // Signal that we are done with mesh loading
        this.onOperationComplete();
    }

};

OtgLoader.prototype.trackFragmentListLoadProgress = function() {
    
    var svf = this.svf;        
    function getFragListLoadProgress(svf) {
        return Math.floor(100 * svf.fragsLoadedNoGeom / svf.metadata.stats.num_fragments);
    }
    var lastPercent = getFragListLoadProgress(svf);
    svf.fragsLoadedNoGeom++;
    var percent = getFragListLoadProgress(svf);
    
    if (percent > lastPercent) {
        this.options.onFragmentListLoadProgress(this.model, percent);         
    }
};

OtgLoader.prototype.onOperationComplete = function() {
    this.operationsDone++;

    //Destroy the loader if everything we are waiting to load is done
    if (this.operationsDone === 3)
        this.onGeomLoadDone();
};


OtgLoader.prototype.onMaterialLoaded = async function(matObj, matHash, matId) {

    if (!this.loading) {
        // This can only happen if dtor was called while a loadMaterial call is in progress. 
        // In this case, we can just ignore the callback.
        return;
    }

    // get fragIds that need this material
    var fragments = this.pendingMaterials[matHash];

    // Note that onMaterialLoaded is triggered by an EvenListener on geomCache. So, we may also receive calls
    // for materials that we are not wait for, just because other loaders have requested them in parallel.
    // In this case, we must ignore the event.
    if (!fragments) {
        return;
    }

    var matman = this.viewer3DImpl.matman();

    if (matObj) {

        matObj.hash = matHash;
        try {
            var surfaceMat = await matman.convertSharedMaterial(this.model, matObj, matHash);
    
            TextureLoader.loadMaterialTextures(this.model, surfaceMat, this.viewer3DImpl);
    
            if (matman.hasTwoSidedMaterials()) {
                this.viewer3DImpl.renderer().toggleTwoSided(true);
            }
        } catch (e) {
            this.svf.failedMaterials[matHash] = 1;    
        }

    } else {

        this.svf.failedMaterials[matHash] = 1;

    }

    for (var i=0; i < fragments.length; i++) {
        this.tryToActivateFragment(fragments[i], "material");
    }

    this.pendingMaterialsCount--;
    delete this.pendingMaterials[matHash];
};

OtgLoader.prototype.findOrLoadMaterial = function(model, matHash, matId) {

    //check if it's already requested, but the request is not complete
    //
    // NOTE: If another OTG loader adds this material during loading, matman.findMaterial(..) may actually succeed already - even if we have a pending request.
    //       However, we consider the material as missing until the request is finished. In this way, only 2 cases are possible:
    //        a) A material was already loaded on first need => No material requests
    //        b) We requested the material => Once the request is finished, tryToActivate() will be triggered
    //           for ALL fragments using the material - no matter whether the material was added meanwhile by someone else or not.
    //
    //       If we would allow to get materials earlier, it would get very confusing to find out when a fragment is actually finished:
    //       Some fragments would be notified when the load request is done, but some would not - depending on timing.
    if (this.pendingMaterials[matHash]) {
        return false;
    }

    var svf = this.svf;

    //Check if it's already in the material manager
    var matman = this.viewer3DImpl.matman();
    var mat = matman.findMaterial(model, matHash);

    if (mat)
        return true;

    //If it's not even requested yet, kick off the request
    this.pendingMaterialsCount++;
    this.pendingMaterials[matHash] = [];

    var isCDN = !!this.loadContext.otg_cdn;

    var url = svf.makeSharedResourcePath(this.loadContext.otg_cdn, "materials", matHash);

    // load geometry or get it from cache
    var geomCache = this.viewer3DImpl.geomCache();
    geomCache.requestMaterial(url, isCDN, matHash, matId, this.queryParams);

    return false;
};

OtgLoader.prototype.loadGeometry = function(geomIdx, fragId) {

    var svf = this.svf;

    //get the hash string that points to the geometry
    var geomHash = svf.getGeometryHash(geomIdx);

    //check if it's already requested, but the request is not complete
    if (this.pendingMeshes[geomHash]) {
        this.pendingMeshes[geomHash].push(fragId);
        return false;
    }

    //If it's not even requested yet, kick off the request
    this.pendingMeshesCount++;
    this.pendingMeshes[geomHash] = [fragId];

    var isCDN = !!this.loadContext.otg_cdn;


    svf.geomMetadata.hashToIndex[geomHash] = geomIdx;

    var url = svf.makeSharedResourcePath(this.loadContext.otg_cdn, "geometry", geomHash);

    // load geometry or get it from cache
    var geomCache = this.viewer3DImpl.geomCache();
    geomCache.requestGeometry(url, isCDN, geomHash, geomIdx, this.queryParams);
};

OtgLoader.prototype.onMeshError = function(mdata) {

    var geomHash = mdata.error.args.hash;

    this.svf.failedMeshes[geomHash] = 1;

    var frags = this.pendingMeshes[geomHash];

    if (!frags) {
        // The failed mesh has been requested by other loaders, but not by this one.
        return;
    }

    for (var i=0; i < frags.length; i++) {
        this.trackGeomLoadProgress(this.svf, frags[i], true);
    }

    delete this.svf.geomMetadata.hashToIndex[geomHash];
    delete this.pendingMeshes[geomHash];

    this.pendingMeshesCount--;

};

OtgLoader.prototype.onMeshReceived = function(geom) {

    var rm = this.model;

    if (!rm) {
        console.warn("Received geometry after loader was done. Possibly leaked event listener?", geom.hash);
        return;
    }

    var gl = rm.getGeometryList();

    var geomId = this.svf.geomMetadata.hashToIndex[geom.hash];

    //It's possible this fragment list does not use this geometry
    if (geomId === undefined)
        return;

    var geomAlreadyAdded = gl.getGeometry(geomId);

    var frags = this.pendingMeshes[geom.hash];

    //TODO: The instance count implied by frags.length is not necessarily correct
    //because the fragment list is loaded progressively and the mesh could be received
    //before all the fragments that reference it. Here we don't need absolute correctness.
    if (!geomAlreadyAdded)
        gl.addGeometry(geom, (frags && frags.length) || 1, geomId);
    else
        return; //geometry was already received, possibly due to sharing with the request done by another model loader in parallel

    if (this.svf.loadDone) {
        console.error("Geometry received after load was done");
    }

    for (var i=0; i < frags.length; i++) {
        this.tryToActivateFragment(frags[i], "geom");
    }

    delete this.svf.geomMetadata.hashToIndex[geom.hash];
    delete this.pendingMeshes[geom.hash];
    this.pendingMeshesCount--;
};


OtgLoader.prototype.onGeomLoadDone = function() {
    this.svf.loadDone = true;

    // Stop listening to geometry receive events. Since all our geometry is loaded, any subsequent geom receive
    // events are just related to requests from other loaders.
    this.removeMeshReceiveListener();

    //Note that most materials are probably done already as their geometry
    //is received, so this logic will most likely just trigger the textureLoadComplete event.
    TextureLoader.loadModelTextures(this.model, this.viewer3DImpl);

    //If we were asked to just load the model root / metadata, bail early.
    if (this.options.skipMeshLoad) {
        this.currentLoadPath = null;
        this.viewer3DImpl.onLoadComplete(this.model);
        return;
    }

    // We need to keep a copy of the original fragments
    // transforms in order to restore them after explosions, etc.
    // the rotation/scale 3x3 part.
    // TODO: consider only keeping the position vector and throwing out
    //
    //delete this.svf.fragments.transforms;

    // Release that won't be used. the on demand loading won't call this anyway.
    this.svf.fragments.entityIndexes = null;
    this.svf.fragments.mesh2frag = null;
    this.svf.geomMetadata.hashes = null;

    var t1 = Date.now();
    var msg = "Fragments load time: " + (t1 - this.t0);
    this.loadTime += t1 - this.t0;

    var firstPixelTime = this.firstPixelTimestamp - this.t0;
    msg += ' (first pixel time: ' + firstPixelTime + ')';

    logger.log(msg);

    // Run optional consolidation step
    if (this.options.useConsolidation) {
        this.viewer3DImpl.consolidateModel(this.model, this.options.consolidationMemoryLimit);
    }

    var modelStats = {
        category: "model_load_stats",
        is_f2d: false,
        has_prism: this.viewer3DImpl.matman().hasPrism,
        load_time: this.loadTime,
        geometry_size: this.model.getGeometryList().geomMemory,
        meshes_count: this.svf.metadata.stats.num_geoms,
        fragments_count: this.svf.metadata.stats.num_fragments,
        urn: this.svfUrn
    };
    if (firstPixelTime > 0) {
        modelStats['first_pixel_time'] = firstPixelTime; // time [ms] from SVF load to first geometry rendered
    }
    logger.track(modelStats, true);

    const geomList = this.model.getGeometryList();
    const dataToTrack = {
        load_time: this.loadTime,
        polygons: geomList.geomPolyCount,
        fragments: this.model.getFragmentList().getCount(),
        mem_usage: geomList.gpuMeshMemory,
        time_to_first_pixel: this.firstPixelTimestamp - this.t0,
        viewable_type: '3d',
    };         
    avp.analytics.track('viewer.model.loaded', dataToTrack);





    this.currentLoadPath = null;

    this.viewer3DImpl.onLoadComplete(this.model);
};

OtgLoader.prototype.loadPropertyDb = function() {
    this.svf.propDbLoader.load();
};


OtgLoader.prototype.is3d = function() {
    return true;
};

OtgLoader.loadOnlyOtgRoot = function(path, options) {

    // create loadContext
    const basePath    = getBasePath(path);
    const queryParams = getQueryParams(options)
    const loadContext = createLoadContext(options, basePath, queryParams);

    // init otg package
    const otg = new OtgPackage();
    otg.basePath = basePath;

    // Just load root json and process its metadata
    const url = pathToURL(path);
    return new Promise((resolve) => {
        otg.loadAsyncResource(loadContext, url, "json", function(data) {
            otg.metadata = data;
            otg.manifest = data.manifest;

            // Set numGeoms. Note that this must happen before creating the GeometryList.
            otg.numGeoms = otg.metadata.stats.num_geoms;

            otg.processMetadata(loadContext);

            resolve(otg);
        });
    });
};

// Right after model loading, some fragment data are not available yet.
// E.g. fragments.fragId2DbId will initially contain only zeros and graudally filled afterwards.
// Note that waiting for fragment data doesn't guarantee yet that geometry and materials are already loaded too.
//  @returns {boolean} True when finished, false when canceled or failed.
OtgLoader.prototype.waitForFragmentData = async function() {

    if (this.fragmentDataLoaded) {
        return true;
    }

    const viewer = this.viewer3DImpl.api;
    const scope = this;
    return await new Promise(function (resolve) {

        const clearListeners = () => {
            viewer.removeEventListener(av.MODEL_ROOT_LOADED_EVENT, onLoad);
            viewer.removeEventListener(av.MODEL_UNLOADED_EVENT, onUnload);
        };

        const onLoad = (e) => {
            if (e.model.loader !== scope) {
                return;
            }

            clearListeners();
            resolve(true);
        };

        const onUnload = (e) => {
            if (e.model.loader !== scope) {
                return;
            }

            clearListeners();
            resolve(false);
        };

        // Use the following method.
        // av.waitForCompleteLoad(viewer, options)
        viewer.addEventListener(av.MODEL_ROOT_LOADED_EVENT, onLoad);
        viewer.addEventListener(av.MODEL_UNLOADED_EVENT, onUnload);
    });
}

FileLoaderManager.registerFileLoader("json", ["json"], OtgLoader);
