import { defineFunctionIfMissing } from "./backport-utils";

/**
 * Polyfill for r75 THREE.TorusBufferGeometry
 * TorusBufferGeometry (r75): https://github.com/mrdoob/three.js/commit/e6630e5f430e694e6fe38870bfea9179b1a96e30
 * TorusBufferGeometry -> TorusGeometry (r125): https://github.com/mrdoob/three.js/commit/7232aa40266d43e0caa128b52793574bf2c89cff
 * Copied TorusGeometry as TorusBufferGeometry from https://github.com/mrdoob/three.js/blob/r125/src/geometries/TorusGeometry.js
 */
export const defineTorusBufferGeometry = (THREE) => {
    defineFunctionIfMissing(THREE, "TorusBufferGeometry", class TorusBufferGeometry extends THREE.BufferGeometry {

        constructor( radius = 1, tube = 0.4, radialSegments = 8, tubularSegments = 6, arc = Math.PI * 2 ) {

            super();
            this.type = 'TorusGeometry';

            this.parameters = {
                radius: radius,
                tube: tube,
                radialSegments: radialSegments,
                tubularSegments: tubularSegments,
                arc: arc
            };

            radialSegments = Math.floor( radialSegments );
            tubularSegments = Math.floor( tubularSegments );

            // buffers

            const indices = [];
            const vertices = [];
            const normals = [];
            const uvs = [];

            // helper variables

            const center = new THREE.Vector3();
            const vertex = new THREE.Vector3();
            const normal = new THREE.Vector3();

            // generate vertices, normals and uvs

            for ( let j = 0; j <= radialSegments; j ++ ) {

                for ( let i = 0; i <= tubularSegments; i ++ ) {

                    const u = i / tubularSegments * arc;
                    const v = j / radialSegments * Math.PI * 2;

                    // vertex

                    vertex.x = ( radius + tube * Math.cos( v ) ) * Math.cos( u );
                    vertex.y = ( radius + tube * Math.cos( v ) ) * Math.sin( u );
                    vertex.z = tube * Math.sin( v );

                    vertices.push( vertex.x, vertex.y, vertex.z );

                    // normal

                    center.x = radius * Math.cos( u );
                    center.y = radius * Math.sin( u );
                    normal.subVectors( vertex, center ).normalize();

                    normals.push( normal.x, normal.y, normal.z );

                    // uv

                    uvs.push( i / tubularSegments );
                    uvs.push( j / radialSegments );

                }

            }

            // generate indices

            for ( let j = 1; j <= radialSegments; j ++ ) {

                for ( let i = 1; i <= tubularSegments; i ++ ) {

                    // indices

                    const a = ( tubularSegments + 1 ) * j + i - 1;
                    const b = ( tubularSegments + 1 ) * ( j - 1 ) + i - 1;
                    const c = ( tubularSegments + 1 ) * ( j - 1 ) + i;
                    const d = ( tubularSegments + 1 ) * j + i;

                    // faces

                    indices.push( a, b, d );
                    indices.push( b, c, d );

                }

            }

            // build geometry

            this.setIndex( indices );
            this.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );
            this.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
            this.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );

        }

    });
};

