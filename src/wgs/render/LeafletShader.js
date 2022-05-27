import * as THREE from "three";
                               
import leaflet_vert from './shaders/leaflet_vert.glsl';
import leaflet_frag from './shaders/leaflet_frag.glsl';
         
                                                               
                                                               
          

import { ShaderChunks as chunks } from "./ShaderChunks.js";

let fragmentShader;
let vertexShader;
let newThreejsUniforms = [];
                               
 
                          
         
                                                                                 
         
      

                                    
                                      
 
         
{
    vertexShader = leaflet_vert;
    fragmentShader = leaflet_frag;
}
          

export let LeafletShader = {
    uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib["common"],
        chunks.CutPlanesUniforms,
        chunks.IdUniforms,
        chunks.ThemingUniform,
        {
            selectionColor: { type: "v4", value : new THREE.Vector4(0, 0, 1, 0) },
            viewportBounds: { type: "v4", value: new THREE.Vector4(0, 0, 1, 1) },
            modelLocalMatrix: { type: "m4", value: new THREE.Matrix4() },
        },
        ...newThreejsUniforms
    ]),
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
};
