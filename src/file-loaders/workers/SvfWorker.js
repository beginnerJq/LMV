import { Package } from '../lmvtk/svf/Package';
import { InputStream } from '../lmvtk/common/InputStream';
import { ViewingService } from '../net/Xhr';
import { ErrorCodes } from '../net/ErrorCodes';

function guardFunction(loadContext, func)
{
    try {
        func();
    }
    catch (exc) {
        loadContext.worker.raiseError(
            ErrorCodes.BAD_DATA, "Unhandled exception while loading SVF",
            { "url": loadContext.url, "exception": exc.toString(), "stack": exc.stack });
        loadContext.worker.postMessage(null);
    }
}

function doLoadSvfContinued(loadContext)
{
    var _this = loadContext.worker;

    guardFunction(loadContext, function(){
        var svf = loadContext.svf;
        function loadDoneCallback(type, meshMessage) {
            if (type == "svf") {

                var msg, xfer;
                var frags = svf.fragments;
                var transferable = [
                    frags.transforms.buffer,
                    frags.packIds.buffer,
                    frags.entityIndexes.buffer,
                    frags.fragId2dbId.buffer,
                    frags.visibilityFlags.buffer
                ];

                if (svf.bvh) {
                    // BVH is posted together with svf,
                    // so can add more buffer to transfer.
                    xfer = {
                        nodes: svf.bvh.nodes.getRawData(),
                        primitives: svf.bvh.primitives,
                        useLeanNodes: (svf.bvh.nodes.bytes_per_node == 32)
                    };
                    transferable.push(xfer.nodes);
                    transferable.push(xfer.primitives.buffer);

                    // Then can safely transfer following buffers from fragments.
                    transferable.push(frags.boxes.buffer);
                    transferable.push(frags.polygonCounts.buffer);
                    transferable.push(frags.materials.buffer);

                    msg = { "svf" : svf, "bvh" : xfer, progress: 1.0 };
                }
                else {
                    msg = { "svf" : svf, progress: 0.8 };
                }

                _this.postMessage(msg, transferable);
            } else if (type == "bvh") {
                xfer = {
                    nodes: svf.bvh.nodes.getRawData(),
                    primitives: svf.bvh.primitives,
                    useLeanNodes: (svf.bvh.nodes.bytes_per_node == 32)
                };

                _this.postMessage( { "bvh" : xfer, basePath: svf.basePath, progress: 1.0 },
                                    [xfer.nodes, xfer.primitives.buffer] );

            } else if (type == "mesh") {

                var transferList = [];
                if (meshMessage.mesh)
                    transferList.push(meshMessage.mesh.vb.buffer);

                _this.postMessage(meshMessage, transferList);

            } else if (type == "done") {
                _this.postMessage( { progress: 1.0 } );
            }
            else {
                _this.raiseError(
                    ErrorCodes.BAD_DATA, "Failure while loading SVF",
                    { "url": loadContext.url });
                _this.postMessage(null);
            }
        }

        loadContext.loadDoneCB = loadDoneCallback;

        svf.loadRemainingSvf(loadContext);
    });
}

function doLoadSvf(loadContext) {

    var _this = loadContext.worker;

    _this.postMessage({progress:0.01}); //Tell the main thread we are alive

    var type = "svf";

    function onSuccess(result) {

        _this.postMessage({progress:0.5}); //rough progress reporting -- can do better

        guardFunction(loadContext, function() {

            // result is arraybuffer
            var svf = new Package(new Uint8Array(result));
            loadContext.svf = svf;
            svf.loadManifest(loadContext);


            if(loadContext.interceptManifest) {
                _this.postMessage({"manifest" : svf.manifest});
            } else {
                loadContext.manifest = svf.manifest;
                doLoadSvfContinued(loadContext);
            }
        });
    }

    var options = {
        responseType: "arraybuffer"
    };

    // Begin download the target SVF file with a GET request.
    ViewingService.getItem(loadContext, loadContext.url, onSuccess, loadContext.onFailureCallback, options);

    if ( type === "svf" ) {
        // Prefetch the first geometry pack (we assume there is one) to mask 
        // some latency. Note that errors are intentionally ignored here.
        ViewingService.getItem(loadContext, loadContext.basePath + "0.pf", function(){}, function(){}, options);
    }
}


function doFetchTopology(loadContext) {

    var _this = loadContext.worker;
    ViewingService.getItem(loadContext, loadContext.path, onSuccess, onFailure);

    // on success
    function onSuccess(data){

        _this.postMessage({ "status-topology": { } }); // download is complete

        // This lines below may take a while...
        var topology = null;
        try {
            var jdr = new InputStream(data);
            var byteLength = data.byteLength;
            if (0 < byteLength) {
                topology = JSON.parse(jdr.getString(byteLength));
            }
            if (topology) {
                _this.postMessage({ "fetch-topology": { error: null, topology: topology } }); // parsing is complete
            } else {
                onFailure('topology-no-content');
            }
        } catch (eee) {
            onFailure(eee);
        }
    }

    // on-failure
    function onFailure(err) {
        _this.postMessage({ "fetch-topology": { error: err, topology: null } });  // something went wrong
    }
}

export function register(workerMain) {
    workerMain.register("LOAD_SVF", { doOperation: doLoadSvf });
    workerMain.register("LOAD_SVF_CONTD", { doOperation: doLoadSvfContinued });
    workerMain.register("FETCH_TOPOLOGY", { doOperation: doFetchTopology });
}
