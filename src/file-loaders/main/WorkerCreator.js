
const { isNodeJS, getGlobal } = require('../../compat');
var getResourceUrl = require('../../globals').getResourceUrl;

if (isNodeJS()) {

(function() {
    //Node.js case -- the web worker is a "fake" worker
    //running on the main thread.
    var MainWorker = require('../workers/MainWorker-node').MainWorker;

    function createWorker() {
        return new MainWorker();
    }

    function createWorkerWithIntercept() {
        return createWorker();
    }

    function initWorkerScript(successCB, errorCB) {
        if (successCB)
            successCB();
    }

    module.exports = {
        createWorker: createWorker,
        initWorkerScript: initWorkerScript,
        createWorkerWithIntercept: createWorkerWithIntercept
    };

})();

} else {

(function() {

var avp = Autodesk.Viewing.Private;

//Those are globals -- set by the build system.
var LMV_WORKER_URL = avp.LMV_WORKER_URL || "src/file-loaders/workers/MainWorker-web.js";


// A cache of entire worker script as data URL.
var WORKER_DATA_URL = null;
var WORKER_FETCHING_SCRIPT = false;
var WORKER_FETCHING_CALLBACKS = [];

// This mainly is used for testing.
function clearWorkerDataURL() {
    // A cache of entire worker script as data URL.
    WORKER_DATA_URL = null;
}

function initWorkerScript(successCB, errorCB) {

    if (avp.ENABLE_INLINE_WORKER && !WORKER_DATA_URL) {

        WORKER_FETCHING_CALLBACKS.push({
            successCB: successCB
        });

        if (!WORKER_FETCHING_SCRIPT) {
            let xhr = new XMLHttpRequest();
            var scriptURL = LMV_WORKER_URL;

            // We need to request the same version of the library for this worker.  Take the original
            // script url, which will already have the version string (if provided).
            //
            var originalScriptURL = getResourceUrl(LMV_WORKER_URL);

            if (originalScriptURL) {
                scriptURL = originalScriptURL;
            }

            xhr.open("GET", scriptURL, true);
            xhr.withCredentials = false;

            xhr.onload = function () {

                let _window = getGlobal();
                // Set up global cached worker script.
                WORKER_FETCHING_SCRIPT = false;
                let blob;
                _window.URL = _window.URL || _window.webkitURL;

                try {
                    blob = new Blob([xhr.responseText], {type: 'application/javascript'});
                } catch (e) {
                    // Backward compatibility.
                    let builder = new BlobBuilder();
                    builder.append(xhr.responseText);
                    blob = builder.getBlob();
                }
                WORKER_DATA_URL = URL.createObjectURL(blob);

                let callbacks = WORKER_FETCHING_CALLBACKS.concat(); // Shallow copy
                WORKER_FETCHING_CALLBACKS = [];
                for (let i=0; i<callbacks.length; ++i) {
                    callbacks[i].successCB && callbacks[i].successCB();
                }
            };

            WORKER_FETCHING_SCRIPT = true;
            xhr.send();
        }

        // Return a token that can be used to cancel the async call result.
        let token = { };
        token.cancel = function() {
            let idx = -1;
            if ( WORKER_FETCHING_CALLBACKS.some(function(cb, i) {
                if (cb.successCB == successCB) {
                    idx = i;
                    return true;
                }
                return false;
            }) ) {
                WORKER_FETCHING_CALLBACKS.splice(idx, 1);
                return true;
            }

            return false;
        };

        return token;
    } else {
        if (successCB)
            successCB();
    }

    return null;
};

// Create a web worker.
function createWorker(needFarwardProtocolHanlder) {

    let w;

    // When we are not at release mode, create web worker directly from URL.
    if ( avp.ENABLE_INLINE_WORKER ) {
        w = new Worker(WORKER_DATA_URL);
    } else {
        w = new Worker(getResourceUrl(LMV_WORKER_URL));
    }

    w.doOperation = w.postMessage;

    if(needFarwardProtocolHanlder ===  true) {
        avp.ViewingService.forwardProtocolHandlerToWorker(w);
    }

    return w;
}


function createWorkerWithIntercept(needFarwardProtocolHanlder) {
    let worker = createWorker(needFarwardProtocolHanlder);

    worker.checkEvent = function(e) {
        if (e.data && e.data.assetRequest) {
            return true;
        }
        return false;
    };

    let interceptListeners = [];
    function popCallback(listener) {
        if (!interceptListeners) return null;
        for (let i=0; i<interceptListeners.length; ++i) {
            if (interceptListeners[i].arg === listener) {
                let ret = interceptListeners[i].callback;
                interceptListeners.splice(i, 1);
                if (interceptListeners.length === 0)
                    interceptListeners = null;
                return ret;
            }
        }
        return null;
    }

    worker.addEventListenerWithIntercept = function (listener) {

        let callbackFn = function(ew) {
            if (worker.checkEvent(ew))
                return;

            listener(ew);
        };

        if (!interceptListeners) interceptListeners = [];
        interceptListeners.push({ arg: listener, callback: callbackFn });
        worker.addEventListener('message', callbackFn, false);
        return callbackFn;
    };

    worker.removeEventListenerWithIntercept = function(listener) {
        let callbackFn = popCallback(listener);
        if (callbackFn) {
            worker.removeEventListener('message', callbackFn, false);
        }
    };

    worker.clearAllEventListenerWithIntercept = function() {
        if (!interceptListeners) return;
        let copy = interceptListeners.concat();
        for (let i=0; i<copy.length; ++i) {
            worker.removeEventListenerWithIntercept(copy[i].arg);
        }
    };

    return worker;
};

module.exports = {
    createWorker: createWorker,
    initWorkerScript: initWorkerScript,
    createWorkerWithIntercept: createWorkerWithIntercept,
    clearWorkerDataURL: clearWorkerDataURL
};


})();
}
