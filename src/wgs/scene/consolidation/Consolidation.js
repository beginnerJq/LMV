import * as THREE from "three";
import { getVertexCount } from "../VertexEnumerator";
import { createBufferGeometry } from "../BufferGeometry";
import { runMergeSingleThreaded, ParallelGeomMerge} from "./ParallelGeomMerge";
import { logger } from "../../../logger/Logger";
import { MATERIAL_VARIANT } from "../../render/MaterialManager";
import { MeshFlags } from "../MeshFlags";
import { RenderFlags } from "../RenderFlags";

                               
                                                                                  
          

// Maximum vertex count that we allow for a consolidated mesh. For simplicity, we keep it within 16 bit scope, so that
// we can always use Uint16 indices. Allowing too large containers may backfire in several ways, e.g.,
// it would reduce granularity for progressive rendering and frustum culling too much.
var MaxVertexCountPerMesh = 0xFFFF;

var PRIMITIVE_TYPE = {
    UNKNOWN:    0,
    TRIANGLES:   1,
    LINES:       2,
    WIDE_LINES:  3,
    POINTS:      4
};

function getPrimitiveType(geom) {
    if (geom.isLines)     return PRIMITIVE_TYPE.LINES;
    if (geom.isPoints)    return PRIMITIVE_TYPE.POINTS;
    if (geom.isWideLines) return PRIMITIVE_TYPE.WIDE_LINES;
    return PRIMITIVE_TYPE.TRIANGLES;
}

function setPrimitiveType(geom, type) {

    // clear any previous flags
    if (geom.isLines     === true) geom.isLines     = undefined;
    if (geom.isWideLines === true) geom.isWideLines = undefined;
    if (geom.isPoints    === true) geom.isPoints    = undefined;

    switch(type) {
        case PRIMITIVE_TYPE.LINES:      geom.isLines     = true; break;
        case PRIMITIVE_TYPE.WIDE_LINES: geom.isWideLines = true; break;
        case PRIMITIVE_TYPE.POINTS:     geom.isPoints    = true; break;
    }
}

var MESH_HIGHLIGHTED = MeshFlags.MESH_HIGHLIGHTED;
var flagMask  = MeshFlags.MESH_VISIBLE | MeshFlags.MESH_HIDE | MESH_HIGHLIGHTED;
var flagVisible = MeshFlags.MESH_VISIBLE;
var flagHiddenMask = MeshFlags.MESH_VISIBLE | MeshFlags.MESH_HIDE;
var flagHiddenVisible = 0;
var flagHighlightMask = MeshFlags.MESH_HIGHLIGHTED | MeshFlags.MESH_HIDE;
var flagHighlightVisible = MeshFlags.MESH_HIGHLIGHTED;
var RENDER_HIDDEN = RenderFlags.RENDER_HIDDEN;
var RENDER_HIGHLIGHTED = RenderFlags. RENDER_HIGHLIGHTED;

// Should the object with flags get drawn in this render pass.
export function isVisible(flags, drawMode) {
    switch (drawMode) {
        case RENDER_HIDDEN:
            return (flags & flagHiddenMask) === flagHiddenVisible; //Ghosted not visible and not hidden
        case RENDER_HIGHLIGHTED:
            return (flags & flagHighlightMask) === flagHighlightVisible; //highlighted (bit 1 on)
    }
    return ((flags & flagMask) == flagVisible); //visible but not highlighted, and not a hidden line (bit 0 on, bit 1 off, bit 2 off)
}

const _tmpMatrix = new THREE.Matrix4();

/**
  *  Helper class to collect shapes with identical materials and merge them into a single large shape.
  *
  *  @constructor
  *    @param {THREE.Material} material - Material must be the same for all added geometries.
  */
function MergeBucket(material) {
    this.geoms       = [];
    this.matrices    = [];
    this.vertexCount = 0;
    this.material    = material;
    this.fragIds     = [];
    this.worldBox    = new THREE.Box3();
}

