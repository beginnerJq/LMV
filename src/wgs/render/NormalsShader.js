// Also known as the depthShader, this shader computes and stores the x and y camera-space normal components and the depth.
//
// The z component of the normal can be derived, since we know it is a positive number and x^2 + y^2 + z^2 = 1.
// The depth is returned in camera space (before projection), so is relative to the world's space. It will need to be
// multiplied by the projection matrix to get the z-depth. For a perspective camera, visible values will be negative
// numbers; for an orthographic camera this is not necessarily the case.

import normals_vert from './shaders/normals_vert.glsl';
import normals_frag from './shaders/normals_frag.glsl';

export let NormalsShader = {

        uniforms: {

            //"opacity" : { type: "f", value: 1.0 }
            "cutplanes" : { type:"v4v", value: [] }
        },

    vertexShader: normals_vert,
    fragmentShader: normals_frag

};
