import * as THREE from "three";
import gaussian_vert from './shaders/gaussian_vert.glsl';
import gaussian_frag from './shaders/gaussian_frag.glsl';

import { ShaderPass } from './ShaderPass';

var GaussianShader = {
    uniforms: {
        tDiffuse: { type: "t", value: null },
        uColor: { type: "v4", value: new THREE.Vector4(1.0, 1.0, 1.0, 1.0) }
    },

    // defines: {
    //     KERNEL_SCALE_H:  1.0 / 64.0,
    //     KERNEL_SCALE_V:  1.0 / 64.0,
    //     KERNEL_RADIUS: 7.0
    // },

    vertexShader: gaussian_vert,
    fragmentShader: gaussian_frag
};

export let GaussianPass = function(width, height, radius, scale, params) {
    
    var _width = width;
    var _height = height;
    var _blurRadius = radius || 3.0;
    var _pixelScale = scale || 1.0;
    var _blurPassH, _blurPassV;
    var _tmptarget;

    var _params = {
        hasAlpha: params.hasAlpha || false,
        blending: params.blending || false,
        flipUV:   params.flipUV || false
    };

    // PUBLIC FUNCTIONS

    this.render = function(renderer, writeBuffer, readBuffer) {
        _blurPassH.render(renderer, _tmptarget, readBuffer);     // from readBuffer to intermediary tmp
        _blurPassV.render(renderer, writeBuffer, _tmptarget);    // tmp out to write
    };

    this.setSize = function(width, height) {
        this.cleanup();

        _width = width;
        _height = height;

        _tmptarget = new THREE.WebGLRenderTarget(width, height, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: (params.format!==undefined ? params.format : THREE.RGBAFormat),       // use RGBA by default
            type:   (params.type  !==undefined ? params.type   : THREE.UnsignedByteType), // use Uint8 by default
            stencilBuffer: false
        });
        _tmptarget.texture.generateMipmaps = false;

        _blurPassH.material.defines.KERNEL_SCALE_H = _blurPassV.material.defines.KERNEL_SCALE_H = (_pixelScale/_width).toFixed(4);
        _blurPassH.material.defines.KERNEL_SCALE_V = _blurPassV.material.defines.KERNEL_SCALE_V = (_pixelScale/_height).toFixed(4);
        _blurPassH.material.needsUpdate = _blurPassV.material.needsUpdate = true;
    };

    this.cleanup = function() {
        if (_tmptarget)
            _tmptarget.dispose();
    };

    this.setColor = function(color) {
        _blurPassV.material.uniforms.uColor.value.x = color.r;
        _blurPassV.material.uniforms.uColor.value.y = color.g;
        _blurPassV.material.uniforms.uColor.value.z = color.b;
    };

    this.setAlpha = function(alpha) {
        _blurPassV.material.uniforms.uColor.value.w = alpha;
    };

    // INITIALIZATION

    // init shader passes
    _blurPassH = new ShaderPass(GaussianShader);
    _blurPassV = new ShaderPass(GaussianShader);

    // init target
    this.setSize(width, height);

    _blurPassH.material.blending   = _blurPassV.material.blending   = THREE.NoBlending;
    _blurPassH.material.depthWrite = _blurPassV.material.depthWrite = false;
    _blurPassH.material.depthTest  = _blurPassV.material.depthTest  = false;
    _blurPassH.material.defines.HORIZONTAL = 1;

    _blurPassH.material.defines.KERNEL_RADIUS = _blurPassV.material.defines.KERNEL_RADIUS = _blurRadius.toFixed(1);

    if (_params.blending) {
        _blurPassV.material.transparent = true;
        _blurPassV.material.blending = THREE.NormalBlending;
    }

    if (_params.hasAlpha)
        _blurPassH.material.defines.HAS_ALPHA = _blurPassV.material.defines.HAS_ALPHA = "";

    if (_params.flipUV)
        _blurPassH.material.defines.FLIP_UV = "";

};
