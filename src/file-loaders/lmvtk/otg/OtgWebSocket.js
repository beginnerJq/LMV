const WebSocket = require('isomorphic-ws');

const hexToBin = require("./HashStrings").hexToBin;
const getHexStringPacked = require("./HashStrings").getHexStringPacked;

//Copied from compat.js to avoid importing ES6 exports from plain node.js forge-tools.
const isBrowser = (typeof navigator !== "undefined");
const isNodeJS = function() {
    return !isBrowser;
};

const _maxRequests = 200;

//OTG web socket protocol.
class OtgWs {

    constructor(loadContext, loadCB, errorCB) {

        this.ws = null;
        this.numRequests = 0;
        this.txMsg = 0;
        this.rxMsg = 0;
        this.authorizeUrns = {};
        this._pendingCallbacks = [];
        this._retriedOpen = 0;
        this._loaderCounter = 0; // The amount of loaders that requested a socket initialization, but no shutdown yet
        this.loaderCloseRequested = 0; // The number of loaders that requested a socket close while it's still used.
        this._opening = false; // The socket was created, but the open handler hasn't been called yet
        this._openRequested = false; // Opening a socket was requested but got delayed due to pending close handler
        this._clientClose = false; // The socket was closed, but the close handler hasn't been called yet
        this._closeRequested = false; // Closing the socket was requested, but got delayed because it was still in use
        this._wsUsable = !loadContext.disableWebSocket && (typeof WebSocket !== "undefined") && !!loadContext.otg_ws;
        this.loadCB = loadCB;
        this.errorCB = errorCB;

        this._pendingMdata = [];
        this._pendingSends = {};

        this.msgBuffer = new Uint8Array(201);

        this.addAuthorizeUrns(loadContext);
    }

    notifyPendingCallbacks(ws) {
        this._pendingCallbacks.forEach(function(cb) {
            cb(ws);
        });
        this._pendingCallbacks = [];
    }

    addAuthorizeUrns(loadContext) {
        //Remember which URNs need to be authorized for CDN data via the web socket
        if (loadContext && loadContext.authorizeUrns) {
            let newUrns;

            loadContext.authorizeUrns.forEach(urn => {
                if (!this.authorizeUrns[urn]) {
                    if (!newUrns)
                       newUrns = [];
                    newUrns.push(urn);
                }
                this.authorizeUrns[urn] = 1;
            });

            // If new urns have been added and the web socket is already open, authorize the new urns directly.
            // This is required because we won't go through the `open` handler anymore.
            if (newUrns && newUrns.length) {
                const ws = this.getWebSocket();
                if (ws && !this._opening) {
                    for (let urn of newUrns) {
                        ws.send("/auth/" + urn);
                    }
                }
            }
        }
    }

    getWebSocket() {

        //Socket already established?
        var ws = this.ws;
        if (ws && ws.readyState === 1) {
            return ws;
        } else if (ws && ws.readyState === 0) {
            console.warn("Reentry into getWebSocket. Should not happen.");
            //If we get called while the web socket is still opening,
            //ignore the callback, we will continue processing once it's open.
            return null;
        }

        return null;
    }

    initializeSocket() {
        const ctx = this;

        // If we're in the process of closing a socket (i.e. its close handler hasn't been called yet),
        // we post-pone the initialization of a new socket until the old one is closed.
        // This is to prevent web socket open / close handler race conditions.
        if (this._clientClose) {
            this._openRequested = true;
            return;
        }

        this.openWebSocket(ws => {
            ctx.flushEvent = setInterval(() => {
                if (ctx.ws)
                    ctx.flushSendQueue();
            }, 200);

            ctx.notifyPendingCallbacks(ws);
        });
    }

    startSession(loadContext, doneCB) {

        // Keep track of how many loaders are currently using this socket.
        if (loadContext?.operation === 'INIT_WORKER_OTG') {
            this._loaderCounter++;
            // A loader wants to use this socket, so we drop any deferred close requests.
            this._closeRequested = false;
        }

        if (!this._wsUsable) {
            doneCB && doneCB(null);
            return;
        }

        this.addAuthorizeUrns(loadContext);

        var ctx = this;

        //Remember the given callback
        doneCB && ctx._pendingCallbacks.push(doneCB);

        //Are we still in the process of opening the socket?
        if (ctx._opening || ctx._openRequested) {
            return;
        }

        //If socket is already open, notify the callback (and any previously pending callbacks
        var ws = this.getWebSocket();
        if (ws) {
            this.notifyPendingCallbacks(ws);
            return;
        }

        if (loadContext)
            this.loadContext = loadContext;

        //console.log("Init worker called");

        this.initializeSocket();
    }

