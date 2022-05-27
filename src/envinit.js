
import { getParameterByName, getScript } from "./globals";
import { logger } from "./logger/Logger";
import { endpoint, setEnv, getEnv, setOfflineResourcePrefix, setOffline } from "./file-loaders/net/endpoints";
import { getGlobal, isNodeJS, disableDocumentTouchSafari } from "./compat";
import { initWorkerScript } from "./file-loaders/main/WorkerCreator";
import { ViewingService } from "./file-loaders/net/Xhr";
import { initializeLocalization } from "./globalization/i18init";
import { analytics } from './analytics';

var global = getGlobal();
const _window = global;

var _token = {
    accessToken : null,
    getAccessToken : null,
    tokenRefreshInterval : null
};

export let token = _token;

let WEBGL_HELP_LINK = null;
/**
 * @private
 */
export function getWebGLHelpLink() {
    return WEBGL_HELP_LINK;
}


    var LmvEndpoints = {
        local: {
            RTC:        ['https://rtc-dev.api.autodesk.com:443', 'https://lmv.autodesk.com:443'] //port # is required here.
        },
        dev: {
            RTC:        ['https://rtc-dev.api.autodesk.com:443', 'https://lmv.autodesk.com:443']
        },
        stg: {
            RTC:        ['https://rtc-stg.api.autodesk.com:443', 'https://lmv.autodesk.com:443']
        },
        prod: {
            RTC:        ['https://rtc.api.autodesk.com:443', 'https://lmv.autodesk.com:443']
        }
    };

    var currentHost = "";
    var dsProxyPort = 3000;
    var currentDomain = "";
    if (getGlobal().location) {
        var location = getGlobal().location;
        currentDomain = location.protocol + "//" + location.hostname;
        currentHost = location.protocol + "//" + location.host;
    }

    var DevApiUrls = {
        local: "",
        dev: "https://developer-dev.api.autodesk.com",
        stg: "https://developer-stg.api.autodesk.com",
        prod: "https://developer.api.autodesk.com"
    };

    var FluentApiUrls = {
        dev: "https://us.otgs-dev.autodesk.com",
        stg: "https://us.otgs-stg.autodesk.com",
        prod: "https://us.otgs.autodesk.com",
        stg_eu: "https://eu.otgs-stg.autodesk.com",
        prod_eu: "https://eu.otgs.autodesk.com"
    };

    var D3SUrls = {
        dev_us_http: "https://cdn-dev.derivative.autodesk.com",
        dev_eu_http: "https://cdn-dev.derivative.autodesk.com/regions/eu",
        dev_us_ws: "https://cdn-dev.derivative.autodesk.com/cdnws",
        dev_eu_ws: "https://cdn-dev.derivative.autodesk.com/regions/eu/cdnws",
        stg_us_http: "https://cdn-stg.derivative.autodesk.com",
        stg_eu_http: "https://cdn-stg.derivative.autodesk.com/regions/eu",
        stg_us_ws: "https://cdn-stg.derivative.autodesk.com/cdnws",
        stg_eu_ws: "https://cdn-stg.derivative.autodesk.com/regions/eu/cdnws",
        prod_us_http: "https://cdn.derivative.autodesk.com",
        prod_eu_http: "https://cdn.derivative.autodesk.com/regions/eu",
        prod_us_ws: "https://cdn.derivative.autodesk.com/cdnws",
        prod_eu_ws: "https://cdn.derivative.autodesk.com/regions/eu/cdnws",
    };

    var derivativeStreamingUrls = {
        /** SVF2 */
        dev: "https://cdn-dev.derivative.autodesk.com",
        stg: "https://cdn-stg.derivative.autodesk.com",
        prod: "https://cdn.derivative.autodesk.com",
    };
    
    var derivativeStreamingFedrampUrls = {
        /** SVF2 */
        stg: "https://cdn-stg-fips.derivative.autodesk.com",
        prod: "https://cdn-fips.derivative.autodesk.com",
    };

    var DevApiFedrampUrls = {
        stg: "https://api-stg.afg.us.autodesk.com",
        prod: "https://api.afg.us.autodesk.com",
    };

    var DerivativeApiData = {
        v2: "derivativeV2",
        v2_eu: "derivativeV2_EU",
        v2_fedramp: "derivativeV2_Fedramp",
    };

    export let EnvironmentConfigurations = Object.freeze({
        Local: {
            ROOT:       '',
            LMV:        LmvEndpoints["local"]
        },
        Development: {
            ROOT:       derivativeStreamingUrls["dev"],
            LMV:        LmvEndpoints["dev"],
            bubbleManifest: true
        },
        Staging: {
            ROOT:       derivativeStreamingUrls["stg"],
            LMV:        LmvEndpoints["stg"],
            bubbleManifest: true
        },
        Production: {
            ROOT:       derivativeStreamingUrls["prod"],
            LMV:        LmvEndpoints["prod"],
            bubbleManifest: true
        },
        AutodeskDevelopment: {
            ROOT:       derivativeStreamingUrls["dev"],
            LMV:        LmvEndpoints["dev"]
        },
        AutodeskStaging: {
            ROOT:       derivativeStreamingUrls["stg"],
            LMV:        LmvEndpoints["stg"]
        },
        AutodeskProduction: {
            ROOT:       derivativeStreamingUrls["prod"],
            LMV:        LmvEndpoints["prod"]
        },
        AutodeskDevelopment2: {
            /** SVF2 */
            ROOT:       derivativeStreamingUrls["dev"],
            LMV:        LmvEndpoints["dev"],
            UPSTREAM: DevApiUrls["dev"],
            UPSTREAM_API_DATA: DerivativeApiData["v2"]
            
        },
        AutodeskStaging2: {
            /** SVF2 */
            ROOT:       derivativeStreamingUrls["stg"],
            LMV:        LmvEndpoints["stg"],
            UPSTREAM: DevApiUrls["stg"],
            UPSTREAM_API_DATA: DerivativeApiData["v2"]
        },
        AutodeskProduction2: {
            /** SVF2 */
            ROOT:       derivativeStreamingUrls["prod"],
            LMV:        LmvEndpoints["prod"],
            UPSTREAM: DevApiUrls["prod"],
            UPSTREAM_API_DATA: DerivativeApiData["v2"]
        },
        FluentLocal: {
            ROOT:       currentHost,
            LMV:        currentHost
        },
        FluentDev: {
            ROOT:       FluentApiUrls["dev"],
            LMV:        LmvEndpoints["dev"],
            UPSTREAM: DevApiUrls["stg"],
            UPSTREAM_API_DATA: DerivativeApiData["v2"]
        },
        FluentStaging: {
            ROOT:       FluentApiUrls["stg"],
            LMV:        LmvEndpoints["stg"],
            UPSTREAM: DevApiUrls["stg"],
            UPSTREAM_API_DATA: DerivativeApiData["v2"]
        },
        FluentProduction: {
            ROOT:       FluentApiUrls["prod"],
            LMV:        LmvEndpoints["prod"],
            UPSTREAM: DevApiUrls["prod"],
            UPSTREAM_API_DATA: DerivativeApiData["v2"]
        },
        FluentStagingEU: {
            ROOT:       FluentApiUrls["stg_eu"],
            LMV:        LmvEndpoints["stg"],
            UPSTREAM: DevApiUrls["stg"],
            UPSTREAM_API_DATA: DerivativeApiData["v2_eu"]
        },
        FluentProductionEU: {
            ROOT:       FluentApiUrls["prod_eu"],
            LMV:        LmvEndpoints["prod"],
            UPSTREAM: DevApiUrls["prod"],
            UPSTREAM_API_DATA: DerivativeApiData["v2_eu"]
        },
        MD20DevUS: {
            ROOT:       D3SUrls["dev_us_http"],
            LMV:        LmvEndpoints["dev"],
            UPSTREAM:   DevApiUrls["dev"],
            UPSTREAM_API_DATA: DerivativeApiData["v2"]
        },
        MD20DevEU: {
            ROOT:       D3SUrls["dev_eu_http"],
            LMV:        LmvEndpoints["dev"],
            UPSTREAM: DevApiUrls["dev"],
            UPSTREAM_API_DATA: DerivativeApiData["v2_eu"]
        },
        MD20StgUS: {
            ROOT:       D3SUrls["stg_us_http"],
            LMV:        LmvEndpoints["stg"],
            UPSTREAM: DevApiUrls["stg"],
            UPSTREAM_API_DATA: DerivativeApiData["v2"]
        },
        MD20StgEU: {
            ROOT:       D3SUrls["stg_eu_http"],
            LMV:        LmvEndpoints["stg"],
            UPSTREAM: DevApiUrls["stg"],
            UPSTREAM_API_DATA: DerivativeApiData["v2_eu"]
        },
        MD20ProdUS: {
            ROOT:       D3SUrls["prod_us_http"],
            LMV:        LmvEndpoints["prod"],
            UPSTREAM: DevApiUrls["prod"],
            UPSTREAM_API_DATA: DerivativeApiData["v2"]
        },
        MD20ProdEU: {
            ROOT:       D3SUrls["prod_eu_http"],
            LMV:        LmvEndpoints["prod"],
            UPSTREAM: DevApiUrls["prod"],
            UPSTREAM_API_DATA: DerivativeApiData["v2_eu"]
        },
        D3SLocalUS: {
            ROOT:       currentHost,
            LMV:        currentHost,
            UPSTREAM:   currentHost,
            UPSTREAM_API_DATA: DerivativeApiData["v2"]
        },
        D3SLocalEU: {
            ROOT:       currentHost,
            LMV:        currentHost,
            UPSTREAM:   currentHost,
            UPSTREAM_API_DATA: DerivativeApiData["v2_eu"]
        },
        Test: {
            ROOT:       `${currentDomain}:${dsProxyPort}`,
            LMV:        LmvEndpoints["dev"]
        },
        FedrampStaging2: {
            /** SVF2 */
            ROOT:       derivativeStreamingFedrampUrls["stg"],
            LMV:        LmvEndpoints["stg"],
            UPSTREAM: DevApiFedrampUrls["stg"],
            UPSTREAM_API_DATA: DerivativeApiData["v2_fedramp"]
        },
        FedrampProduction2: {
            /** SVF2 */
            ROOT:       derivativeStreamingFedrampUrls["prod"],
            LMV:        LmvEndpoints["prod"],
            UPSTREAM: DevApiUrls["prod"], //TODO: change to DevApiFedrampUrls["prod"] after staging has been validated
            UPSTREAM_API_DATA: DerivativeApiData["v2_fedramp"]
        },
    });

    // Used to switch upstream api data to EU region
    export function getUpstreamApiData(env, api) {
        if (env.endsWith('EU')) {
            // env already is region specific
            return EnvironmentConfigurations[env].UPSTREAM_API_DATA;
        }

        if (api.endsWith('_EU')) {
            // env is not region specific, but api points to EU - need to switch to EU
            return EnvironmentConfigurations[env].UPSTREAM_API_DATA + '_EU';
        }

        return EnvironmentConfigurations[env].UPSTREAM_API_DATA;
    }

    /**
     * @param {object} options - Configurations for environment
     * @private
     */
    export function initializeEnvironmentVariable(options) {
        var env;

        // Use the enviroment that was explicitly specified.
        //
        if (options && options.env) {
            env = options.env;
        }

        // If not available, check if the environment was specified in the query parameters.
        //
        if (!env) {
            env = getParameterByName("env");
        }
        
        setOfflineResourcePrefix((options && options.offlineResourcePrefix) || "");

        setOffline(options && options.offline === "true");

        // If still not available, try to resolve the environment based on the url.
        //
        if (!env) {
            switch (_window.location.hostname) {
                case "developer-dev.api.autodesk.com" :
                    env = 'AutodeskDevelopment';
                    break;
                case "developer-stg.api.autodesk.com" :
                    env = 'AutodeskStaging';
                    break;
                case "developer.api.autodesk.com" :
                    env = 'AutodeskProduction';
                    break;

                case "localhost.autodesk.com" :
                    env = 'Local';
                    break;
                case "" : // IP addresses on Chrome.
                    env = 'Local';
                    break;
                case "127.0.0.1" :
                    env = 'Local';
                    break;
                default:
                    env = 'AutodeskProduction';
            }
        }

        setEnv(env);

        if (typeof window !== "undefined") {
            logger.info("Host name : " + window.location.hostname);
        }
        logger.info("Environment initialized as : " + env);
    }

    /**
     * @param {object} options - Initialization options
     * @private
     */
    export function initializeResourceRoot(options) {
        //Derive the root for static viewer resources based on the
        //location of the main viewer script
        var libList = [
            "viewer3D.js",	 
            "viewer3D.min.js",
            "viewerCE.js",
            "viewerCE.min.js"
        ];
        if (options && Object.prototype.hasOwnProperty.call(options, 'libraryName'))
            libList.push(options.libraryName);

        var root;
        var scriptUrl;
        var hasVersionInURL = false;

        // TODO_NOP: this doesn't work for Polymer / Web Components
        for (let i=0; i<libList.length; i++) {
            var script = getScript(libList[i]);
            scriptUrl = script ? script.src : "";
            var idx = scriptUrl.indexOf(libList[i]);
            if (idx >= 0) {
                root = scriptUrl.substr(0, idx);
                if (scriptUrl.indexOf('&v=', idx) > 0 || scriptUrl.indexOf('?v=', idx) > 0) {
                    hasVersionInURL = true;
                }
                break;
            }
        }

        global.LMV_RESOURCE_ROOT = root || global.LMV_RESOURCE_ROOT;

        // Transfer version from URL-param into viewer/path/ now that Forge supports it.
        if (hasVersionInURL) {

            // However, only do this when the viewer code is being downloaded from Forge CDN
            var patchResourceRoot = false;
            var checkEnvs = ['dev', 'stg', 'prod'];
            for (let i=0; i<checkEnvs.length; ++i) {
                var theEnv = DevApiUrls[checkEnvs[i]];
                if (global.LMV_RESOURCE_ROOT.indexOf(theEnv) !== -1) {
                    patchResourceRoot = true;
                    break;
                }
            }

            if (patchResourceRoot) {
                // Embed the version into the base URL.
                global.LMV_RESOURCE_ROOT += global.LMV_VIEWER_VERSION + '/';
            }
        }
    }

    /**
     * @param {object} options - Initialization options
     * @private
     */
    export function initializeServiceEndPoints(options) {

        // Get endpoint.
        var endp = options.endpoint;
        if (!endp) {
            var config = EnvironmentConfigurations[getEnv()];
            endp = config['ROOT'];
        }

        // Get endpoint api.
        var api = options.api || endp.ENDPOINT_API_DERIVATIVE_SERVICE_V2;

        endpoint.setEndpointAndApi(endp, api);
        if (options.escapeOssObjects !== undefined) {
            endpoint.setEscapeOssObjects(options.escapeOssObjects);
        }

        if (isNodeJS())
            return; // No need for Promise

        initializeResourceRoot(options);
        
        return Promise.resolve();
    }


    //By now, the use of cookie is Fluent-specific only
    /**
     * @param {string} token - Token to update
     * @param {Function} onSuccess - Callback on success case
     * @param {Function} onError - Callback on error case
     * @private
     */
    export function refreshCookie(token, onSuccess, onError) {

        // rawGet doesn't accept undefined onSuccess callbacks
        onSuccess = onSuccess || function() {};
        ViewingService.rawGet(endpoint.getApiEndpoint(), null, "/auth/settoken", onSuccess, onError,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                withCredentials: true,
                postData: "access-token=" + token
            }
        );
    }

    // Refresh the token in request header, in case that the third party cookie is disabled
    /**
     * @param {string} token - Token to update
     * @private
     */
    export function refreshRequestHeader(token) {
        if (token) {
            endpoint.HTTP_REQUEST_HEADERS["Authorization"] = "Bearer " + token;
        } else {
            delete endpoint.HTTP_REQUEST_HEADERS["Authorization"];
        }
    }

    /**
     * @param {string} in_tokenStr - Token to update
     * @param {Function} onSuccess - Callback on success case
     * @param {Function} onError - Callback on error case
     * @private
     */
    export function refreshToken(in_tokenStr, onSuccess, onError) {

        // Store the token, it will be used when third-party cookies are disabled
        _token.accessToken = in_tokenStr;

        //TODO: Fluent. Currently we need to use the cookie based approach,
        //until the server is fixed to respond to CORS pre-flight requests
        //with Authorization header.
        // At the beginning, try to store the token in cookie
        if (endpoint.getUseCookie()) {

            var wrapError = function(e) {
                logger.warn("Failed to set token in cookie. Will use header instead.");
                endpoint.setUseCookie(false);
                refreshRequestHeader(in_tokenStr);
                onError && onError(e);
            };

            refreshCookie(in_tokenStr, onSuccess, wrapError);
        } else {
            refreshRequestHeader(in_tokenStr);
            onSuccess && onSuccess();
        }
    }

    /**
     * @param {object} options - Initialization options
     * @private
     */
    function initializeAuthPromise(options) {
        return new Promise((resolve)=>{
            initializeAuth(resolve, options);
        });
    }

    /**
     * @param {Function} onSuccessCallback - Callback on success case
     * @param {object} options - Initialization options
     * @private
     */
    export function initializeAuth(onSuccessCallback, options) {

        var shouldInitializeAuth = options ? options.shouldInitializeAuth : undefined;
        if (shouldInitializeAuth === undefined) {
            var p = getParameterByName("auth");
            shouldInitializeAuth = (p.toLowerCase() !== "false");
        }

        if (!shouldInitializeAuth) {
            refreshRequestHeader(null);
        }

        //Skip Auth in case we are serving the viewer locally
        if (getEnv() == "Local" || !shouldInitializeAuth) {
            setTimeout(onSuccessCallback, 0);
            endpoint.setUseCredentials((typeof options.useCredentials !== "undefined") ? options.useCredentials : false);
            return;
        }

        endpoint.setUseCredentials((typeof options.useCredentials !== "undefined") ? options.useCredentials : true);
        endpoint.setUseCookie(options.useCookie);

        //Must zero this out every time the initializer is called -- which could happen
        //several times with the same globally loaded LMV script/module
        if (_token.tokenRefreshInterval) {
            clearTimeout(_token.tokenRefreshInterval);
            _token.tokenRefreshInterval = null;
        }

        var accessToken;

        /**
         * @param {string} token - Access token value
         * @param {number|string} expire - Expire time in seconds, or an ISOstring containing an expiration date.
         *                                 Default is 3599 seconds.
         */
        function onGetAccessToken(token, expire = 3599) {
            accessToken = token;

            var isFirstTimeInit = !_token.tokenRefreshInterval;

            if (!isFirstTimeInit) {
                refreshToken(accessToken);
            } else {
                //The goal of onSuccessCallback is to continue viewer initialization.
                //In case refreshToken fails, we don't really want to block viewer initialization
                //(in order to be able to display error messages later on, or retry the token refresh, etc.)
                //This is why we use the same callback regardless of result.
                refreshToken(accessToken, onSuccessCallback, onSuccessCallback);
            }

            if (typeof expire !== "number") {
                const expireDate = new Date(expire);
                // Based on https://esganzerla.medium.com/simple-date-validation-with-javascript-caea0f71883c
                const isValidDate = Boolean(+expireDate) && expireDate.toISOString() === expire;
                if (isValidDate) {
                    expire = (expireDate - Date.now()) / 1000; // Date is in ms so convert to seconds
                } else {
                    expire = 3599;  // Default of ~1 hour
                }
            }

            var tokenExpirationBuffer = options?.tokenExpirationBuffer || 5; // Refresh 5 seconds before token expire.
            var interval = expire - tokenExpirationBuffer;
            if (interval <= 0) {
                // We can't get a precise upper bound if the token is such a short lived one (expire in a minute),
                // so just use the original one.
                interval = expire;
            }

            _token.tokenRefreshInterval = setTimeout(function() {options.getAccessToken(onGetAccessToken);}, interval * 1000);
        }

        if (options && options.getAccessToken) {
            _token.getAccessToken = options.getAccessToken;

            accessToken = options.getAccessToken(onGetAccessToken);

            //Backwards compatibility with the old synchronous API
            if (typeof accessToken === "string" && accessToken) {
                refreshToken(accessToken, onSuccessCallback);
            }

        } else if (options && options.accessToken) {
            accessToken = options.accessToken;
            refreshToken(accessToken, onSuccessCallback);
        } else {
            accessToken = getParameterByName("accessToken");
            if (!accessToken) {
                logger.error("No access token is provided, but authorization requested. This is a problem.");
            }
            refreshToken(accessToken, onSuccessCallback);
        }

    }

    /**
     * @param {object} options - Initialization options
     * @private
     */
    export function initializeLogger(options) {

        logger.initialize(options);

        var logLevel = getParameterByName("logLevel");
        if (logLevel) {
            logger.setLevel(parseInt(logLevel));
        }
    }

    /**
     * @param {object} options - Initialization options
     * @private
     */
    function initializeCDN(options) {

        if (options && options.env === 'Local')
            return;

        if (!endpoint.getCdnRedirectUrl())
            return;

        ViewingService.rawGet(endpoint.getCdnRedirectUrl(), null, null,
            function onSuccess(res) {
                if (res && res.length) {
                    endpoint.setCdnUrl(res);
                    logger.info("CDN_ROOT is: " + res);
                }
            },
            function onError() {
            },
            {
                withCredentials: false,
                responseType: "text"
            }
        );
    }

    /**
     * 
     * @param {object} options  - Initialization options
     * @private
     */
    function initializeAnalytics(options) {
        const isProd = ['Production', 'fluent'].indexOf(BUILD_FLAG__BUILD_TYPE) !== -1;
        const isMinified = BUILD_FLAG__MINIFIED_BUILD;
        const skipAnalytics = !isProd || !isMinified;

        if (options.optOutTrackingByDefault || skipAnalytics) {
            analytics.shouldTrack = false;
        }
        const productId = options.productId? options.productId : getEnv() === "Local"? "Local" : "NOT_SET";
        analytics.superProps = { 
            productId: productId,
            lmvBuildType: global.LMV_BUILD_TYPE, 
            lmvViewerVersion: global.LMV_VIEWER_VERSION
        };
    }
    /**
     * Static method for initializing the viewer runtime. Models must be loaded after this
     * step is completed.
     *
     * Includes:
     *  - End points of cloud services the viewer uses, like Model Derivative
     *  - Authentication and authorization cookie settings on the client side
     *  - Misc runtime environment variables and global viewer configurations parameters
     *
     * @alias Autodesk.Viewing#Initializer
     *
     * @param {object} options - The options object contains configuration parameters used to do initializations. If no
     * access token or authentication callback is provided, the Initializer will fall back
     * on an access token provided in the URL query string, or a previous access token stored in
     * the cookie cache, if available.
     * @param {string} [options.env] - Either "AutodeskProduction", "AutodeskStaging", or "AutodeskDevelopment". 
     * "Local" can be used to avoid attaching athentication headers to XHR requests.
     * @param {string} [options.api] - "modelDerivativeV2" or "derivativeV2" for US data center,
     * or use "derivativeV2_EU" for European data center.
     * @param {Function} [options.getAccessToken] - An function that provides an access token asynchronously.
     * The function signature is `getAccessToken(onSuccess)`, where onSuccess is a callback that getAccessToken
     * function should invoke when a token is granted, with the token being the first input parameter for the
     * onSuccess function, and the token expire time (in seconds) being the second input parameter for the
     * function. Viewer relies on both getAccessToken and the expire time to automatically renew token, so
     * it is critical that getAccessToken must be implemented as described here.
     * @param {string} [options.accessToken] - An access token. Not needed when `options.getAccessToken` is provided.`
     * @param {string} [options.webGLHelpLink] - A link to a help page on webGL if it's disabled.
     * @param {string} [options.language] - Preferred language code as defined in RFC 4646, such as "en", "de", "fr", etc.
     * If no language is set, viewer will pick it up from the browser. If language is not as defined in RFC,
     * viewer will fall back to "en" (English) but the behavior is undefined.
     * @param {Function} callback - A method the client executes when initialization is finished.
     *
     * @example
     *  var options = {
     *     env: "AutodeskProduction",
     *     language: "en",
     *     getAccessToken: function(onSuccess) {
     *         // TODO: Get actual forge token and expiration time.
     *         var accessToken = 'your_access_token';
     *         var expirationTimeSeconds = 5 * 60; // 5 minutes
     *         onSuccess(accessToken, expirationTimeSeconds);
     *     }
     *  };
     *  var myCallback = function() {
     *     console.log("initialization complete, creating the viewer...");
     *  };
     *  Autodesk.Viewing.Initializer(options, myCallback);
     *
     */
    export function Initializer(options, callback) {

        if (isNodeJS()) {

            initializeEnvironmentVariable(options);
            initializeServiceEndPoints(options);
            initializeLogger(options);
            initializeCDN(options);
            initializeAuth(callback, options);
            return;
        }

        // Web //
        if (options.webGLHelpLink)
            WEBGL_HELP_LINK = options.webGLHelpLink;

        initializeEnvironmentVariable(options);
        var apiProm = initializeServiceEndPoints(options);
        initializeLogger(options);
        initializeCDN(options);
        initializeLocalization(options);
        disableDocumentTouchSafari();
        initializeAnalytics(options);

        //Kick off a request for the web worker script
        initWorkerScript();

        var authProm = initializeAuthPromise(options);

        Promise.all([apiProm, authProm]).then(callback);
    }

    /**
     * Counterpart to {@link Autodesk.Viewing.Initializer}, use it to free up memory.
     * Developers need to uninitialize all {@link Autodesk.Viewing.Viewer3D} instances before invoking this function.
     *
     * @alias Autodesk.Viewing#shutdown
     */
    export function shutdown() {

        logger.shutdown();

        Autodesk.Viewing.Private.shutdownPropWorker();

    }