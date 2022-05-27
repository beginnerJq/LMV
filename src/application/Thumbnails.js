import { LocalStorage } from "./LocalStorage";
import { endpoint, initLoadContext, getEnv } from '../file-loaders/net/endpoints';
import { ViewingService } from '../file-loaders/net/Xhr';
import { getGlobal } from '../compat';
import { EnvironmentConfigurations, getUpstreamApiData } from "../envinit";

const DEFAULT_THUMBNAIL_SIZE = 200; // pixels

/**
 * @param {BubbleNode} bubbleNode - The geometry node for the thumbnail.
 * @param {object} [options] - Bag of options.
 * @param {number} [size=200] - Thumbnail's with and height. Default is 200 pixels.
 *
 * @returns Promise - That resolves with a string URL
 *
 * @private
 */
function getUrlForBubbleNode(bubbleNode, options) {

    if (!bubbleNode)
        return Promise.reject(new Error('Missing instance of BubbleNode'));

    var geomNode = bubbleNode.findParentGeom2Dor3D();
    if (!geomNode)
        return Promise.reject(new Error('No thumbnail available.'));

    options = options || {};
    const size = options.size || DEFAULT_THUMBNAIL_SIZE;

    // Check PDF
    const rootNode = bubbleNode.getRootNode();
    if ((rootNode.data.isVectorPDF || !!geomNode.data.isVectorPDF) && rootNode.data.getPDF) {

        return new Promise((resolve) => {
            
            let item = bubbleNode.data;
            let pdfObj = rootNode.data.getPDF();
            let width = size;
            let height = size;
            let key = `${item.guid}/thumbnail/${width}x${height}`;

            renderForPDF(pdfObj, item.page, width, height, key, resolve);    
        });
    }

    // DS thumbnail
    return new Promise((resolve, reject)=>{

        var data = {
            urn: rootNode.urn(),
            width: size,
            height: size,
            guid: encodeURIComponent(bubbleNode.guid()),
            acmsession: endpoint.getAcmSession(),
        };

        var onSuccess = (response) => {
            var reader = new FileReader();
            reader.onload = (e) => {
                var srcUrl = e.target.result;
                resolve(srcUrl);
            };
            reader.readAsDataURL(response);
        };

        var onError = () => {
            reject(new Error('Thumbnail is unavailable.'));
        };

        var options = {
            responseType: 'blob',
            skipAssetCallback: true,
            size: size,
            guid: data.guid,
            acmsession: data.acmSession
        };

        
        let urlpath = "urn:" + data.urn; //HACK: Adding urn: makes the ViewingServiceXhr accept this as a viewing service request.
        if (bubbleNode.data.thumbnailUrn) { // takes care of local bubbles
            urlpath = rootNode.getDocument().getFullPath(bubbleNode.data.thumbnailUrn);
        }

        var endpointUrl = undefined;

        if (!getGlobal().USE_OTG_DS_PROXY) {
            var envName = getEnv();
            endpointUrl = EnvironmentConfigurations[envName].UPSTREAM;
            const upstreamApiData = getUpstreamApiData(envName, endpoint.getApiFlavor());
            options.apiData = upstreamApiData;
        }

        ViewingService.getThumbnail(initLoadContext({ endpoint: endpointUrl }), urlpath, onSuccess, onError, options);
    });
}

/**
 * 
 * @param {PDF} pdf PDF object from PDFLoader
 * @param {integer} pageNumber start from 1
 * @param {integer} width 
 * @param {integer} height 
 * @param {function} callback 
 *
 * @private
 */
function renderForPDF(pdf, pageNumber, width, height, cacheKey, callback) {
    var cache = LocalStorage.getItem(cacheKey);
    if(cache) {
        callback(cache);
    } else {
        pdf.getPage(pageNumber).then((page) => {
            var _document = getGlobal().document;
            var canvas = _document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;

            var context = canvas.getContext("2d");

            var options = {
                scale: 1
            };

            var viewport = page.getViewport(options);
            var scale = Math.min(canvas.width / viewport.width, canvas.height / viewport.height);

            page.render({ canvasContext: context, viewport: page.getViewport({scale}) }).promise.then(() => {
                page.cleanup();

                canvas.toBlob((blob) => {
                    var reader = new FileReader();
                    reader.readAsDataURL(blob);
                    reader.onloadend = function () {
                        LocalStorage.setItem(cacheKey, reader.result);
                        callback(reader.result);
                    };
                }, "image/png");
            });
        });
    }
}


/**
 * Contains static functions for getting/generating from the viewer.
 * @namespace Autodesk.Viewing.Thumbnails
 */
export let Thumbnails = {
    getUrlForBubbleNode,
};