const { getResourceUrl } = require('../../globals');
const { getGlobal } = require('../../compat');

/**
 * Initializes the wasm worker.
 * This function returns a promise that resolves with a wasm proxy.
 * The wasm proxy contains functions that were exported by the wasm instance.
 * Each one of these functions will return promises that resolve with the function's return value.
 *
 * To get the WebAssembly memory call `proxy.getBuffer()` which returns a promise that resolves with a ArrayBuffer value.
 * @param {String} wasmPath - relative path to the wasm file.
 * @returns {Promise} - resolves with the wasm proxy.
 */
export function loadWasmWorker(wasmPath) {
    const CHANNEL_CACHE = {};
    const workerFileUrl = getResourceUrl('wasm.worker.js');
    // Enable this for testing.
    // Autodesk.Viewing.Private.ENABLE_INLINE_WORKER = false;

    return new Promise((resolve, reject) => {
        // Create a new wasm worker
        initUrlBlob(workerFileUrl).then(function(workerUrl) {
            const worker = new Worker(workerUrl);
            // Create an object to later interact with
            const proxy = {};
            // Get the wasm resource url
            const wasmFileUrl = getResourceUrl(wasmPath);
            // Initialize the Wasm file in the worker.
            worker.postMessage({ eventType: 'INITIALIZE', eventData: wasmFileUrl });
            worker.addEventListener('message', function(event) {
                const eventType = event.data.eventType;
                // Generate the proxy.
                if (eventType === 'INITIALIZED') {
                    const methods = event.data.eventData;
                    // Generate the proxy methods
                    methods.forEach((method) => {
                        proxy[method] = function() {
                            return setupProxyMethod(method, worker, (port) => {
                                port.postMessage({
                                    eventData: {
                                        method: method,
                                        arguments: Array.from(arguments) // arguments is not an array
                                    }
                                });
                            });
                        };
                    });
                    // create a getBuffer proxy function that will return a promise that resolves with the webassembly memory buffer.
                    const method = 'getBuffer';
                    proxy[method] = function() {
                        return setupProxyMethod(method, worker, (port) => {
                            port.postMessage({
                                eventType: 'GET_BUFFER'
                            });
                        });
                    };
                    // Resolves with the proxy.
                    resolve(proxy);
                    return;
                }
            });

            worker.addEventListener('error', function(error) {
                reject(error);
            });
        });
    });

    /**
     * Returns promise that resolves with the correct url to the passed in file.
     * @param {String} fileUrl - url path to the file.
     * @returns {Promise} - Promise that resolves with the correct blob url or the original file url if inline workers are disabled.
     */
    function initUrlBlob(fileUrl) {
        const avp = Autodesk.Viewing.Private;
        return new Promise(function(resolve) {
            if (avp.ENABLE_INLINE_WORKER) {
                let xhr = new XMLHttpRequest();

                xhr.open('GET', fileUrl, true);
                xhr.withCredentials = false;

                xhr.onload = function() {
                    let _window = getGlobal();
                    let blob;
                    _window.URL = _window.URL || _window.webkitURL;

                    try {
                        blob = new Blob([xhr.responseText], { type: 'application/javascript' });
                    } catch (e) {
                        // Backward compatibility.
                        let builder = new BlobBuilder();
                        builder.append(xhr.responseText);
                        blob = builder.getBlob();
                    }
                    resolve(URL.createObjectURL(blob));
                };
                xhr.send();
            } else {
                resolve(fileUrl);
            }
        });
    }

    /**
     * Returns a promise for a proxy method.
     * @param {String} method - Proxy method name
     * @param {Worker} worker - Wasm Worker instance
     * @param {function} portCb - recieves the MessageChannel port as a parameter
     * @return {Promise} - returns a new promise that resolves with the proxy methods return value
     */
    function setupProxyMethod(method, worker, portCb) {
        return new Promise((resolve, reject) => {
            const channelInfo = getChannelInfo(method, worker, CHANNEL_CACHE);
            const channel = channelInfo.channel;
            channelInfo.inUse = true;
            portCb(channel.port1);

            channel.port1.onmessage = function(event) {
                channelInfo.inUse = false;

                const eventType = event.data.eventType;
                const eventData = event.data.eventData;
                if (eventType === 'ERROR') {
                    reject(eventData);
                } else {
                    resolve(eventData);
                }

                cleanupChannelInfo(channelInfo, CHANNEL_CACHE[method]);
            };
        });
    }

    /**
     * Returns a cached or a new channelInfo object.
     * @param {String} method - Proxy method name
     * @param {Worker} worker - Wasm Worker instance
     * @returns {Object} - returns the channelInfo object. {channel: {MessageChannel}, inUse: {Boolean}}
     */
    function getChannelInfo(method, worker) {
        let channelInfo;
        let createNewChannel;
        if (CHANNEL_CACHE && CHANNEL_CACHE.hasOwnProperty(method)) {
            // Check if the first channel is use
            channelInfo = CHANNEL_CACHE[method][0];
            createNewChannel = channelInfo.inUse;
        } else {
            CHANNEL_CACHE[method] = [];
            createNewChannel = true;
        }

        if (createNewChannel) {
            channelInfo = { channel: new MessageChannel(), inUse: false };
            CHANNEL_CACHE[method].push(channelInfo);
            worker.postMessage(
                { eventType: 'SET_CHANNEL_PORT', eventData: { method, port: channelInfo.channel.port2 } },
                [channelInfo.channel.port2]
            );
        }
        // Initialize the port with the worker
        return channelInfo;
    }

    /**
     * Removes the supplied channelInfo from the channel cache.
     * This method will keep the first channel in the cache which will be reused by other calls.
     * @param {Object} channelInfo - channelInfo object containing information about the channel
     * @param {ChannelInfo[]} cachedMethodChannels - An array of ChannelInfo objects for the specific method.     
     * @returns {Boolean} - true if the channel was removed from the cache.
     */
    function cleanupChannelInfo(channelInfo, cachedMethodChannels) {
        // We want to keep the first channel open so that it can be reused by other calls.
        for (let i = 1; i < cachedMethodChannels.length; i++) {
            const storedInfo = cachedMethodChannels[i];
            const currChannel = storedInfo.channel;
            const channelToClose = channelInfo.channel;
            if (currChannel === channelToClose) {
                cachedMethodChannels.splice(i, 1);
                return true;
            }
        }
        return false;
    }
}
