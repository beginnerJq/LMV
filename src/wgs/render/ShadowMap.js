import { ShaderChunks as chunks } from './ShaderChunks';
import { createShaderMaterial, setMacro, removeMacro } from './ShaderUtils';
import { GetPrismMapUniforms } from './PrismUtil';
import { createGroundShape, setGroundShapeTransform } from './GroundShadow';
import { GaussianPass } from './GaussianPass';
import { RenderFlags } from '../scene/RenderFlags';
import * as THREE from "three";

import shadowmap_vert from './shaders/shadowmap_vert.glsl';
import shadowmap_frag from './shaders/shadowmap_frag.glsl';
import shadowmap_ground_vert from './shaders/shadowmap_ground_vert.glsl';
import shadowmap_ground_frag from './shaders/shadowmap_ground_frag.glsl';

// We test if the UVs are in the bounds when clamping; if not, discard!
// This is done here because we have access to the clamp parameters. The macro #defined
// by this method can then be used elsewhere, e.g. GetPrismMapSampleChunk, without knowledge of these parameters.
// Here is a typical result returned when clamping is on and "opaque_albedo" is passed in for the name:
// #define OPAQUE_ALBEDO_CLAMP_TEST if (uv_opaque_albedo_map.x < 0.0 || uv_opaque_albedo_map.x > 1.0 || uv_opaque_albedo_map.y < 0.0 || uv_opaque_albedo_map.y > 1.0) { discard; }
let GetPrismMapChunk = function(name, clampS, clampT) {
    var uv = "uv_"+name+"_map";
    var conditionChunk = "";
    if (clampS && clampT)
        conditionChunk = "if ("+uv+".x < 0.0 || "+uv+".x > 1.0 || "+uv+".y < 0.0 || "+uv+".y > 1.0) { discard; }";
    else if (clampS)
        conditionChunk = "if ("+uv+".x < 0.0 || "+uv+".x > 1.0) { discard; }";
    else if (clampT)
        conditionChunk = "if ("+uv+".y < 0.0 || "+uv+".y > 1.0) { discard; }";
    return "#define "+name.toUpperCase()+"_CLAMP_TEST "+conditionChunk;
};

//
// All shaders related to shadow mapping.
//
// Material shader chunks are only active if the USE_SHADOWMAP macro is set and have no effect otherwise.
// Default values for constant uniforms are specified in ShadowMap.js.
//
// How to add shadow-mapping to a material shader:
//  1. Add ShadowMapDeclareUniforms to uniforms
//  2. Add ShadowMapVertexDeclaration to the vertex-shader declarations
//  3. Make sure that these variables are available in the vertex-shader:
//      - vec3 position;            // vertex-position in model-coords
//      - uniform mat4 modelMatrix;
//  4. Add ShadowMapVertexShaderChunk to the vertex-shader.
//  5. Add ShadowMapFragmentDeclarion to the fragment-shader declarations
//  6. Now, you can use getShadowValue() in your fragment shader to get the
//     shadow attenuation value. (see function comment for details)
//     If the USE_SHADOWMAP macro is not set, it is replaced by a dummy implementation.

// Shader to render into the shadow map
export let ShadowMapShader = {

    uniforms: THREE.UniformsUtils.merge([

        chunks.ShadowMapCommonUniforms,
        {
            // all values are set in ShadowMaps.js
            "shadowMapRangeMin":  { type: "f", value: 0.0  },
            "shadowMapRangeSize": { type: "f", value: 0.0  },
            "shadowMinOpacity":   { type: "f", value: 0.0  },

            // uniforms needed to use texture sample chunks for Phong
            "map":                { type: "t", value: null },
            "alphaMap":           { type: "t", value: null },
            "texMatrix" :         { type: "m3", value: new THREE.Matrix3() },
            "texMatrixAlpha" :    { type: "m3", value: new THREE.Matrix3() },
        },
        // uniforms needed to use texture sample chunks for Prism
        GetPrismMapUniforms("surface_cutout_map")
    ]),

    vertexShader: shadowmap_vert,
    fragmentShader: shadowmap_frag
};

// Shader to render ground-shadow based on shadow-map.
// Unlike other shadow receivers, the ground plane itself is not visible - just its shadow is rendered.
export let GroundShadowShader = {

    uniforms: chunks.ShadowMapUniforms,

    vertexShader: shadowmap_ground_vert,
    fragmentShader: shadowmap_ground_frag
};

/**
 * ShadowMapOverrideMaterials is used by ShadowMaps to support cutout maps and transparency of individual shapes
 * when rendering into the shadow map.
 *
 * This class manages several customized variants of the shadow map shader material. The goal is:
 *  - Fully Invisible/Transparent objects will be excluded (based on threshold)
 *  - Prism cutout maps, alpha maps, and alpha channels of rgba maps are considered by override effects.
 * @constructor
 */
