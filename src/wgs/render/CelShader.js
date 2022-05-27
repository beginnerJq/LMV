import * as THREE from "three";
import { ShaderChunks as chunks } from './ShaderChunks';
import screen_quad_uv_vert from './shaders/screen_quad_uv_vert.glsl';
import cel_frag from './shaders/cel_frag.glsl';

export let CelShader = {

    uniforms: THREE.UniformsUtils.merge( [

        chunks.DepthTextureUniforms,

        {
            "tDiffuse":     { type: "t", value: null },
            "tID":          { type: "t", value: null },
            "resolution":   { type: "v2", value: new THREE.Vector2( 1 / 1024, 1 / 512 )  },
            "cameraNear":   { type: "f", value: 1 },            
            "cameraFar":    { type: "f", value: 100 },
            "tFill":        { type: "t", value: null },
            "tPaper":       { type: "t", value: null },
            "style":        { type: "i", value: 0 },
            "idEdges":      { type: "i", value: 1 },
            "normalEdges":  { type: "i", value: 1 },
            "depthEdges":   { type: "i", value: 1 },
            "brightness":   { type: "f", value: 0.0 },
            "contrast":     { type: "f", value: 0.0 },
            "grayscale":    { type: "i", value: 0 },
            "preserveColor":{ type: "i", value: 0.0 },
            "levels":       { type: "f", value: 6.0 },
            "repeats":      { type: "f", value: 3.0 },
            "rotation":     { type: "f", value: 0.0 },
            "outlineRadius":{ type: "f", value: 1.0 },
            "outlineNoise": { type: "i", value: 0.0 },
            "tGraphite1":   { type: "t", value: null },
            "tGraphite2":   { type: "t", value: null },
            "tGraphite3":   { type: "t", value: null },
            "tGraphite4":   { type: "t", value: null },
            "tGraphite5":   { type: "t", value: null },
            "tGraphite6":   { type: "t", value: null },
            "tGraphite7":   { type: "t", value: null },
            "tGraphite8":   { type: "t", value: null }
        }
    ]),

    vertexShader: screen_quad_uv_vert,
    fragmentShader: cel_frag

};
