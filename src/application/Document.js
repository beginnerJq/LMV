

import { BubbleNode } from "./bubble";
import { ErrorCodes, getErrorCode } from "../file-loaders/net/ErrorCodes";
import { endpoint, isOffline, getOfflineResourcePrefix, getEnv, setEnv } from "../file-loaders/net/endpoints";
import { ViewingService } from "../file-loaders/net/Xhr";
import { isMobileDevice, getGlobal } from "../compat";
import { logger } from "../logger/Logger";
import {EnvironmentConfigurations, refreshRequestHeader, token, getUpstreamApiData} from "../envinit";
import { getParameterByName, fromUrlSafeBase64 } from "../globals";


var global = getGlobal();
var _window = global;

/**
 * Allows the client to load the model data from the cloud, it
 * gives access to the root and provides a method for finding elements
 * by id.
 *
 * Typically, you load the document from Forge, parse it for
 * the required content (for example, 3d geometries), then pass this on to
 * the viewer to display.  You can also get some information about the document,
 * such as the number of views it contains and its thumbnail image.
 * 
 * @see {Autodesk.Viewing.BubbleNode}
 *
 * @class
 * @memberof Autodesk.Viewing
 * @alias Autodesk.Viewing.Document
 * @param {object} dataJSON - JSON data representing the document.
 * @param {string} path - Path/URL where dataJSON was fetched from.
 * @param {string} [acmsession=undefined] - ACM session ID.
 */
export function Document( dataJSON, path, acmsession )
{
    this.myPath = path;
    this.myData = dataJSON;

    if (dataJSON) {
        this.docRoot = new BubbleNode(dataJSON);
        this.docRoot.setDocument(this);
    }

    this.myNumViews = {};
    this.acmSessionId = acmsession;

    // Search bubble for type="view" role="3d" children of type="geometry" role="3d" items.
    // Add count of view-3d items to parent geometry-3d items.
    // Collect geometry items of camera view items referenced by guid.
    //
    var self = this;

    this.docRoot.traverse(function(node) {
        if (node.isViewPreset()) {
            const geometryItem = node.findParentGeom2Dor3D();
            if (geometryItem) {
                let viewCount = self.myNumViews[geometryItem.guid()] || 0;
                self.myNumViews[geometryItem.guid()] = viewCount + 1;
            }
        }
    });

    //This check should probably happen before we traverse the manifest to look
    //for views. However, for this to happen, all the unit tests that use fragments of
    //manifests (which are not valid by themselves) need to be rewritten to work using valid
    //manifests as test data.
    var viewables = this.docRoot.findAllViewables();
    if (viewables.length === 0) {
        logger.error("Document contains no viewables.");
    }
}

/**
 * Invoked after fetching a JSON manifest from Forge.
 * 
 * @callback Autodesk.Viewing.Document~loadSuccessCallback
 * @param {Autodesk.Viewing.Document} doc - Instance that wraps the Forge JSON response.
 */

/**
 * Invoked after failing to fetch a JSON manifest from Forge.
 * @callback Autodesk.Viewing.Document~loadErrorCallback
 * @param {number} errorCode - A numerical error code.
 * @param {string} errorMessage - A localized error message.
 */

/**
 * Static method to load the translation's manifest data from a Forge endpoint.
 * 
 * @example
 *   Autodesk.Viewing.Document.load( 
 *      MY_URN, 
 *      function onSuccessCallback(doc){
 *          var bubbleRoot = doc.getRoot();
 *          console.log(bubbleRoot);
 *          // proceed to load a viewable into the Viewer...
 *      },
 *      function onErrorCallback(errCode, errMsg){
 *          console.error('Failed to load manifest [' + errCode + '] ' + errMsg);
 *      }
 *   )
 *
 * @param {string} documentId - The URN of the file.
 * @param {Autodesk.Viewing.Document~loadSuccessCallback} onSuccessCallback - A function that is called when load succeeds.
 * @param {Autodesk.Viewing.Document~loadErrorCallback} onErrorCallback - A function that is called when load fails.
 * @x-param {object} [accessControlProperties] - An optional list of key value pairs as access control properties,
 * which includes a list of access control header name and values, and an OAuth 2.0 access token.
 * @param {object} [options] - An optional object that allows configuring manually the manifest request attributes - such as headers, endpoint etc.
 * 
 * @see {Autodesk.Viewing.BubbleNode}
 * @see {Autodesk.Viewing.Viewer3D}
 * @static
 * @alias Autodesk.Viewing.Document.load
 */
