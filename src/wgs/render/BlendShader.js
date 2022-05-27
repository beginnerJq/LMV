// Shader that composes a final frame from the color target, SAO target, and overlays target.
import * as THREE from "three";
import { ShaderChunks as chunks } from './ShaderChunks';
import screen_quad_uv_vert from './shaders/screen_quad_uv_vert.glsl';
import blend_frag from './shaders/blend_frag.glsl';

// defines: {
//     USE_MODEL_ID
// }

export let BlendShader = {

    uniforms: THREE.UniformsUtils.merge( [

        chunks.DepthTextureUniforms,

        {
            "tDiffuse": { type: "t", value: null }, //Color buffer containing the rendered 3d model

            "tAO": {type: "t", value:null }, //Ambient occlusion + depth buffer
            "useAO": {type: "i", value: 0 }, //Whether to blend in the AO buffer
            "aoOpacity": {type: "f", value: 0.625}, //"Transparency" of the AO shadow -- used to reduce AO occlusion intensity globally in a linear way

            "tOverlay" : { type: "t", value: null}, //The selection/overlays buffer
            "useOverlay" : { type: "i", value:0 }, //Whether to blend in the overlays
            "useOverlayAlpha" : { type: "i", value: 1}, //Whether the blend fragment shader should use the alpha of the overlay target. This is turned on by default.

            "tID" : { type: "t", value: null }, //The ID buffer
            "tID2" : { type: "t", value: null }, //The model ID buffer
            "objIDv4" : {type : "v4", value: new THREE.Vector4(0,0,0,0) }, //The currently highlighted object ID as RGBA
            "modelIDv2" : {type : "v2", value: new THREE.Vector2(0,0) }, //The currently highlighted model ID as RG
            "modelIDsv2v" : {type : "v2v", value: [] },                  //Replaces modelIdv2 if multiple models are highlighted
            "edgeObjIDv4": {type : "v4", value: new THREE.Vector4(0,0,0,0) }, //The currently selected object ID as RGBA
            "edgeModelIDv2": {type : "v2", value: new THREE.Vector2(0,0) }, //The currently selected object model ID as RG
            "highlightIntensity" : { type : "f", value: 1.0 },
            "highlightColor" : { type : "c", value: new THREE.Color(1,1,1) },

            "resolution": { type: "v2", value: new THREE.Vector2( 1 / 1024, 1 / 512 )  }, // 1/size

            //Enable these if the forward pass renders in HDR-linear target and the Blend shader is doing the tone mapping
            //"exposureBias" : { type:"f", value: 1.0 },
            //"toneMapMethod" : { type:"i", value: 0 }

            "selectionColor": { type: "c", value: new THREE.Color(0,0,0) }, // The current highlight color
            "expand2dSelection": { type: "f", value: 0.5 }, // amount to expand 2d selection, 0.0 to 1.0

            // optional: blending between different targets/RenderModels
            "tCrossFadeTex0":    { type: "t", value: null}, // Additional color buffers with separate content
            "tCrossFadeTex1":    { type: "t", value: null}, // ..
            "crossFadeOpacity0": { type: "f", value:0.0 }, // opacity of crossFade tex 0
            "crossFadeOpacity1": { type: "f", value:0.0 }, // opacity of crossFade tex 1

            "highlightFullModel": { type: "f", value:0.0 } // either 0.0 or 1.0. For 1.0, objectID is ignored.
        }
    ]),

    vertexShader: screen_quad_uv_vert,
    fragmentShader: blend_frag

};
