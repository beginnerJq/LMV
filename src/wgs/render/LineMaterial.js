import * as THREE from "three";
import { LineShader } from "./LineShader";
import { LineShaderSS } from "./LineShaderSS";

let BaseClass;
                               
{
  BaseClass = THREE.ShaderMaterial;
}
         
 
                                
 
          
export class LineMaterial extends BaseClass {
  constructor(params = {}) {
    super(params.isScreenSpace ? {
      uniforms: THREE.UniformsUtils.clone(LineShaderSS.uniforms),
      vertexShader: LineShaderSS.vertexShader,
      fragmentShader: LineShaderSS.fragmentShader
    } : {
      uniforms: THREE.UniformsUtils.clone(LineShader.uniforms),
      vertexShader: LineShader.vertexShader,
      fragmentShader: LineShader.fragmentShader
    });
    this.isScreenSpace = !!params.isScreenSpace;
    if (params.hasLineStyles) {
      this.hasLineStyles = true;
    }

    this.is2d = true;
    this.supportsViewportBounds = true;
    this.depthWrite = false;
    this.depthTest = false;
    this.side = THREE.DoubleSide;
                                   
                                                                                                                             
                             
                                         
                                           
                                                
                                         
                                                 
                                         
                                                      
             
    this.transparent = true;
    this.blending = THREE.NormalBlending;
              
    this.type = 'LMVLineMaterial';

    if (params.compositeOperation == "multiply") {
      this.blending = THREE.MultiplyBlending;
    } else if (params.compositeOperation == "min" || params.compositeOperation == "darken") {
      // See equation here: https://developer.android.com/reference/android/graphics/BlendMode#DARKEN
      // Actual equation for alpha would be `Asrc + Adst - Asrc * Adst`, but this is the closest
      // we can get with WebGL
      this.blending = THREE.CustomBlending;
      this.blendEquation = THREE.MinEquation;
      this.blendEquationAlpha = THREE.AddEquation;
      this.blendSrcAlpha = THREE.SrcAlphaFactor;
      this.blendDstAlpha = THREE.DstAlphaFactor;
    } else if (params.compositeOperation == "max" || params.compositeOperation == "lighten") {
      this.blending = THREE.CustomBlending;
      this.blendEquation = THREE.MaxEquation;
      this.blendEquationAlpha = THREE.AddEquation;
      this.blendSrcAlpha = THREE.SrcAlphaFactor;
      this.blendDstAlpha = THREE.DstAlphaFactor;
    }

  }
}