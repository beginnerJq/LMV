import { copyVertexFormat, copyPrimitiveProps } from './Consolidation';
import { writeIdToBuffer } from './GeomMergeTask';
import { createBufferGeometry } from '../BufferGeometry';
import { logger } from "../../../logger/Logger";
import * as THREE from "three";

/**
 * @class Combines multiple instances of a GeometryBuffer into a single GeometryBuffer that uses hardware instancing.
 *        Input is a single geometry and a sequence of matrix/dbId pairs. Result is a single THREE.Mesh that contains
 *        transforms and dbIds as instance buffer.
 * @constructor
 *  @param {BufferGeometr} srcGeom - Geometry shared by all instances. vb and ib of this buffer will be shared.
 *                                   (unfortunately not on GPU though, because WebGLRenderer doesn't detect support
 *                                   sharing among different GeometryBuffers.)
 *  @param {number} capacity       - Number of instances to be added. It should match the number of instances
 *                                   to avoid wasting memory.
 */
export function InstanceBufferBuilder(srcGeom, capacity) {

    // create new geometry that shares vb, ib, and per-vertex attributes
    var _result = createBufferGeometry();
    _result.ib       = srcGeom.ib;
    _result.vb       = srcGeom.vb;
    _result.iblines  = srcGeom.iblines;
    copyVertexFormat(  srcGeom, _result);
    copyPrimitiveProps(srcGeom, _result);

    // Currently, we actually write 3 bytes per id. It might be better to use an additional byte for aligment,
    // but non-interleaved BufferAttributes do currently not support that.
    var IDItemSize         = 3; // IDs are vec3 in the shader
    var IDBytesPerInstance = 3;

    // buffers that are incrementally filled with addInstance calls
    this.offsets   = new Float32Array(                 3 * capacity); // Vector3
    this.rotations = new Float32Array(                 4 * capacity); // Quaternion
    this.scalings  = new Float32Array(                 3 * capacity); // Vector3
    this.ids       = new Uint8Array  (IDBytesPerInstance * capacity); // Vec3<Uint8>

    // temp objects for reuse
    var _offset = new THREE.Vector3();
    var _quat   = new THREE.Quaternion();
    var _scale  = new THREE.Vector3();

    var _tempMatrix = new THREE.Matrix4();

    // number of added instance transforms so far
    var _counter = 0;

    var _capacity = capacity;

    /**
     *  Decomposition of a matrix into translation, rotation, and scale is mostly possible
     *  but not always. If a matrix decomposition is wrong, THREE.Matrix4.decompose() will just
     *  return a wrong result. Therefore, we have to compose it back and compare to see if it
     *  was valid.
     */
    function decompositionValid(srcMatrix, offset, quat, scale) {

        // compose matrix
        _tempMatrix.compose(offset, quat, scale);

        // compare with source matrix
        var Tolerance = 0.0001;
        var ma = srcMatrix.elements;
        var mb = _tempMatrix.elements;
        for (var i=0; i<16; i++) {
            var a = ma[i];
            var b = mb[i];
            if (Math.abs(b-a) > Tolerance*Math.max(1.0, Math.min(Math.abs(a), Math.abs(b)))) {
                return false;
            }
        }
        return true;
    }

    /**
     *  Add next instance. Make sure that you don't exceed the initially given capacity.
     *
     * @param {THREE.Matrix4} transform
     * @param {number}        dbId
     * @returns {boolean}     True:  Instance was successfully added.
     *                        False: Instance could not be added, because the matrix could not be decomposed.
     */
    // Must be called 'numInstances' times to fill the instance buffer.
    this.addInstance = function(transform, dbId) {

        if (_counter >= _capacity) {
            logger.warn("Instance buffer is already full.");
            return false;
        }

        // decompose transform
        transform.decompose(_offset, _quat, _scale);

        // We can only add instances for which the instance matrix can be decomposed.
        // Otherwise, the transform of the instancing version would be wrong.
        if (!decompositionValid(transform, _offset, _quat, _scale)) {
            return false;
        }

        // write offset
        this.offsets[3 * _counter    ] = _offset.x;
        this.offsets[3 * _counter + 1] = _offset.y;
        this.offsets[3 * _counter + 2] = _offset.z;

        // write rotation
        this.rotations[4 * _counter    ] = _quat.x;
        this.rotations[4 * _counter + 1] = _quat.y;
        this.rotations[4 * _counter + 2] = _quat.z;
        this.rotations[4 * _counter + 3] = _quat.w;

        // write scale
        this.scalings[IDBytesPerInstance * _counter    ] = _scale.x;
        this.scalings[IDBytesPerInstance * _counter + 1] = _scale.y;
        this.scalings[IDBytesPerInstance * _counter + 2] = _scale.z;

        // write dbId
        writeIdToBuffer(dbId, this.ids, IDBytesPerInstance * _counter);

        _counter++;

        return true;
    };

    /**
     * Call this after adding all transforms to get instanced geometry.
     *  @returns {null|THREE.Mesh} Returns instanced GeometryBuffer if >=1 instances have been added successfully.
     */
    // note that addInstance() must be called for each instance transform first.
    this.finish = function() {

        // no instances
        if (_counter==0) {
            return null;
        }

        // In special cases, we had to reject some addInstance() calls, so that the
        // instance buffer is not fully used. In this case, we create smaller views
        // to the same buffers that ignore the unused elements at the end.
        if (_counter < _capacity) {
            this.offsets   = new Float32Array(this.offsets.buffer,   0,                  3 * _counter); // Vector3
            this.rotations = new Float32Array(this.rotations.buffer, 0,                  4 * _counter); // Quaternion
            this.scalings  = new Float32Array(this.scalings.buffer,  0,                  3 * _counter); // Vector3
            this.ids       = new Uint8Array(this.ids.buffer,         0, IDBytesPerInstance * _counter); // Vec3<Uint8>
        }

        // add attributes for transforms
        var offsetAttrib   = new THREE.BufferAttribute(this.offsets,    3);
        var rotationAttrib = new THREE.BufferAttribute(this.rotations,  4);
        var scalingAttrib  = new THREE.BufferAttribute(this.scalings,   3);
        var idAttrib       = new THREE.BufferAttribute(this.ids,        IDItemSize);

        idAttrib.normalized   = true;
        idAttrib.bytesPerItem = 1;

        // mark attributes as "per-instance" (instead of per-vertex as default)
        offsetAttrib.divisor   = 1;
        rotationAttrib.divisor = 1;
        scalingAttrib.divisor  = 1;
        idAttrib.divisor       = 1;

        _result.setAttribute('instOffset',   offsetAttrib);
        _result.setAttribute('instRotation', rotationAttrib);
        _result.setAttribute('instScaling',  scalingAttrib);
        _result.setAttribute('id',           idAttrib);

        _result.numInstances = _counter;

        // add byte size for memory tracking (vertices + indices + instances)
        _result.byteSize = _result.vb.byteLength + _result.ib.byteLength +
                           this.offsets.byteLength + this.rotations.byteLength + this.scalings.byteLength;

        return _result;
    };
}

