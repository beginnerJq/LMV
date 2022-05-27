import { ViewingService } from "../net/Xhr";
import * as OtgGeomCodec from "../lmvtk/otg/OtgGeomCodec";
import { LocalDbCache } from "../lmvtk/otg/LocalDbCache";
import { isNodeJS } from "../../compat";
const pako = require('pako');
import { OtgWs } from "../lmvtk/otg/OtgWebSocket";


// OtgLoadWorker implements the "LOAD_CDN_RESOURCE_OTG" operation.

//Do not store state data directly in "self" because in the node.js code path
//there are no separate worker contexts
function getWorkerContext(loadContext) {

    //Initialize the worker context -- we cannot use module/global vars here,
    //because in node.js the module variables are shared for all instances of the worker.
    if (!loadContext.worker.ctx) {

        loadContext.worker.ctx = {

            otgws: new OtgWs(loadContext, onCdnResourceLoaded, retryAllPending),
            localCache: new LocalDbCache(loadContext.disableIndexedDb, loadContext.isInlineWorker),

            numRequests: 0,
            inprogress: {}, //all currently pending requests (in case we need to retry them due to connection failure, etc)

            //Keeps batches of messages to be sent back to the main thread
            _pendingMdata: [],
            _pendingTransferList: [],
            _pendingSends: [],

            // Track total counts to simplify debugging
            _requestsSent: 0,
            _requestsReceived: 0,

            closeRequested: 0
        };
    }

    return loadContext.worker.ctx;
}

function isGzip(data) {
    return data[0] === 31 && data[1] === 139;
}

function decodeGeometryOtg(data, hash) {

    //This should not happen in production, but apparently some data made it
    //that way to staging, and we want to detect and fix those models.
    if (isGzip(data)) {
        console.error("Double compressed OTG resource.", hash);
        data = pako.ungzip(data);
    }

    // Read Otg package
    var mdata = OtgGeomCodec.readLmvBufferGeom(data);

    if (!mdata) {
        console.error("Failed to parse geometry", hash);
        return;
    }

    mdata.hash = hash;

    return mdata;
}


// Use custom error handler: It  forwards to the default one, but...
//  1. adds the geometry hash to the error message. This is needed by the geometry cache.
//     We use it to determine for which geometry the problem occurred, so that the affected
//     loaders can be informed (see OtgResourceCache.js).
//  2. If any other requests were blocked before to limit the number of parallel
//     requests, we must make sure that these enqueued  requests are processed too.
function getErrorHandler(loadContext, hash, resourceType) {

    // add error handler to override raiseError function
    var errorHandler = {
        // add hash and pass on to loadContext.raiseError.
        raiseError: function(code, msg, args) {
            args.hash = hash;
            args.type = resourceType;
            loadContext.raiseError(code, msg, args);
        }
    };

    return function() {
        // forward to default error handler
        ViewingService.defaultFailureCallback.apply(errorHandler, arguments);

        // process next requests (if any)
        let ctx = getWorkerContext(loadContext);
        delete ctx.inprogress[hash];
        ctx.numRequests--;

        //If the main thread asked us to end things, but we delayed due to pending requests,
        //do it now
        if (ctx.otgws.loaderCloseRequested && !ctx.numRequests) {
            loadContext.endSession = true;
            ctx.otgws.loaderCloseRequested--;
            doPostLoad(loadContext);
        }
    }
}

function retryAllPending(loadContext) {

    let ctx = getWorkerContext(loadContext);

    let old = ctx.inprogress;

    ctx.inprogress = {};

    for (let h in old) {
        let item = old[h];
        loadContext.queryParams = item.queryParams;
        loadCdnResource(item.url, h, loadContext, item.type);
    }
}

