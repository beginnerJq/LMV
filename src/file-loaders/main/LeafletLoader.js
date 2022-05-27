
"use strict";

import { ProgressState } from "../../application/ProgressState";
import { errorCodeString, ErrorCodes } from "../net/ErrorCodes";
import { logger } from "../../logger/Logger";
import { ViewingService } from "../net/Xhr";
import { ModelIteratorTexQuad } from "../../wgs/scene/leaflet/ModelIteratorTexQuad";
import { TexQuadConfig } from "../../wgs/scene/leaflet/ModelIteratorTexQuad";
import { TextureLoader } from "./TextureLoader";
import {FileLoaderManager} from "../../application/FileLoaderManager";
import { Model } from "../../application/Model";
import {initLoadContext} from "../net/endpoints";
import {isOffline} from "../net/endpoints";
import * as et from "../../application/EventTypes";
import * as THREE from "three";

const avp = Autodesk.Viewing.Private;

/** Loader for leaflet image pyramids and simple image files.
 *   @param {Viewer3DImpl} parent
 */
export function LeafletLoader(parent) {

    var _parent = parent;
    this.isLeafletLoader = true; // For QA only
    this.loading = false;

    // Parses a single file header of a zip file.
    //
    // @param {Array}         input                  input as bytes array of the entire zip file.
    // @param {Offset}        [options]              offset of the relevant file header.
    var parseFileHeader = function(input, offset) {

        var fileHeaderSignature = [0x50, 0x4b, 0x01, 0x02];
        var ip = offset;

        if (input[ip++] !== fileHeaderSignature[0] || input[ip++] !== fileHeaderSignature[1] || input[ip++] !== fileHeaderSignature[2] || input[ip++] !== fileHeaderSignature[3]) {
            logger.error('invalid file header signature');
            return null;
        }

        var fileHeader = {};

        // version made by
        fileHeader.version = input[ip++];

        // os version
        fileHeader.os = input[ip++];

        // version needed to extract
        fileHeader.needVersion = input[ip++] | (input[ip++] << 8);

        // general purpose bit flag
        fileHeader.flags = input[ip++] | (input[ip++] << 8);

        // compression method
        fileHeader.compression = input[ip++] | (input[ip++] << 8);

        // last mod file time
        fileHeader.time = input[ip++] | (input[ip++] << 8);

        //last mod file date
        fileHeader.date = input[ip++] | (input[ip++] << 8);

        // crc-32
        fileHeader.crc32 = ((input[ip++]) | (input[ip++] <<  8) | (input[ip++] << 16) | (input[ip++] << 24)) >>> 0;

        // compressed size
        fileHeader.compressedSize = ((input[ip++]) | (input[ip++] <<  8) | (input[ip++] << 16) | (input[ip++] << 24)) >>> 0;

        // uncompressed size
        fileHeader.plainSize = ((input[ip++]) | (input[ip++] <<  8) | (input[ip++] << 16) | (input[ip++] << 24)) >>> 0;

        // file name length
        fileHeader.fileNameLength = input[ip++] | (input[ip++] << 8);

        // extra field length
        fileHeader.extraFieldLength = input[ip++] | (input[ip++] << 8);

        // file comment length
        fileHeader.fileCommentLength = input[ip++] | (input[ip++] << 8);

        // disk number start
        fileHeader.diskNumberStart = input[ip++] | (input[ip++] << 8);

        // internal file attributes
        fileHeader.internalFileAttributes = input[ip++] | (input[ip++] << 8);

        // external file attributes
        fileHeader.externalFileAttributes = (input[ip++]) | (input[ip++] <<  8) | (input[ip++] << 16) | (input[ip++] << 24);

        // relative offset of local header
        fileHeader.relativeOffset = ((input[ip++]) | (input[ip++] <<  8) | (input[ip++] << 16) | (input[ip++] << 24)) >>> 0;

        // file name
        fileHeader.filename = String.fromCharCode.apply(null, input.slice(ip, ip += fileHeader.fileNameLength));

        // extra field
        fileHeader.extraField = input.slice(ip, ip += fileHeader.extraFieldLength);

        // file comment
        fileHeader.comment = input.slice(ip, ip + fileHeader.fileCommentLength);

        // length of the entry
        fileHeader.length = ip - offset;

        return fileHeader;
    };

    // Parses a single local file header of a zip file.
    //
    // @param {Array}         input                  input as bytes array of the local file header.
    var parseLocalFileHeader = function(input) {

        var localFileHeaderSignature = [0x50, 0x4b, 0x03, 0x04];
        var ip = 0;

        // local file header signature
        if (input[ip++] !== localFileHeaderSignature[0] || input[ip++] !== localFileHeaderSignature[1] || input[ip++] !== localFileHeaderSignature[2] || input[ip++] !== localFileHeaderSignature[3]) {
            logger.error('invalid local file header signature');
            return null;
        }

        var localFileHeader = {};

        // version needed to extract
        localFileHeader.needVersion = input[ip++] | (input[ip++] << 8);

        // general purpose bit flag
        localFileHeader.flags = input[ip++] | (input[ip++] << 8);

        // compression method
        localFileHeader.compression = input[ip++] | (input[ip++] << 8);

        // last mod file time
        localFileHeader.time = input[ip++] | (input[ip++] << 8);

        //last mod file date
        localFileHeader.date = input[ip++] | (input[ip++] << 8);

        // crc-32
        localFileHeader.crc32 = ((input[ip++]) | (input[ip++] <<  8) | (input[ip++] << 16) | (input[ip++] << 24)) >>> 0;

        // compressed size
        localFileHeader.compressedSize = ((input[ip++]) | (input[ip++] <<  8) |(input[ip++] << 16) | (input[ip++] << 24)) >>> 0;

        // uncompressed size
        localFileHeader.plainSize = ((input[ip++]) | (input[ip++] <<  8) | (input[ip++] << 16) | (input[ip++] << 24)) >>> 0;

        // file name length
        localFileHeader.fileNameLength = input[ip++] | (input[ip++] << 8);

        // extra field length
        localFileHeader.extraFieldLength = input[ip++] | (input[ip++] << 8);

        // file name
        localFileHeader.filename = String.fromCharCode.apply(null, input.slice(ip, ip += localFileHeader.fileNameLength));

        // extra field
        localFileHeader.extraField = input.slice(ip, ip += localFileHeader.extraFieldLength);

        localFileHeader.length = ip;

        return localFileHeader;
    };

    // Extracts the data from the local file header, given as a bytes array.
    //
    // @param {Array}         data                  input as bytes array of the local file header.
    var extractImage = function(data) {

        var localFileHeader = parseLocalFileHeader(data);
        if (!localFileHeader) {
            return null;
        }
        var imageOffset = localFileHeader.length;
        var imageLength = localFileHeader.compressedSize;
        var image = data.slice(imageOffset, imageOffset + imageLength);

        return image;
    };

    // Parses a zip's central directory, and returns a file table contains all the file headers.
    var parseCentralDirectory = function(input, centralDirOffset, centralDirEntriesNumber) {

        var ip = 0;
        var fileTable = {};
        var fileHeader, previousFileHeader = null;

        for (var i = 0; i < centralDirEntriesNumber; ++i) {
            fileHeader = parseFileHeader(input, ip);

            if (!fileHeader) {
                return null;
            }

            if (previousFileHeader) {
                previousFileHeader.contentSize = fileHeader.relativeOffset - previousFileHeader.relativeOffset;
            }

            ip += fileHeader.length;
            fileTable[fileHeader.filename] = fileHeader;

            previousFileHeader = fileHeader;
        }

        previousFileHeader.contentSize = centralDirOffset - previousFileHeader.relativeOffset;

        return fileTable;
    };

    var getCentralDirectory = function(urn, acmSessionId, offset, length, onSuccess, onError) {

        var queryParams = null;
        var options = {};

        // If the zip file is offline, get entire zip.
        // Else, the zip is online, so get only the central dir from the zip, using ranged request, supported by backend.
        if (!isOffline()) {
    
            if (acmSessionId) {
                queryParams = "acmsession=" + acmSessionId;
            }

            options.range = {
                min: offset,
                max: length + offset
            };
        }
        
        var loadContext = initLoadContext( { queryParams: queryParams } );

        ViewingService.getItem(loadContext, urn, onSuccess, onError, options);
    };

    this.continueLoadFile = function(path, options, onDone, onWorkerStart, config, textureLoader) {

        var self = this;
        
        var pattern;
        if (options.loadOptions?.loadFromZip) {
            var ext = options.loadOptions.mime.split('/')[1];
            pattern = '{z}/{x}_{y}.' + ext;
        } else {
            pattern = path;
        }

        config.initFromLoadOptions(pattern, options.loadOptions, textureLoader, options);

        var iter = null;

        //The Leaflet loader has no long running worker thread initialization,
        //so we can call back the viewer to continue its renderer initialization.
        if (onWorkerStart)
            onWorkerStart();

        //The code below requires the renderer (and the materials manager in particular)
        //to exist, which happens when we call back onWorkerStart above.
        function onLoad() {
            // Create ModelData. Will be returned when calling model.getData() on the data model
            function LeafletModelData(loadOptions) {
                // used by Viewer3DImpl for initial camera adjustment     
                this.bbox     = new THREE.Box3();

                this.basePath = path;

                // run viewer in 2D mode
                this.is2d = true;

                this.urn = options.bubbleNode?.getRootNode().urn();

                // get paper extent. If not specified in the load options, use the texture resolution so that
                // measurement works in pixels
                var paperWidth  = (loadOptions && loadOptions.paperWidth >=0.0) ? loadOptions.paperWidth  : config.texWidth;
                var paperHeight = (loadOptions && loadOptions.paperHeight>=0.0) ? loadOptions.paperHeight : config.texHeight;

                // transform for measurement tools
                this.pageToModelTransform = config.getPageToModelTransform(paperWidth, paperHeight);

                // make page dimensions available to viewer and tools. We store this in an own object metadata.page_dimensions.
                // This is done for consistency with F2D, so that functions like Model.getMetaData() and Model.getDisplayUnits() can use it.
                this.metadata = {};
                this.metadata.page_dimensions = {};
                var pd = this.metadata.page_dimensions;
                pd.page_width  = paperWidth;
                pd.page_height = paperHeight;
                pd.page_units  = loadOptions && loadOptions.paperUnits;

                // signal that the model is ready to use, e.g., to do measurements
                this.loadDone = true;
                this.isLeaflet = true;
                _parent.signalProgress(100, ProgressState.LOADING);

                // Note: When just loading images, we don't know texWidth at this point, but must
                //       wait for the texture. Therefore, the zoomIn constraint is currently only applied
                //       if we know the size in advance.
                if (config.texWidth > 0) {
                    // store hint to restrict zoom-in when we reach max resolution.
                    this.maxPixelPerUnit = config.texWidth / config.getQuadWidth();

                    // For simple images the image width might be too low of a value to limit zoom-in,
                    // so as a purely heuristic value, allow 10 times that value
                    if (config.isSimpleImage) {
                        this.maxPixelPerUnit *= 10;
                    }
                }
            }

            if (!self.loading) {
                onDone({ code: ErrorCodes.LOAD_CANCELED, msg: 'Load canceled'}, null);
                return;
            }

            var modelData = new LeafletModelData(options.loadOptions);
            // To be consistent with other loaders and expected by some code setions,
            // save loadOptions to the model data.
            modelData.loadOptions = options;

            // bbox without transforms.
            modelData.bbox.copy(config.getBBox());
            modelData.modelSpaceBBox = modelData.bbox.clone();

            if (options.placementTransform) {
                modelData.placementTransform = options.placementTransform.clone();
                modelData.placementWithOffset = options.placementTransform.clone();
                modelData.bbox.applyMatrix4(options.placementTransform);
            }

            // Create RenderModel with texQuad iterator
            var model = new Model(modelData);
            model.initFromCustomIterator(iter);
            model.loader = self;

            _parent.api.dispatchEvent({type:et.MODEL_ROOT_LOADED_EVENT, svf: modelData, model: model});

            // Track loading time
            iter.callWhenRefined(function() {
                var t1 = Date.now();
                modelData.loadTime = t1 - self.t0;
                logger.log("SVF load: " + modelData.loadTime); // Use SVF to make output consistent with other loaders

                avp.analytics.track('viewer.model.loaded', {
                    load_time: modelData.loadTime,
                    total_raster_pixels: modelData.loadOptions.bubbleNode?.data?.totalRasterPixels,
                    viewable_type: '2d',
                });
            });

            onDone(null, model);
            self.loading = false;

            return model.id;
        }

        // if we have no leaflet params, handle it as a single image
        var isSimpleImage = !config.valid();
        if (isSimpleImage) {
            // when displaying a single image, we don't know the extents in advance.
            // But we need them to determine the bbox for the initial camera placement.
            // Therefore, we defer the loading for this case until the image is loaded.
            // The image dimensions are then derived from the image file.
            config.initForSimpleImage(path);
        }

        config.onRootLoaded = onLoad;

        config.onDone = onDone;

        // Set pixel ratio to the same values as used by WebGLRenderer. In this way, we make full
        // use of the available render target resolution.
        config.getPixelRatio = _parent.glrenderer().getPixelRatio;
        config.maxAnisotropy = _parent.glrenderer().getMaxAnisotropy();

        config.placementTransform = options.placementTransform;

        // create iterator 
        iter = new ModelIteratorTexQuad(config, _parent.getMaterials());

        // Root tile is always needed
        iter.requestRootTile();
    };

    /** 
     * @callback LoadSuccessCB
     *   @param {RenderModel}
     *
     * @callback LoadErrorCB
     *   @param {number} errorCode
     *   @param {string} errorMsg
     *   @param {number} statusCode
     *   @param {string} statusText
     */

     /*
     * @param {string}        path
     * @param {Object}        [options]              Dictionary with options parsed from query string. 
     * @para  {Object}        [options.loadOptions]  For leaflets, this must contain additional params like tileSize, texWidth etc. (see TexQuadConfig.initFromLoadOptions)
     * @param {number}        [options.acmSessionId] Required when requesting non-public image files. 
     * @param {LoadDoneCB}    onDone 
     */
    this.loadFile = function(path, options, onDone, onWorkerStart) {
        if (this.loading) {
            logger.log("Loading of Leaflet already in progress. Ignoring new request.");
            return false;
        }

        var self = this;

        this.options = options;
        this.t0 = Date.now();

        // get leaflet params from loader options. Note that it's no error if we don't find them,
        // because simple image files can be loaded without any extra options
        var config = new TexQuadConfig();

        var textureLoader = null;
        var acmSessionId = options.acmSessionId;

        if (options.loadOptions && options.loadOptions.loadFromZip) {

            textureLoader = function(imageURL, onSuccess, onError) {
                var currZip;
                var level = imageURL.split('/')[0] - config.levelOffset;

                // Find the relevant zip by the tile's level.
                for (var i = 0; i < config.zips.length; i++) {
                    if (level <= config.zips[i].zipMaxLevel) {
                        currZip = config.zips[i];
                        break;
                    }
                }

                if (!currZip) {
                    onError('Failed loading texture - tile\'s level doesn\'t exists.');
                    return false;
                }

                var fileHeader = currZip.fileTable[imageURL];

                if (!fileHeader) {
                    onError('Failed loading texture - entry does not exist inside fileTable.');
                    return false;
                }

                var options = { extractImage: extractImage };

                var start = fileHeader.relativeOffset;
                var end = fileHeader.relativeOffset + fileHeader.contentSize;

                // In case we already have the entire zip's raw data - we don't need to request the texture from the server.
                // Just load the texture's bytes from rawData.
                if (currZip.rawData) {
                    options.rawData = currZip.rawData.slice(start, end);
                } else {
                    options.range = {
                        min: start,
                        max: end
                    };
                }

                TextureLoader.loadTextureWithSecurity(currZip.urnZip, THREE.UVMapping, onSuccess, onError, acmSessionId, true, options);
            };

            var areAllZipsParsed = function() {
                return options.loadOptions.zips.every(function(zip) { return Object.keys(zip.fileTable).length > 0; });
            };

            options.loadOptions.zips.forEach(function(currZip) {
                // Load the central directory from the zip
                var centralDirOffset = currZip.centralDirOffset;
                var centralDirLength = currZip.centralDirLength;
                var numOfEntries = currZip.centralDirEntries;

                var onGetContentSuccess = function(rawBuffer) {
                    if (isOffline()) {
                        currZip.rawData = rawBuffer;    
                        rawBuffer = rawBuffer.slice(centralDirOffset, centralDirOffset + centralDirLength);
                    }

                    var fileTable = parseCentralDirectory(rawBuffer, centralDirOffset, numOfEntries);
                    
                    if (!fileTable) {
                        onDone('Failed parsing central directory of the zip.', null);
                        return false;
                    }

                    currZip.fileTable = fileTable;

                    if (areAllZipsParsed()) {
                        self.continueLoadFile(path, options, onDone, onWorkerStart, config, textureLoader);
                    }
                };

                var onGetContentError = function(error) {
                    logger.error('Zip download failed: ' + error.statusText, errorCodeString(ErrorCodes.NETWORK_FAILURE));
                    onDone('Zip download failed: ' + error.statusText, null);
                };

                getCentralDirectory(currZip.urnZip, acmSessionId, centralDirOffset, centralDirLength, onGetContentSuccess, onGetContentError);
            });

        } else {
            textureLoader = function(imageURL, onSuccess, onError) {
                TextureLoader.loadTextureWithSecurity(imageURL, THREE.UVMapping, onSuccess, onError, acmSessionId, true);
            };

            this.continueLoadFile(path, options, onDone, onWorkerStart, config, textureLoader);
        }

        // Mark it as loading now.
        this.loading = true;

        return true;
    };

    
    this.dtor = function() {
        this.loading = false;
    };
}

LeafletLoader.prototype.is3d = function() {
    return false;
};

LeafletLoader.prototype.isPageCoordinates = function () {
    return !!this.options?.loadOptions?.fitPaperSize;
};

FileLoaderManager.registerFileLoader("Leaflet", ["jpeg", "jpg", "png"], LeafletLoader);

