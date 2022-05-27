import { workerMain } from "./MainWorker";

//Web worker dispatcher function -- received a message
//from the main thread and calls the appropriate handler
self.addEventListener('message', function(e) {

    var loadContext = e.data;
    loadContext.worker = self;

    workerMain.dispatch(loadContext);

}, false);


self.raiseError = function(code, msg, args) {
    self.postMessage({ "error": { "code": code, "msg": msg, "args": args }});
};

// Shared by all workers to output debug message on console of main thread.
function debug(msg) {
    self.postMessage({debug : 1, message : msg});
}

self.debug = debug;