MergeBucket.prototype = {
    constructor: MergeBucket,

    /**
     * @param {THREE.BufferGeometry} geom
     * @param {THREE.Box3}           worldBox
     * @param {Number}               fragId
     * @returns {Number}             costs - memory cost increase caused by the new geometry
     */
    addGeom: function(geom, worldBox, fragId) {

        this.geoms.push(geom);
        this.fragIds.push(fragId);

        this.worldBox.union(worldBox);
        this.vertexCount += getVertexCount(geom);

        // Track memory costs. As long as the bucket has only a single shape,
        // we have no costs at all.
        var numGeoms = this.geoms.length;
        if (numGeoms==1) {
            return 0;
        }

        // Fragment geometries are usually BufferGeometry, which provide a byteSize for the
        // interleaved buffer. Anything else is currently unexpected and needs code change.
        if (geom.byteSize === undefined) {
            logger.warn("Error in consolidation: Geometry must contain byteSize.");
        }

        // For any bucket with >=2 geoms, all geometries must be considered for the costs.
        return geom.byteSize + (numGeoms==2 ? this.geoms[0].byteSize : 0);
    }
};

/**
 *  Set vertex attributes and vbstride of dstGeom to the same vertex format as srcGeom.
 *  Note that this can only be used for interleaved vertex buffers.
 *   @param {LmvBufferGeometry} srcGeom
 *   @param {LmvBufferGeometry} dstGeom
 */
export function copyVertexFormat(srcGeom, dstGeom) {

    if (!srcGeom.vb || !srcGeom.vbstride) {
        logger.warn("copyVertexFormat() supports only interleaved buffers");
    }

    dstGeom.vbstride = srcGeom.vbstride;

                                   
                                                                 
              

    for (var attrib in srcGeom.attributes) {
                                       
        // VertexAttribute objects of WGS BufferGeometry do not contain actual vertex data.
        // Therefore, identical BufferAttribute objects are shared among different
        // BufferGeometries. (see findBufferAttribute in BufferGeometry.js)
        dstGeom.attributes[attrib] = srcGeom.attributes[attrib];
                 
                                                                                  
                                                                                                               
                                                                                                       
                                
                  
    }

    // copy attribute keys
    dstGeom.attributesKeys = srcGeom.attributesKeys.slice(0);
}

/**
 *  Set primitive type and related params (lineWidth/pointSize) of dstGeom to the same values as srcGeom.
 *   @param {BufferGeometry} srcGeom
 *   @param {BufferGeometry} dstGeom
 */
export function copyPrimitiveProps(srcGeom, dstGeom) {

    var primType = getPrimitiveType(srcGeom);
    setPrimitiveType(dstGeom, primType);

    // pointSize/lineWidth
    dstGeom.lineWidth = srcGeom.lineWidth;
    dstGeom.pointSize = srcGeom.pointSize;
}

/**
 * Creates target BufferGeometry used to merge several src BufferGeometries into one. (see mergeGeometries)
 *
 * Returns a new BufferGeometry for which...
 *  - vb/ib are large enough to fit in all src geometry vertices/indices (allocated, but not filled yet)
 *  - the vertex-format of the interleaved vb is the same as for the input geometries
 *  - primitive type is the same as for (including pointSize/lineWidth)
 *  - it has an additional attribute for per-vertex ids
 *
 *  @param   {BufferGeometry[]} geoms - source geometry buffers.
 *  @returns {BufferGeometry}
 */
