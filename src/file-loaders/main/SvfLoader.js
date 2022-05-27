import { isNodeJS, isMobileDevice } from "../../compat";
import { logger } from "../../logger/Logger";
import { LmvMatrix4 } from "../../wgs/scene/LmvMatrix4";
import {ErrorCodes, errorCodeString} from "../net/ErrorCodes";
import { BVHBuilder, NodeArray } from "../../wgs/scene/BVHBuilder";
import { MeshFlags } from '../../wgs/scene/MeshFlags';
import { BufferGeometryUtils } from "../../wgs/scene/BufferGeometry";
import { MaterialConverter } from "../../wgs/render/MaterialConverter";
import { pathToURL } from "../net/Xhr";
import { PropDbLoader } from "./PropDbLoader";
import { TextureLoader } from "./TextureLoader";
import { initWorkerScript, createWorkerWithIntercept } from "./WorkerCreator";
import * as et from "../../application/EventTypes";
import { Model } from "../../application/Model";
import * as THREE from "three";

import { FileLoaderManager } from "../../application/FileLoaderManager";
import { initLoadContext } from "../net/endpoints";
import { ProgressState } from '../../application/ProgressState';

var av = Autodesk.Viewing;
const avp = av.Private;

var NUM_WORKER_THREADS = isNodeJS() ? 10 : (isMobileDevice() ? 2 : 6);
var WORKER_LOAD_GEOMETRY = "LOAD_GEOMETRY";
var WORKER_LOAD_SVF = "LOAD_SVF";
var WORKER_LOAD_SVF_CONTD = "LOAD_SVF_CONTD";
var WORKER_FETCH_TOPOLOGY = "FETCH_TOPOLOGY";


/** @constructor */
export var SvfLoader = function (parent) {
    this.viewer3DImpl = parent;
    this.next_pack = 0;
    this.loading = false;
    this.loadedPacksCount = 0;
    this.tmpMatrix = new THREE.Matrix4();
    this.tmpBox = new THREE.Box3();
    this.fetchingTopology = false;
    this.loadTime = 0;
    this.notifiesFirstPixel = true;
};

SvfLoader.prototype.dtor = function () {
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
    if (this.svfWorker) {
        this.svfWorker.clearAllEventListenerWithIntercept();
        this.svfWorker.terminate();
        this.svfWorker = null;
        logger.debug("SVF loader dtor: on svf worker.");
    }

    // 3. load geometry pack files can be cancelled.
    //
    if (this.pack_workers) {
        for (var i=0; i<this.pack_workers.length; i++) {
            this.pack_workers[i].clearAllEventListenerWithIntercept();
            this.pack_workers[i].terminate();
        }
        this.pack_workers = null;
        logger.debug("SVF loader dtor: on geom worker.");
    }

    // 4. load property can be cancelled.
    //
    if (this.svf && this.svf.propDbLoader) {
        this.svf.propDbLoader.dtor();
        this.svf.propDbLoader = null;
    }

    // and clear metadata.
    this.tmpMatrix = null;
    this.tmpBox = null;

    this.svf = null;
    this.model = null;
    this.next_pack = 0;
    this.loading = false;
    this.loadedPacksCount = 0;
    this.loadTime = 0;
    this.viewer3DImpl = null;
};

// methods added so SvfLoaderML can use override and use other SvfLoader methods
// These are called from SvfLoader methods

// initialize the worker script
SvfLoader.prototype.initWorkerScript = initWorkerScript;

// Create a worker.
SvfLoader.prototype.createWorkerWithIntercept = createWorkerWithIntercept;

// Start loading the packfiles with the workers
SvfLoader.prototype.startWorkers = function() {
    var svf = this.svf;
    var count = Math.min(svf.geompacks.length, av.NUM_WORKER_THREADS || NUM_WORKER_THREADS);
    for (var i=0; i<count; i++) {
        var pf = svf.geompacks[this.next_pack++];
        pf.loading = true;
        if (isNodeJS()) {
            this.loadGeometryPack(pf.id, pf.uri);
        } else {
            ((pf) => {
                setTimeout(() => {this.loadGeometryPack(pf.id, pf.uri);}, i * 200);
            })(pf);
        }
    }
};

// create and initialize the model
SvfLoader.prototype.createModel = function(svf) {
    var model = this.model = new Model(svf);
    model.loader = this;

    model.initialize();
    return model;
};

// End SvfLoaderML specific methods

