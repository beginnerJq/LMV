'use strict';

import * as THREE from "three";
import { getGlobal, isIE11, isMobileDevice, isNodeJS } from "../../compat";
import { ErrorCodes, errorCodeString } from "../../file-loaders/net/ErrorCodes";
import { logger } from "../../logger/Logger";
import { BackgroundShader } from "./BackgroundShader";
import { BlendShader } from "./BlendShader";
import { CopyShader } from "./CopyShader";
import { FXAAShader } from "./FXAAShader";
import { createDepthMaterial, createDepthTarget, createEdgeMaterial, createIdTarget, cubicBezier, RenderTargets,
    setDepthWriteEnabled, setNoDepthNoBlend, copyArray } from './RenderContextHelper';
import { RenderContextPostProcessManager } from "./RenderContextPostProcess";
import { SAOBlurShader } from "./SAOBlurShader";
import { SAOMinifyFirstShader, SAOMinifyShader } from "./SAOMinifyShader";
import { SAOShader } from "./SAOShader";
import { ShaderPass } from "./ShaderPass";

const _document = getGlobal().document;


export function RenderContext() {

    var _renderer;
    var _depthMaterial;
    var _edgeMaterial;
    var _idMaterial;

    //The camera and lights used for an entire progressive pass (potentially several GL frames)
    var _camera;
    var _lights;
    var _fog;

    var _clearPass,
        _saoBlurPass,
        _saoPass,
        _saoMipPass,
        _saoMipFirstPass,
        _fxaaPass,
        _blendPass,
        _copyPass;

    var _saoBufferValid = false;
    var _postShadingManager = new RenderContextPostProcessManager();
    this.postShadingManager = function() { return _postShadingManager; };

    var _lastIdAtPixelsResults = {};

    var _sharedDepthTexture;
    var _depthTarget;
    var _depthMipMap = null;
    var _colorTarget = null;
    var _overlayTarget = null;
    var _overlayDepthTexture = null;
    var _postTarget1 = null;
    var _postProcDisplayTarget = null;
    var _ssaoTarget = null;
    var _postTarget2 = null;
    var _idTargets = [];
    var _overlayIdTarget = null;

    var _exposure = 0.0;
    var _exposureBias = 0.0;
    var _envRotation = 0.0;
    var _tonemapMethod = 0;
    var _unitScale = 1.0;

    var _w, _h;
    var _warnedLeak = false;

    // An offscreen context avoids affecting the main canvas Rendering
    var _isOffscreen = false;

    var _idReadbackBuffers = {};
    var _modelIdReadbackBuffers = {};
    var _idRes = [0, 0]; // Reused in rolloverObjectViewport

    var _white = new THREE.Color().setRGB(1, 1, 1);
    var _black = new THREE.Color().setRGB(0, 0, 0);
    var _edgeColor = new THREE.Vector4(0,0,0,0.3);
    
    var _clearColor = null;
    var _clearAlpha = 1.0;
    var _useOverlayAlpha = 1.0;
    var _isWeakDevice = false;

    var state = {
        isRenderingHidden: false,
        isRenderingOverlays: false
    };

    var _mrtFloat32Works = false;
    var _mrtRGBA8Works = false;
    var _depthTargetFormat = THREE.RGBAFormat;
    var _depthTargetType = THREE.FloatType;
    var _depthTargetSupported = false;

    // Smooth fade-in of roll-over highlighting
    var _lastObjTime = 0,
        _lastHighlightId = 0,
        _lastHighlightModelId = 0,
        _easeCurve = [0.42,0,1,1],
        _easeSpeed = 0.004,
        _rollOverFadeEnabled = true;

    //Rendering options
    var _settings = {
        antialias: true,
        sao: false,
        useHdrTarget: false,
        haveTwoSided: false,
        useSSAA: false, /* Whether to use supersampled targets when antialiasing is used (default is FXAA) */
        idbuffer: true,
        customPresentPass: false,
        envMapBg: false,
        numIdTargets: 1, //must be 1 or 2; 2 is required for multi-model rollover highlight to work properly.
        renderEdges: false,
        useIdBufferSelection: false, // whether to use idBuffer selection in blendShader.
        copyDepth: false, // whether to use depth buffer copying instead of sharing
    };

    var _oldSettings = {};

    // Default null. Only needed when cross fading is used.
    var _crossFade = null; // {TargetCrossFade}

    // If a target is set (default null), the final frame is rendered into _offscreenTarget instead of the canvas.
    var _offscreenTarget = null;

    //TODO: hide this once there is a way
    //to obtain the current pipeline configuration
    this.settings = _settings;

    this.depthTargetSupported = function() { return _depthTargetSupported; };

    this.isRolloverHighlightEnabled = function() { return _enableRolloverHighlight; }

    this.isWeakDevice = function() { return _isWeakDevice; };



    // Check whether format and type combination is supported on this device.
    function isDepthTargetTypeSupported(type) {
        try {
            var target = createDepthTarget(2, 2, type.format, type.type);
            target.texture.generateMipmaps = false;
            //target.depthBuffer = false;
            _renderer.setRenderTarget( target );
            var gl = _renderer.getContext();
            var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            _renderer.setRenderTarget( null );
            target.dispose();
            return status === gl.FRAMEBUFFER_COMPLETE;
        } catch (e) {
            // An exception means this type isn't supported.
            return false;
        }
    }

    // Find the format and type combination for the depth targett that works for this device
    function determineDepthTargetType() {
        var types = _isWeakDevice
            ? [
                { format: THREE.RGBAFormat, type: THREE.HalfFloatType},
                { format: THREE.RGBAFormat, type: THREE.FloatType}
            ] : [
                { format: THREE.RGBAFormat, type: THREE.FloatType},
                { format: THREE.RGBAFormat, type: THREE.HalfFloatType}
            ];

        var type = types.find(isDepthTargetTypeSupported);

        if (type) {
            _depthTargetSupported = true;
            _depthTargetFormat = type.format;
            _depthTargetType = type.type;
        } else {
            _depthTargetSupported = false;
            logger.warn("Depth target is unsupported for this device.");
        }
    }

    // Tell BlendShader whether to use idBufferSelection.
    //
    // Criteria for deciding this flag:
    //
    //  - Color Changes: When not using idBufferSelection, BlendShader uses a color-based heuristic to detect highlighting pixels.
    //                   This causes some unwanted color changes in overlay, e.g. when drawing blue polygons in Edit2D.
    //                   => If possible, we use IDBuffer selection to avoid this.
    //
    //  - 3D Highlighting: Only drawback of id-buffer selection is a minor difference in 3D selection highlighting: 
    //                     There will be no outline around the outer edge of the selection in 3D in case it's behind another element, 
    //                     because the ID buffer only has the topmost ID. see https://autodesk.slack.com/archives/CB7E2E109/p1576852154013600
    //                     => If wanted by the client, we allow disabling idBuffer selection.
    //
    //  Therefore:
    //   - For 2D, we always use idBuffer selection if an idTarget is available.
    //   - For 3D, we decide based on options.useIdBufferSelection in RenderContext.init.
    //
    function setIdBufferSelectionEnabled(enabled) {
        _settings.useIdBufferSelection = enabled;

        if (enabled) {
            _blendPass.material.defines.USE_IDBUFFER_SELECTION = "1";
        } else {
            delete _blendPass.material.defines.USE_IDBUFFER_SELECTION;
        }
    }

    // @param {WebGLRenderer}        glrenderer
    // @param {number}               width, height - render target extents
    // @param {object}               [options]
    // @param {bool}                 [options.offscreen] - By default (false), we render into the canvas of WebGLRenderer. If true, we render into an offscreen target instead - without affecting the main canvas.
    // @param {useIdBufferSelection} [options.useIdBufferSelection] - Use separate id buffer. If false, the BlendShader has to use a color-based heuristic to detect edges of selected objects.
    //                                                                Note: This flag is only relevant for 3D. For 2D, we always use idBufferSelection if we have an idBuffer.
    this.init = function (glrenderer, width, height, options = {}) {

        const offscreen            = options.offscreen;
        const useIdBufferSelection = options.useIdBufferSelection !== undefined ? options.useIdBufferSelection : BUILD_FLAG__USE_IDBUFFER_SELECTION_BY_DEFAULT;

        createRenderPasses();

        if (!glrenderer) {
            if (!isNodeJS())
                logger.error("You need a gl context to make a renderer. Things will go downhill from here.", errorCodeString(ErrorCodes.BROWSER_WEBGL_NOT_SUPPORTED));
            return;
        }

        _isWeakDevice = isMobileDevice();

        _settings.idbuffer = !_isWeakDevice;

        if (useIdBufferSelection) {
            _settings.idbuffer = true;
            _settings.numIdTargets = 2;
            _blendPass.material.defines.USE_MODEL_ID = "1";

            setIdBufferSelectionEnabled(true);
        }

        _w = width;
        _h = height;

        _renderer = glrenderer;

        _isOffscreen = !!offscreen;

        determineDepthTargetType();
    
        //delayed until first begin frame
        //this.initPostPipeline(_settings.sao, _settings.antialias);

    };

    this.setDepthMaterialOffset = function(on,factor,units) {
        var cb = function(mat) {
            mat.polygonOffset = on;
            mat.polygonOffsetFactor = factor;
            mat.polygonOffsetUnits = units;
            if (mat.extraDepthOffset) {
                mat.polygonOffsetFactor += mat.extraDepthOffset;
            }
            mat.needsUpdate = true;
        };
        forEachDepthMaterial(cb);
    };

    // Calls the cb for all depth material variants (including default)
    function forEachDepthMaterial(cb) {
        cb(_depthMaterial);
        for (var i=1; i<_depthMaterial.variants.length; i++) {
            cb(_depthMaterial.variants[i]);
        }
    }

    /**
     * Export to renderContextPostShadingExtension
     */
    this.setNoDepthNoBlend = setNoDepthNoBlend;

    function createRenderPasses() {
        _depthMaterial = createDepthMaterial();
        _edgeMaterial = createEdgeMaterial(state, _edgeColor);

        _saoPass = new ShaderPass(SAOShader);
        setNoDepthNoBlend(_saoPass);

        _saoBlurPass = new ShaderPass(SAOBlurShader);
        setNoDepthNoBlend(_saoBlurPass);

        _saoMipFirstPass = new ShaderPass(SAOMinifyFirstShader);
        setNoDepthNoBlend(_saoMipFirstPass);

        _saoMipPass = new ShaderPass(SAOMinifyShader);
        setNoDepthNoBlend(_saoMipPass);

        _fxaaPass = new ShaderPass(FXAAShader);
        setNoDepthNoBlend(_fxaaPass);

        _blendPass = new ShaderPass(BlendShader);
        setNoDepthNoBlend(_blendPass);

        _clearPass = new ShaderPass(BackgroundShader);
        setNoDepthNoBlend(_clearPass);

        _copyPass = new ShaderPass(CopyShader);
        setNoDepthNoBlend(_copyPass);
    }

    /**
     * Returns true if render target with given name is used by at least one rendering component or effect.
     * @param {Number} targetName - Render target name (see RenderTargets for complete list)
     */
    function isRenderTargetUsed(targetName) {
        switch (targetName) {
            case RenderTargets.Color: return true;
            case RenderTargets.Depth: return _depthTargetSupported && (_settings.sao || _postShadingManager.isPostProcShaded());
            case RenderTargets.ModelId: return (_settings.idbuffer);
            case RenderTargets.Overlay: return true;
            case RenderTargets.SSAO: return _settings.sao;
            case RenderTargets.Post1: return (_settings.antialias || _settings.sao || _settings.customPresentPass || _postShadingManager.isPostProcShaded());
            case RenderTargets.Post2: return (_postShadingManager.isPostProcShaded() || _settings.customPresentPass);
            case RenderTargets.PostDisplay: return (_settings.antialias && _postShadingManager.isPostProcShaded()); // we assume blending is available.
        }
    }



    // Fades the overlay update in over time.
    // For rollover highlighting, which increases in effect as you wait.
    this.overlayUpdate = function() {

        if (_lastHighlightId === 0 || _lastHighlightId === -1)
            return false;

        var old = _blendPass.uniforms.highlightIntensity.value;

        var current = 1.0;
        if (_rollOverFadeEnabled) {
            // Multiply number of milliseconds that has elapsed by the
            // speed, 1/milliseconds, the time the transition should take.
            // So if _easeSpeed is, say, 1/1000, the transition takes a second;
            // 2/1000 is half a second, etc.
            var t = ((performance.now() - _lastObjTime) * _easeSpeed);
            t = Math.min(t, 1.0);

            // not a linear transition; use a cubic Bezier curve to ease in and out
            current = cubicBezier(_easeCurve, t);
        }

        // if intensity value has changed, update the shader's uniform
        if (old != current) {
            _blendPass.uniforms.highlightIntensity.value = current;
            return true;
        }

        return false;
    };

    // Enable/Disable smooth fading of roll-over highlight intensity.
    this.setRollOverFadeEnabled = function(enabled) {
        _rollOverFadeEnabled = enabled;
    };

    // clear the color target and other targets, as needed
    this.beginScene = function (prototypeScene, camera, customLights, needClear) {
        _camera = camera;
        _fog = prototypeScene.fog;
        _lights = customLights;
        _saoBufferValid = false;
        _lastIdAtPixelsResults = {};

        if (!_colorTarget && _w) {
            this.initPostPipeline(_settings.sao, _settings.antialias);
        } else if (!_colorTarget && !_w) {
            if (!_warnedLeak && !isNodeJS()) {
                logger.error("Rendering to a canvas that was resized to zero. If you see this message you may be accidentally leaking a viewer instance.", errorCodeString(ErrorCodes.VIEWER_INTERNAL_ERROR));
                _warnedLeak = true;
            }
            return;
        }

        //We need to render once with the "prototype" scene which
        //only contains the cameras and lights, so that their positions
        //and transforms get updated to the latest camera. Hence the
        //call to render instead of just clear.


        //Clear the color target
        if (needClear) {

            // Ignore envMapBg flag until envMap is actually available. 
            var useEnvMapBg = (_settings.envMapBg && !!_clearPass.material.envMap);
            var useBackgroundTexture = !!_clearPass.material.useBackgroundTexture;

            if (_clearColor && !useEnvMapBg && !useBackgroundTexture) {
                _renderer.setClearColor(_clearColor, _clearAlpha);
                //clear color and depth buffer
                _renderer.setRenderTarget( _colorTarget );
                _renderer.clear( true, true, false); 
            } else {
                const uCamDir = _clearPass.uniforms['uCamDir'].value || new THREE.Vector3();
                _clearPass.uniforms['uCamDir'].value = _camera.worldUpTransform ? _camera.getWorldDirection(uCamDir).applyMatrix4(_camera.worldUpTransform) : _camera.getWorldDirection(uCamDir);
                _clearPass.uniforms['uCamUp'].value = _camera.worldUpTransform ? _camera.up.clone().applyMatrix4(_camera.worldUpTransform) : _camera.up;
                _clearPass.uniforms['uResolution'].value.set(_w, _h);
                _clearPass.uniforms['uHalfFovTan'].value = Math.tan(THREE.Math.degToRad(_camera.fov * 0.5));
                _clearPass.uniforms['opacity'].value = _clearAlpha;

                //clear depth buffer
                _renderer.setRenderTarget( _colorTarget );
                _renderer.clear( false, true, false );
                _clearPass.render(_renderer, _colorTarget, null); //clear the color buffer
            }

            if (_crossFade) {
                _crossFade.clearTarget(_renderer);
            }

            //Clear the id buffer(s)
            for (var i=0; i<_idTargets.length; i++) {
                _renderer.setClearColor(_white, 1.0);
                _renderer.setRenderTarget( _idTargets[i] );
                _renderer.clear( true, false, false);
            }
        }

        //Clear the G-buffer target if needed and update the SSAO uniforms.
        if (isRenderTargetUsed(RenderTargets.Depth)) {

            if (needClear) {
                _renderer.setClearColor(_black, 0.0);
                //Skip clearing the depth buffer as it's shared with the color target
                _renderer.setRenderTarget( _depthTarget );
                _renderer.clear( true, false, false );
            }

            var near = camera.near;
            var far = camera.far;

            _saoPass.uniforms['cameraNear'].value = near;
            _saoPass.uniforms['cameraFar'].value = far;
            _saoMipFirstPass.uniforms['cameraNear'].value = near;
            _saoMipFirstPass.uniforms['cameraInvNearFar'].value = 1.0 / (near - far);

            var P = camera.projectionMatrix.elements;

            //Scaling factor needed to increase contrast of our SSAO.
            if (camera.isPerspective) {
                _saoPass.uniforms[ 'projInfo' ].value.set(
                    -2.0 / (_colorTarget.width * P[0]),
                    -2.0 / (_colorTarget.height * P[5]),
                    (1.0 - P[8]) / P[0],
                    (1.0 + P[9]) / P[5]);   //TODO: Not certain if we need + or - here for OpenGL off-center matrix (original is DX-style)
                                            //would have to verify if some day we have off-center projections.
            } else {
                _saoPass.uniforms[ 'projInfo' ].value.set(
                    -2.0 / (_colorTarget.width * P[0]),
                    -2.0 / (_colorTarget.height * P[5]),
                    (1.0 - P[12]) / P[0],
                    (1.0 - P[13]) / P[5]);
            }
            _blendPass.uniforms[ 'projInfo'].value.copy(_saoPass.uniforms[ 'projInfo' ].value);

            var isOrtho = (camera.isPerspective ? 0.0 : 1.0);
            _saoPass.uniforms[   'isOrtho' ].value = isOrtho;
            _blendPass.uniforms[   'isOrtho' ].value = isOrtho;

            var hack_scale = 0.25;
            _saoPass.uniforms[ 'projScale' ].value = hack_scale * 0.5 * (_colorTarget.height * P[5]);

            // an approximation of the size of the world; relies on the camera's near and far being reasonable.
            // This is not a great solution, as orbiting changes this number. Better would be the length of
            // the diagonal of the whole world, or perhaps the *shortest* dimension (so that cities get SAO).
            // This method is variable on the camera's view. Better is to do this in Viewer3dImpl.addModel,
            // which is where we do this now.
            //this.setAOOptions( 0.05*(camera.far-camera.near) );

            // let blend-pass know the world-matrix used for scene rendering. This is used to
            // reproduce world-positions from screen-space using the depth texture.
            _blendPass.uniforms['worldMatrix_mainPass'].value = camera.matrixWorld;

            // Update postShadingManager with relevant uniforms.
            if (_postShadingManager.isPostProcShaded()) {
                const focalLength = Autodesk.Viewing.Navigation.prototype.fov2fl(camera.fov);

                _postShadingManager.updateUniformValue("focalLength", focalLength);
                _postShadingManager.updateUniformValue("unitScale", _unitScale);
                _postShadingManager.updateUniformValue("worldMatrix_mainPass", camera.matrixWorld, true);
                _postShadingManager.updateUniformValue("cameraPos", camera.position, true);
                _postShadingManager.updateUniformValue("cameraNear", near);
                _postShadingManager.updateUniformValue("cameraFar", far);
                _postShadingManager.updateUniformValue('projInfo', _saoPass.uniforms['projInfo'].value, true);
                _postShadingManager.updateUniformValue("isOrtho", isOrtho);
            }
        }

        if (!_settings.sao)
        {
            // Ensure that any previous SSAO computation post-process target is not blended in.
            // This looks redundant with computeSSAO()'s code setting this blend off. However, it's
            // possible for computeSSAO() to not be executed if (a) smooth navigation and AO are both on
            // and (b) the scene is moving. In that case, smooth navigation turns off AO entirely in
            // Viewer3DImpl.js and computSSAO() is never called at all.
            _blendPass.uniforms['useAO'].value = 0;
        }

        // Render the prototype/pre-model scene, which may also contain some user added custom geometry.
        // The key bit here is the "updateLights" true flag, which updates the lights for the scene; this is the
        // only place this flag is passed in as true.
        this.renderScenePart(prototypeScene, true, true, true, true);
    };

    /**
     * @private
     */
    this._render = function ( renderer, renderTarget, scene, camera, lights ) {
        renderer.setRenderTarget( renderTarget );
        renderer.render(scene, camera, lights);
    }

    /**
     * @private
     */
    this._renderDepthTarget = function(scene, renderSAO, depthTarget, depthWriteToZbuffer) {
        // We do not render transparent objects to the depth target, which is currently used only for ambient shadows.
        // This is the same as sortObjects === true.
        // If we someday do render to depth target for other things, such as a good near, we will need to perhaps do
        // a separate pass to get the near, rendering all objects. (We'll have a good "far", since transparent objects will be off.)
        if (renderSAO && !scene.sortObjects && depthTarget) {
            //Render the depth pass
            const oldMat = scene.overrideMaterial;

            scene.overrideMaterial = _depthMaterial;

            // If color or ID target was written, then the z-buffer is established and we don't need to write to it any more.
            // NOTE: until cutouts are dealt with properly by the depth material, there will still be mismatches.
            // If the color buffer already wrote to the z-buffer, don't write to it. This saves memory accesses
            // and more importantly means that the depth material doesn't need to take account of any cutout materials,
            // as now only the color pass will write to the hardware z-buffer, and that pass does it right.
            if ( _depthMaterial.depthWrite !== depthWriteToZbuffer ) {
                setDepthWriteEnabled(_depthMaterial, depthWriteToZbuffer);
            }
            this._render(_renderer, depthTarget, scene, _camera);

            scene.overrideMaterial = oldMat;
        }
    }

    // Called incrementally by the scene traversal, potentially
    // across several frames.
    this.renderScenePart = function (scene, want_colorTarget, want_saoTarget, want_idTarget, updateLights) {

        if (typeof scene.skipColorTarget !== "undefined") {
            want_colorTarget = !scene.skipColorTarget;
        }
        if (typeof scene.skipDepthTarget !== "undefined") {
            want_saoTarget = !scene.skipDepthTarget;
        }
        if (typeof scene.skipIdTarget !== "undefined") {
            want_idTarget = !scene.skipIdTarget;
        }

        if (want_colorTarget && _settings.renderEdges) {
            scene.edgeMaterial = _edgeMaterial;
        }

        var renderSAO = want_saoTarget && isRenderTargetUsed(RenderTargets.Depth);

        // determine to which color target we render
        var colorTarget = _colorTarget;
        var depthTarget = _depthTarget;

        // Only relevant if a separate depth-pass is used. By default, we don't need to write zBuffer in the depth pass,
        // because this already happened in the color pass.
        var depthWriteToZbuffer = false;

        if (_crossFade) {
            // Render to fading-target if specified for this model
            colorTarget = _crossFade.chooseColorTarget(scene, colorTarget);

            // Exclude model from SAO if it is on a low-opacity target.
            // Note that we cannot modify renderSAO dynamically, because this would
            // require some shader recompile work.
            depthTarget = _crossFade.getRenderSao(scene) ? _depthTarget : null;

            // A crossFade target may have its own zBuffer, so that it is not shared with _depthTarget anymore
                                           
            depthWriteToZbuffer = depthTarget && (_depthTarget.shareDepthFrom !== colorTarget);
                     
                                                                                                     
                      
        }

        //console.time("renderScenePart");
        _saoBufferValid = false;
        _lastIdAtPixelsResults = {};
        var lights = updateLights ? _lights : undefined;
        //update scene with stored _fog shared from prototypeScene fog.
        scene.fog = _fog;

        //Three possibilities here -- MRT fully supported (Mac OS or native GL backends on Windows).
        //MRT supported only for targets that have exactly equal number of bitplanes and bpp (ANGLE on Windows)
        //MRT not supported at all. (Not sure --> some mobile platforms?).
        var colorTargetsUsed;
        var oldMat;
        if (_mrtFloat32Works && _mrtRGBA8Works) {
            //You lucky dog! Fast code path for you.

            //In case of MRT, we ignore the which target flags, because
            //we assume the shaders are set up to write to the multiple targets anyway.
            //NOP: except idTarget, since hidden pass doesn't want that
            if (isRenderTargetUsed(RenderTargets.ModelId) && want_idTarget && renderSAO) {
                colorTargetsUsed = [colorTarget, depthTarget].concat(_idTargets);
            }
            else if (renderSAO) {
                colorTargetsUsed = [colorTarget, depthTarget];
            }
            else if (isRenderTargetUsed(RenderTargets.ModelId) && want_idTarget) {
                colorTargetsUsed = [colorTarget].concat(_idTargets);
            }
            else {
                colorTargetsUsed = colorTarget;
            }

            this._render(_renderer, colorTargetsUsed, scene, _camera, lights);

        } else if (_mrtRGBA8Works) {
            //It's something...

            if (isRenderTargetUsed(RenderTargets.ModelId) && want_idTarget) {
                colorTargetsUsed = [colorTarget].concat(_idTargets);
            }
            else {
                colorTargetsUsed = colorTarget;
            }

            this._render(_renderer, colorTargetsUsed, scene, _camera, lights);

            // Float target has to be rendered separately in case we can't
            // bind MRT with different bpp targets.
            this._renderDepthTarget(scene, renderSAO, depthTarget, depthWriteToZbuffer);

        } else {

            //Poor sod. No MRT at all. Three passes.

            // Render the color target first -- actually this is slower
            // because the color shader is likely a lot slower than the
            // depth+normal shader, but if we render depth first, then
            // we lose stuff behind transparent objects (potentially).
            // So we cannot do this until the progressive render is split
            // into non-transparent and transparent worlds.

            // see if depth target needs to write to z-buffer, not just read it
            if (want_colorTarget) {
                colorTargetsUsed = colorTarget;
                this._render(_renderer, colorTarget, scene, _camera, lights);
            } else {
                // This branch will never be hit with the current code - the color target
                // is always generated. But, future-proofing.
                depthWriteToZbuffer = true;
            }

            // TODO: In 3D we really don't want to get into
            // this situation -- we don't have a reasonable ID material that
            // will work for e.g. cutout maps. We have to run basically a full
            // shader, or at least one that support opacity and alpha map checks.
            if (isRenderTargetUsed(RenderTargets.ModelId) && want_idTarget) {

                // TODO: the ID buffer should also probably not write to the z-buffer if the
                // color target already has. The _idMaterial should be adjusted. The bug that may
                // occur without this fixed is that objects with cutouts may instead fully cover
                // areas they should not. See LMV-2375.
                // Also, if the color buffer is *not* rendered, then the id buffer should use a special
                // material to represent cutout materials, so cutouts are treated properly and block only
                // the areas they truly cover.
                if (_idMaterial) {
                    oldMat = scene.overrideMaterial;
                    scene.overrideMaterial = _idMaterial;
                    //TODO: This code path does not work in case multiple id targets are attached
                    //We need a second ID material that renders modelId instead of dbId.
                    this._render(_renderer, _idTargets[0], scene, _camera);
                    scene.overrideMaterial = oldMat;
                } else {
                    _renderer.setProgramPrefix(1, "#define ID_COLOR", "#define ID_COLOR");
                    //TODO: This code path does not work in case multiple id targets are attached
                    //We need a second ID material that renders modelId instead of dbId.
                    this._render(_renderer, _idTargets[0], scene, _camera);
                    _renderer.setProgramPrefix(0, "", "");
                }
                depthWriteToZbuffer = false;
            }

            this._renderDepthTarget(scene, renderSAO, depthTarget, depthWriteToZbuffer);

        }

        scene.edgeMaterial = undefined;

        // console.timeEnd("renderScenePart");
    };


    this.clearAllOverlays = function () {
        _renderer.setRenderTarget( _overlayTarget );
        _renderer.clear( true, false, false );
    };

    this.renderOverlays = function (overlays, lights, disableClear) {
        var haveOverlays = 0;

        state.isRenderingOverlays = true;

        // if the scene need its own id target for picking
        let overlayIdTargetCleared = false;
        // Only for those scene which requires its own depth buffer
        let overlayDepthCleared = false;
        // Indicates whether the depth buffer has been copied from the colortarget
        let overlayDepthCopied = false;

        // need to sort the overlays
        // most of existing object in the overlay are renderred with depthTest=true, depthWrite=false
        // the render sequence will determine the visual result
        // for those material which trying to do depth test its own, we need render it later
        let overlayArray = Object.values(overlays).sort((a, b) => {
            if(a.needSeparateDepth ==  b.needSeparateDepth) {
                return 0;
            } else if (a.needSeparateDepth == true) {
                return 1;
            } else if (b.needSeparateDepth == true) {
                return -1;
            }
        })

        for (let key = 0; key < overlayArray.length; ++key) {
            var p = overlayArray[key];
            var s = p.scene;
            var c = p.camera ? p.camera : _camera;
            var renderer = _renderer;

            if (s.children.length) {
                renderer.setRenderTarget(_overlayTarget);

                if (!haveOverlays) {
                    haveOverlays = 1;

                    if (!disableClear) {
                        //clear the overlay target once we see
                        //the first non-empty overlay scene
                        renderer.setClearColor(_black, 0.0);
                        renderer.clear(true, false, false);
                    }
                }

                //NOTE: This logic renders the top side of the highlighted objects first,
                //and then the bottom side. The reason is that the top side material is opaque,
                //while we want to render the hidden parts of the object with faint transparency.
                //For objects that covers themselves and are also covered by other objects
                //this is a problem, since the opaque parts would prevent the back parts from showing.

                //However, edge rendering uses painter's algorithm settings for the depth,
                //since we don't care to show hidden edges from under top edges.

                //Render top side of the object using the primary highlight material
                if (p.materialPre) {
                    s.overrideMaterial = p.materialPre;
                }

                // since we sorted the overlay, for those who requires separate depth
                // we only need to clear the depth buffer once, then those depth value will be used cross scene
                // and content will be rendered depend on its own depth value
                if(p.needSeparateDepth) {
                    if (!overlayDepthCleared) {
                                                       
                        // do not use the sharedDepthFrom, and let the target to have its own depth buffer
                        _overlayTarget.shareDepthFrom = null;                
                                  
                        renderer.setRenderTarget(_overlayTarget);
                        renderer.clear(false, true, false);
                        overlayDepthCleared = true;
                    }
                } else {
                                                   
                                                                     
                                                                                                                         
                                                    
                                                                                                                             
                                                              
                                                                 
                             
                                                                            
                                                     

                                                              
                                                                                                                                                           
                                                                               
                                                                                             
                         
                                                                 
                                                                                                     
                       
                              

                    if (overlayDepthCopied === false) {
                        // change this back to shared depth
                                                       
                        _overlayTarget.shareDepthFrom = _colorTarget;
                                 
                                                                                  
                                                                                   
                                                      
                                                            
                                                                    
                                                                 
                           

                                                                          
                                                                              

                                                   
                                                            
                                                                                           
                         
                                  
                    }
                }

                // For the scene which requires idTarget, create a _overlayIdTarget, and clearred it only once per render pass
                if(_mrtRGBA8Works && p.needIdTarget) {
                    if(!_overlayIdTarget) {
                        _overlayIdTarget = createIdTarget(_overlayTarget.width, _overlayTarget.height);
                                                       
                        _overlayIdTarget.shareDepthFrom = _colorTarget;
                                 
                                                                            
                                  
                        _overlayIdTarget.name = "overlayId";
                    }

                    // only clear it per render pass
                    if(overlayIdTargetCleared == false) {
                        renderer.setRenderTarget(_overlayIdTarget);
                        renderer.clear(true, false, false);
                        overlayIdTargetCleared = true;
                    }

                    var overlayTargets = [_overlayTarget];
                    if(p.needIdTarget) {
                        overlayTargets.push(_overlayIdTarget);
                    }

                    this._render(renderer, overlayTargets, s, c, lights);
                } else {
                    this._render(renderer, _overlayTarget, s ,c, lights);
                    if(p.needIdTarget) {
                        if(!_overlayIdTarget) {
                            _overlayIdTarget = createIdTarget(_overlayTarget.width, _overlayTarget.height);
                                                           
                            _overlayIdTarget.shareDepthFrom = _colorTarget;
                                     
                                                                                
                                      
                            _overlayIdTarget.name = "overlayId";
                        }

                        // Reference this from how the main IdTarget was rendered: Line 894
                        renderer.setProgramPrefix(1, "#define ID_COLOR", "#define ID_COLOR");
                        //TODO: This code path does not work in case multiple id targets are attached
                        //We need a second ID material that renders modelId instead of dbId.
                        this._render(renderer, _overlayIdTarget, s ,c, lights);
                        renderer.setProgramPrefix(0, "", "");
                    }
                }

                if (p.materialPost) {
                    //render hidden edges
                    state.isRenderingHidden = true; //flag used when getting the correct override material for the hidden pass
                    renderer.getContext().depthFunc(renderer.getContext().GREATER);
                    p.materialPost.depthFunc = THREE.GreaterDepth;

                    if (_settings.renderEdges) {
                        _edgeMaterial.depthWrite = false;
                        _edgeMaterial.depthTest = false;
                        s.overrideMaterial = _edgeMaterial;
                        this._render(renderer, _overlayTarget, s ,c);
                    }

                    //Render bottom side of the object
                    //for selection that's done using light transparency to show
                    //areas the object spans under other objects
                    s.overrideMaterial = p.materialPost;
                    this._render(renderer, _overlayTarget, s ,c, lights);

                    renderer.getContext().depthFunc(renderer.getContext().LEQUAL);
                    p.materialPost.depthFunc = THREE.LessEqualDepth;
                    state.isRenderingHidden = false;
                }

                //Render top side edges last
                if (_settings.renderEdges && p.materialPre) {
                    _edgeMaterial.depthWrite = false;
                    _edgeMaterial.depthTest = true;
                    s.overrideMaterial = _edgeMaterial;
                    this._render(renderer, _overlayTarget, s ,c);
                }

                s.overrideMaterial = null;
            }
        }

        //Back to normal edge mode
        state.isRenderingOverlays = false;
        _edgeMaterial.depthWrite = true;
        _edgeMaterial.depthTest = true;

        _blendPass.uniforms['useOverlay'].value = haveOverlays;
        
        // Update the useOverlayAlpha only if there are overlays
        if (haveOverlays) {
            // LMV-5528: useOverlayAlpha will update the diffuse color's alpha with the overlay alpha.
            // By default the useOverlayAlpha is enabled.
            _blendPass.uniforms['useOverlayAlpha'].value = _useOverlayAlpha;
        }
    };

    // Takes color buffer, uses normal and depth buffer, puts SSAO shading into _ssaoTarget.
    // _postTarget1 is used along the way to ping-pong and do a separable blur on the results.
    this.computeSSAO = function(skipAOPass) {
        if (!skipAOPass && _settings.sao) {

            //console.time("SAO");
            if (!_saoBufferValid) {
                if (_depthMipMap && _depthMipMap.length) {
                    var prevMip = _depthMipMap[0];
                    _saoMipFirstPass.uniforms['resolution'].value.set(1.0 / prevMip.width, 1.0 / prevMip.height);
                    _saoMipFirstPass.render(_renderer, prevMip, _depthTarget);
                    for (var i = 1; i < _depthMipMap.length; i++) {
                        var curMip = _depthMipMap[i];
                        _saoMipPass.uniforms['resolution'].value.set(1.0 / curMip.width, 1.0 / curMip.height);
                        _saoMipPass.render(_renderer, curMip, prevMip);
                        prevMip = curMip;
                    }
                }
                // compute SSAO and put in _ssaoTarget
                _saoPass.render(_renderer, _ssaoTarget, _colorTarget);

                //console.timeEnd("SAO");
                //console.time("SAOblur");
                //Do the separable blur, horizontal and vertical
                _saoBlurPass.uniforms['axis'].value.set(1, 0);
                _saoBlurPass.render(_renderer, _postTarget1, _ssaoTarget);
                _saoBlurPass.uniforms['axis'].value.set(0, 1);
                _saoBlurPass.render(_renderer, _ssaoTarget, _postTarget1);

                _saoBufferValid = true;
            }

            _blendPass.uniforms['useAO'].value = 1;
            //console.timeEnd("SAOblur");
        } else {
            // Ensure that any previous SSAO computation post-process target is not blended in.
            _blendPass.uniforms['useAO'].value = 0;
        }

    };

    function saveOverlayAndHighlightUniforms()
    {
        var hold = [ _blendPass.uniforms['useOverlay'].value, _blendPass.uniforms['objIDv4'].value ];
        _blendPass.uniforms['useOverlay'].value = 0;
        _blendPass.uniforms['objIDv4'].value = new THREE.Vector4();
        return hold;
    }
    function restoreOverlayAndHighlightUniforms( hold )
    {
        _blendPass.uniforms['useOverlay'].value = hold[0];
        _blendPass.uniforms['objIDv4'].value = hold[1];
    }
    function saveSAOUniform()
    {
        var hold = _blendPass.uniforms['useAO'].value;
        _blendPass.uniforms['useAO'].value = 0;
        return hold;
    }
    function restoreSAOUniform( hold )
    {
        _blendPass.uniforms['useAO'].value = hold;
    }

    function blendAndPostProcess()
    {
        var outTarget = _postTarget1;
        var inTarget = _colorTarget;
        if ( _blendPass.uniforms['useAO'].value ) {
            const hold = saveOverlayAndHighlightUniforms();
            _blendPass.render(_renderer, outTarget, inTarget);
            inTarget = outTarget;
            outTarget = _postTarget2;
            restoreOverlayAndHighlightUniforms(hold);
        }

        var tmpTarget = outTarget === _postTarget1 ? _postTarget2 : _postTarget1;

        // Render post shading passes that should be rendered BEFORE overlays were rendered.
        inTarget = _postShadingManager.render(_renderer, outTarget, inTarget, tmpTarget, false);
        outTarget = inTarget === _postTarget1 ? _postTarget2 : _postTarget1;

        if ( _blendPass.uniforms['useOverlay'].value ||
             _blendPass.uniforms['objIDv4'].value ) {
            const hold = saveSAOUniform();
            _blendPass.render(_renderer, outTarget, inTarget);
            inTarget = outTarget;
            restoreSAOUniform(hold);
        }

        outTarget = inTarget === _postTarget1 ? _postTarget2 : _postTarget1;
        tmpTarget = outTarget === _postTarget1 ? _postTarget2 : _postTarget1;

        // Render post shading passes that should be rendered AFTER overlays were rendered.
        inTarget = _postShadingManager.render(_renderer, outTarget, inTarget, tmpTarget, true);

        // the inTarget is always set to the previous outTarget after a pass is done
        return inTarget;
    }

    // Returns the final render target that presentBuffer eventually render to.
    this.getFinalTarget = function() {
        return _offscreenTarget || null;
    };

    // userFinalPass is used by stereo rendering, giving the context to use for where the render should be put.
    // If no context is given, the default frame buffer is used.
    this.presentBuffer = function (userFinalPass) {

        if (!_renderer)
            return;

        // By default, finalTarget is null (= render to canvas)
        var finalTarget = this.getFinalTarget();

        // See if the blend pass is trivial 1:1, in which
        // case we can just use the main color target for
        // the final pass and skip the blend pass.
        // NOTE: This needs to be adjusted if the blend pass ever
        // does the tone mapping again.
        // TODO: Another possible improvement is to support blending of the SAO
        // inside the FXAA pass, in case the blend pass is just modulating by the AO value.
        var canSkipBlendPass = !_blendPass.uniforms['useAO'].value &&
                               !_blendPass.uniforms['useOverlay'].value &&
                               !_crossFade && // blend pass is required for cross-fading
                               // idAtPixel can return -1 for the ID when nothing is there
                               (_lastHighlightId === 0 || _lastHighlightId === -1) &&
                               (_lastHighlightModelId === 0 || _lastHighlightModelId === -1);

        // In this code, the following inputs cannot be written to:
        // _colorTarget holds the current "normal" render.
        // _ssaoTarget holds the SSAO results to be blended in, but can be wiped out by other modes.

        // What uses what (_colorTarget is always used)
        // Blend    Antialias   PostProc    UserPass
        // .        .           .           .           - simple case, just copy
        // X        .           .           .           - blend to frame buffer
        // .        X           .           .           - fxaa to frame buffer
        // X        X           .           .           - _postTarget1
        // .        .           X           .           - _postTarget1
        // X        .           X           .           - _postTarget1, _postTarget2
        // .        X           X           .           - _postTarget1, _postTarget2
        // X        X           X           .           - _postTarget1, _postTarget2, _postProcDisplayTarget
        // .        .           .           X           - _postTarget1
        // X        .           .           X           - _postTarget1, _postTarget2
        // .        X           .           X           - _postTarget1
        // X        X           .           X           - _postTarget1, _postTarget2
        // .        .           X           X           - *not supported*
        // X        .           X           X           - *not supported*
        // .        X           X           X           - *not supported*
        // X        X           X           X           - *not supported*

        if (canSkipBlendPass) {
            // we can use the color target for the final pass and not bother with blending in SAO or the overlay or highlighting

            if (_settings.antialias) {
                // antialiasing is on

                if (userFinalPass) {
                    // post processing is currently not valid for stereo viewing TODO
                    // if (_postShadingManager.isPostProcShaded()) {
                    //     // FXAA is put in post target 1 - TODO no post processing
                    //     _fxaaPass.render(_renderer, _postTarget1, _colorTarget);
                    //     // and copied and downsized to the context's frame buffer
                    //     userFinalPass.render(_renderer, userFinalPass, _postTarget1);
                    // } else {
                    // FXAA is put in post target 1
                    _fxaaPass.render(_renderer, _postTarget1, _colorTarget);
                    // and copied to the context's frame buffer
                    userFinalPass.render(_renderer, finalTarget, _postTarget1);
                } else {
                    if (_postShadingManager.isPostProcShaded()) {
                        // post-processing is done, then fxaa is done and copied to framebuffer
                        // bindings need to be cleared on mode change, else you get LMV-2848,
                        // warnings about input and output being the same target.
                        const inTarget = _postShadingManager.render(_renderer, _postTarget1, _colorTarget, _postTarget2);
                        _copyPass.render(_renderer, _postProcDisplayTarget, inTarget);
                        _fxaaPass.render(_renderer, finalTarget, _postProcDisplayTarget);
                    } else {
                        // just fxaa is needed: apply and put in frame buffer
                        _fxaaPass.render(_renderer, finalTarget, _colorTarget);
                    }
                }
            }
            // no antialiasing
            else if (userFinalPass) {
                // just copy to given context - currently not valid to use stereo viewing
                userFinalPass.render(_renderer, finalTarget, _colorTarget);
            } else if (_postShadingManager.isPostProcShaded()) {
                // post-process the color target, put results in post target 1
                // bindings need to be cleared on mode change, else you get LMV-2848,
                // warnings about input and output being the same target.
                const inTarget = _postShadingManager.render(_renderer, _postTarget1, _colorTarget, _postTarget2);
                // and copy and downsize this result to the display frame buffer
                _copyPass.render(_renderer, finalTarget, inTarget);
            } else {
                // simply copy the color target to the frame buffer
                _copyPass.render(_renderer, finalTarget, _colorTarget);
            }

        } else {
            // Blending of some content must be done.

            //console.time("post");
            //If we have fxaa, do the blending into an offscreen target
            //then FXAA into the final target
            if (_settings.antialias) {
                // antialiasing and blending

                if (userFinalPass) {
                    // apply fxaa and put to given context's frame buffer - does not include post-processing TODO
                    // first blend in content in ssao target, overlay, ID, as needed, and put it in post target 1
                    _blendPass.render(_renderer, _postTarget1, _colorTarget);

                    _fxaaPass.render(_renderer, _postTarget2, _postTarget1);
                    userFinalPass.render(_renderer, finalTarget, _postTarget2);
                } else if (_postShadingManager.isPostProcShaded()) {
                    // post-process and fxaa
                    // bindings need to be cleared on mode change, else you get LMV-2848,
                    // warnings about input and output being the same target.
                    // first blend in content in ssao target, overlay, ID, as needed, and put it in post target 1

                    var inTarget = blendAndPostProcess();
                    _copyPass.render(_renderer, _postProcDisplayTarget, inTarget);
                    _fxaaPass.render(_renderer, finalTarget, _postProcDisplayTarget);
                } else {
                    // antialias the blended image
                    // first blend in content in ssao target, overlay, ID, as needed, and put it in post target 1
                    _blendPass.render(_renderer, _postTarget1, _colorTarget);
                    _fxaaPass.render(_renderer, finalTarget, _postTarget1);
                }
            }
            else {
                // no antialiasing, just blending

                if (userFinalPass) {
                    // blend into post target 1 and copy over for output
                    _blendPass.render(_renderer, _postTarget1, _colorTarget);
                    userFinalPass.render(_renderer, finalTarget, _postTarget1);
                } else {
                    // post-process and blend, OR just blend
                    if (_postShadingManager.isPostProcShaded()) {
                        // bindings need to be cleared on mode change, else you get LMV-2848,
                        // warnings about input and output being the same target.
                        var inTarget = blendAndPostProcess();
                        // and copy and downsize this result to the frame buffer
                        _copyPass.render(_renderer, finalTarget, inTarget);
                    } else {
                        _blendPass.render(_renderer, finalTarget, _colorTarget);
                    }
                }
            }
        }

    };


    this.composeFinalFrame = function (skipAOPass, skipPresent) {
        //Apply the post pipeline and then show to screen.
        //Note that we must preserve the original color buffer
        //so that we can update it progressively

        // always called, so that useAO is set to 0 if not in use.
        this.computeSSAO(skipAOPass);

        if (!skipPresent)
            this.presentBuffer();

        //console.timeEnd("post");

    };

    this.cleanup = function () {

        if (_renderer) {
            _renderer.setRenderTarget(null);
        }

        if (_colorTarget) {
            _colorTarget.dispose();
            _colorTarget = null;
        }

        if (_depthTarget) {
            _depthTarget.dispose();
            _depthTarget = null;
        }

        if (_overlayTarget) {
            _overlayTarget.dispose();
            _overlayTarget = null;
        }

        if(_overlayIdTarget) {
            _overlayIdTarget.dispose();
            _overlayIdTarget = null;
        }

        if (_overlayDepthTexture) {
            _overlayDepthTexture.dispose();
            _overlayDepthTexture = null;
        } 

        if (_sharedDepthTexture) {
            _sharedDepthTexture.dispose();
            _sharedDepthTexture = null;
        }

        if (_crossFade) {
            _crossFade.disposeTargets();
        }

        if (_postTarget1) {
            _postTarget1.dispose();
            _postTarget1 = null;
        }

        if (_ssaoTarget) {
            _ssaoTarget.dispose();
            _ssaoTarget = null;
        }

        if (_postTarget2) {
            _postTarget2.dispose();
            _postTarget2 = null;
        }

        if (_depthMipMap) {
            for (var i=0; i<_depthMipMap.length; i++) {
                _depthMipMap[i].dispose();
            }

            _depthMipMap = [];
        }

        for (var i=0; i<_idTargets.length; i++) {
            _idTargets[i] && _idTargets[i].dispose();
        }
        _idTargets = [];

        _lastIdAtPixelsResults = {};
        _idReadbackBuffers = {};
        _modelIdReadbackBuffers = {};
    };

    this.setSize = function (w, h, force, suppress) {
        if (this._renderer?.xr?.isPresenting) {
            console.warn('RenderContext: Can\'t change size while XR device is presenting.');
            return;
        }

        _w = w;
        _h = h;

        _settings.logicalWidth = w;
        _settings.logicalHeight = h;

        //Just a way to release the targets in cases when
        //we use a custom render context and don't need this one
        //temporarily
        if ((w === 0 && h === 0) || !_renderer) {
            this.cleanup();
            return;
        }

        var sw = 0 | (w * _renderer.getPixelRatio());
        var sh = 0 | (h * _renderer.getPixelRatio());

        _settings.deviceWidth = sw;
        _settings.deviceHeight = sh;

        // normally, render() calls setRenderTarget, which properly sets the size to be
        // the correct viewport for rendering. However, setAOEnabled also calls this
        // method, to allocate or deallocate the various SSAO buffers, etc. Because
        // post processing can increase the size of the target by 2x (code below),
        // we do not want to have setAOEnabled touch the renderer's setSize. Long and
        // short, setAOEnabled sends in "suppress" as true. LMV-2863
        if (!suppress) {
            if (_isOffscreen) {
                // only set Viewport (which can be recovered later), but do not affect WebGLCanvas
                _renderer.setViewport(0, 0, w, h);
            } else {
                _renderer.setSize(w, h);
            }
        }

        //logger.log("width: " + sw + " height: " + sh);

        var i;

        var orig_sw = sw;
        var orig_sh = sh;

        // supersample antialiasing, or post-processed edges, which need a higher resolution;
        // if a mobile device, don't scale up by 2x for post-processing, as this would take a lot of memory and may cause mobile to fail. TODO - true?
        if (_settings.useSSAA || (_postShadingManager.isPostProcShaded() && !_isWeakDevice && _renderer.getPixelRatio() <= 1) && _postShadingManager.postProcessEdgesOn()) {
            /*
                //Create a somewhat larger render target, that is power of 2 size and has mipmap
                sw *= 3 / _renderer.getPixelRatio();
                sh *= 3 / _renderer.getPixelRatio();

                var w = 1;
                while (w < sw) w *= 2;
                var h = 1;
                while (h < sh) h *= 2;

                sw = w;
                sh = h;
                */
                sw *=2;
                sh *=2;

            //force = true;
        }

        var resX = 1.0 / sw;
        var resY = 1.0 / sh;

        //Just the regular color target -- shares depth buffer
        //with the depth target.
        if (force || !_colorTarget || _colorTarget.width != sw || _colorTarget.height != sh) {

            logger.log("Reallocating render targets.");
            this.cleanup();

            _colorTarget = new THREE.WebGLRenderTarget(sw, sh,
                {   minFilter: THREE.LinearFilter,
                    magFilter: THREE.LinearFilter,
                    format: THREE.RGBAFormat,
                    type: _settings.useHdrTarget ? THREE.FloatType : THREE.UnsignedByteType,
                    //anisotropy: Math.min(this.getMaxAnisotropy(), 4),
                    stencilBuffer: false
                });
            // three.js has a flaw in its constructor: the generateMipmaps value is always initialized to true
            _colorTarget.texture.generateMipmaps = false; 
            _colorTarget.name = "colorTarget";

                                           
             
                                                                                                                                                                          
             
                      
            
            _overlayTarget = new THREE.WebGLRenderTarget(sw, sh,
                {  minFilter: THREE.NearestFilter,
                    magFilter: THREE.NearestFilter,
                    format: THREE.RGBAFormat,
                    stencilBuffer: false
                });
            _overlayTarget.texture.generateMipmaps = false; 
            _overlayTarget.name = "overlayTarget";

                                           
            _overlayTarget.shareDepthFrom = _colorTarget;
                     
                                                              
                                                                                                                                               
                                                                   
                    
                                                                  
             
                      

            //Re-check this when render targets change
            _mrtRGBA8Works = _renderer.verifyMRTWorks([_colorTarget, _overlayTarget]);

            _depthTarget = null;
            _postTarget1 = null;
            _postProcDisplayTarget = null;
            _ssaoTarget = null;
            _postTarget2 = null;
            _depthMipMap = [];
        }

        if (_crossFade) {
            _crossFade.updateTargets(sw, sh, force, _settings.useHdrTarget);
        }

        if (isRenderTargetUsed(RenderTargets.Post1))
        {
            if (force || !_postTarget1 || _postTarget1.width != sw || _postTarget1.height != sh) {
                //We need one extra post target if FXAA is on, so
                //to use as intermediate from Blend->FXAA pass.
                _postTarget1 = new THREE.WebGLRenderTarget(sw, sh,
                    {
                        minFilter: THREE.LinearFilter,
                        magFilter: THREE.LinearFilter,
                        format: THREE.RGBAFormat,
                        //anisotropy: 0,
                        //anisotropy: Math.min(this.getMaxAnisotropy(), 4),
                        stencilBuffer: false,
                        depthBuffer: false
                    });
                _postTarget1.texture.generateMipmaps = false; 
                _postTarget1.name = "postTarget1";
            }
        }

        // note that these are used only if _postTarget1 is also used, so _postTarget1 will exist
        if (!_ssaoTarget && isRenderTargetUsed(RenderTargets.SSAO)) {
            _ssaoTarget = _postTarget1.clone();
            _ssaoTarget.name = "SSAO target";
        }

        if (!_postTarget2 && isRenderTargetUsed(RenderTargets.Post2)) {
            _postTarget2 = _postTarget1.clone();
            _postTarget2.name = "post target 2";
        }

        if (!_postProcDisplayTarget && isRenderTargetUsed(RenderTargets.PostDisplay)) {
            // final-image sized intermediate buffer, so antialiasing can be done correctly.
            _postProcDisplayTarget = new THREE.WebGLRenderTarget(orig_sw, orig_sh,
                {
                    minFilter: THREE.LinearFilter,
                    magFilter: THREE.LinearFilter,
                    format: THREE.RGBAFormat,
                    //anisotropy: 0,
                    //anisotropy: Math.min(this.getMaxAnisotropy(), 4),
                    stencilBuffer: false,
                    depthBuffer: false
                });
            _postProcDisplayTarget.texture.generateMipmaps = false; 
            _postProcDisplayTarget.name = "postTargetNormal";
        }

        if (isRenderTargetUsed(RenderTargets.Depth)) {
            if (force || !_depthTarget || _depthTarget.width != sw || _depthTarget.height != sh) {
                _depthTarget = createDepthTarget(sw, sh, _depthTargetFormat, _depthTargetType, _colorTarget);
                
                //SSAO depth/normals mip maps. Those are "manually" created
                //because we use custom sampling. Also, they are separately bound into
                //the shader because there doesn't seem to be an easy way to load them
                //as mip levels of the same texture, in the case they were render buffers initially.
                _depthMipMap = [];
                for (var j = 0; j < 5; j++) {
                    var mipWidth  = 0 | (sw / (2 << j));
                    var mipHeight = 0 | (sh / (2 << j));
                    var mipValid = mipWidth >= 1 && mipHeight >= 1;
                    var mip = null;

                    if (mipValid) {
                        mip = new THREE.WebGLRenderTarget(mipWidth, mipHeight,
                            {   minFilter: THREE.NearestFilter,
                                magFilter: THREE.NearestFilter,
                                format: THREE.RGBAFormat,
                                //type:THREE.FloatType,
                                depthBuffer: false,
                                stencilBuffer: false});
                        mip.texture.generateMipmaps = false;
                        _depthMipMap.push(mip);

                        mip.name = "depthTarget_mipmap " + j;
                    }

                    // Always reset uniforms for all mipmaps - even if skip some. This avoids leaking disposed old ones.
                    _saoPass.uniforms['tDepth_mip' + (j + 1)].value = mip.texture;
                }

                //Re-check this when render targets change
                                               
                {
                    _mrtFloat32Works = _renderer.verifyMRTWorks([_colorTarget, _depthTarget]);
                }
                         
                 
                                                                                                             
                 
                          
                
            }

            _saoPass.uniforms[ 'size' ].value.set(sw, sh);
            _saoPass.uniforms[ 'resolution' ].value.set(resX, resY);
            _saoPass.uniforms[ 'tDepth' ].value = _depthTarget.texture;

            _saoBlurPass.uniforms[ 'size' ].value.set(sw, sh);
            _saoBlurPass.uniforms[ 'resolution' ].value.set(resX, resY);

            _postShadingManager.updateUniformValue('tDepth', _depthTarget);
            _blendPass.uniforms['tDepth'].value = _depthTarget.texture;

        }

        if (isRenderTargetUsed(RenderTargets.ModelId)) {
            if (force || !_idTargets[0]
            || _idTargets[0].width != sw || _idTargets[0].height != sh) {
                for (i=0; i<_idTargets.length; i++) {
                    _idTargets[i] && _idTargets[i].dispose();
                }
                _idTargets = [];
                for (i=0; i<_settings.numIdTargets; i++) {
                    var target = createIdTarget(sw, sh);
                    
                                                   
                    target.shareDepthFrom = _colorTarget;
                             
                                                              
                              
                    target.name = "id " + i;
                    _idTargets.push(target);
                }

                if (!_mrtRGBA8Works) {
                    logger.warn("ID buffer requested, but MRT is not supported. Some features will not work.");
                }

            }

            _postShadingManager.updateUniformValue('tID', _idTargets[0]);

        } else if (_idTargets[0]) {
            for (i=0; i<_idTargets.length; i++) {
                _idTargets[i].dispose();
                _idTargets[i] = null;
            }
            // make sure no _idTargets are defined, since they've been released. LMV-2691
            _idTargets.length = 0;
        }


        _fxaaPass.uniforms[ 'uResolution' ].value.set(resX, resY);
        _postShadingManager.changeResolution(resX, resY);

        _blendPass.uniforms[ 'tOverlay' ].value = _overlayTarget?.texture;
        _blendPass.uniforms[ 'tAO' ].value = _ssaoTarget?.texture;
        _blendPass.uniforms[ 'useAO' ].value = _settings.sao ? 1 : 0;
        _blendPass.uniforms[ 'resolution' ].value.set(resX, resY);
        _blendPass.uniforms[ 'tID' ].value = _idTargets[0]?.texture || null;
        _blendPass.uniforms[ 'tID2' ].value = _idTargets[1]?.texture || null;

        if (_crossFade) {
            _crossFade.updateBlendPass();
        }
    };

    

    this.getMaxAnisotropy = function () {
        return _renderer ? _renderer.getMaxAnisotropy() : 0;
    };

    // HACK: returns MRT flags required by this render context
    // so that the flags can be passed to the material manager
    this.mrtFlags = function() {
        return {
            mrtNormals: _mrtFloat32Works && isRenderTargetUsed(RenderTargets.Depth),
            mrtIdBuffer: (_mrtRGBA8Works && isRenderTargetUsed(RenderTargets.ModelId)) ? _settings.numIdTargets : undefined
        };
    };
    

    /**
     * Adds/Removes and id frame buffer.
     * Supports only 1 or 2 framebuffers. Default is 1.
     * 
     * @param {Number} value - id targets. Accepts only values 1 or 2. Default is 1.
     */
    this.setIdTargetCount = function(value) {
        if (value > 2 || value < 1) return;
        if (value === _settings.numIdTargets) return;
        
        _settings.numIdTargets = value;
        if (_idTargets.length === 0)
            return;
        
        if (value === 2 && _idTargets.length === 1) {
            // Add the model id target
            var sw = _idTargets[0].width;
            var sh = _idTargets[0].height;
            var newTarget = createIdTarget(sw, sh);
                                           
            newTarget.shareDepthFrom = _colorTarget;
                     
                                                         
                      
            newTarget.name = "id " + _idTargets.length;
            _idTargets.push(newTarget);
            _blendPass.uniforms[ 'tID2' ].value = newTarget;
            _blendPass.material.defines.USE_MODEL_ID = "1";
            _blendPass.material.needsUpdate = true;
            return true;
        }
    };

    this.getAntialiasing = function () {
       return _settings.antialias;
    };

    this.initPostPipeline = function (useSAO, useFXAA) {

        //TODO: Do we want to move the IE check to higher level code?
        _settings.sao = useSAO && !isIE11 && _depthTargetSupported;
        _settings.antialias = useFXAA && !isIE11;

        if (_settings.haveTwoSided) {
            forEachDepthMaterial(function(mat){
                mat.side = THREE.DoubleSide;
            });
        }

        //TODO: do we really need to update all these or just the depthMaterial?
        forEachDepthMaterial(function(mat) {
            mat.needsUpdate = true;
        });
        _saoPass.material.needsUpdate = true;
        _saoBlurPass.material.needsUpdate = true;
        _saoMipFirstPass.material.needsUpdate = true;
        _saoMipPass.material.needsUpdate = true;
        _fxaaPass.material.needsUpdate = true;
        _postShadingManager.setMaterialNeedsUpdate();
        _blendPass.material.needsUpdate = true;
        _clearPass.material.needsUpdate = true;
        _copyPass.material.needsUpdate = true;

        //Also reallocate the render targets
        this.setSize(_w, _h);
    };

    this.setClearColors = function (colorTop, colorBot) {
        if (!colorBot) {
            _clearColor = colorTop.clone();
        }
        //If the gradient is trivial, we can use a simple clear instead.
        else if (colorTop.equals(colorBot) || _isWeakDevice) {
            _clearColor = new THREE.Color(
                0.5 * (colorTop.x + colorBot.x),
                0.5 * (colorTop.y + colorBot.y),
                0.5 * (colorTop.z + colorBot.z));
        } else {
            _clearColor = undefined;
        }

        if (!_clearColor) {
            _clearPass.uniforms.color1.value.copy(colorTop);
            _clearPass.uniforms.color2.value.copy(colorBot);
        }
    };

    /**
     * Turn on or off the use of the overlay alpha when computing the diffuse color's alpha
     * @param {Boolean} value - true to enable, false to disable.
     */
    this.useOverlayAlpha = function(value) {
        _useOverlayAlpha = value;
    }

    this.setClearAlpha = function(alpha) {
        _clearAlpha = alpha;
    };

    this.setAOEnabled = function(enabled) {
        _settings.sao = enabled && _depthTargetSupported;
        _oldSettings.sao = _settings.sao;
        // recreate required buffers when sao is turned on; do not reset rendering size
        this.setSize(_w, _h, false, true);
    };

    this.setAOOptions = function (radius, intensity, opacity) {
        
        if (radius !== undefined) {
            _saoPass.uniforms[ 'radius' ].value = radius;

            // It is questionable whether this "isMobileDevice()" test should be here.
            // The shader bias is a world distance, not a screen distance. Still, it
            // may fight some precision problem on mobile. The whole radius/bias system
            // is pretty kludgey.
            _saoPass.uniforms[ 'bias' ].value = isMobileDevice() ? 0.1 : 0.01;
            // more theoretically sound, but isMobileDevice() is still a little questionable:
            //_saoPass.uniforms[ 'bias' ].value = radius * (isMobileDevice() ? 0.1 : 0.01);
            _saoBlurPass.uniforms[ 'radius' ].value = radius;
        }
        if (intensity !== undefined) {
            _saoPass.uniforms[ 'intensity' ].value = intensity;
        }
        //Opacity handles undefined differently (it uses default if undefined given)
        //until all user-facing calls to setAOOptions can handle the new opacity setting.
        if (opacity !== undefined) {
            _blendPass.uniforms[ 'aoOpacity'].value = opacity;
        } else {
            _blendPass.uniforms[ 'aoOpacity'].value = 1.0;
        }
        _saoBufferValid = false;
    };

    this.getAOEnabled = function() {
        return _settings.sao;
    };

    this.getAORadius = function () {
        return _saoPass.uniforms['radius'].value;
    };

    this.getAOIntensity = function() {
        return _saoPass.uniforms['intensity'].value;
    };

    this.setCubeMap = function(map) {
        _clearPass.material.envMap = map;
        if (!map)
            this.toggleEnvMapBackground(false);

        // If we delayed envMap activation in a prior toggleEnvMapBackground call, activate it now.
        if (map && _settings.envMapBg) {
            _clearPass.uniforms.envMapBackground.value = true;
        }
    };

    this.setBackgroundTexture = function (texture) {
        const prevValue = _clearPass.material.useBackgroundTexture;

        _clearPass.uniforms.backgroundTexture.value = texture;
        _clearPass.material.useBackgroundTexture = !!texture;

        if (!!texture !== prevValue) {
            _clearPass.material.needsUpdate = true;
        }
    };

    this.getCubeMap = function() {
        return _clearPass.material.envMap;
    };

    this.setEnvRotation = function(rotation) {
        _envRotation = rotation;
        _clearPass.material.envRotationSin = Math.sin(rotation);
        _clearPass.material.envRotationCos = Math.cos(rotation);
    };

    this.getEnvRotation = function() {
        return _envRotation;
    };

    this.setEnvExposure = function (exposure) {

        const prevValue = _clearPass.material.envMapExposure;
        const newValue = Math.pow(2.0, exposure);

        _clearPass.uniforms['envMapExposure'].value = newValue;

        //The renderer overwrites the uniform's value based on the material's
        //property in refreshUniformsIBL, so set it there too.
        _clearPass.material.envMapExposure = newValue;

        if (newValue !== prevValue) {
            _clearPass.material.needsUpdate = true;
        }

        _exposure = exposure;
    };

    this.setTonemapExposureBias = function (bias) {
        _exposureBias = bias;

        _clearPass.uniforms['exposureBias'].value = Math.pow(2.0, bias);

        //_blendPass.uniforms['exposureBias'].value = Math.pow(2.0, bias);
    };

    this.getExposureBias = function () {
        return _exposureBias;
    };

    //Required for switching camera for stereo rendering
    this.setCamera = function (camera) {
        _camera = camera;
    };

    this.setTonemapMethod = function (value) {

        const prevValue = _tonemapMethod;

        _tonemapMethod  = value;

        if (value === 0) {
                                           
            _renderer.gammaInput = false;
                     
                                                                           
                                                                     
                                            
                      
        }
        else {
            //Tell the renderer to linearize all material colors
                                           
            _renderer.gammaInput = true;
                     
                                           
                      
        }

        _clearPass.material.tonemapOutput = _tonemapMethod;

        if (value !== prevValue) {
            _clearPass.material.needsUpdate = true;
        }

    };

    this.getToneMapMethod = function () {
        return _tonemapMethod;
    };

    this.toggleTwoSided = function (isTwoSided) {

        //In case the viewer encounters two-sided materials
        //it will let us know, so that we can update
        //the override material used for the SAO G-buffer to also
        //render two sided.
        if (_settings.haveTwoSided != isTwoSided) {
            if (_depthMaterial) {
                forEachDepthMaterial(function(mat) {
                    mat.side = isTwoSided ? THREE.DoubleSide : THREE.FrontSide;
                    mat.needsUpdate = true;
                });
            }
        }
        _settings.haveTwoSided = isTwoSided;
    };

    this.toggleEdges = function(state) {
        _settings.renderEdges = state;
        _oldSettings.renderEdges = state; // avoid settings from outside to be overwritten if triggered before exit2DMode switch.
    };

    this.getRenderEdges = function() {
        return _settings.renderEdges;
    };

    this.getRenderEdges = function() {
        return _settings.renderEdges;
    };

    this.toggleEnvMapBackground = function (value) {
        _settings.envMapBg = value;

        // Activate envMap only if the map is already available. Otherwise, we delay it and do it later once setCubeMap is called.
        // This avoids a temporarily black screen if envMap is not loaded yet.
        _clearPass.uniforms.envMapBackground.value = (value && !!_clearPass.material.envMap);
    };

    this.enter2DMode = function(idMaterial, selectionColor) {
        _idMaterial = idMaterial;
        _oldSettings.sao = _settings.sao;
        _oldSettings.antialias = _settings.antialias;
        _oldSettings.idbuffer = _settings.idbuffer;
        _oldSettings.renderEdges = _settings.renderEdges;
        _oldSettings.useIdBufferSelection = _settings.useIdBufferSelection;

        if (selectionColor) {
            _oldSettings.selectionColor = _settings.selectionColor;
            this.setSelectionColor(selectionColor);
        }

        // Always use idBuffer for 2D. For consistency, we even do it for models without ids (e.g. leaflets). Reasons:
        //  1. Latest if we add a vector 2D file after the leaflet later, we still need the idBuffer.
        //  2. Using idBuffer avoids the heuristic detection of highlighting pixels in BlendShader - which may cause unwanted color modifications in overlays.
        _settings.idbuffer = true;

        // Note: If edges are active, the edge rendering pass assumes all main scene geometry to provide edge indices.
        //       Any geometry without edge indices would just re-rendered using the edge shader - which just results in artifacts.
        //       Therefore, disable edge rendering for 2D mode.
        _settings.renderEdges = false;
        _blendPass.material.defines.IS_2D = "";

        // Always use idBuffer selection if idBuffer is available.
        setIdBufferSelectionEnabled(_settings.idbuffer);

        this.initPostPipeline(false, false);
    };

    this.exit2DMode = function() {
        _idMaterial = null;
        _settings.idbuffer = _oldSettings.idbuffer;
        _settings.renderEdges = _oldSettings.renderEdges;
        if (_oldSettings.selectionColor) {
            this.setSelectionColor(_oldSettings.selectionColor);
        }
        delete _blendPass.material.defines.IS_2D;

        // Recover original (3D mode) state of idBufferEnabled flag
        setIdBufferSelectionEnabled(_oldSettings.idbuffer);

        this.initPostPipeline(_oldSettings.sao, _oldSettings.antialias);
    };

    //Returns the value of the ID buffer at the given
    //viewport location. Note that the viewport location is in
    //OpenGL-style coordinates [-1, 1] range.
    //If the optional third parameter is passed in, it's assume to be a two integer array-like,
    //and the extended result of the hit test (including model ID) is stored in it.
    this.idAtPixel = function (vpx, vpy, res, idTargets) {
        return this.idAtPixels(vpx, vpy, 1, res, idTargets);
    };

    // Start the search at the center of the region and then spiral.
    function spiral(px, py, size, readbackBuffer, readbackBuffer2, result, idTargets) {
        // fallback to default targets
        idTargets = idTargets || _idTargets;

        let id;
        let x = 0, y = 0;
        let dx = 0, dy = -1;

        // Set initial values for result.
        // Result structure: [dbId, modelId, vpx, vpy, px, py]
        // vpx & vpy are the viewport hit coordinates.
        // px & py are the original center point in client coordinates - used for caching purposes.
        _lastIdAtPixelsResults[size] = [-1, -1, null, null, px, py, idTargets[0].name];

        for (let i = 0; i < size * size; i++) {

            // Translate coordinates with top left as (0, 0)
            const tx = x + (size - 1) / 2;
            const ty = y + (size - 1) / 2;
            if (tx >= 0 && tx <= size && ty >= 0 && ty <= size) {
                const index = tx + ty * size;
                id = (readbackBuffer[4 * index + 2] << 16) | (readbackBuffer[4 * index + 1] << 8) | readbackBuffer[4 * index];

                //sign extend the upper byte to get back negative numbers (since we clamp 32 bit to 24 bit when rendering ids)
                id = (id << 8) >> 8;
                
                _lastIdAtPixelsResults[size][0] = id;

                if(readbackBuffer2) {
                    var modelId = (readbackBuffer2[4 * index + 1] << 8) | readbackBuffer2[4 * index];
                    //recover negative values when going from 16 -> 32 bits.
                    _lastIdAtPixelsResults[size][1] = (modelId << 16) >> 16;
                }

                _lastIdAtPixelsResults[size][2] = (px + tx) * 2 / idTargets[0].width - 1; // hit x in viewport coords
                _lastIdAtPixelsResults[size][3] = (py + ty) * 2 / idTargets[0].height - 1; // hit y in viewport coords

                // dbIds can be also negative (see F2d.currentFakeId). -1 is the only dbId that actually means "none".
                if (id !== -1) {
                    break;
                }
            }

            if ( (x == y) || (x < 0 && x == -y) || (x > 0 && x == 1-y) ) {
                const t = dx;
                dx = -dy;
                dy = t;
            }

            x += dx;
            y += dy;
        }

        // Copy cached values to output result array.
        copyArray(_lastIdAtPixelsResults[size], result);

        return id;
    }

    this.idAtPixels = function (vpx, vpy, size, result, idTargets) {
        if(!idTargets || !idTargets[0]) {
            idTargets = _idTargets;
        }
        if (!idTargets[0])
            return 0;
        
        // Make sure that size is an odd number. Even numbered size can’t be centered using integers.
        if (size % 2 === 0) {
            size += 1;
        }

        const px = (vpx + 1.0) * 0.5 * idTargets[0].width - (size - 1) * 0.5;
        const py = (vpy + 1.0) * 0.5 * idTargets[0].height - (size - 1) * 0.5;

        if (_lastIdAtPixelsResults[size] && px === _lastIdAtPixelsResults[size][4] && py === _lastIdAtPixelsResults[size][5] && _lastIdAtPixelsResults[size][6] == idTargets[0].name) {

            // Copy cached values to output result array.
            copyArray(_lastIdAtPixelsResults[size], result);

            // Return cached ID.
            return _lastIdAtPixelsResults[size][0];
        }

        const bufferSize = 4 * size * size;

        if (!_idReadbackBuffers[bufferSize]) {
            _idReadbackBuffers[bufferSize] = new Uint8Array(bufferSize);
        }

        const readbackBuffer = _idReadbackBuffers[bufferSize];

        _renderer.readRenderTargetPixels(idTargets[0], px, py, size, size, readbackBuffer);

        let readbackBuffer2;

        if (idTargets[1]) {
            if (!_modelIdReadbackBuffers[bufferSize]) {
                _modelIdReadbackBuffers[bufferSize] = new Uint8Array(bufferSize);
            }
            readbackBuffer2 = _modelIdReadbackBuffers[bufferSize];

            _renderer.readRenderTargetPixels(idTargets[1], px, py, size, size, readbackBuffer2);
        }

        return spiral(px, py, size, readbackBuffer, readbackBuffer2, result, idTargets);
    };

    this.idsAtPixelsBox = function(vpx, vpy, widthRatio, heightRatio, results, idTargets) {
        idTargets = idTargets || _idTargets;

        if (!idTargets[0])
            return;

        var width = widthRatio * idTargets[0].width;
        var height = heightRatio * idTargets[0].height;

        var px = 0 | ((vpx + 1.0) * 0.5 * idTargets[0].width);
        var py = 0 | ((vpy + 1.0) * 0.5 * idTargets[0].height);

        var readbackBuffer = new Uint8Array(4 * width * height);

        _renderer.readRenderTargetPixels(idTargets[0], px, py, width, height, readbackBuffer);

        var readbackBuffer2 = undefined;
        if(results && idTargets[1]) {
            readbackBuffer2 = new Uint8Array(4 * width * height);
            _renderer.readRenderTargetPixels(idTargets[1], px, py, width, height, readbackBuffer2);
        }

        var ids = {};

        for (let i = 0; i < readbackBuffer.length; i += 4) {
            var id = (readbackBuffer[4 * i + 2] << 16) | (readbackBuffer[4 * i + 1] << 8) | readbackBuffer[4 * i];

            //sign extend the upper byte to get back negative numbers (since we clamp 32 bit to 24 bit when rendering ids)
            id = (id << 8) >> 8;
            if (id > 0) {
                var modelId = 0;
                if(readbackBuffer2) {
                    modelId = (readbackBuffer2[4 * i + 1] << 8) | readbackBuffer2[4 * i];
                    //recover negative values when going from 16 -> 32 bits.
                    modelId = (modelId << 16) >> 16;
                }
                //ignore duplicate ids
                var key = id + '-' + modelId;
                if (!ids[key]) {
                    ids[key] = true;
                    results.push([id, modelId]);
                }
            }
        }
    };

    this.readbackTargetId = function() {
        if (!_idTargets[0])
            return null;

        var readbackBuffer = new Uint8Array(4 * _idTargets[0].width * _idTargets[0].height);
        _renderer.readRenderTargetPixels(_idTargets[0], 0, 0, _idTargets[0].width, _idTargets[0].height, readbackBuffer);

        return {
            buffer: readbackBuffer,
            width: _idTargets[0].width,
            height: _idTargets[0].height
        };
    };

    /**
     * {Number} vpx - OpenGL style X-coordinate [-1..1]
     * {Number} vpy - OpenGL style Y-coordinate [-1..1]
     */
    this.rolloverObjectViewport = function (vpx, vpy) {
        _idRes[1] = 0; // Reset model-id to 0
        var objId = this.idAtPixel(vpx, vpy, _idRes);
        return this.rolloverObjectId(objId, null, _idRes[1]);
    };

    // Encode 16-Bit modelId into Vector2
    function modelIdToVec2(modelId, target) {
        target = target || new THREE.Vector2();
        target.set(
            (modelId & 0xFF) / 255,
            ((modelId >> 8) & 0xFF) / 255
        );
        return target;
    }

    // Update BlendShader configuration to specify which modelId(s)
    // are shown with rollOver highlight.
    function setHighlightModelId(modelId) {

        // Handle length-1 arrays exactly like single ids.
        if (Array.isArray(modelId) && modelId.length == 1) {
            modelId = modelId[0];
        }

        // No change => no work.
        if (modelId === _lastHighlightModelId) {
            return false;
        }

        const oldCount = Array.isArray(_lastHighlightModelId) ? _lastHighlightModelId.length : 1;
        const newCount = Array.isArray(modelId)               ? modelId.length               : 1;

        // For multiple ids, stop if arrays are equal
        if (newCount > 1) {
            modelId.sort();

            // Compare element-wise
            if (newCount == oldCount && !_lastHighlightModelId.some((e,i) => e !== modelId[i])) {
                return false;
            }
        }

        // Reconfigure shader if the number of needed modelId parameter changes.
        // In most cases, we will have oldCount == newCount == 1.
        if (newCount != oldCount) {
            
            if (newCount == 1) {
                // Default case - just use single shader param
                delete _blendPass.material.defines["HIGHLIGHT_MODEL_ID_COUNT"];
            } else {
                // Use array-param for modelId
                _blendPass.material.defines["HIGHLIGHT_MODEL_ID_COUNT"] = newCount.toString();
            }
            _blendPass.material.needsUpdate = true;
        }

        _lastHighlightModelId = modelId;

        if (newCount == 1) {
            // Handle length-1 arrays like single ids
            modelId = Array.isArray(modelId) ? modelId[0] : modelId;
        
            // Default case: Just set single shader param
            modelIdToVec2(modelId, _blendPass.uniforms['modelIDv2'].value);
        } else {
            // Set array of modelIds to highlight
            _blendPass.uniforms['modelIDsv2v'].value = modelId.map(id => modelIdToVec2(id));
        }
        return true;
    }

    // Configure BlendShader for highlighting the given object id
    function setHighlightObjectId(objId) {

        // No change => no work.
        if (objId === _lastHighlightId) {
            return false;
        }        
        _lastHighlightId = objId;

        //console.log(objId, modelId);

        //Check if nothing was at that pixel -- 0 means object
        //that has no ID, ffffff (-1) means background, and both result
        //in no highlight.
        if (objId === -1) {
            objId = 0;
        }

        _blendPass.uniforms['objIDv4'].value.set((objId & 0xFF) / 255,
                                                ((objId >> 8) & 0xFF) / 255,
                                                ((objId >> 16) & 0xFF) / 255,
                                                ((objId >> 24) & 0xFF) / 255
                                                );
        return true;
    }

    // Configure rollover highlighting for objects or models
    //  @param {number}          objId
    //  @param {number|number[]} modelId            - One or multiple modelIds to be highlighted.
    //  @param {bool}            highlightFullModel - If true, the whole model is highlighted and the obId is ignored.
    function setRolloverHighlight(objId, modelId, highlightFullModel) {

        // An undefined modelId may happen if a) there is no MODEL_ID buffer or b) nothing is highlighted.
        modelId = modelId || 0;

        // apply new objId and modelId
        const objChanged = setHighlightObjectId(objId);
        const modelChanged = setHighlightModelId(modelId);

        // Only restart highlight fade on actual changes
        if (!objChanged && !modelChanged) {
            return;
        }

        _blendPass.uniforms['highlightIntensity'].value = 0;

        _lastObjTime = performance.now();

        // Determine whether to highlight a single object or whole model(s)
        _blendPass.uniforms['highlightFullModel'].value = highlightFullModel ? 1.0 : 0.0;

        return true;
    };

    /**
     * {Number} objId - Main Integer id to highlight. If it's not a leaf node, 
     *                  then the dbIds (presumable all its children) will also be highlighed, too.
     * {Number} [dbIds] - OPTIONAL, id range to highlight.
     * {Number} [modelId] - OPTIONAL, id of the model containing the id range.
     */
    this.rolloverObjectId = function(objId, dbIds, modelId) {
        return setRolloverHighlight(objId, modelId, false);
    };

    this.getRollOverDbId = function() {
        return _lastHighlightId;
    };

    this.getRollOverModelId = function() {
        return _lastHighlightModelId;
    };

    // Roll-over highlighting for whole model. Requires modelId buffer.
    //  @param {number|number[]} modelId - One or more models to highlight.
    this.rollOverModelId = function(modelId) {
        return setRolloverHighlight(1, modelId, true);
    };

    // Note: Colored highlighting is currently only implemented for 3D. For 3D models, it has no effect.
    //
    // @param {THREE.Color} color - default is white
    // The color that is added to the actual fragment color on hover.
    // Default is white. Choosing a darker color reduces highlighting intensity.
    this.setRollOverHighlightColor = function(color) {
        if (!color) {
            // reset to default (white)
            _blendPass.uniforms['highlightColor'].value.setRGB(1,1,1);
        } else {
            _blendPass.uniforms['highlightColor'].value.copy(color);
        }
    };

    this.setDbIdForEdgeDetection = function(objId, modelId) {

        _blendPass.uniforms['edgeObjIDv4'].value.set((objId & 0xFF) / 255,
                                                        ((objId >> 8) & 0xFF) / 255,
                                                        ((objId >> 16) & 0xFF) / 255,
                                                        ((objId >> 24) & 0xFF) / 255
                                                    );

        _blendPass.uniforms['edgeModelIDv2'].value.set((modelId & 0xFF) / 255,
                                                      ((modelId >> 8) & 0xFF) / 255);

    };


    /** Optional: Spatial filter to restrict mouse-over highlighting based on world-position.
     *   @param {string} [filter] - A shader chunk that defines a spatial filter function.
     *                              It must have the form:
     *                                  bool spatialFilter(vec3 worldPos) { ... }
     *                              If it returns false, a fragment is excluded from rollover highlighting.
     * Call with undefined to remove filter.
     *
     * NOTE: This feature can only be used in combination with SAO, because it
     *       requires the depthTexture.
     */
    this.setSpatialFilterForRollOver = function(filter) {

        // Refuse if not supported
        if (filter && !this.spatialFilterForRollOverSupported()) {
            logger.warn('Spatial filter for mouse-over can only be used with depth target');
            return;
        }

        var macroName = "SPATIAL_FILTER";

        // Avoid expensive recompile if nothing changed
        if (_blendPass.material.defines[macroName] === filter) {
            return;
        }

        if (!filter || filter === '') {
            // Note that just assigning 'undefined' would not work here. The macro would
            // still be defined and appear as "#define SPATIAL_FILTER undefined" in the shader.
            delete _blendPass.material.defines[macroName];
        } else {
            _blendPass.material.defines[macroName] = filter;
        }
        _blendPass.material.needsUpdate = true;

        // Restart fading of highlighting intensity
        _blendPass.uniforms['highlightIntensity'].value = 0;
        _lastObjTime = performance.now();
    };

    // This feature uses a depthTexture in blendPass, which is only
    // available if SAO is active and supported.
    this.spatialFilterForRollOverSupported = function() {
        return isRenderTargetUsed(RenderTargets.Depth);
    };

    this.setEdgeColor = function(colorAsVec4) {
        _edgeColor.copy(colorAsVec4);
    };

    this.setSelectionColor = function(color) {
        // The selection color is gamma corrected using 2.0.
        var gamma = new THREE.Color(color);
        gamma.r = Math.pow(gamma.r, 2.0);
        gamma.g = Math.pow(gamma.g, 2.0);
        gamma.b = Math.pow(gamma.b, 2.0);
        _blendPass.uniforms['selectionColor'].value.set(gamma);
        _blendPass.material.needsUpdate = true;
        _settings.selectionColor = color;
    };

    this.setUnitScale = function(metersPerUnit) {
        _unitScale = metersPerUnit;
    };

    this.getUnitScale = function() {
        return _unitScale;
    };

    this.getBlendPass = function() {
        return _blendPass;
    };

    this.getClearPass = function() {
        return _clearPass;
    };

    // TODO_NOP: hack expose colorTarget so shadow/reflection can draw into
    this.getColorTarget = function() {
        return _colorTarget;
    };
    this.getIDTargets = function() {
        return _idTargets;
    };

    /**
     * @returns {WebGLRenderTarget} Normal/depth target for this context (if rendered)
     */
    this.getDepthTarget = function() {
        return _depthTarget;
    };

    /**
     * @returns {WebGLRenderTarget} Model ID target for this context (if rendered)
     */
    this.getIdTarget = function() {
        return _idTargets[0];
    };

    this.getOverlayIdTarget = function() {
        return _overlayIdTarget;
    };

    // TODO_NOP: hack expose depthMaterial to register with matman for cutplanes
    this.getDepthMaterial = function() {
        return _depthMaterial;
    };

    this.getPostTarget = function() {
        return _postTarget1;
    };

    //TODO: Why not, adding another NOP-style hack
    this.getEdgeMaterial = function() {
        return _edgeMaterial;
    };

    // Allows to register a cross-fade object that manages multiple color targets and can control which content
    // is rendered to which target.
    this.setCrossFade = function(crossFade) {
        _crossFade = crossFade;
    };
    this.getCrossFade = function() {
        return _crossFade;
    };

    /** If an offset target is set (default null), the final rendering result is not presented
     *  anymore, but rendered to the given offscreen target. setOffscreenTarget(null) resets to
     *  normal canvas rendering.
     *   @param {THREE.WebGLTarget} target
     */
    this.setOffscreenTarget = function(target) {
        _offscreenTarget = target;
    };

    this.getOffscreenTarget = function() {
        return _offscreenTarget;
    };

    this.getNamedTarget = function(targetName) {
        switch (targetName) {
            case 'color': return _colorTarget;
            case 'overlay': return _overlayTarget;
            case 'id': return _idTargets[0];
            case 'post1': return _postTarget1;
            case 'post2': return _postTarget2;
            case 'postdisplay': return _postProcDisplayTarget;
            case 'ssao': return _ssaoTarget;
            case 'depth': return _depthTarget;
        }
        return null;
    };

    /**
     * @returns {WebGLFramebuffer} Currently bound framebuffer for this context
     */
    this.getCurrentFramebuffer = function() {
        return _renderer.getCurrentFramebuffer();
    };

    // Returns a state object combines various configuration settings that may be modified from outside.
    this.getConfig = function() {
        return {
            renderEdges:         _settings.renderEdges,
            envMapBackground:    _settings.envMapBg,
            envMap:              _clearPass.material.envMap,
            envExposure:         _exposure,
            toneMapExposureBias: _exposureBias,
            envRotation:         this.getEnvRotation(),
            tonemapMethod:       _tonemapMethod,
            clearColor:          _clearColor && _clearColor.clone(),
            clearColorTop:       !_clearColor && _clearPass.uniforms.color1.value.clone(),
            clearColorBottom:    !_clearColor && _clearPass.uniforms.color2.value.clone(),
            clearAlpha:          _clearAlpha,
            useOverlayAlpha:     _useOverlayAlpha,
            aoEnabled:           this.getAOEnabled(),
            aoRadius:            this.getAORadius(),
            aoIntensity:         this.getAOIntensity(),
            twoSided:            _settings.haveTwoSided,
            edgeColor:           _edgeColor.clone(),
            unitScale:           this.getUnitScale(),
            is2D:                !!_blendPass.material.defines.IS_2D,
            antialias:           this.getAntialiasing(),
            idMaterial:          _idMaterial, // needed for 2D
            selectionColor:      _settings.selectionColor
        };
    };

    this.applyConfig = function(config) {
        this.toggleEdges(config.renderEdges);
        this.toggleEnvMapBackground(config.envMapBackground);
        this.setCubeMap(config.envMap);
        this.setEnvExposure(config.envExposure);
        this.setTonemapExposureBias(config.toneMapExposureBias);
        this.setEnvRotation(config.envRotation);
        this.setTonemapMethod(config.tonemapMethod);
        this.toggleTwoSided(config.twoSided);
        this.setEdgeColor(config.edgeColor);
        this.setUnitScale(config.unitScale);

        if (config.clearColor) {
            this.setClearColors(config.clearColor);
        } else {
            this.setClearColors(config.clearColorTop, config.clearColorBottom);
        }
        this.setClearAlpha(config.clearAlpha);
        this.useOverlayAlpha(config.useOverlayAlpha);

        // Enter/Exit 2D/3D mode if necessary
        var is2D = !!_blendPass.material.defines.IS_2D;
        if (config.is2D && !is2D) {
            this.enter2DMode(config.idMaterial, config.selectionColor);
        } else if (!config.is2D && is2D) {
            this.setSelectionColor(config.selectionColor);
            this.exit2DMode();
        }

        // Toggling SAO or antialiasing needs to reinitialize post pipeline.
        // Note: In theory, it may happen that initPostPipeline runs twice if there 
        //       was already a 2D/3D mode switch above. But that's not really a frequent case.
        var saoChanged       = (config.aoEnabled != this.getAOEnabled());
        var antialiasChanged = (config.antialias != this.getAntialiasing());
        if (saoChanged || antialiasChanged) {
            this.initPostPipeline(config.aoEnabled, config.antialias);
        }
    };

    // Reads a WebGLRenderTarget into a 2D canvas.
    // Returns { canvas, ctx } providing canvas and its 2d context.
    this.targetToCanvas = function(target) {
        var w = target.width;
        var h = target.height;
        // Render into buffer.
        //TODO: This is making a quite large memory allocation in addition to the source render target
        //and target HTML canvas. We can instead refactor the code to copy the data into the target
        //row by row or a few rows at a time in case memory allocation here becomes an issue.
        var buffer = new Uint8Array(w * h * 4);
        _renderer.readRenderTargetPixels(target, 0, 0, w, h, buffer);
    
        // Create working canvas
        var tmpCanvas = _document.createElement('canvas');
        tmpCanvas.width = w;
        tmpCanvas.height = h;
        var ctx = tmpCanvas.getContext('2d');
    
        var imgData;
        var cbuf = new Uint8ClampedArray(buffer);
        if (isIE11) {
            imgData = ctx.createImageData(w, h);
            imgData.data.set(cbuf);
        } else {
            imgData = new ImageData(cbuf, w, h);
        }
    
        ctx.putImageData(imgData, 0, 0);
    
        // Flip vertically
        ctx.globalCompositeOperation = 'copy';
        ctx.translate(0, h);
        ctx.scale(1, -1);
        ctx.drawImage(tmpCanvas, 0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
    
        return {
            canvas: tmpCanvas,
            ctx: ctx,
        };
    };
}