function createMergeGeom(geoms) {

    // floats per vertex
    var stride = geoms[0].vbstride; // same for src and dst, because we add per-vertex ids as separate attribute

    // compute summed vertex and index count (and summed box if needed)
    var indexCount  = 0;
    var vertexCount = 0;
    var indexLinesCount = 0;
    for (var i=0; i<geoms.length; i++) {
        var geom = geoms[i];
        indexCount  += geoms[i].ib.length;
        vertexCount += getVertexCount(geom);
        if (geoms[i].iblines)
            indexLinesCount += geoms[i].iblines.length;
    }

    var mergedGeom = createBufferGeometry();

    // allocate new geometry with vertex and index buffer
    mergedGeom.vb = new Float32Array(vertexCount * stride);
    mergedGeom.ib = new Uint16Array(indexCount);
    if (indexLinesCount)
        mergedGeom.iblines = new Uint16Array(indexLinesCount);

    // make sure that byteSize is set just like for input geometry. This is required for later memory tracking.
    mergedGeom.byteSize = mergedGeom.vb.byteLength + mergedGeom.ib.byteLength;
    if (mergedGeom.iblines)
        mergedGeom.byteSize += mergedGeom.iblines.byteLength;

    // copy primitive type + params (pointSize/lineWidth)
    copyPrimitiveProps(geoms[0], mergedGeom);

    // copy common properties from geom[0]
    copyVertexFormat(geoms[0], mergedGeom);

                                   
     
                                                                                          
                                                                                                               
                                                                       
                                                                                       
                                 
                                                                                     
                                                                                                     
         
     
              

    // In the shader, an id is a vec3 with components in [0,1].
    // In memory, each component has 8 Bits of the dbId.
    var IDItemSize   = 3; // IDs are vec3 in the shader

    // create/add additional per-vertex id attribute
    //
    // Note: The actual array buffer is not created yet, but assigned later.
    //       (see mergeGeometries)
    var idAttrib = new THREE.BufferAttribute(new Float32Array(), IDItemSize);
    idAttrib.normalized    = true; // shader needs normalized components
    idAttrib.bytesPerItem = 1;
    mergedGeom.setAttribute('id', idAttrib);

    // set primitive type
    var firstGeom = geoms[0];
    var primType = getPrimitiveType(firstGeom);
    setPrimitiveType(mergedGeom, primType);

    // copy size/width for points/wide-lines
    if (firstGeom.isPoints)    mergedGeom = firstGeom.pointSize;
    if (firstGeom.isWideLines) mergedGeom = firstGeom.lineWidth;

    return mergedGeom;
}

/**
 * Copies the vertex/index buffers of geoms into mergedGeom. Indices are modified by an offset
 * so that they point to the correct position in mergedGeom's vertex buffer.
 *  @param {BufferGeometry[]} geoms
 *  @param {BufferGeometry}   mergedGeom
 */
function copyVertexAndIndexBuffers(geoms, mergedGeom) {

    // write-offset in mergedGeom.vb (in floats)
    var dstOffset = 0;

    // create combined vertex and index buffer - including transforms
    var vertexOffset = 0;
    var indexOffset  = 0;
    var indexOffsetLines = 0;
    for (var i=0; i<geoms.length; i++) {
        var geom        = geoms[i];
        var vertexCount = getVertexCount(geom);

        // copy indices (+ offset)
        for (var j=0; j<geom.ib.length; j++) {
            mergedGeom.ib[indexOffset + j] = geom.ib[j] + vertexOffset;
        }

        // copy line indices
        if (geom.iblines) {
            for (var j=0; j<geom.iblines.length; j++) {
                mergedGeom.iblines[indexOffsetLines + j] = geom.iblines[j] + vertexOffset;
            }

            indexOffsetLines += geom.iblines.length;
        }

        // copy vertex buffer
        mergedGeom.vb.set(geom.vb, dstOffset);
        dstOffset += geom.vb.length;

        // set offsets for next geom
        vertexOffset += vertexCount;
        indexOffset  += geom.ib.length;

    }
}

/**
 * Create a single BufferGeometry that contains all geometries.
 * Requirements:
 *  - All geoms must have identical vertex format.
 *  - Geometries must have interleaved vertex buffers
 *  - Geometries must not have instance buffers. But the same geometry may be added with different matrices.
 *
 *  @param {THREE.BufferGeometry[]} geoms
 *  @param {Float32Array}           matrices - array of matrices per geometry. Each matrix is a range of 16 floats.
 *  @param {Int32Array}             dbIds    - db per input geometry. Used to create per-vertex ids.
 *  @param {THREE.Box3}             worldBox - summed worldBox of all transformed geometries
 *  @param {ParallelGeomMerge}      [parallelMerge] - Coordinates worker threads for parallel merge.
 *                                                    Not needed for single-threaded use.
 *  @returns {LmvBufferGeometry}
 */
export function mergeGeometries(geoms, matrices, dbIds, worldBox, parallelMerge) {

    var mergedGeom = createMergeGeom(geoms);

    mergedGeom.boundingBox = worldBox.clone();

    // copy src vertex/index buffers into mergedGeom
    copyVertexAndIndexBuffers(geoms, mergedGeom);

    // The last steps are either done directly or delegated to a worker thread
    if (parallelMerge) {
        parallelMerge.addMergeTask(geoms, mergedGeom, matrices, dbIds);
    } else {
        runMergeSingleThreaded(geoms, mergedGeom, matrices, dbIds);
    }

    return mergedGeom;
}