Document.load = function( documentId, onSuccessCallback, onErrorCallback, accessControlProperties, options = {} )
{
    var documentPath = Document.getDocumentPath(documentId);
    var acmsession; //set by doLoad below
    var messages;

    function urnMatches(patterns) {
        var urn = documentId.split(':');
        urn = urn[1];
        var decodedUrn = fromUrlSafeBase64(urn);

        for (let i=0; i<patterns.length; i++) {
            if (decodedUrn.indexOf(patterns[i]) > -1) {
                return true;
            }
        }
        return false;
    }

    const euPatterns = ['urn:adsk.wipemea', 'urn:adsk.wipbimemea'];
    if (documentId.startsWith('urn') && urnMatches(euPatterns)) {
        var api = endpoint.getApiFlavor();
        var env = getEnv();
        var isDSv2 = api === endpoint.ENDPOINT_API_DERIVATIVE_SERVICE_V2 && !env.endsWith('EU');
        var isD3S = env.endsWith('US') && api === endpoint.ENDPOINT_API_D3S;
        var isStreamingV2 = api === endpoint.ENDPOINT_API_DERIVATIVE_STREAMING && !api.endsWith('_EU');
        api += '_EU';
        if (isDSv2) {
            endpoint.setEndpointAndApi(null, api);
        } else if (isD3S) {
            env = env.replace("US", "EU");
            setEnv(env);
            var config = EnvironmentConfigurations[env];
            endpoint.setEndpointAndApi(config['ROOT'], api);
        } else if (isStreamingV2) {
            endpoint.setEndpointAndApi(null, api);
        }
    }

    function onSuccess(data) {

        if (endpoint.isSVF2Backend() || endpoint.isOtgBackend()) {
            //Fluent endpoint uses the original manifest URN as acm session, so we expand the
            //acmsession query parameter with the added fluent server piece.
            //This is because some manifests are "shallow copies" of other
            //manifests, and the URN is used to auhtorize access to the storage context
            //of the source data. Setting an acmsession for Fluent data is
            //only needed in case of shallow copy urns.
            if (acmsession)
                acmsession = data.urn + "," + acmsession;
            else
                acmsession = data.urn;
        }

        var lmvDocument = new Document(data, documentPath, acmsession);

        //TODO: avoid using this function to detect if there are viewables, the Document
        //should have already traversed the bubble and know the number of geom nodes
        var viewableCount = lmvDocument.getRoot().search({'type':'geometry'}).length;

        // Check if there are any viewables.
        if (viewableCount > 0) {
            messages = lmvDocument.getGlobalMessages();
            if (onSuccessCallback) {
                onSuccessCallback(lmvDocument, messages);
            }
        }
        else {
            // If there are no viewables, report an error.
            //
            if (onErrorCallback) {
                messages = lmvDocument.getGlobalMessages();
                var errorCode =  ErrorCodes.BAD_DATA_NO_VIEWABLE_CONTENT;
                var errorMsg  = "No viewable content";
                onErrorCallback(errorCode, errorMsg, messages);
            }
        }
    }

    function onFailure(statusCode, statusText, data) {

        // If unauthorized and the first call for loading, will suppose third-party
        // cookies are disabled, and load again with token in request header.
        if (statusCode === 401 && global.LMV_THIRD_PARTY_COOKIE === undefined) {
            global.LMV_THIRD_PARTY_COOKIE = false;
            refreshRequestHeader(token.accessToken);
            doLoad();
        }
        else {
            if (onErrorCallback) {
                var errorMsg = "Error: " + statusCode + " (" + statusText + ")";
                var errorCode = getErrorCode(statusCode);
                onErrorCallback(errorCode, errorMsg, statusCode, statusText, data);
            }
        }
    }

    function doLoad() {

        //If no explicit scopes are given, we can skip the acmession request,
        //because the OTG server knows how to add the simple acm headers automatically.
        //This saves a half second from the initial blank screen when loading a model.
        var canSkipAcmSession = !accessControlProperties || ((endpoint.isSVF2Backend() || endpoint.isOtgBackend()) && !accessControlProperties["x-ads-acm-scopes"]);
        if (!acmsession && !canSkipAcmSession) {

            if (!accessControlProperties.oauth2AccessToken)
                accessControlProperties.oauth2AccessToken = token.accessToken;

            ViewingService.getACMSession(endpoint.getApiEndpoint(), accessControlProperties, function(in_acmsession) {
                acmsession = in_acmsession;
                options.queryParams = acmsession ? "acmsession=" + acmsession : "";
                endpoint.setAcmSession(acmsession);
                ViewingService.getManifest(endpoint.initLoadContext(options), documentPath, onSuccess, onFailure);
            }, onErrorCallback);
        } else {
            ViewingService.getManifest(endpoint.initLoadContext(options), documentPath, onSuccess, onFailure);
        }
    }

    doLoad();
};

