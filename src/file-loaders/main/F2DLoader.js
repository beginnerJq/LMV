
import { logger } from "../../logger/Logger";
import { BufferGeometryUtils } from "../../wgs/scene/BufferGeometry";
import { errorCodeString, ErrorCodes } from "../net/ErrorCodes";
import { ProgressState } from "../../application/ProgressState";
import { FileLoaderManager } from "../../application/FileLoaderManager";
import { pathToURL } from '../net/Xhr';
import { initWorkerScript, createWorker } from "./WorkerCreator";
import { PropDbLoader } from "./PropDbLoader";
import { isMobileDevice } from "../../compat";
import * as et from "../../application/EventTypes";
import { TextureLoader } from "./TextureLoader";
import { endpoint } from "../net/endpoints";
import { Model } from "../../application/Model";
import * as THREE from "three";


var WORKER_PARSE_F2D = "PARSE_F2D";
var WORKER_STREAM_F2D = "STREAM_F2D";
var WORKER_PARSE_F2D_FRAME = "PARSE_F2D_FRAME";
const avp = Autodesk.Viewing.Private;

export const OUTPUT_TYPE = {
    GEOMETRY : "geometry", 
    VERTEX_BUFFER : "vertexBuffer", 
};

/** @constructor */
export function F2DLoader(parent) {
    this.viewer3DImpl = parent;
    this.loading = false;
    this.tmpMatrix = new THREE.Matrix4();

    this.logger = logger;
    this.loadTime = 0;
}

F2DLoader.prototype.dtor = function () {
    // Cancel all potential process on loading a file.

    // 1. init worker script can be cancelled. 
    // 
    if (this.initWorkerScriptToken) {
        this.initWorkerScriptToken.cancel();
        this.initWorkerScriptToken = null;
        logger.debug("F2D loader dtor: on init worker script.");
    }

    // 2. Streaming F2D data can be cancelled. 
    if (this.streamingWorker) {
        this.streamingWorker.terminate();
        this.streamingWorker = null;
        logger.debug("F2D loader dtor: on streaming worker.");
    }

    // 3. Parsing F2D geometry can be cancelled.
    if (this.parsingWorker) {
        this.parsingWorker.terminate();
        this.parsingWorker = null;
        logger.debug("F2D loader dtor: on parsing worker.");
    }

    // 4. Property loading can be cancelled.
    if (this.svf && this.svf.propDbLoader) {
        this.svf.propDbLoader.dtor();
        this.svf.propDbLoader = null;
    }   

    // And clear metadata.
    this.viewer3DImpl = null;
    this.loading = false;
    this.tmpMatrix = null;
    this.logger = null;
    this.loadTime = 0;

    this.svf = null;
    this.model = null;
    this.options = null;
};

F2DLoader.prototype.isValid = function() {
    return !!this.viewer3DImpl;
};

