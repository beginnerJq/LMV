import * as THREE from "three";
import line_vert from './shaders/line_vert.glsl';
import line_frag from './shaders/line_frag.glsl';

import { ShaderChunks as chunks } from "./ShaderChunks.js";

let newThreejsUniforms = [];
                               
 
                        
     
                                                           
     
    
    
 
          


export let LineShader = {

    uniforms: THREE.UniformsUtils.merge( [

        chunks.CutPlanesUniforms,
        {
            "pixelsPerUnit":     { type: "f",  value: 1.0 },
            "aaRange":           { type: "f",  value: 0.5 }, //aaRange = 0.5/pixelsPerUnit
            "tLayerMask":        { type: "t",  value: null },
            "tLineStyle":        { type: "t",  value: null },
            "vLineStyleTexSize": { type: "v2", value: new THREE.Vector2(13, 70) },
            "tRaster":           { type: "t",  value: null},
            "tSelectionTexture": { type: "t",  value: null},
            "vSelTexSize":       { type: "v2", value: new THREE.Vector2(4096, 1) },
            "displayPixelRatio": { type: "f",  value: 1.0 },
            "opacity":           { type: "f",  value: 1.0 },
            "selectionColor":    { type: "v4", value: new THREE.Vector4(0, 0, 1, 1) },
            "modelId":           { type: "v3", value : new THREE.Vector3(0,0,0) },
            "viewportId":        { type: "f",  value: 0.0 },    // the viewport id of the first selection in measure
            "swap":              { type: "f",  value: 0.0 },    // whether to swap black and white colors
            "grayscale":         { type: "f",  value: 0.0 },    // whether to render all lines in a shade of gray
            "viewportBounds":    { type: "v4", value: new THREE.Vector4(0, 0, 1, 1) },
            // objects in this layer are ghosted and non-selectable. This value must be consistent with the
            // GhostingLayer constant in FragmentList.js
            //"ghostingLayer":     { type: "v2", value: new THREE.Vector2(1,1) }

            //This is handled as special case by the renderer, like all other camera matrices
            //since it's shared between material instances
            //"mvpMatrix" : {type: "m4", value: new THREE.Matrix4() }

            //TODO: figure out how to make this cleaner
            //Scale and offset applied to vertex positions.
            //Used for getting back to page coordinates in case positions are compacted to uint16
            "unpackXform": { type: "v4", value: new THREE.Vector4(1, 1, 0, 0), perObject: true },
            //Texture containing color and dbId lookup tables
            "tIdColor": { type: "t",  value: null, perObject: true },
            "vIdColorTexSize": { type: "v2", value: new THREE.Vector2(256, 1), perObject: true  },
            "meshAnimTime": { type: "f",  value: 0.0, perObject: true },
        },
        ...newThreejsUniforms
    ]),

    vertexShader: line_vert,
    fragmentShader: line_frag
};