SvfLoader.prototype.isValid = function() {
    return this.viewer3DImpl;
};


SvfLoader.prototype.loadFile = function(path, options, onDone, onWorkerStart) {

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

    var index = path.indexOf('urn:');
    if (index != -1) {
        // Extract urn:adsk.viewing:foo.bar.whateverjunks out of the path URL and bind it to logger.
        // From now on, we can send logs to viewing service, and logs are grouped by urn to make Splunk work.
        path = decodeURIComponent(path);
        var urn = path.substr(index, path.substr(index).indexOf('/'));
        logger.log("Extracted URN: " + urn);

        // Extract urn(just base64 code)
        var _index = urn.lastIndexOf(':');
        this.svfUrn = urn.substr(_index + 1);
    } else {
        this.svfUrn = path;
    }

    this.sharedDbPath = options.sharedPropertyDbPath;

    this.currentLoadPath = path;
    var lastSlash = this.currentLoadPath.lastIndexOf("/");
    if (lastSlash != -1)
        this.basePath = this.currentLoadPath.substr(0, lastSlash+1);

    this.acmSessionId = options.acmSessionId;

    this.queryParams = "";
    if (this.acmSessionId) {
        this.queryParams = "acmsession=" + this.acmSessionId;
    }

    this.options = options;

    var scope = this;
    this.initWorkerScriptToken = this.initWorkerScript(function() {
        scope.loadSvfCB(path, options, onDone, onWorkerStart);
    });

    return true;
};

SvfLoader.prototype.loadSvfCB = function(path, options, onDone, onWorkerStart) {
    this.t0 = new Date().getTime();
    this.firstPixelTimestamp = null;
    this.failedToLoadSomeGeometryPacks = null;
    this.failedToLoadPacksCount = 0;
    var first = true;

    var scope = this;
    var msg = {
        url: pathToURL(path),
        basePath: this.currentLoadPath,
        objectIds : options.ids,
        globalOffset : options.globalOffset,
        fragmentTransformsDouble: options.fragmentTransformsDouble,
        placementTransform : options.placementTransform,
        applyRefPoint: options.applyRefPoint,
        queryParams : this.queryParams,
        bvhOptions : options.bvhOptions || {isWeakDevice : isMobileDevice()},
        applyScaling: options.applyScaling,
        applyPlacementInModelUnits: options.applyPlacementInModelUnits,
        loadInstanceTree: options.loadInstanceTree
    };

    this.viewer3DImpl._signalNoMeshes();

    var w = this.svfWorker = this.createWorkerWithIntercept();

    var onSVFLoad = async function (ew) {
        var cleaner = function() {
            w.clearAllEventListenerWithIntercept();
            w.terminate();
            scope.svfWorker = null;
            w = null;
        };

        if (first && onWorkerStart) {
            first = false;
            onWorkerStart();
        }

        if (ew.data && ew.data.manifest) {

            scope.interceptManifest(ew.data.manifest);
            msg.operation = WORKER_LOAD_SVF_CONTD;
            msg.manifest = ew.data.manifest;
            w.doOperation(msg);
        } else if (ew.data && ew.data.svf) {
            //Decompression is done.
            var svf = scope.svf = ew.data.svf;

            if (scope.failedToLoadSomeGeometryPacks) {
                // Report a warning. It is not a fatal error.
                if (onDone) {
                    onDone(scope.failedToLoadSomeGeometryPacks);
                }
                scope.failedToLoadSomeGeometryPacks = null;
            }

            await scope.onModelRootLoadDone(svf);

            if (onDone) {
                onDone(null, scope.model);
            }

            scope.viewer3DImpl.api.dispatchEvent({type:et.MODEL_ROOT_LOADED_EVENT, svf:svf, model:scope.model});

            svf.loadDone = false;

            var isGltf = false;
            if (svf.metadata && svf.metadata.gltf) {
                isGltf = true;
            }

            if (!isGltf) {
                if (svf.geompacks.length == 0) {
                    scope.onGeomLoadDone();
                }
                else {
                    scope.startWorkers();
                }
            }

            if (ew.data.progress == 1) {
                scope.loading = false;
                cleaner();
            }

            if (!svf.fragments.polygonCounts)
                svf.fragments.polygonCounts = new Int32Array(svf.fragments.length);

            // Set bvh to svf, if it is posted with svf together.
            if (ew.data.bvh) {
                svf.bvh = ew.data.bvh;
                scope.model.setBVH(new NodeArray(svf.bvh.nodes, svf.bvh.useLeanNodes), svf.bvh.primitives, scope.options.bvhOptions);
                scope.viewer3DImpl.invalidate(false, true);
            }

        } else if (ew.data && ew.data.bvh) {
            //Spatial index was done by the worker:
            if (scope.svf && !scope.svf.bvh) {
                scope.svf.bvh = ew.data.bvh;
                scope.model.setBVH(new NodeArray(scope.svf.bvh.nodes, scope.svf.bvh.useLeanNodes), scope.svf.bvh.primitives, scope.options.bvhOptions);
                scope.viewer3DImpl.invalidate(false, true);
            }
            scope.loading = false;
            cleaner();
        } else if (ew.data && ew.data.mesh) {
            //GLTF loader sends meshes from the main loader thread
            scope.processReceivedMesh(ew.data);

            if (ew.data.progress === 1) {
                scope.onGeomLoadDone();
                scope.loading = false;
                cleaner();
            }
        } else if (ew.data && ew.data.progress) {
            if (ew.data.progress == 1) {
                scope.loading = false;
                cleaner();
            }
        } else if (ew.data && ew.data.error) {
            scope.loading = false;
            cleaner();
            logger.error("Error while processing SVF: " + JSON.stringify(ew.data.error.args));
            if (onDone) {
                onDone(ew.data.error, null);
            }
        } else if (ew.data && ew.data.debug) {
            logger.debug(ew.data.message);
        } else {
            logger.error("SVF download failed.", errorCodeString(ErrorCodes.NETWORK_FAILURE));
            //Download failed.
            scope.loading = false;
            cleaner();
        }
    };

    w.addEventListenerWithIntercept(onSVFLoad);

    msg.operation = WORKER_LOAD_SVF;
    msg.interceptManifest = !!this.interceptManifest;
    w.doOperation(initLoadContext(msg));

    return true;
};