    endSession(deferred = false) {
        var ctx = this;

        // Deferred means that we are re-entering this from a web socket's open handler
        // (endSession was called before, but didn't close the socket yet because it hadn't been initialized).
        // In this case, we already decreased the loader counter.
        if (!deferred)
           ctx._loaderCounter -= this.loaderCloseRequested || 1;

        if (ctx._loaderCounter > 0) {
            // We still have loaders using this socket
            return;
        }

        // Remember that a socket close was requested. It's possible that we don't close the socket yet,
        // either because we're still expecting an open handler to be called (would cause race conditions),
        // or because there are still pending requests. In this case, we will close the socket as soon as possible.
        ctx._closeRequested = true;

        //The worker can be used by multiple loaders, so only close the
        //web socket if it's not waiting on other requests.
        if (ctx.numRequests) {
            console.warn("Messages still pending. Leaving WebSocket open.");
            return;
        }

        var ws = ctx.getWebSocket();
        if (ws && ws.readyState === 1 && !ctx._opening) {

            console.log("Web socket close.");
            ctx._clientClose = true;
            ctx._closeRequested = false;
            ctx._opening = false;
            ws.close(1000);
            ctx.ws = null;
        }

        if (ctx.flushEvent) {
            //We do not actually expect any pending messages here, because
            //this function gets called after the whole model is loaded.

            clearInterval(ctx.flushEvent);
            ctx.flushEvent = null;
        }
    }

    openWebSocket(openCB) {

        var loadContext = this.loadContext;
        let ctx = this;

        ctx._opening = true;

        //http and 7124->7125 are here to support local debugging, when the endpoints are overridden to
        //point directly to local node.js process(es).
        let url = loadContext.otg_ws.replace("https:", "wss:").replace("http:", "ws:").replace(":7124", ":7125");

        if (loadContext.queryParams) {
            url += "?" + loadContext.queryParams;
        }

        let ws = new WebSocket(url, undefined , { headers: loadContext.headers });

        ws.addEventListener('open', () => {

            ctx._opening = false;
            ctx.ws = ws;

            // Check if the session has been closed by the client before the web socket was open.
            // This can happen if the model is served from the cache, for example. If so, this open handler might be
            // called after `endSession`. We invoke it again here, to properly clean up resources.
            if (ctx._closeRequested && ctx._loaderCounter === 0) {
                ctx.endSession(true);
                return;
            }

            ctx.accountIdSent = null;

            ws.binaryType = "arraybuffer";

            //On web clients that do not use the cookie approach, the headers
            //will not get sent (unlike on node.js WebSocket implementation
            //so we send the Authorization first thing after open
            if (!isNodeJS()) {
                //console.log("Sending headers as message", JSON.stringify(loadContext.headers));
                ws.send("/headers/" + JSON.stringify(loadContext.headers));
            }

            //Tell the server that we support batched responses
            ws.send("/options/" + JSON.stringify({batch_responses:true}));
            ctx.batchResponses = true;

            //Tell the server to authorize the web socket
            //for the URNs that we will be loading
            for (var urn in ctx.authorizeUrns) {
                ws.send("/auth/" + urn);
            }

            openCB(ws);
        });

        ws.addEventListener('message', data => {
            if (ctx.batchResponses)
                this.decodeBatchMessage(new Uint8Array(data.data));
            else
                this.decodeSingleItemMessage(new Uint8Array(data.data));
        });

    ws.addEventListener('close', function close(event) {
        if (ctx.numRequests) {
            console.log("Socket close", event.code, event.reason, "pending:", ctx.numRequests, "tx:", ctx.txMsg, "rx:", ctx.rxMsg);
           //TODO: we need to take care of the case where there were pending requests when the socket
            //closed -- we have to reissue those requests.
        }

        ctx._opening = false;
        ctx.ws = null;

        const reset = () => {
            ctx._clientClose = false;
            ctx._closeRequested = false;
        };

        if (!ctx._clientClose && ctx.numRequests) {

            console.log("Abnormal socket close. Retrying.", event.code, event.reason, "pending:", ctx.numRequests);
            ctx._retriedOpen++;

            ctx.numRequests = 0;

            //case where there were pending requests when the socket
            //closed -- we have to reissue those requests.
            if (ctx._retriedOpen <= 3) {
                setTimeout(() => {
                    ctx.openWebSocket(function(ws) {
                        // We have to set this to anything but the init operation, to prevent erroneous loader counting.
                        ctx.loadContext.operation = 'RETRY';
                        ctx.errorCB && ctx.errorCB(ctx.loadContext);
                    });
                }, 2000);
            } else {
                console.error("Too many WebSocket failures. Giving up on mesh load.");

                ctx._wsUsable = false;

                //Tell our owner that they need to retry or fail or something.
                ctx.errorCB && ctx.errorCB(ctx.loadContext);
            }

            if (ctx._loaderCounter > 0 && !ctx._openRequested) {
                ctx._loaderCounter = 0;
            }
        } else if (ctx._openRequested) {
            // Socket initialization was requested before close was complete, so it got deferred.
            reset();
            ctx._openRequested = false;
            ctx.initializeSocket();
        }

        reset();
    });

    ws.addEventListener('error', function incoming(data) {
        console.log("ws error, reverting to plain http.", data);

        ctx._opening = false;
        ctx._openRequested = false;
        ctx.ws = null;

        ctx._wsUsable = false;

        ctx.notifyPendingCallbacks(ctx, ws);

        ctx.errorCB && ctx.errorCB(true);
    });

    }