/**
 *  Returns true if geom1 and geom2 have compatible vertex format to allow merging.
 *  For this, vbstride and all vertex attributes must be equal.
 *
 * Requirement: This function is only called for geoms that...
 *  1. use interleaved vertex buffers
 *  2. do not use instancing
 *
 * @param {THREE.BufferGeometry} geom1
 * @param {THREE.BufferGeometry} geom2
 * @returns {boolean}
 */
function canBeMerged(geom1, geom2) {

    if (geom1.vbstride != geom2.vbstride) {
        return false;
    }

    var primType1 = getPrimitiveType(geom1);
    var primType2 = getPrimitiveType(geom2);
    if (primType1 !== primType2) {
        return false;
    }

    // compare pointSize/lineWidth for points/wideLines
    if (geom1.isPoints    && geom1.pointSize !== geom2.pointSize) return false;
    if (geom1.isWideLines && geom1.lineWidth !== geom2.lineWidth) return false;

    if (geom1.attributesKeys.length != geom2.attributesKeys.length) {
        return false;
    }

                                   
                                                                                                                   
                                 
                                 
                                                     
                                                                                         
              

    // compare each attribute
    for (var i=0, iEnd=geom1.attributesKeys.length; i<iEnd; i++) {
        var key = geom1.attributesKeys[i];

        // get BufferAttributes of both geoms
        var attrib1 = geom1.attributes[key];
        var attrib2 = geom2.attributes[key];

        // if geom2 does not have this, we are done
        if (!attrib2) {
            return false;
        }

        // Since attributes are cached in WGS BufferGeometry, we will mostly detect equality here already.
        if (attrib1 === attrib2) {
            continue;
        }

        // Compare values. Note that it's not enough to compare the THREE.BufferAttribute properties itemSize and normalized, but
        // also some WGS-specific values (see BufferGeometry.js).
        if (
            attrib1.itemOffset   !== attrib2.itemOffset   ||
            attrib1.normalized   !== attrib2.normalized   ||
            attrib1.itemSize     !== attrib2.itemSize     ||
            attrib1.bytesPerItem !== attrib2.bytesPerItem ||
            attrib1.isPattern    !== attrib2.isPattern
        ) {
            return false;
        }
    }
    return true;
}


/** @class Helper class to collect results of ConsolidationBuilder. */
export function Consolidation(fragCount) {

    // all consolidated meshes (+ some original geometries if they could not be merged)
    this.meshes = []; // {THREE.Mesh[]}

    // for each initially added source geometry, this array provides the position
    // in this.meshes where we can find the corresponding output mesh. The output mesh
    // is either
    //  a) a consolidated mesh that includes the input geometry or
    //  b) a mesh that shares the original material and geometry (if it couldn't be merged)
    this.fragId2MeshIndex = new Int32Array(fragCount);

    // init with -1
    for (var i=0; i<this.fragId2MeshIndex.length; i++) {
        this.fragId2MeshIndex[i] = -1;
    }

    // track summed size
    this.byteSize = 0;

    // keep intermediate result to make reruns faster
    this.consolidationMap = null;
}