SvfLoader.prototype.loadGeometryPack = function (packId, path) {
    var w;
    var workerId;
    var i, j;
    var scope = this;

    // If loader is already destructed, do nothing.
    if(!this.svf || !this.isValid()) {
        return;
    }

    var onMeshLoad = function (ew) {
        if (ew.data && ew.data.meshes) {

            var meshes = ew.data.meshes;

            var mdata = {
                packId: ew.data.packId,
                meshIndex: 0,
                mesh:null
            };

            for (var i=0; i<meshes.length; i++) {
                var mesh = meshes[i];

                if (!mesh)
                    continue;

                mdata.meshIndex = i;
                mdata.mesh = mesh;

                scope.processReceivedMesh(mdata);
            }

            //Is the worker done loading the geom pack?
            if (ew.data.progress >= 1.0) {
                scope.pack_workers[ew.data.workerId].queued -= 1;

                scope.loadedPacksCount++;
                scope.viewer3DImpl.signalProgress(100 * scope.loadedPacksCount / scope.svf.geompacks.length, ProgressState.LOADING, scope.model);

                //Are all workers done?
                var isdone = true;
                for (j = 0; j < scope.pack_workers.length; j++) {
                    if (scope.pack_workers[j].queued != 0) {
                        isdone = false;
                        break;
                    }
                }

                if (isdone) {
                    for (j = 0; j < scope.pack_workers.length; j++) {
                        scope.pack_workers[j].clearAllEventListenerWithIntercept();
                        scope.pack_workers[j].terminate();
                    }
                    scope.pack_workers = null;
                }

                if (scope.loadedPacksCount + scope.failedToLoadPacksCount == scope.svf.geompacks.length) { //all workers are done?
                    scope.onGeomLoadDone();
                }
            }
        } else if (ew.data && ew.data.progress) {
            //download is done, queue the next download
            scope.pack_workers[ew.data.workerId].queued -= 1;

            if (scope.next_pack < scope.svf.geompacks.length) {

                var pf = null;

                if(!pf || pf.loading) {
                    while(scope.next_pack < scope.svf.geompacks.length) {
                        pf = scope.svf.geompacks[scope.next_pack++];
                        if(!pf.loading) {
                            break;
                        }
                    }
                }

                if(pf && !pf.loading) {
                    pf.loading = true;
                    scope.loadGeometryPack(pf.id, pf.uri);
                }
                else {
                    scope.viewer3DImpl.modelQueue().enforceBvh = false;
                    scope.svf.fragments.packIds = null; // not needed anymore
                }
            }
        } else if (ew.data && ew.data.debug) {
            logger.debug(ew.data.message);
        } else if (ew.data && ew.data.error) {
            ++scope.failedToLoadPacksCount;
            scope.failedToLoadSomeGeometryPacks = {code:ew.data.error.code, msg:ew.data.error.msg};
        } else {
            //Download failed.
            scope.pack_workers[ew.data.workerId].queued -= 2;
        }
    };

    var pw = this.pack_workers;
    if (!pw) {
        pw = this.pack_workers = [];
    }

    //If all workers are busy and we are allowed to create more, then create a new one
    if (pw.length < (av.NUM_WORKER_THREADS || NUM_WORKER_THREADS)) {
        var allBusy = true;
        for (i=0; i<pw.length; i++) {
            if (pw[i].queued === 0) {
                allBusy = false;
                break;
            }
        }

        if (allBusy) {
            var wr = this.createWorkerWithIntercept();
            wr.addEventListenerWithIntercept(onMeshLoad);
            wr.queued = 0;
            pw.push(wr);
        }
    }

    //Find the least busy worker
    var which = 0;
    var queued = pw[0].queued;
    for (i = 1; i < pw.length; i++) {
        if (pw[i].queued < queued) {
            which = i;
            queued = pw[i].queued;
        }
    }
    w = pw[which];
    w.queued += 2;
    workerId = which;


    //Pass unzip job to the worker
    var reqPath = pathToURL(this.svf.basePath + path);
    var xfer = { "operation":WORKER_LOAD_GEOMETRY,
                "url": reqPath,
                "packId": parseInt(packId), /* mesh IDs treat the pack file id as integer to save on storage in the per-fragment arrays */
                "workerId": workerId,
                "createWireframe" : this.options.createWireframe ||
                                    this.model.getMetadata('renderEnvironmentDisplayEdges', 'value', false),
                "packNormals": this.options.packNormals,
                "queryParams" : this.queryParams };

    w.doOperation(initLoadContext(xfer)); // Send data to our worker.
};


