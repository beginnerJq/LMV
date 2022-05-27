//Trivial copy pass

import screen_quad_uv_vert from './shaders/screen_quad_uv_vert.glsl';
import copy_frag from './shaders/copy_frag.glsl';

export let CopyShader = {

    uniforms: {
        "tDiffuse": { type: "t", value: null }
    },

    vertexShader: screen_quad_uv_vert,
    fragmentShader: copy_frag

};
