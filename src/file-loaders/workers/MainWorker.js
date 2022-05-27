import { ViewingService } from "../net/Xhr";
import { endpoint } from "../net/endpoints";

export class WorkerMain {

    constructor() {
        this._workers  = {};
    }
    dispatch(loadContext) {

        if(!loadContext.hasOwnProperty('operation')) {
            return;
        }

        //TODO TS:
        if (loadContext.endpoint)
            endpoint.setEndpointAndApi(loadContext.endpoint, loadContext.api);


        var target = this._workers[loadContext.operation];
        if (!target)
            return;

        //Initialize the path that contains the requested
        //file. It's the root for other relative paths referenced
        //by the base file.
        loadContext.basePath = "";
        if (loadContext.url) {
            var lastSlash = loadContext.url.lastIndexOf("/");
            if (lastSlash != -1)
                loadContext.basePath = loadContext.url.substr(0, lastSlash+1);
        }

        // Create the default failure callback.
        //
        loadContext.raiseError = function() {
            loadContext.worker.raiseError.apply(loadContext.worker, arguments);
        };
        loadContext.onFailureCallback = ViewingService.defaultFailureCallback.bind(loadContext);

        target.doOperation(loadContext);
    }

    register(operation, worker) {
        this._workers[operation] = worker;
    }

    unregister(operation) {
        delete this._workers[operation];
    }
}

export let workerMain = new WorkerMain();

//Add all the worker entry points.
//Those need to execute in order to register themselves
//with the web worker operation dispatcher
require("./SvfWorker").register(workerMain);
require("./GeomWorker").register(workerMain);
require("./F2dParseWorker").register(workerMain);
require("./F2dStreamWorker").register(workerMain);
require("./OtgBvhWorker").register(workerMain);
require("./OtgLoadWorker").register(workerMain);
require("./PropWorker").register(workerMain);
require("./ConsolidationWorker").register(workerMain);

// when we request some resource from some kinds of URL
// This method will give the worker ability to support EMSCRIPTEN File Sytstem
// Or indexedDB in future
function registerFilePort(event) {
    if(event && event.protocolPortMap) {
        for(var p in event.protocolPortMap) {
            ViewingService.registerProtocolPort(p,  event.protocolPortMap[p]);
        }
    }
}

workerMain.register("REGISTER_FILE_PORT", {doOperation: registerFilePort});