SvfLoader.prototype.processReceivedMesh = function(mdata) {
    //Find all fragments that instance this mesh
    var meshid = mdata.packId + ":" + mdata.meshIndex;

    var svf = this.svf;
    var fragments = svf.fragments;
    var rm = this.model;

    var fragIndexes = fragments.mesh2frag[meshid];
    if (fragIndexes === undefined) {
        logger.warn("Mesh " + meshid + " was not referenced by any fragments.");
        return;
    }
    if (!Array.isArray(fragIndexes))
        fragIndexes = [fragIndexes];

    //Convert the received mesh to THREE buffer geometry
    BufferGeometryUtils.meshToGeometry(mdata);
    mdata.geometry.packId = mdata.packId;

    var numInstances = fragIndexes.length;

    //Reuse previous index of this geometry, if available
    var idx = rm.getFragmentList().getGeometryId(fragIndexes[0]);
    var geomId = rm.getGeometryList().addGeometry(mdata.geometry, numInstances, idx);

    var ib = mdata.geometry.index.array || mdata.geometry.ib;
    var polyCount = ib.length / 3;

    //For each fragment, add a mesh instance to the renderer
    for (var i=0; i<fragIndexes.length; i++) {
        var fragId = 0|fragIndexes[i];

        // option: skip meshes if they are marked as hidden
        if (svf.loadOptions.skipHiddenFragments) {
            var isHidden = !(fragments.visibilityFlags[fragId] & MeshFlags.MESH_VISIBLE);
            if (isHidden) {
                continue;
            }
        }

        //We get the matrix from the fragments and we set it back there
        //with the activateFragment call, but this is to maintain the
        //ability to add a plain THREE.Mesh -- otherwise it could be simpler
        rm.getFragmentList().getOriginalWorldMatrix(fragId, this.tmpMatrix);

        var materialId = fragments.materials[fragId].toString();

        var mat = this.viewer3DImpl.matman().findMaterial(rm, materialId);

        if (mat && !mat.texturesLoaded)
            TextureLoader.loadMaterialTextures(rm, mat, this.viewer3DImpl);

        if (fragments.polygonCounts)
            fragments.polygonCounts[fragId] = polyCount;

        var m = this.viewer3DImpl.setupMesh(this.model, mdata.geometry, materialId, this.tmpMatrix);

        //If there is a placement transform, we tell activateFragment to also recompute the
        //world space bounding box of the fragment from the raw geometry model box, for a tighter
        //fit compared to what we get when loading the fragment list initially.
        rm.activateFragment(fragId, m, !!svf.placementTransform);
    }

    //Call a custom mesh processing callback if one is supplied.
    //This is used for streaming geometry pack processing in node.js tools.
    //We are avoiding a more generic fireEvent mechanism in the interests of performance.
    //TODO: In the future, consider skipping all the geometry adding logic above
    //if such a callback is given -- it's most likely it only needs to look at the geometry then drop it
    if (this.options.onMeshReceived) {
        this.options.onMeshReceived(this.model, geomId, fragIndexes /*, mdata.geometry*/);
    }

    //don't need this mapping anymore.
    fragments.mesh2frag[meshid] = null;

    //Repaint and progress reporting
    fragments.numLoaded += fragIndexes.length;

    this.viewer3DImpl._signalMeshAvailable();

    //repaint every once in a while -- more initially, less as the load drags on.
    var geomList = rm.getGeometryList();
    if (geomList.geomPolyCount > svf.nextRepaintPolys) {
        //logger.log("num loaded " + numLoaded);
        this.firstPixelTimestamp = this.firstPixelTimestamp || Date.now();
        svf.numRepaints ++;
        svf.nextRepaintPolys += 10000 * Math.pow(1.5, svf.numRepaints);
        this.viewer3DImpl.invalidate(false, true);
    }
};

    //Some insane files come without any material reuse
    //which means we end up with ten of thousands of material objects
    //that are all the same. Create a re-mapping that gives a single ID
    //for all material IDs whose materials are duplicates
    /* currently not used
    function deduplicateMaterials(svf) {

    var mats = svf.materials.materials;

    var dedup = {};
    var remap = [];
    var count = 0;
    var ucount = 0;

    for (var p in mats) {

        var matIdx = parseInt(p);
        var hash = JSON.stringify(mats[p]);

        var idx = dedup[hash];

        if (idx === undefined) {
            remap[matIdx] = matIdx;
            dedup[hash] = matIdx;
            ucount++;
        } else {
            remap[matIdx] = idx;
            mats[p].duplicateOf = idx;
        }

        count++;
    }

    logger.log("Total mats: " + count + " Unique mats:" + ucount);

    var fmats = svf.fragments.materials;
    for (var i=0; i<fmats.length; i++) {
        fmats[i] = remap[fmats[i]];
    }

    return remap;
}
*/

