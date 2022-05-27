// Bilateral separable blur pass for SAO shader.
// Derived from http://g3d.cs.williams.edu/websvn/filedetails.php?repname=g3d&path=%2FG3D10%2Fdata-files%2Fshader%2FAmbientOcclusion%2FAmbientOcclusion_blur.pix
// but without the normals being used in the bilateral filter.

import { Vector2 } from "three";
import screen_quad_uv_vert from './shaders/screen_quad_uv_vert.glsl';
import sao_blur_frag from './shaders/sao_blur_frag.glsl';

export let SAOBlurShader = {
    uniforms: {
        tDiffuse: { type: "t", value: null },
        size: { type: "v2", value: new Vector2(512, 512) },
        resolution: { type: "v2", value: new Vector2(1.0 / 512, 1.0 / 512) },
        axis: { type: "v2", value: new Vector2(1, 0) },
        // Width of AO effect in native geometry units (meters or whatever).
        // Same value as passed into SAOShader.js
        radius: { type: "f", value: 50.0 },
    },
    vertexShader: screen_quad_uv_vert,
    fragmentShader: sao_blur_frag,
};
