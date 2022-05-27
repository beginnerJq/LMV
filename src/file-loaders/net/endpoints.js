
import { isNodeJS, getGlobal } from "../../compat";
import { getParameterByName } from "../../globals";

const _window = getGlobal();

    var endp = {};

    var CDN_ROOT = null;
    endp.ENDPOINT_API_DERIVATIVE_SERVICE_V2 = 'derivativeV2';
    endp.ENDPOINT_API_MODEL_DERIVATIVE_V2 = 'modelDerivativeV2'; // Forge
    endp.ENDPOINT_API_FLUENT = 'fluent';
    endp.ENDPOINT_API_D3S = 'D3S';
    endp.ENDPOINT_API_DERIVATIVE_STREAMING = 'streamingV2'; // SVF2

    var _apis_data = {
        derivativeV2:  {
            baseURL: '/derivativeservice/v2',
            itemURL: '/derivativeservice/v2/derivatives/:derivativeurn',
            manifestURL: '/derivativeservice/v2/manifest/:urn',
            thumbnailsURL: '/derivativeservice/v2/thumbnails/:urn',
            propertyQueryURL: '/modelderivative/v2/designdata/:urn/metadata/:guid/properties:query'
        },
        derivativeV2_EU:  {
            baseURL: '/derivativeservice/v2/regions/eu',
            itemURL: '/derivativeservice/v2/regions/eu/derivatives/:derivativeurn',
            manifestURL: '/derivativeservice/v2/regions/eu/manifest/:urn',
            thumbnailsURL: '/derivativeservice/v2/regions/eu/thumbnails/:urn'
        },
        derivativeV2_Fedramp:  {
            baseURL: '/derivativeservice/v2',
            itemURL: '/derivativeservice/v2/derivatives/:derivativeurn',
            manifestURL: '/derivativeservice/v2/manifest/:urn',
            thumbnailsURL: '/derivativeservice/v2/thumbnails/:urn'
        },
        modelDerivativeV2: {
            baseURL: '/modelderivative/v2/',
            itemURL: '/modelderivative/v2/designdata/:urn/manifest/:derivativeurn',
            manifestURL: '/modelderivative/v2/designdata/:urn/manifest',
            thumbnailsURL: '/modelderivative/v2/designdata/:urn/thumbnail',
            propertyQueryURL: '/modelderivative/v2/designdata/:urn/metadata/:guid/properties:query'
        },
        fluent: {
            baseURL: '/modeldata',
            itemURL: '/modeldata/file/:derivativeurn',
            manifestURL: '/modeldata/manifest/:urn',
            thumbnailsURL: '/derivativeservice/v2/thumbnails/:urn',
            cdnURL: '/cdn',
            cdnWS: '/cdnws',
            //cdnRedirectURL: '/cdnurl', //There is no separate CDN endpoint currently
        },
        D3S: {
            baseURL: '/modeldata',
            itemURL: '/modeldata/file/:derivativeurn',
            manifestURL: '/modeldata/manifest/:urn',
            thumbnailsURL: '/derivativeservice/v2/thumbnails/:urn',
            cdnURL: '/cdn',
            cdnWS: '/cdnws'
        },
        D3S_EU: {
            baseURL: '/modeldata',
            itemURL: '/modeldata/file/:derivativeurn',
            manifestURL: '/modeldata/manifest/:urn',
            thumbnailsURL: '/derivativeservice/v2/regions/eu/thumbnails/:urn',
            cdnURL: '/cdn',
            cdnWS: '/cdnws'
        },
        streamingV2: {
            /** SVF2 */
            baseURL: '/modeldata',
            itemURL: '/modeldata/file/:derivativeurn',
            manifestURL: '/modeldata/manifest/:urn',
            thumbnailsURL: '/derivativeservice/v2/thumbnails/:urn',
            cdnURL: '/cdn',
            cdnWS: '/cdnws'
        },
        streamingV2_EU: {
            /** SVF2 */
            baseURL: '/regions/eu/modeldata',
            itemURL: '/regions/eu/modeldata/file/:derivativeurn',
            manifestURL: '/regions/eu/modeldata/manifest/:urn',
            thumbnailsURL: '/derivativeservice/v2/regions/eu/thumbnails/:urn',
            cdnURL: '/regions/eu/cdn',
            cdnWS: '/regions/eu/cdnws'
        },
        streamingV2_Fedramp: {
            /** SVF2 */
            baseURL: '/regions/fedramp/modeldata',
            itemURL: '/regions/fedramp/modeldata/file/:derivativeurn',
            manifestURL: '/regions/fedramp/modeldata/manifest/:urn',
            thumbnailsURL: '/derivativeservice/v2/regions/fedramp/thumbnails/:urn',
            cdnURL: '/regions/fedramp/cdn',
            cdnWS: '/regions/fedramp/cdnws'
        }
    };

    var _endpoint = '';
    var _api = endp.ENDPOINT_API_DERIVATIVE_SERVICE_V2;
    var _useCredentials = false;
    var _useCookie = false;
    var _acmSession = '';
    var _escapeOssObjects = false;

    endp.HTTP_REQUEST_HEADERS = {};
    endp.queryParams = {};

    /**
     * Sets the endpoint and api to be used to create REST API request strings.
     * @param {string} endpoint
     * @param {string} [api] - Possible values are derivativeV2, modelDerivativeV2
     */
    endp.setEndpointAndApi = function(endpoint, api) {
        if (endpoint) {
            _endpoint = endpoint;
        }
        if (api) {
            _api = api;
            if (api.startsWith('D3S')) {
                console.warn(`api=${api} is deprecated and will be removed in a future release. Use streamingV2 or streamingV2_EU (europe region) instead`);
            }
        }
    };

    /**
     * Returns the endpoint plus the api used to create REST API request strings.
     * Example: "developer.api.autodesk.com/modelderivative/v2"
     * @returns {string}
     */
    endp.getEndpointAndApi = function() {
        return _endpoint + _apis_data[_api].baseURL;
    };

    /**
     * Returns the endpoint used to create REST API request strings.
     * Examples: "developer.api.autodesk.com"
     * @returns {string}
     */
    endp.getApiEndpoint = function() {
        return _endpoint;
    };

    /**
     * @private
     * @returns {string}
     */
    endp.getApiFlavor = function() {
        return _api;
    };

    /**
     * Returns the default shared resource CDN location.
     * For best performance (and to not overload our servers), this should
     * be replaced by a direct CloudFront url during initialization, by
     * calling the cdnRedirectUrl and looking at the result.
     */
    endp.getCdnUrl = function() {
        return CDN_ROOT || (_endpoint ? _endpoint + _apis_data[_api].cdnURL : undefined);
    };

    endp.getCdnWebSocketEndpoint = function() {
        return _endpoint + (_apis_data[_api].cdnWS || '');
    };

    endp.setCdnUrl = function(url) {
        CDN_ROOT = url;
    };

    endp.getCdnRedirectUrl = function() {
        var redirect = _apis_data[_api].cdnRedirectURL;
        if (!redirect)
            return null;
        return _endpoint + redirect;
    };

    endp.setAcmSession = function(value) {
        _acmSession = value;
    };

    endp.getAcmSession = function() {
        return _acmSession;
    };

    /**
     * Returns a REST API request strings to be used to get the manifest of the provided urn.
     * Example: "developer.api.autodesk.com/modelderivative/v2/designdata/:urn/manifest"
     * @param {string | null} endpoint - When provided is used instead of the globally set endpoint.
     * @param {string} urn
     * @param {string} api - When provided is used instead of the globally set API flavor
     * @returns {string}
     */
    endp.getManifestApi = function(endpoint, urn, api) {
        var url = (endpoint || _endpoint);
        api = api || _api;
        url += _apis_data[api].manifestURL;
        // If urn is not provided we return same string that before for backward compatibility.
        urn = urn || '';
        url = url.replace(':urn', urn);
        return url;
    };

    /**
     * Returns a REST API request strings to be used to get a derivative urn.
     * Example: "developer.api.autodesk.com/modelderivative/v2/designdata/:urn/manifest/:derivativeUrn"
     * @param {string | null} endpoint - When provided is used instead of the globally set API endpoint.
     * @param {string} derivativeUrn
     * @param {string} api - When provided is used instead of the globally set API flavor
     * @returns {string}
     */
    endp.getItemApi = function(endpoint, derivativeUrn, api) {
        var theApi = api || _api;
        var itemApi = (endpoint || _endpoint) + _apis_data[theApi].itemURL;
        // If urn is not provided we return same string that before for backward compatibility.
        derivativeUrn = derivativeUrn || '';
        var decodedUrn = decodeURIComponent(derivativeUrn);

        // Extract svf urn from item urn, needed when using model derivative.
        if (itemApi.indexOf(':urn') !== -1) {
            var parts = decodedUrn.split('/');
            var urn = parts[0] || '';
            urn = urn.split(':');
            urn = urn[urn.length-1] || '';

            itemApi = itemApi.replace(':urn', urn);
        }

        if (theApi === endp.ENDPOINT_API_MODEL_DERIVATIVE_V2) {	
            derivativeUrn = encodeURIComponent(decodedUrn);	
        }
        
        itemApi = itemApi.replace(':derivativeurn', derivativeUrn);

        return itemApi;
    };

    /**
     * Returns a REST API request strings to be used to get the thumbnail for a specific urn.
     * Example: "developer.api.autodesk.com/modelderivative/v2/designdata/:urn/thumbnail"
     * @param {string | null} endpoint - When provided is used instead of the globally set endpoint.
     * @param {string} urn
     * @param {string} api - When provided is used instead of the globally set API flavor
     * @returns {string}
     */
    endp.getThumbnailApi = function(endpoint, urn, api) {
        var thumbnailApi = (endpoint || _endpoint) + _apis_data[api || _api].thumbnailsURL;
        return thumbnailApi.replace(':urn', urn || '');
    };

    endp.getPropertyQueryApi = function(endpoint, urn, api, guid) {
        let propertyQueryApi = (endpoint || _endpoint) + _apis_data[api || _api].propertyQueryURL;
        propertyQueryApi = propertyQueryApi.replace(':urn', urn || '');
        return propertyQueryApi.replace(':guid', guid || '');
    };

    endp.getUseCredentials = function() {
        return _useCredentials;
    };

    endp.getDomainParam = function() {
        console.warn("getDomainParam is deprecated, switch to getQueryParams instead.");
        return (this.getUseCredentials() && !isNodeJS()) ? ("domain=" + encodeURIComponent(_window.location.origin)) : "";
    };

    /**
     * Adds a URL parameter that will be used in all data load requests.
     * @param {string} param - The name of the parameter
     * @param {string} value - The value of the parameter. It will be URI encoded when constructing the final URL.
     */
    endp.addQueryParam = function(param, value) {
        this.queryParams[param] = value;
    };

    /**
     * Deletes a previously specified URL parameter.
     * @param {string} param - The name of the parameter to delete
     */
    endp.deleteQueryParam = function(param) {
        delete this.queryParams[param];
    };

    endp.getQueryParams = function(inputObj) {

        let qParam = (this.getUseCredentials() && !isNodeJS()) ? ("domain=" + encodeURIComponent(_window.location.origin)) : "";

        let bypassDs =  getParameterByName("bypassds");
        if (bypassDs) {
            qParam = qParam ? qParam + "&bypassds=1" : "bypassds=1";
        }

        let addedParams = [];
        for (let p in this.queryParams) {
            addedParams.push(encodeURIComponent(p) + "=" + encodeURIComponent(this.queryParams[p]));
        }

        if (addedParams.length) {
            if (qParam)
                qParam += "&" + addedParams.join("&");
            else
                qParam = addedParams.join("&");
        }

        if (qParam && inputObj) {
            if (inputObj.queryParams) {
                inputObj.queryParams += "&" + qParam;
            } else {
                inputObj.queryParams = qParam;
            }
        }

        return qParam;
    };

    endp.setUseCredentials = function(useCredentials) {
        _useCredentials = useCredentials;
    };

    endp.setUseCookie = function(useCookie) {
        _useCookie = useCookie;
    };

    endp.getUseCookie = function() {
        return _useCookie;
    };

    endp.isOtgBackend = function() {
        return this.getApiFlavor() === this.ENDPOINT_API_FLUENT;
    };
    
    endp.isSVF2Backend = function() {
        let api = this.getApiFlavor();
        return api.startsWith(this.ENDPOINT_API_D3S) || api.startsWith(this.ENDPOINT_API_DERIVATIVE_STREAMING);
    };

    endp.setEscapeOssObjects = function(escapeOssObjects) {
        _escapeOssObjects = escapeOssObjects;
    }

    endp.getEscapeOssObjects = function() {
        return _escapeOssObjects;
    }

    endp.initLoadContext = function(inputObj) {

        inputObj = inputObj || {};

        inputObj.auth = this.getUseCredentials();

        if (!inputObj.endpoint)
            inputObj.endpoint =  this.getApiEndpoint();

        if (!inputObj.api)
            inputObj.api = this.getApiFlavor();

        if (!inputObj.headers)
            inputObj.headers = {};

        for (var p in this.HTTP_REQUEST_HEADERS) {
            inputObj.headers[p] = this.HTTP_REQUEST_HEADERS[p];
        }

        if (inputObj.api === this.ENDPOINT_API_FLUENT) {
            //Turned off because Nginx on fluent server is refusing to
            //return ranges from the proxy cache -- and it's not clear why.
            //inputObj.supportsRangeRequests = true;
        }

        //This is done to avoid CORS errors on content served from proxy or browser cache
        //The cache will respond with a previously received response, but the Access-Control-Allow-Origin
        //response header might not match the current Origin header (e.g. localhost vs. developer.api.autodesk.com)
        //which will cause a CORS error on the second request for the same resource.
        this.getQueryParams(inputObj);

        //shared geometry/material storage
        inputObj.otg_cdn = CDN_ROOT || this.getCdnUrl();
        inputObj.otg_ws = this.getCdnWebSocketEndpoint();

        inputObj.escapeOssObjects = this.getEscapeOssObjects();

        return inputObj;
    };

    //TODO: Globals that need a better place
    var _env; //formerly avp.env
    export function getEnv() {
        return _env;
    }
    export function setEnv(env) {
        _env = env;
        if (env.startsWith('MD20')) {
            console.warn(`env=${env} is deprecated and will be removed in a future release. Use Autodesk{env}2 instead, where env=Development, Staging, or Production`);
        }
    }

    // Set viewer in offline mode if set to true. In offline mode, viewer would ignore all URNs in bubble JSON
    // and assume the viewables are laid out in local file system path relative to the bubble.json.
    var _offline = false;
    export function isOffline() {
        return _offline;
    }
    export function setOffline(offline) {
        _offline = offline;
    }

    // Offline resource prefix specified by viewer consumer (e.g. IOS web view). Used as prefix to concatenate with
    // each resource relative path to form the absolute path of each resource.
    var _offlineResourcePrefix = "";
    export function setOfflineResourcePrefix(prefix) {
        _offlineResourcePrefix = prefix;
    }
    export function getOfflineResourcePrefix() {
        return _offlineResourcePrefix;
    }

    export let endpoint = endp;

    //For backwards compatibility until all code is converted to use
    //the function from the endpoint instance.
    export let initLoadContext = endp.initLoadContext.bind(endp);