SvfLoader.prototype.onModelRootLoadDone = async function(svf) {

    svf.geomMemory = 0;
    svf.fragments.numLoaded = 0;
    svf.gpuNumMeshes = 0;
    svf.gpuMeshMemory = 0;

    svf.nextRepaintPolys = 0;
    svf.numRepaints = 0;

    svf.urn = this.svfUrn;
    svf.acmSessionId = this.acmSessionId;

    svf.basePath = this.basePath;

    svf.loadOptions = this.options;

    if (svf.verylargebbox) {
        this.viewer3DImpl.setNearRadius(this.options.nearRadius || 1);
    }

    //var tM = Date.now();
    //deduplicateMaterials(svf);

    var t1 = Date.now();
    this.loadTime += t1 - this.t0;
    logger.log("SVF load: " + (t1 - this.t0));
    //logger.log("Material dedup: " + (t1 - tM));

    // Create the API Model object and its render proxy
    var model = this.createModel(svf);

    //For 3D models, we can start loading the property database as soon
    //as we know the fragment list which contains the fragId->dbId map.
    if (!this.options.skipPropertyDb) {
        this.loadPropertyDb();
    }

    var numMaterials = await this.convertMaterials(model);

    if (this.viewer3DImpl.matman().hasTwoSidedMaterials()) {
        this.viewer3DImpl.renderer().toggleTwoSided(true);
    }

    this.t1 = t1;

    //The BBox object loses knowledge of its
    //type when going across the worker thread boundary...
    svf.bbox = new THREE.Box3().copy(svf.bbox);

    if (svf.refPointTransform) {
        svf.refPointTransform = new LmvMatrix4(true).copy(svf.refPointTransform);
    }
    if (svf.placementTransform) {
        svf.placementTransform = new LmvMatrix4(true).copy(svf.placementTransform);
    }
    if (svf.placementWithOffset) {
        svf.placementWithOffset = new LmvMatrix4(true).copy(svf.placementWithOffset);
    }

    //Camera vectors also lose their prototypes when they
    //cross the thread boundary...
    if (svf.cameras) {
        for (var i = 0; i < svf.cameras.length; i++) {
            var camera = svf.cameras[i];
            camera.position = new THREE.Vector3().copy(camera.position);
            camera.target = new THREE.Vector3().copy(camera.target);
            camera.up = new THREE.Vector3().copy(camera.up);

            // We have a case of a camera coming in with Nans for position and target. Not sure what to do in that case.
            if (!isFinite(camera.position.x + camera.position.y + camera.position.z
                + camera.target.x + camera.target.y + camera.target.z
                + camera.up.x + camera.up.y + camera.up.z)) {
                // Some coordinate in position, target or up is junk. Scrap them. Put the target at
                // the center of the bounding box and the position outside of the bounding box.
                camera.target = svf.bbox.getCenter(new THREE.Vector3());
                camera.position.copy(camera.target);
                camera.position.z += svf.bbox.max.z - svf.bbox.min.z;
                camera.up = { x:0, y: 1, z: 0};
            }
            if (!isFinite(camera.aspect)) {
                camera.aspect = 1;
            }
            if (!isFinite(camera.fov)) {
                camera.fov = 90;
            }
            if (!isFinite(camera.orthoScale)) {
                camera.orthoScale = 1;
            }
        }
    }

    //If the textures are likely to come from the Protein CDN
    //load them in parallel with the geometry packs
    //if (svf.proteinMaterials && PROTEIN_ROOT && PRISM_ROOT) {
    //    TextureLoader.loadModelTextures(this.model, this.viewer3DImpl);
    //}

    logger.log("scene bounds: " + JSON.stringify(svf.bbox));

    var metadataStats = {
        category: "metadata_load_stats",
        urn: svf.urn,
        has_topology: !!svf.topologyPath,
        has_animations: !!svf.animations,
        cameras: svf.cameras ? svf.cameras.length : 0,
        lights: svf.lights ? svf.lights.length : 0,
        materials: numMaterials,
        is_mobile: isMobileDevice()
    };
    logger.track(metadataStats);

    this.viewer3DImpl.signalProgress(5, ProgressState.ROOT_LOADED, this.model);
    this.viewer3DImpl.invalidate(false, false);
};