/**
 * @private
 */
Document.getDocumentPath = function(urn)
{
    // Handle local paths explicitly.
    //
    if(urn.indexOf('urn:') === -1) {

        //Absolute URL
        if (urn.indexOf("://") !== -1)
            return urn;

        var relativePath = urn;

        if (typeof window !== "undefined") {
            if(relativePath.indexOf('/') !== 0)
                relativePath = '/' + relativePath;
            return _window.location.protocol + "//" + _window.location.host + relativePath;
        } else {
            return relativePath;
        }
    }
    return urn;
};

/**
 * This function is only used when Authorization is through Bearer token; aka when cookies are disabled.
 * @param {string} data - See {@link Autodesk.Viewing.Document#getThumbnailOptions}.
 * @param {function} onComplete - Node style callback function `callback(err, response)`.
 */
Document.requestThumbnailWithSecurity = function(data, onComplete) {

    var onSuccess = function(response){
        onComplete(null, response);
    };
    var onFailure = function(){
        onComplete('error', null);
    };

    var options = {
        responseType: 'blob',
        skipAssetCallback: true,
        size: data.width, //Ignore the height, they are the same.
        guid: data.guid,
        acmsession: data.acmsession
    };

    var urlpath = "urn:" + data.urn; //HACK: Adding urn: makes the ViewingServiceXhr accept this as a viewing service request.
    
    var endpointUrl = undefined;

    if (!getGlobal().USE_OTG_DS_PROXY) {
        var envName = getEnv();
        endpointUrl = EnvironmentConfigurations[envName].UPSTREAM;
        const upstreamApiData = getUpstreamApiData(envName, endpoint.getApiFlavor());
        options.apiData = upstreamApiData;
    }

    ViewingService.getThumbnail(endpoint.initLoadContext({ endpoint: endpointUrl }), urlpath, onSuccess, onFailure, options);
};


Document.prototype.getAcmSessionId = function(urn) {
   return Document.getAcmSessionId(urn, this.acmSessionId);
};

/**
* @static
 */
Document.getAcmSessionId = function(urn, acmSessionId) {

    if (!urn) {
        return "";
    }

    let isFluentUrn = (urn.indexOf("urn:adsk.fluent") >= 0);
    //It's a DS resource URN (not OTG URN) -- acmSession is different depending
    //on whether we request through the DS directly or via OTG proxy.
    if (!getGlobal().USE_OTG_DS_PROXY && !isFluentUrn && (endpoint.isSVF2Backend() || endpoint.isOtgBackend())) {
        //See also how the acmSession is constructed above in Document.load().
        //This extracts the DS part of the acmsession from the combined OTG+DS acmsession.
        return acmSessionId.split(",")[1] || "";
    } else {
        return acmSessionId;
    }
};

/**
 * Returns the full path to the given URN.
 * 
 * @param {string} urn - URN of the document.
 * @returns {string}
 */
