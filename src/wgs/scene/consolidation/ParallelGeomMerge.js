import { GeomMergeTask } from "./GeomMergeTask";
import { getVertexCount } from "../VertexEnumerator";
import { createWorkerWithIntercept } from '../../../file-loaders/main/WorkerCreator';
import { LmvMatrix4 as Matrix4 } from '../LmvMatrix4';
import { LmvVector3 as Vector3 } from '../LmvVector3';

/** Computes ranges in consolidated vertex buffer:
 *  When merging geoms into a single vertex buffer, each source geometry geoms[i] will correspond to a range
 *  in the merged vertex buffer. These function computes these ranges. From the returned array, a range
 *  corresponding to src fragment i can be obtained by:
 *   - rangeBegin = ranges[i]
 *   - rangeEnd   = ranges[i+1] (exclusive)
 *  Note that ranges.length is #geoms + 1.
 *
 * @param {BufferGeometry} geoms - pointers to src fragment geoms to be merged.
 * @returns {Uint16Array}
 */
function createRangeArray(geoms) {

    var ranges = new Uint16Array(geoms.length + 1);
    var rangeStart = 0;
    for (var i=0; i<geoms.length; i++) {
        ranges[i] = rangeStart;
        rangeStart += getVertexCount(geoms[i]);
    }
    // add end of final range
    ranges[i] = rangeStart;
    return ranges;
}

/**
 * Init merge task from src geometries.
 *
 * @param {BufferGeometry[]} geoms      - input geometries
 * @param {BufferGeometry}   targetGeom - consolidated geometry (just copied, not transformed yet)
 * @param {Float32Array}     matrices   - transforms per range (each matrix stored as 16 subsequent floats)
 * @param {Int32Array}       dbIds      - dbIds per src fragment - used by worker to build per-vertex id buffer
 * @constructor
 */
function createMergeTask(geoms, targetGeom, matrices, dbIds) {

    var ranges = createRangeArray(geoms);
    var task   = new GeomMergeTask();

    // Interleaved vertex buffers as Float32Array
    task.vb = targetGeom.vb;

    // floats per vertex
    task.vbstride = targetGeom.vbstride;

    // offsets in floats where to find position/normal in vertex buffer
    task.posOffset    = targetGeom.attributes.position.itemOffset;
    task.normalOffset = (targetGeom.attributes.normal ? targetGeom.attributes.normal.itemOffset : -1); // -1 for "no normals"

    // matrices per src-geom (Float32Array with 16 floats per matrix)
    task.matrices = matrices;
    task.ranges   = ranges;

    // must be an Uint32Array that we can efficiently hand-over to the worker
    task.dbIds = dbIds;

    return task;
}

/*
 * Writes the result of a GeomMergeTask back to a BufferGeometry.
 *  @param {Object}         mergeResult - returned by GeomMergeTask.run()
 *  @param {BufferGeometry} targetGeom  - BufferGeometry that will use the consolidated buffers
 */
function applyMergeResult(mergeResult, targetGeom) {
    targetGeom.vb                  = mergeResult.vb;		   // interleaved vertex-buffer  {Float32Array}
    targetGeom.attributes.id.array = mergeResult.vertexIds; // buffer with per-vertex ids {Uint32Array}
    targetGeom.needsUpdate         = true;

                                   
     
                                                                                                            
                                         
                                                                           
                                                            
                                                              
                                                       
                                                         
                                                                           
                                                                
                                     
                                                                                                                    
                        
                                                    
                 
             
         
     
              
}

/**
 * Helper class used to delegate a part of the geometry merging work to a worker thread.
 *   @param {Consolidation} consolidation - Consolidation.inProgress will be true as long as workers are running.
 */