F2DLoader.prototype.loadFile = function(path, options, onDone, onWorkerStart) {
    if (!this.viewer3DImpl) {
        logger.log("F2D loader was already destructed. So no longer usable.");
        return false;
    }

    if (this.loading) {
        logger.log("Loading of F2D already in progress. Ignoring new request.");
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
    this.acmSessionId = options.acmSessionId;

    this.queryParams = "";
    if (this.acmSessionId) {
        this.queryParams = "acmsession=" + this.acmSessionId;
    }

    this.options = options;

    if (this.options.placementTransform) {
        //NOTE: The scale of the placement transform is not always sufficient to
        //determine the correct scale for line widths. This is because when a 2D model (in inches) is
        //loaded into a 3d scene in feet, the transform includes all the scaling needed to get into feet
        //but the model space line weight for the drawing is relative to the drawing itself, so an extra
        //factor of 12 would be needed in such case to cancel out the 1/12 needed for inch->foot.
        //This could probably be automatically derived, but in an error prone way, so I'm leaving it
        //up to the application layer that does the model aggregation to pass in the right model scale as an option.
        this.modelScale = this.options.modelScale || this.options.placementTransform.getMaxScaleOnAxis();
    } else {
        this.modelScale = this.options.modelScale || 1;
    }

    this.isf2d = true;
    var scope = this;

    this.initWorkerScriptToken = initWorkerScript(function() {
        scope.loadFydoCB(path, options, onDone, onWorkerStart);
    });
    
    return true;
};


F2DLoader.prototype.loadFydoCB = function(path, options, onDone, onWorkerStart) {
    this.t0 = Date.now();

    var svfPath = pathToURL(path);

    // Streaming worker as data producer that generates fydo frame streams.
    this.streamingWorker = createWorker(true);
    // Parsing worker as data consumer that consumes fydo frame streams and generate meshes.
    this.parsingWorker = createWorker();
    var scope = this;
    var first = true;

    var renderer = this.viewer3DImpl.glrenderer();

    var supportsInstancing;
    var isWebGL2;

    // NodeJS doesn't have renderer.
    if (renderer) {
        supportsInstancing = renderer.supportsInstancedArrays();
        isWebGL2 = renderer.capabilities.isWebGL2;
    }

    var terminateParser = function() {
        scope.parsingWorker.terminate();
        scope.parsingWorker = null;
    };

    var onStream = function (ew) {

        if (!scope.isValid()) {
            return;
        }

        if (first && onWorkerStart) {
            first = false;
            onWorkerStart();
        }

        var msg;
        if (ew.data && ew.data.type == "F2DBLOB") {
            msg = { operation:WORKER_PARSE_F2D,
                data: ew.data.buffer,
                metadata: ew.data.metadata,
                manifest: ew.data.manifest,
                basePath: ew.data.basePath,
                f2dLoadOptions: {
                    modelSpace : options.modelSpace,
                    bgColor: options.bgColor,
                    noShadow: options.noShadow,
                    isMobile: isMobileDevice(),
                    supportsInstancing: supportsInstancing,
                    isWebGL2: isWebGL2,
                    excludeTextGeometry: options.excludeTextGeometry,
                    outputType: options.outputType || OUTPUT_TYPE.VERTEX_BUFFER, // default vbb
                    extendStringsFetching: options.extendStringsFetching,
                },
                url: svfPath
                };
            scope.parsingWorker.doOperation(msg, [msg.data]);
            scope.streamingWorker.terminate();
            scope.streamingWorker = null;

        } else if (ew.data && ew.data.type == "F2DSTREAM") {
            msg = { operation:WORKER_PARSE_F2D_FRAME,
                        data: ew.data.frames,
                        url: svfPath,
                        f2dLoadOptions: {
                            modelSpace : options.modelSpace,
                            bgColor: options.bgColor,
                            noShadow: options.noShadow,
                            isMobile: isMobileDevice(),
                            supportsInstancing: supportsInstancing,
                            isWebGL2: isWebGL2,
                            excludeTextGeometry: options.excludeTextGeometry,
                            outputType: options.outputType || OUTPUT_TYPE.VERTEX_BUFFER,
                            extendStringsFetching: options.extendStringsFetching,
                        }
                      };

            //first frame
            if (ew.data.metadata) {
                msg.metadata = ew.data.metadata;
                msg.manifest = ew.data.manifest;
            }

            //last frame?
            if (ew.data.finalFrame) {
                msg.finalFrame = true;
                scope.streamingWorker.terminate();
                scope.streamingWorker = null;
                scope.fileMemorySize /= 2;  // Only one copy of the file now
            }

            if (ew.data.progress)
                scope.viewer3DImpl.signalProgress(100 * ew.data.progress, ProgressState.LOADING);

            scope.parsingWorker.doOperation(msg, msg.data ? [msg.data] : undefined);

        } else if (ew.data && ew.data.type == "F2DAssetURL") {
            //TODO: remove this message from the worker
        } else if (ew.data && ew.data.assetRequest) {
            //TODO: remove this message from the worker
        } else if (ew.data && ew.data.progress) {
            //just ignore progress-only message, it's only needed by the initial worker start notification above
        } else if (ew.data && ew.data.debug) {
            logger.debug(ew.data.message);
        } else if (ew.data && ew.data.error) {
            scope.loading = false;
            scope.streamingWorker.terminate();
            scope.streamingWorker = null;
            if (onDone)
                onDone(ew.data.error);
        } else {
            logger.error("F2D download failed.", errorCodeString(ErrorCodes.NETWORK_FAILURE));
            scope.loading = false;
            scope.streamingWorker.terminate();
            scope.streamingWorker = null;
        }
    };


    const onParseGeometry = function(ew) {
        if (!scope.isValid()) {
          return;
        }

        if (first && onWorkerStart) {
          first = false;
          onWorkerStart();
        }
    
        if (ew.data && ew.data.f2d) {
          scope.svf = ew.data.f2d;
          const geometry = ew.data.f2d.geometry;
          terminateParser();

          logger.info("Num polylines: " + geometry.numPolylines);
          logger.info("Line segments: " + geometry.numLineSegs);
          logger.info("Circular arcs: " + geometry.numCircles);
          logger.info("Ellipitcal arcs:" + geometry.numEllipses);
    
          scope.onModelRootLoadDone(scope.svf);
    
          if (onDone) onDone(null, scope.model);
          scope.viewer3DImpl.api.dispatchEvent({
            type: et.MODEL_ROOT_LOADED_EVENT,
            svf: scope.svf,
            model: scope.model
          });

          scope.onGeomLoadDone();
        }
      };

    var onParse = function (ew) {

        if (!scope.isValid()) {
            return;
        }
        
        if (first && onWorkerStart) {
            first = false;
            onWorkerStart();
        }

        var f, i;
        if (ew.data && ew.data.f2d) {
            f = scope.svf = ew.data.f2d;

            terminateParser();
            
            logger.info("Num polylines: " + f.numPolylines);
            logger.info("Line segments: " + f.numLineSegs);
            logger.info("Circular arcs: " + f.numCircles);
            logger.info("Ellipitcal arcs:" + f.numEllipses);
            logger.info("Plain triangles:" + f.numTriangles);
            logger.info("Total # of op codes generated by fydo.parse: " + f.opCount);

            scope.onModelRootLoadDone(scope.svf);

            if (onDone)
                onDone(null, scope.model);

            scope.viewer3DImpl.api.dispatchEvent({type:et.MODEL_ROOT_LOADED_EVENT, svf:scope.svf, model:scope.model});
            

            for (i=0; i < f.meshes.length; i++) {
                scope.processReceivedMesh2D(f.meshes[i], i);
            }

            f.meshes = null;

            scope.onGeomLoadDone();

            scope.loading = false;

        }  else if (ew.data && ew.data.f2dframe) {
            var baseIndex = 0;

            if (!ew.data.meshes) {
                //First message from the worker
                scope.svf = ew.data.f2dframe;
                baseIndex = ew.data.baseIndex;
            } else {
                //Update the world box and current mesh index
                //on subsequent messages from the worker.
                var bbox = ew.data.bbox;
                scope.svf.bbox = new THREE.Box3().copy(bbox);
                scope.svf.modelSpaceBBox = scope.svf.bbox.clone();

                if (scope.svf.placementTransform) {
                    scope.svf.bbox.applyMatrix4(scope.svf.placementTransform);
                }
                
                baseIndex = ew.data.baseIndex;
            }

            f = scope.svf;

            if (!f.fragments || !f.fragments.initialized) {
                //First message from the worker,
                //initialize the load states, fragment lists, etc.
                scope.onModelRootLoadDone(f);

                if (onDone) {
                    onDone(null, scope.model);
                }
                scope.viewer3DImpl.api.dispatchEvent({type:et.MODEL_ROOT_LOADED_EVENT, svf:f, model:scope.model});

            }

            if (ew.data.meshes && ew.data.meshes.length)
            {
                for (i = 0; i < ew.data.meshes.length; i++) {
                    scope.processReceivedMesh2D(ew.data.meshes[i], baseIndex+i);
                }
            }

            if (ew.data.finalFrame) {
                //Update the F2D properties which are accumulated
                //while reading the F2D stream.
                var cumulativeProps = ew.data.cumulativeProps;
                for (var p in cumulativeProps) {
                    f[p] = cumulativeProps[p];
                }

                terminateParser();

                scope.onGeomLoadDone();

                scope.loading = false;
            }

        } else if (ew.data && ew.data.progress) {
            //just ignore progress-only message, it's only needed by the initial worker start notification above
        } else if (ew.data && ew.data.debug) {
            logger.debug(ew.data.message);
        } else if (ew.data && ew.data.error) {
            scope.loading = false;
            terminateParser();

            logger.error("Error while processing F2d: " + JSON.stringify(ew.data.error.args));

            if (onDone)
                onDone(ew.data.error);
        } else {
            logger.error("F2D download failed.", errorCodeString(ErrorCodes.NETWORK_FAILURE));
            //Download failed.
            scope.loading = false;
            terminateParser();
        }
    };

    this.streamingWorker.addEventListener('message', onStream, false);

    var onParseCallback = options.outputType === OUTPUT_TYPE.GEOMETRY ? onParseGeometry: onParse;
    this.parsingWorker.addEventListener("message", onParseCallback, false);

    var msg = { operation:WORKER_STREAM_F2D,
        url: svfPath,
        objectIds : options.ids,
        queryParams : this.queryParams };  // For CORS caching issue.

    this.streamingWorker.doOperation(endpoint.initLoadContext(msg));

    return true;
};

F2DLoader.prototype.processReceivedMesh = function(mdata) {

    //Find all fragments that instance this mesh
    var meshid = mdata.packId + ":" + mdata.meshIndex;

    var svf = this.svf;
    var fragments = svf.fragments;

    var fragIndexes = fragments.mesh2frag[meshid];
    if (fragIndexes === undefined) {
        logger.warn("Mesh " + meshid + " was not referenced by any fragments.");
        return;
    }
    if (!Array.isArray(fragIndexes))
        fragIndexes = [fragIndexes];

    var mesh = mdata.mesh;

    // Background dbid is -1. Hide it when hideBackground is set.
    // This line has to be before calling meshToGeometry, because mdata.mesh is set to null inside of it.
    if (mesh.dbIds[-1] && this.options.hideBackground) {
        this.model.changePaperVisibility(false);
    }

    //Convert the received mesh to THREE buffer geometry
    BufferGeometryUtils.meshToGeometry(mdata);

    mdata.geometry.unpackXform = mesh.unpackXform;

    if (mesh.texData) {
        var tIdColor = new THREE.DataTexture(new Uint8Array(mesh.texData.buffer), mesh.texData.length, 1,
            THREE.RGBAFormat, THREE.UnsignedByteType, THREE.UVMapping,
            THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.NearestFilter, THREE.NearestFilter, 0);
        tIdColor.generateMipmaps = false;
        tIdColor.flipY = false;
        tIdColor.needsUpdate = true;

        mdata.geometry.tIdColor = tIdColor;
        mdata.geometry.vIdColorTexSize = new THREE.Vector2(mesh.texData.length, 1);
    }


    var numInstances = fragIndexes.length;

    var rm = this.model;
    
    //Reuse previous index of this geometry, if available
    rm.getGeometryList().addGeometry(mdata.geometry, numInstances, mdata.meshIndex + 1);

    var ib = mdata.geometry.index.array || mdata.geometry.ib;
    var polyCount = ib.length / 3;

    //For each fragment, add a mesh instance to the renderer
    for (var i=0; i<fragIndexes.length; i++) {
        var fragId = 0|fragIndexes[i];

        //We get the matrix from the fragments and we set it back there
        //with the activateFragment call, but this is to maintain the
        //ability to add a plain THREE.Mesh -- otherwise it could be simpler
        rm.getFragmentList().getOriginalWorldMatrix(fragId, this.tmpMatrix);

        if (this.options.placementTransform) {
            this.tmpMatrix = new THREE.Matrix4().multiplyMatrices(this.options.placementTransform, this.tmpMatrix);
        }

        var materialId = fragments.materials[fragId].toString();

        if (fragments.polygonCounts)
            fragments.polygonCounts[fragId] = polyCount;

        var m = this.viewer3DImpl.setupMesh(this.model, mdata.geometry, materialId, this.tmpMatrix);
        rm.activateFragment(fragId, m);
    }

    //don't need this mapping anymore.
    fragments.mesh2frag[meshid] = null;

    //Repaint and progress reporting
    fragments.numLoaded += fragIndexes.length;

    var numLoaded = fragments.numLoaded;

     //repaint every once in a while -- more initially, less as the load drags on.
     if (svf.geomPolyCount > svf.nextRepaintPolys) {
         //logger.log("num loaded " + numLoaded);
         svf.numRepaints ++;
         svf.nextRepaintPolys += 10000 * Math.pow(1.5, svf.numRepaints);
         this.viewer3DImpl.invalidate(false, true);
     }

     if ((numLoaded % 20) == 0) {
         this.viewer3DImpl.invalidate(false, true);
     }
};

F2DLoader.prototype.processReceivedMesh2D = function(mesh, mindex) {

    // Keep track of the buffer count
    if (mindex >= this.bufferCount)
        this.bufferCount = mindex + 1;

    var mdata = { mesh: mesh, is2d: true, packId : "0", meshIndex: mindex };

    var meshId = "0:" + mindex;

    var frags = this.svf.fragments;

    // Only process the dbids the first time we process the fragment
    if (!frags.fragId2dbId[mindex]) {
        //Remember the list of all dbIds referenced by this mesh.
        //In the 2D case this is 1->many (1 frag = many dbIds) mapping instead of
        // 1 dbId -> many fragments like in the SVF 3D case.
        var dbIds = Object.keys(mdata.mesh.dbIds).map(function(item){return parseInt(item);});
        frags.fragId2dbId[mindex] = dbIds;

        //TODO: dbId2fragId is not really necessary if we have a good instance tree for the 2D drawing (e.g. Revit, AutoCAD)
        //so we can get rid of this mapping if we can convert Viewer3DImpl.highlightFragment to use the same logic for 2D as for 3D.
        for (var j=0; j<dbIds.length; j++) {
            var dbId = dbIds[j];
            var fragIds = frags.dbId2fragId[dbId];
            if (Array.isArray(fragIds))
                fragIds.push(mindex);
            else if (typeof fragIds !== "undefined") {
                frags.dbId2fragId[dbId] = [fragIds, mindex];
            }
            else {
                frags.dbId2fragId[dbId] = mindex;
            }
        }

        const modelFrags = this.model.getFragmentList();

        mesh.material.modelScale = this.modelScale;
        mesh.material.opacity = this.options.opacity;
        mesh.material.doNotCut = this.options.doNotCut || modelFrags?.getDoNotCut();
        if (modelFrags?.viewBounds) {
            const bounds = modelFrags.viewBounds;
            mesh.material.viewportBounds = new THREE.Vector4(bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y);
        }         

        var viewer = this.viewer3DImpl;
        frags.materials[mindex] = this.viewer3DImpl.matman().create2DMaterial(this.model, mesh.material, false, false, function(texture, model) {

            //Unfortunately we have to check for texture load complete here also, not just
            //in the final call to loadTextures. This is because geometry load can complete
            //before or after texture load completes.
            var svf = model.getData();
            if (svf?.loadDone && !svf.texLoadDone && !TextureLoader.requestsInProgress()) {
                svf.texLoadDone = true;
                viewer.onTextureLoadComplete(model);
            }

            // Weak mobile devices can't handle invalidate call for each texture that's being loaded.
            // We postpone the texture rendering on this case to the last texture to be loaded.
            if (!(isMobileDevice() && TextureLoader.requestsInProgress())) {
                viewer.invalidate(false, true, false);
            }
        });

        frags.length++;
    }
    frags.mesh2frag[meshId] = mindex;

    this.processReceivedMesh(mdata);

};

F2DLoader.prototype.onModelRootLoadDone = function(svf) {

    //In the 2d case we create and build up the fragments mapping
    //on the receiving end.
    svf.fragments = {};
    svf.fragments.mesh2frag = {};
    svf.fragments.materials = [];
    svf.fragments.fragId2dbId = [];
    svf.fragments.dbId2fragId = {};
    svf.fragments.length = 0;
    svf.fragments.initialized = true;


    svf.geomMemory = 0;
    svf.fragments.numLoaded = 0;
    svf.gpuNumMeshes = 0;
    svf.gpuMeshMemory = 0;

    svf.nextRepaintPolys = 10000;
    svf.numRepaints = 0;

    svf.urn = this.svfUrn;
    svf.acmSessionId = this.acmSessionId;

    svf.basePath = "";
    var lastSlash = this.currentLoadPath.lastIndexOf("/");
    if (lastSlash !== -1)
        svf.basePath = this.currentLoadPath.substr(0, lastSlash+1);

    svf.placementTransform = this.options.placementTransform?.clone();
    svf.placementWithOffset = this.options.placementTransform?.clone();
    svf.loadOptions = this.options;
    svf.texLoadDone = false;

    var t1 = Date.now();
    this.loadTime += t1 - this.t0;
    logger.log("SVF load: " + (t1 - this.t0));

    this.t0 = t1;

    //The BBox object loses knowledge of its
    //type when going across the worker thread boundary...
    svf.bbox = new THREE.Box3().copy(svf.bbox);
    svf.modelSpaceBBox = svf.bbox.clone();

    if (svf.placementTransform) {
        svf.bbox.applyMatrix4(svf.placementTransform);
    }

    //Create the API Model object and its render proxy
    var model = this.model = new Model(svf);
    model.loader = this;

    model.initialize();

    if (!this.options.skipPropertyDb) {
        this.svf.propDbLoader = new PropDbLoader(this.sharedDbPath, this.model, this.viewer3DImpl.api);
    }

    logger.log("scene bounds: " + JSON.stringify(svf.bbox));

    var metadataStats = {
        category: "metadata_load_stats",
        urn: svf.urn,
        layers: svf.layerCount
    };
    logger.track(metadataStats);

    this.viewer3DImpl.setDoNotCut(model, !!this.options.doNotCut);

    this.viewer3DImpl.signalProgress(5, ProgressState.ROOT_LOADED, this.model);
    this.viewer3DImpl.invalidate(false, false);
};


F2DLoader.prototype.onGeomLoadDone = function() {
    this.svf.loadDone = true;

    // Don't need these anymore
    this.svf.fragments.entityIndexes = null;
    this.svf.fragments.mesh2frag = null;

    var t1 = Date.now();
    var msg = "Fragments load time: " + (t1 - this.t0);
    this.loadTime += t1 - this.t0;

    //Note that materials/texutres for F2D are done already as their geometry
    //is received, so this logic will most likely just trigger the textureLoadComplete event.
    TextureLoader.loadModelTextures(this.model, this.viewer3DImpl);

    //Load the property database after all geometry is loaded (2D case). For 2D,
    //the fragId->dbId mapping is only fully known once geometry is loaded, as
    //it's built on the fly.
    //TODO: As an optimization we can split the property db logic into two calls -- one to load the files
    //in parallel with the geometry and a second to do the processing.
    if (!this.options.skipPropertyDb)
        this.loadPropertyDb();

    logger.log(msg);

    var modelStats = {
        category: "model_load_stats",
        is_f2d: true,
        has_prism: this.viewer3DImpl.matman().hasPrism,
        load_time: this.loadTime,
        geometry_size: this.model.getGeometryList().geomMemory,
        meshes_count: this.model.getGeometryList().geoms.length,
        urn: this.svfUrn
    };
    logger.track(modelStats, true);

    var geomList = this.model.getGeometryList();
    const dataToTrack = {
        load_time: this.loadTime,
        polygons: geomList.geomPolyCount,
        fragments: this.model.getFragmentList().getCount(),
        mem_usage: geomList.gpuMeshMemory,
        viewable_type: '2d',
    }
    avp.analytics.track('viewer.model.loaded', dataToTrack);

    this.currentLoadPath = null;
    this.isf2d = undefined;

    this.viewer3DImpl.onLoadComplete(this.model);
};


F2DLoader.prototype.loadPropertyDb = function() {
    if (this.svf.propDbLoader)
        this.svf.propDbLoader.load();
};

F2DLoader.prototype.is3d = function() {
    return false;
};

FileLoaderManager.registerFileLoader("f2d", ["f2d"], F2DLoader);
