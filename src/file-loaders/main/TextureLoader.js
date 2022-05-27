import { ViewingService } from "../net/Xhr";
import { isMobileDevice, isNodeJS, isIOSDevice, getGlobal } from "../../compat";
import { pathToURL } from "../net/Xhr";
import { errorCodeString, ErrorCodes } from "../net/ErrorCodes";
import { MaterialConverter } from "../../wgs/render/MaterialConverter";
import { DecodeEnvMap } from "../../wgs/render/DecodeEnvMap";
import { logger } from "../../logger/Logger";
import * as THREE from "three";
import { DDSLoader } from "../../../thirdparty/three.js/DDSLoader";
import { endpoint } from "../net/endpoints";
const Pend = require("pend"); //this module has issues with ES6 import because it sets module.exports directly.

let _window = getGlobal();
let _document = _window.document;

//Texture parallel request rate limiting
let _texQueue = new Pend();
_texQueue.max = isMobileDevice() ? 4 : 6;

let _requestsInProgress = 0;
let TEXTURE_MEMORY = isMobileDevice() ? 32 : Infinity;
TEXTURE_MEMORY *= 1024 * 1024;
let _textureCount = 0;
let _textureSize = Infinity;    // Max texture sizes in pixels

const loadTexture = (url, mapping, onLoad, onError) => {
                                   
    {
        THREE.ImageUtils.loadTexture(url, mapping, onLoad, onError);
    }
             
     
                                                 
                                                                       
                                  
     
              
}

function resizeImage(img, onResizeDone) {

    let ow = img.width;
    let oh = img.height;
    let w, h;

    //It's a power of two already and not too large
    if ( ((ow & (ow - 1)) === 0) && ((oh & (oh - 1)) === 0)) {
        if (ow * oh <= _textureSize) {
            onResizeDone(img);
            return;
        }
        w = ow;
        h = oh;
    } else {
        w = 1; while (w*1.5 < ow) w*=2;
        h = 1; while (h*1.5 < oh) h*=2;
    }

    while (w * h > _textureSize) {
        w = Math.max(w / 2, 1);
        h = Math.max(h / 2, 1);
    }

    let canvas = _document.createElement("canvas");
    let ctx = canvas.getContext("2d");
    canvas.width = w;
    canvas.height = h;

    ctx.drawImage(img, 0, 0, w, h);

    const outputImg = new Image();
    
    outputImg.src = canvas.toDataURL();

    outputImg.onload = function() {
        onResizeDone(outputImg);
    };

    outputImg.onerror = function (e) {
        logger.error(e, errorCodeString(ErrorCodes.UNKNOWN_FAILURE));
        onResizeDone(null); 
    };
}

