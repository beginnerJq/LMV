import * as globals from '../globals';
import { isMobileDevice } from "../../compat";
import * as THREE from "three";

/**
 * Maintains a list of buffer geometries and running totals of their memory usage, etc.
 * Each geometry gets an integer ID to be used as reference in packed fragment lists.
 * @param {number} numObjects Number of objects (may be 0 if not known in advance).
 * @param {boolean} is2d True for 2D datasets.
 * @param {boolean} [disableStreaming] Set to true for small models to enforce full GPU upload.
 * @constructor
 */
export function GeometryList(numObjects, is2d, disableStreaming, isUnitBoxes) {
    // array of BufferGeometry instances. Indexed by svfid.
    this.geoms             = [null]; //keep index 0 reserved for invalid id

    this.numGeomsInMemory  = 0; // total number of geoms added via addGeometry(..) (may be <this.geoms.length)
    this.geomMemory        = 0; // total memory in bytes of all geoms
    this.gpuMeshMemory     = 0; // total memory in bytes of all geoms, exluding those that we draw from system memory
    this.gpuNumMeshes      = 0; // total number of geoms etries that we fully upload to GPU for drawing
    this.geomPolyCount     = 0; // summed number of polygons, where geometries with mulitple instances are counted only once.
    this.instancePolyCount = 0; // summed number of polygons, counted per instance
    this.is2d              = is2d;

    // 6 floats per geometry
    this.geomBoxes = isUnitBoxes ? null : new Float32Array(Math.max(1, numObjects + 1) * 6);
    this.numObjects = numObjects;

    // If false, we use a heuristic to determine which shapes are uploaded to GPU and which
    // ones we draw from CPU memory using (slower) streaming draw.
    this.disableStreaming = !!disableStreaming;
}

GeometryList.prototype.getGeometry = function(svfid) {
    return this.geoms[svfid];
};

/**
 * Determines if a given BufferGeometry should be stored on CPU or GPU.
 * 
 * @param {THREE.BufferGeometry} geometry The BufferGeometry whose storage is to
 * be determined. If the BufferGeometry is to be retained in the GPU memory, then 
 * its 'streamingDraw' and 'streamingIndex' will be set to 'false'. Otherwise, 
 * they will be set to 'true' to enable its streaming draw from system memory.
 * @param {number} numInstances The number of fragments that made up the Mesh 
 * object that owns this BufferGeometry object.
 * @param {number} gpuNumMeshes The number of Mesh objects that are already
 * stored on the GPU.
 * @param {number} gpuMeshMemory The amount of GPU memory in bytes that are taken
 * up by all the Mesh objects stored in GPU. 
 */
GeometryList.prototype.chooseMemoryType = function(geometry, numInstances, gpuNumMeshes, gpuMeshMemory) {
    // Define GPU memory limits for heuristics below
    var GPU_MEMORY_LOW  = globals.GPU_MEMORY_LIMIT;
    var GPU_MEMORY_HIGH = 2 * GPU_MEMORY_LOW;
    var GPU_MESH_MAX    = globals.GPU_OBJECT_LIMIT;

    if (GPU_MEMORY_LOW === 0) {
        geometry.streamingDraw  = true;
        geometry.streamingIndex = true;
        return;
    }

    //Heuristically determine if we want to load this mesh onto the GPU
    //or use streaming draw from system memory
    if (this.disableStreaming || (gpuMeshMemory < GPU_MEMORY_LOW && gpuNumMeshes < GPU_MESH_MAX)) {
        //We are below the lower limits, so the mesh automatically is
        //assigned to retained mode
        geometry.streamingDraw  = false;
        geometry.streamingIndex = false;
    } else if (gpuMeshMemory >= GPU_MEMORY_HIGH) {
        //We are above the upper limit, so mesh is automatically
        //assigned to streaming draw
        geometry.streamingDraw  = true;
        geometry.streamingIndex = true;
    } else {
        //Between the lower and upper limits,
        //Score mesh importance based on its size
        //and number of instances it has. If the score
        //is high, we will prefer to put the mesh on the GPU
        //so that we don't schlep it across the bus all the time.
        var weightScore;

        if (!this.is2d) {
            weightScore = geometry.byteSize * (numInstances || 1);
        } else {
            //In the case of 2D, there are no instances, so we just keep
            //piling into the GPU until we reach the "high" mark.
            weightScore = 100001;
        }

        if (weightScore < 100000) {
            geometry.streamingDraw  = true;
            geometry.streamingIndex = true;
        }
    }
};