export function ShadowMapOverrideMaterials() {

    // contains different macro variant of ShadowMapShader to avoid frequent shader recompile.
    // indexed by material key (see MaterialFlags.getMaterialIndex() below)
    // Each effect is reused with different uniforms.
    var _cachedMaterials = [];

    // used to derive new effect variants that already know the latest state of common shadow-map uniforms
    var _prototypeMaterial = createShaderMaterial(ShadowMapShader);

    // dummy material to exclude shapes completely
    var _invisibleMaterial = new THREE.Material();
    _invisibleMaterial.visible = false;

    // reused array of decal objects. (see getCustomOverrideMaterial)
    var _overrideDecals = [];

    // flags to determine which macro-configuration of the override material is needed
    function MaterialFlags() {

        this.init = function() {
            this.isPrism     = false;
            this.alphaMap    = false;  // for Prism, this flag is used for the cutout map
            this.alphaClampS = false;
            this.alphaClampT = false;
            this.alphaInvert = false;
            this.rgbaMap     = false;
            this.rgbaClampS  = false;
            this.rgbaClampT  = false;
            this.rgbaInvert  = false;
            this.instanced   = false; // for geometry with per-instance transform

            // Even if the flags above are equal, we cannot reuse the same
            // override material for different decals: They are
            // used at the same time but may need different uniforms for the cutout_maps.
            // Therefore, we use the decal index to make sure that decal effects are
            // always independent.
            this.decalIndex  = -1;
        };

        this.init();

        // get a unique index for this flag combination
        this.getMaterialIndex = function() {
            // Note: When returning the term here directly, i.e., writing "return" instead of "var index =",
            //       the result would be undefined. The reason is a trap in JS: If a line only contains a single
            //       "return" statement, JS "helpfully" adds a ; automatically and ignores the rest.
            var index =
                (this.isPrism        ? 0x01  : 0) |
                (this.alphaMap       ? 0x02  : 0) |
                (this.alphaClampS    ? 0x04  : 0) |
                (this.alphaClampT    ? 0x08  : 0) |
                (this.alphaInvert    ? 0x10  : 0) |
                (this.rgbaMap        ? 0x20  : 0) |
                (this.rgbaClampS     ? 0x40  : 0) |
                (this.rgbaClampT     ? 0x80  : 0) |
                (this.rgbaInvert     ? 0x100 : 0) |
                (this.instanced      ? 0x200 : 0) |
                (this.decalIndex+1)  * 0x400; // enforce different keys for different decals
            return index;
        };
    }

    // reused temp object
    var _tmpFlags = new MaterialFlags();

    // Creates an appropriate override material or gets it from cache.
    //  @param   {MaterialFlags}        flags
    //  @param   {Number}               [decalIndex] - make sure that different decals always use different
    //                                                 override materials.
    //  @returns {THREE.ShaderMaterial}
    function acquireOverrideMaterial(flags, decalIndex) {

        var key = flags.getMaterialIndex();
        if (!_cachedMaterials[key]) {
            // Note:
            //  - Cloning the prototype makes sure that common shadowmap shader uniforms are also known by new effects.
            //  - Although we are sometimes creating the same ShaderMaterial here, separate caching still makes sense,
            //    because FireFlyWebGLProgram will compile different variants depending for each one.
            //    E.g., with/without USE_ALPHAMAP macro or with different GET_MAP chunks, depending on clamp settings.
            var newEffect = _prototypeMaterial.clone();

            // set macro to indicate that we must use prism shader chunks to sample the cutout map
            if (flags.isPrism && flags.alphaMap) {
                setMacro(newEffect, "USE_SURFACE_CUTOUT_MAP");

                // prepend SURFACE_CUTOUT_CLAMP macro function
                // For Prism materials, FireFlyWebGL does this automatically. But for the shadow map shader, we
                // have to do it ourselves here.
                newEffect.fragmentShader =
                    GetPrismMapChunk("surface_cutout", flags.alphaClampS, flags.alphaClampT) +
                    "\n" +
                    newEffect.fragmentShader;
            }

            // acitvate hardware instancing
            if (flags.instanced) {
                newEffect.useInstancing = true;
            }

            _cachedMaterials[key] = newEffect;
        }
        return _cachedMaterials[key];
    }

    // determines whether a material should be excluded from shadow-map rendering
    //  @param {THREE.Material} mat
    //  @returns {bool}
    function isInvisibleOrTransparent(mat) {

        if (mat instanceof THREE.MeshPhongMaterial) {
            // Phong shaders take opacity directly from the material property
            return mat.opacity < ShadowConfig.ShadowMinOpacity;
        } else if (mat.isPrismMaterial) {
            // For transparent prism materials, the surface opacity may actually vary per fragment depending on
            // surface orientation and roughness texture. Since we can only make binary decisions in the
            // shadow map shader, it's better to exclude those shapes completely. Otherwise, they would
            // rather cast random pixel artifacts than actual shadows.
            return (mat.prismType === 'PrismTransparent' || mat.prismType === 'PrismGlazing');
        } else if (!mat.visible) {
            // the original material is set to invisble already
            return true;
        }

        // If we reach this, we don't know anything about transparency.
        // Therefore, we assume it to be relevant.
        return false;
    }

    // runs a function cb(material) for each override material variant.
    this.forEachMaterial = function(cb) {

        // run for all cached effects
        for (var i=0; i<_cachedMaterials.length; i++) {
            var mat = _cachedMaterials[i];
            if (mat) {
                cb(mat);
            }
        }

        // apply on prototype, so that new materials inherit changes
        cb(_prototypeMaterial);

        // The _invisibleMaterial is excluded here, for two reasons:
        //  1. It is rather a cached constant without any configuration.
        //  2. By excluding it, we can safely assume that all materials are variants of
        //     the ShadowMapShader, so that all expected uniforms exist etc.
    };

    // Returns a custom override effect if needed for the given shape material.
    //  @param {THREE.Material}  origMat      - the original material of the shape to be rendered.
    //  @param {Number}          [decalIndex] - if orgigMat is from a decal, this must be its index in the decal array
    //  @returns {null|THREE.Material} returns null if the default override effect can be used.
    function getOverrideMaterial(origMat, decalIndex) {

        // handle overall transparency
        if (isInvisibleOrTransparent(origMat)) {
            return _invisibleMaterial;
        }

        // check for texture alpha
        var isPhong = (origMat instanceof THREE.MeshPhongMaterial);
        var isPrism = (origMat.isPrismMaterial);
        if (!isPhong && !isPrism) {
            // cutout/alpha maps are only supported for phong and prism materials
            return null;
        }

        // check for alpha/cutout map
        var alphaMap = (isPhong ? origMat.alphaMap : origMat["surface_cutout_map"]);

        // check for opacity in rgba map (phong only)
        // we ignore the map is alphaTest is not set.
        var rgbaMap = (isPhong && !!origMat.alphaTest) ? origMat.map : null;

        if (!alphaMap && !rgbaMap && !origMat.useInstancing) {
            // no custom effect needed
            return null;
        }

        var flags = _tmpFlags;
        flags.init();
        flags.isPrism    = isPrism;
        flags.alphaMap   = !!alphaMap;
        flags.rgbaMap    = !!rgbaMap;
        flags.instanced  = origMat.useInstancing;
        flags.decalIndex = (decalIndex===undefined ? -1 : decalIndex);

        // configure clamp & invert flags for alpha map
        if (alphaMap) {
            // These properties are set for all textures - no matter if Prism or Phong.
            // (see convertSimpleTexture/convertPrismTexture in MaterialConverter.js)
            flags.alphaClampS = alphaMap.clampS;
            flags.alphaClampT = alphaMap.clampT;
            flags.alphaInvert = alphaMap.invert;
        }

        // same for rgba map
        if (rgbaMap) {
            flags.rgbaClampS = rgbaMap.clampS;
            flags.rgbaClampT = rgbaMap.clampT;
            flags.rgbaInvert = rgbaMap.invert;
        }

        // get material for current macro-combination
        var override = acquireOverrideMaterial(flags, decalIndex);

        // configure uniforms
        if (alphaMap) {
            if (isPhong) {
                override.uniforms["alphaMap"].value       = alphaMap;
                override.uniforms["texMatrixAlpha"].value = alphaMap.matrix;

                // This lets WebGLRenderer set the USE_ALPHAMAP macro and allow the shader to use GET_ALPHAMAP
                // to handle clamping and invert. Note that we still need to set the uniforms above,
                // because the renderer does not call refreshUniformsCommon() for generic ShaderMaterials.
                override.alphaMap = alphaMap;

                // Get singe/double side setting from original material
                override.side = origMat.side;
            } else {
                // use prism uniforms for this case, so that we can reuse the prism sampling chunk
                override.uniforms["surface_cutout_map"].value           = alphaMap;
                override.uniforms["surface_cutout_map_texMatrix"].value.copy(alphaMap.matrix);
                override.uniforms["surface_cutout_map_invert"].value    = alphaMap.invert;

                // Workaround: Double-sided materials are currently only supported for Phong materials
                // (via "generic_backface_cull" property, see MaterialConverter.js), i.e., Prism materials
                // always seem to be single-sided. When using cutouts, you usually don't have closed surfaces.
                // Therefore, the camera and the shadow camera may see the cutout surface from different
                // directions - which looks confusing because either shadow or surface itself seems to be missing.
                // A cleaner solution would be to support double-sided for Prism as well. Then, we could
                // just set override.side = origMat.side like for Phong here.
                override.side = THREE.DoubleSide;
            }
        }

        // the same for alpha maps (Phong only)
        if (rgbaMap) {
            override.uniforms["map"].value       = rgbaMap;
            override.uniforms["texMatrix"].value = rgbaMap.matrix;
            override.map = rgbaMap;
        }

        return override;
    }

    // Returns a custom override effect if needed for the given shape material - including decals if needed.
    //  @param {THREE.Material}  origMat - the original material of the shape to be rendered.
    //  @returns {null|THREE.Material} returns null if the default override effect can be used.
    this.getCustomOverrideMaterial = function(origMat) {

        // check if this shape material requires a custom override material
        var override = getOverrideMaterial(origMat);

        // If no custom override is needed, the shape can be assumed to be fully opaque.
        // Decals cannot change this, so we can ignore them and just use the default shadow-map shader.
        if (!override) {
            return null;
        }

        // If there are no decals, just use the override material
        if (!origMat.decals) {
            override.decals = null;
            return override;
        }

        // Since override is not null, the main material is (maybe partially) transparent. In this case,
        // any decal may contribute to the shape opacity by defining separate cutouts.
        // Therefore, we have to add corresponding decals to the override material as well.
        if (origMat.decals) {

            _overrideDecals.length = 0;

            // for each original decal, add a corresponding one to the override material
            for (var i=0; i<origMat.decals.length; i++) {
                var decal = origMat.decals[i];

                // get override effect for this decal
                var decalOverride = getOverrideMaterial(decal.material, i);

                if (!decalOverride) {
                    // if this decal does not need a custom override, it is fully opaque.
                    // In this case, the whole shape is rendered to the shadow map anyway and
                    // we don't need the decals at all.
                    return null;
                }

                // this decal may contribute to the overall shape opacity.
                // Therefore, we add a corresponding decal to the override matierial as well.
                _overrideDecals.push({
                    uv:       decal.uv,      // share original uv,
                    material: decalOverride  // but with shadowmap material
                });
            }
        }

        // attach temporary override decals to main override effect
        override.decals = _overrideDecals;

        return override;
    };

    // dispose all owned GPU resources
    this.dispose = function() {
        // dispose all ShaderMaterials
        this.forEachMaterial(
            function(mat) {
                mat.dispose();
            }
        );
        // Note that _invisibleMaterial does not need dispose, because it is always skipped
        // by the renderer anyway.
    };
}

    // Toggles and constants
    export const ShadowConfig = {
        // Tweakable constants
        ShadowMapSize:        1024,
        ShadowESMConstant:    80.0,
        ShadowBias:           0.001,
        ShadowDarkness:       0.7, // shadow intensity. 0.0 => no shadows.
        ShadowMapBlurRadius:  4.0,

        ShadowMinOpacity:     0.9, // shapes below this opacity are excluded from shadowmap, i.e. do not cast shadows

        // Debug toggles
        UseHardShadows: false, // Fallback to simple hard shadows - helpful to debug artifacts
        BlurShadowMap:  true
    };

    // Enum for different states of the shadow map during progressive rendering
    export const SHADOWMAP_NEEDS_UPDATE = 0;
    export const SHADOWMAP_INCOMPLETE   = 1;
    export const SHADOWMAP_VALID        = 2;

    // ShadowParams defines all parameters needed by material shaders to access the shadow map.
    function ShadowParams() {

        this.shadowMap          = undefined;
        this.shadowMapSize      = undefined;
        this.shadowMatrix       = undefined;
        this.shadowLightDir     = undefined;

        /** @param {THREE.WebGLRenderTarget} */
        this.init = function(target) {
            this.shadowMap         = target;
            this.shadowMapSize     = new THREE.Vector2(target.width, target.height);
            this.shadowMatrix      = new THREE.Matrix4();
            this.shadowLightDir    = new THREE.Vector3();
        };

        /** Set (or remove) uniforms and defines for a material, so that it uses the current shadow map
         *   @param {THREE.Material} mat
         */
        this.apply = function(mat) {

            mat.shadowMap          = this.shadowMap;
            mat.shadowMatrix       = this.shadowMatrix;
            mat.shadowLightDir     = this.shadowLightDir;

            // add/remove shadow-map macro
            if (this.shadowMap) {
                setMacro(mat, "USE_SHADOWMAP");
                if (ShadowConfig.UseHardShadows) {
                    setMacro(mat, "USE_HARD_SHADOWS");
                }
            } else {
                removeMacro(mat, "USE_SHADOWMAP");
                removeMacro(mat, "USE_HARD_SHADOWS");
            }

            // Note that mat.needsUpdate is not needed here and would cause an expensive shader-recompile.
            // It is only called when the macro changes (see add/removeMacro).
        };
    }

    // NoShadows.apply() removes all shadow-map properties from a material.
    var NoShadows = new ShadowParams();

    /** @class Main class to manage ShadowMaps. Responsible for
     *   - creating and updating the shadow map
     *   - support progressive rendering of shadow maps
     *   - update materials to give them access to the shadow map.
     *   - rendering the ground shadow (a transparent plane where only shadow is visible)
     *
     *  How to use it: The main steps to update a shadow map are:
     *   - beginShadowMapUpdate:  prepares the shadow map rendering (clear target, setup camera etc.)
     *   - renderIntoShadowMap:   called for all scenes to be rendered into the shadow map, so that they cast shadows.
     *   - finishShadowMapUpdate: Makes the rendered shadow-map available to all materials.
     *
     *  To support progressive rendering, there are two higher-level functions that work with RenderScene and
     *  use the functions above:
     *   - startUpdate:    Reset render scene to start progressive rendering of the RenderScene into the shadow map
     *   - continueUpdate: Render more stuff into the shadow map. After calling, there are two possible results:
     *                      a) Finished: ShadowMap is ready and materials are configured to use it.
     *                      b) Timeout:  ShadowMaps are temporarily disabled for all materials. More continueUpdate()
     *                                   calls are needed next frame.
     *                     Use this.state to check whether the shadow map is finished.
     **/
    export function ShadowMaps(glRenderer) {

        var _shadowParams = null;
        var _gaussianPass = null;
        var _shadowCamera = new THREE.OrthographicCamera();

        // maximum possible value for exponential shadow map
        var _ESMMaxValue = Math.exp(ShadowConfig.ShadowESMConstant);

        // set clear color to maximum possible value in the shadow map
        var _clearColor = (ShadowConfig.UseHardShadows ? new THREE.Color(1,1,1) : new THREE.Color(_ESMMaxValue,1.0,1.0));

        var _renderer = glRenderer;

        // ground-shadow
        var _groundMaterial = null; // {THREE.ShaderMaterial} ShaderMaterial to render plane with transparent shadow
        var _groundShape    = null; // {THREE.Mesh}           ground plane geometry
        var _groundScene    = null; // {THREE.Scene}          scene containing _groundShape

        // material used to render into shadow map
        var _shadowMapMaterial = createShaderMaterial(ShadowMapShader);

        // attach a callback for _shadowMapMaterial that provides custom variants used for cutout maps and to exclude invisible shapes
        var _customOverrideMaterials = new ShadowMapOverrideMaterials();
        _shadowMapMaterial.getCustomOverrideMaterial = _customOverrideMaterials.getCustomOverrideMaterial;

        // dummy 1x1 pixel shadow-map that we use to temporarily hide shadows during shadow-map update.
        // switching off shadows instead would require to recompile a lot of material shaders.
        var _dummyShadowMap = null; // {THREE.WebGLRenderTarget}


        //
        // --- Some local helper functions ----
        //

        /** Apply shadow params to all materials
         *   @param {ShadowParams}
         */
        function setShadowParams(matman, params) {
            matman.forEach(function(m) {
                params.apply(m);
            });
        }


        // @param {Number} size - widht/height of shadow target
        function createShadowTarget(size) {
            var target = new THREE.WebGLRenderTarget(size, size,
            {   minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                type: THREE.FloatType,
                stencilBuffer: false,
                generateMipmaps: false
            });
            // TODO: generateMipmaps is ignored in the option struct
            target.texture.generateMipmaps = false;
            return target;
        }

        // param {THREE.WebGLRenderTarget}
        function clearShadowMap(target) {
            _renderer.setRenderTarget(target);
            _renderer.setClearColor(_clearColor, 1.0);
            _renderer.clear();
        }

        // make all materials use _dummyShadowMap.
        // @param {MaterialManager} matman
        function hideShadows(matman) {
            // replace actual shadow map by dummy shadow map
            var shadowMap = _shadowParams.shadowMap;
            _shadowParams.shadowMap = _dummyShadowMap;

            // update all materials
            setShadowParams(matman, _shadowParams);
            _shadowParams.apply(_groundMaterial);

            // set _shadowParams back to actual target
            _shadowParams.shadowMap = shadowMap;
        }

        /** Configures the given shadow ortho camera to fit the given worldBox.
         *   @param {THREE.OrthographicCamera} cam      - camera to be configured
         *   @param {THREE.Box3}                worldBox - worldBox of the scene that have to be captured by the camera
         *   @param {THREE.Vector3}             lightDir - direction from which the DirectionalLight comes
         */
        var fitShadowCam = (function() {
            // lookAt for shadowCamera. Rotates (0,0,-1) to shadowCam direction
            var _lookAtMatrix = new THREE.Matrix4();

            // inverse lookAt. Rotates shadowCam direction to (0,0,-1)
            var _lookAtInverse = new THREE.Matrix4();

            // we always use origin as light target
            var _origin  = new THREE.Vector3(0,0,0);

            // bbox to define shadow-camera frustum
            var _shadowBox = new THREE.Box3();

            // shadow-camera position in world-space
            var _shadowCamPos = new THREE.Vector3();

            // temp use
            var _tmp = new THREE.Vector3();

            return function(cam, worldBox, lightDir) {

                // let initial camera look from light position towards target (pos will be adjusted afterwards)
                cam.position.copy(lightDir);
                cam.lookAt(_origin);
                _lookAtMatrix.makeRotationFromQuaternion(cam.quaternion);
                _lookAtInverse.copy(_lookAtMatrix).invert();

                // rotate worldBox to shadow-camera space
                // Note that we need the inverse to transform from worldSpace to shadowCam space
                _shadowBox.copy(worldBox).applyMatrix4(_lookAtInverse);

                // get final shadowCam pos in worldCoords: We choose the center of maxZ face.
                // Note that in camera space, view direction is -z, i.e., +z is pointing towards the camera.
                _tmp = _shadowBox.getCenter(_tmp);
                _shadowCamPos.set(_tmp.x, _tmp.y, _shadowBox.max.z);
                _shadowCamPos.applyMatrix4(_lookAtMatrix);
                cam.position.copy(_shadowCamPos);

                // derive ortho-frustum extent from bbox.
                _tmp = _shadowBox.size(_tmp);
                cam.left   = -0.5 * _tmp.x;
                cam.right  =  0.5 * _tmp.x;
                cam.bottom = -0.5 * _tmp.y;
                cam.top    =  0.5 * _tmp.y;
                cam.near   =  0.0;
                cam.far    =  _tmp.z;

                // update all affected matrices
                cam.updateMatrixWorld();
                cam.updateProjectionMatrix();
            };
        }());

        /** Sets parameters needed for the Shader to render into the shadow map.
          *  @param {THREE.Material} mat
          */
        function setShadowMapShaderParams(mat) {
            mat.uniforms["shadowMapRangeMin"].value  = _shadowCamera.near;
            mat.uniforms["shadowMapRangeSize"].value = _shadowCamera.far - _shadowCamera.near;
            mat.uniforms["shadowESMConstant"].value  = ShadowConfig.ShadowESMConstant;
            mat.uniforms["shadowMinOpacity"].value   = ShadowConfig.ShadowMinOpacity;
        }

        //
        // --- Initialization ---
        //
        this.init = function() {

            // init shadow params
            _shadowParams = new ShadowParams();
            _shadowParams.init(createShadowTarget(ShadowConfig.ShadowMapSize));

            // Note that the gauss pass creates its own target - which must use the same format and type as the shadow map.
            _gaussianPass  = (ShadowConfig.BlurShadowMap ? new GaussianPass(ShadowConfig.ShadowMapSize, ShadowConfig.ShadowMapSize, ShadowConfig.ShadowMapBlurRadius, 1.0, {
                type:   _shadowParams.shadowMap.type,
                format: _shadowParams.shadowMap.format
            }) : undefined);

            // ground shadow material
            _groundMaterial = createShaderMaterial(GroundShadowShader);
            _groundMaterial.depthWrite = false;
            _groundMaterial.transparent = true;

            // ground shadow shape
            _groundShape = createGroundShape(_groundMaterial);
            _groundScene = new THREE.Scene();
            _groundScene.add(_groundShape);

            // needed from outside to adjust far-plane
            this.groundShapeBox = new THREE.Box3();

            // dummy 1x1 pixel shadow-map that we use to temporarily hide shadows during shadow-map update.
            // switching off shadows instead would require to recompile a lot of material shaders.
            _dummyShadowMap = createShadowTarget(1);
            clearShadowMap(_dummyShadowMap);
        };
        this.init();

        //
        // --- Main functions for progressive shadow map update ---
        //

        // used to manage state of the shadow-map for progressive update.
        this.state = SHADOWMAP_NEEDS_UPDATE;

        /** Clears the shadow map and prepares shadow camera and model for rendering. If possible within the given
         *  frame time, the shadow map will already be finished after calling this function. (use this.state to check).
         *  If not, more calls to continueUpdate() are needed in subsequent frames.
         *
         *  @param {RenderScene}     modelQueue     - Used for progressive rendering into shadow map.
         *  @param {Number}          frameRemaining - Frame budget in milliseconds
         *  @param {THREE.Camera}    camera         - Main camera for scene rendering
         *  @param {THREE.Vector3}   lightDir       - points to the direction where the light comes from (world-space)
         *  @param {MaterialManager} matman
         */
        this.startUpdate = function(modelQueue, frameRemaining, camera, lightDir, matman) {

            // clear shadow map and setup shadow map camera
            var worldBox = modelQueue.getVisibleBounds(true);
            this.beginShadowMapUpdate(camera, worldBox, lightDir);

            // reset queue to start progressive render into shadow map
            modelQueue.reset(_shadowCamera, RenderFlags.RENDER_SHADOWMAP, true);

            // state is in progress. This may change in the call below if the shadow
            // map can be fully rendered at once.
            this.state = SHADOWMAP_INCOMPLETE;

            // try to render the whole shadow map immediately in the given frame time.
            frameRemaining = this.continueUpdate(modelQueue, frameRemaining, matman);

            return frameRemaining;
        };

        /** Continues to render into the shadow map. startUpdate must have been called before.
         *   @param {RenderScene}     modelQueue
         *   @param {Number}          frameRemaining - available frame time budget in milliseconds
         *   @param {MaterialManager} matman
         *   @returns {Number} remaining frame time
         *
         *  Note: If other tasks call q.renderSome() or q.reset() on the modelQueue while the shadow-map update is in progress,
         *        the shadow map update has to be restarted. */
        this.continueUpdate = function(modelQueue, frameRemaining, matman) {

            // render some more scenes into shadow map
            frameRemaining = modelQueue.renderSome(this.renderSceneIntoShadowMap, frameRemaining);

            // if shadow map rendering is already finished, let's use it in this frame already
            if (modelQueue.isDone()) {
                this.state = SHADOWMAP_VALID;
                this.finishShadowMapUpdate(matman);
            } else {
                // model is too big to render shadow map in a single frame.
                // Hide shadows until shadow map update is finished.
                hideShadows(matman);
            }
            return frameRemaining;
        };

        ///
        /// --- Core functions for shadow-map update ---
        ///

        /** Clear shadow target and initialize shadow camera.
         *   @param {THREE.Camera}  camera
         *   @param {THREE.Box3}    worldBox
         *   @param {THREE.Vector3} lightDir - points to the direction where the light comes from (world-space)
         */
        this.beginShadowMapUpdate = function(camera, worldBox, lightDir) {

            fitShadowCam(_shadowCamera, worldBox, lightDir);

            // update shadowmap shader params
            setShadowMapShaderParams(_shadowMapMaterial);
            _customOverrideMaterials.forEachMaterial(setShadowMapShaderParams);

            // activate hard-shadows fallback if enabled
            if (ShadowConfig.UseHardShadows) {
                setMacro(_shadowMapMaterial, "USE_HARD_SHADOWS");
                _customOverrideMaterials.forEachMaterial(
                    function(mat) {
                        setMacro(mat, "USE_HARD_SHADOWS");
                    }
                );
            }

            clearShadowMap(_shadowParams.shadowMap);

            // render ground shape into shadow map. Although the ground will usually only receive shadow
            // and not cast it, this is necessary to avoid artifacts with exponential shadow mapping,
            // because the smoothing usually fails at the boundary to clear-color (=maxDepth) pixels in the shadow map.
            this.renderSceneIntoShadowMap(_groundScene);
        };

        /** @param {THREE.Scene} scene */
        this.renderSceneIntoShadowMap = function(scene) {
            scene.overrideMaterial = _shadowMapMaterial;

            _renderer.render(scene, _shadowCamera, _shadowParams.shadowMap);

            scene.overrideMaterial = null;
        };

        /** @param {MaterialManager} matman */
        this.finishShadowMapUpdate = function(matman) {

            // Note that the gaussianPass has its own intermediate target, so that it's okay
            // to use the same target for input and output.
            if (_gaussianPass && !ShadowConfig.UseHardShadows) {
                _gaussianPass.render(_renderer, _shadowParams.shadowMap, _shadowParams.shadowMap);
            }

            // compute shadowMatrix param: It maps world-coords to NDC for the shadow-camera
            _shadowParams.shadowMatrix.multiplyMatrices(_shadowCamera.projectionMatrix, _shadowCamera.matrixWorldInverse);
            _shadowParams.shadowMapRangeMin  = _shadowCamera.near;
            _shadowParams.shadowMapRangeSize = _shadowCamera.far - _shadowCamera.near;
            _shadowParams.shadowLightDir.copy(_shadowCamera.position).normalize();

            // update param on all materials
            setShadowParams(matman, _shadowParams);

            // update our own ground shadow shader
            _shadowParams.apply(_groundMaterial);

            this.isValid = true;
        };

        /**
         *  Dispose GPU resources of ShadowMaps.
         *  @param {MaterialManager} matman
         **/
        this.cleanup = function(matman) {

            if (_gaussianPass) {
                _gaussianPass.cleanup();
            }
            if (_shadowParams.shadowMap) {
                _shadowParams.shadowMap.dispose();
            }

            // remove all shadow-map params from materials
            setShadowParams(matman, NoShadows);

            // dispose shader for shadow-map rendering
            _shadowMapMaterial.dispose();
            _customOverrideMaterials.dispose();

            // dispose ground shape
            _groundMaterial.dispose();
            _groundShape.geometry.dispose();

            // TODO: Probably LmvShaderPasses should get cleanup() functions as well to dispose targets and geometry?
        };

        ///
        /// --- Ground shadow rendering ---
        ///

        this.setGroundShadowTransform = (function(){
            return function(center, size, worldUp, rightAxis) {
                // update shape transform
                setGroundShapeTransform(_groundShape, center, size, worldUp, rightAxis);

                // expose ground shape box (needed for far-plane adjustment)
                this.groundShapeBox.setFromObject(_groundShape);
            };
        }());

        this.renderGroundShadow = function(camera, target) {
            _renderer.render(_groundScene, camera, target, false);
        };

        /** Returns a corner of the bbox, enumerating from 0=minPoint to 7=maxPoint.
         * @param {THREE.Box3}    box
         * @param {Number}        index - in [0,7]
         * @param {THREE.Vector3} [optionalTarget]
         * @returns {THREE.Vector3}
         */
        function getBoxCorner(box, index, optionalTarget) {
            var result = optionalTarget || new THREE.Vector3();
            result.x = (index & 1) ? box.max.x : box.min.x;
            result.y = (index & 2) ? box.max.y : box.min.y;
            result.z = (index & 4) ? box.max.z : box.min.z;
            return result;
        }

        /** Expands the given box in xz by its ground shadow, assuming a ground plane { y = inoutBox.min.y } .
         *   @param {THREE.Box3}    inoutBox  - box to be expanded.
         *   @param {THREE.Vector3} shadowDir - direction pointing towards the light
         */
        this.expandByGroundShadow = (function(){

            var _plane     = new THREE.Plane();
            var _ray       = new THREE.Ray();
            var _tmpCenter = new THREE.Vector3();
            var _tmpVec    = new THREE.Vector3();
            var _tmpBox    = new THREE.Box3();

            return function(inoutBox, shadowDir) {

                // y is up vector.
                _plane.normal.set(0,1,0);
                _plane.constant = -inoutBox.min.y;

                // note that shadow is the direction pointing towards the light
                _ray.direction.copy(shadowDir).negate().normalize();

                // Don't add points if they would grow the box too much
                var MaxBoxGrow = 100.0;
                var center   = inoutBox.getCenter(_tmpCenter);
                var maxDist2 = center.distanceToSquared(inoutBox.min) * MaxBoxGrow * MaxBoxGrow;

                // For all box corners, add the corresponding ground shadow point.
                _tmpBox.makeEmpty();
                for (var i=0; i<8; i++) {
                    // shoot ray from box corner along the light dir
                    _ray.origin =  getBoxCorner(inoutBox, i);

                    var onPlane = _ray.intersectPlane(_plane, _tmpVec);
                    if (!onPlane) {
                        continue;
                    }

                    // If the hit is too far away, we drop this point. This may happen if the light direction
                    // is close to horizontal. Growing the bbox too much would make the whole rendering fail
                    // (z-buffer artifacts or worse). So it's better to accept the clipped shadow in this case.
                    if (onPlane.distanceToSquared(center) >= maxDist2) {
                        continue;
                    }

                    // add point to bbox
                    _tmpBox.expandByPoint(onPlane);
                }

                // Finally, expand the original box with the shadow extent
                inoutBox.union(_tmpBox);
            };
        }());

        // used by debugging tools
        this.getShadowParams = function() { return _shadowParams; };
        this.getShadowCamera = function() { return _shadowCamera; };
    }

    // Provides functionality needed by FireFlyWebGLRenderer to work with shadow maps.
    export const ShadowRender = function() {};

    ShadowRender.RefreshUniformsShadow = function( uniforms, material ) {

        // may vary at runtime
        if (uniforms.shadowMap)
            uniforms.shadowMap.value = material.shadowMap;
        if (uniforms.shadowMatrix)
            uniforms.shadowMatrix.value = material.shadowMatrix;
        if (uniforms.shadowLightDir)
            uniforms.shadowLightDir.value = material.shadowLightDir;

        // Currently constant
        if (uniforms.shadowESMConstant)
            uniforms.shadowESMConstant.value = ShadowConfig.ShadowESMConstant;
        if (uniforms.shadowBias)
            uniforms.shadowBias.value = ShadowConfig.ShadowBias;
        if (uniforms.shadowMapSize)
            uniforms.shadowMapSize.value = ShadowConfig.ShadowMapSize;
        if (uniforms.shadowDarkness)
            uniforms.shadowDarkness.value = ShadowConfig.ShadowDarkness;
    };
