import { defineFunctionIfMissing } from "./backport-utils";

/**
 * Polyfill for r75 THREE.BoxBufferGeometry
 * 
 * BoxBufferGeometry (r72): https://github.com/mrdoob/three.js/commit/b5ddc513c7f3e6ce592876822c46871a029dc473
 * BoxBufferGeometry -> BoxGeometry (r125): https://github.com/mrdoob/three.js/commit/7232aa40266d43e0caa128b52793574bf2c89cff
 * Copied BoxGeometry as BoxBufferGeometry from https://github.com/mrdoob/three.js/blob/r125/src/geometries/BoxGeometry.js
 * 
 * Caveats: No support for multimaterials if THREE.REVISION < 72
 */
export const defineBoxBufferGeometry = (THREE) => {
    const MATERIAL_INDEX_SUPPORTED = parseInt(THREE.REVISION) >= 72;

    defineFunctionIfMissing(THREE, "BoxBufferGeometry", class BoxBufferGeometry extends THREE.BufferGeometry {

        constructor( width = 1, height = 1, depth = 1, widthSegments = 1, heightSegments = 1, depthSegments = 1 ) {

            super();

            this.type = 'BoxGeometry';

            this.parameters = {
                width: width,
                height: height,
                depth: depth,
                widthSegments: widthSegments,
                heightSegments: heightSegments,
                depthSegments: depthSegments
            };

            const scope = this;

            // segments

            widthSegments = Math.floor( widthSegments );
            heightSegments = Math.floor( heightSegments );
            depthSegments = Math.floor( depthSegments );

            // buffers

            const indices = [];
            const vertices = [];
            const normals = [];
            const uvs = [];

            // helper variables

            let numberOfVertices = 0;
            let groupStart = 0;

            // build each side of the box geometry

            buildPlane( 'z', 'y', 'x', - 1, - 1, depth, height, width, depthSegments, heightSegments, 0 ); // px
            buildPlane( 'z', 'y', 'x', 1, - 1, depth, height, - width, depthSegments, heightSegments, 1 ); // nx
            buildPlane( 'x', 'z', 'y', 1, 1, width, depth, height, widthSegments, depthSegments, 2 ); // py
            buildPlane( 'x', 'z', 'y', 1, - 1, width, depth, - height, widthSegments, depthSegments, 3 ); // ny
            buildPlane( 'x', 'y', 'z', 1, - 1, width, height, depth, widthSegments, heightSegments, 4 ); // pz
            buildPlane( 'x', 'y', 'z', - 1, - 1, width, height, - depth, widthSegments, heightSegments, 5 ); // nz

            // build geometry

            this.setIndex( indices );
            this.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );
            this.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
            this.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );

            function buildPlane( u, v, w, udir, vdir, width, height, depth, gridX, gridY, materialIndex ) {

                const segmentWidth = width / gridX;
                const segmentHeight = height / gridY;

                const widthHalf = width / 2;
                const heightHalf = height / 2;
                const depthHalf = depth / 2;

                const gridX1 = gridX + 1;
                const gridY1 = gridY + 1;

                let vertexCounter = 0;
                let groupCount = 0;

                const vector = new THREE.Vector3();

                // generate vertices, normals and uvs

                for ( let iy = 0; iy < gridY1; iy ++ ) {

                    const y = iy * segmentHeight - heightHalf;

                    for ( let ix = 0; ix < gridX1; ix ++ ) {

                        const x = ix * segmentWidth - widthHalf;

                        // set values to correct vector component

                        vector[ u ] = x * udir;
                        vector[ v ] = y * vdir;
                        vector[ w ] = depthHalf;

                        // now apply vector to vertex buffer

                        vertices.push( vector.x, vector.y, vector.z );

                        // set values to correct vector component

                        vector[ u ] = 0;
                        vector[ v ] = 0;
                        vector[ w ] = depth > 0 ? 1 : - 1;

                        // now apply vector to normal buffer

                        normals.push( vector.x, vector.y, vector.z );

                        // uvs

                        uvs.push( ix / gridX );
                        uvs.push( 1 - ( iy / gridY ) );

                        // counters

                        vertexCounter += 1;

                    }

                }

                // indices

                // 1. you need three indices to draw a single face
                // 2. a single segment consists of two faces
                // 3. so we need to generate six (2*3) indices per segment

                for ( let iy = 0; iy < gridY; iy ++ ) {

                    for ( let ix = 0; ix < gridX; ix ++ ) {

                        const a = numberOfVertices + ix + gridX1 * iy;
                        const b = numberOfVertices + ix + gridX1 * ( iy + 1 );
                        const c = numberOfVertices + ( ix + 1 ) + gridX1 * ( iy + 1 );
                        const d = numberOfVertices + ( ix + 1 ) + gridX1 * iy;

                        // faces

                        indices.push( a, b, d );
                        indices.push( b, c, d );

                        // increase counter

                        groupCount += 6;

                    }

                }

                // add a group to the geometry. this will ensure multi material support

                if (!MATERIAL_INDEX_SUPPORTED)
                    materialIndex = 0;
                scope.addGroup( groupStart, groupCount, materialIndex );

                // calculate new start value for groups

                groupStart += groupCount;

                // update total number of vertices

                numberOfVertices += vertexCounter;

            }

        }

    });
};