//Used for egde topology rendering

import * as THREE from "three";
import edge_vert from './shaders/edge_vert.glsl';
import edge_frag from './shaders/edge_frag.glsl';

export let EdgeShader = {

    uniforms: {
        "color" : { type: "v4", value: new THREE.Vector4(0,0,0,0.3) },
        "cutplanes" : { type:"v4v", value: [] }
    },

    vertexShader: edge_vert,
    fragmentShader: edge_frag

};