Document.prototype.getFullPath = function(urn)
{

    if (!urn)
        return urn;

    var fullPath = urn;

    if (isOffline()) {
      // If offline resource prefix is already added to path, then no need to add again.
      if (fullPath.indexOf(getOfflineResourcePrefix()) == -1) {
          fullPath = decodeURIComponent(getOfflineResourcePrefix()) + fullPath.substr(fullPath.indexOf('/'));
      }
    } else if(urn.indexOf('urn') === 0) {

        let isFluentUrn = (urn.indexOf("urn:adsk.fluent") === 0);
        //It's a DS resource URN (not OTG URN) but we are requesting it through
        //the OTG caching proxy, we have to construct the path explicitly
        if (!isFluentUrn && (endpoint.isSVF2Backend() || endpoint.isOtgBackend())) {

            //If LMV is configured with the Fluent endpoint by default,
            //we have to explicitly initialize a DS /items API URL instead of relying on the
            //built in logic.

            const envName = getEnv();
            const envConfig = EnvironmentConfigurations[envName];

            //Two options here --
            //(1) we can use the fluent OTG server as caching proxy for Derivative Service or
            //(2) we can redirect to Derivative Service itself.
            //The only reason to support option 2 is because we are seeing very slow access times
            //from China and we don't want to regress performance there. For Design Collaboration, we
            //stick to option (1), which is enabled by USE_OTG_DS_PROXY. For Docs and Forge we use the redirection.
            const _endpoint = getGlobal().USE_OTG_DS_PROXY ? null : envConfig.UPSTREAM;

            const upstreamApiData = getUpstreamApiData(envName, endpoint.getApiFlavor());
            fullPath = endpoint.getItemApi(_endpoint, urn, upstreamApiData);
        } else {
            fullPath = endpoint.getItemApi(null, urn);
            // The getItemApi encodes the derivative urn for the modelDerivativeV2 API.
            // Xhr.js will do a second encoding which will make the url invalid.
            // Thus, we are decoding the fullPath only for the modelDerivativeV2 endpoint
            if (endpoint.ENDPOINT_API_MODEL_DERIVATIVE_V2 === endpoint.getApiFlavor()) {
                fullPath = decodeURIComponent(fullPath);
            }
        }
    }
    // Handle local bubble files.
    //
    else if(urn.indexOf('$file$') === 0) {
        fullPath = this.myPath.replace('/bubble.json', urn.replace('$file$', ''));
    }
    return fullPath;
};

/**
 * Returns a plain object with properties used to fetch a thumbnail image.
 * 
 * @param {object} item
 * @param {number} [width=200]
 * @param {number} [height=200]
 * @returns {object} `{urn: string, width: number, height: number, guid: string, acmsession: (string)}`
 */
Document.prototype.getThumbnailOptions = function(item, width, height) {
    var requestedWidth = width ? width : 200;
    var requestedHeight = height ? height : 200;
    var urn = item.urn || this.myData.urn;

    return {
        urn,
        width: requestedWidth,
        height: requestedHeight,
        guid: item.guid,
        acmsession: this.getAcmSessionId(urn)
    };
};

/**
 * Returns the path to the thumbnail of the item with the given ID.
 * @param {string} item - Document item.
 * @param {int} [width=200] - The requested thumbnail width.
 * @param {int} [height=200] - The requested thumbnail height.
 * @returns {string}
 */
Document.prototype.getThumbnailPath = function(item, width, height)
{
    var data = this.getThumbnailOptions(item, width, height);
    var ret = endpoint.getThumbnailApi(null, data.urn) +
        "?width=" + data.width +
        "&height=" + data.height;

    if (data.guid) {
        ret += "&guid=" + data.guid;
    }

    if (data.acmsession) {
        ret += "&acmsession=" + data.acmsession;
    }

    // Add window origin as additional param. This avoids a server-side caching problem when switching between different LMV deployments
    // (e.g. local and staging deploy). Without the domain param, the server caches the request response (which is fine), but also the 
    // 'Access-Control-Allow-Origin' of the response (which isn't). As a consequence, when requesting the same thumbnail from different origins,
    // the response of the second request is rejected by a cors error:
    // 'Access to image has been blocked by CORS policy: The 'Access-Control-Allow-Origin' header has a value 'https://local-dcs.b360-staging.autodesk.com' that is not equal to the supplied origin.
    // Adding the domain param avoids this problem.
    var domainParam = endpoint.getQueryParams();
    if (domainParam) {
        ret += "&" + domainParam;
    }

    return ret;
};

Document.prototype.getLeafletZipParams = function(outLoadOptions, geomItem) {
    var leafletZipItem = geomItem.search({'role': 'leaflet-zip'}, false);

    var currentZip;
    var zipParams;

    for (var i = 0; i < leafletZipItem.length; i++) {
        zipParams = {};
        currentZip = leafletZipItem[i]._raw();

        var urn = currentZip.urn;

        zipParams.urnZip = this.getFullPath(urn);
        zipParams.centralDirOffset = currentZip.central_dir_offset;
        zipParams.centralDirLength = currentZip.central_dir_length;
        zipParams.centralDirEntries = currentZip.central_dir_entries;
        zipParams.zipMaxLevel = currentZip.max_level - outLoadOptions.levelOffset;
        zipParams.loadFromZip = !!(zipParams.urnZip && zipParams.centralDirOffset && zipParams.centralDirLength && zipParams.centralDirEntries);
        zipParams.fileTable = {};

        if (!outLoadOptions.zips) {
            outLoadOptions.zips = [];
        }

        outLoadOptions.zips.push(zipParams);
    }

    outLoadOptions.zips.sort(function(a, b) {
        return a.zipMaxLevel - b.zipMaxLevel;
    });
};

