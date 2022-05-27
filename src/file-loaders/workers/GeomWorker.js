import { PackFileReader } from '../lmvtk/svf/PackReader';
import { readGeometry } from '../lmvtk/svf/Geoms';
import { ErrorCodes } from '../net/ErrorCodes';
import { ViewingService } from '../net/Xhr';
import { createWireframe } from "../../wgs/scene/DeriveTopology";

function guardFunction(loadContext, f) {
    try {
        f();
    }
    catch (exc) {
        loadContext.raiseError(
            ErrorCodes.BAD_DATA, "Unhandled exception while reading pack file",
            { "url": loadContext.url, "exception": exc.toString(), "stack": exc.stack });
    }
}

function doGeomLoad(loadContext) {

    var _this = loadContext.worker;

    //Make a blocking request -- it's ok, because
    //we are in a worker thread.

    function onSuccess(arrayBuffer) {
        _this.postMessage({
            url: loadContext.url,
            workerId: loadContext.workerId,
            progress: 0.5
        }); //rough progress reporting -- can do better

        guardFunction(loadContext, function() {

            var pfr = new PackFileReader(arrayBuffer);

            var raisedError = false;

            var options = {
                estimateSizeOnly: true,
                packNormals: (typeof loadContext.packNormals !== "undefined") ? loadContext.packNormals : true
            };

            var i, iEnd = pfr.getEntryCounts(), mesh;
            var skip = loadContext.inMemory || [];
            var estLength = 0;
            var shouldReadNext = function(i) {
                var v = skip[i >> 5];
                return !v || !(v & (1 << (i & 31)));
            };

            for (i = 0; i<iEnd; i++)
            {
                if (shouldReadNext(i)) {
                    mesh = readGeometry(pfr, i, options);
                    estLength += ((mesh && mesh.sharedBufferBytes) || 0);
                }
            }

            var sharedBuffer = estLength? new ArrayBuffer(estLength) : null;
            var currentOffset = 0;

            var msg = { "packId": loadContext.packId,
                "workerId" : loadContext.workerId,
                "progress": 1,
                "meshes" : [],
                "sharedBuffer": sharedBuffer
            };

            var transferList = sharedBuffer ? [sharedBuffer] : [];

            options = {
                dstBuffer: sharedBuffer,
                startOffset: 0,
                estimateSizeOnly: false,
                packNormals: (typeof loadContext.packNormals !== "undefined") ? loadContext.packNormals : true
            };

            for (i = 0; i<iEnd; i++)
            {
                options.startOffset = currentOffset;

                if (shouldReadNext(i)) {
                    mesh = readGeometry(pfr, i, options);

                    if (mesh) {
                        currentOffset += (mesh.sharedBufferBytes || 0);
                        msg.meshes[i] = mesh;

                        if (loadContext.createWireframe) {
                            createWireframe(mesh);

                            //TODO: optimize the storage of the lines index buffer to use
                            //a single shared buffer for all meshes in the pack
                            if (mesh.iblines)
                                transferList.push(mesh.iblines.buffer);
                        }
                    } else {
                        // it doesn't make much sense to raise an error for each entry that can't
                        // be read, because chances are they will all be unreadable after the
                        // first bad one.
                        if (!raisedError) {
                            _this.raiseError(
                                ErrorCodes.BAD_DATA, "Unable to load geometry",
                                { "url": loadContext.url });
                             raisedError = true;
                        }

                        // in this case, we still post the full message instead of just null;
                        // the mesh itself will be null, of course.
                        _this.postMessage(msg);
                    }
                }
            }

            _this.postMessage(msg, transferList);
        });

    }

    // With this option to control whether want to record assets request.
    var options = {
        skipAssetCallback: loadContext.skipAssetCallback
    };
    ViewingService.getItem(loadContext, loadContext.url, onSuccess, loadContext.onFailureCallback, options);

}

export function register(workerMain) {
    workerMain.register("LOAD_GEOMETRY", { doOperation: doGeomLoad });
}
