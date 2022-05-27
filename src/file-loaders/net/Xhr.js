// These are needed in order to support async/await.
import "core-js";
import "regenerator-runtime/runtime";

import { logger } from "../../logger/Logger";
import { ErrorCodes } from "./ErrorCodes";
import { blobToJson } from '../lmvtk/common/StringUtils';
import { endpoint } from "./endpoints";
import { isNodeJS, getGlobal } from "../../compat";
import { backOff } from 'exponential-backoff';

var pako = require('pako');

    export let ViewingService = { };
    ViewingService.WORKER_REGISTER_FILE_PORT = "REGISTER_FILE_PORT";
    ViewingService.WORKER_READ_FILE = "READ_FILE";

    var warnedGzip = false;

    // Simplify Unix style file path. For example, turn '/a/./b/../../c/' into "/c".
    // Required to deal with OSS crappy URNs where there are embedded '..'.
    function simplifyPath(path) {

        var elements = path.split('/');
        if (elements.length == 0)
            return path;

        var stack = [];
        for (var index = 0; index < elements.length; ++index) {
            var c = elements[index];
            if (c === '.') {
                continue;
            }  if (c === '..' && stack.length) {
                stack.pop();
            } else {
                stack.push(c);
            }
        }

        // Great, the path commits suicide.
        if (stack.length == 0)
            return '';

        return stack.join("/");
    }

    //Maps a relative resource path (like a pack file or texture)
    //to an absolute URL. If absoluteBasePath is specified, it is
    //used to construct the absolute URL, otherwise the window location
    //is used.
    export function pathToURL(path, absoluteBasePath) {

        if (path.indexOf("://") !== -1 ||
            path.indexOf("urn:") === 0) {
            return path;
        }

        if (absoluteBasePath) {
            return absoluteBasePath + path;
        }

        if (typeof window === "undefined")
        return path;
        
        const _window = getGlobal();
        var rootRelPath = _window.location.pathname;
        //chop off the index.html part
        var lastSlash = rootRelPath.lastIndexOf("/");
        rootRelPath = rootRelPath.substr(0, lastSlash+1);
        var absPath = _window.location.protocol + "//" + _window.location.host + rootRelPath + path;
        return absPath;
    }


    ViewingService.simplifyPath = simplifyPath;

    export function textToArrayBuffer(textBuffer, startOffset) {
        var len = textBuffer.length - startOffset;
        var arrayBuffer = new ArrayBuffer(len);
        var ui8a = new Uint8Array(arrayBuffer, 0);
        for (var i = 0, j = startOffset; i < len; i++, j++)
            ui8a[i] = (textBuffer.charCodeAt(j) & 0xff);
        return ui8a;
    }


    ViewingService.OSS_PREFIX = "urn:adsk.objects:os.object:";

    /**
     * Construct full URL given a potentially partial viewing service "urn:" prefixed resource
     * @returns {string}
     */
    ViewingService.generateUrl = function (baseUrl, api, path, apiData, escapeOssObjects, guid) {

        path = path || "";

        //NODE
        if (isNodeJS() && !isRemotePath(baseUrl, path)) {
            return path;
        }

        path = simplifyPath(path);

        //V2 only accepts URL encoded paths
        var urnidx = path.indexOf("urn:");
        var qidx = path.indexOf("?");
        if (urnidx != -1) {
            if (qidx !== -1) {
                //TODO: not sure this will happen, queryParams are normally
                //passed in separately in the options object
                path = path.slice(0, urnidx) + encodeURIComponent(path.slice(urnidx, qidx)) + path.slice(qidx);
            } else {
                path = path.slice(0, urnidx) + encodeURIComponent(path.slice(urnidx));
            }
        } else {
            path = encodeURI(path);
        }

        // OSS only accepts object ids with escaped slashes
        if (escapeOssObjects && ViewingService.isOSSUrl(path)) {
          var objectsIndex = path.indexOf("/objects/") + 9;
          var objectPath = path.substring(objectsIndex);
          path = path.substring(0, objectsIndex) + encodeURIComponent(objectPath);
        }

        //Check if it's a viewing service item path
        //Public/static content will not have the urn: prefix.
        //So URL construction is a no-op
        if (!api || decodeURIComponent(path).indexOf('urn:') !== 0) {
            if (isRemotePath(null, path))
                return path;
            else
                return baseUrl + path;
        }

        //Remove "urn:" prefix when getting URN-based stuff (manifests and thumbnails)
        if (api !== 'items') {
            path = path.substr(6);
        }

        switch (api) {
            case "items": return endpoint.getItemApi(baseUrl, path, apiData);
            case "bubbles": return endpoint.getManifestApi(baseUrl, path, apiData);
            case "thumbnails": return endpoint.getThumbnailApi(baseUrl, path, apiData);
            case "properties": return endpoint.getPropertyQueryApi(baseUrl, path, apiData, guid);
        }
    };

    function isRemotePath(baseUrl, path) {
        if (path.indexOf("file://") !== -1)
            return false;
        if (path.indexOf("://") !== -1)
            return true;
        if (baseUrl)
            return true;
    }