/**
 * Extracts leaflet loader params from an item (if any).
 * @param {object} outLoadOptions - Extracted params are stored in this object.
 * @param {BubbleNode} geomItem - Geometry item with role '2d' that contains
 * the leaflet resource item.
 * @param {object} leafletItem - The resource item with role 'leaflet' that
 * contains the tile url pattern and some other params.
 */
Document.prototype.getLeafletParams = function(outLoadOptions, geomItem, leafletItem) {

    outLoadOptions.tileSize    = leafletItem.tileSize ?  leafletItem.tileSize : 512; // currently, bubbles use a fixed tile size of 512.
    outLoadOptions.texWidth    = leafletItem.resolution[0];
    outLoadOptions.texHeight   = leafletItem.resolution[1];
    outLoadOptions.paperWidth  = leafletItem.paperWidth;
    outLoadOptions.paperHeight = leafletItem.paperHeight;
    outLoadOptions.paperUnits  = leafletItem.paperUnits;
    outLoadOptions.urlPattern  = leafletItem.urn;
    outLoadOptions.mime  = leafletItem.mime;
    outLoadOptions.isLeaflet  = true;

    // For standard leaflet hierarchies, the root level 0 is the only one with only one tile,
    // i.e., there are already 2-4 tiles at level 1.
    // In contrast, the hierarchies produced by cloud translation start at a root resolution of 1x1,
    // thus containing several levels that we have to skip. The number of skipped levels is controlled
    // by the 'levelOffset' parameter.
    // The level offset that we need for a hierarchy with a root resolution of 1x1 resolution depends
    // on the tileSize and is computed by this function,
    function computeLevelOffset(tileSize) {

        // when reaching this, we abort the loop, because there is something strange
        // with the tileSize parameter.
        var MaxCycles = 20;

        var pixelSize = 1;
        var level     = 0;
        for (var i=0; i<MaxCycles; i++) {
            // will the next level still fit into a single tile?
            pixelSize *= 2;

            // if no, stop here
            if (pixelSize > tileSize) {
                return level;
            }
            level++;
        }

        logger.log("unexpected leaflet tileSize");
        return 0;
    }

    // hierarchies produced by cloud translation service start with a 1x1 miplevel at the root.
    // therefore, we have to skip some levels.
    outLoadOptions.levelOffset = computeLevelOffset(outLoadOptions.tileSize);

    this.getLeafletZipParams(outLoadOptions, geomItem);

    outLoadOptions.loadFromZip = outLoadOptions.zips && outLoadOptions.zips[0].loadFromZip;

    // By default, the number of hierarchy levels is computed automatically from texWidth/texHeight.
    // (see computeMaxLevel() in ModelIteratorTexQuad.js). However, the leaflet item also
    // contains a maxLevel value, which is usually smaller than the computed one. The purpose
    // of this value is to specify the (reduced) number of levels that we use when viewing
    // the leaflet in offline mode on mobile devices. Otherwise, we let maxLevel undefined, so
    // that the full resolution is used.
    if (outLoadOptions.zips && isOffline() && isMobileDevice()) {
        // maxLevel is stored in another resource item that references a zip-file with the tile-images.
        // the max_level value includes several levels with just one tile (1x1, 2x2, ...) which we skip.

        // Currently for mobile devices in offline mode, we assume they download only the first zip, 
        // due to data consumption and download time. 
        // If it will change, we don't need to slice the zips array, and need to change zips[0] to zips[zips.length-1].

        // Keep only first zip
        outLoadOptions.zips = outLoadOptions.zips.slice(0,1);
        outLoadOptions.maxLevel = outLoadOptions.zips[0].zipMaxLevel;
    }
};