export function ParallelGeomMerge(consolidation) {

    // Currently, we hardwire to just use 2 workers. With more workers, the single workers finished faster, but
    // for the overall time until all results are returned, I couldn't measure any benefit so far.
    var numWorkers = 2;

    // Track how many workers have to deliver their result before the consolidation is ready to use.
    var _workersRunning = 0;

    // indexed by task id. Contains BufferGeometries of consolidated meshes that are waiting for their merged vertex buffer.
    var _receiverGeoms = {};

    // MergeTask[] - one per addMergeTask() call
    var _tasks = [];

    // {Consolidation} - We set consolidation.inProgress as long as workers are running. This makes sure that
    // 					 the consolidation is not used before it is fully finished.
    var _consolidation = consolidation;

    // workers
    var _workers = new Array(numWorkers);

    /**
     * Called in mergeGeometry (Consolidation.js) to delegate merge work to worker thread.
     * See MergeTask ctor for params.
     */
    this.addMergeTask = function(geoms, targetGeom, matrices, dbIds) {

        var task = createMergeTask(geoms, targetGeom, matrices, dbIds);
        _tasks.push(task);

        // remember which BufferGeometry will get the merged vertex buffer
        _receiverGeoms[task.id] = targetGeom;
    };

    /**
     * After adding merge tasks, this function passes all collected input to the workers and
     * starts them.
     */
    this.runTasks = function() {

        // init workers
        for (var i=0; i<numWorkers; i++) {
            _workers[i] = ParallelGeomMerge.createWorker();
            _workers[i].addEventListenerWithIntercept(handleGeomMergeResult);
        }

        // subdivide task array into ranges, where each range is processed by a separate worker
        var numTasks = _tasks.length;
        var tasksPerWorker = Math.floor(numTasks / numWorkers);
        for (var r=0; r<numWorkers; r++) {

            // define next range
            var lastCycle = (r === numWorkers-1);
            var rangeBegin = r * tasksPerWorker;
            var rangeEnd   = (lastCycle ? numTasks : rangeBegin + tasksPerWorker);

            var rangeLength = rangeEnd - rangeBegin;

            // array of tasks for this worker
            var tasks = [];

            // add all buffers and matrix arrays to transfer-list
            var transferList = new Array(4 * rangeLength);
            var index = 0;
            for (i=rangeBegin; i<rangeEnd; i++) {
                var task = _tasks[i];
                transferList[index++] = task.vb.buffer;
                transferList[index++] = task.matrices.buffer;
                transferList[index++] = task.ranges.buffer;
                transferList[index++] = task.dbIds.buffer;

                tasks.push(task);
            }

            // start worker task
            var msg = {
                operation:    "MERGE_GEOMETRY",
                tasks:      tasks
            };

            var worker = _workers[r];
            worker.doOperation(msg, transferList);

            _workersRunning++;
        }

        // mark consolidation as unusable until all workers are finished
        _consolidation.inProgress = true;
    };

    /**
     * Handles messages returned from worker threads
     * @param {Object} msg
     * @param {Object[]} msg.data - array of results per task, sent by ConsolidationWorker.
     * 								Each result contains interleaved vertex-buffer and vertex-id buffer for a
     * 							    consolidated mesh. see doGeomMerge() function in ConsolidationWorker.js for details.
     */
    function handleGeomMergeResult(msg) {

        // get worker results. Note that sending consolidation results is currently the only supported
        // message that a consolidation worker may send.
        var results = msg.data;

        // for each returned vertex-buffer, find the corresponding consolidated mesh that should obtain it.
        for (var i=0; i<results.length; i++) {

            var result = results[i];
            var taskId = result.taskId;

            // use task id to find receiving geometry
            var geom = _receiverGeoms[taskId];

            applyMergeResult(result, geom);

            // remove entry from list
            delete _receiverGeoms[taskId];
        }

        // Check if all workers are done
        _workersRunning--;
        if (_workersRunning===0) {

            // all workers done. Signal that consolidation is ready to use.
            _consolidation.inProgress = false;

            // terminate workers
            for (i=0; i<_workers.length; i++) {
                _workers[i].clearAllEventListenerWithIntercept();
                _workers[i].terminate();
                _workers[i] = null;
            }
        }
    }
}

// Run merge task immediately in the main thread
export function runMergeSingleThreaded(geoms, mergedGeom, matrices, dbIds) {

    var task   = createMergeTask(geoms, mergedGeom, matrices, dbIds);

    // run merge task
    var vec    = new Vector3();
    var matrix = new Matrix4();
    var result = task.run(matrix, vec);

    applyMergeResult(result, mergedGeom);
}

ParallelGeomMerge.createWorker = createWorkerWithIntercept;