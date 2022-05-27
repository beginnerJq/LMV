/**
 * @author mrdoob / http://mrdoob.com/
 * @author supereggbert / http://www.paulbrunt.co.uk/
 * @author philogb / http://blog.thejit.org/
 * @author jordi_ros / http://plattsoft.com
 * @author D1plo1d / http://github.com/D1plo1d
 * @author alteredq / http://alteredqualia.com/
 * @author mikael emtinger / http://gomo.se/
 * @author timknip / http://www.floorplanner.com/
 * @author bhouston / http://exocortex.com
 * @author WestLangley / http://github.com/WestLangley
 */
/* Pruned version of THREE.Matrix4, for use in the LMV web worker */

import { LmvVector3 } from './LmvVector3';

export let LmvMatrix4 = function (useDoublePrecision) {

    if (useDoublePrecision) {

        this.elements = new Float64Array( [

            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1

        ] );

    } else {

        this.elements = new Float32Array( [

            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1

        ] );

    }

    this.isDoublePrecision = !!useDoublePrecision;

};

LmvMatrix4.prototype = {

    constructor: LmvMatrix4,

    set: function ( n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44 ) {

        var te = this.elements;

        te[ 0 ] = n11; te[ 4 ] = n12; te[ 8 ] = n13; te[ 12 ] = n14;
        te[ 1 ] = n21; te[ 5 ] = n22; te[ 9 ] = n23; te[ 13 ] = n24;
        te[ 2 ] = n31; te[ 6 ] = n32; te[ 10 ] = n33; te[ 14 ] = n34;
        te[ 3 ] = n41; te[ 7 ] = n42; te[ 11 ] = n43; te[ 15 ] = n44;

        return this;

    },

    identity: function () {

        this.set(

            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1

        );

        return this;

    },

    copy: function ( m ) {

        this.elements.set( m.elements );

        return this;

    },

    makeRotationFromQuaternion: function ( q ) {

        var te = this.elements;

        var x = q.x, y = q.y, z = q.z, w = q.w;
        var x2 = x + x, y2 = y + y, z2 = z + z;
        var xx = x * x2, xy = x * y2, xz = x * z2;
        var yy = y * y2, yz = y * z2, zz = z * z2;
        var wx = w * x2, wy = w * y2, wz = w * z2;

        te[ 0 ] = 1 - ( yy + zz );
        te[ 4 ] = xy - wz;
        te[ 8 ] = xz + wy;

        te[ 1 ] = xy + wz;
        te[ 5 ] = 1 - ( xx + zz );
        te[ 9 ] = yz - wx;

        te[ 2 ] = xz - wy;
        te[ 6 ] = yz + wx;
        te[ 10 ] = 1 - ( xx + yy );

        // last column
        te[ 3 ] = 0;
        te[ 7 ] = 0;
        te[ 11 ] = 0;

        // bottom row
        te[ 12 ] = 0;
        te[ 13 ] = 0;
        te[ 14 ] = 0;
        te[ 15 ] = 1;

        return this;

    },

    multiply: function ( n ) {

        return this.multiplyMatrices( this, n );

    },

    multiplyMatrices: function ( a, b ) {

        var ae = a.elements;
        var be = b.elements;
        var te = this.elements;

        var a11 = ae[ 0 ], a12 = ae[ 4 ], a13 = ae[ 8 ], a14 = ae[ 12 ];
        var a21 = ae[ 1 ], a22 = ae[ 5 ], a23 = ae[ 9 ], a24 = ae[ 13 ];
        var a31 = ae[ 2 ], a32 = ae[ 6 ], a33 = ae[ 10 ], a34 = ae[ 14 ];
        var a41 = ae[ 3 ], a42 = ae[ 7 ], a43 = ae[ 11 ], a44 = ae[ 15 ];

        var b11 = be[ 0 ], b12 = be[ 4 ], b13 = be[ 8 ], b14 = be[ 12 ];
        var b21 = be[ 1 ], b22 = be[ 5 ], b23 = be[ 9 ], b24 = be[ 13 ];
        var b31 = be[ 2 ], b32 = be[ 6 ], b33 = be[ 10 ], b34 = be[ 14 ];
        var b41 = be[ 3 ], b42 = be[ 7 ], b43 = be[ 11 ], b44 = be[ 15 ];

        te[ 0 ] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
        te[ 4 ] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
        te[ 8 ] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
        te[ 12 ] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;

        te[ 1 ] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
        te[ 5 ] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
        te[ 9 ] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
        te[ 13 ] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;

        te[ 2 ] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
        te[ 6 ] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
        te[ 10 ] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
        te[ 14 ] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;

        te[ 3 ] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
        te[ 7 ] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
        te[ 11 ] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
        te[ 15 ] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;

        return this;

    },

    multiplyToArray: function ( a, b, r ) {

        var te = this.elements;

        this.multiplyMatrices( a, b );

        r[ 0 ] = te[ 0 ]; r[ 1 ] = te[ 1 ]; r[ 2 ] = te[ 2 ]; r[ 3 ] = te[ 3 ];
        r[ 4 ] = te[ 4 ]; r[ 5 ] = te[ 5 ]; r[ 6 ] = te[ 6 ]; r[ 7 ] = te[ 7 ];
        r[ 8 ]  = te[ 8 ]; r[ 9 ]  = te[ 9 ]; r[ 10 ] = te[ 10 ]; r[ 11 ] = te[ 11 ];
        r[ 12 ] = te[ 12 ]; r[ 13 ] = te[ 13 ]; r[ 14 ] = te[ 14 ]; r[ 15 ] = te[ 15 ];

        return this;

    },

    multiplyScalar: function ( s ) {

        var te = this.elements;

        te[ 0 ] *= s; te[ 4 ] *= s; te[ 8 ] *= s; te[ 12 ] *= s;
        te[ 1 ] *= s; te[ 5 ] *= s; te[ 9 ] *= s; te[ 13 ] *= s;
        te[ 2 ] *= s; te[ 6 ] *= s; te[ 10 ] *= s; te[ 14 ] *= s;
        te[ 3 ] *= s; te[ 7 ] *= s; te[ 11 ] *= s; te[ 15 ] *= s;

        return this;

    },

    determinant: function () {

        var te = this.elements;

        var n11 = te[ 0 ], n12 = te[ 4 ], n13 = te[ 8 ], n14 = te[ 12 ];
        var n21 = te[ 1 ], n22 = te[ 5 ], n23 = te[ 9 ], n24 = te[ 13 ];
        var n31 = te[ 2 ], n32 = te[ 6 ], n33 = te[ 10 ], n34 = te[ 14 ];
        var n41 = te[ 3 ], n42 = te[ 7 ], n43 = te[ 11 ], n44 = te[ 15 ];

        //TODO: make this more efficient
        //( based on http://www.euclideanspace.com/maths/algebra/matrix/functions/inverse/fourD/index.htm )

        return (
            n41 * (
                + n14 * n23 * n32
                 - n13 * n24 * n32
                 - n14 * n22 * n33
                 + n12 * n24 * n33
                 + n13 * n22 * n34
                 - n12 * n23 * n34
            ) +
            n42 * (
                + n11 * n23 * n34
                 - n11 * n24 * n33
                 + n14 * n21 * n33
                 - n13 * n21 * n34
                 + n13 * n24 * n31
                 - n14 * n23 * n31
            ) +
            n43 * (
                + n11 * n24 * n32
                 - n11 * n22 * n34
                 - n14 * n21 * n32
                 + n12 * n21 * n34
                 + n14 * n22 * n31
                 - n12 * n24 * n31
            ) +
            n44 * (
                - n13 * n22 * n31
                 - n11 * n23 * n32
                 + n11 * n22 * n33
                 + n13 * n21 * n32
                 - n12 * n21 * n33
                 + n12 * n23 * n31
            )

        );

    },

    transpose: function () {

        var te = this.elements;
        var tmp;

        tmp = te[ 1 ]; te[ 1 ] = te[ 4 ]; te[ 4 ] = tmp;
        tmp = te[ 2 ]; te[ 2 ] = te[ 8 ]; te[ 8 ] = tmp;
        tmp = te[ 6 ]; te[ 6 ] = te[ 9 ]; te[ 9 ] = tmp;

        tmp = te[ 3 ]; te[ 3 ] = te[ 12 ]; te[ 12 ] = tmp;
        tmp = te[ 7 ]; te[ 7 ] = te[ 13 ]; te[ 13 ] = tmp;
        tmp = te[ 11 ]; te[ 11 ] = te[ 14 ]; te[ 14 ] = tmp;

        return this;

    },

    flattenToArrayOffset: function ( array, offset ) {

        var te = this.elements;

        array[ offset     ] = te[ 0 ];
        array[ offset + 1 ] = te[ 1 ];
        array[ offset + 2 ] = te[ 2 ];
        array[ offset + 3 ] = te[ 3 ];

        array[ offset + 4 ] = te[ 4 ];
        array[ offset + 5 ] = te[ 5 ];
        array[ offset + 6 ] = te[ 6 ];
        array[ offset + 7 ] = te[ 7 ];

        array[ offset + 8 ]  = te[ 8 ];
        array[ offset + 9 ]  = te[ 9 ];
        array[ offset + 10 ] = te[ 10 ];
        array[ offset + 11 ] = te[ 11 ];

        array[ offset + 12 ] = te[ 12 ];
        array[ offset + 13 ] = te[ 13 ];
        array[ offset + 14 ] = te[ 14 ];
        array[ offset + 15 ] = te[ 15 ];

        return array;

    },

    setPosition: function ( v ) {

        var te = this.elements;

        te[ 12 ] = v.x;
        te[ 13 ] = v.y;
        te[ 14 ] = v.z;

        return this;

    },

    invert: function ( m ) {
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
    },

    getInverse: function ( m, throwOnInvertible ) {
        console.warn('LmvMatrix4.getInverse() has been removed. Use matrixInv.copy( matrix ).invert(); instead.');
        this.copy(m).invert();

        // Pre-invert behavior
        if (this.determinant() ===  0) {
            const msg = "Matrix4.getInverse(): can't invert matrix, determinant is 0";
            if ( throwOnInvertible || false ) {
                throw new Error( msg );
            } else {
                console.warn( msg );
            }
            this.identity();
        }
        return this;
    },

    scale: function ( v ) {

        var te = this.elements;
        var x = v.x, y = v.y, z = v.z;

        te[ 0 ] *= x; te[ 4 ] *= y; te[ 8 ] *= z;
        te[ 1 ] *= x; te[ 5 ] *= y; te[ 9 ] *= z;
        te[ 2 ] *= x; te[ 6 ] *= y; te[ 10 ] *= z;
        te[ 3 ] *= x; te[ 7 ] *= y; te[ 11 ] *= z;

        return this;

    },

    getMaxScaleOnAxis: function () {

        var te = this.elements;

        var scaleXSq = te[ 0 ] * te[ 0 ] + te[ 1 ] * te[ 1 ] + te[ 2 ] * te[ 2 ];
        var scaleYSq = te[ 4 ] * te[ 4 ] + te[ 5 ] * te[ 5 ] + te[ 6 ] * te[ 6 ];
        var scaleZSq = te[ 8 ] * te[ 8 ] + te[ 9 ] * te[ 9 ] + te[ 10 ] * te[ 10 ];

        return Math.sqrt( Math.max( scaleXSq, Math.max( scaleYSq, scaleZSq ) ) );

    },

    makeTranslation: function ( x, y, z ) {

        this.set(

            1, 0, 0, x,
            0, 1, 0, y,
            0, 0, 1, z,
            0, 0, 0, 1

        );

        return this;

    },

    makeRotationX: function ( theta ) {

        var c = Math.cos( theta ), s = Math.sin( theta );

        this.set(

            1, 0,  0, 0,
            0, c, - s, 0,
            0, s,  c, 0,
            0, 0,  0, 1

        );

        return this;

    },

    makeRotationY: function ( theta ) {

        var c = Math.cos( theta ), s = Math.sin( theta );

        this.set(

             c, 0, s, 0,
             0, 1, 0, 0,
            - s, 0, c, 0,
             0, 0, 0, 1

        );

        return this;

    },

    makeRotationZ: function ( theta ) {

        var c = Math.cos( theta ), s = Math.sin( theta );

        this.set(

            c, - s, 0, 0,
            s,  c, 0, 0,
            0,  0, 1, 0,
            0,  0, 0, 1

        );

        return this;

    },

    makeRotationAxis: function ( axis, angle ) {

        // Based on http://www.gamedev.net/reference/articles/article1199.asp

        var c = Math.cos( angle );
        var s = Math.sin( angle );
        var t = 1 - c;
        var x = axis.x, y = axis.y, z = axis.z;
        var tx = t * x, ty = t * y;

        this.set(

            tx * x + c, tx * y - s * z, tx * z + s * y, 0,
            tx * y + s * z, ty * y + c, ty * z - s * x, 0,
            tx * z - s * y, ty * z + s * x, t * z * z + c, 0,
            0, 0, 0, 1

        );

         return this;

    },

    makeScale: function ( x, y, z ) {

        this.set(

            x, 0, 0, 0,
            0, y, 0, 0,
            0, 0, z, 0,
            0, 0, 0, 1

        );

        return this;

    },

    compose: function ( position, quaternion, scale ) {

        this.makeRotationFromQuaternion( quaternion );
        this.scale( scale );
        this.setPosition( position );

        return this;

    },

    decompose: function () {

        var vector = new LmvVector3();
        var matrix = new LmvMatrix4(true);

        return function ( position, quaternion, scale ) {

            var te = this.elements;

            var sx = vector.set( te[ 0 ], te[ 1 ], te[ 2 ] ).length();
            var sy = vector.set( te[ 4 ], te[ 5 ], te[ 6 ] ).length();
            var sz = vector.set( te[ 8 ], te[ 9 ], te[ 10 ] ).length();

            // if determine is negative, we need to invert one scale
            var det = this.determinant();
            if ( det < 0 ) {
                sx = - sx;
            }

            position.x = te[ 12 ];
            position.y = te[ 13 ];
            position.z = te[ 14 ];

            // scale the rotation part

            matrix.elements.set( this.elements ); // at this point matrix is incomplete so we can't use .copy()

            var invSX = 1 / sx;
            var invSY = 1 / sy;
            var invSZ = 1 / sz;

            matrix.elements[ 0 ] *= invSX;
            matrix.elements[ 1 ] *= invSX;
            matrix.elements[ 2 ] *= invSX;

            matrix.elements[ 4 ] *= invSY;
            matrix.elements[ 5 ] *= invSY;
            matrix.elements[ 6 ] *= invSY;

            matrix.elements[ 8 ] *= invSZ;
            matrix.elements[ 9 ] *= invSZ;
            matrix.elements[ 10 ] *= invSZ;

            quaternion.setFromRotationMatrix( matrix );

            scale.x = sx;
            scale.y = sy;
            scale.z = sz;

            return this;

        };

    }(),

    //Added for LMV
    transformPoint: function (pt) {

            // input: THREE.Matrix4 affine matrix

            var x = pt.x, y = pt.y, z = pt.z;

            var e = this.elements;

            pt.x = e[ 0 ] * x + e[ 4 ] * y + e[ 8 ]  * z + e[ 12 ];
            pt.y = e[ 1 ] * x + e[ 5 ] * y + e[ 9 ]  * z + e[ 13 ];
            pt.z = e[ 2 ] * x + e[ 6 ] * y + e[ 10 ] * z + e[ 14 ];

            return pt;
    },

    //Added for LMV
    transformDirection: function(v) {

            // input: THREE.Matrix4 affine matrix
            // vector interpreted as a direction

            var x = v.x, y = v.y, z = v.z;

            var e = this.elements;

            v.x = e[ 0 ] * x + e[ 4 ] * y + e[ 8 ]  * z;
            v.y = e[ 1 ] * x + e[ 5 ] * y + e[ 9 ]  * z;
            v.z = e[ 2 ] * x + e[ 6 ] * y + e[ 10 ] * z;

            var len = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
            if (len > 0) {
                var ilen = 1.0 / len;
                v.x *= ilen;
                v.y *= ilen;
                v.z *= ilen;
            }

            return v;
    },

    equals( matrix ) {

        const te = this.elements;
        const me = matrix.elements;

        for ( var i = 0; i < 16; i ++ ) {

            if ( te[ i ] !== me[ i ] ) return false;

        }

        return true;

    },
    
    fromArray: function ( array ) {

        this.elements.set( array );

        return this;

    },

    toArray: function () {

        var te = this.elements;

        return [
            te[ 0 ], te[ 1 ], te[ 2 ], te[ 3 ],
            te[ 4 ], te[ 5 ], te[ 6 ], te[ 7 ],
            te[ 8 ], te[ 9 ], te[ 10 ], te[ 11 ],
            te[ 12 ], te[ 13 ], te[ 14 ], te[ 15 ]
        ];

    },

    clone: function () {

        return new LmvMatrix4(this.isDoublePrecision).fromArray( this.elements );

    }

};