//Magic manual way of getting to the PDF for old URNs that don't have the 1:1 page PDF generated
Document.prototype.derivePdfUrnHack = function(bubbleNode, outLoadOptions) {

        //Temporary hack for obtaining the sharding key, until we have a generic way of getting the
        //sharding key for the intermediate PDF from the manifest

        var allSheets = bubbleNode.parent.children.slice();

        allSheets.sort((a, b) => {
            return a._raw().order - b._raw().order;
        });

        let PDF_BATCH_SIZE = 75;
        let lastSheet;

        if (allSheets.length <= PDF_BATCH_SIZE) {
            //Fewer than 75 sheets, the last page will hold the sharding prefix
            //used by the split PDF worker (because it also processes the last PDF job after splitting)
            lastSheet = allSheets[allSheets.length-1];
        } else {
            lastSheet = allSheets[74];
        }

        //Find an F2d node with a URN in the manifest node that has the right sharding prefix
        let items = lastSheet.search(BubbleNode.GEOMETRY_F2D_NODE);
        let item = items[0];
        if (item) {
            //slice and dice the url
            var idx = item.urn().indexOf("/");
            var urnPrefix = item.urn().slice(0, idx);

            var order = bubbleNode._raw().order;
            var fileName = 0 | (order % PDF_BATCH_SIZE);
            var page = (0 | (order / PDF_BATCH_SIZE)) + 1;
            var pdfUrn = urnPrefix + `/output/${fileName}/${fileName}.pdf`;

            outLoadOptions.page = page;
            outLoadOptions.isPdf = true;

            console.log("pdf path", pdfUrn);

            return pdfUrn;
        }

        return null;
};

/**
 * Returns the relative path to the viewable of the given item.
 * @param {object} item - The item whose viewable is requested.
 * @param {object} outLoadOptions - Output param: used to store some additional loader options.
 * Needed to extract leaflet params from a bubble item.
 * @returns {string}
 */
Document.prototype.getViewableUrn = function(item, outLoadOptions)
{
    // Operate with a bubbleNode
    let bubbleNode;
    if (item instanceof BubbleNode) {
        bubbleNode = item;
    } else {
        // Find it
        let results = this.docRoot.search(item);
        if (results.length > 0) {
            bubbleNode = results[0];
        } else {
            bubbleNode = new BubbleNode(item);
        }
    }

    const getF2DUrn = () => {
        const itemsF2D = bubbleNode.search(BubbleNode.GEOMETRY_F2D_NODE);
        if (itemsF2D.length)
            return itemsF2D[0].urn();
    };

    const getImageUrn = () => {
        const itemsImage = bubbleNode.search(BubbleNode.IMAGE_NODE);
        if (itemsImage.length)
            return itemsImage[0].urn();
    };

    const getPdfUrn = () => {
        if (bubbleNode.isRevitPdf()) {
            // For Revit PDF, prefer F2D if it was made available during extraction
            const f2dUrn = getF2DUrn();
            if (f2dUrn) {
                return f2dUrn;
            }
        }
        // If the PDF has fewer than some number of image pixels,
        // use the vector renderer, otherwise use the Leaflet renderer.
        const USE_VECTOR_CUTOFF_PIXELS = 1<<21;

        // Get number of pixels while being aware that older manifests do not have this property.
        var numPixels = bubbleNode.data.totalRasterPixels;
        if (typeof numPixels !== "number")
            numPixels = Infinity; //NOTE: Not 0, because we want to fall back to raster in this case.

        var useVectorPdf = (numPixels < USE_VECTOR_CUTOFF_PIXELS);

        // For the initial testing period, allow overriding the
        // automatically chosen renderer in either direction.
        var useVectorPdfOverride =
            getParameterByName('vectorPdf') === 'true' ||
            getGlobal().LMV_VECTOR_PDF ||
            (this.myData && this.myData.isVectorPDF) ||
            !!bubbleNode.data.isVectorPDF;
        var useRasterPdfOverride = (getParameterByName("vectorPdf") === "false" || getGlobal().LMV_RASTER_PDF);
        if (useVectorPdfOverride)
            useVectorPdf = true;
        else if (useRasterPdfOverride)
            useVectorPdf = false;

        // Check for a leaflet or pdf page resource
        var itemsPdfPage = bubbleNode.search(BubbleNode.PDF_PAGE_NODE);
        var itemsLeaflet = bubbleNode.search(BubbleNode.LEAFLET_NODE);

        // Fill outLoadOptions with leaflet params too, in order to support Leaflet overlay on top of the Vector-PDF.
        if (useVectorPdf && itemsLeaflet.length > 0 && outLoadOptions) {
            this.getLeafletParams(outLoadOptions, bubbleNode, itemsLeaflet[0]._raw());
            outLoadOptions.tempRasterPath = itemsLeaflet[0].urn();
        }
        
        if (useVectorPdf && itemsPdfPage.length) {
            if(outLoadOptions) {
                outLoadOptions.isPdf = true;
                // Let the bubble node define the page number
                outLoadOptions.page = itemsPdfPage[0].data.page || 1;
            }
            return itemsPdfPage[0].urn();
        }

        // Found one? => extract its params
        if (itemsLeaflet.length > 0 && outLoadOptions) {

            // If the manual PDF override is set, also try the old way (to be removed at a later date once
            // the official way is in production)
            if (useVectorPdfOverride) {
                var pdfPath = this.derivePdfUrnHack(bubbleNode, outLoadOptions);

                if (pdfPath) {
                    return pdfPath;
                }
            }

            this.getLeafletParams(outLoadOptions, bubbleNode, itemsLeaflet[0]._raw());

            return itemsLeaflet[0].urn();
        }
    };

    if (bubbleNode.isGeometry()) {
        if (bubbleNode.is3D()) {
            // delegate to BubbleNode, which has OTG support
            return bubbleNode.getViewableRootPath();
        } else if (bubbleNode.is2D()) {
            // Try to get a 2D urn according to order priority
            const urn = getPdfUrn() || getImageUrn() || getF2DUrn();
            if (urn) {
                return urn;
            }
        }
    } else if (bubbleNode.isViewPreset()) {
        var geometryItem = this.getViewGeometry(bubbleNode, true);
        if (geometryItem)
            return this.getViewableUrn(geometryItem, outLoadOptions);
    }

    return '';
};


