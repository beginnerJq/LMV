/*
 * Reusable sets of uniforms that can be merged with other uniforms in specific shaders.
 */

import * as THREE from "three";

export let CutPlanesUniforms = {
    "cutplanes": { type: "v4v", value: [] },
    "hatchParams": { type: "v2", value: new THREE.Vector2(1.0, 10.0) },
    "hatchTintColor": { type: "c", value: new THREE.Color( 0xFFFFFF ) },
    "hatchTintIntensity": { type: "f", value: 1.0 },
};

export let IdUniforms = {
    "dbId" : { type: "v3", value : new THREE.Vector3(0,0,0) },
    "modelId": { type: "v3", value : new THREE.Vector3(0,0,0) }
};

export let ThemingUniform = {
    "themingColor": { type: "v4", value : new THREE.Vector4(0,0,0,0) }
};

// Uniforms shared by material shader chunks and ShadowMapShader
// Included by ShadowMapUniforms below.
export let ShadowMapCommonUniforms = {
    "shadowESMConstant":  { type: "f", value: 0.0 },
};

// Uniforms needed by material shaders to apply shadow mapping.
export let ShadowMapUniforms = THREE.UniformsUtils.merge([
    {
        "shadowMap":      { type: "t",  value: null },
        "shadowMapSize":  { type: "v2", value: new THREE.Vector2(0,0) },
        "shadowBias":     { type: "f",  value: 0.0 },
        "shadowDarkness": { type: "f",  value: 0.0 },
        "shadowMatrix":   { type: "m4", value: new THREE.Matrix4() },
        "shadowLightDir": { type: "v3", value: new THREE.Vector3() }
    },
    ShadowMapCommonUniforms
]);

// Uniform for point-set point size
export let PointSizeUniforms = {
    "point_size" : { type: "f", value: 1.0 }
};

// Uniform for wide lines shader
export let WideLinesUniforms = {
    "view_size": { type: "v2", value: new THREE.Vector2(640,480) }
};

// Uniforms used for reconstructing positions from depth-texture in post-passes. (depth_texture.glsl)
export let DepthTextureUniforms = {	
    "tDepth":   { type: "t",  value: null },	
    "projInfo": { type: "v4", value: new THREE.Vector4() },	
    "isOrtho":  { type: "f",  value: 0.0 },	
    "worldMatrix_mainPass": { type: "m4", value: new THREE.Matrix4() }	
};

export let DepthTextureTestUniforms = {
    "tDepthTest":   { type: "t",  value: null },	
    "tDepthResolution":   { type: "v2", value: new THREE.Vector2( 1/1024,  1/1024 )  },
};


/*
 * Chunks are code snippets that can be included in specific shaders
 * using the three.js-style include directive:
 *
 *      #include <name_of_chunk>
 *
 * During runtime this directive can be expanded into the corresponding
 * code snippet using the `resolve` method available below.
 */
var chunks = {};

// We include default three.js chunks, too
for (var name in THREE.ShaderChunk) {
    chunks[name] = THREE.ShaderChunk[name];
}

