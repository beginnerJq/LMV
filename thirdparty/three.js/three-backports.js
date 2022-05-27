import { defineFunctionIfMissing, definePropertySafe } from './three-backports/backport-utils';

import { defineBoxBufferGeometry } from './three-backports/BoxBufferGeometry';
import { defineCircleBufferGeometry } from './three-backports/CircleBufferGeometry';
import { defineCylinderBufferGeometry } from './three-backports/CylinderBufferGeometry';
import { definePolyhedronBufferGeometry } from './three-backports/PolyhedronBufferGeometry';
import { defineOctahedronBufferGeometry } from './three-backports/OctahedronBufferGeometry';
import { defineSphereBufferGeometry } from './three-backports/SphereBufferGeometry';
import { defineTorusBufferGeometry } from './three-backports/TorusBufferGeometry';

// arrayMax from https://github.com/mrdoob/three.js/blob/r125/src/utils.js#L17-L31
const _arrayMax = (array) => {
    if (array.length === 0) return -Infinity;
    var max = array[0];

    for (var i = 1, l = array.length; i < l; ++i) {
        if (array[i] > max) max = array[i];
    }

    return max;
}

export const polyfillTHREE = (THREE) => {
    const _vector = new THREE.Vector3();

    // Backport from R86: https://github.com/mrdoob/three.js/commit/e2f465d2fbf504c08f78a3653962b1caf7cd60e1
    defineFunctionIfMissing(THREE?.Camera?.prototype, "updateMatrixWorld", function ( force ) {
        THREE.Object3D.prototype.updateMatrixWorld.call( this, force );
        this.matrixWorldInverse.copy(this.matrixWorld).invert();
    });

    defineFunctionIfMissing(THREE?.Box2?.prototype, "getSize", function (target) {
        return this.isEmpty() ? target.set( 0, 0 ) : this.size(target);
    });
    defineFunctionIfMissing(THREE?.Box3?.prototype, "getSize", function (target) {
        return this.isEmpty() ? target.set( 0, 0, 0 ) : this.size(target);
    });
    defineFunctionIfMissing(THREE?.Box2?.prototype, "intersectsBox", function (target) { return this.isIntersectionBox(target); });
    defineFunctionIfMissing(THREE?.Box3?.prototype, "intersectsBox", function (target) { return this.isIntersectionBox(target); });
    defineFunctionIfMissing(THREE?.Ray?.prototype, "intersectsBox", function (target) { return this.isIntersectionBox(target); });

    // Backport from r72: https://github.com/mrdoob/three.js/commit/997ff21d0f3db6b993d25bc36d556fe98421195c
    // Copied from https://github.com/mrdoob/three.js/blob/r125/src/core/BufferAttribute.js#L227-L243
    defineFunctionIfMissing(THREE?.BufferAttribute?.prototype, 'applyMatrix4', function applyMatrix4(m) {
        for ( let i = 0, l = this.count; i < l; i ++ ) {
            _vector.x = this.getX( i );
            _vector.y = this.getY( i );
            _vector.z = this.getZ( i );

            _vector.applyMatrix4( m );

            this.setXYZ( i, _vector.x, _vector.y, _vector.z );
        }

        return this;
    });

    // Backports from r72: https://github.com/mrdoob/three.js/commit/1b6effb20430811374b648590bd24fa516548641
    // Copied from https://github.com/mrdoob/three.js/blob/r125/src/core/BufferAttribute.js#L289-L293
    defineFunctionIfMissing(THREE?.BufferAttribute?.prototype, 'getX', function getX(index) {
        return this.array[ index * this.itemSize ];
    });
    // Copied from https://github.com/mrdoob/three.js/blob/r125/src/core/BufferAttribute.js#L303-L307
    defineFunctionIfMissing(THREE?.BufferAttribute?.prototype, 'getY', function getY(index) {
        return this.array[ index * this.itemSize + 1 ];
    });
    // Copied from https://github.com/mrdoob/three.js/blob/r125/src/core/BufferAttribute.js#L317-L321
    defineFunctionIfMissing(THREE?.BufferAttribute?.prototype, 'getZ', function getZ(index) {
        return this.array[ index * this.itemSize + 2 ];
    });

    if (typeof THREE?.BufferAttribute == 'function') {
        // Polyfills for r83 [Type]BufferAttribute Using class form for cleaner code
        // [Type]Attribute -> [Type]BufferAttribute (r83) https://github.com/mrdoob/three.js/commit/33bfe1b393a8888259f079fcd3ed726445ff86fb
        // function to class (r128) https://github.com/mrdoob/three.js/commit/5aaec4c0345035373b701a6b60b399f90addc4cc#diff-fd9bd9820242ad98f71b72535834e02a4500e4788ad62e618a172534b69af013
        defineFunctionIfMissing(THREE, "Float32BufferAttribute",
            class Float32BufferAttribute extends THREE.BufferAttribute {
                constructor( array, itemSize, normalized ) {
                    super( new Float32Array( array ), itemSize, normalized );
                }
            }
        );
        defineFunctionIfMissing(THREE, "Uint16BufferAttribute",
            class Uint16BufferAttribute extends THREE.BufferAttribute {
                constructor( array, itemSize, normalized ) {
                    super( new Uint16Array( array ), itemSize, normalized );
                }
            }
        );
        defineFunctionIfMissing(THREE, "Uint32BufferAttribute",
            class Uint32BufferAttribute extends THREE.BufferAttribute {
                constructor( array, itemSize, normalized ) {
                    super( new Uint32Array( array ), itemSize, normalized );
                }
            }
        );
    }

    // Polyfill for r113 BufferGeometry.applyMatrix4: https://github.com/mrdoob/three.js/commit/957051a01feb7731d67fd6067a67a64d86db0965
    defineFunctionIfMissing(THREE?.BufferGeometry?.prototype, "applyMatrix4", function applyMatrix4(m) {
        this.applyMatrix(m);
        return this;
    });

    // Polyfill for r72 BufferGeometry.offsets -> BufferGeometry.groups:
    // .offsets -> .drawcalls: https://github.com/mrdoob/three.js/commit/a2cf50f473fbbff1b6519d73a71d6df7d507362e
    // .drawcalls -> .groups: https://github.com/mrdoob/three.js/commit/3ed8a04c0c9f249e386935392e6bf89fd3b686af
    definePropertySafe(THREE?.BufferGeometry?.prototype, 'groups', {
        get: function get() { return this.offsets; },
        set: function set(val) { this.offsets = val; this.drawcalls = val;}
    });

    // Backport from r88: https://github.com/mrdoob/three.js/commit/d38d3cce0223cf55a2bf11d8084b972bac0b30d3
    // Copied from https://github.com/mrdoob/three.js/blob/r125/src/core/BufferGeometry.js#L263-L278
    defineFunctionIfMissing(THREE?.BufferGeometry?.prototype, 'addGroup', function addGroup(start, count, materialIndex = 0) {
        if (materialIndex !== undefined && materialIndex !== 0) {
            console.warn("THREE.BufferGeometry: .addGroup() with `materialIndex !== 0` is not supported in this Three.js version. Ignoring the `materialIndex` parameter.");
        }
        return this.addDrawCall(start,count);
    });

    definePropertySafe(THREE?.BufferGeometry?.prototype, 'index', {
        get: function get() { return this.attributes.index; },
        set: function set(val) { this.attributes.index = val; }
    });

    // Backport from r88: https://github.com/mrdoob/three.js/commit/d38d3cce0223cf55a2bf11d8084b972bac0b30d3
    // Copied from https://github.com/mrdoob/three.js/blob/r125/src/core/BufferGeometry.js#L263-L278
    defineFunctionIfMissing(THREE?.BufferGeometry?.prototype, 'setFromPoints', function setFromPoints(points) {
        const position = [];

        for ( let i = 0, l = points.length; i < l; i ++ ) {
            const point = points[ i ];
            position.push( point.x, point.y, point.z || 0 );
        }

        this.setAttribute( 'position', new THREE.Float32BufferAttribute( position, 3 ) );
        return this;
    });

    // Backport from r72: https://github.com/mrdoob/three.js/commit/4a606a66fe0083bd8bf741a647aa11501eecae59
    // Copied from https://github.com/mrdoob/three.js/blob/r125/src/core/BufferGeometry.js#L60-L74
    defineFunctionIfMissing(THREE?.BufferGeometry?.prototype, 'setIndex', function setIndex(index) {
        if (Array.isArray(index)) {
            this.index = new ( _arrayMax( index ) > 65535 ? THREE.Uint32BufferAttribute : THREE.Uint16BufferAttribute )( index, 1 );
        } else {
            this.index = index;
        }

        return this;
    });

    if (typeof THREE?.BufferGeometry == 'function') {
        defineBoxBufferGeometry(THREE);

        defineCircleBufferGeometry(THREE);

        defineCylinderBufferGeometry(THREE);

        definePolyhedronBufferGeometry(THREE);
        {
            // Subclass of THREE.PolyhedronBufferGeometry
            defineOctahedronBufferGeometry(THREE);
        }

        defineSphereBufferGeometry(THREE);

        defineTorusBufferGeometry(THREE);
    }

    // Polyfill for r113 addition of Frustum.setFromProjectionMatrix https://github.com/mrdoob/three.js/commit/da2c0affd1c2cb21f7d5ecd67aaf5138221cd367
    defineFunctionIfMissing(THREE?.Frustum?.prototype, "setFromProjectionMatrix", function (m) {
        return this.setFromMatrix(m);
    });

    // Polyfill for r113 Geometry.applyMatrix4: https://github.com/mrdoob/three.js/commit/957051a01feb7731d67fd6067a67a64d86db0965
    defineFunctionIfMissing(THREE?.Geometry?.prototype, "applyMatrix4", function applyMatrix4(m) {
        this.applyMatrix(m);
        return this;
    });

    defineFunctionIfMissing(THREE, "Interpolant", () => {});

    // Backport for r90 Line.computeLineDistances https://github.com/mrdoob/three.js/commit/4b82ecc08bc22f9684c505ce30c3594bfc3b1627
    // Copied from https://github.com/mrdoob/three.js/blob/r125/src/objects/Line.js#L46-L85
    defineFunctionIfMissing(THREE?.Line?.prototype, "computeLineDistances", function computeLineDistances() {
        const geometry = this.geometry;

        if ( geometry.isBufferGeometry ) {

            // we assume non-indexed geometry

            if ( geometry.index === null ) {

                const positionAttribute = geometry.attributes.position;
                const lineDistances = [ 0 ];

                for ( let i = 1, l = positionAttribute.count; i < l; i ++ ) {

                    _start.fromBufferAttribute( positionAttribute, i - 1 );
                    _end.fromBufferAttribute( positionAttribute, i );

                    lineDistances[ i ] = lineDistances[ i - 1 ];
                    lineDistances[ i ] += _start.distanceTo( _end );

                }

                geometry.setAttribute( 'lineDistance', new Float32BufferAttribute( lineDistances, 1 ) );

            } else {

                console.warn( 'THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.' );

            }

        } else if ( geometry.isGeometry ) {

            console.error( 'THREE.Line.computeLineDistances() no longer supports THREE.Geometry. Use THREE.BufferGeometry instead.' );

        }

        return this;

    });

    // Backport from r123: https://github.com/mrdoob/three.js/pull/20611/commits/d52afdd2ceafd690ac9e20917d0c968ff2fa7661
    defineFunctionIfMissing(THREE?.Matrix3?.prototype, "invert", function () {
        const te = this.elements,

            n11 = te[ 0 ], n21 = te[ 1 ], n31 = te[ 2 ],
            n12 = te[ 3 ], n22 = te[ 4 ], n32 = te[ 5 ],
            n13 = te[ 6 ], n23 = te[ 7 ], n33 = te[ 8 ],

            t11 = n33 * n22 - n32 * n23,
            t12 = n32 * n13 - n33 * n12,
            t13 = n23 * n12 - n22 * n13,

            det = n11 * t11 + n21 * t12 + n31 * t13;

        if ( det === 0 ) return this.set( 0, 0, 0, 0, 0, 0, 0, 0, 0 );

        const detInv = 1 / det;

        te[ 0 ] = t11 * detInv;
        te[ 1 ] = ( n31 * n23 - n33 * n21 ) * detInv;
        te[ 2 ] = ( n32 * n21 - n31 * n22 ) * detInv;

        te[ 3 ] = t12 * detInv;
        te[ 4 ] = ( n33 * n11 - n31 * n13 ) * detInv;
        te[ 5 ] = ( n31 * n12 - n32 * n11 ) * detInv;

        te[ 6 ] = t13 * detInv;
        te[ 7 ] = ( n21 * n13 - n23 * n11 ) * detInv;
        te[ 8 ] = ( n22 * n11 - n21 * n12 ) * detInv;

        return this;
    });

    // Backport from r123: https://github.com/mrdoob/three.js/pull/20611/commits/d52afdd2ceafd690ac9e20917d0c968ff2fa7661
    defineFunctionIfMissing(THREE?.Matrix4?.prototype, "invert", function () {
        // based on http://www.euclideanspace.com/maths/algebra/matrix/functions/inverse/fourD/index.htm
        const te = this.elements,

        n11 = te[ 0 ], n21 = te[ 1 ], n31 = te[ 2 ], n41 = te[ 3 ],
        n12 = te[ 4 ], n22 = te[ 5 ], n32 = te[ 6 ], n42 = te[ 7 ],
        n13 = te[ 8 ], n23 = te[ 9 ], n33 = te[ 10 ], n43 = te[ 11 ],
        n14 = te[ 12 ], n24 = te[ 13 ], n34 = te[ 14 ], n44 = te[ 15 ],

        t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44,
        t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44,
        t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44,
        t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;

        const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;

        if ( det === 0 ) return this.set( 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 );

        const detInv = 1 / det;

        te[ 0 ] = t11 * detInv;
        te[ 1 ] = ( n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44 ) * detInv;
        te[ 2 ] = ( n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44 ) * detInv;
        te[ 3 ] = ( n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43 ) * detInv;

        te[ 4 ] = t12 * detInv;
        te[ 5 ] = ( n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44 ) * detInv;
        te[ 6 ] = ( n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44 ) * detInv;
        te[ 7 ] = ( n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43 ) * detInv;

        te[ 8 ] = t13 * detInv;
        te[ 9 ] = ( n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44 ) * detInv;
        te[ 10 ] = ( n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44 ) * detInv;
        te[ 11 ] = ( n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43 ) * detInv;

        te[ 12 ] = t14 * detInv;
        te[ 13 ] = ( n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34 ) * detInv;
        te[ 14 ] = ( n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34 ) * detInv;
        te[ 15 ] = ( n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33 ) * detInv;

        return this;
    });

    definePropertySafe(THREE?.MeshPhongMaterial?.prototype, 'flatShading', {
        get: function get() { return this.shading === THREE.FlatShading; },
        set: function set(val) { this.shading = (val === true ? THREE.FlatShading : THREE.SmoothShading); }
    });

    defineFunctionIfMissing(THREE, "MeshStandardMaterial", THREE.MeshBasicMaterial);

    // Polyfill for r113 Object3D.applyMatrix4: https://github.com/mrdoob/three.js/commit/957051a01feb7731d67fd6067a67a64d86db0965
    defineFunctionIfMissing(THREE?.Object3D?.prototype, "applyMatrix4", function applyMatrix4(m) {
        return this.applyMatrix(m);
    });

    defineFunctionIfMissing(THREE, "PointsMaterial", THREE.PointCloudMaterial);

    // Polyfill for r125 Quaternion.invert: https://github.com/mrdoob/three.js/commit/8bc2e1f28c510586dcfd643b4fd9f8a1af023761
    defineFunctionIfMissing(THREE?.Quaternion?.prototype, "invert", function invert() {
        return this.inverse();
    });

    defineFunctionIfMissing(THREE?.Triangle, "getNormal", function getNormal(a, b, c, target) {
        return this.normal(a, b, c, target);
    });

    // Polyfill for r84 Vector2.fromBufferAttribute: https://github.com/mrdoob/three.js/commit/a4cf80b2c62d8348d8e13986591bcf6d3a72ce7c
    defineFunctionIfMissing(THREE?.Vector2?.prototype, "fromBufferAttribute", function fromBufferAttribute(attribute, index, offset) {
        return this.fromAttribute(attribute, index, offset);
    });
    defineFunctionIfMissing(THREE?.Vector3?.prototype, "fromBufferAttribute", function fromBufferAttribute(attribute, index, offset) {
        return this.fromAttribute(attribute, index, offset);
    });
    defineFunctionIfMissing(THREE?.Vector4?.prototype, "fromBufferAttribute", function fromBufferAttribute(attribute, index, offset) {
        return this.fromAttribute(attribute, index, offset);
    });

    // Polyfill for r73 addition of WebGLRenderTarget.texture https://github.com/mrdoob/three.js/commit/bfadabd632ace09bf5f4ae15d5f508d1a93638aa
    definePropertySafe(THREE?.WebGLRenderTarget?.prototype, 'texture', {
        get: function get() {
            return this;
        }
    });

    defineFunctionIfMissing(THREE?.Material?.prototype, "onBeforeCompile", function onBeforeCompile( /* shaderobject, renderer */ ) { 
    });
};