/**
 * Returns the absolute path to the viewable of the given item, including server endpoint.
 * @param {object} item - The item whose viewable is requested.
 * @param {object} outLoadOptions - Output param: used to store some additional loader options.
 * Needed to extract leaflet params from a bubble item.
 * @returns {string}
 */
Document.prototype.getViewablePath = function(item, outLoadOptions)
{
    var relPath = this.getViewableUrn(item, outLoadOptions);

    if (!relPath)
        return "";

    return this.getFullPath(relPath);
};

// Revit derivatives contain an urn to an aecModelData json file. If this
// exists, this function loads that json file and attaches it to a viewable node,
// so that it can be obtained using BubbleNode.getAecModelData(). onFinished
// is always called with aecModelData on success, otherwise with undefined. 
Document.prototype.downloadAecModelData = function(onFinished) {

    const onFinishedHandler = !onFinished ? (aecModelData) => aecModelData : (aecModelData) => {
            try{
                onFinished(aecModelData);
            }
            catch(e) {
                console.error('Document.downloadAecModelData() onFinished handler crashed', e);    
            }
            return aecModelData;
        };
    
    if (this.downloadAecModelDataPromise) {
        this.downloadAecModelDataPromise.then(onFinishedHandler);
        return this.downloadAecModelDataPromise;
    }

    //check if it's already available (automatically added to manifest by OTG server)
    var viewable = this.docRoot.findViewableParent();
    var aecModelData = viewable && viewable.data.aec_model_data;
    if (aecModelData) {
        onFinishedHandler(aecModelData);
        return Promise.resolve(aecModelData);
    }

    // Find node containing aecModelData urn
    var nodes = this.docRoot.search({role: 'Autodesk.AEC.ModelData'});
    var aecNode = nodes[0];
    if (!aecNode) {
        onFinishedHandler();
        return Promise.resolve(null);
    }

    //In case there is an OTG manifest, we need to get
    //the AECModelData as an OTG resource, because it will
    //contain transformed dbIds.
    let path = aecNode.getViewableRootPath();

    //Construct the absolute path to fetch
    const absPath = this.getFullPath(path);

    // attach sessionId if specified
    const params = {
        headers: {}
    };

    // We must use `getAcmSessionId` and not directly use `this.acmSessionId`, since the acmSession queryParam must fit to the
    // required resource that we are going to request. Inside `getAcmSessionId` generates the acmSession according to the given urn.
    const acmSession = this.getAcmSessionId(absPath);

    // Normally AecModelData.json file is downloaded from OTG service where auth is done though a cookie. In case
    // 'absPath' is against Forge-API / derivative service we need to provide the authorization header.
    // NOTE: the normal `endpoint.HTTP_REQUEST_HEADERS["Authorization"]` mechanism (see envinit.js) doesn't work here
    // since we basically use a different endpoint (Forge API instead of OTG service).
    if (absPath.indexOf('.api.autodesk.com') !== -1 && token.accessToken) {
        params.headers['Authorization'] = 'Bearer ' + token.accessToken;
    }

    if (acmSession)
        params.queryParams = 'acmsession=' + acmSession;

    this.downloadAecModelDataPromise = new Promise(resolve => {

        var onDone = (aec) => {
            // find viewable node that we will attach the data to,
            // so that BubbleNode.getAecModelData() will find it.
            var viewableNode = aecNode.findViewableParent();
            viewableNode.data.aec_model_data = aec;
            resolve(aec);
        };

        ViewingService.getItem(endpoint.initLoadContext(params), absPath,
            success => onDone(success),
            () => onDone(), //don't really want to cause an exception thrown here
            {responseType: 'json'}
        );
    }).then((aecModelData) => {
        delete this.downloadAecModelDataPromise;
        return aecModelData;
    }).then(onFinishedHandler);

    return this.downloadAecModelDataPromise;
};