/**
 * Converts from SVF materials json to THREE.js materials and adds them to the MaterialManager
 * @param {RenderModel} model
 */
SvfLoader.prototype.convertMaterials = async function(model) {

    var matman = this.viewer3DImpl.matman();
    var svf = model.getData();
    var totalAdded = 0;
    var p;

    if (!svf.materials) {
        return totalAdded;
    }

    if (svf.gltfMaterials) {

        var gltfmats = svf.materials["materials"];
        for (p in gltfmats) {

            var gltfMat = gltfmats[p];
            var phongMat = MaterialConverter.convertMaterialGltf(gltfMat, svf);
            var matName = matman._getMaterialHash(model, p);
            matman.addMaterial(matName, phongMat, false);
            totalAdded++;
        }

        return totalAdded;
    }

    // Get outer Protein materials block.
    // The way this works: there is always (supposed to be) a Materials.json file in SVF. This
    // is put into svf.materials["materials"]. There is also, optionally, a ProteinMaterials.json
    // file, read into svf.proteinMaterials["materials"]. We look through the Protein materials
    // (if present) and see which ones we can interpret (currently only PRISM materials). If we
    // can interpret it, great. Otherwise, we use the Materials.json file's version, which is
    // (always) a SimplePhong material.
    var mats = svf.materials["materials"];
    var prismmats = svf.proteinMaterials ? svf.proteinMaterials["materials"] : null;

    for (p in mats) {

        var isPrism = prismmats && prismmats[p] && MaterialConverter.isPrismMaterial(prismmats[p]);

        //If the definition is prism, use the prism object.
        var matObj = isPrism ? prismmats[p] : mats[p];

        await matman.convertOneMaterial(model, matObj, matman._getMaterialHash(model, p));

        totalAdded++;
    }

    return totalAdded;
};


SvfLoader.prototype.makeBVH = function(svf) {
    var t0 = performance.now();
    var mats = svf.materials ? svf.materials["materials"] : null;
    svf.bvh = new BVHBuilder(svf.fragments, mats);
    svf.bvh.build(this.options.bvhOptions || {isWeakDevice : isMobileDevice()});
    var t1 = performance.now();
    logger.log("BVH build time: " + (t1 - t0));
};