Consolidation.prototype = {

    constructor: Consolidation,

    /** Add a consolidation mesh that combines several source geometries.
     *   @param {THREE.BufferGeometry} geom
     *   @param {THREE.Material}       material
     *   @param {number[]}             fragIds      - array of fragment ids associated with this container
     *   @param {number}               [firstFrag]  - Optional: Use (firstFrag, fragCount) to specify
     *   @param {number}               [fragCount]    a range within the fragIds array.
     */
    addContainerMesh: function(geom, material, fragIds, firstFrag, fragCount) {

        // add new mesh
        var newMesh = new THREE.Mesh(geom, material);
        this.meshes.push(newMesh);

        // track byte size
        this.byteSize += geom.byteSize;

        // default range: full array
        var rangeStart  = firstFrag || 0;
        var rangeLength = fragCount || fragIds.length;
        var rangeEnd    = rangeStart + rangeLength;

        // Disable THREE frustum culling for all shapes.
        //
        // Reason:
        // Default frustum culling of THREE.js does not work and would let the mesh disappear.
        // This happens because newMesh.computeBoundingSphere() fails for interleaved vertex buffers.
        // (see Frustum.intersectsObject used in FireFlyWebGLRenderer.projectObject)
        //
        // Instead, we apply culling before passing a mesh to the Renderer. (see ConsolidationIterator.js)
        newMesh.frustumCulled = false;

        // For each source fragment, remember in which container we find it
        var meshIndex = this.meshes.length - 1;
        for (var i=rangeStart; i<rangeEnd; i++) {
            var fragId = fragIds[i];
            this.fragId2MeshIndex[fragId] = meshIndex;
        }
    },

    /**
     *  Add a single mesh that has unique matrix, fragId, and dbId. This is used to add meshes
     *  that share original geometry that could not be merged with anything else.
     *
     *   @param {THREE.BufferGeometry} geom
     *   @param {THREE.Material}      material
     *   @param {number}               fragId
     *   @param {THREE.Matrix4}        matrix
     *   @param {number}               dbId
     */
    addSingleMesh: function(geom, material, fragId, matrix, dbId) {

        // create new mesh
        var newMesh = new THREE.Mesh(geom, material);
        newMesh.matrix.copy(matrix);
        newMesh.matrixAutoUpdate = false;
        newMesh.dbId = dbId;
        newMesh.fragId = fragId;

        // add it to mesh array
        this.meshes.push(newMesh);

        // Note: We don't track byteSize for these, because these geometries are shared, i.e., do
        //       not consume any extra memory compared to original geometry.

        // Disable frustum culling (see comment in addContainerMesh)
        newMesh.frustumCulled = false;

        // make it possible to find it later
        this.fragId2MeshIndex[fragId] = this.meshes.length - 1;
    },

    /**
     *  Shortcut to add geometry, material etc. of a single fragment to the consolidation.
     *  This is used for all fragments that could not be combined with others.
     *   @param {FragmentList}  fragList
     *   @param {number}        fragId
     */
    addSingleFragment: function(fragList, fragId) {
        var mesh = fragList.getVizmesh(fragId);

        // Note that the model may be moved using the model transform at any time.
        // We don't want the consolidation computation to be affected by this.
        // Therefore, consolidation is always done with excluded dynamic model transform.
        // The model transform is applied later by the ConsolidationIterator.
        // So, it's important to use the originalWorldMatrix here, which is not affected by model transform changes.
        fragList.getOriginalWorldMatrix(fragId, _tmpMatrix);

        this.addSingleMesh(mesh.geometry, mesh.material, fragId, _tmpMatrix, mesh.dbId);
    },

    /**
     * Apply the current vizflags and theming colors to the mesh and return it
     * @param {Number} meshIndex Index of consolidate/instanced mesh
     * @param {FragmentList} fragList Fragment list for the model
     * @param {Number} drawMode Render pass id from RenderFlags.
     * @param {Bool} specialHandling True if the mesh needs special handling
     * @return {THREE.Mesh} Consolidate/instanced mesh
     */
    applyAttributes: function(meshIndex, fragList, drawMode, specialHandling) {
        var curMesh = this.meshes[meshIndex];// Current mesh
        var curGeom = curMesh.geometry;// Current gometry
        var vizflags = fragList.vizflags;
        var consolidationMap = this.consolidationMap;
        var fragIds = consolidationMap.fragOrder;
        var instanced = curGeom.numInstances;// Instanced or conslidated
        var rangeStart;     // Start of fragment range
        var rangeEnd;       // End of fragment range
        var fragId;

        var db2ThemingColor = fragList.db2ThemingColor;
        var themingActive = db2ThemingColor.length > 0 || undefined;

        // Get the range of fragments for the mesh.
        if (instanced) {
            // Instanced buffer. The start of the fragment in fragIds
            // is in the rangeStart property of the mesh. The end is
            // numInstances fragments later.
            rangeStart = curMesh.rangeStart;
            rangeEnd = rangeStart + curMesh.geometry.numInstances;
        } else if (curGeom.attributes.id) {
            // Consolidated buffer - The start ranges are in the
            // consolidated map
            rangeStart = consolidationMap.ranges[meshIndex];
            rangeEnd = meshIndex + 1 >= consolidationMap.ranges.length ?
                consolidationMap.numConsolidated : consolidationMap.ranges[meshIndex + 1]
        } else {
            // No range, just one fragment
            fragId = curMesh.fragId;
        }

        // If the mesh doesn't need special handling, then return it.
        if (!specialHandling || fragId !== undefined) {
            // Clear offsets, but not for single meshes
            if (curGeom.groups && fragId === undefined) {
                curGeom.groups = undefined;
                                               
                                                       
                          
            }
            // set the visibility from the drawMode
            curMesh.visible = isVisible(vizflags[fragId === undefined ? fragIds[rangeStart] : fragId], drawMode);
            curMesh.themingColor = themingActive && db2ThemingColor[fragList.fragments.fragId2dbId[fragId]];
            return curMesh;
        }
        var start = 0;      // Start of current draw call indices
        var end = 0;        // End of currend draw call endices - so far
        var startLines = 0;      // Start of current draw call indices
        var endLines = 0;        // End of currend draw call endices - so far
        var curVisible;     // Current draw call visibility
        var curColor;       // Current draw call color
        var curDrawCall = 0;// Current draw call index

        // Add a draw call to the consolidated mesh
        function addDrawCall() {
            // If the draw call isn't visible, just skip it
            if (curVisible) {
                curGeom.groups = curGeom.groups || [];
                // Avoid calling addDrawCall because this is inside the draw loop
                // and we would like to reduce the number of object created and
                // released, when possible.
                var offset = curGeom.groups[curDrawCall] || { index: 0 };
                curGeom.groups[curDrawCall++] = offset;
                                               
                                                                                      
                                                                                                           
                                         
                          
                // Only add the draw call if there is something to draw.
                if (instanced) {
                    offset.start = 0;
                    offset.count = curGeom.ib.length;
                    if (curGeom.iblines) {
                        offset.edgeStart = 0;
                        offset.edgeCount = curGeom.iblines.length;
                    }
                    offset.instanceStart = start;
                    offset.numInstances = end - start;
                } else {
                    offset.start = start;
                    offset.count = end - start;
                    if (curGeom.iblines) {
                        offset.edgeStart = startLines;
                        offset.edgeCount = endLines - startLines;
                    }
                }
                // Set the theming color in the draw call
                offset.themingColor = curColor;
            }
        }

        function addLastDrawCall() {
            if (start === 0) {
                // Only one draw call, Set theming and visibility for entire mesh
                curMesh.themingColor = curColor;
                curMesh.visible = curVisible;
            } else {
                curMesh.visible = true;
                addDrawCall();
                // Clear existing draw calls
            }
            curGeom.groups && (curGeom.groups.length = curDrawCall);
        }

        // Loop through the fragments in the fragment list
        for (var i = rangeStart; i < rangeEnd; ++i) {
            var fragId = fragIds[i];

            // Get the visibility and theming color for the fragment
            var visible = isVisible(vizflags[fragId], drawMode);
            var color = themingActive && fragList.db2ThemingColor[fragList.fragments.fragId2dbId[fragId]];

            // Skip the first time through the loop
            if (visible !== curVisible || (visible && (color !== curColor))) {
                // Visibility or color change, add a draw call
                if (end > start) {
                    addDrawCall();
                }
                // Reset the draw call variables
                start = end;
                startLines = endLines;
                curVisible = visible;
                curColor = color;
            }

            // Add current fragment into the next draw call
            if (instanced) {
                end += 1;
            } else {
                var geom = fragList.getGeometry(fragId);
                end += geom.ib.length;
                if (geom.iblines) {
                    endLines += geom.iblines.length;
                }
            }
        }
        // Add last draw call for the last mesh
        addLastDrawCall();

        return curMesh;
    }
};


