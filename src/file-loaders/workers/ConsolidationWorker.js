import { LmvMatrix4} from "../../wgs/scene/LmvMatrix4";
import { LmvVector3} from "../../wgs/scene/LmvVector3";
import { GeomMergeTask } from "../../wgs/scene/consolidation/GeomMergeTask";

/**
 * Main function of ConsolidationWorker. The purpose of this function is to overtake some time-consuming
 * work from mergeGeometries (see Consolidation.js), e.g., baking transforms into vertex-positions and normals.
 *  @param {Object}      context
 *  @param {MergeTask[]} context.tasks - Each MergeTask provides the input data to process a single consolidated mesh.
 *                                       See ParallelGeomMerge.js for details.
 */
export function doGeomMerge(context) {

    // Since we are running in the worker script, use LmvVector/LmvMatrix to run the MergeTask
    var matrix = new LmvMatrix4();
    var vec    = new LmvVector3();

    var results = [];
    for (var i=0; i<context.tasks.length; i++) {
        var task = context.tasks[i];

        var result = GeomMergeTask.prototype.run.call(task, matrix, vec);

        results.push(result);
    }

    // add result array buffers to transferlist to avoid copying
    var transferList = [];
    for (var i=0; i<results.length; i++) {
        transferList.push(results[i].vb.buffer);
        transferList.push(results[i].vertexIds.buffer);
    }

    // send back result
    context.worker.postMessage(results, transferList);
}

export function register(workerMain) {
    workerMain.register("MERGE_GEOMETRY", { doOperation: doGeomMerge });
}