//Conditional GET request implementation for node vs. browser
if (isNodeJS()) {

(function() {

    var fs = require('fs');
    var zlib = require('zlib');
    var https = require('https');
    var http = require('http');
    var urllib = require('url');

    let httpsAgent = new https.Agent({
        keepAlive : true,
        keepAliveMsecs: 100,
        maxSockets: 10
    });
    let httpAgent = new http.Agent({
        keepAlive : true,
        keepAliveMsecs: 100,
        maxSockets: 10
    });


    var forgeAgent = new https.Agent({maxSockets:10});

    function loadLocalFile(url, onSuccess, onFailure, options) {

        if (url.indexOf("file://") === 0)
            url = url.substr(7);

        function postProcess(data) {
            if (options.responseType === "json") {
                try {
                    return JSON.parse(data.toString("utf8"));
                } catch(e) {
                    onFailure(e);
                }
            }
            return data;
        }

        //Always use async on Node
        fs.readFile(url, function(error, data) {
            if (error) {
                onFailure(0,0,{httpStatusText:error, url:url});
            } else {
                if (data[0] === 31 && data[1] === 139) {
                    zlib.gunzip(data, null, function(error, data) {
                        if (error)
                            onFailure(0,0,{httpStatusText:error, url:url});
                        else {
                            data = postProcess(data);
                            if (options.ondata)
                                options.ondata(data);
                            onSuccess(data);
                        }
                    });
                } else {
                    data = postProcess(data);
                    if (options.ondata)
                        options.ondata(data);
                    onSuccess(data);
                 }
            }
        });
    }

    function needsGunzip(res, pathname) {

        if (res.headers['content-encoding'] === 'gzip')
            return true;

        //These SVF related files come pre-gzipped
        //regardless of content-encoding header

        if (pathname.endsWith(".json.gz"))
            return true;

        if (pathname.endsWith("FragmentList.pack"))
            return true;

        if (pathname.endsWith("LightList.bin"))
            return true;

        if (pathname.endsWith("CameraList.bin"))
            return true;

        if (pathname.endsWith("CameraDefinitions.bin"))
            return true;

        if (pathname.endsWith("LightDefinitions.bin"))
            return true;

        return false;
    }


    /**
     *  Performs a GET/HEAD request to Viewing Service. (Node.js specific implementation)
     *
     * @param {string} viewingServiceBaseUrl - The base url for the viewing service.
     * @param {string} api - The api to call in the viewing service.
     *  @param {string} url - The url for the request.
     *  @param {function} onSuccess - A function that takes a single parameter that represents the response
     *                                returned if the request is successful.
     *  @param {function} onFailure - A function that takes an integer status code, and a string status, which together represent
     *                                the response returned if the request is unsuccessful, and a third data argument, which
     *                                has more information about the failure.  The data is a dictionary that minimally includes
     *                                the url, and an exception if one was raised.
     *  @param {Object=} [options] - A dictionary of options that can include:
     *                               headers - A dictionary representing the additional headers to add.
     *                               queryParams - A string representing the query parameters
     *                               responseType - A string representing the response type for this request.
     *                               {boolean} [encodeUrn] - when true, encodes the document urn if found.
     *                               {boolean} [noBody] - when true, will perform a HEAD request
     */
    ViewingService.rawGet = function (viewingServiceBaseUrl, api, url, onSuccess, onFailure, options) {

        options = options || {};

        url = ViewingService.generateUrl(viewingServiceBaseUrl, api, url, undefined, options.escapeOssObjects);

        if (!isRemotePath(viewingServiceBaseUrl, url)) {
            loadLocalFile(url, onSuccess, onFailure, options);
            return;
        }

        if (options.queryParams) {
            var concatSymbol = url.indexOf('?') === -1 ? '?' : '&';
            url = url + concatSymbol + options.queryParams;
        }

        var parsed = urllib.parse(url);

        var req = {
            host:                  parsed.hostname,
            port:                  parsed.port,
            method:                options.method || "GET",
            path:                  parsed.path,
            headers: { },
            retryCount:            0,
            agent:                 (parsed.protocol === "https:") ? httpsAgent : httpAgent
        };

        //Don't overload derivative service with requests
        if (req.host.endsWith(".api.autodesk.com") &&
            (req.path.startsWith("/derivativeservice") || req.path.startsWith("/modelderivative"))) {
            req.agent = forgeAgent;
        }

        if (options.headers) {
            for (var p in options.headers) {
                req.headers[p] = options.headers[p];
            }
        }

        if (!req.headers['accept-encoding']) {
            req.headers['accept-encoding'] = 'gzip, deflate';
        }

        if (options.range) {
            req.headers["Range"] = "bytes=" + options.range.min + "-" + options.range.max;
        }

        //Undo hack used to make streaming receive work on browser XHR -- the hack
        //involves processing the response as text, so responseType is set to "".
        if (options.ondata || options.onprogress) {
            options.responseType = "arraybuffer";
        }

        var request = ((parsed.protocol === "https:") ? https : http).request(req, function(res) {

            var hasError =  !(res.statusCode >= 200 && res.statusCode < 400);

            //Pipe through gunzip if needed
            var stream = res;
            if (!hasError && needsGunzip(res, parsed.pathname) && !options.skipDecompress) {
                stream = res.pipe(zlib.createGunzip());
            }

            //Decode as UTF8 string if needed
            if (options.responseType === "json" || options.responseType === "text" || !options.responseType)
                stream.setEncoding('utf8');
                
            var chunks = [];
            var receiveBuffer = Buffer.allocUnsafe(65536);
            var receivedLen = 0;
            stream.on('data', function(chunk) {

                //The onprogress callback is special in that it
                //want us to accumulate the data as we receive it, and it only looks at it.
                if (options.onprogress) {

                    if (chunk.length + receivedLen > receiveBuffer.length) {
                        var nb = Buffer.allocUnsafe(0 | Math.ceil(receiveBuffer.length * 1.5));
                        receiveBuffer.copy(nb, 0, 0, receivedLen);
                        receiveBuffer = nb;
                    }

                    chunk.copy(receiveBuffer, receivedLen, 0, chunk.length);
                    receivedLen += chunk.length;
                    let abort = options.onprogress(receiveBuffer, receivedLen);
                    if (abort)
                        request.abort();
                    return;
                } else {
                    chunks.push(chunk);
                }

                if (options.ondata) {
                    options.ondata(chunk);
                }

            });

            stream.on('end', function() {

                if(res.statusCode >= 200 && res.statusCode < 400) {

                    if (options.responseType === "json") {
                        var jsobj = JSON.parse(chunks.join(''));
                        onSuccess(jsobj);
                        return;
                    }

                    if (options.responseType === "text" || options.responseType === "") {
                        var str = chunks.join('');
                        onSuccess(str);
                        return;
                    }

                    var buf = options.onprogress ? receiveBuffer : Buffer.concat(chunks);

                    if (!options.skipDecompress && buf[0] === 31 && buf[1] === 139) {

                        logger.warn("An LMV resource (" + url + ") was double compressed, or Content-Encoding header missing");

                        try {
                            buf = zlib.gunzipSync(buf);
                            receivedLen = buf.length;
                        } catch (err) {
                            onFailure(ErrorCodes.BAD_DATA,
                                      "Malformed data received when requesting file",
                                      { "url": url, "exception": err.toString(), "stack": err.stack });
                        }
                    }

                    if (request.status === 200 && options.range) {
                        //If we requested a range, but the entire content was returned,
                        //make sure to give back just the requested subset to the caller
                        buf = new Uint8Array(buf, options.range.min, options.range.max - options.range.min);
                    }

                    onSuccess(buf, receivedLen);

                } else {

                    if (onFailure)
                        onFailure(res.statusCode, res.statusMessage, {url: url});

                }
            });

        });

        request.on("error", function(error) {
            if (onFailure)
                onFailure(error.code, error.message, {url: url});
        });

        if (options.postData) {
            request.write(options.postData);
        }

        request.end();

    };

})();

} else {

    var Pend = require("pend");
    var xhrThrottle = new Pend();
    xhrThrottle.max = 25;

    var protocolPortMap = {};
    var pendingPortRequest = {};
    var pendingRequestChannelMap = {};

    /**
     * Explain how the protocol handler working in general here
     * Why adding this function:
     * In Emscripten it has a virtual file system, it provide us ability to run wasm loader to load 
     * native DWF models, and write the output in that virtual file system
     * 
     * While, we run the extraction code in the worker, it makes us hard to read the data back since only 
     * the worker thread can read that data. But we need put the resource in the bubble data to indicate that
     * this data is from Emscripten Virtual File System, the urn is not an http(s) or file.
     * 
     * It makes the whole process complex, we don't want to change the existing data schema(bubble) so we need
     * to add a support in the Xhr.js to support the this resource request.
     * 
     * The idea here is we register a MessagePort in the main thread, and once we create a worker which need to
     * load the special resource, it will check whether this special protocol has a handler or not. If it does,
     * it will let the handler to do the heavy lifting. 
     * 
     * In the WorkerCreator, it will create new  MessageChannel between new created worker and the main thread,
     * it became the bridge to get the actual resource from the loader who registered the protocol
     * 
     */
    ViewingService.registerProtocolPort = function(protocol, port) {
        if((/^(http(s)?|file):/gi.test(protocol))) {
            // for peace of mind: security
            console.warn("http(s) or file protocol were not allowed to be handled");
            return;
        }

        if(!port) {
            // means we need to remove if there is a port open
            if(protocolPortMap[protocol] && protocolPortMap[protocol] instanceof MessagePort) {
                protocolPortMap[protocol].onmessage = undefined;
                protocolPortMap[protocol] = undefined;
            }

            return;
        }

        protocolPortMap[protocol] = port;
        
        port.onmessage = function(message) {
            var url = message.data.url;
            if(pendingPortRequest[url]) {
                var pendingHandler = pendingPortRequest[url];

                if(message.data.error) {
                    pendingHandler.onFailureWrapped(ErrorCodes.BAD_DATA,
                        "Malformed data received when requesting file",
                        { "url": url, "exception": message.data.error.message, "stack": message.data.error.stack});
                } else {
                    // In the worker whom is root when request the data
                    var rawbuf = message.data.buffer;
                    pendingPortRequest[url] = undefined;

                    if(rawbuf[0] === 31 && rawbuf[1] === 139 && url.match(/(.f2d|.gz)$/gi)) {
                        try {
                            rawbuf = pako.ungzip(rawbuf);
                            if(pendingHandler.options && pendingHandler.options.ondata) {
                                pendingHandler.options.ondata(rawbuf);
                            }
                            pendingHandler.onSuccessWrapped(rawbuf);
                        } catch (err) {
                            pendingHandler.onFailureWrapped(ErrorCodes.BAD_DATA,
                                    "Malformed data received when requesting file",
                                    { "url": url, "exception": err.toString(), "stack": err.stack });
                        }
                    } else {
                        pendingHandler.onSuccessWrapped(rawbuf);
                    }
                }
            } else if (pendingRequestChannelMap[url]) {
                // For the middle man
                var transfer = [];
                if(message.data && message.data.buffer && message.data.buffer.buffer instanceof ArrayBuffer) {
                    transfer.push(message.data.buffer.buffer);
                }
                pendingRequestChannelMap[url].postMessage(message.data, transfer);
                pendingRequestChannelMap[url] = undefined;
            }
        };
    };

    ViewingService.handlerProtocol = function(protocol, url, onSuccessWrapped, onFailureWrapped, options) {
        var port = protocolPortMap[protocol];
        pendingPortRequest[url] = {
            onSuccessWrapped,
            onFailureWrapped,
            options
        };

        port.postMessage({
            operation: ViewingService.WORKER_READ_FILE,
            url
        });
        
    };

    ViewingService.forwardProtocolHandlerToWorker = function(worker) {
        var map = {};

        // create the middle man who connect between the worker who need to request the resource
        // and the main thread
        var channel = new MessageChannel();
        channel.port1.onmessage = function(message) {
            var url = new URL(message.data.url);
            protocolPortMap[url.protocol].postMessage(message.data);
            pendingRequestChannelMap[url] = channel.port1;
        };

        for(var key in protocolPortMap) {
            if(protocolPortMap[key] instanceof MessagePort) {
                map[key] = channel.port2;
            }
        }

        worker.doOperation({
            operation: ViewingService.WORKER_REGISTER_FILE_PORT,
            protocolPortMap: map
        }, [channel.port2]);
    };

    ViewingService.rawGet = function (viewingServiceBaseUrl, api, url, onSuccess, onFailure, options) {
        xhrThrottle.go(pendCB => {
            let onFailureWrapped = (...args) => {
                pendCB();
                onFailure && onFailure.apply(onFailure, args);
            };

            let onSuccessWrapped = (...args) => {
                pendCB();
                onSuccess && onSuccess.apply(onSuccess, args);
            };

            var protocolMatch = /^(\w+:)\/\//gi.exec(url);
            // if there is a special handler for this request, delegate this request to the handler
            if(protocolMatch && protocolMatch.length == 2 && protocolPortMap[protocolMatch[1]]) {
                ViewingService.handlerProtocol(protocolMatch[1], url, onSuccessWrapped, onFailureWrapped, options);
            } else {
                ViewingService._rawGet(viewingServiceBaseUrl, api, url, onSuccessWrapped, (...args) => {
                    const errorCode = args[0];
                    const method = (options?.method || (options?.noBody ? 'HEAD' : 'GET')).toLowerCase();
                    
                    const shouldRetry = method === 'get' && (errorCode === 429 || errorCode >= 500);  
                    
                    if (shouldRetry) {
                        const request = args[3];
                        let delayMs = 100;
                        // 429 - too many requests, 503 - Service Unavailable until
                        const retryAfter = (errorCode === 429 || errorCode === 503) && request?.getResponseHeader('Retry-After');
                        if (retryAfter) {
                            // retryAfter could be either delay-seconds or http-date 
                            const seconds = Number(retryAfter);
                            delayMs = ((!isNaN(seconds) && seconds * 1000) || (Date.parse(retryAfter) - new Date().getTime()));
                            delayMs = delayMs > 100 ? delayMs : 100;
                        }

                        ViewingService._retryRequest(viewingServiceBaseUrl, api, url, options, delayMs)
                        .then((args) => onSuccessWrapped(...args))
                        .catch((args) => onFailureWrapped(...args));
                    } else {
                        onFailureWrapped(...args);
                    }
                    
                }, options);
            }
        });
    };


    ViewingService._retryRequest = function(viewingServiceBaseUrl, api, url, options, delayMs) {
        const backOffOptions = {
            delayFirstAttempt: true,
            startingDelay: delayMs,
            numOfAttempts: 4,
            retry: ([errorCode, errorMsg, { url }], attemptNumber) => {
              logger.warn(`request ${url} failed with status ${errorCode} ${errorMsg}. Attempt ${attemptNumber}`);
              return true;
            },
            timeMultiple: 5
          };

          return backOff(() => new Promise((resolve, reject) => {
              ViewingService._rawGet(viewingServiceBaseUrl, api, url, (...args) => resolve(args), (...args) => reject(args), options);
          }), backOffOptions);
    };

    ViewingService.isOSSUrl = function (url) {
        if (!url) {
            return false;
        }

        return url.indexOf('/oss/v2/buckets') !== -1;
    };

    /**
     *  Given an OSS URL, returns a signed-url.
     *
     *  @param {string} url - The url for the request.
     *
     * @returns {Promise} that resolves with a simple success or fail of the request
     */
    ViewingService.getSignedS3DownloadUrl = function (url) {
        return new Promise(resolve => {
            const acmsessionIndex = url.indexOf("?acmsession=");

            // When using signedURL, no need to append acmsession.
            if (acmsessionIndex !== -1) {
                url = url.substring(0, acmsessionIndex);
            }

            // https://wiki.autodesk.com/display/FDPA/API+Endpoints#APIEndpoints-GetDownloadURL
            url += "/signeds3download?useCdn=true";

            const request = new XMLHttpRequest();

            request.open('GET', url);

            // Bearer token is needed.
            request.setRequestHeader("Authorization", endpoint.HTTP_REQUEST_HEADERS["Authorization"]);
            request.responseType = 'json';

            request.send();

            const success = (e) => {
                const response = e.currentTarget.response;
                resolve(response.url);
            };

            const fail = () => {
                resolve(null);
            };

            request.onload = success;
            request.onerror = fail;
            request.ontimeout = fail;
            request.onabort = fail;
        });
    };

    /**
     *  Performs a GET/HEAD request to Viewing Service.
     *
     * @param {string} viewingServiceBaseUrl - The base url for the viewing service.
     * @param {string} api - The api to call in the viewing service.
     *  @param {string} url - The url for the request.
     *  @param {function} onSuccess - A function that takes a single parameter that represents the response
     *                                returned if the request is successful.
     *  @param {function} onFailure - A function that takes an integer status code, and a string status, which together represent
     *                                the response returned if the request is unsuccessful, and a third data argument, which
     *                                has more information about the failure.  The data is a dictionary that minimally includes
     *                                the url, and an exception if one was raised.
     *  @param {Object=} [options] - A dictionary of options that can include:
     *                               headers - A dictionary representing the additional headers to add.
     *                               queryParams - A string representing the query parameters
     *                               responseType - A string representing the response type for this request.
     *                               {boolean} [encodeUrn] - when true, encodes the document urn if found.
     *                               {boolean} [noBody] - when true, will perform a HEAD request
     * @returns {Promise} that resolves with a simple success or fail of the request
     */
    ViewingService._rawGet = async function (viewingServiceBaseUrl, api, url, onSuccess, onFailure, options) {

        options = options || {};

        url = ViewingService.generateUrl(viewingServiceBaseUrl, api, url, options.apiData, options.escapeOssObjects, options.guid);

        let isSignedUrl = false;

        if (ViewingService.isOSSUrl(url)) {
            const signedUrl = await ViewingService.getSignedS3DownloadUrl(url);

            if (signedUrl) {
                url = signedUrl;
                isSignedUrl = true;    
            } else {
                // In case that we couldn't get the signed URL for some reason, try to use the original URL.
                // If it's under 10MB it should work - so we got lucky.
                console.warn('Failed getting signed URL - Fallback to direct OSS resource.');
            }
                
        }

        // If we are dealing with signed URL, adding additional query params will prevent it from working.
        if (options.queryParams && !isSignedUrl) {
            var concatSymbol = url.indexOf('?') === -1 ? '?' : '&';
            url = url + concatSymbol + options.queryParams;
        }

        var request = new XMLHttpRequest();

        function onError(e) {
            if (onFailure)
                onFailure(request.status, request.statusText, {url: url}, request);
        }

        function onAbort(e) {
            if (onFailure)
                onFailure(request.status, 'request was aborted', { url: url, aborted: true }, request);
        }

        function fixJsonResponse(response) {
            if (options.responseType === "json") {
                try {
                    if (response instanceof Uint8Array) {
                        //This should only happen in the node.js case so we can do toString
                        //instead of using the LMV utf8 converter.
                        return blobToJson(response);
                    } else if (typeof response === "string") {
                        return JSON.parse(response);
                    }
                } catch (e){}
            }
            return response;
        }

        function onLoad(e) {
            if (request.status >= 200 && request.status < 400) {

                if (request.response
                    && request.response instanceof ArrayBuffer) {

                    var rawbuf;
                    if (request.status === 200 && options.range) {
                        //If we requested a range, but the entire content was returned,
                        //make sure to give back just the requested subset to the caller
                        rawbuf = new Uint8Array(request.response, options.range.min, options.range.max - options.range.min);
                    } else {
                        rawbuf = new Uint8Array(request.response);
                    }

                    // It's possible that if the Content-Encoding header is set,
                    // the browser unzips the file by itself, so let's check if it did.
                    // Return raw buffer if skip decompress is true
                    if (!options.skipDecompress && rawbuf[0] === 31 && rawbuf[1] === 139) {
                        if (!warnedGzip) {
                            warnedGzip = true;
                            logger.warn("An LMV resource (" + url + ") was not uncompressed by the browser. This hurts performance. Check the Content-Encoding header returned by the server and check whether you're getting double-compressed streams. The warning prints only once but it's likely the problem affects multiple resources.");
                        }
                        try {
                            rawbuf = pako.ungzip(rawbuf);
                        } catch (err) {
                            onFailure(ErrorCodes.BAD_DATA,
                                      "Malformed data received when requesting file",
                                      { "url": url, "exception": err.toString(), "stack": err.stack },
                                      request);
                        }
                    }

                    onSuccess && onSuccess(fixJsonResponse(rawbuf));
                }
                else {
                    var res = request.response;
                    if (!res && (!options.responseType || options.responseType === "text"))
                        res = request.responseText;
                    
                    onSuccess && onSuccess(fixJsonResponse(res));
                }
            }
            else {
                onError(e);
            }
        }

        try {

            var isAsync = options.hasOwnProperty('asynchronous') ? options.asynchronous : true;
            request.open(options.method || (options.noBody ? 'HEAD' : 'GET'), url, isAsync);

            if (options.hasOwnProperty('responseType')) {
                request.responseType = options.responseType;
            }

            if (options.range) {
                request.setRequestHeader("Range", "bytes=" + options.range.min + "-" + options.range.max);
            }

            // In case that URL already signed, no need to add credentials to it.
            if (!isSignedUrl) {
                request.withCredentials = true;

                if (options.hasOwnProperty("withCredentials"))
                    request.withCredentials = options.withCredentials;

                if (options.headers ) {
                    for (var header in options.headers) {
                        request.setRequestHeader(header, options.headers[header]);

                        // Disable withCredentials if header is Authorization type
                        // NOTE: using withCredentials attaches cookie data to request
                        if (header.toLocaleLowerCase() === "authorization") {
                            request.withCredentials = false;
                        }
                    }
                }
            }

            if (isAsync) {
                request.onload = onLoad;
                request.onerror = onError;
                request.ontimeout = onError;
                request.onabort = onAbort;

                if (options.ondata || options.onprogress) {

                    //Set up incremental progress notification
                    //if needed. We have to do some magic in order
                    //to get the received data progressively.
                    //https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/Using_XMLHttpRequest
                    request.overrideMimeType('text/plain; charset=x-user-defined');
                    options._dlProgress = {
                        streamOffset: 0
                    };

                    request.onreadystatechange = function() {

                        if (request.readyState > 2 && request.status === 200) {

                            if (options.ondata) {

                                var textBuffer = request.responseText;

                                // No new data coming in.
                                if (options._dlProgress.streamOffset >= textBuffer.length)
                                    return;

                                var arrayBuffer = textToArrayBuffer(textBuffer, options._dlProgress.streamOffset);

                                options._dlProgress.streamOffset = textBuffer.length;

                                options.ondata(arrayBuffer);

                            } else if (options.onprogress) {

                                let abort = options.onprogress(request.responseText);
                                if (abort)
                                    request.abort();
                            }
                        }
                    };
                }
            }

            request.send(options.postData);

            if (!isAsync) {
                onLoad();
            }
        }
        catch (e) {
            onFailure(request.status, request.statusText, {url: url, exception: e}, request);
        }
    };

} //rawGet conditionsl implementation

    // Create the default failure callback.
    //
    ViewingService.defaultFailureCallback = function (httpStatus, httpStatusText, data) {
        if (httpStatus == 403) {
            this.raiseError(
                ErrorCodes.NETWORK_ACCESS_DENIED,
                "Access denied to remote resource",
                { "url": data.url, "httpStatus": httpStatus, "httpStatusText": httpStatusText });
        }
        else if (httpStatus == 404) {
            this.raiseError(
                ErrorCodes.NETWORK_FILE_NOT_FOUND,
                "Remote resource not found",
                { "url": data.url, "httpStatus": httpStatus, "httpStatusText": httpStatusText });
        }
        else if (httpStatus === 0 && data.aborted) {
            this.raiseError(
                ErrorCodes.LOAD_CANCELED,
                "Request aborted",
                { "url": data.url, "httpStatus": httpStatus, "httpStatusText": httpStatusText });
        }
        else if (httpStatus >= 500 && httpStatus < 600) {
            this.raiseError(
                ErrorCodes.NETWORK_SERVER_ERROR,
                "Server error when accessing resource",
                { "url": data.url, "httpStatus": httpStatus, "httpStatusText": httpStatusText });
        }
        else if (data.exception) {
            this.raiseError(
                ErrorCodes.NETWORK_FAILURE,
                "Network failure",
                { "url": data.url, "exception": data.exception.toString(), "stack": data.exception.stack});
        }
        else {
            this.raiseError(
                ErrorCodes.NETWORK_UNHANDLED_RESPONSE_CODE,
                "Unhandled response code from server",
                { "url": data.url, "httpStatus": httpStatus, "httpStatusText": httpStatusText, data:data });
        }
    };



    function copyOptions(loadContext, options) {

        //Those are the usual defaults when called from the LMV worker

        if (!options.hasOwnProperty("responseType"))
            options.responseType = "arraybuffer";

        //Add options junk we got from the main thread context

        if (!options.hasOwnProperty("withCredentials"))
            options.withCredentials = !!loadContext.auth;

        options.headers = loadContext.headers;
        options.queryParams = loadContext.queryParams;
        options.endpoint = loadContext.endpoint;
        options.escapeOssObjects = loadContext.escapeOssObjects;
    }

    //Utility function called from the web worker to set up the options for a get request,
    //then calling ViewingService.get internally
    ViewingService.getItem = function (loadContext, url, onSuccess, onFailure, options) {

        options = options || {};

        copyOptions(loadContext, options);

        //If the endpoint does not support range requests (Apigee), then convert
        //the range to start/end URL parameters.
        if (options.range && !loadContext.supportsRangeRequests) {

            let rangeParam = "start=" + options.range.min + "&end=" + options.range.max;
            if (options.queryParams) {
                options.queryParams += "&" + rangeParam;
            } else {
                options.queryParams = rangeParam;
            }

            options.range = undefined;
        }

        ViewingService.rawGet(loadContext.endpoint, 'items', url, onSuccess, onFailure, options);

    };

    //Utility function called from the web worker to set up the options for a get request,
    //then calling ViewingService.get internally
    ViewingService.getManifest = function (loadContext, url, onSuccess, onFailure, options) {

        options = options || {};

        if (!options.hasOwnProperty("responseType"))
            options.responseType = "json";

        copyOptions(loadContext, options);

        ViewingService.rawGet(loadContext.endpoint, 'bubbles', url, onSuccess, onFailure, options);

    };

    ViewingService.getProperties = function (loadContext, url, guid, query, onSuccess, onFailure) {
        const options = {};
        copyOptions(loadContext, options);
        options.responseType = 'json';
        options.guid = guid;
        options.method = 'POST';
        options.postData = JSON.stringify(query);
        options.headers['Content-Type'] = 'application/json';
        options.headers['accept'] = 'application/json';
        options.headers['Access-Control-Allow-Origin'] = '*';
        ViewingService.rawGet(loadContext.endpoint, 'properties', url, onSuccess, onFailure, options);
    };

    //Utility function called from the web worker to set up the options for a get request,
    //then calling ViewingService.get internally
    ViewingService.getThumbnail = function (loadContext, url, onSuccess, onFailure, options) {

        options = options || {};

        copyOptions(loadContext, options);

        var queryParams = options.queryParams || '';
        var missingElements = [];
        if (queryParams.indexOf('guid=') === -1 && options.guid) {
            missingElements.push("guid=" + encodeURIComponent(options.guid));
        }
        if (queryParams.indexOf('role=') === -1) {
            var role = options.role || "rendered";
            missingElements.push("role=" + role);
        }
        if (queryParams.indexOf('width=') === -1) {
            var sz = options.size || 400;
            missingElements.push("width=" + sz);
        }
        if (queryParams.indexOf('height=') === -1) {
            var sz = options.size || 400;
            missingElements.push("height=" + sz);
        }
        if (queryParams.indexOf('acmsession=') === -1 && options.acmsession) {
            missingElements.push("acmsession=" + options.acmsession);
        }
        var thumbQueryParams = missingElements.join('&');

        if (options.queryParams) {
            options.queryParams = options.queryParams + '&' + thumbQueryParams;
        } else {
            options.queryParams = thumbQueryParams;
        }

        ViewingService.rawGet(loadContext.endpoint, 'thumbnails', url, onSuccess, onFailure, options);
    };


    ViewingService.getACMSession = function (endpoint, acmProperties, onSuccess, onFailure) {
        const backOffOptions = {
            numOfAttempts: 4,
            timeMultiple: 5,
            retry: (_ , attemptNumber) => {
              logger.warn(`acmsession request failed. Attempt #${attemptNumber}`);
              return true;
            },
        };
    
        backOff(() => new Promise((resolve, reject) => {
            ViewingService._getACMSession(endpoint, acmProperties, resolve, reject);
        }), backOffOptions)
            .then((...args) => onSuccess(...args))
            .catch((...args) => onFailure(...args));
    };


    ViewingService._getACMSession = function (endpoint, acmProperties, onSuccess, onFailure) {

        var acmHeaders = {};
        var token;

        for (var key in acmProperties) {

            if (key === "oauth2AccessToken")
                token = acmProperties[key];

            else if (key.indexOf("x-ads-acm") !== -1)
                acmHeaders[key] = acmProperties[key];
        }

        // The value of this can be anything. Required for some arcane reasons.
        acmHeaders.application = "autodesk";

        var xhr = new XMLHttpRequest();
        xhr.open("POST", endpoint + '/oss-ext/v2/acmsessions', true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("Authorization", "Bearer " + token);
        xhr.responseType = "json";

        xhr.onload = function () {
            if (xhr.status === 200 && xhr.response) {
                // If the response is a string (e.g. from IE), need to parse it to an object first
                var response = typeof(xhr.response) === 'string' ? JSON.parse(xhr.response) : xhr.response;

                if (response && response.acmsession) {
                    onSuccess(response.acmsession);
                }
                else {
                    onFailure(xhr.status, "Can't get acm session from response.");
                }

            } else {
                onFailure(xhr.status);
            }
        };

        xhr.onerror = onFailure;
        xhr.ontimeout = onFailure;
        xhr.send(JSON.stringify(acmHeaders));

        // "application" header is only required for OSS end point, and should not be passed
        // with normal requests because this header is not in allowed header sets of APIGEE.
        delete acmHeaders.application;

    };

    