import * as THREE from "three";
import { EventDispatcher } from '../../application/EventDispatcher';
import { MeshFlags } from '../scene/MeshFlags';
import { WebGLRenderer } from './WebGLRenderer';

export const Events = {
  WEBGL_CONTEXT_LOST: 'webglcontextlost',
  WEBGL_CONTEXT_RESTORED: 'webglcontextrestored'
};
let BaseClass;
                               
{
  BaseClass = WebGLRenderer;
}
         
 
                                  
 
          


export class LMVRenderer extends BaseClass {
  #animationFrameCallbacks;
  #parentRender;
  #parentSetRenderTarget;
  #threeMRTMap;
                                 
                 
            
                                   
            

  constructor(params = {}) {
    super(params);

                                   
                                         
              

    params.canvas?.addEventListener('webglcontextlost', () => {
      this.fireEvent({ type: Events.WEBGL_CONTEXT_LOST });
    });
    params.canvas?.addEventListener('webglcontextrestored', () => {
      this.fireEvent({ type: Events.WEBGL_CONTEXT_RESTORED });
    });
    this.refCount = 0;

    this.#animationFrameCallbacks = [];
    this.loadingAnimationDuration = -1;
    this.highResTimeStamp = -1;
    // render function is not part of the prototype but is assigned when instantiating the base class, that
    // is why we re-assign the render function
    this.#parentRender = this.render;
    this.#parentSetRenderTarget = this.setRenderTarget;
    this.render = LMVRenderer.prototype.render.bind(this);
    this.setRenderTarget = LMVRenderer.prototype.setRenderTarget.bind(this);

                                   
                             
                                         
                                        
                                                   
                           
              
  }

  /**
   * @public
   * @returns {boolean} True if multiple render targets is supported in the current browser
   */
  supportsMRT() {
    return this.capabilities.isWebGL2 || this.extensions.get('WEBGL_draw_buffers');
  }

  /**
   * Note: We might think of deleting this as this seems to be a workaround for browsers that only support WebGL and
   * are different than IE11
   * @public
   * We need to use more than WebGL 1.0 technically allows -- we use
   * different bit depth sizes for the render targets, which is not
   * legal WebGL 1.0, but will work eventually and some platforms/browsers
   * already allow it. For others, we have to try, check for failure, and disable use of MRT dynamically. 
   * @return {boolean}
   */
  verifyMRTWorks(renderTargets) {
    let isMRTWorking = false;
    if (this.supportsMRT()) {
                                     
      {
        isMRTWorking = this.initFrameBufferMRT(renderTargets, true);
      }
               
       
                            
       
                
    }
    return isMRTWorking;
  }


  updateTimestamp(highResTimeStamp) {
    return this.highResTimeStamp = highResTimeStamp;
  }

  getLoadingAnimationDuration() {
    return this.loadingAnimationDuration;
  }

  setLoadingAnimationDuration(duration) {
    return this.loadingAnimationDuration = duration;
  }

  addAnimationLoop(callback) {
    this.#animationFrameCallbacks.push(callback);
    this.setAnimationLoop((time) => {
      for (let cb of this.#animationFrameCallbacks) {
        cb(time);
      }
    });
  }

  removeAnimationLoop(callback) {
    for (let i = 0; i < this.#animationFrameCallbacks.length; ++i) {
      if (this.#animationFrameCallbacks[i] === callback) {
        this.#animationFrameCallbacks.splice(i, 1);
        break;
      }
    }
    if (this.#animationFrameCallbacks.length === 0) {
      this.setAnimationLoop(null);
    }
  }

  clearBlend() {
    this.state.setBlending(THREE.NoBlending);
  }

  isWebGL2() {
    console.warn('LMVRenderer: .isWebGL2() has been deprecated. Use .capabilities.isWebGL2 instead.');
    return this.capabilities.isWebGL2;
  }

  _renderLMVRenderable(scene, camera) {
    if (scene.isScene) {
      this.#parentRender(scene, camera);
    } else {
      // RenderBatch
      // Here, we use the MESH_RENDERABLE flag to account for the check in the old WebGLRenrerer
      // https://git.autodesk.com/A360/firefly.js/blob/develop/src/wgs/render/WebGLRenderer.js#L3389
      // In the other case, the WebGLRenderer uses a simple for each
      scene.forEach((mesh) => {
        const oldMeshMaterial = mesh.material;
        if (scene.overrideMaterial) {
          mesh.material = scene.overrideMaterial;
        }
        this.#parentRender(mesh, camera);
        mesh.material = oldMeshMaterial;
      }, scene.renderImmediate ? (scene.forceVisible ? MeshFlags.MESH_VISIBLE : MeshFlags.MESH_RENDERFLAG) : undefined);
    }
  }

  /**
   * @overrride
   * @param {THREE.Scene|RenderBatch} scene
   * @param {THREE.Camera|Array<THREE.Camera>} camera
   * @param {Array<THREE.Light>} lights
   */
  render(scene, camera, lights) {
                                   
    {
      this.#parentRender(scene, camera, false, lights);
    }
             
     
                                               

                               
                                                        
                                                    
                                                 
                                                  
       
     
              
  }

  /**
   * @overrride
   * @param {THREE.WebGLRenderTarget|Array<THREE.WebGLRenderTarget>} renderTarget
   */
  setRenderTarget(renderTarget) {
                                   
    {
      this.#parentSetRenderTarget(renderTarget);
    }
             
     

                                                                   
                                                                          
                                              
                                                                                                                  
                                                                                                                                  
                              
                                                         
                                                          
           
                                                               
         
                                                     
                                                 
                                              
                                                
                                                 
                
                                                
         
              
                                                                     
                                                     
                                                  
                                                    
                                                     
                
                                                    
         
       
     
              
  }

                                 
       
                                                                                 
                               
                                              
                                                   
                                                                          
       
                                           
                                       
                                        
                                                                                                    
                                                                                                         

                                           
                                                                       
                                                       
                                                 
        
      
                                        
     

                                
                                                                                           
     

                                               
                                                       
     

                                                                                                     
                    
                                       
                                                 
                                                 
                                                 
                                                 
     

                                             
                   
                                                   
      
                                                  
                                     
                                     
                                    
        

                                         
     

                               
                                                                                         
     

            
}

EventDispatcher.prototype.apply(LMVRenderer.prototype);
LMVRenderer.Events = Events;