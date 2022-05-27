import { createShaderMaterial } from './ShaderUtils';
import { ShaderPass } from './ShaderPass';
import groundshadow_depth_vert from './shaders/groundshadow_depth_vert.glsl';
import groundshadow_depth_frag from './shaders/groundshadow_depth_frag.glsl';
import screen_quad_uv_vert from './shaders/screen_quad_uv_vert.glsl';
import groundshadow_ao_frag from './shaders/groundshadow_ao_frag.glsl';
import groundshadow_blur_frag from './shaders/groundshadow_blur_frag.glsl';
import groundshadow_color_frag from './shaders/groundshadow_color_frag.glsl';
import { GroundCommon } from "./GroundCommon";
import { GroundFlags } from "./GroundFlags";
import * as THREE from "three";

var GroundDepthShader = {
    uniforms: {
        "cutplanes" : { type:"v4v", value: [] },
    },

    vertexShader: groundshadow_depth_vert,
    fragmentShader: groundshadow_depth_frag
};

var GroundShadowAOShader = {
    uniforms: {
        tDepth: { type: "t", value: null },
        worldSize: { type: "v3", value: new THREE.Vector3(1,1,1) }
    },

    defines : {

    },

    vertexShader: screen_quad_uv_vert,
    fragmentShader: groundshadow_ao_frag
};


var GroundShadowBlurShader = {
    uniforms: {
        tDepth: { type: "t", value: null }
    },

     defines: {
    //     KERNEL_SCALE:  1.0 / 64.0,
    //     KERNEL_RADIUS: 7.0
    //      BOX : 1
     },

    vertexShader: screen_quad_uv_vert,
    fragmentShader: groundshadow_blur_frag
};


var GroundShadowColorShader = {
    uniforms: {
        tDepth: { type: "t", value: null },
        uShadowColor: { type: "v4", value: new THREE.Vector4(0, 0, 0, 1) },
    },

    vertexShader: screen_quad_uv_vert,
    fragmentShader: groundshadow_color_frag
};


// create plane shape to render shadow on the ground. It is a quad located in the z=0.0 plane
// with an xy-extent of [-0.5, -0.5].
export function createGroundShape(material) {

    var planeGeo = new THREE.PlaneBufferGeometry(1,1);

    // invert orientation so that it finally faces upwards
    if (planeGeo.index.array.reverse) {
        planeGeo.index.array.reverse();
    } else {
        // IE11...
        // in-place swapping
        var tmp;
        var arr = planeGeo.index.array;
        var half = Math.floor(arr.length/2);
        for (var i=0, len=arr.length; i<half; ++i) {
            tmp = arr[i];
            arr[i] = arr[len-1-i];
            arr[len-1-i] = tmp;
        }
    }

    var planeMesh = new THREE.Mesh(planeGeo, material);
    return planeMesh;
}

let m, from, bottomFaceCenter;

export function setGroundShapeTransform(mesh, center, size, worldUp, rightAxis) {

    if (!m) m = new THREE.Matrix4();
    if (!from) from = new THREE.Vector3();
    if (!bottomFaceCenter) bottomFaceCenter = new THREE.Vector3();

    // compute rotation
    from.subVectors(center, worldUp);
    m.lookAt(from, center, rightAxis);

    // the ground shape quad center is the lower-face center of the bbox
    bottomFaceCenter.copy(worldUp).multiplyScalar(-0.5 * size.y).add(center);

    // plane transform
    mesh.position.copy(bottomFaceCenter);
    mesh.rotation.setFromRotationMatrix(m);
    mesh.scale.set(size.z, size.x, size.y);
}