/**
 * Adds a BufferGeometry object to this GeometryList while also update the 
 * BufferGeometry in the following ways:
 * 
 *  - Sets its 'streamingDraw' and 'streamingIndex' properties to determine if
 *    it should be stored in the system or GPU memory.
 *  - Sets its 'svfid' property so that each BufferGeometry knows its index in
 *    the internal array 'this.geoms'.
 *  - Deletes its bounding box and bounding sphere to conserve memory.
 * 
 * Note that this method is not meant to be called multiple times for the same 
 * svfid, as doing so would mess up the statistics.
 * 
 * @param {THREE.BufferGeometry} geometry A mandatory parameter that must not 
 * be null. The same BufferGeometry cannot be addd to more than one GeometryList.
 * @param {number} numInstances The number of fragments that made up the Mesh 
 * object that owns this BufferGeometry object. The default value is 1 if the 
 * parameter is not supplied.
 * @param {number} svfid The index of the BufferGeometry when it is stored in
 * the internal list 'this.geoms'. If this parameter is not defined, equals to 
 * zero, or is a negative number, the BufferGeometry is appended to the end of 
 * 'this.geoms' array.
 */
GeometryList.prototype.addGeometry = function(geometry, numInstances, svfid) {
    this.chooseMemoryType(geometry, numInstances, this.gpuNumMeshes, this.gpuMeshMemory);

    // track overall GPU workload
    var size = geometry.byteSize + globals.GEOMETRY_OVERHEAD;
    if (!geometry.streamingDraw) {
        if (isMobileDevice())
            size += geometry.byteSize;
        this.gpuMeshMemory += geometry.byteSize;
        this.gpuNumMeshes  += 1;
    }

    this.numGeomsInMemory++;

    // if no svfid is defined
    if (svfid === undefined || svfid <= 0)
        svfid = this.geoms.length;

    // store geometry (may increase array length)
    this.geoms[svfid] = geometry;

    if (this.geomBoxes) {
        // resize this.geombboxes if necessary
        var fill = (this.geomBoxes.length / 6) | 0;
        if (fill < this.geoms.length) {
            var end = (this.geoms.length * 3 / 2) | 0;
            var nb = new Float32Array(6 * end);
            nb.set(this.geomBoxes);
            // Make all of the new bounds empty
            var empty = new THREE.Box3();
            empty.makeEmpty();
            while (fill < end) {
                nb[fill * 6] = empty.min.x;
                nb[fill * 6 + 1] = empty.min.y;
                nb[fill * 6 + 2] = empty.min.z;
                nb[fill * 6 + 3] = empty.max.x;
                nb[fill * 6 + 4] = empty.max.y;
                nb[fill++ * 6 + 5] = empty.max.z;
            }
            this.geomBoxes = nb;
        }

        // copy geometry bbox to this.geomBoxes
        var bb = geometry.boundingBox;
        if (!bb) {
            if (!geometry.hash) {
                console.error("Mesh without bbox and without hash should not be.");
            }
            this.geomBoxes[svfid * 6] = -0.5;
            this.geomBoxes[svfid * 6 + 1] = -0.5;
            this.geomBoxes[svfid * 6 + 2] = -0.5;
            this.geomBoxes[svfid * 6 + 3] = 0.5;
            this.geomBoxes[svfid * 6 + 4] = 0.5;
            this.geomBoxes[svfid * 6 + 5] = 0.5;
        } else {
            this.geomBoxes[svfid * 6] = bb.min.x;
            this.geomBoxes[svfid * 6 + 1] = bb.min.y;
            this.geomBoxes[svfid * 6 + 2] = bb.min.z;
            this.geomBoxes[svfid * 6 + 3] = bb.max.x;
            this.geomBoxes[svfid * 6 + 4] = bb.max.y;
            this.geomBoxes[svfid * 6 + 5] = bb.max.z;
        }
    }

    //Free the bbx objects if we don't want them.
    if (globals.memoryOptimizedLoading && !this.is2d) {
        geometry.boundingBox = null;
        geometry.boundingSphere = null;
    }

    // track system-side memory
    this.geomMemory += size;

    // track polygon count
    //TODO: Asssignment into the svf is temporary until the dependencies
    //are unentangled
    var ib = (geometry.index?.array) || geometry.ib;
    var perPoly = geometry.isLines ? 2 : 3;
    var polyCount;
    if (ib) {
        polyCount = ib.length / perPoly;
    } else if (geometry.vb) {
        polyCount = geometry.vb.length / (perPoly * geometry.stride);
    } else {
        polyCount = geometry.attributes['position'].length / (3 * perPoly);
    }
    this.geomPolyCount += polyCount;
    this.instancePolyCount += polyCount * (numInstances || 1);
    
    // Record the count that can be decrease properly when geometry removed.
    geometry.polyCount = polyCount;
    geometry.instanceCount = (numInstances || 1);

    geometry.svfid = svfid;

    return svfid;
};

