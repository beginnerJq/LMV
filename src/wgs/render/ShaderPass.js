import { createShaderMaterial } from './ShaderUtils';
import * as THREE from "three";

export let ShaderPass = function ( shader, textureID ) {

    this.textureID = ( textureID !== undefined ) ? textureID : "tDiffuse";

    this.material = createShaderMaterial(shader);

    // share uniforms with material
    this.uniforms = this.material.uniforms;

    this.renderToScreen = false;

    this.enabled = true;
    this.clear = false;

    this.camera = new THREE.OrthographicCamera( -1, 1, 1, -1, 0, 1 );

    // The camera is for screen-aligned rendering. So, when in AR/VR, it should always keep the
    // same and never affected by device orientation or movement.
    this.camera.disableXr = true;

    //this.quad = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), this.material );

    //Instead of using a screen quad we use a large triangle -- this is slightly
    //faster (~6% measured in our specific case), due to better cache coherency. See this article:
    //http://michaldrobot.com/2014/04/01/gcn-execution-patterns-in-full-screen-passes/
    var triangle = new THREE.BufferGeometry();
    var p = new Float32Array(9);
    p[0] = -1; p[1] = -1; p[2] = 0;
    p[3] = 3; p[4] = -1; p[5] = 0;
    p[6] = -1; p[7] = 3; p[8] = 0;

    var uv = new Float32Array(6);
    uv[0] = 0; uv[1] = 0;
    uv[2] = 2; uv[3] = 0;
    uv[4] = 0; uv[5] = 2;

    var n = new Float32Array(9);
    n[0] = 0; n[1] = 0; n[2] = 1;
    n[3] = 0; n[4] = 0; n[5] = 1;
    n[6] = 0; n[7] = 0; n[8] = 1;


    triangle.setAttribute("position", new THREE.BufferAttribute(p, 3));
    triangle.setAttribute("normal", new THREE.BufferAttribute(n, 3));
    triangle.setAttribute("uv", new THREE.BufferAttribute(uv, 2));

    this.quad = new THREE.Mesh( triangle, this.material );

    this.scene = new THREE.Scene();
    this.scene.add( this.quad );
};

ShaderPass.prototype = {

    // note: delta is not used
    render: function ( renderer, writeBuffer, readBuffer, delta ) {

        if ( this.uniforms[ this.textureID ] ) {
                                           
            {
                // Note: As long as we use the LMV WebGLRenderer that is based on old THREE, __webGLTexture is
                //       attached to the target itself. As long as that's the case, we have to set readBuffer here,
                //       not readBuffer.texture.
                this.uniforms[ this.textureID ].value = readBuffer;
            }
                     
             
                                                                           
             
                      
        }

        renderer.setRenderTarget(writeBuffer);
        if (!this.renderToScreen && this.clear) {
            renderer.clear();
        }
        
        renderer.render( this.scene, this.camera );
    }

};