export function GroundShadow(renderer, params) {

    var _renderer = renderer;
    var _camera;
    var _scene;
    var _planeMesh;
    var _targetH, _targetV;
    var _matDepth, _matColor;
    var _blurPassH, _blurPassV, _aoPass;
    var _debugBox;

    var _bufferValid = false;

    var USE_AO_PASS = false;

    var _needClear = true;

    var _status = GroundFlags.GROUND_FINISHED;

    // param defaults
    var _params = {
        texSize: USE_AO_PASS ? 128.0 : 64.0,
        pixScale: 1.0,
        blurRadius: USE_AO_PASS ? 5.0 : 7.0,
        debug: false
    };

    // FUNCTIONS

    /**
     * Set transform of the ground shadow system
     * @param {Vector3} center  center of bounding box
     * @param {Vector3} size    size in look&up coordinates, look = y
     * @param {Vector3} lookDir look direction, where ground camera is facing
     * @param {Vector3} upDir   up direction for ground camera
     */
    this.setTransform = (function() {
        var prevCenter = new THREE.Vector3(0, 0, 0);
        var prevSize = new THREE.Vector3(0, 0, 0);
        var prevLookDir = new THREE.Vector3(0, 0, 0);
        var prevUpDir = new THREE.Vector3(0, 0, 0);

        return function (center, size, lookDir, upDir) {

            // check if changed - if not, it saves us an entire ground shadow redraw!
            if ( center.equals(prevCenter) &&
                size.equals(prevSize) &&
                lookDir.equals(prevLookDir) &&
                upDir.equals(prevUpDir) ) {

                return;
            }

            prevCenter.copy(center);
            prevSize.copy(size);
            prevLookDir.copy(lookDir);
            prevUpDir.copy(upDir);

            // something's changing, so need to regenerate ground shadow
            this.setDirty();

            // ortho frustrum
            _camera.left   = -size.z / 2.0;
            _camera.right  =  size.z / 2.0;
            _camera.top    =  size.x / 2.0;
            _camera.bottom = -size.x / 2.0;
            _camera.near   =  1.0;
            _camera.far    =  size.y + _camera.near;

            // update projection
            _camera.updateProjectionMatrix();

            setGroundShapeTransform(_planeMesh, center, size, lookDir, upDir);

            // camera transform
            _camera.position.addVectors(center, lookDir.clone().multiplyScalar(-size.y/2.0 - _camera.near));
            if(upDir) _camera.up.set(upDir.x, upDir.y, upDir.z);
            _camera.lookAt(center);

            // debug box
            if (_params.debug) {
                _debugBox.position.set(center.x, center.y, center.z);
                _debugBox.rotation.set(_camera.rotation.x, _camera.rotation.y, _camera.rotation.z);
                _debugBox.scale.set(size.z, size.x, size.y);
            }

            _aoPass.uniforms['worldSize'].value.copy(size);
        };
    })();

    this.renderIntoShadow = function(scene) {
        //Skip ghosted objects
        if (scene.overrideMaterial && scene.overrideMaterial.transparent)
            return;

        var oldMat = scene.overrideMaterial;
        scene.overrideMaterial = _matDepth;

        _renderer.setRenderTarget( _targetH );
        _renderer.render(scene, _camera);
        scene.overrideMaterial = oldMat;
    };

    // Generate ground shadow texture. Return GROUND code.
    // The ground shadow generation has two modes:
    // No argument means render the whole shadow until done
    // else, argument means render the shadow until time is up.
    // This second mode is mean for progressive rendering of small scenes;
    // if during command creation we approximate that the whole shadow process
    // will be done quickly enough, we try to render it fully in the allotted time.

    // Arguments are:
    //   modelQueue - what to render
    //   maxTime - current budget left. Infinite, if not specified.
    //   ratio - how much of this budget we get. 1.0 if not specified.
    //   maxObjs - can also give a maximum number of objects.
    // returns time left, if maxTime is specified; else just returns maxTime value (undefined).
    this.prepareGroundShadow = (function() {
        var scenesPerModel = [];
        var qScenes;
        var qSceneCount = 0;
        var qSceneIdx = 0;

        var MAX_PROCESS_FRAMES = 100;
        var maxScenesPerFrame = 0;

        return function (modelQueue, minScenesPerFrame, maxTime, ratio) {

            // if the ground shadow is off, don't continue
            if (!this.enabled || modelQueue.isEmpty()) {
                _status = GroundFlags.GROUND_FINISHED;
                return maxTime;
            }

            // This will happen once the linear render list is replaced
            // by the BVH.
            const newScenesPerModel = modelQueue.getGeomScenesPerModel();
            _needClear = this.needsClear(scenesPerModel, newScenesPerModel) || _needClear;

            // Get a separate set of scenes (render batches) for us to traverse. Everything gets traversed.
            if (_needClear) {
                this.clear();
                _needClear = false;

                scenesPerModel = newScenesPerModel;
                qScenes = modelQueue.getGeomScenes();
                qSceneCount = qScenes.length;
                qSceneIdx = 0;
                if ( minScenesPerFrame ) {
                    maxScenesPerFrame = Math.max( Math.ceil(qSceneCount / MAX_PROCESS_FRAMES), minScenesPerFrame );
                } else {
                    maxScenesPerFrame = qSceneCount;
                }
            } else if (_status === GroundFlags.GROUND_RENDERED || _status === GroundFlags.GROUND_FINISHED) {
                // If drop shadow is valid, we're done, no rendering needed.
                // this call did not render it, so make sure the rendered status is set to finished.
                _status = GroundFlags.GROUND_FINISHED;
                return maxTime;
            } else if ( minScenesPerFrame === 0 ) {
                // render rest of scene, time permitting
                maxScenesPerFrame = qSceneCount;
            }

            // progressive draw into shadow
            var startTime, budget;

            if ( maxTime ) {
                startTime = performance.now();
                ratio = (ratio === undefined) ? 1.0 : ratio;
                budget = ratio * maxTime;
            }
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
                    this.renderIntoShadow(qScene);
                    qScene.forceVisible = false;

                    // check time, if used
                    if (maxTime) {
                        var timeElapsed = performance.now()-startTime;
                        // is time up and we're not done?
                        if ( budget < timeElapsed ) {
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

            if ( retval !== undefined ) {
                // out of time, or done with object quota
                return retval;
            }

            // We just finished, great, do the post-process
            this.postprocess();

            // We give back a sign that it was *this* call that actually finished up. By doing so,
            // the calling method may (or may not) want to signal for an invalidate to occur,
            // typically in a progressive rendering situation where a full redraw is then needed.
            _status = GroundFlags.GROUND_RENDERED;
            return maxTime ? (maxTime - performance.now() + startTime ) : 1;
        };
    })();


    this.renderShadow = function(camera, target) {
        if (!_bufferValid )
            return;

        if (target)
            _renderer.setRenderTarget( target );

        _renderer.render(_scene, camera);
    };

    this.postprocess = function() {
        if (USE_AO_PASS) {
            _aoPass.render(_renderer, _targetV, _targetH);
            _blurPassV.render(_renderer, _targetH, _targetV);
            _blurPassH.render(_renderer, _targetV, _targetH);
        } else {
            _blurPassV.render(_renderer, _targetV, _targetH);
            _blurPassH.render(_renderer, _targetH, _targetV);
        }

        _bufferValid = true;
    };

    this.clear = function() {
        var oldClearColor = _renderer.getClearColor(new THREE.Color()).getHex();
        var oldClearAlpha = _renderer.getClearAlpha();
        _renderer.setClearColor(0, 0);
        _renderer.setRenderTarget( _targetH );
        _renderer.clear( true, true, false);
        _renderer.setClearColor(oldClearColor, oldClearAlpha);
        _renderer.clearBlend();
        _bufferValid = false;
    };

    this.setColor = function(color) {
        _matColor.uniforms.uShadowColor.value.x = color.r;
        _matColor.uniforms.uShadowColor.value.y = color.g;
        _matColor.uniforms.uShadowColor.value.z = color.b;
    };

    this.getColor = function() {
        return new THREE.Color(
            _matColor.uniforms.uShadowColor.value.x,
            _matColor.uniforms.uShadowColor.value.y,
            _matColor.uniforms.uShadowColor.value.z
        );
    };

    this.setAlpha = function(alpha) {
        _matColor.uniforms.uShadowColor.value.w = alpha;
    };

    this.getAlpha = function() {
        return _matColor.uniforms.uShadowColor.value.w;
    };

    // This means "was the blur post-process done?" not "are we done rendering?"
    // Progressive rendering can make a partial valid drop shadow, but it's not done
    this.isValid = function() {
        return _bufferValid;
    };

    this.getStatus = function() {
        return _status;
    };

    this.setDirty = function() {
        _needClear = true;
        _status = GroundFlags.GROUND_UNFINISHED;
    };

    // TODO_NOP: hack exposing groundshadow material
    this.getDepthMaterial = function() {
        return _matDepth;
    };

    // INITIALIZATION

    if (params) {
        for (var i in _params) {
            _params[i] = params[i] || _params[i];
        }
    }

    // init scene
    _scene = new THREE.Scene();

    // init camera
    _camera = new THREE.OrthographicCamera();

    // init targets

    _targetH = new THREE.WebGLRenderTarget(_params.texSize, _params.texSize, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        stencilBuffer: false,
    });
    _targetH.texture.generateMipmaps = false;
    _targetH.name = "GroundShadow targetH";
                                   
                                                                                                                                                                
              
    
    _targetV = new THREE.WebGLRenderTarget(_params.texSize, _params.texSize, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        stencilBuffer: false
    });
    _targetV.texture.generateMipmaps = false;
    _targetV.name = "GroundShadow targetV";


    // init materials

    _matDepth = createShaderMaterial(GroundDepthShader);
    _matDepth.type = 'GroundDepthShader';
    _matDepth.side = THREE.DoubleSide;
    _matDepth.blending = THREE.NoBlending;

    _blurPassH = new ShaderPass(GroundShadowBlurShader, "tDepth");
    _blurPassV = new ShaderPass(GroundShadowBlurShader, "tDepth");
    _aoPass = new ShaderPass(GroundShadowAOShader, "tDepth");

    // write defines
    _blurPassH.material.defines["KERNEL_SCALE"] = _blurPassV.material.defines["KERNEL_SCALE"] = (_params.pixScale/_params.texSize).toFixed(4);
    _blurPassH.material.defines["KERNEL_RADIUS"] = _blurPassV.material.defines["KERNEL_RADIUS"] = _params.blurRadius.toFixed(2);

    //Some standard GL setup for the blur passes.
    _aoPass.material.blending =   _blurPassH.material.blending =   _blurPassV.material.blending = THREE.NoBlending;
    _aoPass.material.depthWrite = _blurPassH.material.depthWrite = _blurPassV.material.depthWrite = false;
    _aoPass.material.depthTest =  _blurPassH.material.depthTest =  _blurPassV.material.depthTest = false;
    _blurPassH.material.defines["HORIZONTAL"] = 1;

    _matColor = createShaderMaterial(GroundShadowColorShader);
    _matColor.uniforms.tDepth.value = USE_AO_PASS ? _targetV.texture : _targetH.texture;
    _matColor.depthWrite = false;
    _matColor.transparent = true;

    // init plane
    _planeMesh = createGroundShape(_matColor);
    _scene.add(_planeMesh);

    // init debug box
    if (_params.debug) {
        _debugBox = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshBasicMaterial( { color: 0x00ff00, wireframe: true } )
        );
        _scene.add(_debugBox);
    }

    // init with default bounds and up
    this.setTransform(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 1, 1),
        new THREE.Vector3(0, 1, 0),
        THREE.Object3D.DefaultUp
    );
}

GroundShadow.prototype = GroundCommon.prototype;
GroundShadow.prototype.constructor = GroundShadow;
