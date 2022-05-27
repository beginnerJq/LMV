/**
 * A GeomMergeTask is used for mesh consolidation. It fills vertex buffer and id buffer of a consolidated mesh
 * based on a set of compatible input meshes.
 *
 * GeomMergeTask is shared by main wgs script and worker script, so that the same code can be used for single-threaded
 * and multi-threaded consolidation.
 */

// unique task ids
var _nextTaskId = 1;
function createTaskId()  { return _nextTaskId++; }

export function GeomMergeTask() {

    // Interleaved vertex buffers as Float32Array.
    this.vb = null;

    // floats per vertex
    this.vbstride = 0;

    // offsets in floats where to find position/normal in vertex buffer
    this.posOffset    = 0;
    this.normalOffset = 0;

    // matrices per src-geom (Float32Array with 16 floats per matrix)
    this.matrices = null;
    this.ranges   = null;

    // must be an Uint32Array that we can efficiently hand-over to the worker
    this.dbIds = null;

    // unique task-id used to find BufferGeometry when a merged vb is returned from worker
    this.id = createTaskId();
}

/**
 *  Packs a Vector3 normal vector into 2 components. This is a CPU-side implementation of PackNormalsShaderChunk
 *  (see ShaderChunks.js)
 *
 *   @param {THREE.Vector3|LmvVector3} normal - InOut normal vector.
 *
 *  Note that 'normal' must be normalized!
 */
function encodeNormal(normal) {
    normal.x = 0.5 * (1.0 + Math.atan2(normal.y, normal.x)/Math.PI);
    normal.y = 0.5 * (1.0 + normal.z);
    normal.z = 0.0; // not used for result
}

/**
 * @param {THREE.Vector3|LmvVector3} normal - InOut normal vector. Input z is ignored.
 */
function decodeNormal(normal) {
    var angX   = 2.0 * normal.x - 1.0;
    var angY   = 2.0 * normal.y - 1.0;
    var scthX  = Math.sin(angX * Math.PI);
    var scthY  = Math.cos(angX * Math.PI);
    var scphiX = Math.sqrt(1.0 - angY * angY);
    var scphiY = angY;
    normal.x = scthY * scphiX;
    normal.y = scthX * scphiX;
    normal.z = scphiY;
}

/**
 *  Writes a dbId into 4 subsequent bytes of an Uint8Array. (4th is only for alignment and always 0)
 *   @param {Number}     dbId
 *   @param {Uint8Array} bufferUint8 - view into the vertex buffer that we write to.
 *   @param {Number}     writeIndex  - Index into the uint8 array where we write the first byte.
 */
export function writeIdToBuffer(dbId, bufferUint8, writeIndex) {
    bufferUint8[writeIndex++] =  dbId        & 0xff;
    bufferUint8[writeIndex++] = (dbId >> 8)  & 0xff;
    bufferUint8[writeIndex++] = (dbId >> 16) & 0xff;
    bufferUint8[writeIndex]   = 0; // dbIds are only vec3 in the shader
}

// We don't have THREE.Matrix3 in a worker, so that we cannot use getNormalTransform()
function getNormalMatrix(matrix, dstMatrix) {

    // eliminate translation part
    dstMatrix.copy(matrix);
    dstMatrix[ 12 ] = 0;
    dstMatrix[ 13 ] = 0;
    dstMatrix[ 14 ] = 0;

    // tranpose of inverse
    return dstMatrix.invert().transpose();
}

/**
 *  Transforms positions and normals of a vertex buffer range.
 *
 *  NOTE: Only interleaved buffers with packed normals are supported.
 *
 *   @param {GeomInfo}      geom
 *   @param {Uint16Array}   vbUint16     - additional uint16-view to interleaved vertex-buffer
 *   @param {LmvMatrix4}    matrix
 *   @param {Number}        [rangeStart] - First vertex to transform. (default: 0)
 *   @param {Number}        [rangeEnd]   - End of vertex range.       (default: #vertices)
 *   @param {LmvMatrix4}    tmpMatrix    - reused tmp matrix
 *   @param {LmvVector3}    tmpVec       - reused tmp vector
 */