/**
 * This is a utility function to support delay loaded AECModelData.
 * It is a replacement for the synchronous BubbleNode.getAecModelData() for cases
 * when we may not have yet loaded the AECModelData or we are not sure that we did.
 * This helper is specifically here in order to hide the fact that the bubbleNode already has
 * a back pointer to the Document instance.
 * @param bubbleNode BubbleNode|BubbleNode[] - input manifest node(s) for which we need AECModelData.
 * @returns Object|Object[] - AECModelData per input node(s)
  */
Document.getAecModelData = function(bubbleNode) {

    if (Array.isArray(bubbleNode)) {

        let perDoc = new Map();
        let promises = bubbleNode.map(node=> {
            let lmvDoc = node.getDocument();
            let p = perDoc.get(lmvDoc);
            if (p) {
                return p;
            } else {
                let p = lmvDoc.downloadAecModelData();

                perDoc[lmvDoc] = p;

                return p;
            }
        });

        return Promise.all(promises);

    } else {

        let lmvDoc = bubbleNode.getDocument();
        return lmvDoc.downloadAecModelData();

    }
};

/**
 * Returns a BubbleNode instance, encapsulating the current document manifest JSON.
 * 
 * @returns {Autodesk.Viewing.BubbleNode}
 * @see {Autodesk.Viewing.BubbleNode}
 * 
 * @memberof Autodesk.Viewing.Document
 * @alias Autodesk.Viewing.Document#getRoot
 */
Document.prototype.getRoot = function() {
    return this.docRoot;
};

/**
 *  Returns the id of this document.
 *  @returns {string}
 */
Document.prototype.getPath = function()
{
    return this.myPath;
};

/**
 * Returns the parent geometry item for a given view item.
 * @param {object} item - View item.
 * @returns {object} The parent geometry item.
 */
Document.prototype.getViewGeometry = function (item) {
    var geometryItem = item.findParentGeom2Dor3D();
    return geometryItem;
};

/**
 * Returns the number of view items underneath a geometry item.
 * @param {BubbleNode} item - Geometry item.
 * @returns {number} The number of view items underneath the geometry item.
 */
Document.prototype.getNumViews = function (item) {
    var _guid = item.guid;
    if (item instanceof BubbleNode) {
        _guid = item.guid();
    }
    return this.myNumViews[_guid] || 0;
};

/**
 * Returns messages (error and warning messages) associated with a given item.
 * It includes item's messages as well as messages of all its parents.
 * @param {BubbleNode} item - the manifest node.
 * @param {boolean} - If true, the top messages that apply to the whole file are excluded.
 * @returns {object} Returns an array of messages.
 */
Document.prototype.getMessages = function( item, excludeGlobal ) {

    var messages = [];
    if (!item)
        return messages;


    var current = item;
    while (current) {

        if (excludeGlobal && !current.parent)
            break;

        if (current._raw().messages) {
            messages = messages.concat(current._raw().messages);
        }
        current = current.parent;
    }


    return messages;
};




Document.prototype.getGlobalMessages = function() {

    var collectedmessages = [];
    var translateFailedCount = 0;
    var translateProgressCount = 0;

    this.getRoot().traverse(function (obj) {
        var messages = obj._raw().messages || [];

        var errorMessages = messages.filter(function(msg) {
            return msg.type === 'error';
        });

        if(errorMessages.length > 0) {
            translateFailedCount += 1;
        }

        if(obj._raw().status === 'inprogress') {
            translateProgressCount += 1;
        }

        collectedmessages = collectedmessages.concat(messages);
    });

    var progress = 'translated';

    progress = translateFailedCount > 0 ? "failed" : progress;
    progress = translateProgressCount > 0 ? 'processing' : progress;

    for(var i = collectedmessages.length; i--; collectedmessages[i].$translation = progress);

    return collectedmessages;
};

