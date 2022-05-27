"use strict";

import { ViewingService } from "../net/Xhr";
import { F2DProbe } from "../lmvtk/f2d/F2dProbe";
import { logger } from "../../logger/Logger";
import { utf8ArrayToString } from "../lmvtk/common/StringUtils";
import { errorCodeString, ErrorCodes } from "../net/ErrorCodes";

const pako = require('pako');

var ENABLE_F2D_STREAMING_MODE = true;

function requestFileF2D(loadContext, filename, onSuccess) {
    var url = loadContext.basePath + filename;
    ViewingService.getItem(loadContext, url, onSuccess, null);
}

// Stream loading f2d data and prepare parseable data frames.
function doStreamF2D(loadContext) {

    var _this = loadContext.worker;

    _this.postMessage({progress:0.01}); //Tell the main thread we are alive

    //Get the metadata and manifest first.
    var metadata;
    var manifest;
    var doneFiles = 0;

    var accumulatedStream = new Uint8Array(65536);
    var accumulatedBytes = 0;
    var responseData = null;

    function accumulateData(partial) {
        //Add the new bytes to the accumulation buffer
        if (accumulatedStream.length < partial.length + accumulatedBytes) {
            var newlen = Math.max(accumulatedStream.length * 2, partial.length + accumulatedBytes);
            var ns = new Uint8Array(newlen);
            ns.set(accumulatedStream);
            accumulatedStream = ns;
        }
        accumulatedStream.set(partial, accumulatedBytes);
        accumulatedBytes += partial.length;
    }

    function markSucceeded(response) {
        responseData = response;
    }

    var dataReceived = accumulateData;
    var requestSucceeded = markSucceeded;

    // Start the request for the primary graphics
    // Just accumulate data as it comes in, and remember response
    // when it succeeds. The dataReceived and requestSucceeded
    // variables are changed to other functions once the manifest
    // and metadata are read.
    ViewingService.getItem(loadContext, loadContext.url, function(responseData) {
            requestSucceeded(responseData);
        }, loadContext.onFailureCallback, {
            ondata: function(partial) {
                dataReceived(partial);
            },
            responseType: ""
        }
    );

    requestFileF2D(loadContext, "metadata.json.gz", function(data) {
        try {
            metadata = JSON.parse(utf8ArrayToString(data));
            doneFiles++;
        } catch (e) {
            self.raiseError(
                ErrorCodes.BAD_DATA,
                "" /* does not matter what strings we put here since the final user facing error message is solely decided
                by ErrorCodes. Invent another code if we want a specific error message for this error. */
            );
        }

        if (doneFiles === 2)
            doStreamF2D_Continued(loadContext, manifest, metadata);
    });
    requestFileF2D(loadContext, "manifest.json.gz", function(data) {
        try {
            if (data)
                manifest = JSON.parse(utf8ArrayToString(data));
            //The F2D does not necessarily need a manifest file to load (some old F2Ds don't have that)
            doneFiles++;
        } catch (e) {}

        if (doneFiles === 2)
            doStreamF2D_Continued(loadContext, manifest, metadata);
    });

    //Loads the F2D stream once the metadata and manifest files are fetched
    function doStreamF2D_Continued(loadContext, manifest, metadata) {

        var _this = loadContext.worker;

        var url = loadContext.url;

        // Collect asset urls that to be send to main thread for mobile usage.
        var assets = [];

        var f2dSize = 0;
        var altSize = 0;
        if (manifest && manifest.assets) {
            var a = manifest.assets;
            for (var i=0; i<a.length; i++) {
                if (url.indexOf(a[i].URI) != -1) {
                    f2dSize = a[i].usize || 0;
                    break;
                } else if (a[i].type == "Autodesk.CloudPlatform.F2D")
                    altSize = a[i].usize || 0;
            }
        }
        if (f2dSize == 0 && altSize > 0)
            f2dSize = altSize;

        var probe = new F2DProbe();

        var first = true;
        var streamOffset = 0;
        var sentMetadata = false;

        function onSuccess(responseData) {
            // Send collected f2d resource urls to main thread.
            _this.postMessage({"type" : "F2DAssetURL", "urls" : assets});
            assets = null;

            if (ENABLE_F2D_STREAMING_MODE) {

                var  msg = {
                    "type" : "F2DSTREAM",
                    "finalFrame" : true,
                    "finished" : true,
                    "progress" : 1
                };

                if (!sentMetadata) {
                    msg.manifest = manifest;
                    msg.metadata = metadata;
                    msg.basePath = loadContext.basePath;
                    msg.f2dSize = f2dSize;
                    sentMetadata = true;
                }

                _this.debug("Total text bytes count : " + responseData.length);

                _this.postMessage(msg);

                //Streaming code path ends here -- we have already sent
                //the data back from the progress callback
                return;
            }

            //Non-streaming code path here
            if (accumulatedStream.length > accumulatedBytes)
                accumulatedStream = new Uint8Array(accumulatedStream.buffer.slice(0, accumulatedBytes));

            var view;
            if (accumulatedStream[0] == 31 && accumulatedStream[1] == 139) {
                try {
                    view = new Uint8Array(accumulatedStream.buffer, 0, accumulatedBytes);
                    view = pako.ungzip(view);
                } catch (e) {
                    console.error(e);
                }
            }

            var msg = { "type" : "F2DBLOB",
                "metadata" : metadata,
                "manifest" : manifest,
                "f2dSize" : f2dSize,
                "basePath" : loadContext.basePath, // TODO: we might be able to infer this elsewhere.
                "progress" : 1,
                "buffer" : view.buffer};
            var transferList = [];
            transferList.push(view.buffer);
            _this.postMessage(msg, transferList);
        }

        function processData() {

            if (!ENABLE_F2D_STREAMING_MODE)
                return;

            if (first) {
                first = false;

                // If the very first two bytes of the entire stream is GZIP magic number,
                // then we fall back on none streaming mode, because streaming mode only
                // work with browser decompression, and the presence of such magic number
                // implies browser decompression fails, for whatever reasons.
                if (accumulatedStream[0] == 31 && accumulatedStream[1] == 139) {
                    logger.error("F2D streaming broken by non-streaming unzip!", errorCodeString(ErrorCodes.BAD_DATA));
                    ENABLE_F2D_STREAMING_MODE = false;
                    return;
                }
            }

            var view = new Uint8Array(accumulatedStream.buffer, streamOffset, accumulatedBytes - streamOffset);

            try {
                var marker = probe.load(view);

                if (marker.frameEnd > marker.frameStart) {
                    var frames = accumulatedStream.buffer.slice(streamOffset + marker.frameStart, streamOffset + marker.frameEnd);
                    streamOffset += marker.frameEnd;

                    var transferList = [];
                    transferList.push(frames);

                    var msg = { "type" : "F2DSTREAM",
                        "frames" : frames,
                        "finalFrame" : false
                    };

                    if (f2dSize)
                        msg.progress = streamOffset / f2dSize;

                    if (!sentMetadata) {
                        msg.manifest = manifest;
                        msg.metadata = metadata;
                        msg.f2dSize = f2dSize;
                        msg.basePath = loadContext.basePath;
                        sentMetadata = true;
                    }

                    _this.postMessage(msg, transferList);

                }
            } catch (e) {
                _this.debug(e);
            }
        }

        function onData(partial) {
            accumulateData(partial);
            processData();
        }
        
        requestSucceeded = onSuccess;
        dataReceived = onData;
        // check to see if the primary graphics request has received any data
        if (accumulatedBytes > 0)
            processData();
        // check to see if primary graphics request succeeded
        if (responseData != null)
            onSuccess(responseData);
    }
}

export function register(workerMain) {
    workerMain.register("STREAM_F2D", { doOperation: doStreamF2D });
}