/**
 *  @class ConsolidationBuilder is a utility to merge several (usually small) objects into larger ones to
 *  improve rendering performance.
 */
export function ConsolidationBuilder() {
    this.buckets = {}; // {MergeBuchet[]}
    this.bucketCount = 0;
    this.costs   = 0;  // Consolidation costs in bytes (=costs of merged Geometries for each bucket with >=2 geoms)
}


ConsolidationBuilder.prototype = {

    /**
     *  Add a new Geometry for consolidation. Note that some geometries cannot be merged (e.g., if their material
     *  is different from all others.). In this case, the output mesh just shares input geometry and material.
     *
     *   @param {THREE.BufferGeometry} geom
     *   @param {THREE.Material}       material
     *   @param {THREE.Box3}           worldBox - worldBox (including matrix transform!)
     *   @param {Number}               fragId   - used to find out later in which output mesh you find this fragment
     */
    addGeom: function(geom, material, worldBox, fragId) {

        // find bucket of meshes that can be merged with the new one
        var bucket = null;
        var buckets = this.buckets[material.id];
        if (buckets) {
            for (var i=0; i<buckets.length; i++) {

                // get next bucket
                var nextBucket = buckets[i];

                // compatible primitive type and vertex format?
                var bucketGeom = nextBucket.geoms[0];
                if (!canBeMerged(bucketGeom, geom)) {
                    continue;
                }

                // this bucket would allow merging, but only if the vertex count doesn't grow too much
                var vertexCount = getVertexCount(geom);
                if (vertexCount + nextBucket.vertexCount > MaxVertexCountPerMesh) {
                    continue;
                }

                // we found a bucket to merge with
                bucket = nextBucket;
                break;
            }
        }

        // create a new bucket to collect this mesh
        if (!bucket) {
            bucket = new MergeBucket(material);
            this.bucketCount++;

            if (!this.buckets[material.id])
                this.buckets[material.id] = [bucket];
            else
                this.buckets[material.id].push(bucket);
        }

        // add geometry to bucket
        this.costs += bucket.addGeom(geom, worldBox, fragId);
    },

    /**
     * When all geometries have been added to buckets using addGeom() calls, this function converts the buckets into a
     * more compact representation called ConsolidationMap. This map summarizes all information that we need to build
     * the FragmentList consolidation.
     *
     * @param {Uint32Array}    allFragIds      - all fragIds, sorted by consolidation costs.
     * @param {numConsolidate} numConsolidated - number of ids in allFragIds that have been added to consolidation buckets
     *                                           all remaining ones are processed separately by instancing.
     * @returns {ConsolidationMap}
     */
    createConsolidationMap: function(allFragIds, numConsolidated) {

        // init result object
        var fragCount   = allFragIds.length;
        var result = new ConsolidationMap(fragCount, this.bucketCount);

        // fill fragOrder and ranges. Each range contains all fragIds of a single bucket
        var nextIndex = 0;
        var bucketIdx = 0;
        for (var matId in this.buckets) {

            var buckets = this.buckets[matId];

            for (var b=0; b<buckets.length; b++) {

                var bucket = buckets[b];

                // store start index of the range in fragOrder that corresponds to this bucket
                result.ranges[bucketIdx] = nextIndex;

                // store bucket box (no need to copy)
                result.boxes[bucketIdx] = bucket.worldBox;

                // append all fragIds in this bucket
                result.fragOrder.set(bucket.fragIds, nextIndex);

                // move nextIndex to the next range start
                nextIndex += bucket.fragIds.length;
                bucketIdx++;
            }

        }

        // remember which fragIds remain and must be processed by instancing
        result.numConsolidated = numConsolidated;
        for (var i=numConsolidated; i<allFragIds.length; i++) {
            result.fragOrder[i] = allFragIds[i];
        }
        return result;
    }
};

