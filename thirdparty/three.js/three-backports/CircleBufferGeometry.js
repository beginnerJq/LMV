import { defineFunctionIfMissing } from "./backport-utils";

/**
 * Polyfill for r72 THREE.CircleBufferGeometry
 * 
 * CircleBufferGeometry (r72): https://github.com/mrdoob/three.js/commit/c94cb5fe669285840ccdd06002c960f1eecde0a4
 * CircleBufferGeometry -> CircleGeometry (r125): https://github.com/mrdoob/three.js/commit/7232aa40266d43e0caa128b52793574bf2c89cff
 * Copied CircleGeometry as CircleBufferGeometry from https://github.com/mrdoob/three.js/blob/r125/src/geometries/CircleGeometry.js
 */
export const defineCircleBufferGeometry = (THREE) => {
    defineFunctionIfMissing(THREE, "CircleBufferGeometry",
        class CircleBufferGeometry extends THREE.BufferGeometry {
            constructor( radius = 1, segments = 8, thetaStart = 0, thetaLength = Math.PI * 2 ) {

                super();

                this.type = 'CircleGeometry';

                this.parameters = {
                    radius: radius,
                    segments: segments,
                    thetaStart: thetaStart,
                    thetaLength: thetaLength
                };

                segments = Math.max( 3, segments );

                // buffers

                const indices = [];
                const vertices = [];
                const normals = [];
                const uvs = [];

                // helper variables

                const vertex = new THREE.Vector3();
                const uv = new THREE.Vector2();

                // center point

                vertices.push( 0, 0, 0 );
                normals.push( 0, 0, 1 );
                uvs.push( 0.5, 0.5 );

                for ( let s = 0, i = 3; s <= segments; s ++, i += 3 ) {

                    const segment = thetaStart + s / segments * thetaLength;

                    // vertex

                    vertex.x = radius * Math.cos( segment );
                    vertex.y = radius * Math.sin( segment );

                    vertices.push( vertex.x, vertex.y, vertex.z );

                    // normal

                    normals.push( 0, 0, 1 );

                    // uvs

                    uv.x = ( vertices[ i ] / radius + 1 ) / 2;
                    uv.y = ( vertices[ i + 1 ] / radius + 1 ) / 2;

                    uvs.push( uv.x, uv.y );

                }

                // indices

                for ( let i = 1; i <= segments; i ++ ) {

                    indices.push( i, i + 1, 0 );

                }

                // build geometry

                this.setIndex( indices );
                this.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3));
                this.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ));
                this.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ));
            }
        }
    );
};