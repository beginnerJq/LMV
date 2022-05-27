/* Scalable Ambient Obscurance implementation based on: 
   {http://graphics.cs.williams.edu/papers/SAOHPG12/} */
// latest code as of 3/1/2016 found at
// http://g3d.cs.williams.edu/websvn/filedetails.php?repname=g3d&path=%2FG3D10%2Fdata-files%2Fshader%2FAmbientOcclusion%2FAmbientOcclusion_AO.pix

import * as THREE from "three";
import { ShaderChunks as chunks } from './ShaderChunks';
import screen_quad_uv_vert from './shaders/screen_quad_uv_vert.glsl';
import sao_frag from './shaders/sao_frag.glsl';

export let SAOShader = {

    uniforms: THREE.UniformsUtils.merge( [

        chunks.DepthTextureUniforms,

        {
            "size":         { type: "v2", value: new THREE.Vector2( 512, 512 ) },
            "resolution":   { type: "v2", value: new THREE.Vector2( 1/512, 1/512) },
            "cameraNear":   { type: "f", value: 1 },
            "cameraFar":    { type: "f", value: 100 },
            "radius":       { type: "f", value: 12.0 }, // width of AO effect in native geometry units (meters or whatever)
            "bias":         { type: "f", value: 0.1 },  // set to be 0.01 * radius for non-mobile devices, 0.1 * radius for mobile, see setAOOptions
            "projScale":    { type: "f", value: 500 },
            //"clipInfo":     { type: "v3", value: new THREE.Vector3(100, 99, -100) }, /* zf*zn, zn-zf, zf */
            "intensity":    { type: "f", value: 1.0 },  // darkness (higher is darker)

            "tDepth_mip1":       { type: "t", value: null },
            "tDepth_mip2":       { type: "t", value: null },
            "tDepth_mip3":       { type: "t", value: null },
            "tDepth_mip4":       { type: "t", value: null },
            "tDepth_mip5":       { type: "t", value: null }
        }
    ]),

    vertexShader: screen_quad_uv_vert,
    fragmentShader: sao_frag

};
