
import { F2D } from "../lmvtk/f2d/F2d";
import { F2DGeometry } from "../lmvtk/f2d/F2dGeometry";
import { ErrorCodes } from "../net/ErrorCodes";

function tryCatch(_this, f) {
    try {
        f();
    }
    catch (exc) {
        _this.raiseError(
            ErrorCodes.BAD_DATA, "",
            { "exception": exc.toString(), "stack": exc.stack });
        _this.postMessage(null);
    }
}

function getF2DParser(loadContext) {
    if (loadContext.f2dLoadOptions.outputType === "geometry") {
        return new F2DGeometry(loadContext.metadata, loadContext.f2dLoadOptions);
    }
    return new F2D(loadContext.metadata, loadContext.manifest, loadContext.basePath, loadContext.f2dLoadOptions);
}

function doParseF2D(loadContext) {
    var _this = loadContext.worker;
    
    _this.postMessage({progress:0.01}); //Tell the main thread we are alive

    if (loadContext.data) {

        _this.postMessage({progress:0.5}); //rough progress reporting -- can do better
        var f2d = getF2DParser(loadContext)
        loadContext.loadDoneCB = function(success) {

            if (success) {
                var msg = { "f2d" : f2d };
                _this.postMessage(msg );
            }
            else {
                _this.raiseError(ErrorCodes.BAD_DATA, "", {});
                _this.postMessage(null);
            }
        };

        tryCatch(_this, function() {
            f2d.load(loadContext, loadContext.data);
        });
    }
    else {
        _this.postMessage(null);
    }
}

function doParseF2DFrame(loadContext) {
    var _this = loadContext.worker;

    var f2d = _this.f2d;

    if (!f2d) {
        _this.postMessage({progress:0.5}); //rough progress reporting -- can do better
        var f2d = _this.f2d = getF2DParser(loadContext)
        f2d.F2D_MESH_COUNT_OLD = 0;

        // First post needs to post entire F2D so we can set up bounding boxes, etc.
        var msg = { "f2dframe" : f2d };
        _this.postMessage(msg);
    }

    function loadDoneCallback(success, finalFlush) {
        if (success) {

            if (!f2d.meshes.length && !finalFlush) {
                // No new data coming in.
                // debug("F2D streaming : no new data coming in.");
                return;
            } else {

                var msg = { "f2dframe" : true,
                    "meshes" : f2d.meshes,
                    "baseIndex" : f2d.F2D_MESH_COUNT_OLD,
                    "bbox" : f2d.bbox
                 };

                if (loadContext.finalFrame) {

                    //Add f2d properties which are cumulative and their
                    //final values are not known until the end
                    msg.cumulativeProps = {
                        maxObjectNumber : f2d.maxObjectNumber,
                        viewports : f2d.viewports,
                        clips : f2d.clips,
                        strings: f2d.strings,
                        stringDbIds: f2d.stringDbIds,
                        stringBoxes: f2d.stringBoxes,
                        linkBoxes: f2d.linkBoxes,
                        hasPageShadow: f2d.hasPageShadow,
                        minLineWidth: f2d.currentVbb.minLineWidth
                    };

                    if (loadContext.f2dLoadOptions?.extendStringsFetching) {
                        msg.cumulativeProps.stringCharWidths = f2d.stringCharWidths; // contains width of every character in a string
                        msg.cumulativeProps.stringAngles = f2d.stringAngles; // rotation of a string box
                        msg.cumulativeProps.stringPositions = f2d.stringPositions; // starting point of string box. this values are not equal to min.x and min.y of stringBoxes
                        msg.cumulativeProps.stringHeights = f2d.stringHeights; // height of a string box
                    }

                    msg.finalFrame = finalFlush;
                }

                // User transferable objects to pass the array buffers used by mesh without deep copying.
                var transferList = [];
                for (var i = 0, e = f2d.meshes.length; i < e; ++i) {
                    transferList.push(f2d.meshes[i].vb.buffer);
                    transferList.push(f2d.meshes[i].indices.buffer);
                }
                _this.postMessage(msg, transferList);

                f2d.F2D_MESH_COUNT_OLD += f2d.meshes.length;
                f2d.meshes = [];
            }
        }
        else {
            _this.raiseError(
                ErrorCodes.BAD_DATA, "",
                {});
            _this.postMessage(null);
        }
    }

    loadContext.loadDoneCB = loadDoneCallback;

    tryCatch(_this, function() {
        f2d.loadFrames(loadContext);
    });
}


export function register(workerMain) {
    workerMain.register("PARSE_F2D", { doOperation: doParseF2D });
    workerMain.register("PARSE_F2D_FRAME", { doOperation: doParseF2DFrame });
}
