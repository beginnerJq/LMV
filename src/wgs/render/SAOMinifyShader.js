// Shader used to convert the normals+depth texture into a smaller texture containing only depth
// Since it packs depth into RGBA8 target it also maps it to the range 0-1 then packs that float
// into an RGBA using magic.

import { Vector2 } from "three";
import screen_quad_vert from './shaders/screen_quad_vert.glsl';
import sao_minfirst_frag from './shaders/sao_minfirst_frag.glsl';
import sao_min_frag from './shaders/sao_min_frag.glsl';

export const SAOMinifyFirstShader = {
    uniforms: {
        tDiffuse: { type: "t", value: null }, // Initial normals+depth texture
        cameraNear: { type: "f", value: 1 },
        cameraInvNearFar: { type: "f", value: 100 },
        resolution: { type: "v2", value: new Vector2(1.0 / 512, 1.0 / 512) }, // 1/size of lower mip level
    },
    vertexShader: screen_quad_vert,
    fragmentShader: sao_minfirst_frag,
};

// Shader used to generate mip levels for the depth texture (used by the SAO shader)
export const SAOMinifyShader = {
    uniforms: {
        tDiffuse: { type: "t", value: null }, // Lower mip level
        resolution: { type: "v2", value: new Vector2(1.0 / 512, 1.0 / 512) }, // 1/size of lower mip level
    },
    vertexShader: screen_quad_vert,
    fragmentShader: sao_min_frag,

};