/**
 * Removes the geometry with svfid 'idx' from the list.
 * Note: Unlike addGeometry, this method only updates this.numGeomsInMemory. All other statistics keep the same.
 * @param {int} idx - Geometry ID.
 * @returns {int} Size of the removed geometry, or 0.
 */
GeometryList.prototype.removeGeometry = function(idx, renderer) {
    // if there is no geom assigned, just return 0
    var geometry = this.getGeometry(idx);
    if (!geometry) {
        return 0;
    }
    var size = geometry.byteSize + globals.GEOMETRY_OVERHEAD;
    renderer && renderer.deallocateGeometry(geometry);
    if (!geometry.streamingDraw) {
        if (isMobileDevice())
            size += geometry.byteSize;
        this.gpuMeshMemory -= geometry.byteSize;
        this.gpuNumMeshes  -= 1;
    }

    // remove geometry from the list
    this.geoms[idx] = null;

    // decrease its related counts
    this.geomMemory -= size;
    this.numGeomsInMemory--;
    this.geomPolyCount -= geometry.polyCount;
    this.instancePolyCount -= geometry.instanceCount * geometry.polyCount;

    return size;
};


/**
 * Returns bounding box of a geometry.
 * @param {number} geomid - Geometry ID.
 * @param {THREE.Box3|LmvBox3} dst - Set to empty is there is no geometry of this id.
 */
GeometryList.prototype.getModelBox = function(geomid, dst) {

    //In case of OTG models, we do not store the geometry bounds, because
    //they are all unit boxes.
    if (!this.geomBoxes) {
        // Note: Since 0 is reserved as invalid geometry-index, the geometries start at 1
        //       and this.numObjects itself is still a valid index. Therefore <=.
        if (geomid >= 1 && geomid <= this.numObjects) {
            dst.min.x = -0.5;
            dst.min.y = -0.5;
            dst.min.z = -0.5;
            dst.max.x = 0.5;
            dst.max.y = 0.5;
            dst.max.z = 0.5;
        } else {
            dst.makeEmpty();
        }
        return;
    }

    // return empty box if geomid is out of bounds. If the id is in bounds
    // then the stored bbox is empty if the geometry hasn't been loaded 
    if (geomid === 0 || this.geomBoxes.length/ 6 <= geomid) {
        dst.makeEmpty();
        return;
    }

    // extract bbox values from Float32Array this.geomboxes
    var off = geomid * 6;
    var bb = this.geomBoxes;
    dst.min.x = bb[off];
    dst.min.y = bb[off + 1];
    dst.min.z = bb[off + 2];
    dst.max.x = bb[off + 3];
    dst.max.y = bb[off + 4];
    dst.max.z = bb[off + 5];
};

// Tell renderer to release all GPU buffers. 
// renderer: instaneof FireFlyWebGLRenderer
GeometryList.prototype.dispose = function(renderer) {
    if (!renderer)
        return;

    for (var i = 0, iEnd = this.geoms.length; i < iEnd; i++) {
        if (this.geoms[i]) {
                                            
            {
                renderer.deallocateGeometry(this.geoms[i]);
            }
                     
                                        
                      
        }
    }
};

GeometryList.prototype.printStats = function() {
    console.log("Total geometry size: "      + (this.geomMemory / (1024 * 1024)) + " MB");
    console.log("Number of meshes: "         + (this.geoms.length - 1));
    console.log("Num Meshes on GPU: "        + this.gpuNumMeshes);
    console.log("Net GPU geom memory used: " + this.gpuMeshMemory);
};