import pack_depth from './chunks/pack_depth.glsl';
import depth_texture from './chunks/depth_texture.glsl';
import tonemap from './chunks/tonemap.glsl';
import ordered_dither from './chunks/ordered_dither.glsl';
import cutplanes from './chunks/cutplanes.glsl';
import pack_normals from './chunks/pack_normals.glsl';
import hatch_pattern from './chunks/hatch_pattern.glsl';
import env_sample from './chunks/env_sample.glsl';
import id_decl_vert from './chunks/id_decl_vert.glsl';
import id_vert from './chunks/id_vert.glsl';
import id_decl_frag from './chunks/id_decl_frag.glsl';
import id_frag from './chunks/id_frag.glsl';
import final_frag from './chunks/final_frag.glsl';
import theming_decl_frag from './chunks/theming_decl_frag.glsl';
import theming_frag from './chunks/theming_frag.glsl';
import instancing_decl_vert from './chunks/instancing_decl_vert.glsl';
import shadowmap_decl_common from './chunks/shadowmap_decl_common.glsl';
import shadowmap_decl_vert from './chunks/shadowmap_decl_vert.glsl';
import shadowmap_vert from './chunks/shadowmap_vert.glsl';
import shadowmap_decl_frag from './chunks/shadowmap_decl_frag.glsl';
import float3_average from './chunks/float3_average.glsl';
import line_decl_common from './chunks/line_decl_common.glsl';
import prism_wood from './chunks/prism_wood.glsl';
import prism_glazing from './chunks/prism_glazing.glsl';
import prism_transparency from './chunks/prism_transparency.glsl';
import normal_map from './chunks/normal_map.glsl';
import decl_point_size from './chunks/decl_point_size.glsl';
import point_size from './chunks/point_size.glsl';
import wide_lines_decl from './chunks/wide_lines_decl.glsl';
import wide_lines_vert from './chunks/wide_lines_vert.glsl';
import hsv from './chunks/hsv.glsl';
import importance_sampling from './chunks/importance_sampling.glsl';

chunks['pack_depth'] = pack_depth;
chunks['depth_texture'] = depth_texture;
chunks['tonemap'] = tonemap;
chunks['ordered_dither'] = ordered_dither;
chunks['cutplanes'] = cutplanes;
chunks['pack_normals'] = pack_normals;
chunks['hatch_pattern'] = hatch_pattern;
chunks['env_sample'] = env_sample;
chunks['id_decl_vert'] = id_decl_vert;
chunks['id_vert'] = id_vert;
chunks['id_decl_frag'] = id_decl_frag;
chunks['id_frag'] = id_frag;
chunks['final_frag'] = final_frag;
chunks['theming_decl_frag'] = theming_decl_frag;
chunks['theming_frag'] = theming_frag;
chunks['instancing_decl_vert'] = instancing_decl_vert;
chunks['shadowmap_decl_common'] = shadowmap_decl_common;
chunks['shadowmap_decl_vert'] = shadowmap_decl_vert;
chunks['shadowmap_vert'] = shadowmap_vert;
chunks['shadowmap_decl_frag'] = shadowmap_decl_frag;
chunks['float3_average'] = float3_average;
chunks['line_decl_common'] = line_decl_common;
chunks['prism_wood'] = prism_wood;
chunks['prism_glazing'] = prism_glazing;
chunks['prism_transparency'] = prism_transparency;
chunks['normal_map'] = normal_map;
chunks['decl_point_size'] = decl_point_size;
chunks['point_size'] = point_size;
chunks['wide_lines_decl'] = wide_lines_decl;
chunks['wide_lines_vert'] = wide_lines_vert;
chunks['hsv'] = hsv;
chunks['importance_sampling'] = importance_sampling;


/*
 * Macros are simple JavaScript functions that can be evaluated from
 * within the shader code using a similar syntax as the include directive:
 *
 *      #name_of_macro<first_param, second_param, third_param, ...>
 *
 * All parameters are simply passed to the JavaScript code as strings,
 * i.e., they are not parsed in any way.
 *
 */
var macros = {};

// Precompile regexes for the macros
var _regExCache = {};
for (name in macros) {
    _regExCache[name] = new RegExp('#' + name + ' *<([\\w\\d., ]*)>', 'g');
}

/**
 * Recursively resolves include directives and macros.
 * @param {string} source Original shader code.
 * @returns {string} Shader code with all includes resolved.
 */
export let resolve = function(source) {
    for (var name in macros) {
        var re = _regExCache[name];
        source = source.replace(re, function(match, parens) {
            var params = parens.split(',').map(function(param) { return param.trim(); });
            return macros[name].apply(null, params);
        });
    }

    var pattern = /#include *<([\w\d.]+)>/g;
    var func = function(match, include) {
        if (!chunks[include]) {
            throw new Error('Cannot resolve #include<' + include + '>');
        }
        return resolve(chunks[include]);
    };
    return source.replace(pattern, func);
};

