/**
 * NVIDIA FXAA 3.11 by TIMOTHY LOTTES
 * "PC VERSION" Quality, ported to WebGL
 * https://gist.githubusercontent.com/bkaradzic/6011431/raw/92a3737404c0e764fa554077b16e07a46442da51/Fxaa3_11.h
 */

import * as THREE from "three";
import fxaa_vert from './shaders/fxaa_vert.glsl';
import fxaa_frag from './shaders/fxaa_frag.glsl';

export let FXAAShader = {

    uniforms: {

        "tDiffuse":   { type: "t", value: null },
        "uResolution": { type: "v2", value: new THREE.Vector2( 1 / 1024, 1 / 512 )  }
    },

    vertexShader: fxaa_vert,
    fragmentShader: fxaa_frag

};
