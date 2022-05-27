import * as THREE from "three";
import { ShaderChunks as chunks } from './ShaderChunks';
                               
import phong_vert from './shaders/phong_vert.glsl';
import phong_frag from './shaders/phong_frag.glsl';
         
                                                           
                                                           
          

let newThreejsUniforms = [];
let fragmentShader;
let vertexShader;
                               
{
    fragmentShader = phong_frag;
    vertexShader = phong_vert;
}
         
 
                          
                                           
                                      
                                       
                                        
         
                                                                            
         
      
                                    
                                  
 
          

export let PhongShader = {

        uniforms: THREE.UniformsUtils.merge( [

            THREE.UniformsLib[ "common" ],
            ...newThreejsUniforms,
            THREE.UniformsLib[ "bump" ],
            THREE.UniformsLib[ "normalmap" ],
            THREE.UniformsLib[ "lights" ],
            THREE.UniformsLib[ "fog" ],
            chunks.CutPlanesUniforms,
            chunks.IdUniforms,
            chunks.ThemingUniform,
            chunks.ShadowMapUniforms,
            chunks.WideLinesUniforms,
            
            {
                "emissive" : { type: "c", value: new THREE.Color( 0x000000 ) },
                "specular" : { type: "c", value: new THREE.Color( 0x111111 ) },
                "shininess": { type: "f", value: 30 },
                "reflMipIndex" : { type: "f", value: 0 },

                "texMatrix" : { type: "m3", value: new THREE.Matrix3() },
                "texMatrixBump" : { type: "m3", value: new THREE.Matrix3() },
                "texMatrixAlpha" : { type: "m3", value: new THREE.Matrix3() },

                "irradianceMap": { type : "t", value: null },
                "exposureBias" : { type:"f", value: 1.0 },
                "envMapExposure" : { type:"f", value: 1.0 },
                "envRotationSin": {type: "f", value: 0.0},
                "envRotationCos": {type: "f", value: 1.0},
            }

        ] ),

    vertexShader: vertexShader,
    fragmentShader: fragmentShader

};

THREE.ShaderLib['firefly_phong'] = PhongShader;