function queueGeometryMessage(loadContext, mdata) {

    if (!Array.isArray(mdata))
        mdata = [mdata];

    // send message with result
    var transferList = [];

    //Add all ArrayBuffers to the transferable objects list
    for (var i=0; i<mdata.length; i++) {
        var mesh = mdata[i].mesh;
        if (mesh) {
            var b = mesh.vb.buffer;
            transferList.push(b);

            if (mesh.indices && mesh.indices.buffer !== b)
                transferList.push(mesh.indices.buffer);

            if (mesh.iblines && mesh.iblines.buffer !== b)
                transferList.push(mesh.iblines.buffer);
        }
    }

    //loadContext.worker.postMessage(mdata, transferList);

    var ctx = getWorkerContext(loadContext);
    ctx._pendingMdata.push.apply(ctx._pendingMdata, mdata);
    ctx._pendingTransferList.push.apply(ctx._pendingTransferList, transferList);

}

function onCdnResourceLoaded(data, hash, loadContext, skipCache, resourceType) {

    let ctx = getWorkerContext(loadContext);

    ctx._requestsReceived++;

    if (!skipCache) {
        ctx.localCache.store(hash, data);

        // Why cloning?:
        // If IndexedDB is used, data is enqueued by LocalDBCache and stored to IndexedDB later.
        // Therefore, we must make sure that 'data' keeps valid.
        //
        // If it contains uncompressed data, it will be referenced by decoded geometry directly
        // and will finally be handed over to the main thread via transfer list (which makes unusable).
        // For this case, we need to copy it. (unless in NodeJS, where transferLists have no effect)
        var isCompressed = data && isGzip(data);
        if (data && !isNodeJS() && !loadContext.disableIndexedDb && !isCompressed) {
            data = data.slice();
        }
    }

    if (isGzip(data)) {
        data = pako.ungzip(data);
    }

    delete ctx.inprogress[hash];
    ctx.numRequests--;

    if (resourceType === "m") {
        //Post materials as soon as possible without batching -- those are fewer
        //and more critical as they are shared across multiple meshes.
        if (data) {
            loadContext.worker.postMessage({ material: data, hash: hash }, [data.buffer]);
        } else {
            getErrorHandler(loadContext, hash, resourceType)(-1, "", {});
        }
    } else {
        var mdata = data && decodeGeometryOtg(data, hash);
        if (mdata) {
            queueGeometryMessage(loadContext, mdata);
        } else {
            getErrorHandler(loadContext, hash, resourceType)(-1, "", {});
        }
    }

    //If the main thread asked us to end things, but we delayed due to pending requests,
    //do it now
    if (ctx.otgws.loaderCloseRequested && !ctx.numRequests) {
        loadContext.endSession = true;
        ctx.otgws.loaderCloseRequested--;
        doPostLoad(loadContext);
    }
}

// Request raw geometry data (arraybuffer) and call processGeometry with the result
//  @param {Object}   loadContext - passed through to the receiving callback
//  @param {function) onSuccess   - function(loadContext, result). result.mesh contains the mesh data.
function loadCdnResource(url, hash, loadContext, resourceType) {

    var ctx = getWorkerContext(loadContext);

    ctx._requestsSent++;

    //Make sure the IndexedDb session is started before we ask to get() anything.
    //This is done by a call to open, which will call us back immediately, or delay until
    //the database is open.
    ctx.localCache.open(() => ctx.localCache.get(hash, function(error, data) {
        if (data) {
            onCdnResourceLoaded(data, hash, loadContext, true, resourceType);
        } else {

            if (ctx.inprogress[hash]) {
                console.warn("Unexpected repeated request for same OTG resource.");
            }

            ctx.inprogress[hash] = { url: url, type: resourceType, queryParams: loadContext.queryParams };

            if (ctx.otgws._wsUsable) {

                //Make sure the WebSocket session is started before we request anything.
                //The call to startSession() is reentrant and will call the callback once the WebSocket is open.
                ctx.otgws.startSession(loadContext, () => ctx.otgws.requestResources([url], [hash], resourceType));

            } else {
                //Fallback to XHR/HTTP2
                ViewingService.getItem(
                    loadContext,
                    url,
                    (data) => onCdnResourceLoaded(data, hash, loadContext, false, resourceType),
                    getErrorHandler(loadContext, hash),
                    {
                        responseType:"arraybuffer",
                        withCredentials: true
                    }
                );
            }
        }
    }));
}

