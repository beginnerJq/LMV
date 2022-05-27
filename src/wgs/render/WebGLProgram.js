import { WebGLShader } from './WebGLShader';
import { resolve } from './ShaderChunks';
import * as THREE from "three";
import { isIE11 } from "../../compat";

const prefix_webgl2_vertex = `#version 300 es
    #define _LMVWEBGL2_
    #define texture2D texture
    #define textureCube texture
    #define attribute in
    #define varying out
`;

const prefix_webgl1_vertex = ``;


const prefix_webgl2_fragment = `#version 300 es
    #define _LMVWEBGL2_
    #define texture2D texture
    #define textureCube texture
    #define textureCubeLodEXT textureLod
    #define gl_FragColor outFragColor
    #define varying in
`;

const prefix_webgl1_fragment = `
    #define gl_FragDepth gl_FragDepthEXT
    #extension GL_OES_standard_derivatives : enable
`;

//Based on THREE.WebGLProgram, with some defines added / removed.
export let WebGLProgram = ( function () {
    'use strict';

    var programIdCount = 0;

    var filterEmptyLine = function( string ) {

        return string !== '';

    };

    var generateDefines = function ( defines ) {

        var value, chunk, chunks = [];

        for ( var d in defines ) {

            value = defines[ d ];
            if ( value === false ) continue;

            chunk = "#define " + d + " " + value;
            chunks.push( chunk );

        }

        return chunks.join( "\n" );

    };

    var cacheUniformLocations = function ( gl, program, identifiers ) {

        var uniforms = {};

        for ( var i = 0, l = identifiers.length; i < l; i ++ ) {

            var id = identifiers[ i ];
            uniforms[ id ] = gl.getUniformLocation( program, id );

        }

        return uniforms;

    };

    var cacheAttributeLocations = function ( gl, program, identifiers ) {

        var attributes = {};

        for ( var i = 0, l = identifiers.length; i < l; i ++ ) {

            var id = identifiers[ i ];
            attributes[ id ] = gl.getAttribLocation( program, id );

        }

        return attributes;

    };

    // Add clamping and inversion code for the simple Phong material perform any operations needed.
    // This is done here because we have access to the clamp and inversion parameters. The macro #defined
    // by this method can then be used elsewhere without knowledge of these parameters.
    var getMapChunk = function(name, clampS, clampT, invert, emptyChunk) {
        var invertChunk = invert ? "1.0-" : "";
        var readChunk = "texture2D("+name+", (UV))";
        var conditionChunk = "";
        emptyChunk = emptyChunk || "vec4(0.0)";
        if (clampS && clampT)
            conditionChunk = "((UV).x < 0.0 || (UV).x > 1.0 || (UV).y < 0.0 || (UV).y > 1.0) ? "+emptyChunk+" : ";
        else if (clampS)
            conditionChunk = "((UV).x < 0.0 || (UV).x > 1.0) ? "+emptyChunk+" : ";
        else if (clampT)
            conditionChunk = "((UV).y < 0.0 || (UV).y > 1.0) ? "+emptyChunk+" : ";
        return "#define GET_"+name.toUpperCase()+"(UV) ("+conditionChunk+invertChunk+readChunk+")";
    };

    return function ( renderer, code, material, parameters, geom ) {

        var _this = renderer;
        var _gl = _this.context;
        var _isWebGL2 = _this.capabilities.isWebGL2;

        var defines = material.defines;
        var uniforms = material.__webglShader.uniforms;
        let attributes = {};
        attributes = { ...material.attributes, ...geom.attributes };

        var vertexShader = resolve(parameters.vertexShader);
        var fragmentShader = resolve(parameters.fragmentShader);

        var index0AttributeName = material.index0AttributeName;

        if ( index0AttributeName === undefined && parameters.morphTargets === true ) {

            // programs with morphTargets displace position out of attribute 0

            index0AttributeName = 'position';

        }

        var envMapTypeDefine = 'ENVMAP_TYPE_CUBE';
        var envMapModeDefine = 'ENVMAP_MODE_REFLECTION';
        var envMapBlendingDefine = 'ENVMAP_BLENDING_MULTIPLY';

        var gammaFactorDefine = ( renderer.gammaFactor > 0 ) ? renderer.gammaFactor : 1.0;

        var customDefines = generateDefines( defines );

        var program = _gl.createProgram();

        var prefix_vertex, prefix_fragment;

        if ( material instanceof THREE.RawShaderMaterial ) {

            prefix_vertex = [

                _isWebGL2 ? prefix_webgl2_vertex : prefix_webgl1_vertex,

                customDefines

            ].filter( filterEmptyLine ).join( '\n' );

            if ( prefix_vertex.length > 0 ) {

                prefix_vertex += '\n';

            }

            prefix_fragment = [

                _isWebGL2 ? prefix_webgl2_fragment : prefix_webgl1_fragment,

                "precision " + parameters.precisionFragment + " float;",
                
                customDefines,

                _isWebGL2 ? "out vec4 outFragColor;" : ""

            ].filter( filterEmptyLine ).join( '\n' );

            if ( prefix_fragment.length > 0 ) {

                prefix_fragment += '\n';

            }
            
        } else {

            prefix_vertex = [

                _isWebGL2 ? prefix_webgl2_vertex : prefix_webgl1_vertex,

                "precision " + parameters.precision + " float;",
                "precision " + parameters.precision + " int;",

                customDefines,

                parameters.vertexPrefix,

                parameters.supportsVertexTextures ? "#define VERTEX_TEXTURES" : "",

                _this.gammaInput ? "#define GAMMA_INPUT" : "",
                _this.gammaOutput ? "#define GAMMA_OUTPUT" : "",
                '#define GAMMA_FACTOR ' + gammaFactorDefine,

                parameters.mrtNormals ? "#define MRT_NORMALS" : "", //FY
                parameters.mrtIdBuffer ? "#define MRT_ID_BUFFER" : "", //FY

                "#define MAX_DIR_LIGHTS " + parameters.maxDirLights,
                "#define MAX_POINT_LIGHTS " + parameters.maxPointLights,
                "#define MAX_SPOT_LIGHTS " + parameters.maxSpotLights,
                "#define MAX_HEMI_LIGHTS " + parameters.maxHemiLights,

                "#define MAX_BONES " + parameters.maxBones,

                "#define NUM_CUTPLANES " + parameters.numCutplanes,
                parameters.loadingAnimationDuration > 0 ? "#define LOADING_ANIMATION" : "",

                parameters.map ? "#define USE_MAP" : "",
                parameters.envMap ? "#define USE_ENVMAP" : "",
                parameters.envMap ? '#define ' + envMapModeDefine : '',
                parameters.irradianceMap ? "#define USE_IRRADIANCEMAP" : "", //FY
                parameters.lightMap ? "#define USE_LIGHTMAP" : "",
                parameters.bumpMap ? "#define USE_BUMPMAP" : "",
                parameters.normalMap ? "#define USE_NORMALMAP" : "",
                parameters.specularMap ? "#define USE_SPECULARMAP" : "",
                parameters.alphaMap ? "#define USE_ALPHAMAP" : "",
                parameters.vertexColors ? "#define USE_COLOR" : "",
                parameters.vertexIds ? "#define USE_VERTEX_ID" : "",

                parameters.useTiling ? "#define USE_TILING" : "",

                parameters.useInstancing ? "#define USE_INSTANCING" : "",

                parameters.wideLines ? "#define WIDE_LINES" : "",

                parameters.skinning ? "#define USE_SKINNING" : "",
                parameters.useVertexTexture ? "#define BONE_TEXTURE" : "",

                parameters.morphTargets ? "#define USE_MORPHTARGETS" : "",
                parameters.morphNormals ? "#define USE_MORPHNORMALS" : "",
                parameters.wrapAround ? "#define WRAP_AROUND" : "",
                parameters.doubleSided ? "#define DOUBLE_SIDED" : "",
                parameters.flipSided ? "#define FLIP_SIDED" : "",

                parameters.sizeAttenuation ? "#define USE_SIZEATTENUATION" : "",

                parameters.packedNormals ? "#define UNPACK_NORMALS" : "",

                // "#define FLAT_SHADED",  // TODO_NOP: hook up to param

                "uniform mat4 modelMatrix;",
                "uniform mat4 modelViewMatrix;",
                "uniform mat4 projectionMatrix;",
                "uniform mat4 viewMatrix;",
                "uniform mat3 normalMatrix;",
                "uniform vec3 cameraPosition;",

                "attribute vec3 position;",

                "#ifdef UNPACK_NORMALS",
                    "attribute vec2 normal;",
                "#else" ,
                    "attribute vec3 normal;",
                "#endif",

                "attribute vec2 uv;",
                "attribute vec2 uv2;",

                "#ifdef USE_COLOR",

                "   attribute vec3 color;",

                "#endif",

                ""

            ].join( '\n' );

            prefix_fragment = [

                _isWebGL2 ? prefix_webgl2_fragment : prefix_webgl1_fragment,

                (!_isWebGL2 && ( parameters.bumpMap || parameters.normalMap )) ? "#extension GL_OES_standard_derivatives : enable" : "",
                (!_isWebGL2 && (parameters.mrtIdBuffer || parameters.mrtNormals) && !isIE11) ? "#extension GL_EXT_draw_buffers : enable" : "",

                !_isWebGL2 && parameters.mrtIdBuffer ? "#define gl_FragColor gl_FragData[0]" : "",

                parameters.haveTextureLod ? "#define HAVE_TEXTURE_LOD" : "",

                customDefines,

                parameters.fragmentPrefix,

                "#define MAX_DIR_LIGHTS " + parameters.maxDirLights,
                "#define MAX_POINT_LIGHTS " + parameters.maxPointLights,
                "#define MAX_SPOT_LIGHTS " + parameters.maxSpotLights,
                "#define MAX_HEMI_LIGHTS " + parameters.maxHemiLights,

                "#define NUM_CUTPLANES " + parameters.numCutplanes,
                parameters.loadingAnimationDuration > 0 ? "#define LOADING_ANIMATION" : "",

                parameters.alphaTest ? "#define ALPHATEST " + parameters.alphaTest: "",

                _this.gammaInput ? "#define GAMMA_INPUT" : "",
                _this.gammaOutput ? "#define GAMMA_OUTPUT" : "",
                '#define GAMMA_FACTOR ' + gammaFactorDefine,

                parameters.mrtNormals ? "#define MRT_NORMALS" : "", //FY
                parameters.mrtIdBuffer ? "#define MRT_ID_BUFFER" : "", //FY
                parameters.mrtIdBuffer > 1 ? "#define MODEL_COLOR" : "",

                '#define TONEMAP_OUTPUT ' + (parameters.tonemapOutput || 0),

                ( parameters.useBackgroundTexture ) ? "#define USE_BACKGROUND_TEXTURE" : "",

                ( parameters.useFog && parameters.fog ) ? "#define USE_FOG" : "",
                ( parameters.useFog && parameters.fogExp ) ? "#define FOG_EXP2" : "",

                parameters.map ? "#define USE_MAP" : "",
                parameters.envMap ? "#define USE_ENVMAP" : "",
                parameters.envMap ? '#define ' + envMapTypeDefine : '',
                parameters.envMap ? '#define ' + envMapModeDefine : '',
                parameters.envMap ? '#define ' + envMapBlendingDefine : '',
                parameters.irradianceMap ? "#define USE_IRRADIANCEMAP" : "", //FY
                parameters.envGammaEncoded ? "#define ENV_GAMMA": "", //FY
                parameters.irrGammaEncoded ? "#define IRR_GAMMA": "", //FY
                parameters.envRGBM ? "#define ENV_RGBM": "", //FY
                parameters.irrRGBM ? "#define IRR_RGBM": "", //FY
                parameters.lightMap ? "#define USE_LIGHTMAP" : "",
                parameters.bumpMap ? "#define USE_BUMPMAP" : "",
                parameters.normalMap ? "#define USE_NORMALMAP" : "",
                parameters.specularMap ? "#define USE_SPECULARMAP" : "",
                parameters.alphaMap ? "#define USE_ALPHAMAP" : "",
                parameters.vertexColors ? "#define USE_COLOR" : "",
                parameters.vertexIds ? "#define USE_VERTEX_ID" : "",

                parameters.metal ? "#define METAL" : "",
                parameters.clearcoat ? "#define CLEARCOAT": "",
                parameters.wrapAround ? "#define WRAP_AROUND" : "",
                parameters.doubleSided ? "#define DOUBLE_SIDED" : "",
                parameters.flipSided ? "#define FLIP_SIDED" : "",

                parameters.hatchPattern ? "#define HATCH_PATTERN" : "",

                parameters.mapInvert ? "#define MAP_INVERT" : "",
                parameters.useTiling ? "#define USE_TILING" : "",
                parameters.useTiling ? ("#define TILE_RANGE_X_MIN " + parameters.tilingRepeatRange[0]) : "",
                parameters.useTiling ? ("#define TILE_RANGE_Y_MIN " + parameters.tilingRepeatRange[1]) : "",
                parameters.useTiling ? ("#define TILE_RANGE_X_MAX " + parameters.tilingRepeatRange[2]) : "",
                parameters.useTiling ? ("#define TILE_RANGE_Y_MAX " + parameters.tilingRepeatRange[3]) : "",
                parameters.hasRoundCorner ? "#define USE_TILING_NORMAL" : "",
                parameters.useRandomOffset ? "#define USE_TILING_RANDOM" : "",
                getMapChunk("map", parameters.mapClampS, parameters.mapClampT),
                getMapChunk("bumpMap", parameters.bumpMapClampS, parameters.bumpMapClampT),
                getMapChunk("normalMap", parameters.normalMapClampS, parameters.normalMapClampT),
                getMapChunk("specularMap", parameters.specularMapClampS, parameters.specularMapClampT),
                getMapChunk("alphaMap", parameters.alphaMapClampS, parameters.alphaMapClampT, parameters.alphaMapInvert),

                // "#define FLAT_SHADED",  // TODO_NOP: hook up to param

                "#ifdef USE_ENVMAP",
                "#ifdef HAVE_TEXTURE_LOD",
                !_isWebGL2 ? "#extension GL_EXT_shader_texture_lod : enable" : "",
                "#endif",
                '#endif',

                "precision " + parameters.precisionFragment + " float;",
                "precision " + parameters.precisionFragment + " int;",

                _isWebGL2 ? "layout(location = 0) out vec4 outFragColor;" : "",


                "uniform highp mat4 viewMatrix;",
                "uniform highp mat4 projectionMatrix;",
                "uniform highp vec3 cameraPosition;",

                "#if defined(USE_ENVMAP) || defined(USE_IRRADIANCEMAP)",

                    "uniform mat4 viewMatrixInverse;",

                "#endif",

                ""
            ].join( '\n' );
        }

        var glVertexShader = new WebGLShader( _gl, _gl.VERTEX_SHADER, prefix_vertex + vertexShader );
        var glFragmentShader = new WebGLShader( _gl, _gl.FRAGMENT_SHADER, prefix_fragment + fragmentShader );

        _gl.attachShader( program, glVertexShader );
        _gl.attachShader( program, glFragmentShader );

        if ( index0AttributeName !== undefined ) {

            // Force a particular attribute to index 0.
            // because potentially expensive emulation is done by browser if attribute 0 is disabled.
            // And, color, for example is often automatically bound to index 0 so disabling it

            _gl.bindAttribLocation( program, 0, index0AttributeName );

        }

        _gl.linkProgram( program );

        if (typeof DEBUG_SHADERS !== "undefined" && DEBUG_SHADERS) {

            if ( _gl.getProgramParameter( program, _gl.LINK_STATUS ) === false ) {

                console.error( 'THREE.WebGLProgram: Could not initialise shader.' );
                console.error( 'gl.VALIDATE_STATUS', _gl.getProgramParameter( program, _gl.VALIDATE_STATUS ) );
                console.error( 'gl.getError()', _gl.getError() );

            }

            if ( _gl.getProgramInfoLog( program ) !== '' ) {

                console.warn( 'THREE.WebGLProgram: gl.getProgramInfoLog()', _gl.getProgramInfoLog( program ) );

            }

        }

        // clean up

        _gl.deleteShader( glVertexShader );
        _gl.deleteShader( glFragmentShader );

        // cache uniform locations

        var identifiers = [

            'viewMatrix', 'modelViewMatrix', 'projectionMatrix', 'normalMatrix', 'modelMatrix', 'cameraPosition',
            'viewMatrixInverse', 'mvpMatrix', 'dbId'//FY

        ];

        for ( var u in uniforms ) {

            identifiers.push( u );

        }

        this.uniforms = cacheUniformLocations( _gl, program, identifiers );

        // cache attributes locations

        identifiers = [

            "position", "normal", "uv", "uv2", "tangent", "color",
            "lineDistance", "uvw", "id",
            "instOffset", "instScaling", "instRotation", // instancing
            "prev", "next", "side",                      // attributes for wide lines
            "uvp", "pointScale"                          // point sprite
        ];

        for ( var a in attributes ) {

            identifiers.push( a );

        }

        this.attributes = cacheAttributeLocations( _gl, program, identifiers );
        this.attributesKeys = Object.keys( this.attributes );

        //

        this.id = programIdCount ++;
        this.code = code;
        this.usedTimes = 1;
        this.program = program;
        this.vertexShader = glVertexShader;
        this.fragmentShader = glFragmentShader;

        return this;

    };

} )();

