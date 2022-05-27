import { ShaderPass } from './ShaderPass';
import { GaussianPass } from './GaussianPass';
import { BackgroundShader } from './BackgroundShader';
import screen_quad_uv_vert from './shaders/screen_quad_uv_vert.glsl';
import groundreflection_draw_frag from './shaders/groundreflection_draw_frag.glsl';
import { GroundCommon } from './GroundCommon';
import { GroundFlags } from "./GroundFlags";
import * as THREE from "three";

var GroundReflectionDrawShader = {
    uniforms: {
        tDiffuse: { type: "t", value: null },
    },

    vertexShader: screen_quad_uv_vert,
    fragmentShader: groundreflection_draw_frag
};

export let GroundReflection = function(renderer, width, height, params) {

    var _renderer = renderer;
    var _gl = _renderer.getContext();
    var _width = width || 512;
    var _height = height || 512;
    var _gaussianPass, _drawPass;
    var _groundPlane, _groundCenter;
    var _reflCamera;
    var _isGroundCulled = false;
    var _clearColor = new THREE.Color(0,0,0);
    var _clearPass, _useClearPass = false;
    var _envMapBg = false;

    this.inTarget = undefined;
    this.outTarget = undefined;

    var _needClear = true;

    var _status = GroundFlags.GROUND_UNFINISHED;

    // param defaults
    var _params = {
        color: new THREE.Color(1.0, 1.0, 1.0),
        alpha: 0.3,
        texScale: 0.5,
        blurRadius: 2,
        blurTexScale: 0.5,
        fadeAngle: Math.PI/18
    };

    // PRIVATE FUNCTIONS

    var getReflectionMatrix = function(plane) {
        var N = plane.normal;
        var C = plane.constant;
        return (new THREE.Matrix4()).set(
            1 - 2 * N.x * N.x,   - 2 * N.y * N.x,   - 2 * N.x * N.z, - 2 * C * N.x,
              - 2 * N.x * N.y, 1 - 2 * N.y * N.y,   - 2 * N.y * N.z, - 2 * C * N.y,
              - 2 * N.x * N.z,   - 2 * N.y * N.z, 1 - 2 * N.z * N.z, - 2 * C * N.z,
                            0,                 0,                 0,             1
        );
    };

    // PUBLIC FUNCTIONS
    // note: currently scale is not used
    this.setTransform = function(center, upDir, scale) {
        _groundCenter = center;
        _groundPlane.normal = upDir;
        _groundPlane.constant = -center.dot(upDir);
    };

    this.cleanup = function() {
        if (_gaussianPass)  _gaussianPass.cleanup();
        if (this.inTarget)  this.inTarget.dispose();
        if (this.outTarget) this.outTarget.dispose();
    };

    this.setSize = function(width, height) {
        _width = width;
        _height = height;

        this.cleanup();

        // init targets

        this.inTarget = new THREE.WebGLRenderTarget(
            _width * _params.texScale,
            _height * _params.texScale,
            {
                magFilter: THREE.LinearFilter,
                minFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                stencilBuffer: false
            }
        );
        this.inTarget.texture.generateMipmaps = false;
        this.inTarget.name = "GroundReflection inTarget";

        // outTarget is where we're rendering the ground reflection image (without anything else)
        // and that we will merge with the regular rendering by putting it on a quad.
        this.outTarget = new THREE.WebGLRenderTarget(
            _width * _params.texScale,
            _height * _params.texScale,
            {
                magFilter: THREE.LinearFilter,
                minFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                stencilBuffer: false
            }
        );
        this.outTarget.texture.generateMipmaps = false;
        this.outTarget.name = "GroundReflection outTarget";

        // init gaussian pass

        if (!_gaussianPass)
            _gaussianPass = new GaussianPass(
                _width * _params.texScale * _params.blurTexScale,
                _height * _params.texScale * _params.blurTexScale,
                _params.blurRadius,
                1.0, {
                    hasAlpha: true,
                    blending: true,
                    flipUV: true
                });
        else
            _gaussianPass.setSize(
                _width * _params.texScale * _params.blurTexScale,
                _height * _params.texScale * _params.blurTexScale);
    };

    this.updateCamera = function(camera) {
        // do not render if camera cannot see top of plane
        var camTarget;
        if ( camera.isPerspective ) {
            // For perspective camera, see if camera location -> point on plane
            // dotted with the plane's normal is positive. If so, camera is below
            // plane and ground can be culled.
            camTarget = _groundCenter.clone();
        } else {
            // For orthographic camera, see if camera direction (target - position) 
            // dotted with the plane's normal is positive. If so, camera is below
            // plane and ground can be culled.
            camTarget = camera.target.clone();
        }
        var camDir = camera.position.clone().sub(camTarget).normalize();
        var camAngle = Math.PI/2 - camDir.angleTo(_groundPlane.normal);
        _isGroundCulled = camAngle < 0;

        if (_isGroundCulled) return;

        // fade out
        if (_params.fadeAngle > 0) {
            var fadeAmount = Math.min(_params.fadeAngle, camAngle) / _params.fadeAngle;
            _gaussianPass.setAlpha(fadeAmount * _params.alpha);
        }

        // construct reflected camera
        var reflMatrix = getReflectionMatrix(_groundPlane);
        _reflCamera = camera.clone();
        _reflCamera.applyMatrix4(reflMatrix);
        // MAGIC: scale negative Y and flip UV gives us correct result without messing with face winding
        _reflCamera.projectionMatrix.elements[5] *= -1;
        _reflCamera.matrixWorldNeedsUpdate = true;

        // copy worldUpTransform
        if (camera.worldUpTransform)
            _reflCamera.worldUpTransform = camera.worldUpTransform.clone();
        else
            _reflCamera.worldUpTransform = new THREE.Matrix4();
    };

    this.renderIntoReflection = function(scene) {
        if (_isGroundCulled) return;
        _renderer.setRenderTarget( this.inTarget );

        _renderer.render(scene, _reflCamera);
    };


    this.prepareGroundReflection = (function() {
        var scenesPerModel = [];
        var qScenes;
        var qSceneCount = 0;
        var qSceneIdx = 0;

        var MAX_PROCESS_FRAMES = 100;
        var maxScenesPerFrame = 0;

        return function (groundShadow, viewerImpl, forceDraw, minScenesPerFrame, maxTime, ratio) {

            var modelQueue = viewerImpl.modelQueue();

            // if the ground reflection is finished, leave
            if ( (_status !== GroundFlags.GROUND_UNFINISHED) || modelQueue.isEmpty() ) {
                // this call did not render it, so make sure the rendered status is set to finished.
                _status = GroundFlags.GROUND_FINISHED;
                return maxTime;
            }

            // This will happen once the linear render list is replaced
            // by the BVH.
            const newScenesPerModel = modelQueue.getGeomScenesPerModel();
            _needClear = this.needsClear(scenesPerModel, newScenesPerModel) || _needClear;

            // Get a separate set of scenes (render batches) for us to traverse. Everything gets traversed.
            if (_needClear) {
                _needClear = false;

                // if it's not visible, don't bother
                // TODO this should really be tested once when making command list - if culled, don't even
                // do anything with reflection or with displaying ground plane.
                this.updateCamera(viewerImpl.camera);
                if (this.isGroundCulled()) {
                    _status = GroundFlags.GROUND_FINISHED;
                    return maxTime;
                }

                this.clear();

                scenesPerModel = newScenesPerModel;
                qScenes = modelQueue.getGeomScenes();
                qSceneCount = qScenes.length;
                qSceneIdx = 0;
                if ( minScenesPerFrame ) {
                    maxScenesPerFrame = Math.max( Math.ceil(qSceneCount / MAX_PROCESS_FRAMES), minScenesPerFrame );
                } else {
                    maxScenesPerFrame = qSceneCount;
                }
                _status = GroundFlags.GROUND_UNFINISHED;

            } else if (_status !== GroundFlags.GROUND_UNFINISHED) {
                // finished, or just finished rendering last frame, or not visible;
                // set status to definitively finished.
                _status = GroundFlags.GROUND_FINISHED;
                return maxTime;
            } else if ( minScenesPerFrame === 0 ) {
                // render rest of scene, time permitting
                maxScenesPerFrame = qSceneCount;
            }

            // progressive draw into reflection
            var startTime, budget;

            if ( maxTime ) {
                startTime = performance.now();
                ratio = (ratio === undefined) ? 1.0 : ratio;
                budget = ratio * maxTime;
            }

            // TODO this is a bug in the old system: we should really use the BVH iterator here,
            // so that (a) it's draw with frustum culling (should be faster) and (b) transparency is
            // done properly from back to front. Need to get system to work properly before undertaking
            // this task.
            var retval;
            var i = 0;
            while ((i < maxScenesPerFrame) && (qSceneIdx < qSceneCount)) {
                // Note that we'll always render at least one batch here, regardless of time.
                // Not sure this is necessary, but it does avoid something going bad that causes
                // the timer to always fail and so get us caught in an infinite loop of calling
                // this method again and again.
                var qScene = qScenes[qSceneIdx++];

                if (qScene) {
                    i++;
                    // passing forceVisible to WebGLRenderer.projectObject()
                    qScene.forceVisible = true;
                    // Note we render everything in the scene (render batch) to the ground plane,
                    // so we don't have to worry about frustum culling, etc. - just blast through.
                    this.renderIntoReflection(qScene);
                    qScene.forceVisible = false;

                    // check time, if used
                    if (maxTime) {
                        var timeElapsed = performance.now()-startTime;
                        // is time up and we're not done?
                        if ( (budget < timeElapsed) && (qSceneIdx < qSceneCount)) {
                            // couldn't finish render in time
                            _status = GroundFlags.GROUND_UNFINISHED;
                            retval = maxTime - timeElapsed;
                            break;
                        }
                    }
                }
            }

            // Did we finish? We only reach this path if the maxObj limit is reached.
            if ( qSceneIdx < qSceneCount) {
                _status = GroundFlags.GROUND_UNFINISHED;
                // return time left, or 1, meaning we're not done.
                retval = maxTime ? (maxTime - performance.now() + startTime ) : 1;
            }

            // Should we create an intermediate result for display?
            // Yes, if we're done rendering (retval is undefined), or if we're forcing it
            // because progressive rendering is on and this is the first tick's result.
            if ( retval === undefined || forceDraw ) {
                // We just finished, great, do the post-process
                this.postprocess(viewerImpl.camera, viewerImpl.matman());

                if (groundShadow && groundShadow.enabled) {
                    viewerImpl.renderGroundShadow(this.outTarget);
                }

                this.renderReflection(viewerImpl.camera, viewerImpl.renderer().getColorTarget());

                // We give back a sign that it was *this* call that actually finished up.
                if ( retval === undefined )
                    _status = GroundFlags.GROUND_RENDERED;
                return maxTime ? (maxTime - performance.now() + startTime ) : 1;
            } else {
                return retval;
            }

        };
    })();


    // The way the reflection pass works is that we render the reflection
    // and blur it, etc. and the result is in outTarget. This method then
    // merges the color buffer and the reflection image by rendering the
    // reflection image on a screen-fillinq quad (well, a triangle) and
    // setting depth range so that the depth value is 0.999999+, i.e., at
    // the back of the scene.
    // This sort of merge draw means the color target can be left as-is,
    // no ping-ponging need occur, the reflection is put right into it.
    this.renderReflection = function(camera, target) {
        if (_isGroundCulled) return;

        // Shove the quad with the reflection image to the back of the color buffer.
        // NOTE: depthRange does not appear to work on Chrome on Windows. See
        // _drawPass.scene.position.z for further corrective measure.
        // Also see https://jira.autodesk.com/browse/LMV-1262
        _gl.depthRange(0.999999, 1);
        _drawPass.render(_renderer, target, this.outTarget);
        // restore default range
        _gl.depthRange(0, 1);
    };

    this.toggleEnvMapBackground = function (value) {

        _envMapBg = value;
        _clearPass.uniforms.envMapBackground.value = value;
    };

    this.postprocess = function(camera) {
        if (_isGroundCulled) return;

        // clear outTarget with bg color
        if (_useClearPass || _envMapBg) {
            const uCamDir = _clearPass.uniforms['uCamDir'].value || new THREE.Vector3();
            _clearPass.uniforms['uCamDir'].value = camera.worldUpTransform ? camera.getWorldDirection(uCamDir).applyMatrix4(camera.worldUpTransform) : camera.getWorldDirection(uCamDir);
            _clearPass.uniforms['uCamUp'].value = camera.worldUpTransform ? camera.up.clone().applyMatrix4(camera.worldUpTransform) : camera.up;
            _clearPass.uniforms['uResolution'].value.set(_width, _height);
            _clearPass.uniforms['uHalfFovTan'].value = Math.tan(THREE.Math.degToRad(camera.fov * 0.5));

            _clearPass.render(_renderer, this.outTarget);
            _renderer.setRenderTarget( this.outTarget );
            _renderer.clear( false, true, false );
        }
        else {
            _renderer.setClearColor(_clearColor, 1.0);
            _renderer.setRenderTarget( this.outTarget );
            _renderer.clear( true, true, false );
        }

        // blur inTarget with alpha blending over bg in outTarget
        _gaussianPass.render(_renderer, this.outTarget, this.inTarget);
    };

    this.clear = function() {
        // clear with bgColor otherwise there'll be outline problem
        // using the cheaper flat clear color in this case
        _renderer.setClearColor(_clearColor, 0);
        _renderer.setRenderTarget( this.inTarget );
        _renderer.clear( true, true, false );
                                       
        {
            _renderer.clearBlend();
        }
                 
         
                                                          
         
                  
    };

    // params are normalized clamped THREE.Vector3
    this.setClearColors = function(colorTop, colorBot, skipClearPass) {
        if (!colorBot) {
            _clearColor.copy(colorTop);
            _useClearPass = false;
        }
        else {
            _clearColor.setRGB(
                0.5 * (colorTop.x + colorBot.x),
                0.5 * (colorTop.y + colorBot.y),
                0.5 * (colorTop.z + colorBot.z));

            // same logic as RenderContext.setClearColors
            _useClearPass =
                !colorTop.equals(colorBot) && !skipClearPass;
                //!av.isAndroidDevice() &&
                //!av.isIOSDevice();
        }

        if (_useClearPass) {
            _clearPass.uniforms.color1.value.copy(colorTop);
            _clearPass.uniforms.color2.value.copy(colorBot);
        }
    };

    this.setEnvRotation = function(rotation) {
        _clearPass.material.envRotationSin = Math.sin(rotation);
        _clearPass.material.envRotationCos = Math.cos(rotation);
    };

    this.isGroundCulled = function() {
        return _isGroundCulled;
    };

    this.getStatus = function() {
        return _status;
    };

    this.setDirty = function() {
        _needClear = true;
        _status = GroundFlags.GROUND_UNFINISHED;
    };

    this.setColor = function(color) {
        _gaussianPass.setColor(_params.color);
        _params.color.set(color);
    };

    this.setAlpha = function(alpha) {
        _gaussianPass.setAlpha(_params.alpha);
        _params.alpha = alpha;
    };

    // INITIALIZATION

    if (params) {
        for (var i in _params) {
            _params[i] = (params[i] !== undefined) ? params[i] : _params[i];
        }
    }

    // init passes

    _drawPass = new ShaderPass(GroundReflectionDrawShader);
    _drawPass.material.blending = THREE.NoBlending;
    _drawPass.material.depthTest = true;
    _drawPass.material.depthWrite = false;
    // Put the screen-filling quad at the back of the view volume.
    // This is slightly dangerous, it could go "too far", so we put it at
    // -0.999999 to keep it from being on the razor's edge.
    // See https://jira.autodesk.com/browse/LMV-1262
    _drawPass.scene.position.z = -0.999999;

    if (params.clearPass) {
        _clearPass = params.clearPass;
    } else {
        _clearPass = new ShaderPass(BackgroundShader);
        _clearPass.material.blending = THREE.NoBlending;
        _clearPass.material.depthWrite = false;
        _clearPass.material.depthTest = false;
    }

    // init targets
    this.setSize(_width, _height);

    _gaussianPass.setAlpha(_params.color);
    _gaussianPass.setAlpha(_params.alpha);

    // init plane

    _groundPlane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
    _groundCenter = new THREE.Vector3(0, 0, 0);

};

GroundReflection.prototype = GroundCommon.prototype;
GroundReflection.prototype.constructor = GroundReflection;
