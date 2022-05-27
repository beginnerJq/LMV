import { WebGLProgram } from './WebGLProgram';
import * as shadowmap from './ShadowMap';
import LostContextRecovery from './LostContextRecovery';
import { RenderBatch } from '../scene/RenderBatch';
import { getGlobal, getIOSVersion, isIOSDevice } from "../../compat";
import * as THREE from "three";
import { USE_VAO } from "../globals";
import { vector3ApplyProjection } from '../../../thirdparty/three.js/three-legacy';
import { refreshUniformsIBL, markUniformsIBLNeedsUpdate } from './LmvMaterialUtils';

export let DEBUG_TEXTURE_LOAD = false;

const _window = getGlobal();
const _document = _window.document;
const needIOS15FlushHack = isIOSDevice() && getIOSVersion().startsWith('15');
let renderCalls = 0;

/**
 * @author supereggbert / http://www.paulbrunt.co.uk/
 * @author mrdoob / http://mrdoob.com/
 * @author alteredq / http://alteredqualia.com/
 * @author szimek / https://github.com/szimek/
 * @author stanevt -- Modified for Autodesk LMV web viewer
 * @constructor
 */
export let WebGLRenderer = function ( parameters ) {
    console.log( 'THREE.WebGLRenderer', THREE.REVISION );

    parameters = parameters || {};

    var _canvas = parameters.canvas !== undefined ? parameters.canvas : _document.createElement( 'canvas' ),

    _pixelRatio = null, // For storing user selected pixelRatio

    _precisionVertex = parameters.precision !== undefined ? parameters.precision : 'highp',
    _precisionFragment = _precisionVertex,

    _alpha = parameters.alpha !== undefined ? parameters.alpha : false,
    _premultipliedAlpha = parameters.premultipliedAlpha !== undefined ? parameters.premultipliedAlpha : true,
    _antialias = parameters.antialias !== undefined ? parameters.antialias : false,
    _stencil = parameters.stencil !== undefined ? parameters.stencil : true,
    _preserveDrawingBuffer = parameters.preserveDrawingBuffer !== undefined ? parameters.preserveDrawingBuffer : true, //change it to true for the screen capture api

    _clearColor = new THREE.Color( 0x000000 ),
    _clearAlpha = 0;

    var lights = [];
    var _webglObjects = {};
    var _objectModelViewMatrix = new THREE.Matrix4();
    var _objectNormalMatrix = new THREE.Matrix3();
    this.highResTimeStamp = 0;

    var opaqueObjects = [];
    var transparentObjects = [];

    // public properties

    this.domElement = _canvas;
    this.context = null;
    this.refCount = 0;

    // clearing

    this.autoClear = true;
    this.autoClearColor = true;
    this.autoClearDepth = true;
    this.autoClearStencil = true;

    // scene graph

    this.sortObjects = true;

    // physically based shading

    this.gammaInput = false;
    this.gammaOutput = false;

    // morphs

    this.maxMorphTargets = 8;
    this.maxMorphNormals = 4;

    // flags

    this.autoScaleCubemaps = true;

    // info

    this.info = {

        memory: {

            programs: 0,
            geometries: 0,
            textures: 0

        },

        render: {

            calls: 0,
            vertices: 0,
            faces: 0,
            points: 0

        }

    };

    // internal properties

    var _this = this,

    _programs = [],

    // internal state cache

    _currentProgram = null,
    _currentFramebuffer = null,
    _currentRenderTarget = null,
    _currentRenderTargetIsArray = null,
    _currentMaterialId = -1,
    _currentCamera = null,

    _currentGeometryProgram = '',
    _programIndex = 0,
    _vertexPrefix = "",
    _fragmentPrefix = "",

    _usedTextureUnits = 0,

    // GL state cache

    _viewportX = 0,
    _viewportY = 0,
    _viewportWidth = _canvas.width,
    _viewportHeight = _canvas.height,
    //_currentWidth = 0,
    //_currentHeight = 0,

    _tmpViewport = new THREE.Vector4(),

    _dynamicBuffers = {}, //gl buffers used for streaming draw

    // frustum

    _frustum = new THREE.Frustum(),

     // camera matrices cache

    _projScreenMatrix = new THREE.Matrix4(),
    _viewInverseEnv = new THREE.Matrix4(),

    _vector3 = new THREE.Vector3(),

    // light arrays cache

    _direction = new THREE.Vector3(),

    _lightsNeedUpdate = true,

    _lights = {

        ambient: [ 0, 0, 0 ],
        directional: { length: 0, colors: [], positions: [] },
        point: { length: 0, colors: [], positions: [], distances: [] },
        spot: { length: 0, colors: [], positions: [], distances: [], directions: [], anglesCos: [], exponents: [] },
        hemi: { length: 0, skyColors: [], groundColors: [], positions: [] }

    };

    // initialize

    var _gl;
    var _isWebGL2;
    _this.capabilities = {};

    var _glExtensionDrawBuffers;
    var _glExtensionInstancedArrays;
    var _glExtensionVAO;

    try {

        var attributes = {
            alpha: _alpha,
            premultipliedAlpha: _premultipliedAlpha,
            antialias: _antialias,
            stencil: _stencil,
            powerPreference: 'high-performance', // currently only supported on Mac but Microsoft
            // is adding proper support to Chromium https://twitter.com/gfxprogrammer/status/1282387095797895169
            preserveDrawingBuffer: _preserveDrawingBuffer
        };

        _gl = (parameters.useWebGL2 !== false) ? _canvas.getContext( 'webgl2', attributes ) : null;

        if (_gl) {
            // Stub to simulate API of new WebGLRenderer
            _this.capabilities.isWebGL2 = true;
            _isWebGL2 = true;

        } else {

            _gl = _canvas.getContext( 'webgl', attributes ) || _canvas.getContext( 'experimental-webgl', attributes );

        }

        if ( _gl === null ) {

            if ( _canvas.getContext( 'webgl') !== null ) {

                throw 'Error creating WebGL context with your selected attributes.';

            } else {

                throw 'Error creating WebGL context.';

            }

        }

        const debugInfo = _gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
            const vendor = _gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
            const renderer = _gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
            
            console.log("WebGL Renderer: " + renderer);
            console.log("WebGL Vendor: " + vendor);    
        }


        /* You can substitute your own error catcher for WebGL, by adding a script.
         * This can be particularly handy for putting a break when a particular error is encountered,
         * so you can see exactly what line is causing the problem. You can also catch errors where
         * we pass in "undefined" as an argument, which is something that is rarely a good idea.
         *
         * You need to include in index.html:
         *     <script src="thirdparty/khronos/webgl-debug.js"></script>"
         * in order to use this functionality. Then just uncomment the rest, and choose
         * which of the makeDebugContext lines at the end to uncomment.
         */
        /*
        
        // A standard one. Chrome already reports such errors without you adding this, and yourw
        // will take the place of theirs.
        function throwOnGLError(err, funcName, args) {
            throw WebGLDebugUtils.glEnumToString(err) + " was caused by call to: " + funcName;
        };

        // this one is terribly weird, but provided by Khronos as an example.
        function logGLCall(functionName, args) {
             console.log("gl." + functionName + "(" +
                WebGLDebugUtils.glFunctionArgsToString(functionName, args) + ")");
        }

        // this one is actually handy: flags an error when we try to pass in an argument that is undefined.
        function validateNoneOfTheArgsAreUndefined(functionName, args) {
            for (var ii = 0; ii < args.length; ++ii) {
              if (args[ii] === undefined) {
                console.error("undefined passed to gl." + functionName + "(" +
                              WebGLDebugUtils.glFunctionArgsToString(functionName, args) + ")");
              }
            }
        }

        // Choose one of these two:
        // the default, shows usual errors.
        _gl = WebGLDebugUtils.makeDebugContext(_gl, throwOnGLError);
        // to check for undefined args passed in to WebGL, which is a no-no:
        //_gl = WebGLDebugUtils.makeDebugContext(_gl, undefined, validateNoneOfTheArgsAreUndefined);
        */

        //LMV-1914: lower fragment precision for low-end mobile devices (Android)
        var highp = _gl.getShaderPrecisionFormat(_gl.FRAGMENT_SHADER, _gl.HIGH_FLOAT);
        if (highp.precision == 0) _precisionFragment = 'mediump';

        _canvas.addEventListener( 'webglcontextlost', function ( event ) {

            event.preventDefault();

            resetGLState();
            setDefaultGLState();

            _webglObjects = {};

            // enforce re-creation of GeometryGroups.
            geometryGroups = {};
            geometryGroupCounter = 0;

            _nullTexture.dispose();
            
            // Clear outdated cached programs
            _programs.length = 0;
        }, false);

        _canvas.addEventListener("webglcontextrestored", function( event ) {

            event.preventDefault();

            // Recovering after webglcontextrestore is optional: If an application doesn't fully work with a resurrected context,
            // it can be better to gracefully fail with an error message.
            if (!_this.enableContextRestore) {
                return;
            }

            // re-initialize wegl state and null-texture
            initGLContext();
            initNullTexture();

            // Make sure that all webgl resources are refreshed in subsequent render calls
            _this.lostContextRecovery = _this.lostContextRecovery || new LostContextRecovery();
            _this.lostContextRecovery.onContextRestored();

            // Clear pointers to outdated webgl resources
            _currentProgram = null;
            _currentFramebuffer = null;
        });

    } catch ( error ) {

        console.error( error );
        return;

    }

    if ( _gl.getShaderPrecisionFormat === undefined ) {

        _gl.getShaderPrecisionFormat = function() {

            return {
                "rangeMin"  : 1,
                "rangeMax"  : 1,
                "precision" : 1
            };

        };
    }

    let extensions;
    let state;    
    let bindingStates;

    function initGLContext() {
        extensions = new THREE.WebGLExtensions( _gl );
        state = new THREE.WebGLState( _gl, paramThreeToGL );
        bindingStates = state;

        //We know we are going to be using some extensions for sure
        extensions.get( 'EXT_texture_filter_anisotropic' );
        extensions.get( 'WEBGL_compressed_texture_s3tc' );
    
        if (!_isWebGL2) {
    
            extensions.get( 'OES_texture_float' );
            extensions.get( 'OES_texture_float_linear' );
            extensions.get( 'OES_texture_half_float' );
            extensions.get( 'OES_texture_half_float_linear' );
            extensions.get( 'OES_standard_derivatives' );
            extensions.get( 'EXT_shader_texture_lod' );
    
            _glExtensionDrawBuffers = extensions.get( 'WEBGL_draw_buffers' );
            _glExtensionInstancedArrays = extensions.get('ANGLE_instanced_arrays');
            _glExtensionVAO = extensions.get('OES_vertex_array_object');
        } else {
            extensions.get( 'EXT_color_buffer_float' );
        }
        _this.extensions = extensions;
    }

    initGLContext();

    var glClearColor = function ( r, g, b, a ) {

        if ( _premultipliedAlpha === true ) {

            r *= a; g *= a; b *= a;

        }

        _gl.clearColor( r, g, b, a );

    };

    var setDefaultGLState = function() {

        _gl.clearColor( 0, 0, 0, 1 );
        _gl.clearDepth( 1 );
        _gl.clearStencil( 0 );

        _gl.enable( _gl.DEPTH_TEST );
        _gl.depthFunc( _gl.LEQUAL );

        _gl.frontFace( _gl.CCW );
        _gl.cullFace( _gl.BACK );
        _gl.enable( _gl.CULL_FACE );

        _gl.enable( _gl.BLEND );
        _gl.blendEquation( _gl.FUNC_ADD );
        _gl.blendFunc( _gl.SRC_ALPHA, _gl.ONE_MINUS_SRC_ALPHA );

        _gl.viewport( _viewportX, _viewportY, _viewportWidth, _viewportHeight );

        glClearColor( _clearColor.r, _clearColor.g, _clearColor.b, _clearAlpha );

    };

    var resetGLState = function () {

        _currentProgram = null;
        _currentCamera = null;

        _currentGeometryProgram = '';
        _currentMaterialId = - 1;

        _lightsNeedUpdate = true;

        state.reset();
        bindingStates.disableUnusedAttributes();
    };

    setDefaultGLState();

    this.context = _gl;
    this.state = state;

    // GPU capabilities

    var _maxTextures = _gl.getParameter( _gl.MAX_TEXTURE_IMAGE_UNITS );
    var _maxVertexTextures = _gl.getParameter( _gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS );
    var _maxTextureSize = _gl.getParameter( _gl.MAX_TEXTURE_SIZE );
    var _maxCubemapSize = _gl.getParameter( _gl.MAX_CUBE_MAP_TEXTURE_SIZE );

    var _supportsVertexTextures = _maxVertexTextures > 0;
    // not used, though used in three.js's version:
    //var _supportsBoneTextures = _supportsVertexTextures && extensions.get( 'OES_texture_float' );


    var _vertexShaderPrecisionHighpFloat = _gl.getShaderPrecisionFormat( _gl.VERTEX_SHADER, _gl.HIGH_FLOAT );
    var _vertexShaderPrecisionMediumpFloat = _gl.getShaderPrecisionFormat( _gl.VERTEX_SHADER, _gl.MEDIUM_FLOAT );
    //var _vertexShaderPrecisionLowpFloat = _gl.getShaderPrecisionFormat( _gl.VERTEX_SHADER, _gl.LOW_FLOAT );

    var _fragmentShaderPrecisionHighpFloat = _gl.getShaderPrecisionFormat( _gl.FRAGMENT_SHADER, _gl.HIGH_FLOAT );
    var _fragmentShaderPrecisionMediumpFloat = _gl.getShaderPrecisionFormat( _gl.FRAGMENT_SHADER, _gl.MEDIUM_FLOAT );
    //var _fragmentShaderPrecisionLowpFloat = _gl.getShaderPrecisionFormat( _gl.FRAGMENT_SHADER, _gl.LOW_FLOAT );

    // Sometimes a texture is not actually available to bind. We use _nullTexture so that the uniform sampler2D
    // is bound to something, so that we don't get a warning from Chrome.
    var pixels = new Uint8Array(16);

    // checkerboard
    for (var i=0; i<4; i++) {
        // for debugging - gives a pink and green pattern, which will show textures that are not loaded properly.
        // Sometimes textures are not loaded yet and so will use this texture temporarily, so we don't normally load this pattern.
        if ( DEBUG_TEXTURE_LOAD ) {
            if ( i === 1 || i === 2 ) {
                pixels[i*4] = 246;
                pixels[i*4+1] = 140;
                pixels[i*4+2] = 220;
            } else {
                pixels[i*4] = 48;
                pixels[i*4+1] = 195;
                pixels[i*4+2] = 3;
            }
        } else {
            // black - we actually use this color as a sign that the texture is not loaded for Graphite and take corrective action there.
            pixels[i*4] =
            pixels[i*4+1] =
            pixels[i*4+2] = 0;
        }
        pixels[i*4+3] = 255;
    }

    var _nullTexture;
    function initNullTexture() {
        _nullTexture = new THREE.DataTexture( pixels, 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.UVMapping,
        THREE.RepeatWrapping, THREE.RepeatWrapping,
        THREE.NearestFilter, THREE.NearestFilter);
        _nullTexture.needsUpdate = true;
    }
    initNullTexture();

    var getCompressedTextureFormats = ( function () {

        var array;

        return function () {

            if ( array !== undefined ) {

                return array;

            }

            array = [];

            if ( extensions.get( 'WEBGL_compressed_texture_pvrtc' ) || extensions.get( 'WEBGL_compressed_texture_s3tc' ) ) {

                var formats = _gl.getParameter( _gl.COMPRESSED_TEXTURE_FORMATS );

                for ( var i = 0; i < formats.length; i ++ ){

                    array.push( formats[ i ] );

                }

            }

            return array;

        };

    } )();


    // clamp precision to maximum available

    var highpAvailable = _vertexShaderPrecisionHighpFloat.precision > 0;
    var mediumpAvailable = _vertexShaderPrecisionMediumpFloat.precision > 0;

    if ( _precisionVertex === "highp" && ! highpAvailable ) {

        if ( mediumpAvailable ) {

            _precisionVertex = "mediump";
            console.warn( "WebGLRenderer: highp not supported, using mediump" );

        } else {

            _precisionVertex = "lowp";
            console.warn( "WebGLRenderer: highp and mediump not supported, using lowp" );

        }

    }

    if ( _precisionVertex === "mediump" && ! mediumpAvailable ) {

        _precisionVertex = "lowp";
        console.warn( "WebGLRenderer: mediump not supported, using lowp" );

    }

    highpAvailable = _fragmentShaderPrecisionHighpFloat.precision > 0;
    mediumpAvailable = _fragmentShaderPrecisionMediumpFloat.precision > 0;

    if ( _precisionFragment === "highp" && ! highpAvailable ) {

        if ( mediumpAvailable ) {

            _precisionFragment = "mediump";
            console.warn( "WebGLRenderer: highp not supported, using mediump" );

        } else {

            _precisionFragment = "lowp";
            console.warn( "WebGLRenderer: highp and mediump not supported, using lowp" );

        }

    }

    if ( _precisionFragment === "mediump" && ! mediumpAvailable ) {

        _precisionFragment = "lowp";
        console.warn( "WebGLRenderer: mediump not supported, using lowp" );

    }

    // API

    this.getContext = function () {

        return _gl;

    };

    this.isWebGL2 = function() {

        return _isWebGL2;

    };

    this.forceContextLoss = function () {

        extensions.get( 'WEBGL_lose_context' ).loseContext();

    };

    // Note that this is only for test purposes to restore from a context-loss that was
    // simulated using forceContextLoss() function before.
    this.forceContextRestore = function() {
        extensions.get( 'WEBGL_lose_context' ).restoreContext();
    };

    this.supportsVertexTextures = function () {

        return _supportsVertexTextures;

    };

    this.supportsFloatTextures = function () {

        return _isWebGL2 || extensions.get( 'OES_texture_float' );

    };

    this.supportsHalfFloatTextures = function() {

        return _isWebGL2 || extensions.get( 'OES_texture_half_float_linear' );

    };

    this.supportsStandardDerivatives = function () {

        return _isWebGL2 || extensions.get( 'OES_standard_derivatives' );

    };

    this.supportsCompressedTextureS3TC = function () {

        return _isWebGL2 || extensions.get( 'WEBGL_compressed_texture_s3tc' );

    };

    this.supportsElementIndexUint = function () {

        return _isWebGL2 || extensions.get( 'OES_element_index_uint' );

    };

    this.supportsInstancedArrays = function() {
        return _isWebGL2 || !!_glExtensionInstancedArrays;
    };

    this.supportsBlendMinMax = function () {

        return _isWebGL2 || extensions.get( 'EXT_blend_minmax' );

    };

    this.getMaxAnisotropy = ( function () {

        var value;

        return function () {

            if ( value !== undefined ) {

                return value;

            }

            var extension = extensions.get( 'EXT_texture_filter_anisotropic' );

            value = extension !== null ? _gl.getParameter( extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT ) : 0;

            return value;

        };

    } )();

    this.getPixelRatio = function () {
        return _pixelRatio || _window.devicePixelRatio || 1;
    };
    /**
     * Sets a custom pixel ratio instead of the device's.
     * Set to a falsy value to restore the devicePixelRatio;
     * @param {Number|null} value
     */
    this.setPixelRatio = function ( value ) {
        _pixelRatio = value;
    };

    /**
     * @returns {WebGLFramebuffer} Currently bound framebuffer
     */
    this.getCurrentFramebuffer = function() {
        return _currentFramebuffer;
    };

    this.setSize = function ( width, height, updateStyle ) {

        const pixelRatio = this.getPixelRatio();
        _canvas.width = width * pixelRatio;
        _canvas.height = height * pixelRatio;

        if ( updateStyle !== false ) {

            _canvas.style.width = width + 'px';
            _canvas.style.height = height + 'px';

        }

        this.setViewport( 0, 0, width, height );
    };

    this.setViewport = function ( x, y, width, height ) {
        const pixelRatio = this.getPixelRatio();
        _viewportX = x * pixelRatio;
        _viewportY = y * pixelRatio;

        _viewportWidth = width * pixelRatio;
        _viewportHeight = height * pixelRatio;

        _gl.viewport( _viewportX, _viewportY, _viewportWidth, _viewportHeight );
    };
    
    // By default, setting a viewport only affects rendering to the framebuffer. I.e., when setting an offscreen 
    // target, gl viewport is set to the target size. This makes sure that a RenderTarget is always properly filled by default - independent of its resolution.
    // 
    // Setting resetViewportOnSetTarget to true avoids this behavior, so that the current viewport is also be preserved when using offscreen targets.
    var _enableViewportOnOffscreenTargets = false;
    this.enableViewportOnOffscreenTargets = function (enable) {
        _enableViewportOnOffscreenTargets = enable;
    };

    var _viewportStack = [];

    /** Push current viewport to viewport stack, so that it can be recovered by popViewport later. */
    this.pushViewport = function() {
        _viewportStack.push(_viewportX);
        _viewportStack.push(_viewportY);
        _viewportStack.push(_viewportWidth);
        _viewportStack.push(_viewportHeight);
    };

    /** Recover previously pushed viewport.*/
    this.popViewport = function() {
        var index = _viewportStack.length - 4;
        _viewportX      = _viewportStack[index];
        _viewportY      = _viewportStack[index+1];
        _viewportWidth  = _viewportStack[index+2];
        _viewportHeight = _viewportStack[index+3];
        _gl.viewport( _viewportX, _viewportY, _viewportWidth, _viewportHeight );

        _viewportStack.length = index;
    };

    this.setScissor = function ( x, y, width, height ) {
        const pixelRatio = this.getPixelRatio();
        _gl.scissor(
            x * pixelRatio,
            y * pixelRatio,
            width * pixelRatio,
            height * pixelRatio
        );

    };

    this.enableScissorTest = function ( enable ) {

        if ( enable ) {
            _gl.enable( _gl.SCISSOR_TEST );
        } else {
            _gl.disable( _gl.SCISSOR_TEST );
        }

    };

    // Clearing

    this.getClearColor = function (target) {
        if ( target === undefined ) {
            console.warn( 'WebGLRenderer: .getClearColor() now requires a Color as an argument' );
            target = new THREE.Color();
		}
        return target.copy( _clearColor );
    };

    this.setClearColor = function ( color, alpha ) {

        _clearColor.set( color );
        _clearAlpha = alpha !== undefined ? alpha : 1;

        glClearColor( _clearColor.r, _clearColor.g, _clearColor.b, _clearAlpha );

    };

    this.getClearAlpha = function () {

        return _clearAlpha;

    };

    this.setClearAlpha = function ( alpha ) {

        _clearAlpha = alpha;

        glClearColor( _clearColor.r, _clearColor.g, _clearColor.b, _clearAlpha );

    };

    this.clear = function ( color, depth, stencil ) {

        var bits = 0;

        if ( color === undefined || color ) bits |= _gl.COLOR_BUFFER_BIT;
        if ( depth === undefined || depth ) bits |= _gl.DEPTH_BUFFER_BIT;
        if ( stencil === undefined || stencil ) bits |= _gl.STENCIL_BUFFER_BIT;

        _gl.clear( bits );

    };

    this.clearColor = function () {

        _gl.clear( _gl.COLOR_BUFFER_BIT );

    };

    this.clearDepth = function () {

        _gl.clear( _gl.DEPTH_BUFFER_BIT );

    };

    this.clearStencil = function () {

        _gl.clear( _gl.STENCIL_BUFFER_BIT );

    };

    this.clearTarget = function ( renderTarget, color, depth, stencil ) {

        this.setRenderTarget( renderTarget );
        this.clear( color, depth, stencil );

    };


    // Reset

    this.resetGLState = resetGLState;

    // Internal functions

    // Buffer allocation

    function createLineBuffers ( geometry ) {

        geometry.__webglVertexBuffer = _gl.createBuffer();
        geometry.__webglColorBuffer = _gl.createBuffer();
        geometry.__webglLineDistanceBuffer = _gl.createBuffer();

        _this.info.memory.geometries ++;
    }

    function createPointCloudBuffers ( geometry ) {

        geometry.__webglVertexBuffer = _gl.createBuffer();
        geometry.__webglColorBuffer = _gl.createBuffer();

        _this.info.memory.geometries++;
    }

    function createMeshBuffers ( geometryGroup ) {

        geometryGroup.__webglVertexBuffer = _gl.createBuffer();
        geometryGroup.__webglNormalBuffer = _gl.createBuffer();
        geometryGroup.__webglTangentBuffer = _gl.createBuffer();
        geometryGroup.__webglColorBuffer = _gl.createBuffer();
        geometryGroup.__webglUVBuffer = _gl.createBuffer();
        geometryGroup.__webglUV2Buffer = _gl.createBuffer();

        geometryGroup.__webglSkinIndicesBuffer = _gl.createBuffer();
        geometryGroup.__webglSkinWeightsBuffer = _gl.createBuffer();

        geometryGroup.__webglFaceBuffer = _gl.createBuffer();
        geometryGroup.__webglLineBuffer = _gl.createBuffer();

        _this.info.memory.geometries ++;

    }

    // Events

    var onObjectRemoved = function ( event ) {

        var object = event.target;

        object.traverse( function ( child ) {

            child.removeEventListener( 'remove', onObjectRemoved );

            removeObject( child );

        } );

    };

    var onGeometryDispose = function ( event ) {

        var geometry = event.target;

        geometry.removeEventListener( 'dispose', onGeometryDispose );

        deallocateGeometry( geometry );

    };

    var onTextureDispose = function ( event ) {

        var texture = event.target;

        texture.removeEventListener( 'dispose', onTextureDispose );

        deallocateTexture( texture );

        _this.info.memory.textures --;


    };

    var onRenderTargetDispose = function ( event ) {

        var renderTarget = event.target;

        renderTarget.removeEventListener( 'dispose', onRenderTargetDispose );

        deallocateRenderTarget( renderTarget );

        _this.info.memory.textures --;

    };

    var onMaterialDispose = function ( event ) {

        var material = event.target;

        material.removeEventListener( 'dispose', onMaterialDispose );

        deallocateMaterial( material );

    };

    // Buffer deallocation

    var deleteBuffers = function ( geometry ) {

        if ( geometry.__webglVertexBuffer !== undefined )  { _gl.deleteBuffer( geometry.__webglVertexBuffer );  geometry.__webglVertexBuffer  = undefined; }
        if ( geometry.__webglNormalBuffer !== undefined )  { _gl.deleteBuffer( geometry.__webglNormalBuffer );  geometry.__webglNormalBuffer  = undefined; }
        if ( geometry.__webglTangentBuffer !== undefined ) { _gl.deleteBuffer( geometry.__webglTangentBuffer ); geometry.__webglTangentBuffer = undefined; }
        if ( geometry.__webglColorBuffer !== undefined )   { _gl.deleteBuffer( geometry.__webglColorBuffer );   geometry.__webglColorBuffer   = undefined; }
        if ( geometry.__webglUVBuffer !== undefined )      { _gl.deleteBuffer( geometry.__webglUVBuffer );      geometry.__webglUVBuffer      = undefined; }
        if ( geometry.__webglUV2Buffer !== undefined )     { _gl.deleteBuffer( geometry.__webglUV2Buffer );     geometry.__webglUV2Buffer     = undefined; }

        if ( geometry.__webglSkinIndicesBuffer !== undefined ) { _gl.deleteBuffer( geometry.__webglSkinIndicesBuffer ); geometry.__webglSkinIndicesBuffer = undefined; }
        if ( geometry.__webglSkinWeightsBuffer !== undefined ) { _gl.deleteBuffer( geometry.__webglSkinWeightsBuffer ); geometry.__webglSkinWeightsBuffer = undefined; }

        if ( geometry.__webglFaceBuffer !== undefined ) { _gl.deleteBuffer( geometry.__webglFaceBuffer ); geometry.__webglFaceBuffer = undefined; }
        if ( geometry.__webglLineBuffer !== undefined ) { _gl.deleteBuffer( geometry.__webglLineBuffer ); geometry.__webglLineBuffer = undefined; }

        if ( geometry.__webglLineDistanceBuffer !== undefined ) { _gl.deleteBuffer( geometry.__webglLineDistanceBuffer ); geometry.__webglLineDistanceBuffer = undefined; }
        // custom attributes

        if ( geometry.__webglCustomAttributesList !== undefined ) {

            for ( var name in geometry.__webglCustomAttributesList ) {

                _gl.deleteBuffer( geometry.__webglCustomAttributesList[ name ].buffer );

            }
            geometry.__webglCustomAttributesList = undefined;
        }

        _this.info.memory.geometries --;

    };


    var deallocateGeometry = function ( geometry ) {

        geometry.__webglInit = undefined;

        var i, len, m, ml;

        if ( geometry instanceof THREE.BufferGeometry ) {

            //[Firefly] Delete interleaved buffer
            if (geometry.vbbuffer !== undefined) {
                _gl.deleteBuffer(geometry.vbbuffer);
                geometry.vbbuffer = undefined;
            }

            //[Firefly] Delete index buffer (if not stored in vertex attribute object)
            if (geometry.ibbuffer !== undefined) {
                _gl.deleteBuffer(geometry.ibbuffer);
                geometry.ibbuffer = undefined;
            }
            if (geometry.iblinesbuffer !== undefined) {
                _gl.deleteBuffer(geometry.iblinesbuffer);
                geometry.iblinesbuffer = undefined;
            }

            //[Firefly] Delete vertex array objects.
            if (geometry.vaos) {
                for (i=0; i<geometry.vaos.length; i++) {
                    deleteVertexArray(geometry.vaos[i].vao);
                }
                geometry.vaos = undefined;
            }

            var attributes = geometry.attributes;

            for ( var key in attributes ) {

                if ( attributes[ key ].buffer !== undefined ) {

                    _gl.deleteBuffer( attributes[ key ].buffer );
                    attributes[key].buffer = undefined;
                }

            }

            _this.info.memory.geometries --;

        } else {

            var geometryGroupsList = geometryGroups[ geometry.id ];

            if ( geometryGroupsList !== undefined ) {

                for ( i = 0, len = geometryGroupsList.length; i < len; i ++ ) {

                    var geometryGroup = geometryGroupsList[ i ];

                    if ( geometryGroup.numMorphTargets !== undefined ) {

                        for ( m = 0, ml = geometryGroup.numMorphTargets; m < ml; m ++ ) {

                            _gl.deleteBuffer( geometryGroup.__webglMorphTargetsBuffers[ m ] );

                        }

                        delete geometryGroup.__webglMorphTargetsBuffers;

                    }

                    if ( geometryGroup.numMorphNormals !== undefined ) {

                        for ( m = 0, ml = geometryGroup.numMorphNormals; m < ml; m ++ ) {

                            _gl.deleteBuffer( geometryGroup.__webglMorphNormalsBuffers[ m ] );

                        }

                        delete geometryGroup.__webglMorphNormalsBuffers;

                    }

                    deleteBuffers( geometryGroup );

                }

                delete geometryGroups[ geometry.id ];

            } else {

                deleteBuffers( geometry );

            }

        }

    };

    this.deallocateGeometry = deallocateGeometry;

    var deallocateTexture = function ( texture ) {

        if ( texture.__webglTextureCube ) {

            // cube texture

            _gl.deleteTexture( texture.__webglTextureCube );
            texture.__webglTextureCube = undefined;

        } else {

            // 2D texture

            if ( ! texture.__webglInit ) return;

            _gl.deleteTexture( texture.__webglTexture );
            texture.__webglInit    = undefined;
            texture.__webglTexture = undefined;
        }

    };

    var deallocateRenderTarget = function ( renderTarget ) {

        if ( !renderTarget || ! renderTarget.__webglTexture ) return;

        _gl.deleteTexture( renderTarget.__webglTexture );

        _gl.deleteFramebuffer( renderTarget.__webglFramebuffer );
        // if the z-buffer is shared among targets, the first deallocation will set this shared
        // value to be undefined. Avoid calling WebGL with undefined parameters.
        if ( renderTarget.__webglRenderbuffer !== undefined ) {
            _gl.deleteRenderbuffer( renderTarget.__webglRenderbuffer );
        }

        if (renderTarget.__webglRenderbufferOwn !== undefined) {
            _gl.deleteRenderbuffer( renderTarget.__webglRenderbufferOwn );
            renderTarget.__webglRenderbufferOwn = undefined;
        }
    };

    var deallocateMaterial = function ( material ) {

        var deleteProgram = false;
        material.program = undefined;
        material.programs.forEach( function ( wrapper ) {

            var program;
            if ( wrapper === undefined || ( program = wrapper.program ) == undefined )
                return;

            // only deallocate GL program if this was the last use of shared program
            // assumed there is only single copy of any program in the _programs list
            // (that's how it's constructed)

            var i, il, programInfo;

            for ( i = 0, il = _programs.length; i < il; i ++ ) {

                programInfo = _programs[ i ];

                if ( programInfo && programInfo.program === program ) {

                    programInfo.usedTimes --;

                    if ( programInfo.usedTimes === 0 ) {

                        _programs[ i ] = undefined;
                        _gl.deleteProgram( program );
                        _this.info.memory.programs --;
                        deleteProgram = true;

                    }

                    break;

                }

            }

        }, false );

        material.programs.length = 0;

        if ( deleteProgram ) {

            // avoid using array.splice, this is costlier than creating new array from scratch

            _programs = _programs.filter( function( programInfo ) {
                return programInfo !== undefined;
            });

        }

    };

    // Buffer initialization

    function initCustomAttributes ( geometry, object ) {

        var nvertices = geometry.vertices.length;

        var material = object.material;

        if ( material.attributes ) {

            if ( geometry.__webglCustomAttributesList === undefined ) {

                geometry.__webglCustomAttributesList = [];

            }

            for ( var a in material.attributes ) {

                var attribute = material.attributes[ a ];

                if ( !attribute.__webglInitialized || attribute.createUniqueBuffers ) {

                    attribute.__webglInitialized = true;

                    var size = 1; // "f" and "i"

                    if ( attribute.type === "v2" ) size = 2;
                    else if ( attribute.type === "v3" ) size = 3;
                    else if ( attribute.type === "v4" ) size = 4;
                    else if ( attribute.type === "c"  ) size = 3;

                    attribute.size = size;

                    attribute.array = new Float32Array( nvertices * size );

                    attribute.buffer = _gl.createBuffer();
                    attribute.buffer.belongsToAttribute = a;

                    attribute.needsUpdate = true;

                }

                geometry.__webglCustomAttributesList.push( attribute );

            }

        }

    }

    function initLineBuffers ( geometry, object ) {

        var nvertices = geometry.vertices.length;

        geometry.__vertexArray = new Float32Array( nvertices * 3 );
        geometry.__colorArray = new Float32Array( nvertices * 3 );
        geometry.__lineDistanceArray = new Float32Array( nvertices * 1 );

        geometry.__webglLineCount = nvertices;

        initCustomAttributes ( geometry, object );
    }

    function initPointCloudBuffers(geometry, object) {

        var nvertices = geometry.vertices.length;

        geometry.__vertexArray = new Float32Array(nvertices * 3);
        geometry.__colorArray = new Float32Array(nvertices * 3);

        geometry.__webglPointCount = nvertices;

        initCustomAttributes(geometry, object);
    }

    function initMeshBuffers ( geometryGroup, object ) {

        var geometry = object.geometry,
            faces3 = geometryGroup.faces3,

            nvertices = faces3.length * 3,
            ntris     = faces3.length * 1,
            nlines    = faces3.length * 3,

            material = getBufferMaterial( object, geometryGroup ),

            uvType = bufferGuessUVType( material ),
            normalType = bufferGuessNormalType( material ),
            vertexColorType = bufferGuessVertexColorType( material );

        geometryGroup.__vertexArray = new Float32Array( nvertices * 3 );

        if ( normalType ) {

            geometryGroup.__normalArray = new Float32Array( nvertices * 3 );

        }

        if ( geometry.hasTangents ) {

            geometryGroup.__tangentArray = new Float32Array( nvertices * 4 );

        }

        if ( vertexColorType ) {

            geometryGroup.__colorArray = new Float32Array( nvertices * 3 );

        }

        if ( uvType ) {

            if ( geometry.faceVertexUvs.length > 0 ) {

                geometryGroup.__uvArray = new Float32Array( nvertices * 2 );

            }

            if ( geometry.faceVertexUvs.length > 1 ) {

                geometryGroup.__uv2Array = new Float32Array( nvertices * 2 );

            }

        }

        if ( object.geometry.skinWeights.length && object.geometry.skinIndices.length ) {

            geometryGroup.__skinIndexArray = new Float32Array( nvertices * 4 );
            geometryGroup.__skinWeightArray = new Float32Array( nvertices * 4 );

        }

        var UintArray = (_isWebGL2 || extensions.get( 'OES_element_index_uint' )) && ntris > 21845 ? Uint32Array : Uint16Array; // 65535 / 3

        geometryGroup.__typeArray = UintArray;
        geometryGroup.__faceArray = new UintArray( ntris * 3 );
        geometryGroup.__lineArray = new UintArray( nlines * 2 );

        geometryGroup.__webglFaceCount = ntris * 3;
        geometryGroup.__webglLineCount = nlines * 2;


        // custom attributes

        if ( material.attributes ) {

            if ( geometryGroup.__webglCustomAttributesList === undefined ) {

                geometryGroup.__webglCustomAttributesList = [];

            }

            for ( var a in material.attributes ) {

                // Do a shallow copy of the attribute object so different geometryGroup chunks use different
                // attribute buffers which are correctly indexed in the setMeshBuffers function

                var originalAttribute = material.attributes[ a ];

                var attribute = {};

                for ( var property in originalAttribute ) {

                    attribute[ property ] = originalAttribute[ property ];

                }

                if ( !attribute.__webglInitialized || attribute.createUniqueBuffers ) {

                    attribute.__webglInitialized = true;

                    var size = 1; // "f" and "i"

                    if( attribute.type === "v2" ) size = 2;
                    else if( attribute.type === "v3" ) size = 3;
                    else if( attribute.type === "v4" ) size = 4;
                    else if( attribute.type === "c"  ) size = 3;

                    attribute.size = size;

                    attribute.array = new Float32Array( nvertices * size );

                    attribute.buffer = _gl.createBuffer();
                    attribute.buffer.belongsToAttribute = a;

                    originalAttribute.needsUpdate = true;
                    attribute.__original = originalAttribute;

                }

                geometryGroup.__webglCustomAttributesList.push( attribute );

            }

        }

        geometryGroup.__inittedArrays = true;

    }

    function getBufferMaterial( object, geometryGroup ) {

        return object.material instanceof THREE.MeshFaceMaterial ?
            object.material.materials[ geometryGroup.materialIndex ] : object.material;

    }

    function materialNeedsSmoothNormals ( material ) {

        return material && ((material.shading !== undefined && material.shading === THREE.SmoothShading) ||
            (material.flatShading !== undefined && material.flatShading === false));
    }

    function bufferGuessNormalType ( material ) {

        // only MeshBasicMaterial and MeshDepthMaterial don't need normals

        if ( ( material instanceof THREE.MeshBasicMaterial && !material.envMap ) || material instanceof THREE.MeshDepthMaterial ) {

            return false;

        }

        if ( materialNeedsSmoothNormals( material ) ) {

            return THREE.SmoothShading;

        } else {

            return THREE.FlatShading;

        }

    }

    function bufferGuessVertexColorType( material ) {

        if ( material.vertexColors ) {

            return material.vertexColors;

        }

        return false;

    }

    function bufferGuessUVType( material ) {

        // material must use some texture to require uvs

        if ( material.map ||
             material.lightMap ||
             material.bumpMap ||
             material.normalMap ||
             material.specularMap ||
             material.alphaMap ||
             material instanceof THREE.ShaderMaterial ) {

            return true;

        }

        return false;

    }

    // new Threejs update
    function checkNeedsUpdate(elem) {
        return elem.needsUpdate === true;
    }

    function clearNeedsUpdate(elem) {
        elem.needsUpdate = false;
    }

    // Buffer setting


    function setLineBuffers ( geometry, hint ) {

        var v, c, d, vertex, offset, color,

        vertices = geometry.vertices,
        colors = geometry.colors,
        lineDistances = geometry.lineDistances,

        vl = vertices.length,
        cl = colors.length,
        dl = lineDistances.length,

        vertexArray = geometry.__vertexArray,
        colorArray = geometry.__colorArray,
        lineDistanceArray = geometry.__lineDistanceArray,

        dirtyVertices = geometry.verticesNeedUpdate,
        dirtyColors = geometry.colorsNeedUpdate,
        dirtyLineDistances = geometry.lineDistancesNeedUpdate,

        customAttributes = geometry.__webglCustomAttributesList,

        i, il,
        ca, cal, value,
        customAttribute;

        if ( dirtyVertices ) {

            for ( v = 0; v < vl; v ++ ) {

                vertex = vertices[ v ];

                offset = v * 3;

                vertexArray[ offset ]     = vertex.x;
                vertexArray[ offset + 1 ] = vertex.y;
                vertexArray[ offset + 2 ] = vertex.z;

            }

            _gl.bindBuffer( _gl.ARRAY_BUFFER, geometry.__webglVertexBuffer );
            _gl.bufferData( _gl.ARRAY_BUFFER, vertexArray, hint );

        }

        if ( dirtyColors ) {

            for ( c = 0; c < cl; c ++ ) {

                color = colors[ c ];

                offset = c * 3;

                colorArray[ offset ]     = color.r;
                colorArray[ offset + 1 ] = color.g;
                colorArray[ offset + 2 ] = color.b;

            }

            _gl.bindBuffer( _gl.ARRAY_BUFFER, geometry.__webglColorBuffer );
            _gl.bufferData( _gl.ARRAY_BUFFER, colorArray, hint );

        }

        if ( dirtyLineDistances ) {

            for ( d = 0; d < dl; d ++ ) {

                lineDistanceArray[ d ] = lineDistances[ d ];

            }

            _gl.bindBuffer( _gl.ARRAY_BUFFER, geometry.__webglLineDistanceBuffer );
            _gl.bufferData( _gl.ARRAY_BUFFER, lineDistanceArray, hint );

        }

        if ( customAttributes ) {

            for ( i = 0, il = customAttributes.length; i < il; i ++ ) {

                customAttribute = customAttributes[ i ];
                if (checkNeedsUpdate(customAttribute) &&
                     ( customAttribute.boundTo === undefined ||
                       customAttribute.boundTo === "vertices" ) ) {

                    offset = 0;

                    cal = customAttribute.value.length;

                    if ( customAttribute.size === 1 ) {

                        for ( ca = 0; ca < cal; ca ++ ) {

                            customAttribute.array[ ca ] = customAttribute.value[ ca ];

                        }

                    } else if ( customAttribute.size === 2 ) {

                        for ( ca = 0; ca < cal; ca ++ ) {

                            value = customAttribute.value[ ca ];

                            customAttribute.array[ offset ]     = value.x;
                            customAttribute.array[ offset + 1 ] = value.y;

                            offset += 2;

                        }

                    } else if ( customAttribute.size === 3 ) {

                        if ( customAttribute.type === "c" ) {

                            for ( ca = 0; ca < cal; ca ++ ) {

                                value = customAttribute.value[ ca ];

                                customAttribute.array[ offset ]     = value.r;
                                customAttribute.array[ offset + 1 ] = value.g;
                                customAttribute.array[ offset + 2 ] = value.b;

                                offset += 3;

                            }

                        } else {

                            for ( ca = 0; ca < cal; ca ++ ) {

                                value = customAttribute.value[ ca ];

                                customAttribute.array[ offset ]     = value.x;
                                customAttribute.array[ offset + 1 ] = value.y;
                                customAttribute.array[ offset + 2 ] = value.z;

                                offset += 3;

                            }

                        }

                    } else if ( customAttribute.size === 4 ) {

                        for ( ca = 0; ca < cal; ca ++ ) {

                            value = customAttribute.value[ ca ];

                            customAttribute.array[ offset ]      = value.x;
                            customAttribute.array[ offset + 1  ] = value.y;
                            customAttribute.array[ offset + 2  ] = value.z;
                            customAttribute.array[ offset + 3  ] = value.w;

                            offset += 4;

                        }

                    }

                    _gl.bindBuffer( _gl.ARRAY_BUFFER, customAttribute.buffer );
                    _gl.bufferData( _gl.ARRAY_BUFFER, customAttribute.array, hint );

                }

            }

        }

    }

    function setPointCloudBuffers(geometry, hint) {

        var v, c, vertex, offset, color,

        vertices = geometry.vertices,
        colors = geometry.colors,

        vl = vertices.length,
        cl = colors.length,

        vertexArray = geometry.__vertexArray,
        colorArray = geometry.__colorArray,

        dirtyVertices = geometry.verticesNeedUpdate,
        dirtyColors = geometry.colorsNeedUpdate,

        customAttributes = geometry.__webglCustomAttributesList,

        i, il,
        ca, cal, value,
        customAttribute;

        if (dirtyVertices) {

            for (v = 0; v < vl; v++) {

                vertex = vertices[v];

                offset = v * 3;

                vertexArray[offset] = vertex.x;
                vertexArray[offset + 1] = vertex.y;
                vertexArray[offset + 2] = vertex.z;

            }

            _gl.bindBuffer(_gl.ARRAY_BUFFER, geometry.__webglVertexBuffer);
            _gl.bufferData(_gl.ARRAY_BUFFER, vertexArray, hint);

        }

        if (dirtyColors) {

            for (c = 0; c < cl; c++) {

                color = colors[c];

                offset = c * 3;

                colorArray[offset] = color.r;
                colorArray[offset + 1] = color.g;
                colorArray[offset + 2] = color.b;

            }

            _gl.bindBuffer(_gl.ARRAY_BUFFER, geometry.__webglColorBuffer);
            _gl.bufferData(_gl.ARRAY_BUFFER, colorArray, hint);

        }

        if (customAttributes) {

            for (i = 0, il = customAttributes.length; i < il; i++) {

                customAttribute = customAttributes[i];
                if (checkNeedsUpdate(customAttribute) &&
                     (customAttribute.boundTo === undefined ||
                       customAttribute.boundTo === "vertices")) {

                    offset = 0;

                    cal = customAttribute.value.length;

                    if (customAttribute.size === 1) {

                        for (ca = 0; ca < cal; ca++) {

                            customAttribute.array[ca] = customAttribute.value[ca];

                        }

                    } else if (customAttribute.size === 2) {

                        for (ca = 0; ca < cal; ca++) {

                            value = customAttribute.value[ca];

                            customAttribute.array[offset]     = value.x;
                            customAttribute.array[offset + 1] = value.y;

                            offset += 2;

                        }

                    } else if (customAttribute.size === 3) {

                        if (customAttribute.type === "c") {

                            for (ca = 0; ca < cal; ca++) {

                                value = customAttribute.value[ca];

                                customAttribute.array[offset]     = value.r;
                                customAttribute.array[offset + 1] = value.g;
                                customAttribute.array[offset + 2] = value.b;

                                offset += 3;

                            }

                        } else {

                            for (ca = 0; ca < cal; ca++) {

                                value = customAttribute.value[ca];

                                customAttribute.array[offset]     = value.x;
                                customAttribute.array[offset + 1] = value.y;
                                customAttribute.array[offset + 2] = value.z;

                                offset += 3;

                            }

                        }

                    } else if (customAttribute.size === 4) {

                        for (ca = 0; ca < cal; ca++) {

                            value = customAttribute.value[ca];

                            customAttribute.array[offset]     = value.x;
                            customAttribute.array[offset + 1] = value.y;
                            customAttribute.array[offset + 2] = value.z;
                            customAttribute.array[offset + 3] = value.w;

                            offset += 4;

                        }

                    }

                    _gl.bindBuffer(_gl.ARRAY_BUFFER, customAttribute.buffer);
                    _gl.bufferData(_gl.ARRAY_BUFFER, customAttribute.array, hint);

                }

            }

        }

    }

    function setMeshBuffers(geometryGroup, object, hint, dispose, material) {

        if ( ! geometryGroup.__inittedArrays ) {

            return;

        }

        var normalType = bufferGuessNormalType( material ),
        vertexColorType = bufferGuessVertexColorType( material ),
        uvType = bufferGuessUVType( material ),

        needsSmoothNormals = ( normalType === THREE.SmoothShading );

        var f, fl, fi, face,
        vertexNormals, faceNormal,
        vertexColors, faceColor,
        vertexTangents,
        uv, uv2, v1, v2, v3, t1, t2, t3,
        c1, c2, c3,
        i, il,
        vn, uvi, uv2i,

        vertexIndex = 0,

        offset = 0,
        offset_uv = 0,
        offset_uv2 = 0,
        offset_face = 0,
        offset_normal = 0,
        offset_tangent = 0,
        offset_line = 0,
        offset_color = 0,
        offset_custom = 0,

        value,

        vertexArray = geometryGroup.__vertexArray,
        uvArray = geometryGroup.__uvArray,
        uv2Array = geometryGroup.__uv2Array,
        normalArray = geometryGroup.__normalArray,
        tangentArray = geometryGroup.__tangentArray,
        colorArray = geometryGroup.__colorArray,

        customAttributes = geometryGroup.__webglCustomAttributesList,
        customAttribute,

        faceArray = geometryGroup.__faceArray,
        lineArray = geometryGroup.__lineArray,

        geometry = object.geometry, // this is shared for all chunks

        dirtyVertices = geometry.verticesNeedUpdate,
        dirtyElements = geometry.elementsNeedUpdate,
        dirtyUvs = geometry.uvsNeedUpdate,
        dirtyNormals = geometry.normalsNeedUpdate,
        dirtyTangents = geometry.tangentsNeedUpdate,
        dirtyColors = geometry.colorsNeedUpdate,

        vertices = geometry.vertices,
        chunk_faces3 = geometryGroup.faces3,
        obj_faces = geometry.faces,

        obj_uvs  = geometry.faceVertexUvs[ 0 ],
        obj_uvs2 = geometry.faceVertexUvs[ 1 ];

        if ( dirtyVertices ) {

            for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                face = obj_faces[ chunk_faces3[ f ] ];

                v1 = vertices[ face.a ];
                v2 = vertices[ face.b ];
                v3 = vertices[ face.c ];

                vertexArray[ offset ]     = v1.x;
                vertexArray[ offset + 1 ] = v1.y;
                vertexArray[ offset + 2 ] = v1.z;

                vertexArray[ offset + 3 ] = v2.x;
                vertexArray[ offset + 4 ] = v2.y;
                vertexArray[ offset + 5 ] = v2.z;

                vertexArray[ offset + 6 ] = v3.x;
                vertexArray[ offset + 7 ] = v3.y;
                vertexArray[ offset + 8 ] = v3.z;

                offset += 9;

            }

            _gl.bindBuffer( _gl.ARRAY_BUFFER, geometryGroup.__webglVertexBuffer );
            _gl.bufferData( _gl.ARRAY_BUFFER, vertexArray, hint );

        }


        if ( dirtyColors && vertexColorType ) {

            for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                face = obj_faces[ chunk_faces3[ f ]	];

                vertexColors = face.vertexColors;
                faceColor = face.color;

                if ( vertexColors.length === 3 && vertexColorType === THREE.VertexColors ) {

                    c1 = vertexColors[ 0 ];
                    c2 = vertexColors[ 1 ];
                    c3 = vertexColors[ 2 ];

                } else {

                    c1 = faceColor;
                    c2 = faceColor;
                    c3 = faceColor;

                }

                colorArray[ offset_color ]     = c1.r;
                colorArray[ offset_color + 1 ] = c1.g;
                colorArray[ offset_color + 2 ] = c1.b;

                colorArray[ offset_color + 3 ] = c2.r;
                colorArray[ offset_color + 4 ] = c2.g;
                colorArray[ offset_color + 5 ] = c2.b;

                colorArray[ offset_color + 6 ] = c3.r;
                colorArray[ offset_color + 7 ] = c3.g;
                colorArray[ offset_color + 8 ] = c3.b;

                offset_color += 9;

            }

            if ( offset_color > 0 ) {

                _gl.bindBuffer( _gl.ARRAY_BUFFER, geometryGroup.__webglColorBuffer );
                _gl.bufferData( _gl.ARRAY_BUFFER, colorArray, hint );

            }

        }

        if ( dirtyTangents && geometry.hasTangents ) {

            for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                face = obj_faces[ chunk_faces3[ f ]	];

                vertexTangents = face.vertexTangents;

                t1 = vertexTangents[ 0 ];
                t2 = vertexTangents[ 1 ];
                t3 = vertexTangents[ 2 ];

                tangentArray[ offset_tangent ]     = t1.x;
                tangentArray[ offset_tangent + 1 ] = t1.y;
                tangentArray[ offset_tangent + 2 ] = t1.z;
                tangentArray[ offset_tangent + 3 ] = t1.w;

                tangentArray[ offset_tangent + 4 ] = t2.x;
                tangentArray[ offset_tangent + 5 ] = t2.y;
                tangentArray[ offset_tangent + 6 ] = t2.z;
                tangentArray[ offset_tangent + 7 ] = t2.w;

                tangentArray[ offset_tangent + 8 ]  = t3.x;
                tangentArray[ offset_tangent + 9 ]  = t3.y;
                tangentArray[ offset_tangent + 10 ] = t3.z;
                tangentArray[ offset_tangent + 11 ] = t3.w;

                offset_tangent += 12;

            }

            _gl.bindBuffer( _gl.ARRAY_BUFFER, geometryGroup.__webglTangentBuffer );
            _gl.bufferData( _gl.ARRAY_BUFFER, tangentArray, hint );

        }

        if ( dirtyNormals && normalType ) {

            for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                face = obj_faces[ chunk_faces3[ f ]	];

                vertexNormals = face.vertexNormals;
                faceNormal = face.normal;

                if ( vertexNormals.length === 3 && needsSmoothNormals ) {

                    for ( i = 0; i < 3; i ++ ) {

                        vn = vertexNormals[ i ];

                        normalArray[ offset_normal ]     = vn.x;
                        normalArray[ offset_normal + 1 ] = vn.y;
                        normalArray[ offset_normal + 2 ] = vn.z;

                        offset_normal += 3;

                    }

                } else {

                    for ( i = 0; i < 3; i ++ ) {

                        normalArray[ offset_normal ]     = faceNormal.x;
                        normalArray[ offset_normal + 1 ] = faceNormal.y;
                        normalArray[ offset_normal + 2 ] = faceNormal.z;

                        offset_normal += 3;

                    }

                }

            }

            _gl.bindBuffer( _gl.ARRAY_BUFFER, geometryGroup.__webglNormalBuffer );
            _gl.bufferData( _gl.ARRAY_BUFFER, normalArray, hint );

        }

        if ( dirtyUvs && obj_uvs && uvType ) {

            for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                fi = chunk_faces3[ f ];

                uv = obj_uvs[ fi ];

                if ( uv === undefined ) continue;

                for ( i = 0; i < 3; i ++ ) {

                    uvi = uv[ i ];

                    uvArray[ offset_uv ]     = uvi.x;
                    uvArray[ offset_uv + 1 ] = uvi.y;

                    offset_uv += 2;

                }

            }

            if ( offset_uv > 0 ) {

                _gl.bindBuffer( _gl.ARRAY_BUFFER, geometryGroup.__webglUVBuffer );
                _gl.bufferData( _gl.ARRAY_BUFFER, uvArray, hint );

            }

        }

        if ( dirtyUvs && obj_uvs2 && uvType ) {

            for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                fi = chunk_faces3[ f ];

                uv2 = obj_uvs2[ fi ];

                if ( uv2 === undefined ) continue;

                for ( i = 0; i < 3; i ++ ) {

                    uv2i = uv2[ i ];

                    uv2Array[ offset_uv2 ]     = uv2i.x;
                    uv2Array[ offset_uv2 + 1 ] = uv2i.y;

                    offset_uv2 += 2;

                }

            }

            if ( offset_uv2 > 0 ) {

                _gl.bindBuffer( _gl.ARRAY_BUFFER, geometryGroup.__webglUV2Buffer );
                _gl.bufferData( _gl.ARRAY_BUFFER, uv2Array, hint );

            }

        }

        if ( dirtyElements ) {

            for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                faceArray[ offset_face ]     = vertexIndex;
                faceArray[ offset_face + 1 ] = vertexIndex + 1;
                faceArray[ offset_face + 2 ] = vertexIndex + 2;

                offset_face += 3;

                lineArray[ offset_line ]     = vertexIndex;
                lineArray[ offset_line + 1 ] = vertexIndex + 1;

                lineArray[ offset_line + 2 ] = vertexIndex;
                lineArray[ offset_line + 3 ] = vertexIndex + 2;

                lineArray[ offset_line + 4 ] = vertexIndex + 1;
                lineArray[ offset_line + 5 ] = vertexIndex + 2;

                offset_line += 6;

                vertexIndex += 3;

            }

            _gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, geometryGroup.__webglFaceBuffer );
            _gl.bufferData( _gl.ELEMENT_ARRAY_BUFFER, faceArray, hint );

            _gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, geometryGroup.__webglLineBuffer );
            _gl.bufferData( _gl.ELEMENT_ARRAY_BUFFER, lineArray, hint );

        }

        if ( customAttributes ) {

            for ( i = 0, il = customAttributes.length; i < il; i ++ ) {

                customAttribute = customAttributes[ i ];

                if ( !checkNeedsUpdate(customAttribute.__original)) continue;

                offset_custom = 0;

                if ( customAttribute.size === 1 ) {

                    if ( customAttribute.boundTo === undefined || customAttribute.boundTo === "vertices" ) {

                        for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                            face = obj_faces[ chunk_faces3[ f ]	];

                            customAttribute.array[ offset_custom ] 	   = customAttribute.value[ face.a ];
                            customAttribute.array[ offset_custom + 1 ] = customAttribute.value[ face.b ];
                            customAttribute.array[ offset_custom + 2 ] = customAttribute.value[ face.c ];

                            offset_custom += 3;

                        }

                    } else if ( customAttribute.boundTo === "faces" ) {

                        for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                            value = customAttribute.value[ chunk_faces3[ f ] ];

                            customAttribute.array[ offset_custom ] 	   = value;
                            customAttribute.array[ offset_custom + 1 ] = value;
                            customAttribute.array[ offset_custom + 2 ] = value;

                            offset_custom += 3;

                        }

                    }

                } else if ( customAttribute.size === 2 ) {

                    if ( customAttribute.boundTo === undefined || customAttribute.boundTo === "vertices" ) {

                        for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                            face = obj_faces[ chunk_faces3[ f ]	];

                            v1 = customAttribute.value[ face.a ];
                            v2 = customAttribute.value[ face.b ];
                            v3 = customAttribute.value[ face.c ];

                            customAttribute.array[ offset_custom ] 	   = v1.x;
                            customAttribute.array[ offset_custom + 1 ] = v1.y;

                            customAttribute.array[ offset_custom + 2 ] = v2.x;
                            customAttribute.array[ offset_custom + 3 ] = v2.y;

                            customAttribute.array[ offset_custom + 4 ] = v3.x;
                            customAttribute.array[ offset_custom + 5 ] = v3.y;

                            offset_custom += 6;

                        }

                    } else if ( customAttribute.boundTo === "faces" ) {

                        for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                            value = customAttribute.value[ chunk_faces3[ f ] ];

                            v1 = value;
                            v2 = value;
                            v3 = value;

                            customAttribute.array[ offset_custom ] 	   = v1.x;
                            customAttribute.array[ offset_custom + 1 ] = v1.y;

                            customAttribute.array[ offset_custom + 2 ] = v2.x;
                            customAttribute.array[ offset_custom + 3 ] = v2.y;

                            customAttribute.array[ offset_custom + 4 ] = v3.x;
                            customAttribute.array[ offset_custom + 5 ] = v3.y;

                            offset_custom += 6;

                        }

                    }

                } else if ( customAttribute.size === 3 ) {

                    var pp;

                    if ( customAttribute.type === "c" ) {

                        pp = [ "r", "g", "b" ];

                    } else {

                        pp = [ "x", "y", "z" ];

                    }

                    if ( customAttribute.boundTo === undefined || customAttribute.boundTo === "vertices" ) {

                        for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                            face = obj_faces[ chunk_faces3[ f ]	];

                            v1 = customAttribute.value[ face.a ];
                            v2 = customAttribute.value[ face.b ];
                            v3 = customAttribute.value[ face.c ];

                            customAttribute.array[ offset_custom ] 	   = v1[ pp[ 0 ] ];
                            customAttribute.array[ offset_custom + 1 ] = v1[ pp[ 1 ] ];
                            customAttribute.array[ offset_custom + 2 ] = v1[ pp[ 2 ] ];

                            customAttribute.array[ offset_custom + 3 ] = v2[ pp[ 0 ] ];
                            customAttribute.array[ offset_custom + 4 ] = v2[ pp[ 1 ] ];
                            customAttribute.array[ offset_custom + 5 ] = v2[ pp[ 2 ] ];

                            customAttribute.array[ offset_custom + 6 ] = v3[ pp[ 0 ] ];
                            customAttribute.array[ offset_custom + 7 ] = v3[ pp[ 1 ] ];
                            customAttribute.array[ offset_custom + 8 ] = v3[ pp[ 2 ] ];

                            offset_custom += 9;

                        }

                    } else if ( customAttribute.boundTo === "faces" ) {

                        for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                            value = customAttribute.value[ chunk_faces3[ f ] ];

                            v1 = value;
                            v2 = value;
                            v3 = value;

                            customAttribute.array[ offset_custom ] 	   = v1[ pp[ 0 ] ];
                            customAttribute.array[ offset_custom + 1 ] = v1[ pp[ 1 ] ];
                            customAttribute.array[ offset_custom + 2 ] = v1[ pp[ 2 ] ];

                            customAttribute.array[ offset_custom + 3 ] = v2[ pp[ 0 ] ];
                            customAttribute.array[ offset_custom + 4 ] = v2[ pp[ 1 ] ];
                            customAttribute.array[ offset_custom + 5 ] = v2[ pp[ 2 ] ];

                            customAttribute.array[ offset_custom + 6 ] = v3[ pp[ 0 ] ];
                            customAttribute.array[ offset_custom + 7 ] = v3[ pp[ 1 ] ];
                            customAttribute.array[ offset_custom + 8 ] = v3[ pp[ 2 ] ];

                            offset_custom += 9;

                        }

                    } else if ( customAttribute.boundTo === "faceVertices" ) {

                        for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                            value = customAttribute.value[ chunk_faces3[ f ] ];

                            v1 = value[ 0 ];
                            v2 = value[ 1 ];
                            v3 = value[ 2 ];

                            customAttribute.array[ offset_custom ] 	   = v1[ pp[ 0 ] ];
                            customAttribute.array[ offset_custom + 1 ] = v1[ pp[ 1 ] ];
                            customAttribute.array[ offset_custom + 2 ] = v1[ pp[ 2 ] ];

                            customAttribute.array[ offset_custom + 3 ] = v2[ pp[ 0 ] ];
                            customAttribute.array[ offset_custom + 4 ] = v2[ pp[ 1 ] ];
                            customAttribute.array[ offset_custom + 5 ] = v2[ pp[ 2 ] ];

                            customAttribute.array[ offset_custom + 6 ] = v3[ pp[ 0 ] ];
                            customAttribute.array[ offset_custom + 7 ] = v3[ pp[ 1 ] ];
                            customAttribute.array[ offset_custom + 8 ] = v3[ pp[ 2 ] ];

                            offset_custom += 9;

                        }

                    }

                } else if ( customAttribute.size === 4 ) {

                    if ( customAttribute.boundTo === undefined || customAttribute.boundTo === "vertices" ) {

                        for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                            face = obj_faces[ chunk_faces3[ f ]	];

                            v1 = customAttribute.value[ face.a ];
                            v2 = customAttribute.value[ face.b ];
                            v3 = customAttribute.value[ face.c ];

                            customAttribute.array[ offset_custom  ]     = v1.x;
                            customAttribute.array[ offset_custom + 1  ] = v1.y;
                            customAttribute.array[ offset_custom + 2  ] = v1.z;
                            customAttribute.array[ offset_custom + 3  ] = v1.w;

                            customAttribute.array[ offset_custom + 4  ] = v2.x;
                            customAttribute.array[ offset_custom + 5  ] = v2.y;
                            customAttribute.array[ offset_custom + 6  ] = v2.z;
                            customAttribute.array[ offset_custom + 7  ] = v2.w;

                            customAttribute.array[ offset_custom + 8  ] = v3.x;
                            customAttribute.array[ offset_custom + 9  ] = v3.y;
                            customAttribute.array[ offset_custom + 10 ] = v3.z;
                            customAttribute.array[ offset_custom + 11 ] = v3.w;

                            offset_custom += 12;

                        }

                    } else if ( customAttribute.boundTo === "faces" ) {

                        for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                            value = customAttribute.value[ chunk_faces3[ f ] ];

                            v1 = value;
                            v2 = value;
                            v3 = value;

                            customAttribute.array[ offset_custom  ]     = v1.x;
                            customAttribute.array[ offset_custom + 1  ] = v1.y;
                            customAttribute.array[ offset_custom + 2  ] = v1.z;
                            customAttribute.array[ offset_custom + 3  ] = v1.w;

                            customAttribute.array[ offset_custom + 4  ] = v2.x;
                            customAttribute.array[ offset_custom + 5  ] = v2.y;
                            customAttribute.array[ offset_custom + 6  ] = v2.z;
                            customAttribute.array[ offset_custom + 7  ] = v2.w;

                            customAttribute.array[ offset_custom + 8  ] = v3.x;
                            customAttribute.array[ offset_custom + 9  ] = v3.y;
                            customAttribute.array[ offset_custom + 10 ] = v3.z;
                            customAttribute.array[ offset_custom + 11 ] = v3.w;

                            offset_custom += 12;

                        }

                    } else if ( customAttribute.boundTo === "faceVertices" ) {

                        for ( f = 0, fl = chunk_faces3.length; f < fl; f ++ ) {

                            value = customAttribute.value[ chunk_faces3[ f ] ];

                            v1 = value[ 0 ];
                            v2 = value[ 1 ];
                            v3 = value[ 2 ];

                            customAttribute.array[ offset_custom  ]     = v1.x;
                            customAttribute.array[ offset_custom + 1  ] = v1.y;
                            customAttribute.array[ offset_custom + 2  ] = v1.z;
                            customAttribute.array[ offset_custom + 3  ] = v1.w;

                            customAttribute.array[ offset_custom + 4  ] = v2.x;
                            customAttribute.array[ offset_custom + 5  ] = v2.y;
                            customAttribute.array[ offset_custom + 6  ] = v2.z;
                            customAttribute.array[ offset_custom + 7  ] = v2.w;

                            customAttribute.array[ offset_custom + 8  ] = v3.x;
                            customAttribute.array[ offset_custom + 9  ] = v3.y;
                            customAttribute.array[ offset_custom + 10 ] = v3.z;
                            customAttribute.array[ offset_custom + 11 ] = v3.w;

                            offset_custom += 12;

                        }

                    }

                }

                _gl.bindBuffer( _gl.ARRAY_BUFFER, customAttribute.buffer );
                _gl.bufferData( _gl.ARRAY_BUFFER, customAttribute.array, hint );

            }

        }

        if ( dispose ) {

            delete geometryGroup.__inittedArrays;
            delete geometryGroup.__colorArray;
            delete geometryGroup.__normalArray;
            delete geometryGroup.__tangentArray;
            delete geometryGroup.__uvArray;
            delete geometryGroup.__uv2Array;
            delete geometryGroup.__faceArray;
            delete geometryGroup.__vertexArray;
            delete geometryGroup.__lineArray;
            delete geometryGroup.__skinIndexArray;
            delete geometryGroup.__skinWeightArray;

        }

    }


    //[Firefly] This function is different from Three.js -- it adds
    //support for interleaved buffers and drawing from system memory
    //using a shared dynamic buffer.
    function setDirectBuffers ( geometry ) {

        //[Firefly]
        //Geometries that will draw directly
        //from system memory skip alocations of
        //GPU side GL buffers.
        if (geometry.streamingDraw) {

            //Do we want just the index buffer on the GPU?
            if (!geometry.streamingIndex) {
                var index = geometry.index;
                if (index) {
                    index.buffer = _gl.createBuffer();
                    _gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, index.buffer );
                    _gl.bufferData( _gl.ELEMENT_ARRAY_BUFFER, index.array || geometry.ib, _gl.STATIC_DRAW );
                }
            }

            return;
        }


        //[Firefly]
        //Does the geometry have an interleaved
        //vertex buffer?
        if (geometry.vb && geometry.vbbuffer === undefined) {

            geometry.vbbuffer = _gl.createBuffer();
            geometry.vbNeedsUpdate = true;
        }

        // [HB:] geometry.ib is legacy LMV, geometry.index is what is used by latest THREE
        const indexArray = geometry.ib || geometry.index?.array;

        //[Firefly] Is there an .ib property outside the index attribute (since we use globally shared attributes)?
        if (indexArray && geometry.ibbuffer === undefined) {
            geometry.ibbuffer = _gl.createBuffer();
            _gl.bindBuffer(_gl.ELEMENT_ARRAY_BUFFER, geometry.ibbuffer);
            _gl.bufferData(_gl.ELEMENT_ARRAY_BUFFER, indexArray, _gl.STATIC_DRAW);
        }
        if (geometry.iblines && geometry.iblinesbuffer === undefined) {
            geometry.iblinesbuffer = _gl.createBuffer();
            _gl.bindBuffer(_gl.ELEMENT_ARRAY_BUFFER, geometry.iblinesbuffer);
            _gl.bufferData(_gl.ELEMENT_ARRAY_BUFFER, geometry.iblines, _gl.STATIC_DRAW);
        }

        var attributes = geometry.attributes;
        var attributesKeys = Object.keys(geometry.attributes);

        for ( var i = 0, len = attributesKeys.length; i < len; i ++ ) {

            var attributeName = attributesKeys[ i ];
            var attributeItem = attributes[ attributeName ];
            var isIndex = ( attributeName === 'index' );

            if ( attributeItem.array &&
                attributeItem.buffer === undefined ) {

                attributeItem.buffer = _gl.createBuffer();
                attributeItem.needsUpdate = true;

            }

            if (checkNeedsUpdate(attributeItem)) {

                var bufferType = isIndex ? _gl.ELEMENT_ARRAY_BUFFER : _gl.ARRAY_BUFFER;

                _gl.bindBuffer( bufferType, attributeItem.buffer );
                _gl.bufferData( bufferType, attributeItem.array, _gl.STATIC_DRAW );

                clearNeedsUpdate(attributeItem);

            }

        }

        //Update the common interleaved vb if needed
        if (geometry.vbNeedsUpdate) {

            _gl.bindBuffer( _gl.ARRAY_BUFFER, geometry.vbbuffer);
            _gl.bufferData( _gl.ARRAY_BUFFER, geometry.vb, _gl.STATIC_DRAW);
            geometry.vbNeedsUpdate = false;

            // free cpu-side copy (if wanted)
            if (geometry.discardAfterUpload) {
                geometry.vb = null;
            }
        }

    }

    //Wrappers for smoothing API differences between WebGL 1 and 2.

    function createVertexArray() {
        return _isWebGL2 ? _gl.createVertexArray() : _glExtensionVAO.createVertexArrayOES();
    }

    function bindVertexArray(vao) {
        _isWebGL2 ? _gl.bindVertexArray(vao) : _glExtensionVAO.bindVertexArrayOES(vao);
    }

    function deleteVertexArray(vao) {
        _isWebGL2 ? _gl.deleteVertexArray(vao) : _glExtensionVAO.deleteVertexArrayOES(vao);
    }

    function vertexAttribDivisor(programAttribute, numInstances, divisor) {
        if (_isWebGL2) {
            _gl.vertexAttribDivisor(programAttribute, numInstances ? divisor || 0 : 0);
        } else if (_glExtensionInstancedArrays) {
            _glExtensionInstancedArrays.vertexAttribDivisorANGLE(programAttribute, numInstances ? divisor || 0 : 0);
        }

    }

    function drawElementsInstanced(geomType, count, type, offset, numInstances) {
        if (_isWebGL2) {
            _gl.drawElementsInstanced( geomType, count, type, offset, numInstances );
        } else {
            _glExtensionInstancedArrays.drawElementsInstancedANGLE( geomType, count, type, offset, numInstances );
        }
    }

    function drawArraysInstanced(geomType, first, count, numInstances) {
        if (_isWebGL2) {
            _gl.drawArraysInstanced( geomType, first, count, numInstances );
        } else {
            _glExtensionInstancedArrays.drawArraysInstancedANGLE( geomType, first, count, numInstances );
        }
    }

    // Buffer rendering

    //[Firefly] Setup rendering of static model data using Vertex Array Objects
    //Currently we only do this for buffer geometry that is on GPU memory and has no
    //default material attributes and has a single draw batch (offsets array has length 1).
    //Other geometry passes through setupVertexAttributes instead, to set up
    //the vertex layout on every draw.
    function setupVAO( material, program, geometry, uvChannel) {

        var vao;

        if (!USE_VAO || geometry.streamingDraw) {
            geometry.vaos = null;
            return false;
        }

        if (!_isWebGL2 && !_glExtensionVAO) {
            geometry.vaos = null;
            return false;
        }

        if (geometry.vaos === undefined)
            geometry.vaos = [];

        //Set up a VAO for this object
        vao = createVertexArray();
        geometry.vaos.push( { geomhash : program.id, uv : uvChannel, vao : vao } );
        bindVertexArray(vao);

        //bind the index buffer
        if (material.isEdgeMaterial) {
            _gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, geometry.iblinesbuffer );
        } else {
            var index = geometry.index;
            if (index)
                _gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, index.buffer || geometry.ibbuffer );
        }

        //Bind the vertex attributes used by the current program
        var boundBuffer = null;
        var programAttributes = program.attributes;
        var programAttributesKeys = program.attributesKeys;

        var stride = geometry.vbstride;
        var startIndex = (geometry.groups?.length) ? geometry.groups[0].index : 0;
        var instanceStart = (geometry.groups?.length) ? (geometry.groups[0].instanceStart || 0) : 0;

        //Set up vertex attributes
        for ( var i = 0, len = programAttributesKeys.length; i < len; i ++ ) {

            var key = programAttributesKeys[ i ];
            var programAttribute = programAttributes[ key ];

            if ( programAttribute >= 0 ) {

                var geometryAttribute = geometry.attributes[ key ];

                // Override 'uv' attribute mapping if uvChannel is specified
                // (account for the 1-based indexing used for the additional UV channel attributes)
                if (key === 'uv' && uvChannel) {
                    geometryAttribute = geometry.attributes['uv' + (uvChannel + 1)];
                }

                if (geometryAttribute) {

                    var type = _gl.FLOAT;
                    var itemWidth = geometryAttribute.bytesPerItem || 4;
                    if (itemWidth === 1) {
                        type = _gl.UNSIGNED_BYTE;
                    } else if (itemWidth === 2) {
                        type = _gl.UNSIGNED_SHORT;
                    }

                    _gl.enableVertexAttribArray(programAttribute);

                    var start = startIndex;
                    if (geometryAttribute.divisor)
                        start += instanceStart;
                    if (geometryAttribute.itemOffset !== undefined) //it's part of the interleaved VB, so process it here
                    {
                        if (boundBuffer != geometry.vbbuffer) {
                            _gl.bindBuffer( _gl.ARRAY_BUFFER, geometry.vbbuffer );
                            boundBuffer = geometry.vbbuffer;
                        }

                        _gl.vertexAttribPointer( programAttribute, geometryAttribute.itemSize, type, geometryAttribute.normalized, stride * 4, (geometryAttribute.itemOffset + start * stride) * 4 );
                    }
                    else {
                        _gl.bindBuffer( _gl.ARRAY_BUFFER, geometryAttribute.buffer );
                        boundBuffer = geometryAttribute.buffer;

                        _gl.vertexAttribPointer( programAttribute, geometryAttribute.itemSize, type, geometryAttribute.normalized, 0, start * geometryAttribute.itemSize * itemWidth ); // 4 bytes per Float32
                    }

                    vertexAttribDivisor(programAttribute, geometry.numInstances, geometryAttribute.divisor);

                } else {

                    //Default material attributes cannot be set in VAO, so we have to abort the VAO setup
                    //and fall back to the regular setupVertexAttributes in draw loop way.
                    //This is hopefully very rare.
                    bindVertexArray(null);

                    for ( var j=0; j<geometry.vaos.length; j++)
                        deleteVertexArray(geometry.vaos[j].vao);

                    geometry.vaos = null; //Flag it so we don't pass through here again.

                    return false;
                }

            }
        }

        return true;
    }

    function activateVAO( material, program, geometry, uvChannel) {
        var vaos = geometry.vaos;

        if (vaos) {
            //The assumption is that this array is rarely bigger than one or two items,
            //so it's faster to do a search than use object hashmap based on geomhash.
            for (var i = 0, len = vaos.length; i < len; i++) {
                var cache = vaos[i];
                if (cache.geomhash === program.id && cache.uv === uvChannel) {
                    bindVertexArray(cache.vao);
                    return true;
                }
            }
        } else if (vaos === null) {
            return false;
        }

        return setupVAO(material, program, geometry, uvChannel);
    }


    function bindDynamic(dynBufName, srcData) {
        var boundBuffer = _dynamicBuffers[dynBufName];
        if (!boundBuffer) {
            boundBuffer = _gl.createBuffer();
            _dynamicBuffers[dynBufName] = boundBuffer;
        }

        _gl.bindBuffer( _gl.ARRAY_BUFFER, boundBuffer);
        _gl.bufferData( _gl.ARRAY_BUFFER, srcData, _gl.DYNAMIC_DRAW);

        return boundBuffer;
    }


    //[Firefly] This function is different from Three.js -- it adds
    //support for interleaved buffers and drawing from system memory
    //using a shared dynamic buffer.
    function setupVertexAttributes( material, program, geometry, startIndex, indices, uvChannel, instanceStart) {

        var programAttributes = program.attributes;
        var programAttributesKeys = program.attributesKeys;

        //Those two need to be unequal to begin with...
        var boundBuffer = 0;
        var interleavedBuffer;


        if (indices) {
            // indices (they can have a VBO even if the geometry part is streamed)
            if (!indices.buffer && geometry.streamingDraw) {
                var buffer = _dynamicBuffers.index;
                if (!buffer) {
                    buffer = _gl.createBuffer();
                    _dynamicBuffers.index = buffer;
                }

                //_gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, null);
                _gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, buffer);

                if (material.isEdgeMaterial) {
                    _gl.bufferData( _gl.ELEMENT_ARRAY_BUFFER, geometry.iblines, _gl.DYNAMIC_DRAW);
                } else {
                    _gl.bufferData( _gl.ELEMENT_ARRAY_BUFFER, indices.array || geometry.ib, _gl.DYNAMIC_DRAW);
                }
            }
            else {
                if (material.isEdgeMaterial) {
                    _gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, geometry.iblinesbuffer );
                } else {
                    _gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, indices.buffer || geometry.ibbuffer );
                }
            }
        }


        //Set attributes
        for ( var i = 0, len = programAttributesKeys.length; i < len; i ++ ) {

            var key = programAttributesKeys[ i ];
            var programAttribute = programAttributes[ key ];

            if ( programAttribute >= 0 ) {

                var geometryAttribute = geometry.attributes[ key ];
                if (key === 'uv' && uvChannel) {
                    geometryAttribute = geometry.attributes['uv' + (uvChannel + 1)];
                }

                if ( geometryAttribute ) {

                    var isInterleaved = (geometryAttribute.itemOffset !== undefined);

                    var stride, itemOffset;

                    if (isInterleaved) {

                        stride = geometry.vbstride;
                        itemOffset = geometryAttribute.itemOffset;

                        if (boundBuffer !== interleavedBuffer) {
                            if (geometry.streamingDraw) {

                                boundBuffer = bindDynamic('interleavedVB', geometry.vb);

                            } else {

                                boundBuffer = geometry.vbbuffer;
                                _gl.bindBuffer(_gl.ARRAY_BUFFER, boundBuffer);

                            }

                            interleavedBuffer = boundBuffer;
                        }

                    } else {

                        stride = geometryAttribute.itemSize;
                        itemOffset = 0;

                        if (geometry.streamingDraw) {

                            boundBuffer = bindDynamic(key, geometryAttribute.array);

                        } else {

                            boundBuffer = geometryAttribute.buffer;
                            _gl.bindBuffer(_gl.ARRAY_BUFFER, boundBuffer);

                        }
                    }

                    var type = _gl.FLOAT;
                    var itemWidth = geometryAttribute.bytesPerItem || 4;
                    if (itemWidth === 1) {
                        type = _gl.UNSIGNED_BYTE;
                    } else if (itemWidth === 2) {
                        type = _gl.UNSIGNED_SHORT;
                    }

                    if (isInterleaved)
                        itemWidth = 4; //our interleaved buffers define stride in multiples of 4 bytes

                    bindingStates.enableAttribute( programAttribute );

                    var start = startIndex;
                    if (geometryAttribute.divisor)
                        start += instanceStart;
                    _gl.vertexAttribPointer( programAttribute, geometryAttribute.itemSize, type, geometryAttribute.normalized, stride * itemWidth, (itemOffset + start * stride) * itemWidth );

                    vertexAttribDivisor(programAttribute, geometry.numInstances, geometryAttribute.divisor);

                } else if (material.defaultAttributeValues) {

                    var attr = material.defaultAttributeValues[ key ];

                    if ( attr && attr.length === 2 ) {

                        _gl.vertexAttrib2fv( programAttribute, material.defaultAttributeValues[ key ] );

                    } else if ( attr && attr.length === 3 ) {

                        _gl.vertexAttrib3fv( programAttribute, material.defaultAttributeValues[ key ] );

                    } else if ( attr && attr.length === 4 ) {

                        _gl.vertexAttrib4fv( programAttribute, material.defaultAttributeValues[ key ] );

                    }

                }
            }
        }

        bindingStates.disableUnusedAttributes();

    }


    // Buffer rendering

    this.renderBufferDirect = function(camera, lights, fog, material, geometry, object, uvChannel) {

        // Make sure that buffer doesn't contain any resources lost contexts
        _this.lostContextRecovery && _this.lostContextRecovery.refreshIfNeeded(geometry);

        if ( material.visible === false ) return;

        if (material.isEdgeMaterial && !geometry.iblines) return;

        setDirectBuffers(object.geometry);

        var program = setProgram( camera, lights, fog, material, object );

        var updateBuffers = false,
            wireframeBit = material.wireframe ? 1 : 0,
            geometryHash = 'direct_' + geometry.id + (uvChannel ? '/' + uvChannel : '') + '_' + program.id + '_' + wireframeBit;

        if ( geometryHash !== _currentGeometryProgram ) {

            _currentGeometryProgram = geometryHash;
            updateBuffers = true;

        }

        // By default, we do a single drawcall for the whole geometry.
        // Alternatively, geometry.groups may specify one or more sub-drawcalls.
        var hasDrawCalls = geometry.groups?.length;

        // Even multiple draw-calls can usually be rendered with a single VAO or, if VAO is not available,
        // with only a single call to setupVertexAttirbutes().
        // Only exception is if the drawCalls require offsets into instanceBuffer or vertexBuffer.
        // In this case, we have to force setupVertexAttribute() call per drawCall and cannot use a fixed buffer setup.
        var updateBuffersPerDrawCall = hasDrawCalls && geometry.groups.some(function(offset) {
            return offset.index >= 0 || offset.instanceStart >= 0;
        });

        var vao;

        if (updateBuffersPerDrawCall) {
            // Do not use VAO here, because we must call setupVertexAttributes() anyway.
            // Note that setVertexAttributes() must not be called when a VAO is bound. 
            //  1. Because it's pointless if you already have the VAO set.
            //  2. Because state.enableAttribute() will modify the VAO scope instead of the global one. This is not expected
            //     by WebGLState. As a consequence, the cache may think an attribute is enabled while it actually isn't.
            //     Result is that the next mesh without VAO may just not show up.
            updateBuffers = true;
        } else {
            vao = activateVAO(material, program, geometry, uvChannel || 0);
            updateBuffers = updateBuffers && !vao;
        } 

        if ( updateBuffers ) {
            bindingStates.initAttributes();
        }

        // render mesh

        var index = geometry.index;

        // indexed triangles
        var geomType;

        if ( index ) {

            var type, size;
            var ib = index.array ? index.array : geometry.ib;

            if (material.isEdgeMaterial) {
                index = geometry.attributes.indexlines;
                ib = geometry.iblines;
            }

            if (index.bytesPerItem) {
                size = index.bytesPerItem;
                if (size === 4) {
                    // load the unsigned integer index buffer extension if needed.
                    !_isWebGL2 && extensions.get( 'OES_element_index_uint' );
                }
            } else {
                if ( ib instanceof Uint32Array && (_isWebGL2 || extensions.get( 'OES_element_index_uint' ))) {
                    size = 4;
                } else {
                    size = 2;
                }
            }

            if (size === 4) {
                type = _gl.UNSIGNED_INT;
            } else {
                type = _gl.UNSIGNED_SHORT;
            }


            var offsets = geometry.groups;
            if (hasDrawCalls && material.isEdgeMaterial && !Object.prototype.hasOwnProperty.call(offsets[0], "edgeStart")) {
                // This geometry isn't consolidated.
                offsets = null;
            }

            var i = 0;
            do
            {
                var startIndex, startOffset, count, instanceStart, numInstances;
                if (hasDrawCalls)
                {
                    var offset = offsets[ i ];
                    startIndex = offset.index;
                    startOffset = material.isEdgeMaterial ? (offset.edgeStart || 0) : offset.start;
                    count = material.isEdgeMaterial ? (offset.edgeCount || ib.length) : offset.count;
                    instanceStart = offset.instanceStart || 0;
                    numInstances = offset.numInstances || geometry.numInstances;
                    var p_uniforms = material.program.uniforms;
                    if (p_uniforms.themingColor && 'themingColor' in offset) {
                        var color = offset.themingColor;
                        if (color instanceof THREE.Vector4) {
                            _gl.uniform4f(p_uniforms.themingColor, color.x, color.y, color.z, color.w);
                        } else {
                            _gl.uniform4f(p_uniforms.themingColor, 0.0, 0.0, 0.0, 0.0);
                        }
                    }
                }
                else
                {
                    startIndex = 0;
                    startOffset = 0;
                    count = ib.length;
                    instanceStart = 0;
                    numInstances = geometry.numInstances;
                }
                
                if (updateBuffers) {
                    setupVertexAttributes(material, program, geometry, startIndex, index, uvChannel, instanceStart);

                    // In most cases, it's sufficent to call setupVertexAttributes() just once in the first cycle.
                    if (!updateBuffersPerDrawCall) {
                        updateBuffers = false;
                    }
                }

                // render indexed triangles
                geomType = _gl.TRIANGLES;
                if (geometry.isPoints || object instanceof THREE.PointCloud)
                    geomType = _gl.POINTS;
                else if (geometry.isLines || material.isEdgeMaterial || object instanceof THREE.Line)
                    geomType = _gl.LINES;

                if (numInstances)
                    drawElementsInstanced( geomType, count, type, startOffset * size, numInstances ); // 2 bytes per Uint16
                else {
                    ++renderCalls;
                    _gl.drawElements(geomType, count, type, startOffset * size ); // 2 bytes per Uint16

                }

            } while(offsets && ++i < offsets.length);

        // non-indexed triangles

        } else {

            if (geometry.groups?.length > 1) {
                console.error("Geometry with draw calls and no index buffer");
            }

            if ( updateBuffers ) {

                setupVertexAttributes(material, program, geometry, 0, undefined, uvChannel, 0);
            }

            var position = geometry.attributes.position;

            // render non-indexed triangles
            geomType = _gl.TRIANGLES;
            if (geometry.isPoints || object instanceof THREE.PointCloud)
                geomType = _gl.POINTS;
            else if (geometry.isLines || material.isEdgeMaterial || object instanceof THREE.Line)
                geomType = _gl.LINES;
            if (geometry.numInstances)
                drawArraysInstanced( geomType, 0, position.array.length / 3, geometry.numInstances );
            else {
                _gl.drawArrays( geomType, 0, position.array.length / position.itemSize );
            }

        }

        if (vao)
            bindVertexArray(null);
    };

    this.renderBuffer = function ( camera, lights, fog, material, geometryGroup, object ) {

        if ( material.visible === false ) return;

        // Don't draw regular geometry with the edgeMaterial - it doesn't work.
        if (material.isEdgeMaterial) return;

        updateObject(object);

        var program = setProgram( camera, lights, fog, material, object );

        var attributes = program.attributes;

        var updateBuffers = false,
            wireframeBit = material.wireframe ? 1 : 0,
            geometryGroupHash = geometryGroup.id + '_' + program.id + '_' + wireframeBit;

        if ( geometryGroupHash !== _currentGeometryProgram ) {

            _currentGeometryProgram = geometryGroupHash;
            updateBuffers = true;

        }

        if ( updateBuffers ) {

            bindingStates.initAttributes();

        }

        // vertices

        // We need to make sure the divisor is 0 when we use this path.
        function setVertexAttribute(index, size, type, normalized, stride, offset) {
            _gl.vertexAttribPointer( index, size, type, normalized, stride, offset );
            if (_glExtensionInstancedArrays) {
                _glExtensionInstancedArrays.vertexAttribDivisorANGLE(index, 0);
            }
        }

        if ( !material.morphTargets && attributes.position >= 0 ) {

            if ( updateBuffers ) {

                _gl.bindBuffer( _gl.ARRAY_BUFFER, geometryGroup.__webglVertexBuffer );
                bindingStates.enableAttribute( attributes.position );
                setVertexAttribute( attributes.position, 3, _gl.FLOAT, false, 0, 0 );

            }

        }


        if ( updateBuffers ) {

            // custom attributes

            // Use the per-geometryGroup custom attribute arrays which are setup in initMeshBuffers

            if ( geometryGroup.__webglCustomAttributesList ) {

                for ( var i = 0, il = geometryGroup.__webglCustomAttributesList.length; i < il; i ++ ) {

                    var attribute = geometryGroup.__webglCustomAttributesList[ i ];

                    if ( attributes[ attribute.buffer.belongsToAttribute ] >= 0 ) {

                        _gl.bindBuffer( _gl.ARRAY_BUFFER, attribute.buffer );
                        bindingStates.enableAttribute( attributes[ attribute.buffer.belongsToAttribute ] );
                        setVertexAttribute( attributes[ attribute.buffer.belongsToAttribute ], attribute.size, _gl.FLOAT, false, 0, 0 );

                    }

                }

            }


            // colors

            if ( attributes.color >= 0 ) {

                if ( object.geometry.colors.length > 0 || object.geometry.faces.length > 0 ) {

                    _gl.bindBuffer( _gl.ARRAY_BUFFER, geometryGroup.__webglColorBuffer );
                    bindingStates.enableAttribute( attributes.color );
                    setVertexAttribute( attributes.color, 3, _gl.FLOAT, false, 0, 0 );

                } else if ( material.defaultAttributeValues ) {


                    _gl.vertexAttrib3fv( attributes.color, material.defaultAttributeValues.color );

                }

            }

            // normals

            if ( attributes.normal >= 0 ) {

                _gl.bindBuffer( _gl.ARRAY_BUFFER, geometryGroup.__webglNormalBuffer );
                bindingStates.enableAttribute( attributes.normal );
                setVertexAttribute( attributes.normal, 3, _gl.FLOAT, false, 0, 0 );

            }

            // tangents

            if ( attributes.tangent >= 0 ) {

                _gl.bindBuffer( _gl.ARRAY_BUFFER, geometryGroup.__webglTangentBuffer );
                bindingStates.enableAttribute( attributes.tangent );
                setVertexAttribute( attributes.tangent, 4, _gl.FLOAT, false, 0, 0 );

            }

            // uvs

            if ( attributes.uv >= 0 ) {

                if ( object.geometry.faceVertexUvs[0] ) {

                    _gl.bindBuffer( _gl.ARRAY_BUFFER, geometryGroup.__webglUVBuffer );
                    bindingStates.enableAttribute( attributes.uv );
                    setVertexAttribute( attributes.uv, 2, _gl.FLOAT, false, 0, 0 );

                } else if ( material.defaultAttributeValues ) {


                    _gl.vertexAttrib2fv( attributes.uv, material.defaultAttributeValues.uv );

                }

            }

            if ( attributes.uv2 >= 0 ) {

                if ( object.geometry.faceVertexUvs[1] ) {

                    _gl.bindBuffer( _gl.ARRAY_BUFFER, geometryGroup.__webglUV2Buffer );
                    bindingStates.enableAttribute( attributes.uv2 );
                    setVertexAttribute( attributes.uv2, 2, _gl.FLOAT, false, 0, 0 );

                } else if ( material.defaultAttributeValues ) {


                    _gl.vertexAttrib2fv( attributes.uv2, material.defaultAttributeValues.uv2 );

                }

            }

            // line distances

            if ( attributes.lineDistance >= 0 ) {

                _gl.bindBuffer( _gl.ARRAY_BUFFER, geometryGroup.__webglLineDistanceBuffer );
                bindingStates.enableAttribute( attributes.lineDistance );
                setVertexAttribute( attributes.lineDistance, 1, _gl.FLOAT, false, 0, 0 );

            }

        }

        bindingStates.disableUnusedAttributes();

        // render mesh

        if ( object instanceof THREE.Mesh ) {

            var type = geometryGroup.__typeArray === Uint32Array ? _gl.UNSIGNED_INT : _gl.UNSIGNED_SHORT;

            // wireframe

            if ( material.wireframe ) {

                state.setLineWidth( material.wireframeLinewidth * this.getPixelRatio() );
                if ( updateBuffers ) _gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, geometryGroup.__webglLineBuffer );
                _gl.drawElements( _gl.LINES, geometryGroup.__webglLineCount, type, 0 );

            // triangles

            } else {

                if ( updateBuffers ) _gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, geometryGroup.__webglFaceBuffer );
                _gl.drawElements( _gl.TRIANGLES, geometryGroup.__webglFaceCount, type, 0 );

            }

        // render lines

        } else if ( object instanceof THREE.Line ) {

            var mode = ( object.mode === THREE.LineStrip ) ? _gl.LINE_STRIP : _gl.LINES;

            state.setLineWidth( material.linewidth * this.getPixelRatio() );

            _gl.drawArrays( mode, 0, geometryGroup.__webglLineCount );

        // render particles

        } else if ( object instanceof THREE.PointCloud ) {

            _gl.drawArrays(_gl.POINTS, 0, geometryGroup.__webglPointCount);

        }
    };


    // Sorting

    // This method is for transparency
    function painterSortStable ( a, b ) {

        // first see if there's a render order set - if so, this takes precedence
        if ( a.object.renderOrder !== b.object.renderOrder ) {

            return a.object.renderOrder - b.object.renderOrder;

        // If render order are the same, then use z distance.
        // We want to render from farthest to nearest.
        } else if ( a.z !== b.z ) {

            return a.z - b.z;

        // if z distances match, then use id, for a consistent result
        } else {

            return a.id - b.id;

        }

    }

    // This method is for opaque objects
    function reversePainterSortStable ( a, b ) {

        // first see if there's a render order set - if so, this takes precedence
        if ( a.object.renderOrder !== b.object.renderOrder ) {

            return a.object.renderOrder - b.object.renderOrder;

        // Next, sort by material, for efficiency, to avoid state changes.
        // (Note this is not done for transparency, as back to front order is more significant.)
        } else if ( a.material.id !== b.material.id ) {

            return a.material.id - b.material.id;

        // If render order and material are the same, then use z distance.
        // To minimize processing fragments, we render roughly from nearest to farthest.
        // In this way, the closer objects cover pixels and so hide more distance objects.
        } if ( a.z !== b.z ) {

            return b.z - a.z;

        // if z distances match, then use id, for a consistent sorted result
        } else {

            return a.id - b.id;

        }

    }


    // Rendering

    this.render = function ( scene, camera, forceClearIn, customLightsIn ) {

        let forceClear = forceClearIn;
        let customLights = customLightsIn;
        let renderTarget;

        if ( arguments.length > 2 && (forceClearIn instanceof THREE.WebGLRenderTarget  || Array.isArray(forceClearIn) )) {

            console.warn( 'THREE.WebGLRenderer.render(): the renderTarget argument has been removed. Use .setRenderTarget() instead.' );
            renderTarget = forceClearIn;
            forceClear = customLightsIn;
            customLights = arguments[4];

        }


        if ( camera instanceof THREE.Camera === false ) {

            console.error( 'THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.' );
            return;

        }

        // Skip rendering until context is recovered. Note that this may happen sometimes even if we stop
        // the rendering loop on context lost events.
        if (_gl.isContextLost()) {
            return;
        }

        // reset caching for this frame

        _currentGeometryProgram = '';
        _currentMaterialId = -1;
        _currentCamera = null;

        if (customLights !== undefined) {
            lights.length = 0;
            _lightsNeedUpdate = true;
        }

        var fog = scene.fog;

        // update scene graph

        if ( scene.autoUpdate === true ) scene.updateMatrixWorld();

        // update camera matrices and frustum

        // THREE.Object3D.parent is `undefined` by default until R71, and `null` by default since R72
        if ( camera.parent === undefined || camera.parent === null ) camera.updateMatrixWorld();

        if (camera.worldUpTransform)
            _viewInverseEnv.multiplyMatrices(camera.worldUpTransform, camera.matrixWorld);
        else
            _viewInverseEnv.copy(camera.matrixWorld);

        _projScreenMatrix.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
        _frustum.setFromProjectionMatrix( _projScreenMatrix );

        // update WebGL objects
        var renderImmediate = (scene instanceof RenderBatch) && scene.renderImmediate;

        if (!renderImmediate) {
            opaqueObjects.length = 0;
            transparentObjects.length = 0;

            projectObject( scene, _this.sortObjects === true, scene.forceVisible === true );

            // note: the following flag is never set in WebGLRenderer; this may change in the future
            if (_this.sortObjects === true) {
                opaqueObjects.sort( reversePainterSortStable );
                transparentObjects.sort( painterSortStable );
            }
        }

        if (_lightsNeedUpdate) {
            if (customLights && customLights.length)
                lights = customLights.slice();
            setupLights(lights);
        }

        if ( renderTarget !== undefined) {
            this.setRenderTarget( renderTarget );
        }

        this.resetGLState();

        if ( this.autoClear || forceClear ) {

            this.clear( this.autoClearColor, this.autoClearDepth, this.autoClearStencil );

        }

        if ( scene.overrideMaterial ) {

            let overrideMaterial = scene.overrideMaterial;

            setMaterial( overrideMaterial );

            if (!renderImmediate) {
                renderObjects( opaqueObjects, camera, lights, fog, overrideMaterial );
                renderObjects( transparentObjects, camera, lights, fog, overrideMaterial );
            } else {
                renderObjectsImmediate(scene, "", camera, lights, fog, overrideMaterial);
            }

        } else {

            if (!renderImmediate) {
                // opaque pass (front-to-back order)
                state.setBlending( THREE.NoBlending );

                renderObjects( opaqueObjects, camera, lights, fog, null );

                // transparent pass (back-to-front order)

                renderObjects( transparentObjects, camera, lights, fog, null );
            } else {
                renderObjectsImmediate(scene, "", camera, lights, fog, null);
            }

        }

        if (scene.edgeMaterial) {

            _gl.depthFunc(_gl.LESS); //hope to avoid some line-on-line overdraw this way

            let overrideMaterial = scene.edgeMaterial;

            setMaterial( overrideMaterial );

            if (!renderImmediate) {
                renderObjects( opaqueObjects, camera, lights, fog, overrideMaterial );
                renderObjects( transparentObjects, camera, lights, fog, overrideMaterial );
            } else {
                renderObjectsImmediate(scene, "", camera, lights, fog, overrideMaterial);
            }

            _gl.depthFunc(_gl.LEQUAL);

        }

        // Generate mipmap if we're using any kind of mipmap filtering
        if ( !_currentRenderTargetIsArray && _currentRenderTarget?.texture?.generateMipmaps
            && _currentRenderTarget?.texture.minFilter !== THREE.NearestFilter
            && _currentRenderTarget?.texture.minFilter !== THREE.LinearFilter ) {

            updateRenderTargetMipmap( _currentRenderTarget );

        }

        this.resetGLState();

        // Ensure depth buffer writing is enabled so it can be cleared on next render

        state.setDepthTest( true );
        state.setDepthWrite( true );

        // IOS 15 introduced a regression causing the browser tab to freeze for large models
        // TODO Remove this once https://bugs.webkit.org/show_bug.cgi?id=239896 got fixed
        if(needIOS15FlushHack && renderCalls > 1000) {
            renderCalls = 0;
            _gl.flush();
        }
    };

    this.setProgramPrefix = function(index, vertexPrefix, fragmentPrefix) {
        _programIndex = index;
        _vertexPrefix = vertexPrefix;
        _fragmentPrefix = fragmentPrefix;
    };

    this.getProgramPrefix = function() {
        return { programPrefix: _programIndex,
                 vertexPrefix: _vertexPrefix,
                 fragmentPrefix: _fragmentPrefix };
    };

    function renderBatchIterSort(m) {
        projectObject(m, true);
    }

    function renderBatchIterNoSort(m) {
        projectObject(m, false);
    }

    function projectObject( object, sortObjects, forceVisible ) {

        var i, len;

        if ( !forceVisible && object.visible === false )
            return;

        if ( object instanceof THREE.Scene || object instanceof THREE.Group ) {

            // skip

        } else if (object instanceof RenderBatch) {

                object.forEach(sortObjects ? renderBatchIterSort : renderBatchIterNoSort);

        } else {

            initObject( object );

            if ( object instanceof THREE.Light ) {

                lights.push( object );

            } else {

                var webglObjects = _webglObjects[ object.id ];

                if ( webglObjects && ( object.frustumCulled === false || _frustum.intersectsObject( object ) === true ) ) {

                    for ( i = 0, len = webglObjects.length; i < len; i ++ ) {

                        var webglObject = webglObjects[i];

                        unrollBufferMaterial( webglObject );

                        webglObject.render = true;

                        if ( sortObjects === true ) {

                            _vector3.setFromMatrixPosition( object.matrixWorld );
                            _vector3 = vector3ApplyProjection( _vector3, _projScreenMatrix );
                            webglObject.z = _vector3.z;

                        }

                    }

                }

            }

        }

        if (object.children) {

            for ( i = 0, len = object.children.length; i < len; i ++ ) {

                projectObject( object.children[ i ], sortObjects, forceVisible );

            }

        }

    }

    // depending on the original material of a shape, we use either the main
    // override directly or a custom variant (if needed).
    function chooseOverrideMaterial(shapeMaterial, overrideMaterial) {

        // if override material does not define custom variants, there is nothing to do
        if (!overrideMaterial.getCustomOverrideMaterial) {
            return overrideMaterial;
        }

        // check if a custom override material should be used
        var customOverride = overrideMaterial.getCustomOverrideMaterial(shapeMaterial);
        if (!customOverride) {
            return overrideMaterial;
        }

        // use alternative variant
        return customOverride;
    }

    function renderFrontAndBack(material, camera, lights, fog, buffer, overrideMaterial, object) {
        // If the object is transparent, render it in two passes:
        // backfaces, then frontfaces. This helps avoid out-of-order sorting
        // transparency blending artifacts (these still can occur for pixels where
        // four or more triangles in a single mesh overlap the same pixel).
        // Also, check that depth testing is on; if not, we're in 2D mode and draw
        // order matters so we should not use this mode.
        // Else render normally.
        // See https://jira.autodesk.com/browse/LMV-1121
        if ( material.twoPassTransparency )
        {
            var originalSide = material.side;
            // note we do NOT set material.needsUpdate to true, as the double-sided shader
            // works fine for back and front faces.
            material.side = THREE.BackSide;
            renderObjectsFace( material, camera, lights, fog, buffer, overrideMaterial, object );
            material.side = THREE.FrontSide;
            renderObjectsFace( material, camera, lights, fog, buffer, overrideMaterial, object );
            material.side = originalSide;
        }
        else
        {
            renderObjectsFace( material, camera, lights, fog, buffer, overrideMaterial, object );
        }

    }
    
    function renderObjects( renderList, camera, lights, fog, overrideMaterial ) {

        var material;

        //TODO: we have to iterate upwards in order to preserve draw order for 2d
        //without having to sort the scene. Figure out how to keep the reverse iteration so that
        //we are consistent with three.js
        for ( var i = 0, iEnd = renderList.length; i < iEnd; i ++ ) {
        //for ( var i = renderList.length - 1; i !== - 1; i -- ) {

            var webglObject = renderList[ i ];

            var object = webglObject.object;
            var buffer = webglObject.buffer;

            if ( overrideMaterial ) {
                // either use overrideMaterial or a custom variant if needed for this render item
                material = chooseOverrideMaterial(webglObject.material, overrideMaterial);
            } else {

                material = webglObject.material;

                if ( ! material ) continue;

                setMaterial( material );
            }

            if (camera.isArrayCamera) {

                const cameras = camera.cameras;
    
                for ( let j = 0, jl = cameras.length; j < jl; j ++ ) {
    
                    const camera2 = cameras[ j ];
    
                    if ( object.layers.test( camera2.layers ) ) {
    
                        state.viewport(_tmpViewport.copy(camera2.viewport));
                        // HACK: Force viewport apply to make sure it's in sync.
                        _gl.viewport(_tmpViewport.x, _tmpViewport.y, _tmpViewport.z, _tmpViewport.w);
                        renderFrontAndBack(material, camera2, lights, fog, buffer, overrideMaterial, object);
                    }
    
                }
            } else {
                renderFrontAndBack(material, camera, lights, fog, buffer, overrideMaterial, object);
            }
        }
    }

    function renderObjectsFace( material, camera, lights, fog, buffer, overrideMaterial, object )
    {
        _this.setMaterialFaces( material );

        if ( buffer instanceof THREE.BufferGeometry ) {
            _this.renderBufferDirect( camera, lights, fog, material, buffer, object );
        } else {
            _this.renderBuffer( camera, lights, fog, material, buffer, object );
        }

        if (material.decals) {
            var decals = material.decals;
            for (var di = 0, dlen = decals.length; di < dlen; di++) {
                var decal = decals[di];
                material = decal.material;
                setMaterial(material);
                _this.setMaterialFaces(material);
                if (buffer instanceof THREE.BufferGeometry) {
                    _this.renderBufferDirect(camera, lights, fog, material, buffer, object, decal.uv);
                }
            }
        }
    }

    var roi_camera, roi_lights, roi_fog, roi_overrideMaterial;	// unused: roi_materialType,

    function renderImmediateCallback(m, idx) {

        if ( m.visible && !m.hide) {
            var material;

            if ( roi_overrideMaterial ) {
                // either use overrideMaterial or a custom variant if needed for this render item
                material = chooseOverrideMaterial(m.material, roi_overrideMaterial);
            } else {

                material = m.material;

                if ( ! material ) return;

                setMaterial(material);
            }

            // If the object is transparent, render it in two passes:
            // backfaces, then frontfaces. This helps avoid out-of-order sorting
            // transparency blending artifacts (these still can occur for pixels where
            // four or more triangles in a single mesh overlap the same pixel).
            // Also, check that depth testing is on; if not, we're in 2D mode and draw
            // order matters so we should not use this mode.
            // Else render normally.
            // See https://jira.autodesk.com/browse/LMV-1121
            if ( material.twoPassTransparency )
            {
                var originalSide = material.side;
                // note we do NOT set material.needsUpdate to true, as the double-sided shader
                // works fine for back and front faces.
                material.side = THREE.BackSide;
                renderImmediateFace( m, material );
                material.side = THREE.FrontSide;
                renderImmediateFace( m, material );
                material.side = originalSide;
            }
            else
            {
                renderImmediateFace( m, material );
            }
        }
    }

    function renderImmediateFace( m, material )
    {
        _this.setMaterialFaces( material );
        _this.renderBufferDirect( roi_camera, roi_lights, roi_fog, material, m.geometry, m );

        if (material.decals) {
            var decals = material.decals;
            for (var di = 0, dlen = decals.length; di < dlen; di++) {
                var decal = decals[di];
                material = decal.material;
                setMaterial(material);
                _this.setMaterialFaces(material);
                _this.renderBufferDirect(roi_camera, roi_lights, roi_fog, material, m.geometry, m, decal.uv);
            }
        }
    }

    function renderObjectsImmediate ( renderList, materialType, camera, lights, fog, overrideMaterial ) {
        roi_lights = lights;
        roi_fog = fog;
        roi_overrideMaterial = overrideMaterial || null;

        // In WebXR, we have more than just one camera.
        if (camera.isArrayCamera) {
            for (var i = 0; i < camera.cameras.length; i++) {
                roi_camera = camera.cameras[i];
                state.viewport(_tmpViewport.copy(roi_camera.viewport));
                // HACK: Force viewport apply to make sure it's in sync.
                _gl.viewport(_tmpViewport.x, _tmpViewport.y, _tmpViewport.z, _tmpViewport.w);

                // not really "forceVisible"
                // it's really only for ground shadows, or custom modelQueue iteration passes
                // In such cases we use the MESH_VISIBLE bit instead of the actual current visibility of the mesh (which is dependent on the render pass being done)
                renderList.forEach(renderImmediateCallback, renderList.forceVisible ? 1 : 0x20/* MESH_RENDERFLAG */, false);
            }
        } else {
            roi_camera = camera;
            renderList.forEach(renderImmediateCallback, renderList.forceVisible ? 1 : 0x20/* MESH_RENDERFLAG */, false);
        }
    }


    function unrollBufferMaterial ( globject ) {

        var object = globject.object;
        var buffer = globject.buffer;

        var geometry = object.geometry;
        var material = object.material;

        if ( material instanceof THREE.MeshFaceMaterial ) {

            var materialIndex = geometry instanceof THREE.BufferGeometry ? 0 : buffer.materialIndex;

            material = material.materials[ materialIndex ];

            globject.material = material;

            if ( material.transparent ) {

                transparentObjects.push( globject );

            } else {

                opaqueObjects.push( globject );

            }

        } else if ( material ) {

            globject.material = material;

            if ( material.transparent ) {

                transparentObjects.push( globject );

            } else {

                opaqueObjects.push( globject );

            }

        }

    }



    // Objects adding

    function initObject( object ) {

        _this.lostContextRecovery && _this.lostContextRecovery.refreshIfNeeded(object);

        if ( object.__webglInit === undefined ) {

            object.__webglInit = true;

            object.addEventListener( 'removed', onObjectRemoved );

        }

        var geometry = object.geometry;

        if ( geometry === undefined ) {

            // ImmediateRenderObject

        } else if ( geometry.__webglInit === undefined ) {

            geometry.__webglInit = true;
            geometry.addEventListener( 'dispose', onGeometryDispose );

            if ( geometry instanceof THREE.BufferGeometry ) {

                //

            } else if ( object instanceof THREE.Mesh ) {

                initGeometryGroups( object, geometry );

            } else if ( object instanceof THREE.Line ) {

                if ( geometry.__webglVertexBuffer === undefined ) {

                    createLineBuffers( geometry );
                    initLineBuffers( geometry, object );

                    geometry.verticesNeedUpdate = true;
                    geometry.colorsNeedUpdate = true;
                    geometry.lineDistancesNeedUpdate = true;

                }
            } else if (object instanceof THREE.PointCloud) {

                if (geometry.__webglVertexBuffer === undefined) {

                    createPointCloudBuffers(geometry);
                    initPointCloudBuffers(geometry, object);

                    geometry.verticesNeedUpdate = true;
                    geometry.colorsNeedUpdate = true;
                }

            }

        }

        if ( object.__webglActive === undefined) {

            object.__webglActive = true;

            if ( object instanceof THREE.Mesh ) {

                if ( geometry instanceof THREE.BufferGeometry ) {

                    addBuffer( _webglObjects, geometry, object );

                } else if ( geometry instanceof THREE.Geometry ) {

                    var geometryGroupsList = geometryGroups[ geometry.id ];

                    for ( var i = 0,len = geometryGroupsList.length; i < len; i ++ ) {

                        addBuffer( _webglObjects, geometryGroupsList[ i ], object );

                    }

                }

            } else if ( object instanceof THREE.Line || object instanceof THREE.PointCloud ) {

                addBuffer( _webglObjects, geometry, object );

            }

        }

    }


    // Geometry splitting

    var geometryGroups = {};
    var geometryGroupCounter = 0;

    function makeGroups( geometry, usesFaceMaterial ) {

        var maxVerticesInGroup = _isWebGL2 || extensions.get( 'OES_element_index_uint' ) ? 4294967296 : 65535;

        var groupHash, hash_map = {};

        var numMorphTargets = geometry.morphTargets ? geometry.morphTargets.length : 0;
        var numMorphNormals = geometry.morphNormals ? geometry.morphNormals.length : 0;

        var group;
        var groups = {};
        var groupsList = [];

        for ( var f = 0, fl = geometry.faces.length; f < fl; f ++ ) {

            var face = geometry.faces[ f ];
            var materialIndex = usesFaceMaterial ? face.materialIndex : 0;

            if ( ! ( materialIndex in hash_map ) ) {

                hash_map[ materialIndex ] = { hash: materialIndex, counter: 0 };

            }

            groupHash = hash_map[ materialIndex ].hash + '_' + hash_map[ materialIndex ].counter;

            if ( ! ( groupHash in groups ) ) {

                group = {
                    id: geometryGroupCounter ++,
                    faces3: [],
                    materialIndex: materialIndex,
                    vertices: 0,
                    numMorphTargets: numMorphTargets,
                    numMorphNormals: numMorphNormals
                };

                groups[ groupHash ] = group;
                groupsList.push( group );

            }

            if ( groups[ groupHash ].vertices + 3 > maxVerticesInGroup ) {

                hash_map[ materialIndex ].counter += 1;
                groupHash = hash_map[ materialIndex ].hash + '_' + hash_map[ materialIndex ].counter;

                if ( ! ( groupHash in groups ) ) {

                    group = {
                        id: geometryGroupCounter ++,
                        faces3: [],
                        materialIndex: materialIndex,
                        vertices: 0,
                        numMorphTargets: numMorphTargets,
                        numMorphNormals: numMorphNormals
                    };

                    groups[ groupHash ] = group;
                    groupsList.push( group );

                }

            }

            groups[ groupHash ].faces3.push( f );
            groups[ groupHash ].vertices += 3;

        }

        return groupsList;

    }

    function initGeometryGroups( object, geometry ) {

        var material = object.material, addBuffers = false;

        if ( geometryGroups[ geometry.id ] === undefined || geometry.groupsNeedUpdate === true ) {

            delete _webglObjects[ object.id ];

            geometryGroups[ geometry.id ] = makeGroups( geometry, material instanceof THREE.MeshFaceMaterial);

            geometry.groupsNeedUpdate = false;

        }

        var geometryGroupsList = geometryGroups[ geometry.id ];

        // create separate VBOs per geometry chunk

        for ( var i = 0, il = geometryGroupsList.length; i < il; i ++ ) {

            var geometryGroup = geometryGroupsList[ i ];

            // initialise VBO on the first access

            if ( geometryGroup.__webglVertexBuffer === undefined ) {

                createMeshBuffers( geometryGroup );
                initMeshBuffers( geometryGroup, object );

                geometry.verticesNeedUpdate = true;
                geometry.morphTargetsNeedUpdate = true;
                geometry.elementsNeedUpdate = true;
                geometry.uvsNeedUpdate = true;
                geometry.normalsNeedUpdate = true;
                geometry.tangentsNeedUpdate = true;
                geometry.colorsNeedUpdate = true;

                addBuffers = true;

            } else {

                addBuffers = false;

            }

            if ( addBuffers || object.__webglActive === undefined ) {

                addBuffer( _webglObjects, geometryGroup, object );

            }

        }

        object.__webglActive = true;

    }


    function addBuffer( objlist, buffer, object ) {

        var id = object.id;
        objlist[id] = objlist[id] || [];
        objlist[id].push(
            {
                id: id,
                buffer: buffer,
                object: object,
                material: null,
                z: 0
            }
        );

    }

    // Objects updates

    // Objects updates

    function updateObject( object ) {

        var geometry = object.geometry, customAttributesDirty, material;

        if ( geometry instanceof THREE.BufferGeometry ) {

            setDirectBuffers( geometry );

        } else if ( object instanceof THREE.Mesh ) {

            // check all geometry groups

            if ( geometry.groupsNeedUpdate === true ) {

                initGeometryGroups( object, geometry );

            }

            var geometryGroupsList = geometryGroups[ geometry.id ];

            for ( var i = 0, il = geometryGroupsList.length; i < il; i ++ ) {

                var geometryGroup = geometryGroupsList[ i ];

                material = getBufferMaterial( object, geometryGroup );

                customAttributesDirty = material.attributes && areCustomAttributesDirty( material );

                if ( geometry.verticesNeedUpdate || geometry.morphTargetsNeedUpdate || geometry.elementsNeedUpdate ||
                     geometry.uvsNeedUpdate || geometry.normalsNeedUpdate ||
                     geometry.colorsNeedUpdate || geometry.tangentsNeedUpdate || customAttributesDirty ) {

                    setMeshBuffers( geometryGroup, object, _gl.DYNAMIC_DRAW, ! geometry.dynamic, material );

                }

            }

            geometry.verticesNeedUpdate = false;
            geometry.morphTargetsNeedUpdate = false;
            geometry.elementsNeedUpdate = false;
            geometry.uvsNeedUpdate = false;
            geometry.normalsNeedUpdate = false;
            geometry.colorsNeedUpdate = false;
            geometry.tangentsNeedUpdate = false;

            material.attributes && clearCustomAttributes( material );

        } else if ( object instanceof THREE.Line ) {

            material = getBufferMaterial( object, geometry );

            customAttributesDirty = material.attributes && areCustomAttributesDirty( material );

            if ( geometry.verticesNeedUpdate || geometry.colorsNeedUpdate || geometry.lineDistancesNeedUpdate || customAttributesDirty ) {

                setLineBuffers( geometry, _gl.DYNAMIC_DRAW );

            }

            geometry.verticesNeedUpdate = false;
            geometry.colorsNeedUpdate = false;
            geometry.lineDistancesNeedUpdate = false;

            material.attributes && clearCustomAttributes( material );

        } else if (object instanceof THREE.PointCloud) {

            material = getBufferMaterial(object, geometry);

            customAttributesDirty = material.attributes && areCustomAttributesDirty(material);

            if (geometry.verticesNeedUpdate || geometry.colorsNeedUpdate || customAttributesDirty) {

                setPointCloudBuffers(geometry, _gl.DYNAMIC_DRAW);

            }

            geometry.verticesNeedUpdate = false;
            geometry.colorsNeedUpdate = false;

            material.attributes && clearCustomAttributes(material);
        }

    }

    // Objects updates - custom attributes check

    function areCustomAttributesDirty( material ) {

        for ( var name in material.attributes ) {

            if (checkNeedsUpdate(material.attributes[ name ])) return true;

        }

        return false;

    }

    function clearCustomAttributes( material ) {

        for ( var name in material.attributes ) {

            clearNeedsUpdate(material.attributes[ name ]);

        }

    }

    // Objects removal

    function removeObject( object ) {

        if ( object instanceof THREE.Mesh  ||
             object instanceof THREE.PointCloud ||
             object instanceof THREE.Line ) {

            delete _webglObjects[ object.id ];

        }

        delete object.__webglInit;
        delete object.__webglActive;

    }

    var shaderIDs = {
        MeshDepthMaterial: 'depth',
        MeshNormalMaterial: 'normal',
        MeshLambertMaterial: 'lambert',
        LineDashedMaterial: 'dashed',
        MeshBasicMaterial:'firefly_basic',
        LineBasicMaterial:'firefly_basic',
        PointCloudMaterial:'firefly_basic',
        PointsMaterial:'firefly_basic',
        MeshPhongMaterial:'firefly_phong'
    };

    function initMaterial( material, lights, fog, object ) {

        material.addEventListener( 'dispose', onMaterialDispose );
        var shaderID = shaderIDs[ material.type ];

        if ( shaderID ) {

            var shader = THREE.ShaderLib[ shaderID ];

            // we need merge the uniforms if material specified it
            // example: when we create material, we always follow the threejs practice add uniforms to it
            // that means, if those uniforms value exists, we need merge it with the value from the shader chunk
            let copiedUniforms = THREE.UniformsUtils.clone( shader.uniforms );
            if(material.uniforms) {
                copiedUniforms = THREE.UniformsUtils.merge([copiedUniforms, material.uniforms]);
            }

            material.__webglShader = {
                uniforms: copiedUniforms,
                vertexShader: shader.vertexShader,
                fragmentShader: shader.fragmentShader
            };
        } else {

            material.__webglShader = {
                uniforms: material.uniforms,
                vertexShader: material.vertexShader,
                fragmentShader: material.fragmentShader
            };
        }

        // heuristics to create shader parameters according to lights in the scene
        // (not to blow over maxLights budget)

        var maxLightCount = allocateLights( lights );

        //var maxBones = 0;//allocateBones( object );

        var parameters = {

            vertexShader: material.__webglShader.vertexShader,
            fragmentShader: material.__webglShader.fragmentShader,

            precision: _precisionVertex,
            precisionFragment: _precisionFragment,
            supportsVertexTextures: _supportsVertexTextures,
            haveTextureLod: _isWebGL2 || !!extensions.get("EXT_shader_texture_lod"),
            loadingAnimationDuration: _this.loadingAnimationDuration,

            map: !!material.map,
            envMap: !!material.envMap,
            irradianceMap: !!material.irradianceMap,
            envIsSpherical: (material.envMap && material.envMap.mapping == THREE.SphericalReflectionMapping),
            envGammaEncoded: material.envMap && material.envMap.GammaEncoded,
            irrGammaEncoded: material.irradianceMap && material.irradianceMap.GammaEncoded,
            envRGBM: material.envMap && material.envMap.RGBM,
            irrRGBM: material.irradianceMap && material.irradianceMap.RGBM,
            lightMap: !!material.lightMap,
            bumpMap: (_isWebGL2 || extensions.get("OES_standard_derivatives")) && !!material.bumpMap,
            normalMap: (_isWebGL2 || extensions.get("OES_standard_derivatives")) && !!material.normalMap,
            specularMap: !!material.specularMap,
            alphaMap: !!material.alphaMap,

            vertexColors: material.vertexColors,
            vertexIds:    material.vertexIds,

            useInstancing: material.useInstancing,

            wideLines: material.wideLines,

            fog: fog,
            useFog: material.fog,
            useBackgroundTexture: material.useBackgroundTexture,
            //fogExp: fog instanceof THREE.FogExp2,

            sizeAttenuation: material.sizeAttenuation,

            maxDirLights: maxLightCount.directional,
            maxPointLights: maxLightCount.point,
            maxSpotLights: maxLightCount.spot,
            maxHemiLights: maxLightCount.hemi,

            alphaTest: material.alphaTest,
            metal: material.metal,
            clearcoat: material.clearcoat,
            wrapAround: material.wrapAround,
            doubleSided: material.side === THREE.DoubleSide,
            flipSided: material.side === THREE.BackSide,

            mrtNormals: (material.mrtNormals),
            mrtIdBuffer: (material.mrtIdBuffer),
            vertexPrefix: _vertexPrefix,
            fragmentPrefix: _fragmentPrefix,
            tonemapOutput : material.tonemapOutput,
            packedNormals : material.packedNormals,
            hatchPattern : !!material.hatchParams,

            // TODO_NOP should not be per mat
            numCutplanes: (material.cutplanes ? material.cutplanes.length : 0),

            useTiling: material.useTiling,
            tilingRepeatRange: material.useTiling && material.tilingRepeatRange,
            hasRoundCorner: material.hasRoundCorner,
            useRandomOffset: material.useRandomOffset,

            // texture flags for clamp and invert for simple phong material
            // add as wanted/necessary
            mapInvert: material.map && material.map.invert,
            mapClampS: material.map && material.map.clampS,
            mapClampT: material.map && material.map.clampT,
            bumpMapClampS: material.bumpMap && material.bumpMap.clampS,
            bumpMapClampT: material.bumpMap && material.bumpMap.clampT,
            normalMapClampS: material.normalMap && material.normalMap.clampS,
            normalMapClampT: material.normalMap && material.normalMap.clampT,
            specularMapClampS: material.specularMap && material.specularMap.clampS,
            specularMapClampT: material.specularMap && material.specularMap.clampT,
            alphaMapInvert: material.alphaMap && material.alphaMap.invert,
            alphaMapClampS: material.alphaMap && material.alphaMap.clampS,
            alphaMapClampT: material.alphaMap && material.alphaMap.clampT

        };

        var chunks = [];

        if ( shaderID ) {

            chunks.push( shaderID );

        } else {

            chunks.push( material.fragmentShader );
            chunks.push( material.vertexShader );

        }

        //Append any custom defines to the shader cache key
        for ( var d in material.defines ) {

            chunks.push( d );
            chunks.push( material.defines[ d ] );

        }

        var p, pl;
        for ( p in parameters ) {

            chunks.push( p );
            chunks.push( parameters[ p ] );

        }

        var code = chunks.join();

        var program;

        // Check if code has been already compiled

        for ( p = 0, pl = _programs.length; p < pl; p ++ ) {

            var programInfo = _programs[ p ];

            if ( programInfo.code === code ) {

                program = programInfo;
                program.usedTimes ++;

                break;

            }

        }

        if ( program === undefined ) {
            material.onBeforeCompile( parameters, _this );
            program = new WebGLProgram( _this, code, material, parameters, object.geometry );
            _programs.push( program );

            _this.info.memory.programs = _programs.length;

        }

        if ( !material.programs )
            material.programs = [];
        material.programs[ _programIndex ] = program;


        if ( !material.uniformsLists )
            material.uniformsLists = [];
        material.uniformsList = material.uniformsLists[ _programIndex ] = [];

        // to see which uniform name is at what location, uncomment
        // let dump = true;
        //if (dump) {
        //    console.log("Uniform locations and names");
        //}
        //let ic = 0;
        for ( var u in material.__webglShader.uniforms ) {

            var location = program.uniforms[ u ];

            if ( location ) {
            //if (dump) {
            //    console.log("index: " + (ic++) + " has name: " + u);
            //}
                material.uniformsList.push( [ material.__webglShader.uniforms[ u ], location ] );
            }

        }

    }

    function setMaterial( material ) {

        if ( material.transparent === true ) {

            state.setBlending( material.blending, material.blendEquation, material.blendSrc, material.blendDst, material.blendEquationAlpha, material.blendSrcAlpha, material.blendDstAlpha );

        } else {

            state.setBlending( THREE.NoBlending );

        }

        
        state.setDepthTest( material.depthTest );
        state.setDepthWrite( material.depthWrite );
        state.setPolygonOffset( material.polygonOffset, material.polygonOffsetFactor, material.polygonOffsetUnits );

    }

    function setProgram( camera, lights, fog, material, object ) {
        _usedTextureUnits = 0;

        // Make sure that material doesn't contain outdated resources from past lost contexts
        _this.lostContextRecovery && _this.lostContextRecovery.refreshIfNeeded(material);

        if ( checkNeedsUpdate(material) ) {

            if ( material.program ) deallocateMaterial( material );

            initMaterial( material, lights, fog, object );
            clearNeedsUpdate(material);

        } else if ( !material.programs || !material.programs[ _programIndex ] )
            initMaterial( material, lights, fog, object );


        var refreshProgram = false;
        var refreshMaterial = false;
        var refreshLights = false;

        material.uniformsList = material.uniformsLists[ _programIndex ];
        var program = material.program = material.programs[ _programIndex ],
            p_uniforms = program.uniforms,
            m_uniforms = material.__webglShader.uniforms;

        if ( program.id !== _currentProgram ) {

            _gl.useProgram( program.program );
            _currentProgram = program.id;

            refreshProgram = true;
            refreshMaterial = true;
            refreshLights = true;

        }

        if ( material.id !== _currentMaterialId ) {

            if ( _currentMaterialId === -1 ) refreshLights = true;
            _currentMaterialId = material.id;

            refreshMaterial = true;

        }

        if (p_uniforms.meshAnimTime) {
            var meshAnimTime = 1.0; // In case no creationTime value is found, keep it 1.0, so it won't have animation.

            if (object.geometry.creationTime && _this.loadingAnimationDuration > 0) {
                meshAnimTime = Math.min((this.highResTimeStamp - object.geometry.creationTime) / _this.loadingAnimationDuration, 1.0);
            }
            
            _gl.uniform1f(p_uniforms.meshAnimTime, meshAnimTime);
        }

        if ( refreshProgram || camera !== _currentCamera ) {

            _gl.uniformMatrix4fv( p_uniforms.projectionMatrix, false, camera.projectionMatrix.elements );

            if ( camera !== _currentCamera ) _currentCamera = camera;


            // load material specific uniforms
            // (shader material also gets them for the sake of genericity)

            if ( material instanceof THREE.ShaderMaterial ||
                 (material instanceof THREE.MeshPhongMaterial && !material.isLmvMaterial) ||
                 material.envMap ) {

                if ( p_uniforms.cameraPosition !== null ) {

                    _vector3.setFromMatrixPosition( camera.matrixWorld );
                    _gl.uniform3f( p_uniforms.cameraPosition, _vector3.x, _vector3.y, _vector3.z );

                }

            }

            if ( (material instanceof THREE.MeshPhongMaterial && !material.isLmvMaterial) ||
                 material instanceof THREE.MeshLambertMaterial ||
                 material instanceof THREE.ShaderMaterial ||
                 material.skinning ) {

                if ( p_uniforms.viewMatrix !== null ) {

                    _gl.uniformMatrix4fv( p_uniforms.viewMatrix, false, camera.matrixWorldInverse.elements );

                }

                //NOTE: viewMatrixInverse is only used for transforming normal vectors
                //for sampling environment textures. This is why we do not use camera.matrixWorld here,
                //but a combination of camera.matrixWorld plus a rotation to make Y the up vector, so that
                //the top of the scene (whichever axis is up) results in sampling the top of the environment map.
                //If viewMatrixInverse is needed for other things in the shader, then we will need a second
                //uniform that does not include the world-up rotation, or apply a consistent world up rotation
                //to all geometries in the scene.
                if ( p_uniforms.viewMatrixInverse !== null ) {

                    _gl.uniformMatrix4fv( p_uniforms.viewMatrixInverse, false, _viewInverseEnv.elements );

                }

                if ( p_uniforms.mvpMatrix ) {

                    _gl.uniformMatrix4fv( p_uniforms.mvpMatrix, false, _projScreenMatrix.elements );

                }

                if ( refreshLights ) {
                    refreshUniformsIBL(m_uniforms, material);
                    markUniformsIBLNeedsUpdate(m_uniforms, true);
                } else {
                    markUniformsIBLNeedsUpdate(m_uniforms, false);
                }

            }

        }

        //For some reason this needs to happen here, before refreshMaterial,
        //in order to use a good texture slot for the tIdColor texture. If it happens
        //after the dbId uniform handling below, rendering becomes terribly slow.
        if (p_uniforms.unpackXform) {
            var g = object.geometry;
            var t = g.unpackXform;
            if (t)
                _gl.uniform4f(p_uniforms.unpackXform, t.x, t.y, t.z, t.w);
            else
                _gl.uniform4f(p_uniforms.unpackXform, 1, 1, 0, 0);

            if (p_uniforms.tIdColor) {
                _gl.uniform2f(p_uniforms.vIdColorTexSize, g.vIdColorTexSize.x, g.vIdColorTexSize.y);

                var unit = getTextureUnit();
                _gl.uniform1i( p_uniforms.tIdColor, unit);
                _this.setTexture(g.tIdColor, unit);
            }

        }


        if ( refreshMaterial ) {

            // refresh uniforms common to several materials

            if ( (material instanceof THREE.MeshPhongMaterial && !material.isLmvMaterial) ||
                 material instanceof THREE.MeshLambertMaterial ||
                 material.lights ) {

                if ( _lightsNeedUpdate ) {

                    refreshLights = true;
                    setupLights( lights );
                    _lightsNeedUpdate = false;

                }

                if ( refreshLights ) {
                    refreshUniformsLights( m_uniforms, _lights );
                    markUniformsLightsNeedsUpdate( m_uniforms, true );
                } else {
                    markUniformsLightsNeedsUpdate( m_uniforms, false );
                }

            }

            if ( (material instanceof THREE.MeshBasicMaterial && !material.isLmvMaterial) ||
                 material instanceof THREE.MeshLambertMaterial ||
                 (material instanceof THREE.MeshPhongMaterial && !material.isLmvMaterial) ) {

                refreshUniformsCommon( m_uniforms, material );
                refreshUniformsIBL(m_uniforms, material);
            }

            // refresh single material specific uniforms

            if ( (material instanceof THREE.PointCloudMaterial || material instanceof THREE.PointsMaterial) && !material.isLmvMaterial ) {

                refreshUniformsPointCloud( m_uniforms, material );

            } else if ( material instanceof THREE.LineBasicMaterial && !material.isLmvMaterial ) {

                refreshUniformsLine( m_uniforms, material );

            } else if ( material instanceof THREE.LineDashedMaterial ) {

                refreshUniformsLine( m_uniforms, material );
                refreshUniformsDash( m_uniforms, material );

            } else if ( material instanceof THREE.MeshPhongMaterial && !material.isLmvMaterial ) {

                refreshUniformsPhong( m_uniforms, material );

            } else if ( material instanceof THREE.MeshLambertMaterial ) {

                refreshUniformsLambert( m_uniforms, material );

            } else if ( material instanceof THREE.MeshDepthMaterial ) {

                m_uniforms.mNear.value = camera.near;
                m_uniforms.mFar.value = camera.far;
                m_uniforms.opacity.value = material.opacity;

            } else if ( material instanceof THREE.MeshNormalMaterial ) {

                m_uniforms.opacity.value = material.opacity;

            } else if ( typeof material.refreshUniforms === 'function' ) {
                material.refreshUniforms(m_uniforms);

            }
            if (material.wideLines) {
                var width = object.geometry.lineWidth;
                if (material.linewidth !== undefined)
                    width = material.linewidth;
                m_uniforms.view_size.value = new THREE.Vector2(_window.innerWidth / width, _window.innerHeight / width);
            }

            if (shadowmap.ShadowRender && material.shadowMap) {
                shadowmap.ShadowRender.RefreshUniformsShadow(m_uniforms, material);
            }

            // TODO_NOP: direct assignment dangerous?
            var ucp = m_uniforms.cutplanes;
            if (material.cutplanes && material.cutplanes.length > 0 && ucp) {
                ucp.value = material.cutplanes;
                // Currently, Prism is implemented as shader material, its uniform is just init for once.
                // Remove the array component if cutplanes's length changed so it can be re-init.
                if (ucp._array && ucp._array.length != 4 * material.cutplanes)
                    ucp._array = undefined;
            }

            if (material.hatchParams && m_uniforms.hatchParams) {
                m_uniforms.hatchParams.value.copy(material.hatchParams);
                m_uniforms.hatchTintColor.value.copy(material.hatchTintColor);
                m_uniforms.hatchTintIntensity.value = material.hatchTintIntensity;
            }

            // load common uniforms

            loadUniformsGeneric( material.uniformsList );

        }

        loadUniformsMatrices( p_uniforms, object, camera );

        var dbId;
        if (p_uniforms.modelId) {

            if(p_uniforms.dbId) {
                dbId = object.dbId || object.fragId || 0;
                _gl.uniform3f( p_uniforms.dbId, (dbId & 0xff) / 255,
                                                ((dbId >> 8) & 0xff) / 255,
                                                ((dbId >> 16) & 0xff) / 255);
            }
            var modelId = object.modelId;
            _gl.uniform3f( p_uniforms.modelId, (modelId & 0xff) / 255,
                                            ((modelId >> 8) & 0xff) / 255,
                                            //we can encode the highest bits of the ID here, since the model ID will not really need more than 2 bytes
                                            ((dbId >> 24) & 0xff) / 255);

        } else if ( p_uniforms.dbId !== null ) {

            dbId = object.dbId || object.fragId || 0;

            //The dbId is rendered to an RGB target, so the
            //uppermost byte of the dbId is dropped. Use a modelId
            //target if the full range is desired
            _gl.uniform3f( p_uniforms.dbId, (dbId & 0xff) / 255,
                                            ((dbId >> 8) & 0xff) / 255,
                                            ((dbId >> 16) & 0xff) / 255/*,
                                            ((dbId >> 24) & 0xff) / 255*/);

        }

        // If a theming color uniform is defined, get it from the mesh.
        // Note that theming colors are Vector4 (not THREE.Color), because we need alpha for intensity.
        if (p_uniforms.themingColor) {
            var color = object.themingColor;
            if (color instanceof THREE.Vector4) {
                _gl.uniform4f(p_uniforms.themingColor, color.x, color.y, color.z, color.w);
            } else {
                _gl.uniform4f(p_uniforms.themingColor, 0.0, 0.0, 0.0, 0.0);
            }
        }

        return program;

    }

    // Uniforms (refresh uniforms objects)

    function refreshUniformsCommon ( uniforms, material ) {

        uniforms.opacity.value = material.opacity;


        uniforms.diffuse.value.copy(material.color);


        uniforms.map.value = material.map;
        uniforms.lightMap.value = material.lightMap;
        uniforms.specularMap.value = material.specularMap;
        uniforms.alphaMap.value = material.alphaMap;

        if ( material.bumpMap ) {

            uniforms.bumpMap.value = material.bumpMap;
            uniforms.bumpScale.value = material.bumpScale;

        }

        if ( material.normalMap ) {

            uniforms.normalMap.value = material.normalMap;
            uniforms.normalScale.value.copy( material.normalScale );

        }

        // uv repeat and offset setting priorities
        //	1. color map
        //	2. specular map
        //	3. normal map
        //	4. bump map
        //  5. alpha map

        //NOTE: We deviate from Three.js in that we allow
        //separate scales for diffuse/specular, alpha, and bump

        function setTexTransforms(uniforms, texMatrix, texture) {
            var offset = texture.offset;
            var repeat = texture.repeat;

            if (texMatrix) {
                var uMatrix = texMatrix.value;

                if (texture.matrix)
                    uMatrix.copy(texture.matrix);
                else
                    uMatrix.identity();

                uMatrix.elements[6] += offset.x;
                uMatrix.elements[7] += offset.y;
                uMatrix.elements[0] *= repeat.x;
                uMatrix.elements[3] *= repeat.x;
                uMatrix.elements[1] *= repeat.y;
                uMatrix.elements[4] *= repeat.y;
            }
            else {
              uniforms.offsetRepeat.value.set( offset.x, offset.y, repeat.x, repeat.y );
            }
        }

        if (material.alphaMap) {
            setTexTransforms(uniforms, uniforms.texMatrixAlpha, material.alphaMap);
        }

        var uvScaleMapBump;
        if ( material.normalMap ) {
            uvScaleMapBump = material.normalMap;
        } else if ( material.bumpMap ) {
            uvScaleMapBump = material.bumpMap;
        }
        if ( uvScaleMapBump !== undefined ) {
            setTexTransforms(uniforms, uniforms.texMatrixBump, uvScaleMapBump);
        }

        var uvScaleMap;
        if ( material.map ) {
            uvScaleMap = material.map;
        } else if ( material.specularMap ) {
            uvScaleMap = material.specularMap;
        }
        if ( uvScaleMap !== undefined ) {
            setTexTransforms(uniforms, uniforms.texMatrix, uvScaleMap);
        }

        uniforms.envMap.value = material.envMap;
        if (uniforms.irradianceMap) {
            uniforms.irradianceMap.value = material.irradianceMap;
        }

        uniforms.reflectivity.value = material.reflectivity;


        uniforms.refractionRatio.value = material.refractionRatio;

    }

    function refreshUniformsPointCloud ( uniforms, material ) {

        refreshUniformsLine(uniforms, material);
        uniforms.point_size.value = material.size;
        uniforms.map.value = material.map;
    }

    function refreshUniformsLine ( uniforms, material ) {

        uniforms.diffuse.value = material.color;
        uniforms.opacity.value = material.opacity;

    }

    function refreshUniformsDash ( uniforms, material ) {

        uniforms.dashSize.value = material.dashSize;
        uniforms.totalSize.value = material.dashSize + material.gapSize;
        uniforms.scale.value = material.scale;

    }

    function refreshUniformsPhong ( uniforms, material ) {

        uniforms.shininess.value = material.shininess;

        //The environment cube map is blurred with the assumption that
        //max shininess is 2048 and every mip drops that by a factor of 4
        //"float MipmapIndex = log(shininess / 2048.0) / log(0.25);",
        //The simplification below was given in the original source for this method.
        //However, it does not seem to match the equation above, so we use a corrected one.
        //"float MipmapIndex = max(0.0, -1.66096404744368 * logShiny + 5.5);",
        //NOTE: Once roughness maps are supported, the computation will have to move to the shader.
        if (uniforms.reflMipIndex) {
            var logShiny = Math.log(Math.max(1.0+1e-10, material.shininess));
            uniforms.reflMipIndex.value = Math.max(0.0, -0.72134752 * logShiny + 5.5);
        }

        if (uniforms.emissive)
            uniforms.emissive.value.copy(material.emissive);

        uniforms.specular.value.copy(material.specular);

        if (uniforms.exposureBias)
            uniforms.exposureBias.value = material.exposureBias;
    }

    function refreshUniformsLambert ( uniforms, material ) {

        uniforms.emissive.value.copy(material.emissive);


        if ( material.wrapAround ) {

            uniforms.wrapRGB.value.copy( material.wrapRGB );

        }

    }

    function refreshUniformsLights ( uniforms, lights ) {

        uniforms.ambientLightColor.value = lights.ambient;

        uniforms.directionalLightColor.value = lights.directional.colors;
        uniforms.directionalLightDirection.value = lights.directional.positions;

        uniforms.pointLightColor.value = lights.point.colors;
        uniforms.pointLightPosition.value = lights.point.positions;
        uniforms.pointLightDistance.value = lights.point.distances;

        uniforms.spotLightColor.value = lights.spot.colors;
        uniforms.spotLightPosition.value = lights.spot.positions;
        uniforms.spotLightDistance.value = lights.spot.distances;
        uniforms.spotLightDirection.value = lights.spot.directions;
        uniforms.spotLightAngleCos.value = lights.spot.anglesCos;
        uniforms.spotLightExponent.value = lights.spot.exponents;

        uniforms.hemisphereLightSkyColor.value = lights.hemi.skyColors;
        uniforms.hemisphereLightGroundColor.value = lights.hemi.groundColors;
        uniforms.hemisphereLightDirection.value = lights.hemi.positions;

    }

    // If uniforms are marked as clean, they don't need to be loaded to the GPU.

    function markUniformsLightsNeedsUpdate ( uniforms, boolean ) {
        uniforms.ambientLightColor.needsUpdate = boolean;

        uniforms.directionalLightColor.needsUpdate = boolean;
        uniforms.directionalLightDirection.needsUpdate = boolean;

        uniforms.pointLightColor.needsUpdate = boolean;
        uniforms.pointLightPosition.needsUpdate = boolean;
        uniforms.pointLightDistance.needsUpdate = boolean;

        uniforms.spotLightColor.needsUpdate = boolean;
        uniforms.spotLightPosition.needsUpdate = boolean;
        uniforms.spotLightDistance.needsUpdate = boolean;
        uniforms.spotLightDirection.needsUpdate = boolean;
        uniforms.spotLightAngleCos.needsUpdate = boolean;
        uniforms.spotLightExponent.needsUpdate = boolean;

        uniforms.hemisphereLightSkyColor.needsUpdate = boolean;
        uniforms.hemisphereLightGroundColor.needsUpdate = boolean;
        uniforms.hemisphereLightDirection.needsUpdate = boolean;

    }

    // Uniforms (load to GPU)

    function loadUniformsMatrices ( uniforms, object, camera ) {

        _objectModelViewMatrix.multiplyMatrices( camera.matrixWorldInverse, object.matrixWorld );

        _gl.uniformMatrix4fv( uniforms.modelViewMatrix, false, _objectModelViewMatrix.elements );

        if ( uniforms.normalMatrix ) {

            _objectNormalMatrix.getNormalMatrix( _objectModelViewMatrix );

            _gl.uniformMatrix3fv( uniforms.normalMatrix, false, _objectNormalMatrix.elements );

        }

        // Matrix with world transform
        if ( uniforms.modelMatrix !== null ) {

            _gl.uniformMatrix4fv( uniforms.modelMatrix, false, object.matrixWorld.elements );

        }

        // Local model matrix (without world transform)
        if ( uniforms.modelLocalMatrix) {

            _gl.uniformMatrix4fv( uniforms.modelLocalMatrix, false, object.matrix.elements );

        }

    }

    function getTextureUnit() {

        var textureUnit = _usedTextureUnits;

        if ( textureUnit >= _maxTextures ) {

            console.warn( "WebGLRenderer: trying to use " + textureUnit + " texture units while this GPU supports only " + _maxTextures );

        }

        _usedTextureUnits += 1;

        return textureUnit;

    }

    function loadUniformsGeneric ( uniforms ) {

        var texture, textureUnit, offset;

        for ( var j = 0, jl = uniforms.length; j < jl; j ++ ) {

            var uniform = uniforms[ j ][ 0 ];

            // needsUpdate property is not added to all uniforms.
            if ( uniform.needsUpdate === false ) continue;

            // needsUpdate property is not added to all uniforms.
            if ( uniform.perObject )
                continue;

            var type = uniform.type;
            var value = uniform.value;
            var location = uniforms[ j ][ 1 ];

            var i, il;

            switch ( type ) {

                case '1i':
                    _gl.uniform1i( location, value );
                    break;

                case '1f':
                    _gl.uniform1f( location, value );
                    break;

                case '2f':
                    _gl.uniform2f( location, value[ 0 ], value[ 1 ] );
                    break;

                case '3f':
                    _gl.uniform3f( location, value[ 0 ], value[ 1 ], value[ 2 ] );
                    break;

                case '4f':
                    _gl.uniform4f( location, value[ 0 ], value[ 1 ], value[ 2 ], value[ 3 ] );
                    break;

                case '1iv':
                    _gl.uniform1iv( location, value );
                    break;

                case '3iv':
                    _gl.uniform3iv( location, value );
                    break;

                case '1fv':
                    _gl.uniform1fv( location, value );
                    break;

                case '2fv':
                    _gl.uniform2fv( location, value );
                    break;

                case '3fv':
                    _gl.uniform3fv( location, value );
                    break;

                case '4fv':
                    _gl.uniform4fv( location, value );
                    break;

                case 'Matrix3fv':
                    _gl.uniformMatrix3fv( location, false, value );
                    break;

                case 'Matrix4fv':
                    _gl.uniformMatrix4fv( location, false, value );
                    break;

                //

                case 'i':

                    // single integer
                    _gl.uniform1i( location, value );

                    break;

                case 'f':

                    // single float
                    _gl.uniform1f( location, value );

                    break;

                case 'v2':

                    // single THREE.Vector2
                    _gl.uniform2f( location, value.x, value.y );

                    break;

                case 'v3':

                    // single THREE.Vector3
                    _gl.uniform3f( location, value.x, value.y, value.z );

                    break;

                case 'v4':

                    // single THREE.Vector4
                    _gl.uniform4f( location, value.x, value.y, value.z, value.w );

                    break;

                case 'c':

                    // single THREE.Color
                    _gl.uniform3f( location, value.r, value.g, value.b );

                    break;

                case 'iv1':

                    // flat array of integers (JS or typed array)
                    _gl.uniform1iv( location, value );

                    break;

                case 'iv':

                    // flat array of integers with 3 x N size (JS or typed array)
                    _gl.uniform3iv( location, value );

                    break;

                case 'fv1':

                    // flat array of floats (JS or typed array)
                    _gl.uniform1fv( location, value );

                    break;

                case 'fv':

                    // flat array of floats with 3 x N size (JS or typed array)
                    _gl.uniform3fv( location, value );

                    break;

                case 'v2v':

                    // array of THREE.Vector2

                    if ( uniform._array === undefined ) {

                        uniform._array = new Float32Array( 2 * value.length );

                    }

                    for ( i = 0, il = value.length; i < il; i ++ ) {

                        offset = i * 2;

                        uniform._array[ offset ]     = value[ i ].x;
                        uniform._array[ offset + 1 ] = value[ i ].y;

                    }

                    _gl.uniform2fv( location, uniform._array );

                    break;

                case 'v3v':

                    // array of THREE.Vector3

                    if ( uniform._array === undefined ) {

                        uniform._array = new Float32Array( 3 * value.length );

                    }

                    for ( i = 0, il = value.length; i < il; i ++ ) {

                        offset = i * 3;

                        uniform._array[ offset ]     = value[ i ].x;
                        uniform._array[ offset + 1 ] = value[ i ].y;
                        uniform._array[ offset + 2 ] = value[ i ].z;

                    }

                    _gl.uniform3fv( location, uniform._array );

                    break;

                case 'v4v':

                    // array of THREE.Vector4

                    if ( uniform._array === undefined ) {

                        uniform._array = new Float32Array( 4 * value.length );

                    }

                    for ( i = 0, il = value.length; i < il; i ++ ) {

                        offset = i * 4;

                        uniform._array[ offset ]     = value[ i ].x;
                        uniform._array[ offset + 1 ] = value[ i ].y;
                        uniform._array[ offset + 2 ] = value[ i ].z;
                        uniform._array[ offset + 3 ] = value[ i ].w;

                    }

                    _gl.uniform4fv( location, uniform._array );

                    break;

                case 'm3':

                    // single THREE.Matrix3
                    _gl.uniformMatrix3fv( location, false, value.elements );

                    break;

                case 'm3v':

                    // array of THREE.Matrix3

                    if ( uniform._array === undefined ) {

                        uniform._array = new Float32Array( 9 * value.length );

                    }

                    for ( i = 0, il = value.length; i < il; i ++ ) {

                        value[ i ].flattenToArrayOffset( uniform._array, i * 9 );

                    }

                    _gl.uniformMatrix3fv( location, false, uniform._array );

                    break;

                case 'm4':

                    // single THREE.Matrix4
                    _gl.uniformMatrix4fv( location, false, value.elements );

                    break;

                case 'm4v':

                    // array of THREE.Matrix4

                    if ( uniform._array === undefined ) {

                        uniform._array = new Float32Array( 16 * value.length );

                    }

                    for ( i = 0, il = value.length; i < il; i ++ ) {

                        value[ i ].flattenToArrayOffset( uniform._array, i * 16 );

                    }

                    _gl.uniformMatrix4fv( location, false, uniform._array );

                    break;

                case 't':

                    // single THREE.Texture (2d or cube)

                    texture = value;
                    textureUnit = getTextureUnit();

                    _gl.uniform1i( location, textureUnit );

                    if ( ! texture ) {
                        // Unbind whatever leftover texture might be in this slot.
                        // The texture itself is not yet (or perhaps ever) assigned, so we want to avoid getting
                        // some random leftover bound texture from another material. See https://jira.autodesk.com/browse/LMV-2993
                        _gl.activeTexture( _gl.TEXTURE0 + textureUnit );
                        _gl.bindTexture( _gl.TEXTURE_2D, _nullTexture.__webglTexture );
                        continue;
                    }

                    // Make sure that texture is refreshed if context was lost/restored
                    _this.lostContextRecovery && _this.lostContextRecovery.refreshIfNeeded(texture);

                    if	( (Array.isArray(texture.image) && texture.image.length === 6) ||  // CompressedTexture can have Array in image :/
                        ( texture instanceof THREE.CubeTexture )) {

                        if (!checkNeedsUpdate(texture)) {
                            _gl.activeTexture( _gl.TEXTURE0 + textureUnit );
                            _gl.bindTexture( _gl.TEXTURE_CUBE_MAP, texture.__webglTextureCube );
                        } else {
                            setCubeTexture( texture, textureUnit );
                        }

                    } else if ( texture instanceof THREE.WebGLRenderTargetCube ) {

                        setCubeTextureDynamic( texture, textureUnit );

                    } else {

                        _this.setTexture( texture, textureUnit );

                    }

                    break;

                case 'tv':

                    // array of THREE.Texture (2d)

                    if ( uniform._array === undefined ) {

                        uniform._array = [];

                    }

                    for ( i = 0, il = uniform.value.length; i < il; i ++ ) {

                        uniform._array[ i ] = getTextureUnit();

                    }

                    _gl.uniform1iv( location, uniform._array );

                    for ( i = 0, il = uniform.value.length; i < il; i ++ ) {

                        texture = uniform.value[ i ];
                        textureUnit = uniform._array[ i ];

                        if ( ! texture ) continue;

                        // Make sure that texture is refreshed if context was lost/restored
                        _this.lostContextRecovery && _this.lostContextRecovery.refreshIfNeeded(texture);

                        _this.setTexture( texture, textureUnit );

                    }

                    break;

                default:

                    console.warn( 'THREE.WebGLRenderer: Unknown uniform type: ' + type );

            }

        }

    }

    //

    /* not used
    function setColorGamma( array, offset, color, intensitySq ) {

        array[ offset ]     = color.r * color.r * intensitySq;
        array[ offset + 1 ] = color.g * color.g * intensitySq;
        array[ offset + 2 ] = color.b * color.b * intensitySq;

    }
    */

    function setColorLinear( array, offset, color, intensity ) {

        array[ offset ]     = color.r * intensity;
        array[ offset + 1 ] = color.g * intensity;
        array[ offset + 2 ] = color.b * intensity;

    }

    function setupLights ( lights ) {

        var l, ll, light,
        r = 0, g = 0, b = 0,
        color, skyColor, groundColor,
        intensity,
        distance,

        zlights = _lights,

        dirColors = zlights.directional.colors,
        dirPositions = zlights.directional.positions,

        pointColors = zlights.point.colors,
        pointPositions = zlights.point.positions,
        pointDistances = zlights.point.distances,

        spotColors = zlights.spot.colors,
        spotPositions = zlights.spot.positions,
        spotDistances = zlights.spot.distances,
        spotDirections = zlights.spot.directions,
        spotAnglesCos = zlights.spot.anglesCos,
        spotExponents = zlights.spot.exponents,

        hemiSkyColors = zlights.hemi.skyColors,
        hemiGroundColors = zlights.hemi.groundColors,
        hemiPositions = zlights.hemi.positions,

        dirLength = 0,
        pointLength = 0,
        spotLength = 0,
        hemiLength = 0,

        dirCount = 0,
        pointCount = 0,
        spotCount = 0,
        hemiCount = 0,

        dirOffset = 0,
        pointOffset = 0,
        spotOffset = 0,
        hemiOffset = 0;

        for ( l = 0, ll = lights.length; l < ll; l ++ ) {

            light = lights[ l ];

            if ( light.onlyShadow ) continue;

            color = light.color;
            intensity = light.intensity;
            distance = light.distance;

            if ( light instanceof THREE.AmbientLight ) {

                if ( ! light.visible ) continue;

                    r += color.r;
                    g += color.g;
                    b += color.b;

            } else if ( light instanceof THREE.DirectionalLight ) {

                dirCount += 1;

                if ( ! light.visible ) continue;

                _direction.setFromMatrixPosition( light.matrixWorld );
                _vector3.setFromMatrixPosition( light.target.matrixWorld );
                _direction.sub( _vector3 );
                _direction.normalize();

                dirOffset = dirLength * 3;

                dirPositions[ dirOffset ]     = _direction.x;
                dirPositions[ dirOffset + 1 ] = _direction.y;
                dirPositions[ dirOffset + 2 ] = _direction.z;

                setColorLinear( dirColors, dirOffset, color, intensity );

                dirLength += 1;

            } else if ( light instanceof THREE.PointLight ) {

                pointCount += 1;

                if ( ! light.visible ) continue;

                pointOffset = pointLength * 3;


                setColorLinear( pointColors, pointOffset, color, intensity );


                _vector3.setFromMatrixPosition( light.matrixWorld );

                pointPositions[ pointOffset ]     = _vector3.x;
                pointPositions[ pointOffset + 1 ] = _vector3.y;
                pointPositions[ pointOffset + 2 ] = _vector3.z;

                pointDistances[ pointLength ] = distance;

                pointLength += 1;

            } else if ( light instanceof THREE.SpotLight ) {

                spotCount += 1;

                if ( ! light.visible ) continue;

                spotOffset = spotLength * 3;

                setColorLinear( spotColors, spotOffset, color, intensity );

                _vector3.setFromMatrixPosition( light.matrixWorld );

                spotPositions[ spotOffset ]     = _vector3.x;
                spotPositions[ spotOffset + 1 ] = _vector3.y;
                spotPositions[ spotOffset + 2 ] = _vector3.z;

                spotDistances[ spotLength ] = distance;

                _direction.copy( _vector3 );
                _vector3.setFromMatrixPosition( light.target.matrixWorld );
                _direction.sub( _vector3 );
                _direction.normalize();

                spotDirections[ spotOffset ]     = _direction.x;
                spotDirections[ spotOffset + 1 ] = _direction.y;
                spotDirections[ spotOffset + 2 ] = _direction.z;

                spotAnglesCos[ spotLength ] = Math.cos( light.angle );
                spotExponents[ spotLength ] = light.exponent;

                spotLength += 1;

            } else if ( light instanceof THREE.HemisphereLight ) {

                hemiCount += 1;

                if ( ! light.visible ) continue;

                _direction.setFromMatrixPosition( light.matrixWorld );
                _direction.normalize();

                hemiOffset = hemiLength * 3;

                hemiPositions[ hemiOffset ]     = _direction.x;
                hemiPositions[ hemiOffset + 1 ] = _direction.y;
                hemiPositions[ hemiOffset + 2 ] = _direction.z;

                skyColor = light.color;
                groundColor = light.groundColor;

                setColorLinear( hemiSkyColors, hemiOffset, skyColor, intensity );
                setColorLinear( hemiGroundColors, hemiOffset, groundColor, intensity );

                hemiLength += 1;

            }

        }

        // null eventual remains from removed lights
        // (this is to avoid if in shader)

        for ( l = dirLength * 3, ll = Math.max( dirColors.length, dirCount * 3 ); l < ll; l ++ ) dirColors[ l ] = 0.0;
        for ( l = pointLength * 3, ll = Math.max( pointColors.length, pointCount * 3 ); l < ll; l ++ ) pointColors[ l ] = 0.0;
        for ( l = spotLength * 3, ll = Math.max( spotColors.length, spotCount * 3 ); l < ll; l ++ ) spotColors[ l ] = 0.0;
        for ( l = hemiLength * 3, ll = Math.max( hemiSkyColors.length, hemiCount * 3 ); l < ll; l ++ ) hemiSkyColors[ l ] = 0.0;
        for ( l = hemiLength * 3, ll = Math.max( hemiGroundColors.length, hemiCount * 3 ); l < ll; l ++ ) hemiGroundColors[ l ] = 0.0;

        zlights.directional.length = dirLength;
        zlights.point.length = pointLength;
        zlights.spot.length = spotLength;
        zlights.hemi.length = hemiLength;

        zlights.ambient[ 0 ] = r;
        zlights.ambient[ 1 ] = g;
        zlights.ambient[ 2 ] = b;

    }

    // GL state setting

    this.setFaceCulling = function ( cullFace, frontFaceDirection ) {

        {
            if ( cullFace === THREE.CullFaceNone ) {

                _gl.disable( _gl.CULL_FACE );

            } else {

                if ( frontFaceDirection === THREE.FrontFaceDirectionCW ) {

                    _gl.frontFace( _gl.CW );

                } else {

                    _gl.frontFace( _gl.CCW );

                }

                if ( cullFace === THREE.CullFaceBack ) {

                    _gl.cullFace( _gl.BACK );

                } else if ( cullFace === THREE.CullFaceFront ) {

                    _gl.cullFace( _gl.FRONT );

                } else {

                    _gl.cullFace( _gl.FRONT_AND_BACK );

                }

                _gl.enable( _gl.CULL_FACE );

            }
        }

    };


    // NOTE: if you change the .side value of a material itself, you need to set
    // material.needsUpdate = true, so that the material's shaders are recompiled.
    // You definitely want to avoid this recompilation per frame; usually the
    // THREE.DoubleSided setting works fine for both back and front side display,
    // even if the colors of the sides are different (which are simply uniforms
    // being changed, not the programs themselves).
    this.setMaterialFaces = function ( material ) {

        state.setDoubleSided( material.side === THREE.DoubleSide );
        state.setFlipSided( material.side === THREE.BackSide );

    };

    // Textures


    function setTextureParameters ( textureType, texture, isImagePowerOfTwo ) {

        var extension;

        if ( isImagePowerOfTwo ) {

            _gl.texParameteri( textureType, _gl.TEXTURE_WRAP_S, paramThreeToGL( texture.wrapS ) );
            _gl.texParameteri( textureType, _gl.TEXTURE_WRAP_T, paramThreeToGL( texture.wrapT ) );

            _gl.texParameteri( textureType, _gl.TEXTURE_MAG_FILTER, paramThreeToGL( texture.magFilter ) );
            _gl.texParameteri( textureType, _gl.TEXTURE_MIN_FILTER, paramThreeToGL( texture.minFilter ) );

        } else {

            _gl.texParameteri( textureType, _gl.TEXTURE_WRAP_S, _gl.CLAMP_TO_EDGE );
            _gl.texParameteri( textureType, _gl.TEXTURE_WRAP_T, _gl.CLAMP_TO_EDGE );

            if ( texture.wrapS !== THREE.ClampToEdgeWrapping || texture.wrapT !== THREE.ClampToEdgeWrapping ) {

                console.warn( 'THREE.WebGLRenderer: Texture is not power of two. Texture.wrapS and Texture.wrapT should be set to THREE.ClampToEdgeWrapping. ( ' + texture.sourceFile + ' )' );

            }

            _gl.texParameteri( textureType, _gl.TEXTURE_MAG_FILTER, filterFallback( texture.magFilter ) );
            _gl.texParameteri( textureType, _gl.TEXTURE_MIN_FILTER, filterFallback( texture.minFilter ) );

            if ( texture.minFilter !== THREE.NearestFilter && texture.minFilter !== THREE.LinearFilter ) {

                console.warn( 'THREE.WebGLRenderer: Texture is not power of two. Texture.minFilter should be set to THREE.NearestFilter or THREE.LinearFilter. ( ' + texture.sourceFile + ' )' );

            }

        }

        extension = extensions.get( 'EXT_texture_filter_anisotropic' );

        if ( extension && texture.type !== THREE.FloatType && texture.type !== THREE.HalfFloatType) {

            if ( texture.anisotropy > 1 || texture.__oldAnisotropy ) {

                _gl.texParameterf( textureType, extension.TEXTURE_MAX_ANISOTROPY_EXT, Math.min( texture.anisotropy, _this.getMaxAnisotropy() ) );
                texture.__oldAnisotropy = texture.anisotropy;

            }

        }

    }


    this.uploadTexture = function ( texture ) {

        if ( texture.__webglInit === undefined ) {

            texture.__webglInit = true;

            texture.addEventListener( 'dispose', onTextureDispose );

            texture.__webglTexture = _gl.createTexture();

            _this.info.memory.textures ++;

        }

        _gl.bindTexture( _gl.TEXTURE_2D, texture.__webglTexture );

        _gl.pixelStorei( _gl.UNPACK_FLIP_Y_WEBGL, texture.flipY );
        _gl.pixelStorei( _gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, texture.premultiplyAlpha );
        _gl.pixelStorei( _gl.UNPACK_ALIGNMENT, texture.unpackAlignment );

        texture.image = clampToMaxSize( texture.image, _maxTextureSize );

        var image = texture.image,
        isImagePowerOfTwo = THREE.Math.isPowerOfTwo( image.width ) && THREE.Math.isPowerOfTwo( image.height ),
        glFormat = paramThreeToGL( texture.format ),
        glType = paramThreeToGL( texture.type ),
        glInternalFormat = paramToInternal(texture.format, texture.type);

        setTextureParameters( _gl.TEXTURE_2D, texture, isImagePowerOfTwo );

        var mipmap, mipmaps = texture.mipmaps;
        var i, il;

        if ( texture instanceof THREE.DataTexture ) {

            // use manually created mipmaps if available
            // if there are no manual mipmaps
            // set 0 level mipmap and then use GL to generate other mipmap levels

            if ( mipmaps.length > 0 && isImagePowerOfTwo ) {

                for ( i = 0, il = mipmaps.length; i < il; i ++ ) {

                    mipmap = mipmaps[ i ];
                    _gl.texImage2D( _gl.TEXTURE_2D, i, glInternalFormat, mipmap.width, mipmap.height, 0, glFormat, glType, mipmap.data );

                }

                texture.generateMipmaps = false;

            } else {

                _gl.texImage2D( _gl.TEXTURE_2D, 0, glInternalFormat, image.width, image.height, 0, glFormat, glType, image.data );

            }

        } else if ( texture instanceof THREE.CompressedTexture ) {

            for ( i = 0, il = mipmaps.length; i < il; i ++ ) {

                mipmap = mipmaps[ i ];

                if ( texture.format !== THREE.RGBAFormat && texture.format !== THREE.RGBFormat ) {

                    if ( getCompressedTextureFormats().indexOf( glFormat ) > -1 ) {

                        _gl.compressedTexImage2D( _gl.TEXTURE_2D, i, glInternalFormat, mipmap.width, mipmap.height, 0, mipmap.data );

                    } else {

                        console.warn( "Attempt to load unsupported compressed texture format" );

                    }

                } else {

                    _gl.texImage2D( _gl.TEXTURE_2D, i, glInternalFormat, mipmap.width, mipmap.height, 0, glFormat, glType, mipmap.data );

                }
            }

            // make sure compressed texture pyramids are complete (i.e. include all levels
            // between what ever was the coarsest level in file and 1x1)
            if(mipmaps.length > 1 && getCompressedTextureFormats().indexOf( glFormat ) > -1 )
            {
                var w = mipmap.width >> 1,
                    h = mipmap.height >> 1,
                    l = mipmaps.length;

                var view;

                while(w >= 1 || h >= 1) {
                    view = (mipmap.width == 4 && mipmap.height == 4) ? mipmap.data : new DataView(
                        mipmap.data.buffer,
                        mipmap.data.byteOffset,
                        mipmap.data.byteLength * (Math.max(w, 4) * Math.max(h, 4)) / (mipmap.width * mipmap.height)
                    );

                    _gl.compressedTexImage2D( _gl.TEXTURE_2D, l, glInternalFormat, Math.max(w, 1), Math.max(h, 1), 0, view);
                    w = w >> 1;
                    h = h >> 1;
                    ++l;
                }
            }

        } else { // regular Texture (image, video, canvas)

            // use manually created mipmaps if available
            // if there are no manual mipmaps
            // set 0 level mipmap and then use GL to generate other mipmap levels

            if ( mipmaps.length > 0 && isImagePowerOfTwo ) {

                for ( i = 0, il = mipmaps.length; i < il; i ++ ) {

                    _gl.texImage2D( _gl.TEXTURE_2D, i, glInternalFormat, glFormat, glType, mipmaps[i] );

                }

                texture.generateMipmaps = false;

            } else {

                _gl.texImage2D( _gl.TEXTURE_2D, 0, glInternalFormat, glFormat, glType, texture.image );

            }

        }

        if ( texture.generateMipmaps && isImagePowerOfTwo ) _gl.generateMipmap( _gl.TEXTURE_2D );

        clearNeedsUpdate(texture);

        if ( texture.onUpdate ) texture.onUpdate();

    };

    this.setTexture = function ( texture, slot ) {
        _gl.activeTexture( _gl.TEXTURE0 + slot );
        if (checkNeedsUpdate(texture)) {
            _this.uploadTexture( texture );
        } else if (texture.__webglTexture) {
            _gl.bindTexture( _gl.TEXTURE_2D, texture.__webglTexture );
        } else {
            // No texture available, so don't "use" the texture unit, but make sure the uniform is assigned to something.
            // This avoids headaches where the texture is bound as output this pass, but was an input last pass
            // and is still bound to the given texture unit.
            // Note that Chrome will flag warnings if you bind to null but are "using" the sampler (even though you're not).
            // So we bind to this bogus texture instead.
            // TODO Better for us might be to not have the unused uniforms in our shaders.
            _gl.bindTexture( _gl.TEXTURE_2D, _nullTexture.__webglTexture );
        }
    };
    // This function is finally defined, so we can use it now.
    _this.uploadTexture(_nullTexture);

    function clampToMaxSize ( image, maxSize ) {

        if ( image.width <= maxSize && image.height <= maxSize ) {

            return image;

        }

        if ((typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) ||
            (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) ||
            (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap)) {


            // Warning: Scaling through the canvas will only work with images that use
            // premultiplied alpha.

            var maxDimension = Math.max(image.width, image.height);
            var scale = maxSize / maxDimension;

            var newWidth = Math.max(Math.floor(image.width * scale), 1);
            var newHeight = Math.max(Math.floor(image.height * scale), 1);

            var canvas = _document.createElement('canvas');
            canvas.width = newWidth;
            canvas.height = newHeight;

            var ctx = canvas.getContext("2d");
            ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, newWidth, newHeight);

            return canvas;
        } else {
            if ('data' in image) {
                console.warn('THREE.WebGLRenderer: Image in DataTexture is too big (' + image.width + 'x' + image.height + ').');
            }

            return image;
        }

    }

    function setCubeTexture ( texture, slot ) {

        if ( texture.image.length === 6 ) {

            if (checkNeedsUpdate(texture)) {

                if ( ! texture.__webglTextureCube ) {

                    texture.addEventListener( 'dispose', onTextureDispose );

                    texture.__webglTextureCube = _gl.createTexture();

                    _this.info.memory.textures ++;

                }

                _gl.activeTexture( _gl.TEXTURE0 + slot );
                _gl.bindTexture( _gl.TEXTURE_CUBE_MAP, texture.__webglTextureCube );

                _gl.pixelStorei( _gl.UNPACK_FLIP_Y_WEBGL, texture.flipY );

                var isCompressed = texture instanceof THREE.CompressedTexture;
                var isDataTexture = texture.image[ 0 ] instanceof THREE.DataTexture;

                var cubeImage = [];

                var i;

                for ( i = 0; i < 6; i ++ ) {

                    if ( _this.autoScaleCubemaps && ! isCompressed && ! isDataTexture ) {

                        cubeImage[ i ] = clampToMaxSize( texture.image[ i ], _maxCubemapSize );

                    } else {

                        cubeImage[ i ] = isDataTexture ? texture.image[ i ].image : texture.image[ i ];

                    }

                }

                var image = cubeImage[ 0 ],
                isImagePowerOfTwo = THREE.Math.isPowerOfTwo( image.width ) && THREE.Math.isPowerOfTwo( image.height ),
                glFormat = paramThreeToGL( texture.format ),
                glType = paramThreeToGL( texture.type );

                setTextureParameters( _gl.TEXTURE_CUBE_MAP, texture, isImagePowerOfTwo );

                for ( i = 0; i < 6; i ++ ) {

                    if ( ! isCompressed ) {

                        if ( isDataTexture ) {

                            _gl.texImage2D( _gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, glFormat, cubeImage[ i ].width, cubeImage[ i ].height, 0, glFormat, glType, cubeImage[ i ].data );

                        } else {

                            _gl.texImage2D( _gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, glFormat, glFormat, glType, cubeImage[ i ] );

                        }

                    } else {

                        var mipmap, mipmaps = cubeImage[ i ].mipmaps;

                        for ( var j = 0, jl = mipmaps.length; j < jl; j ++ ) {

                            mipmap = mipmaps[ j ];

                            if ( texture.format !== THREE.RGBAFormat && texture.format !== THREE.RGBFormat ) {

                                if ( getCompressedTextureFormats().indexOf( glFormat ) > -1 ) {

                                    _gl.compressedTexImage2D( _gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, j, glFormat, mipmap.width, mipmap.height, 0, mipmap.data );

                                } else {

                                    console.warn( "Attempt to load unsupported compressed texture format" );

                                }

                            } else {

                                _gl.texImage2D( _gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, j, glFormat, mipmap.width, mipmap.height, 0, glFormat, glType, mipmap.data );

                            }

                        }

                    }

                }

                if ( texture.generateMipmaps && isImagePowerOfTwo ) {

                    _gl.generateMipmap( _gl.TEXTURE_CUBE_MAP );

                }

                clearNeedsUpdate(texture);
                if ( texture.onUpdate ) texture.onUpdate();

            } else {

                _gl.activeTexture( _gl.TEXTURE0 + slot );
                _gl.bindTexture( _gl.TEXTURE_CUBE_MAP, texture.__webglTextureCube );

            }

        }

    }

    function setCubeTextureDynamic ( texture, slot ) {

        _gl.activeTexture( _gl.TEXTURE0 + slot );
        _gl.bindTexture( _gl.TEXTURE_CUBE_MAP, texture.__webglTexture );

    }

    // Render targets

    function bindDrawBuffers(renderTargets) {

        var attachment0 = _isWebGL2 ? _gl.COLOR_ATTACHMENT0 : _glExtensionDrawBuffers.COLOR_ATTACHMENT0_WEBGL;

        var bufs = [attachment0];
        for (i=1; i<renderTargets.length; i++) {
            bufs.push(attachment0 + i);
        }
        _isWebGL2 ? _gl.drawBuffers(bufs) : _glExtensionDrawBuffers.drawBuffersWEBGL(bufs);
    }

    function createBackingTexture(rt) {

            var isTargetPowerOfTwo = THREE.Math.isPowerOfTwo( rt.width ) && THREE.Math.isPowerOfTwo( rt.height ),
                glFormat = paramThreeToGL( rt.texture.format ),
                glType = paramThreeToGL( rt.texture.type ),
                glInternalFormat = paramToInternal(rt.texture.format, rt.texture.type);

            rt.addEventListener( 'dispose', onRenderTargetDispose );

            rt.__webglTexture = _gl.createTexture();

            _this.info.memory.textures ++;

            _gl.bindTexture( _gl.TEXTURE_2D, rt.__webglTexture );

            setTextureParameters( _gl.TEXTURE_2D, rt.texture, isTargetPowerOfTwo );

            _gl.texImage2D( _gl.TEXTURE_2D, 0, glInternalFormat , rt.width, rt.height, 0, glFormat, glType, null );

            if ( isTargetPowerOfTwo && rt.texture.generateMipmaps)
                _gl.generateMipmap( _gl.TEXTURE_2D );

    }

    function didColorAttachmentsChange(primaryTarget, renderTargets) {

        let bufs = primaryTarget.__webglBoundBuffers;

        if (!bufs) {
            return true;
        }

        if (bufs.length !== renderTargets.length) {
            return true;
        }

        for (let i=0; i<renderTargets.length; i++) {
            if (renderTargets[i] !== bufs[i]) {
                return true;
            }
        }

        return false;
    }


    this.initFrameBufferMRT = function ( renderTargets, verifyFrameBufferWorks ) {

        var primaryTarget = renderTargets[0];
        var clearState = false;

            
        //For MRT, the frame and depth buffer are owned
        //by the first target.
        if ( primaryTarget && ! primaryTarget.__webglFramebuffer ) {
            // first render target is the main target, if its frame buffer is not set
            // we need to do the whole process to initialize it

            if ( primaryTarget.depthBuffer === undefined ) primaryTarget.depthBuffer = true;
            if ( primaryTarget.stencilBuffer === undefined ) primaryTarget.stencilBuffer = true;

            primaryTarget.__webglFramebuffer = _gl.createFramebuffer();

            _gl.bindFramebuffer( _gl.FRAMEBUFFER, primaryTarget.__webglFramebuffer );

            var renderbuffer;

            //Allocate depth buffer if needed

            if (primaryTarget.shareDepthFrom) {

                renderbuffer = primaryTarget.__webglRenderbuffer = primaryTarget.shareDepthFrom.__webglRenderbuffer;
                primaryTarget.__isUsingShared = true;

            } else {

                // Below we can delete the frame buffer from a render target without deleting the render buffer
                // Use the existing render buffer if it is present. This fixes problems with shared depth buffers.
                // The problem is that the color depth buffer could get changed after it was bound to the frame
                // buffer a target that shares the depth buffer. Using the existing depth buffer, keep it consistent.
                renderbuffer = primaryTarget.__webglRenderbuffer;
                primaryTarget.__isUsingShared = false;

                if ( primaryTarget.depthBuffer) {
                    if (!renderbuffer) {
                        renderbuffer = primaryTarget.__webglRenderbuffer = _gl.createRenderbuffer();
                        // __webglRenderbufferOwn is used in case we want to swap the material, we can reuse it here
                        primaryTarget.__webglRenderbufferOwn = renderbuffer;
                    }

                    _gl.bindRenderbuffer( _gl.RENDERBUFFER, renderbuffer );
                    let format;
                    if (primaryTarget.stencilBuffer) {
                        format = _isWebGL2 ? _gl.DEPTH24_STENCIL8 : _gl.DEPTH_STENCIL;
                    } else {
                        format = _isWebGL2 ? _gl.DEPTH_COMPONENT32F : _gl.DEPTH_COMPONENT16;
                    }

                    _gl.renderbufferStorage( _gl.RENDERBUFFER, format, primaryTarget.width, primaryTarget.height );
                }
            }

            //Bind depth buffer

            if ( primaryTarget.depthBuffer) {
                const attachment = primaryTarget.stencilBuffer ? _gl.DEPTH_STENCIL_ATTACHMENT : _gl.DEPTH_ATTACHMENT;
                _gl.framebufferRenderbuffer( _gl.FRAMEBUFFER, attachment, _gl.RENDERBUFFER, renderbuffer );
            }

            clearState = true;
        } else if ( primaryTarget ) {
            // Important: this code branch will only be reached only if the sharedDepthFrom value was changed

            // OpenGL/WebGL does not allow to read the content from the render buffer unless we render it to a texture
            // while most of our scene was setup with the gl pipeline which is defined by depthTest/depthWrite
            // sharedDepthFrom the main render target will boost the performance a lot for overlay rendering
            // do depthWrite in overlay will dirty the main render buffer, which will cause lots of artifact in progressive rendering

            // where is are lots of cases, which requires overlay scenes to have its own depth buffer
            // we want to support those cases, we can change the material to intake the depth target from main render pass
            // but we want to remove the sharedDepthFrom value to null, which requires the following changes

            // then we can swap the depthBuffer back and forth, to get the idea result, it will require material to support 
            // DepthTextureTestUniforms from ShaderChunks.js


            // Logic to swap the depth attachment when some of the scene does not want to share the depth from the main model/ColorTarget
            if( primaryTarget.shareDepthFrom && primaryTarget.__isUsingShared == false ) {
                // since the primary target was already setup, we only need to
                // rebind the depth/stencil attachment from shared renderbuffer
                renderbuffer = primaryTarget.shareDepthFrom.__webglRenderbuffer;
                primaryTarget.__isUsingShared = true;

                if ( primaryTarget.depthBuffer) {
                    const attachment = primaryTarget.stencilBuffer ? _gl.DEPTH_STENCIL_ATTACHMENT : _gl.DEPTH_ATTACHMENT;
                    _gl.framebufferRenderbuffer( _gl.FRAMEBUFFER, attachment, _gl.RENDERBUFFER, renderbuffer );
                }
            } else if ( primaryTarget.shareDepthFrom == null && primaryTarget.__isUsingShared == true ) {
                renderbuffer = primaryTarget.__webglRenderbufferOwn;
                primaryTarget.__isUsingShared = false;

                // for the first time, there is a chance it is swapped from shared render buffer to null
                // that means we need to do the same setup render buffer process
                // and store the none shared render buffer to __webglRenderbufferOwn
                if( renderbuffer == null ) {
                    // this code segments was duplicated to keep the existing code path change minumum 
                    // with only just some state variables change
                    if ( primaryTarget.depthBuffer) {

                        renderbuffer = primaryTarget.__webglRenderbuffer = _gl.createRenderbuffer();
                        // __webglRenderbufferOwn is used in case we want to swap the material, we can reuse it here
                        primaryTarget.__webglRenderbufferOwn = renderbuffer;
    
                        _gl.bindRenderbuffer( _gl.RENDERBUFFER, renderbuffer );
                        let format;
                        if (primaryTarget.stencilBuffer) {
                            format = _isWebGL2 ? _gl.DEPTH24_STENCIL8 : _gl.DEPTH_STENCIL;
                        } else {
                            format = _isWebGL2 ? _gl.DEPTH_COMPONENT32F : _gl.DEPTH_COMPONENT16;
                        }
    
                        _gl.renderbufferStorage( _gl.RENDERBUFFER, format, primaryTarget.width, primaryTarget.height );
                    }
                } 
                
                // bind the depth/stencil buffer from its own render buffer
                if ( primaryTarget.depthBuffer) {
                    const attachment = primaryTarget.stencilBuffer ? _gl.DEPTH_STENCIL_ATTACHMENT : _gl.DEPTH_ATTACHMENT;
                    _gl.framebufferRenderbuffer( _gl.FRAMEBUFFER, attachment, _gl.RENDERBUFFER, renderbuffer );
                }
            }
        }

        var tmpBuf = _currentFramebuffer;

        _gl.bindFramebuffer(_gl.FRAMEBUFFER, primaryTarget.__webglFramebuffer);

        if (didColorAttachmentsChange(primaryTarget, renderTargets)) {
            //Create backing textures for all the targets and attach them
            //to the frame buffer.
            var i;
            for (i=0; i<renderTargets.length; i++) {
                var rt = renderTargets[i];

                if (rt && !rt.__webglTexture) {
                    createBackingTexture(rt);
                }

                _gl.framebufferTexture2D( _gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0 + i, _gl.TEXTURE_2D, (rt && rt.__webglTexture), 0 );
            }

            /*
             * Set remaining (any formerly bound) render targets to null
             * IMPORTANT: Up until recently, whenever we would switch from a framebuffer with 3 attachments
             * to a framebuffer with 2 attachments, we would just ignore the extraneous attachment, and it
             * worked fine.
             * As of Chrome version 54, we can no longer do that. If we try to keep the extra attachment
             * linked to the framebuffer, Chrome errors out with "framebuffer incomplete".
             */
            i = renderTargets.length;
            var maxBuffers = (primaryTarget.__webglBoundBuffers && primaryTarget.__webglBoundBuffers.length) || i;
            while (i < maxBuffers) {
                _gl.framebufferTexture2D(_gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0 + i, _gl.TEXTURE_2D, null, 0);
                i++;
            }

            primaryTarget.__webglBoundBuffers = renderTargets.slice();
        }

        if (this.supportsMRT()) {
            bindDrawBuffers(renderTargets);
        }

        if (verifyFrameBufferWorks) {
            var status = _gl.checkFramebufferStatus(_gl.FRAMEBUFFER);
            if (status !== _gl.FRAMEBUFFER_COMPLETE) {
                console.log("Can't use multiple render targets. Falling back to two passes. " + status);
                // Delete the frame buffer before removing the __webglFramebuffer property.
                // I think you could keep the frame buffer if you just cleared the color attachments.
                if (tmpBuf === primaryTarget.__webglFramebuffer) {
                    // Make sure we don't bind the delete frame buffer.
                    tmpBuf = _currentFramebuffer = null;
                }
                // Bind the old frame buffer. Don't know if deleting a bound frame buffer is a good idea.
                _gl.bindFramebuffer(_gl.FRAMEBUFFER, tmpBuf);
                _gl.deleteFramebuffer(primaryTarget.__webglFramebuffer);
                delete primaryTarget.__webglFramebuffer;
                verifyFrameBufferWorks = false;
            }
        }

        _gl.bindFramebuffer(_gl.FRAMEBUFFER, tmpBuf);

        if (clearState) {
            // Release everything
            _gl.bindTexture( _gl.TEXTURE_2D, null );
            _gl.bindRenderbuffer( _gl.RENDERBUFFER, null );
            _gl.bindFramebuffer( _gl.FRAMEBUFFER, null );
        }

        return verifyFrameBufferWorks;
    };


    // Returns the current render target - if multiple targets have been set it returs the first one
    this.getRenderTarget = function () {

        return _currentRenderTarget;

    };


    //[Firefly] This function is different from Three.js -- it adds
    //support for binding multiple render targets.
    this.setRenderTarget = function(renderTargets) {
        if (Array.isArray(renderTargets) && renderTargets.length > 0) {
            _currentRenderTarget = renderTargets[0];
            _currentRenderTargetIsArray = true;
        } else {
            _currentRenderTarget = renderTargets;
            _currentRenderTargetIsArray = false;
        }

        _this.lostContextRecovery && _this.lostContextRecovery.refreshTargetsIfNeeded(renderTargets);

        var renderTarget;

        // We need to be a little careful about how we handle the frameBuffer for
        // the render target. If we call this method with an array of render targets
        // and then later with the first render target in the array by itself we can
        // use the MRT __webglFrameBuffer when we needed to reinitialize it for the
        // render target alone. Use initForMRT on the render target to keep this from
        // happening. This was happening for the ghosting pass which follows the
        // beauty pass, but only caused errors when used with instanced draw calls.
        if (Array.isArray(renderTargets)) {
            this.initFrameBufferMRT(renderTargets);
            renderTarget = renderTargets[0];
            renderTarget.initForMRT = true;
        } else if (renderTargets) {
            var fb = renderTargets.__webglFramebuffer;
            if ((!fb || _currentFramebuffer !== fb || renderTargets.initForMRT || (renderTargets.shareDepthFrom != null) != (!!renderTargets.__isUsingShared))) {
                this.initFrameBufferMRT([renderTargets]);
            }
            renderTarget = renderTargets;
            renderTarget.initForMRT = false;
        }

        var framebuffer, width, height, vx, vy;

        // Consider current viewport when rendering to framebuffer or if enabled for offscreen targets.        
        var useViewport = !renderTarget || _enableViewportOnOffscreenTargets;
        if (useViewport) {
            width = _viewportWidth;
            height = _viewportHeight;
            vx = _viewportX;
            vy = _viewportY;
        } else {
            width = renderTarget.width;
            height = renderTarget.height;
            vx = 0;
            vy = 0;
        }

        framebuffer = renderTarget ? renderTarget.__webglFramebuffer : null;

        if ( framebuffer !== _currentFramebuffer ) {

            _gl.bindFramebuffer( _gl.FRAMEBUFFER, framebuffer );
            _currentFramebuffer = framebuffer;

        }

        _gl.viewport(vx, vy, width, height);


    };



    this.readRenderTargetPixels = function( renderTarget, x, y, width, height, buffer ) {

        if ( ! ( renderTarget instanceof THREE.WebGLRenderTarget ) ) {

            console.error( 'THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.' );
            return;

        }

        // Make sure that we don't try to read from targets of lost contexts.
        _this.lostContextRecovery && _this.lostContextRecovery.refreshTargetsIfNeeded(renderTarget);

        if ( renderTarget.__webglFramebuffer ) {

            //Just a rough sanity check -- different browsers support different combinations
            //The check is for the most restrictive implementation (ANGLE). It can be relaxed once
            //Chrome dumps ANGLE. Note that targets of format RGB and unsigned byte type can be read with readPixels using GL_RGBA
            //as the format parameter (apparently). But this is not the case for float targets -- for those you have
            //to change the code to readPixels with the correct format.
            if (   (renderTarget.texture.format !== THREE.RGBAFormat
                    && renderTarget.texture.format !== THREE.RGBFormat)
                || renderTarget.texture.type !== THREE.UnsignedByteType) {
                console.error( 'THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not a readable format.' );
                return;

            }

            var restore = false;

            if ( renderTarget.__webglFramebuffer !== _currentFramebuffer ) {

                _gl.bindFramebuffer( _gl.FRAMEBUFFER, renderTarget.__webglFramebuffer );

                restore = true;

            }

            if (renderTarget.canReadPixels || _gl.checkFramebufferStatus( _gl.FRAMEBUFFER ) === _gl.FRAMEBUFFER_COMPLETE ) {

                _gl.readPixels( x, y, width, height, _gl.RGBA, _gl.UNSIGNED_BYTE, buffer );

            } else {

                console.error( 'THREE.WebGLRenderer.readRenderTargetPixels: readPixels from renderTarget failed. Framebuffer not complete.' );

            }

            if ( restore ) {

                _gl.bindFramebuffer( _gl.FRAMEBUFFER, _currentFramebuffer );

            }

        }
    };

    function updateRenderTargetMipmap ( renderTarget ) {

            _gl.bindTexture( _gl.TEXTURE_2D, renderTarget.__webglTexture );
            _gl.generateMipmap( _gl.TEXTURE_2D );
            _gl.bindTexture( _gl.TEXTURE_2D, null );

    }

    // Fallback filters for non-power-of-2 textures

    function filterFallback ( f ) {

        if ( f === THREE.NearestFilter || f === THREE.NearestMipMapNearestFilter || f === THREE.NearestMipMapLinearFilter ) {

            return _gl.NEAREST;

        }

        return _gl.LINEAR;

    }

    // Map three.js constants to WebGL constants

    function paramToInternal(format, type) {

        if (_isWebGL2) {
            if (format === THREE.RGBFormat) {
                switch (type) {
                    case THREE.UnsignedByteType : return _gl.RGB8;
                    case THREE.FloatType: return _gl.RGB32F;
                    case THREE.HalfFloatType: return _gl.RGB16F;
                    default: break;
                }
            } else if (format === THREE.RGBAFormat) {
                switch (type) {
                    case THREE.UnsignedByteType : return _gl.RGBA8;
                    case THREE.FloatType: return _gl.RGBA32F;
                    case THREE.HalfFloatType: return _gl.RGBA16F;
                    default: break;
                }
            } else if (format === THREE.LuminanceFormat) {
                switch (type) {
                    case THREE.UnsignedByteType : return _gl.LUMINANCE; //TODO: There doesn't seem to be _gl.LUMINANCE8 defined?
                    default: break;
                }
            }

            console.error("failed to map texture format and type to internalformat");
        }

        return paramThreeToGL(format);
    }

    function paramThreeToGL ( p ) {

        var extension;

        if ( p === THREE.RepeatWrapping ) return _gl.REPEAT;
        if ( p === THREE.ClampToEdgeWrapping ) return _gl.CLAMP_TO_EDGE;
        if ( p === THREE.MirroredRepeatWrapping ) return _gl.MIRRORED_REPEAT;

        if ( p === THREE.NearestFilter ) return _gl.NEAREST;
        if ( p === THREE.NearestMipMapNearestFilter ) return _gl.NEAREST_MIPMAP_NEAREST;
        if ( p === THREE.NearestMipMapLinearFilter ) return _gl.NEAREST_MIPMAP_LINEAR;

        if ( p === THREE.LinearFilter ) return _gl.LINEAR;
        if ( p === THREE.LinearMipMapNearestFilter ) return _gl.LINEAR_MIPMAP_NEAREST;
        if ( p === THREE.LinearMipMapLinearFilter ) return _gl.LINEAR_MIPMAP_LINEAR;

        if ( p === THREE.UnsignedByteType ) return _gl.UNSIGNED_BYTE;
        if ( p === THREE.UnsignedShort4444Type ) return _gl.UNSIGNED_SHORT_4_4_4_4;
        if ( p === THREE.UnsignedShort5551Type ) return _gl.UNSIGNED_SHORT_5_5_5_1;
        if ( p === THREE.UnsignedShort565Type ) return _gl.UNSIGNED_SHORT_5_6_5;

        if ( p === THREE.ByteType ) return _gl.BYTE;
        if ( p === THREE.ShortType ) return _gl.SHORT;
        if ( p === THREE.UnsignedShortType ) return _gl.UNSIGNED_SHORT;
        if ( p === THREE.IntType ) return _gl.INT;
        if ( p === THREE.UnsignedIntType ) return _gl.UNSIGNED_INT;
        if ( p === THREE.FloatType ) return _gl.FLOAT;
        if ( p === THREE.HalfFloatType) return _isWebGL2 ? _gl.HALF_FLOAT : 0x8D61;//_gl.HALF_FLOAT_OES;

        if ( p === THREE.AlphaFormat ) return _gl.ALPHA;
        if ( p === THREE.RGBFormat ) return _gl.RGB;
        if ( p === THREE.RGBAFormat ) return _gl.RGBA;
        if ( p === THREE.LuminanceFormat ) return _gl.LUMINANCE;
        if ( p === THREE.LuminanceAlphaFormat ) return _gl.LUMINANCE_ALPHA;

        if ( p === THREE.AddEquation ) return _gl.FUNC_ADD;
        if ( p === THREE.MinEquation ) return _gl.MIN;
        if ( p === THREE.MaxEquation ) return _gl.MAX;
        if ( p === THREE.SubtractEquation ) return _gl.FUNC_SUBTRACT;
        if ( p === THREE.ReverseSubtractEquation ) return _gl.FUNC_REVERSE_SUBTRACT;

        if ( p === THREE.ZeroFactor ) return _gl.ZERO;
        if ( p === THREE.OneFactor ) return _gl.ONE;
        if ( p === THREE.SrcColorFactor ) return _gl.SRC_COLOR;
        if ( p === THREE.OneMinusSrcColorFactor ) return _gl.ONE_MINUS_SRC_COLOR;
        if ( p === THREE.SrcAlphaFactor ) return _gl.SRC_ALPHA;
        if ( p === THREE.OneMinusSrcAlphaFactor ) return _gl.ONE_MINUS_SRC_ALPHA;
        if ( p === THREE.DstAlphaFactor ) return _gl.DST_ALPHA;
        if ( p === THREE.OneMinusDstAlphaFactor ) return _gl.ONE_MINUS_DST_ALPHA;

        if ( p === THREE.DstColorFactor ) return _gl.DST_COLOR;
        if ( p === THREE.OneMinusDstColorFactor ) return _gl.ONE_MINUS_DST_COLOR;
        if ( p === THREE.SrcAlphaSaturateFactor ) return _gl.SRC_ALPHA_SATURATE;

        extension = extensions.get( 'WEBGL_compressed_texture_s3tc' );

        if ( extension !== null ) {

            if ( p === THREE.RGB_S3TC_DXT1_Format ) return extension.COMPRESSED_RGB_S3TC_DXT1_EXT;
            if ( p === THREE.RGBA_S3TC_DXT1_Format ) return extension.COMPRESSED_RGBA_S3TC_DXT1_EXT;
            if ( p === THREE.RGBA_S3TC_DXT3_Format ) return extension.COMPRESSED_RGBA_S3TC_DXT3_EXT;
            if ( p === THREE.RGBA_S3TC_DXT5_Format ) return extension.COMPRESSED_RGBA_S3TC_DXT5_EXT;

        }

        extension = extensions.get( 'WEBGL_compressed_texture_pvrtc' );

        if ( extension !== null ) {

            if ( p === THREE.RGB_PVRTC_4BPPV1_Format ) return extension.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;
            if ( p === THREE.RGB_PVRTC_2BPPV1_Format ) return extension.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;
            if ( p === THREE.RGBA_PVRTC_4BPPV1_Format ) return extension.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;
            if ( p === THREE.RGBA_PVRTC_2BPPV1_Format ) return extension.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG;

        }

        extension = extensions.get( 'EXT_blend_minmax' );

        if ( extension !== null ) {

            if ( p === THREE.MinEquation ) return extension.MIN_EXT;
            if ( p === THREE.MaxEquation ) return extension.MAX_EXT;

        }

        return 0;

    }

    // Allocations

    function allocateLights( lights ) {

        var dirLights = 0;
        var pointLights = 0;
        var spotLights = 0;
        var hemiLights = 0;

        for ( var l = 0, ll = lights.length; l < ll; l ++ ) {

            var light = lights[ l ];

            if ( light.onlyShadow ) continue;

            if ( light instanceof THREE.DirectionalLight ) dirLights ++;
            if ( light instanceof THREE.PointLight ) pointLights ++;
            if ( light instanceof THREE.SpotLight ) spotLights ++;
            if ( light instanceof THREE.HemisphereLight ) hemiLights ++;

        }

        return { 'directional' : dirLights, 'point' : pointLights, 'spot': spotLights, 'hemi': hemiLights };

    }
};