/**
 * A ConsolidationMap is an intermediate result of a FragmentList consolidation. It describes which
 * fragments are to be merged into consolidated meshes and which ones have to be processed by instancing.
 */
function ConsolidationMap(fragCount, bucketCount) {

    // Ordered array of fragIds. Each range of the array defines a merge bucket.
    this.fragOrder = new Uint32Array(fragCount);

    // Offsets into fragOrder. ranges[i] is the startIndex of the range corresponding to merge bucket i.
    this.ranges = new Uint32Array(bucketCount);

    // Cached bboxes of consolidated meshes
    this.boxes = new Array(bucketCount);

    // Store how many fragIds in fragOrder have been added to merge buckets.
    // (fragIds[0], ..., fragIds[numConsolidated-1].
    this.numConsolidated = -1; // will be set in createConsolidationMap
}

ConsolidationMap.prototype = {

    /**
     * Create consolidated meshes.
     *  @param {FragmentList}   fragList
     *  @param {MaterialManage} matman
     *  @param {RenderModel}    model
     *  @param {boolean}        [multithreaded] - If true, a part of the geometry merge work is delegated to a
     *                                            worker thread, so that the blocking time is shorter.
     *  @returns {Consolidation}
     */
    buildConsolidation: function(fragList, matman, model) {

        // some shortcuts
        var fragIds   = this.fragOrder;
        var fragCount = fragList.getCount();
        var rangeCount = this.ranges.length;

        var result = new Consolidation(fragCount);

        // Init worker thread if enabled
        var parallelMerge = null;

        // Check if a worker-implementation is available.
        if (multithreadingSupported()) {
            // Activate multithreaded consolidation
            parallelMerge = new ParallelGeomMerge(result);
        } else {
            //console.warn("Multithreaded consolidation requires to registers worker support. Falling back to single-threaded consolidation.");
        }

        // tmp objects
        var geoms  = [];
        var matrix = new THREE.Matrix4();

        // each range of fragIds is merged into a consolidated mesh
        for (var c=0; c<rangeCount; c++) {

            // get range of fragIds in this.fragOrder from which we build the next consolidated mesh.
            // Note that this.ranges only contains the range begins and the last range ends at this.numConsolidated.
            var rangeBegin  = this.ranges[c];
            var rangeEnd    = (c===(rangeCount-1)) ? this.numConsolidated : this.ranges[c+1];
            var rangeLength = rangeEnd - rangeBegin;

            // just 1 shape? => just share original geometry and material
            if (rangeLength === 1) {
                var fragId = fragIds[rangeBegin];
                result.addSingleFragment(fragList, fragId, result);
                continue;
            }

            // create array of BufferGeometry pointers
            geoms.length = rangeLength;

            // create Float32Array containing the matrix per src fragment
            var matrices = new Float32Array(16 * rangeLength);

            // create Int32Array of dbIds
            var dbIds = new Uint32Array(rangeLength);

            for (var i=0; i<rangeLength; i++) {
                fragId = fragIds[rangeBegin + i];

                // fill geoms
                geoms[i] = fragList.getGeometry(fragId);

                // store matrix as 16 floats
                fragList.getOriginalWorldMatrix(fragId, matrix);
                matrices.set(matrix.elements, 16*i);

                // store dbId in Int32Array
                dbIds[i] = fragList.getDbIds(fragId);
            }

            // get box of consolidated mesh
            var box = this.boxes[c];

            // use material of first frag in the bucket
            var firstFrag = fragIds[rangeBegin];
            var material = fragList.getMaterial(firstFrag);

            // get geom and material for consolidated mesh
            var mergedGeom  = mergeGeometries(geoms, matrices, dbIds, box, parallelMerge);
            var newMaterial = matman.getMaterialVariant(material, MATERIAL_VARIANT.VERTEX_IDS, model);

            // add result
            result.addContainerMesh(mergedGeom, newMaterial, fragIds, rangeBegin, rangeLength);
        }

        if (parallelMerge) {
            // start workers for geometry merging. This will invoke the worker operations and
            // set result.inProgress to true until all worker results are returned.
            parallelMerge.runTasks();
        }

        // store this consolidation map with the consolidation, so that we can rebuild it faster.
        result.consolidationMap = this;

        return result;
    }
};

function multithreadingSupported() {
    return !!ParallelGeomMerge.createWorker;
}

/*
 * A too fine-grained BVH may neutralize the performance gain by consolidation. To avoid that, use these defaults
 * for bvh settings when consolidation is wanted. Model loaders do this automatically when useConsolidation is set to true.
 *  @param {Object} bvhOptions
 */
Consolidation.applyBVHDefaults = function(bvhOptions) {
    bvhOptions["frags_per_leaf_node"] = 512;
    bvhOptions["max_polys_per_node"]  = 100000;
};

Consolidation.getDefaultBVHOptions = function() {
    var bvhOptions = {};
    Consolidation.applyBVHDefaults(bvhOptions);
    return bvhOptions;
};