    decodeSingleItemMessage(buf, resourceType) {
        var hash = getHexStringPacked(buf, 0, 20);
        var datagz = new Uint8Array(buf.buffer, buf.byteOffset + 20, buf.length - 20);

        this.numRequests--;
        this.rxMsg++;
        this.loadCB(datagz, hash, this.loadContext, false, resourceType);
    }

    //Packed message format, where the response from the server may contain multiple items in the same
    //buffer.
    /*
        The format is as follows:

        Bytes      Meaning
        ------------------------------
        0-3        Magic number. The bytes 'OPK1'
        4-7        Currently unused flags + resource type (ASCII 'm' or 'g') in byte 0 of this integer.
        8-11       Number of items in the message stream. Little endian.
        12-15      Offset of the first item in the data buffer (first item is implicitly at offset 0, so this is always zero)
        16-19      Offset of the second item in the data buffer
        20-...     etc... subsequent offsets, one per item
        ...
        Remaining bytes: all items combined into single buffer
    */
    decodeBatchMessage(data) {

        const prefixLength = 12;

        let headerInt = new Int32Array(data.buffer, 0, prefixLength / 4);

        if (headerInt[0] !== 0x314B504F) {
            console.error("Invalid message format", headerInt[0].toString(16), headerInt[1], data);
            return;
        }

        let resourceType = String.fromCharCode(headerInt[1] & 0xff);

        let numItems = headerInt[2];
        let offsets = new Int32Array(data.buffer, prefixLength, numItems);

        let baseOffset = prefixLength + numItems * 4;

        for (let i=0; i<offsets.length; i++) {
            let start = offsets[i];
            let end = (i < offsets.length -1) ? offsets[i+1] : data.length - baseOffset;

            let oneItem = new Uint8Array(data.buffer, start + baseOffset, end - start);

            this.decodeSingleItemMessage(oneItem, resourceType);
        }
    }


    flushSendQueue() {

        var ctx = this;

        for (let accountId in ctx._pendingSends) {

            let ws = this.getWebSocket();

            // ws may be null if socket is not ready (e.g., readyState closing)
            if (!ws) {
                return;
            }

            // Set accountId for the following messages
            if (ctx.accountIdSent !== accountId) {
                ws.send("/account_id/" + accountId);
                ctx.accountIdSent = accountId;
            }

            for (let type in ctx._pendingSends[accountId]) {

                let msgs = ctx._pendingSends[accountId][type];

                if (!msgs.length)
                    continue;

                ctx.txMsg += msgs.length;

                //Send all hashes collected in requestResources in a single shot websocket message

                //Enlarge the accumulation buffer if needed
                let len = 1 + msgs.length*20;
                if (ctx.msgBuffer.length < len) {
                    ctx.msgBuffer = new Uint8Array(len);
                }

                let allBufs = ctx.msgBuffer;

                allBufs[0] = type.charCodeAt(0);
                for (let i=0; i<msgs.length; i++) {
                    hexToBin(msgs[i], allBufs, 1+i*20);
                }

                ws.send(new Uint8Array(allBufs.buffer, 0, len));
            }

            delete ctx._pendingSends[accountId];
        }
    }

    // @param {string}   urls - list of request urls
    // @param {string}   hashes - list of hashes corresponding to each item in the urls list.
    // @param {string}   type - one of "t", "m" or "g"
    requestResources(urls, hashes, type) {

        if (!this.ws) {
            console.error("Trying to request resources over non-existent web socket,");
            return;
        }

        var ctx = this;
        type = type || "g";

        for (var i=0; i<urls.length; i++) {
            ctx.numRequests++;

            let url = urls[i];

            var wspath = url.slice(url.indexOf("/cdn/") + 5);
            var parts = wspath.split("/");

            if (!ctx._pendingSends[parts[1]]) {
                ctx._pendingSends[parts[1]] = {
                    "g": [],
                    "m": [],
                    "t": []
                };
            }
            ctx._pendingSends[parts[1]][type].push(hashes[i]);

            if (ctx._pendingSends[parts[1]][type].length > _maxRequests) {
                ctx.flushSendQueue();
            }
        }
    }

}

module.exports.OtgWs = OtgWs;