// @param {string[]}   loadContext.urls            - request urls
// @param {string[]}   loadContext.hashes          - content hashes corresponding to each request URL
// @param {function} loadContext.onFailureCallback - defined in workerMain()
// @param {Worker}   loadContext.worker            - defined in MainWorker.worker
function doCdnResourceLoad(loadContext) {
    var ctx = getWorkerContext(loadContext);

    for (let i=0; i<loadContext.urls.length; i++) {
        loadCdnResource(loadContext.urls[i], loadContext.hashes[i], loadContext, loadContext.type || "g");
        ctx.numRequests++;
    }
}

//Sends recently received (since last flush) resources back to the main thread
function flushMessages(loadContext) {

    var ctx = getWorkerContext(loadContext);

    if (!ctx._pendingMdata.length)
        return;

    loadContext.worker.postMessage(ctx._pendingMdata, ctx._pendingTransferList);
    ctx._pendingMdata = [];
    ctx._pendingTransferList = [];
}

function doInitGeomWorker(loadContext) {

    //console.log("Init worker called");
    var ctx = getWorkerContext(loadContext);

    //Begin opening the web socket
    ctx.otgws.startSession(loadContext);

    //Begin opening the IndexedDb database
    ctx.localCache.open(null);

    if (!ctx.flushMessages) {
        ctx.flushMessages = setInterval(() => {
            flushMessages(loadContext);
        }, 66);
    }
}

//Shuts down the load worker
function doPostLoad(loadContext) {

    var ctx = getWorkerContext(loadContext);

    // clear any pending items before we shut down
    flushMessages(loadContext);

    ctx.otgws.loaderCloseRequested++;

    //The worker can be used by multiple loaders, so only close the
    //web socket if it's not waiting on other requests.
    if (loadContext.endSession && !ctx.numRequests) {
        //console.log("End web socket session due to idle.");
        ctx.otgws.endSession();
        ctx.otgws.loaderCloseRequested = 0;

        // Note that other OtgLoaders may still be running. OtgWebSocket takes care of
        // loader refCounting itself, but for stopping the timer, we must check first. 
        if (ctx.otgws._loaderCounter <= 0) {
            //Clear the timer also, in case nothing is pending and session is ending.
            clearInterval(ctx.flushMessages);
            ctx.flushMessages = null;
        }

        if (ctx.localCache)
            ctx.localCache.open(() => ctx.localCache.updatePendingTimestamps());
    }
}

// Helper task to faciliate console debugging.
// How to use:
//  If OTG loading gets stuck, call NOP_VIEWER.impl.geomCache().reportLoadingState()
function doReportLoadingState(loadContext) {

    var ctx = getWorkerContext(loadContext);

    // Uncomment to debug a worker that got stuck:
    // const pending = ctx._requestsSent - ctx._requestsReceived;
    // if (pending) {
    //     debugger;
    // }

    const loadingState = {
        // Total number of send/receive (also indexDB etc)
        sent: ctx._requestsSent,
        received: ctx._requestsReceived,
        workerIndex: loadContext.workerIndex,

        // Actual websocket sends/receives
        wsSent: ctx.otgws.txMsg,
        wsReceived: ctx.otgws.rxMsg,
    };
    console.log('WorkerState: ', loadingState);
}

export function register(workerMain) {
    workerMain.register("LOAD_CDN_RESOURCE_OTG", { doOperation: doCdnResourceLoad });
    workerMain.register("INIT_WORKER_OTG", { doOperation: doInitGeomWorker });
    workerMain.register("UPDATE_MRU_TIMESTAMPS_OTG", { doOperation: doPostLoad });
    workerMain.register("REPORT_LOADING_STATE", { doOperation: doReportLoadingState });
}