// The chunks don't have to be exported anymore, but we keep them
// for backwards compatibility (they're still referenced in LegacyNamespace.js)
export let PackDepthShaderChunk = chunks['pack_depth'];
export let TonemapShaderChunk = chunks['tonemap'];
export let OrderedDitheringShaderChunk = chunks['ordered_dither'];
export let CutPlanesShaderChunk = chunks['cutplanes'];
export let PackNormalsShaderChunk = chunks['pack_normals'];
export let HatchPatternShaderChunk = chunks['hatch_pattern'];
export let EnvSamplingShaderChunk = chunks['env_sample'];
export let IdVertexDeclaration = chunks['id_decl_vert'];
export let IdVertexShaderChunk = chunks['id_vert'];
export let IdFragmentDeclaration = chunks['id_decl_frag'];
export let IdOutputShaderChunk = chunks['id_frag'];
export let FinalOutputShaderChunk = chunks['final_frag'];
export let ThemingFragmentDeclaration = chunks['theming_decl_frag'];
export let ThemingFragmentShaderChunk = chunks['theming_frag'];
export let InstancingVertexDeclaration = chunks['instancing_decl_vert'];
export let ShadowMapDeclareCommonUniforms = chunks['shadowmap_decl_common'];
export let ShadowMapVertexDeclaration = chunks['shadowmap_decl_vert'];
export let ShadowMapVertexShaderChunk = chunks['shadowmap_vert'];
export let ShadowMapFragmentDeclaration = chunks['shadowmap_decl_frag'];
export let PointSizeDeclaration = chunks['decl_point_size'];
export let PointSizeShaderChunk = chunks['point_size'];

export let ShaderChunks = {
    IdUniforms: IdUniforms,
    ThemingUniform: ThemingUniform,
    CutPlanesUniforms: CutPlanesUniforms,
    ShadowMapCommonUniforms: ShadowMapCommonUniforms,
    ShadowMapUniforms: ShadowMapUniforms,
    PointSizeUniforms: PointSizeUniforms,
    WideLinesUniforms: WideLinesUniforms,
    DepthTextureUniforms: DepthTextureUniforms,
    DepthTextureTestUniforms: DepthTextureTestUniforms,

    PackDepthShaderChunk: PackDepthShaderChunk,
    TonemapShaderChunk: TonemapShaderChunk,
    OrderedDitheringShaderChunk: OrderedDitheringShaderChunk,
    CutPlanesShaderChunk: CutPlanesShaderChunk,
    PackNormalsShaderChunk: PackNormalsShaderChunk,
    HatchPatternShaderChunk: HatchPatternShaderChunk,
    EnvSamplingShaderChunk: EnvSamplingShaderChunk,
    IdVertexDeclaration: IdVertexDeclaration,
    IdVertexShaderChunk: IdVertexShaderChunk,
    IdFragmentDeclaration: IdFragmentDeclaration,
    IdOutputShaderChunk: IdOutputShaderChunk,
    FinalOutputShaderChunk: FinalOutputShaderChunk,
    ThemingFragmentDeclaration: ThemingFragmentDeclaration,
    ThemingFragmentShaderChunk: ThemingFragmentShaderChunk,
    InstancingVertexDeclaration: InstancingVertexDeclaration,
    ShadowMapDeclareCommonUniforms: ShadowMapDeclareCommonUniforms,
    ShadowMapVertexDeclaration: ShadowMapVertexDeclaration,
    ShadowMapVertexShaderChunk: ShadowMapVertexShaderChunk,
    ShadowMapFragmentDeclaration: ShadowMapFragmentDeclaration,
    PointSizeDeclaration: PointSizeDeclaration,
    PointSizeShaderChunk: PointSizeShaderChunk,

    ...chunks,
    resolve: resolve
};