function imageToCanvas(img, isMultiply, backroundColor) {

    let w = img.width;
    let h = img.height;

    let canvas = _document.createElement("canvas");
    let ctx = canvas.getContext("2d");
    ctx.globalCompositeOperation = "copy";
    canvas.width = w;
    canvas.height = h;

	// When the image is used to do multiply blending, we need to add background color
	// to avoid the premultiplied texture artifacts, a black box around the gradient contents
    if(isMultiply) {
        ctx.fillStyle = backroundColor || "#FFFFFF";
        ctx.fillRect( 0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);

    return canvas;
}


function textureHasAlphaChannel( texture ) {

    return ( texture.format === THREE.AlphaFormat || texture.format === THREE.RGBAFormat );

}

function textureUsesClamping( texture ) {

    return ( texture.clampS || texture.clampT );

}

function textureUsesMipmapping( texture ) {

    return ( texture.minFilter !== THREE.NearestFilter && texture.minFilter !== THREE.LinearFilter );

    // Full test, but the Chrome bug happens only on mipmapping, from what we can tell.
    // if wrapping is not clamp to edge, or minFilter is a mipmap mode, then we need power of two.
    //return ( texture.wrapS !== THREE.ClampToEdgeWrapping || texture.wrapT !== THREE.ClampToEdgeWrapping ) ||
    //  ( texture.minFilter !== THREE.NearestFilter && texture.minFilter !== THREE.LinearFilter );

}

function arrayBufferToImageUrl( buffer ) {

    var arrayBuffer = new Uint8Array( buffer );
    var blob = new Blob( [ arrayBuffer ], { type: "image/jpeg" } );
    var urlCreator = _window.URL || _window.webkitURL;

    return urlCreator.createObjectURL( blob );
}


function loadTextureWithSecurity(path, mapping, callback, onError, acmSessionId, skipResize, options) {

    var useCredentials = endpoint.getUseCredentials(); //We need to send authorization somehow (cookie or header)?
    var useCookie = endpoint.getUseCookie(); //We are using cookie for aithorization. We can use HTML Image element to load textures.

    //Set up CORS for the image element
    if (useCredentials && useCookie) { //CORS with credentials
        THREE.ImageUtils.crossOrigin = 'use-credentials';
    } else if (endpoint.getUseCredentials()) { //CORS without credentials (yes, the API is confusingly named, it should be "getUseCORS" perhaps?)
        THREE.ImageUtils.crossOrigin = 'anonymous';
    } else {
        THREE.ImageUtils.crossOrigin = ''; //No CORS.
    }

    var queryParams = "";
    if (useCredentials && acmSessionId) {
        queryParams = "acmsession=" + acmSessionId;
    }

    if (options && options.queryParams) {
        queryParams = queryParams ? (queryParams + "&") : "";
        queryParams += options.queryParams;
    }

    var loadContext = endpoint.initLoadContext({queryParams: queryParams});

    _requestsInProgress++;

    _texQueue.go(function(pendCB) {

        var callbackWithoutResize = function(tex, error) {
            _requestsInProgress--;
            if (error && onError) {
                onError(error);
            } else {
                callback(tex);
            }
            pendCB();
        };

        //In the web browser (non-node) case, we always pass through
        //the power of two resizer if the image is not opaque DataTexture
        var callbackWithResize = skipResize ? callbackWithoutResize
            : function(tex) {
                function onResizeDone(image) {
                    if (tex) {
                        tex.image = image;
                    }

                    _requestsInProgress--;
                    callback(tex);
                    pendCB();
                }

                if (tex && tex.image) {
                    resizeImage(tex.image, onResizeDone);
                } else {
                    onResizeDone();
                }
            };

        var simpleError = function(e) {
            _requestsInProgress--;
            logger.error("Texture load error", e);
            callback(null);
            pendCB();
        };

        //For node.js, always use the "manual" load code path
        if (isNodeJS()) {
            loadTextureWithTokenNode(path, loadContext, mapping, callbackWithoutResize, options);
            return;
        }

        if (path.slice(path.length-4).toLocaleLowerCase() === ".dds") {
            if(isIOSDevice()) {
                var pvrPath = path.slice(0, path.length - 4) + ".pvr";
                new PVRLoader().load(pvrPath + "?" + loadContext.queryParams, callbackWithoutResize, simpleError);
            } else {
                new DDSLoader().load(path + "?" + loadContext.queryParams, callbackWithoutResize, simpleError);
            }
        } else if ((useCredentials && !useCookie) || (options && (options.rawData || options.extractImage))) {
            loadTextureWithToken(path, loadContext, mapping, callbackWithResize, options);
        } else if (/^data:/.test(path)) {
            loadTexture(path, mapping, callbackWithResize, simpleError);
        } else {
            let match = /(\w+):\/\//gi.exec(path);

            // DWF Loader might need to load raster data from virtual file system
            // So we need to use viewing services to fetch the resource
            if(match && !/^(https?|file|blob:\w+):\/\//gi.test(path)) {
                Autodesk.Viewing.Private.ViewingService.rawGet("", "", path, function(data) {
                    function bufferToBase64(buf) {
                        var binstr = Array.prototype.map.call(buf, function (ch) {
                            return String.fromCharCode(ch);
                        }).join('');
                        return btoa(binstr);
                    }
    
                    let ext = /\.(\w+)$/gi.exec(path);
                    if(ext) {
                        ext = ext[1];
                    } else {
                        ext = "png";
                    }
    
                    var base64Url = `data:image/${ext};base64, ` + bufferToBase64(data);
                    loadTexture(base64Url, mapping, callbackWithResize, simpleError);
                }, console.error);
            } else {
                loadTexture(loadContext.queryParams ? path + "?" + loadContext.queryParams : path, mapping, callbackWithResize, simpleError);
            }
        }
    });

}



// For texture loading, three.js expects loadable URL for the image.
// When we put the token in request header instead of cookie, we need AJAX the
// texture and base64 encode it to create a data URI and feed it to three.js.
function loadTextureWithToken(path, loadContext, mapping, callback, options) {

    var texture = new THREE.Texture( undefined, mapping );

    function onSuccess(data) {
        if (options && options.extractImage) {
            data = options.extractImage(data);
        }

        var image = new Image();
        texture.image = image;

        image.onload = function () {
            texture.needsUpdate = true;
            if ( callback ) callback( texture );

            _window.URL.revokeObjectURL(image.src);
        };
        image.onerror = function (e) {
            logger.error(e, errorCodeString(ErrorCodes.UNKNOWN_FAILURE));
            if ( callback ) callback( null );
        };

        image.src = arrayBufferToImageUrl(data);
    }

    function onTextureFailure(statusCode, statusText) {

        var errorMsg = "Error: " + statusCode + " (" + statusText + ")";
        logger.error(errorMsg, errorCodeString(ErrorCodes.NETWORK_SERVER_ERROR));

        //We need to call the callback because it decrements the pending texture counter
        callback && callback(null, {msg: statusText, args: statusCode});
    }

    if (options && options.rawData) {
        onSuccess(options.rawData);
    } else {
        ViewingService.getItem(loadContext, path, onSuccess, onTextureFailure, options);
    }

    return texture;
}


function loadTextureWithTokenNode(path, loadContext, mapping, callback, options) {

    var texture = new THREE.DataTexture( undefined, mapping );

    function onSuccess(data) {
        if (options && options.extractImage) {
            data = options.extractImage(data);
        }

        texture.image = { data: data, width: undefined, height: undefined };

        texture.needsUpdate = true;
        if ( callback ) callback( texture );
    }

    function onTextureFailure(statusCode, statusText) {

        var errorMsg = "Error: " + statusCode + " (" + statusText + ")";
        logger.error(errorMsg, errorCodeString(ErrorCodes.NETWORK_SERVER_ERROR));

        //We need to call the callback because it decrements the pending texture counter
        callback && callback(null, {msg: statusText, args: statusCode});
    }

    ViewingService.getItem(loadContext, path, onSuccess, onTextureFailure);

    return texture;

}


function requestTexture(uri, model, onReady) {

    var svf = model.getData();

    function determineSvfTexturePath(uri) {

        var texPath = null;

        for(var j=0; j<svf.manifest.assets.length; ++j)
        {
            var asset = svf.manifest.assets[j];
            if(asset.id.toLowerCase() == uri.toLowerCase()) {
                let uri = asset.URI;
                if (uri.indexOf("://") === -1)
                    uri = svf.basePath + uri;
                texPath = pathToURL(uri);
                break;
            }
        }
        if(!texPath) {
            texPath = pathToURL(svf.basePath + uri);
        }

        return texPath;
    }

    function determineOtgTexturePath(uri) {

        var loadContext = endpoint.initLoadContext({});

        // get request url
        var url = svf.makeSharedResourcePath(loadContext.otg_cdn, "textures", uri);

        return url;
    }

    if(uri.startsWith("embed:")) {
        //embedded binary file
        var texPath = svf.loadedBuffers[uri.charAt(uri.length-1)];
    } else {
        uri = uri.replace(/\\/g, "/");
        var texPath = model.isOTG() ? determineOtgTexturePath(uri) : determineSvfTexturePath(uri);
    }

    return loadTextureWithSecurity(texPath, THREE.UVMapping, onReady, null, svf.acmSessionId);
}


function loadMaterialTextures(model, material, viewerImpl) {

    if (!material.textureMaps)
        return;

    if (material.texturesLoaded)
        return;

    material.texturesLoaded = true;

    var svf = model.getData();

    // Iterate and parse textures from ugly JSON for each texture type in material.
    // If has URI and valid mapName load and initialize that texture.
    var textures = material.textureMaps;
    for (var mapName in textures) {
        var textureDef = textures[mapName];

        if (!viewerImpl.matman().loadTextureFromCache(model, material, textureDef, mapName)) {

            //Create the three.js texture object (with delay loaded image data)
            var texture = requestTexture(textureDef.uri, model,
                //capture map because it varies inside the loop
                function(textureDef) {
                    return function(tex) {

                        //NOTE: tex could be null here in case of load error.
                        if (tex) {
                            var units = svf.materials.scene.SceneUnit;
                            var anisotropy = viewerImpl.renderer() ? viewerImpl.renderer().getMaxAnisotropy() : 0;
                            var converter = textureDef.converter || MaterialConverter.convertTexture;
                            converter(textureDef, tex, units, anisotropy);
                        }

                        var matman = viewerImpl.matman();

                        //It's possible MaterialManager got destroyed before the texture loads
                        if (!matman)
                            return;

                        matman.setTextureInCache(model, textureDef, tex);

                        //Private API: Call a custom texture processing callback if one is supplied.
                        //This is used for texture processing in node.js tools.
                        //We are avoiding a more generic fireEvent mechanism in order to avoid publishing
                        //yet another event type.
                        if (svf.loadOptions.onTextureReceived) {
                            svf.loadOptions.onTextureReceived(matman, textureDef, tex, !requestsInProgress());
                        }

                        //Unfortunately we have to check for texture load complete here also, not just
                        //in the final call to loadTextures. This is because geometry load can complete
                        //before or after texture load completes.
                        if (!requestsInProgress() && viewerImpl && svf.loadDone && !svf.texLoadDone) {
                            svf.texLoadDone = true;
                            viewerImpl.onTextureLoadComplete(model);
                        }
                    };
                }(textureDef)
            );
        }
    }

}


/**
 * Loads all textures for a specific model.
 * Textures delayed until all geometry is loaded, hence not done in convertMaterials.
 */
function loadModelTextures(model, viewerImpl) {

    var matman = viewerImpl.matman();

    var hash = matman._getModelHash(model);


    //Set textureCount to enable texture resizing on mobile.
    //This is only really useful to determine texture budget when a single SVF
    //is to be loaded. It doesn't work at all if multiple models are to be loaded/unloaded
    //and the OTG loader doesn't ever pass through here, because it loads materials one by one.
    var textureCount = 0;

    if (model.isOTG()) {
        textureCount = model.getData().metadata.stats.num_textures || 0;
    } else {
        for (var p in matman._materials) {

            //Prevent textures for already loaded models from being loaded
            //again. Not elegant, and we can somehow only process the materials
            //per model.
            if (p.indexOf(hash) === -1)
                continue;

            var material = matman._materials[p];
            if (material.textureMaps) {
                textureCount += Object.keys(material.textureMaps).length;
            }
        }
    }

    setTextureCount(textureCount);


    for (var p in matman._materials) {

        //Prevent textures for already loaded models from being loaded
        //again. Not elegant, and we can somehow only process the materials
        //per model.
        if (p.indexOf(hash) === -1)
            continue;

        var material = matman._materials[p];
        loadMaterialTextures(model, material, viewerImpl);
    }


    //Model had no textures at all, call the completion callback immediately
    var svf = model.getData();
    if (!requestsInProgress() && viewerImpl && svf.loadDone && !svf.texLoadDone) {
        svf.texLoadDone = true;
        viewerImpl.onTextureLoadComplete(model);
    }
}


function loadCubeMap(path, exposure, onReady) {

    var texLoadDone = function(map) {

        if (map) {
            map.mapping = THREE.CubeReflectionMapping;
            map.LogLuv = path.indexOf("logluv") !== -1;
            map.RGBM = path.indexOf("rgbm") !== -1;

            // TODO: Turn on use of half-float textures for envmaps. Disable due to blackness on Safari.
            DecodeEnvMap(map, exposure, false /*isMobileDevice() ? false : this.viewer.glrenderer().supportsHalfFloatTextures()*/, onReady);
        } else {
            if (onReady) {
                onReady(map);
            }
        }

    };

    var cubeMap;

    THREE.ImageUtils.crossOrigin = '';

    if (Array.isArray(path)) {
        cubeMap = THREE.ImageUtils.loadTextureCube(path, THREE.CubeReflectionMapping, texLoadDone);
        cubeMap.format = THREE.RGBFormat;
    }
    else if (typeof path === "string") {
        if (path.toLowerCase().indexOf(".dds") !== -1) {
            cubeMap = new DDSLoader().load(path, texLoadDone);
            // The Texture.clone methods assumes mipmaps has been initialized and CompressedTexture doesnt set a default
            // value
            cubeMap.mipmaps = cubeMap.mipmaps || [];
        }
        else {
            cubeMap = loadTexture(path, THREE.SphericalReflectionMapping, onReady);
            cubeMap.format = THREE.RGBFormat;
        }
    } else if (path) {
        //here we assume path is already a texture object
        if (onReady) {
            onReady(path);
        }
    }
    else {
        if (onReady) {
            onReady(null);
        }
    }

    return cubeMap;
}


/**
 * Return the number of outstanding texture requests
 */
function requestsInProgress() {
    return _requestsInProgress;
}

/**
 * Set the max request count
 * @param count The maximum number of outstanding request that can be started in parallel.
 */
function setMaxRequest(count) {
    if (count > 0)
        _texQueue.max = count;
}

/**
 * Get the max request count
 */
function getMaxRequest() {
    return _texQueue.max;
}

/**
 * Set the texture memory limit
 * @param size The memory allowed for textures.
 */
function setMemoryLimit(size) {
    if (size > 0) {
        TEXTURE_MEMORY = size;
        setTextureCount(_textureCount);
    }
}

/**
 * Get the texture memory limit
 */
function getMemoryLimit() {
    return TEXTURE_MEMORY;
}

/**
 * Set the texture count. This is set by loadModelTextures
 * @param count The count of textures for model
 */
function setTextureCount(count) {
    if (count >= 0) {
        _textureCount = count;
        _textureSize = Math.max(16 * 1024, TEXTURE_MEMORY / (_textureCount * 4));
    }
}

/**
 * Get the texture count
 */
function getTextureCount() {
    return _textureCount;
}

// Calculate the memory used by a texture
function calculateTextureSize(tex) {
    var pixsize = 4;     // assume 4 byte pixels.
    switch (tex.format) {
    case THREE.AlphaFormat:
        pixsize = 1;
        break;
    case THREE.RGBFormat:
        pixsize = 3;
        break;
    case THREE.LuminanceFormat:
        pixsize = 1;
        break;
    case THREE.LuminanceAlphaFormat:
        pixsize = 2;
        break;
    }
    switch (tex.type) {
        case THREE.ShortType:
        case THREE.UnsignedShortType:
        case THREE.HalfFloatType:
            pixsize *= 2;
            break;
        case THREE.IntType:
        case THREE.UnsignedIntType:
        case THREE.FloatType:
            pixsize *= 4;
            break;
        case THREE.UnsignedShort4444Type:
        case THREE.UnsignedShort5551Type:
        case THREE.UnsignedShort565Type:
            pixsize = 2;
            break;
    }
    var rowsize = pixsize * tex.image.width;
    rowsize += tex.unpackAlignment - 1;
    rowsize -= rowsize % tex.unpackAlignment;
    return tex.image.height * rowsize;
}



export const TextureLoader = {
    loadTextureWithSecurity,
    loadMaterialTextures,
    loadModelTextures,
    loadCubeMap,
    requestsInProgress,
    calculateTextureSize,
    imageToCanvas
};