var transformVertexRange = function(geom, vbUint16, matrix, rangeStart, rangeEnd, tmpMatrix, tmpVec) {

    // transform positions
    var posOffset = geom.posOffset;
    for (var i=rangeStart; i<rangeEnd; i++) {

        // read vertex position i
        var offset =  i * geom.vbstride + posOffset;
        tmpVec.set(geom.vb[offset], geom.vb[offset+1], geom.vb[offset+2]);

        tmpVec.applyMatrix4(matrix);

        // write vertex position i
        geom.vb[offset]     = tmpVec.x;
        geom.vb[offset + 1] = tmpVec.y;
        geom.vb[offset + 2] = tmpVec.z;
    }

    // transform normals (if available)
    if (geom.normalOffset !== -1) {

        // To transform normals, we need an Uint16-view to the data.
        // Packed normals are 2-component Uint16-vectors.
        var uint16PerVertex    = geom.vbstride * 2;           // Multiply by 2, because vbstride and itemOffset
        var uint16NormalOffset = geom.normalOffset * 2; // are counting 32Bit floats.
        var maxUint16          = 0xFFFF;

        // compute normal transform
        var normalMatrix = getNormalMatrix(matrix, tmpMatrix);

        // transform normal vectors
        for (i=rangeStart; i<rangeEnd; i++) {
            // read byte-normal of vertex i
            var normalIndex = i * uint16PerVertex + uint16NormalOffset;
            tmpVec.set(vbUint16[normalIndex], vbUint16[normalIndex+1], 0.0);

            // decode to vec3 with components in [0,1]
            tmpVec.divideScalar(maxUint16);
            decodeNormal(tmpVec);

            // Note that normalMatrix is a LmvMatrix4 (although we only use 3x3 matrix)
            tmpVec.applyMatrix4(normalMatrix);

            // Note that encodeNormal requires normalized values. Although a decodedNormal is
            // always normalized, the normalMatrix may involve a scaling.
            tmpVec.normalize();

            // encode back to 2-component uint16
            encodeNormal(tmpVec);
            tmpVec.multiplyScalar(maxUint16);

            // write back to vertex buffer
            vbUint16[normalIndex]     = tmpVec.x;
            vbUint16[normalIndex + 1] = tmpVec.y;
        }
    }
};

// read matrix i from Float32 array to target LmvMatrix4
function getMatrix(index, array, target) {
    // TypedArray.set does not support a srcOffset parameter. So we have to use manual copy here.
    var offset = 16 * index;
    for (var i=0; i<16; i++) {
        target.elements[i] = array[i+offset];
    }
}

/**
 *  Run merge task. This can be done using Vector/Matrix types from THREE (in main) or LmvVector/LmvMatrix (worker).
 *  To define which types to use while keeping the code independent, a preallocated matrix/vector must be provided.
 *
 *  @param {LmvMatrix4|THREE.Matrix4} matrix
 *  @param {LmvVector3|THREE.Vector3} vector
 *  @returns {Object} - merge result r, containing
 *                        {number}       r.id:        task id
 *                        {Float32Array} r.vb:        merged interleaved vertex buffer
 *                        {Uint8Array}   r.vertexIds: buffer for separate per-vertex id attribute
 */
GeomMergeTask.prototype.run = function(matrix, vec) {

    var vb          = this.vb;
    var vertexCount = vb.length / this.vbstride;

    var tmpMatrix = matrix.clone();

    // create buffer for per-vertex ids of consolidated mesh
    var IDBytesPerVertex = 3;
    var dstIds = new Uint8Array(IDBytesPerVertex * vertexCount);

    // to transform normals, we need an Uint16-view to the interleaved vertex buffer.
    // packed normals are 2-component Uin16-vectors.
    var hasNormals = (this.normalOffset !== -1);
    var vbUint16 = (hasNormals ? new Uint16Array(vb.buffer, vb.byteOffset, vb.length * 2) : null);

    // transform vertex-range and write ids. Each range corresponds to a source fragment geometry
    var ranges    = this.ranges;
    var matrices  = this.matrices;
    var numRanges = ranges.length - 1; // note that ranges contains an extra element for the last range end
    for (var j=0; j<numRanges; j++) {

        // get vertex range corresponding to src geom i
        var rangeBegin = ranges[j];
        var rangeEnd   = ranges[j+1];

        // get matrix for src geom i
        getMatrix(j, matrices, matrix);

        // transform vertex positions and normals in this range
        transformVertexRange(this, vbUint16, matrix, rangeBegin, rangeEnd, tmpMatrix, vec);

        // assign dbId to all vertices of this range
        var dstIdsByteOffset = rangeBegin * IDBytesPerVertex;
        var rangeLength = rangeEnd - rangeBegin;
        var dbId = this.dbIds[j];
        for (var k=0; k<rangeLength; k++) {
            writeIdToBuffer(dbId, dstIds, dstIdsByteOffset);
            dstIdsByteOffset += IDBytesPerVertex;
        }
    }

    // return result object. It contains everything we need to finish a single consolidated mesh.
    return {
        taskId:    this.id,
        vb:        this.vb, // note that we have to pass back the byte-view
        vertexIds: dstIds,
    };
};
