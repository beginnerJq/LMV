import { defineFunctionIfMissing } from "./backport-utils";

/**
 * Polyfill for r82 THREE.OctahedronBufferGeometry
 *
 * OctahedronBufferGeometry (r82): https://github.com/mrdoob/three.js/commit/4e59e79c344dc203a0360f0c8b370d90f957bbff
 * OctahedronBufferGeometry -> OctahedronGeometry (r125): https://github.com/mrdoob/three.js/commit/7232aa40266d43e0caa128b52793574bf2c89cff
 * Copied OctahedronGeometry as OctahedronBufferGeometry from https://github.com/mrdoob/three.js/blob/r125/src/geometries/OctahedronGeometry.js
 */
export const defineOctahedronBufferGeometry = (THREE) => {
    defineFunctionIfMissing(THREE, "OctahedronBufferGeometry", class OctahedronBufferGeometry extends THREE.PolyhedronBufferGeometry {

        constructor( radius = 1, detail = 0 ) {

            const vertices = [
                1, 0, 0, 	- 1, 0, 0,	0, 1, 0,
                0, - 1, 0, 	0, 0, 1,	0, 0, - 1
            ];

            const indices = [
                0, 2, 4,	0, 4, 3,	0, 3, 5,
                0, 5, 2,	1, 2, 5,	1, 5, 3,
                1, 3, 4,	1, 4, 2
            ];

            super( vertices, indices, radius, detail );

            this.type = 'OctahedronGeometry';

            this.parameters = {
                radius: radius,
                detail: detail
            };

        }

    });
};