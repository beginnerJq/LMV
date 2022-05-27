import * as THREE from "three";
import background_vert from './shaders/background_vert.glsl';
import background_frag from './shaders/background_frag.glsl';

export let BackgroundShader = {

    uniforms: {
        "color1": {type: "v3", value: new THREE.Vector3(41.0/255.0, 76.0/255.0, 120.0/255.0) },
        "color2": {type: "v3", value: new THREE.Vector3( 1.0/255.0,  2.0/255.0,   3.0/255.0) },
        "opacity": {type: "f", value: 1.0 },
        //"irradianceMap": {type: "t", value: 1.0},
        "envMap": {type: "t", value: null},
        "envRotationSin": {type: "f", value: 0.0},
        "envRotationCos": {type: "f", value: 1.0},
        "exposureBias" : { type:"f", value: 1.0 },
        "envMapExposure" : { type:"f", value: 1.0 },
        "uCamDir": {type: "v3", value: new THREE.Vector3() },
        "uCamUp": {type: "v3", value: new THREE.Vector3() },
        "uResolution": {type: "v2", value: new THREE.Vector2(600, 400) },
        "uHalfFovTan": {type: "f", value: 0.5},
        "envMapBackground": { type: "i", value: 0 },
        "backgroundTexture": {type: "t", value: null},

    },

    vertexShader: background_vert,
    fragmentShader: background_frag

};
