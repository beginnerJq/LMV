    
    import { isMobileDevice, getGlobal, isNodeJS } from "../../compat";
    import { BufferGeometryUtils } from "../../wgs/scene/BufferGeometry";
    import { createWorkerWithIntercept } from "./WorkerCreator";
    import { initLoadContext } from "../net/endpoints";
    import { EventDispatcher } from "../../application/EventDispatcher";
    import * as et from "../../application/EventTypes";
    import { getParameterByName } from "../../globals";
    import { OtgPriorityQueue, updateGeomImportance} from "../lmvtk/otg/OtgPriorityQueue";

    export var MESH_RECEIVE_EVENT = "meshReceived";
    export var MESH_FAILED_EVENT = "meshFailed";
    export var MATERIAL_RECEIVE_EVENT = "materialReceived";
    export var MATERIAL_FAILED_EVENT = "materialFailed";


    const disableIndexedDb = getParameterByName("disableIndexedDb").toLowerCase() === "true" || getGlobal().DISABLE_INDEXED_DB;
    const disableWebSocket = getParameterByName("disableWebSocket").toLowerCase() === "true" || getGlobal().DISABLE_WEBSOCKET;

    function initLoadContextGeomCache(msg) {
        var ctx = initLoadContext(msg);
        ctx.disableIndexedDb = disableIndexedDb;
        ctx.disableWebSocket = disableWebSocket;
        ctx.isInlineWorker = Autodesk.Viewing.Private.ENABLE_INLINE_WORKER;
        return ctx;
    }

    // Helper function used for cache cleanup
    function compareGeomsByImportance(geom1, geom2) {
        return geom1.importance - geom2.importance;
    }

    /** Shared cache of BufferGeometries and material JSONs used by different OtgLoaders. */
    export function OtgResourceCache() {

        // all geometries, indexed by geom hashes
        var _geoms = new Map();
        var _mats = new Map();

        // A single geometry may be requested by one or more model loaders.
        // This map keeps track of requests already in progress so that
        // we don't issue multiple simultaneously
        var _hash2Requests = {};

        // worker for geometry loading
        var NUM_WORKERS = isMobileDevice() ? 2 : 8;
        var _workers = [];

        for (var i=0; i<NUM_WORKERS; i++) {
            _workers.push(createWorkerWithIntercept());
        }

        this.initialized = true;

        // track memory consumption
        this.byteSize = 0;
        this.refCount = 0;

        // track total counts to simplify debugging
        this.requestsSent = 0;
        this.requestsReceived = 0;

        // A request is called in-progress if we have sent it to the worker and didn't receive a result yet.
        // We restrict the number of _requestsInProgress. If the limit is reached, all additional requests
        // are enqueued in _waitingRequests.
        var _requestsInProgress = 0;
        var _maxRequestsPerWorker = 100;
        var _timeout = undefined;

        var _queue = new OtgPriorityQueue();

        var _this = this;

        // mem limits for cache cleanup
        var MB = 1024 * 1024;
        var _maxMemory  = 100 * MB; // geometry limit at which cleanup is activated
        var _minCleanup = 50  * MB; // minimum amount of freed memory for a single cleanup run

        var _timeStamp = 0; // used for cache-cleanup to identify which geoms are in use

        // A cleanup will fail if there are no unused geometries anymore.
        // If this happens, we skip cleanup until the next model unload occurs.
        var _allGeomsInUse = false;

        function onModelUnloaded() {
            _allGeomsInUse = false;
        }

        // Needed for cache-cleanup to check which RenderModels are loaded
        var _viewers = [];

        this.addViewer = function(viewer) {
            viewer.addEventListener(et.MODEL_UNLOADED_EVENT, onModelUnloaded);
            _viewers.push(viewer);
            _queue.addViewer(viewer);
        }

        this.removeViewer = function(viewer) {
            const index = _viewers.indexOf(viewer);

            if (index !== -1) {
                viewer.removeEventListener(et.MODEL_UNLOADED_EVENT, onModelUnloaded);
                _queue.removeViewer(viewer);
                _viewers.splice(index, 1);
            }

            if (_viewers.length === 0) {
                this.dtor();
            }
        }

        this.dtor = function() {
            _viewers = [];

            for (var i=0; i<NUM_WORKERS; i++) {
              _workers[i].clearAllEventListenerWithIntercept();
              _workers[i].terminate();
            }

            _geoms = null;
            _mats = null;

            this.initialized = false;
        };

        // function to handle messages from OtgLoadWorker (posted in onGeometryLoaded)
        function handleMessage(msg) {

            if (!msg.data) {
                return;
            }

            //Schedule another spin through the task queue
            if (_queue.waitingTasks.length && !_timeout) {
                _timeout = setTimeout(processQueuedItems, 0);
            }

            if (msg.data.error) {
                var error = msg.data.error;

                // get hash for which request failed
                var hash = error.args ? error.args.hash : undefined;

                var type = error.args ? error.args.type : "g";

                // inform affected clients.
                if (hash) {
                    if (type === "m") {
                        _mats.set(hash, error); //create an error entry in the cache
                        _this.fireEvent({type: MATERIAL_FAILED_EVENT, error:error});
                        console.warn("Error loading material", hash);
                    } else {
                        _geoms.set(hash, error); //create an error entry in the cache
                        _this.fireEvent({type: MESH_FAILED_EVENT, error:error});
                        console.warn("Error loading mesh", hash);
                    }

                    delete _hash2Requests[error.hash];

                    // track number of requests in progress
                    _requestsInProgress--;
                    _this.requestsReceived++;
                }

                return;
            }

            if (msg.data.material) {
                var mdata = msg.data;
                // add material to cache
                var hash = mdata.hash;
                var mat = mdata.material;
                _mats.set(hash, mat);

                // pass geometry to all receiver callbacks
                _this.fireEvent({type: MATERIAL_RECEIVE_EVENT, material: mat, hash: hash});

                delete _hash2Requests[mdata.hash];

                _requestsInProgress--;
                _this.requestsReceived++;
            } else {

                var meshlist = msg.data;
                for (var i=0; i<meshlist.length; i++) {

                    var mdata = meshlist[i];

                    if (mdata.hash && mdata.mesh) {
                        // convert goemetry data to GeometryBuffer (result is mdata.geometry)
                        BufferGeometryUtils.meshToGeometry(mdata);

                        // add geom to cache
                        var hash = mdata.hash;
                        var geom = mdata.geometry;
                        _geoms.set(hash, geom);

                        // track summed cache size in bytes
                        _this.byteSize += geom.byteSize;

                        // free old unused geoms if necessary
                        _this.cleanup();

                        // pass geometry to all receiver callbacks
                        _this.fireEvent({type: MESH_RECEIVE_EVENT, geom: geom});

                        delete _hash2Requests[mdata.hash];
                    }

                    // track number of requests in progress
                    _requestsInProgress--;
                    _this.requestsReceived++;
                }
            }
        }


        for (var i=0; i<NUM_WORKERS; i++) {
            _workers[i].addEventListenerWithIntercept(handleMessage);
        }


        function assignWorkerForTask(resId) {
            if (typeof resId === "number") {
                return resId % NUM_WORKERS;
            }

            return 0 | (Math.random() * NUM_WORKERS);
        }


        this.initWorker = function(modelUrn) {

            //Tell each worker which ranges of the geometry pack it's responsible for.
            for (var i=0; i<NUM_WORKERS; i++) {

                var msg = {
                    operation: "INIT_WORKER_OTG",
                    authorizeUrns: [ modelUrn ]
                };

                _workers[i].doOperation(initLoadContextGeomCache(msg));
            }
        };

        this.updateMruTimestamps = function() {

            //Tell each worker which ranges of the geometry pack it's responsible for.
            for (var i=0; i<NUM_WORKERS; i++) {

                var msg = {
                    operation: "UPDATE_MRU_TIMESTAMPS_OTG",
                    endSession: _queue.isEmpty()
                };

                _workers[i].doOperation(initLoadContextGeomCache(msg));
            }

        };


        /**  Get a geometry from cache or load it.
         *    @param {string}   url         - full request url of the geometry/ies resource
         *    @param {boolean}  isCDN       - whether the URL is pointing to a public edge cache endpoint
         *    @param {string}   geomHash    - hash key to identify requested geometry/ies
         *    @param {int} geomIdx          - the geometry ID/index in the model's geometry hash list (optional, pass 0 to skip use of geometry packs)
         *    @param {string}   queryParams - additional param passed to file query
         */
        this.requestGeometry = function(url, isCDN, geomHash, geomIdx, queryParams) {

            // if this geometry is in memory, just return it directly
            var geom = _geoms.get(geomHash);
            if (geom && geom.args) {
                //it failed to load previously
                if(isNodeJS()) {
                    setImmediate(() => this.fireEvent({type:MESH_FAILED_EVENT, error:geom, hash: geomHash, repeated: true}));
                } else {
                    this.fireEvent({type:MESH_FAILED_EVENT, error:geom, hash: geomHash, repeated: true});
                }
                return;
            } else if (geom) {
                //it was already cached
                if(isNodeJS()) {
                    setImmediate(() => this.fireEvent({type:MESH_RECEIVE_EVENT, geom:geom}));
                } else {
                    this.fireEvent({type:MESH_RECEIVE_EVENT, geom:geom});
                }
                return;
            }

            // if geometry is already loading, just increment
            // the request counter.
            var task = _hash2Requests[geomHash];
            if (task && task.refcount) {
                task.importanceNeedsUpdate = true;
                task.refcount++;
                return;
            }

            // geom is neither in memory nor loading.
            // we have to request it.
            var msg = {
                operation:    "LOAD_CDN_RESOURCE_OTG",
                type:         "g",
                url:          url,
                isCDN:        isCDN,
                hash:         geomHash,
                queryParams:  queryParams,
                importance:   0.0,
                geomIdx:      geomIdx,
                importanceNeedsUpdate: true, // compute actual importance later in updatePriorities
                refcount: 1
            };

             _queue.addTask(msg);
             _hash2Requests[geomHash] = msg;

             if (!_timeout) {
                _timeout = setTimeout(processQueuedItems, 0);
             }

        };


        this.requestMaterial = function(url, isCDN, matHash, matIdx, queryParams) {

            // if this material is in memory, just return it directly
            var mat = _mats.get(matHash);
            if (mat && mat.args) {
                //it failed to load previously
                setImmediate(() => this.fireEvent({type:MATERIAL_FAILED_EVENT, error:mat, hash: matHash, repeated: true}));
                return;
            } else if (mat) {
                //it was already cached
                setImmediate(() => this.fireEvent({type:MATERIAL_RECEIVE_EVENT, material:mat, hash: matHash}));
                return;
            }

            // if material is already loading, just increment
            // the request counter.
            var task = _hash2Requests[matHash];
            if (task && task.refcount) {
                task.refcount++;
                return;
            }

            // material is neither in memory nor loading.
            // we have to request it.
            var msg = {
                operation:    "LOAD_CDN_RESOURCE_OTG",
                type:         "m",
                urls:         [url],
                hashes:       [matHash],
                isCDN:        isCDN,
                queryParams:  queryParams,
                refcount: 1
            };

             _hash2Requests[matHash] = msg;

            //Material requests are sent to the worker immediately, without going through the
            //priority queue.
            var whichWorker = assignWorkerForTask(matIdx);
            _workers[whichWorker].doOperation(initLoadContextGeomCache(msg));
            _requestsInProgress++;
            this.requestsSent++;
        };

        function processQueuedItems() {

            var howManyCanWeDo = _maxRequestsPerWorker * NUM_WORKERS - _requestsInProgress;

            if (howManyCanWeDo === 0) {
                _timeout = setTimeout(processQueuedItems, 30);
                return;
            }

            // recompute importance for each geometry and sort queue by decreasing priority
            var priorityUpdateFinished = _queue.updateRequestPriorities();

            // Restrict number of simultaneous requests until our priorities are fully updated
            if (!priorityUpdateFinished) {
                howManyCanWeDo = Math.min(howManyCanWeDo, 10 * NUM_WORKERS);
            }

            var msgPerWorker = [];
            var tasksAdded = 0;

            while (!_queue.isEmpty() && tasksAdded < howManyCanWeDo) {

                var task = _queue.takeTask();

                //Find which worker thread is preferred for the task
                var whichWorker = assignWorkerForTask(task.geomIdx);
                var msg = msgPerWorker[whichWorker];

                if (!msg) {
                    msg = {
                        operation:    "LOAD_CDN_RESOURCE_OTG",
                        type:         "g",
                        urls:         [task.url],
                        hashes:       [task.hash],
                        isCDN:        task.isCDN,
                        queryParams:  task.queryParams
                    };

                    msgPerWorker[whichWorker] = msg;
                } else {
                    msg.urls.push(task.url);
                    msg.hashes.push(task.hash);
                }

                tasksAdded++;
            }

            for (var i=0; i<msgPerWorker.length; i++) {
                var msg = msgPerWorker[i];
                if (msg) {
                    // send request to worker
                    _workers[i].doOperation(initLoadContextGeomCache(msg));
                    _requestsInProgress+=msg.urls.length;
                    _this.requestsSent+=msg.urls.length; 
                }
            }

            _timeout = undefined;
        }

        // remove all open requests of this client
        // input is a map whose keys are geometry hashes
        this.cancelRequests = function(geomHashMap) {

            for (var hash in geomHashMap) {
                var task = _hash2Requests[hash];

                if (task)
                    task.refcount--;
                /*
                if (task.refcount === 1) {
                    delete _hash2Requests[hash];
                }*/
            }

            var hiPrioList = [];
            for (var i=0; i<_queue.waitingTasks.length; i++) {
                var t = _queue.waitingTasks[i];
                // TODO: Analyze why `req` can be undefined. Story: https://jira.autodesk.com/browse/FLUENT-5734
                var req = _hash2Requests[t.hash];
                if (req && req.refcount)
                    hiPrioList.push(t);
                else
                    delete _hash2Requests[t.hash];
            }

            //TODO: perhaps we can leave requests with refcount = 0 in the queue
            //but sort the queue based on refcount so that those get deprioritized
            _queue.waitingTasks = hiPrioList;

            // TODO: To make switches faster, we should also inform the worker thread,
            //       so that it doesn't spend too much time with loading geometries that noone is waiting for.
        };

        // To prioritize a geometry, we track the bbox surface area of all fragments using it.
        //
        // For this, this function must be called for each new loaded fragment.
        //  @param {RenderModel} model
        //  @param {number}      fragId
        this.updateGeomImportance = function(model, fragId) {
            return updateGeomImportance(model, fragId);
        };

        this.cleanup = function() {

            var unusedGeoms = [];

            if (this.byteSize < _maxMemory) {
                return;
            }

            // get array of models in memory
            var loadedModels = [];

            for (var i=0; i<_viewers.length; i++) {
                var mq = _viewers[i].impl.modelQueue();
                loadedModels = loadedModels.concat(mq.getModels().concat(_viewers[i].getHiddenModels()));
            }

            if (_allGeomsInUse) {
                // On last run, we discovered that we have no unused geometries anymore. As long as no model
                // is unloaded, we should not retry. Otherwise, we would waste a lot of time for each single new geometry.
                // Note that this has huge performance impact, because rerunning for each geometry is extremely slow.
                return;
            }

            // mark all geometries in-use with latest time-stamp
            // We consider a geometry as in-use if it is currently loaded by the viewer
            _timeStamp++;
            for (var i=0; i<loadedModels.length; i++) {

                // get geom hashes for this model
                var model = loadedModels[i];
                var data  = model.getData();
                if (!model.isOTG()) {
                    // if this is not an Oscar model, it cannot contain shared geoms.
                    // We can skip it.
                    continue;
                }
                // For OTG models, we can assume that data is an OtgPackage and contains hashes

                // hasesh may by null for empty models
                var hashes = data.geomMetadata.hashes;
                if (!hashes) {
                    continue;
                }

                // update timestamp for all geoms that are referenced by the hash list (Note that hashes may be null for empty models)
                var hashCount = hashes.length / data.geomMetadata.byteStride;
                for (var j=1; j<hashCount; j++) { // start at 1, because index 0 is reserved value for invalid geomIndex

                    // If the geom for this hash is in cache, update its tiemstamp
                    var hash = data.getGeometryHash(j);
                    var geom = _geoms.get(hash);
                    if (geom) {
                        geom.timeStamp = _timeStamp;
                    }
                }
            }

            // verify that no geom is leaked in the reused tmp array
            if (unusedGeoms.length > 0) {
                console.warn("OtgResourceCache.cleanup(): array must be empty");
            }

            // Collect all unused geoms, i.e., all geoms that do not have the latest timeStamp
            for (var hash in _geoms) {
                var geom = _geoms.get(hash);
                if (geom.timeStamp !== _timeStamp) {
                    unusedGeoms.push(geom);
                }
            }

            // Sort unused geoms by ascending importance
            unusedGeoms.sort(compareGeomsByImportance);

            // Since cleanup is too expensive to run per geometry,
            // we always remove a bit more than strictly necessary,
            // so that we can load some more new geometries before we have to
            // run cleanup again.
            var targetMem = _maxMemory - _minCleanup;

            // Remove geoms until we reach mem target
            var i = 0;
            for (; i<unusedGeoms.length && this.byteSize >= targetMem; i++) {

                var geom = unusedGeoms[i];

                // remove it from cache
                delete _geoms.delete(geom.hash);

                // update mem consumption. Note that we run this only for geoms that
                // are not referenced by any RenderModel in memory, so that removing them
                // should actually free memory.
                this.byteSize -= geom.byteSize;

                // Dispose GPU mem.
                // NOTE: In case we get performance issues in Chrome, try commenting this out
                // (see hack in GeometryList.dispose)
                geom.dispose();
            }

            if (i === unusedGeoms.length) {
                // No more unused geometries. Any subsequent attempt to cleanup will fail until
                // the next model unload.
                _allGeomsInUse = true;
            }

            // clear reused temp array. Note that it's essential to do this immediately. Otherwise,
            // the geoms would be leaked until next cleanup.
            unusedGeoms.length = 0;
        };


        // Wait for specific hashes and push their priority to finish faster.
        //
        // Note: This function does not trigger own requests, i.e. can only be used for hashes of models
        //       that are currently loading.
        //
        //  @param {Object} hashMap          - keys specify hashes. All keys with hashMap[key]===true will be loaded. 
        //  @param {function(Object)} onDone - called with hashMap. hashMap[hash] will contain the geometry.
        this.waitForGeometry = function(hashMap, onDone) {
            
            // track how many of our geoms are finished
            var geomsDone = 0;
            var geomsTodo = _queue.makeUrgent(hashMap);

            // avoid hanging if hashMap is empty
            if (geomsTodo === 0) {
                if (hashMap) {
                    onDone(hashMap);
                    return;
                }
            }

            processQueuedItems();
            
            function onGeomDone(hash, geom) {
                // If a geometry is not loading anymore, its priority has no relevance anymore.
                // Note that this is generally true - even if we didn't set the priority in this waitForGeometry call. 
                _queue.removeUrgent(hash);

                // Only care for geometries that we need to fill the hashMap values 
                if (!hashMap[hash] === true) {
                    return;
                }

                hashMap[hash] = geom;

                // check if all done
                geomsDone++;
                if (geomsDone < geomsTodo) {
                    return;
                }

                // cleanup listeners
                _this.removeEventListener(MESH_RECEIVE_EVENT, onGeomReceived);
                _this.removeEventListener(MESH_FAILED_EVENT, onGeomFailed);

                onDone(hashMap);
            }

            function onGeomReceived(event) { onGeomDone(event.geom.hash, event.geom);      }
            function onGeomFailed(event)   { onGeomDone(event.error.args.hash, undefined); }

            this.addEventListener(MESH_RECEIVE_EVENT, onGeomReceived);
            this.addEventListener(MESH_FAILED_EVENT, onGeomFailed);

            // Don't wait forever for any meshes that were already loaded
            for (let hash in hashMap) {
                var geom = _geoms.get(hash);
                if (geom) {
                    onGeomDone(hash, geom);
                }
            }
        };
        
        this.getGeometry = function(hash) {
            return _geoms.get(hash);
        }

        // For error diagnosis: If something gets stuck during loading, this report helps
        // figuring out where it happens.
        this.reportLoadingState = function() {

            // Report main thread stats
            console.log('OtgResourceCache:', {
                sent: this.requestsSent,
                received: this.requestsReceived
            });

            // Ask the workers to report their state
            for (let i=0; i<_workers.length; i++) {
                const msg = {
                    operation:   "REPORT_LOADING_STATE",
                    workerIndex: i,
                };

                // Request worker stats and report when we get them
                _workers[i].doOperation(initLoadContextGeomCache(msg));
            }
        }
    }

    EventDispatcher.prototype.apply(OtgResourceCache.prototype);