SvfLoader.prototype.onGeomLoadDone = function() {
    this.svf.loadDone = true;

    //launch the texture loads in case that was not done already
    //Note that most materials are probably done already as their geometry
    //is received, so this logic will most likely just trigger the textureLoadComplete event.
    TextureLoader.loadModelTextures(this.model, this.viewer3DImpl);

    // We need to keep a copy of the original fragments
    // transforms in order to restore them after explosions, etc.
    // the rotation/scale 3x3 part.
    // TODO: consider only keeping the position vector and throwing out
    //
    //delete this.svf.fragments.transforms;

    // Release that won't be used. the on demand loading won't call this anyway.
    this.svf.fragments.entityIndexes = null;
    this.svf.fragments.mesh2frag = null;

    // flags for initial visibility have now all been processed
    this.svf.fragments.visibilityFlags = null;

    var t1 = Date.now();
    var msg = "Fragments load time: " + (t1 - this.t1);
    this.loadTime += t1 - this.t0;

    var firstPixelTime = this.firstPixelTimestamp - this.t0;
    msg += ' (first pixel time: ' + firstPixelTime + ')';

    //If there is a post-transform, the BVH has to be computed after
    //all the world transforms/boxes are updated
    if (!this.svf.bvh || this.svf.placementTransform) {
        this.makeBVH(this.svf);
        this.model.setBVH(this.svf.bvh.nodes, this.svf.bvh.primitives, this.options.bvhOptions);
    }
    logger.log(msg);

    // Run optional consolidation step
    if (this.options.useConsolidation)
        this.viewer3DImpl.consolidateModel(this.model, this.options.consolidationMemoryLimit);

    var modelStats = {
        category: "model_load_stats",
        is_f2d: false,
        has_prism: this.viewer3DImpl.matman().hasPrism,
        load_time: this.loadTime,
        geometry_size: this.model.getGeometryList().geomMemory,
        meshes_count: this.model.getGeometryList().geoms.length,
        fragments_count: this.model.getFragmentList().getCount(),
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
        viewable_type: '3d',
    }   
    avp.analytics.track('viewer.model.loaded', dataToTrack);
    
    this.currentLoadPath = null;

    this.viewer3DImpl.onLoadComplete(this.model);
};


SvfLoader.prototype.loadPropertyDb = function() {
    this.svf.propDbLoader = new PropDbLoader(this.sharedDbPath, this.model, this.viewer3DImpl.api);
    this.svf.propDbLoader.load();
};

SvfLoader.prototype.fetchTopologyFile = function(fullpath, onComplete) {

    if (this.fetchingTopology)
        return;

    this.fetchingTopology = true;

    var ww = this.createWorkerWithIntercept();
    ww.addEventListenerWithIntercept( onTopology );

    var msg = {
        path: fullpath,
        queryParams : this.queryParams,
    };
    var t0 = new Date().getTime();
    var t1, t2, timeSpan;
    logger.log('Fetching topology file...');
    msg.operation = WORKER_FETCH_TOPOLOGY;
    ww.doOperation(initLoadContext(msg));

    var that = this;
    function onTopology(workerEvent) {

        // Status check
        if (workerEvent.data['status-topology']) {
            t1 = new Date().getTime();
            timeSpan = Math.round((t1-t0)/1000);
            logger.log('Topology file downloaded. (' + timeSpan + ' seconds). Processing...');
            return;
        }

        // Done processing.
        var topoData = workerEvent.data['fetch-topology'];
        if (topoData) {
            t2 = new Date().getTime();
            timeSpan = Math.round((t2-t1)/1000);
            if (topoData.topology) {
                logger.log('Topology file processed successfully! (' + timeSpan + ' seconds).');
            } else {
                logger.log('Topology file processed, but an error ocurred. (' + timeSpan + ' seconds).');
            }
            onComplete( topoData );
            that.fetchingTopology = false;
            ww.clearAllEventListenerWithIntercept();
            ww.terminate();
            ww = null;
        }
    }
};

SvfLoader.prototype.is3d = function() {
    return true;
};


// If you change the fileLoaderId or the extensions, then make sure you make
// the same change in extensions/MemoryLimited/MemoryLimited.js
FileLoaderManager.registerFileLoader("svf", ["svf"], SvfLoader);
