//Replacement for the THREE BasicMaterial adding cut plane support

import * as THREE from "three";
import { ShaderChunks as chunks } from './ShaderChunks';
                               
import basic_vert from './shaders/basic_vert.glsl';
import basic_frag from './shaders/basic_frag.glsl';
         
                                                           
                                                           
          

let fragmentShader;
let vertexShader;
let newThreejsUniforms = [];
                               
 
                          
                                           
                                      
                                        
         
                                                                                 
                                                            
         
      

                                  
                                    
 
         
{
    vertexShader = basic_vert;
    fragmentShader = basic_frag;
}
          

export let BasicShader = {

    uniforms: THREE.UniformsUtils.merge( [

        THREE.UniformsLib[ "common" ],
        THREE.UniformsLib[ "fog" ],
        THREE.UniformsLib[ "shadowmap" ],
        chunks.CutPlanesUniforms,
        chunks.IdUniforms,
        chunks.ThemingUniform,
        chunks.PointSizeUniforms,
        chunks.WideLinesUniforms, 
        chunks.DepthTextureTestUniforms,
        ...newThreejsUniforms
    ] ),

    vertexShader: vertexShader,
    fragmentShader: fragmentShader
};

THREE.ShaderLib['firefly_basic'] = BasicShader;
