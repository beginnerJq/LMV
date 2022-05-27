
import { getGlobal, isNodeJS } from "./compat";

var g = getGlobal();
var _window = g;
var _document = _window && _window.document;

g.LOCALIZATION_REL_PATH = "";

/**
 * Contains the Viewer's version.
 *
 * @type {string}
 * @global
 */
g.LMV_VIEWER_VERSION = BUILD_FLAG__BUILD_VERSION;

g.LMV_BUILD_TYPE = BUILD_FLAG__BUILD_TYPE;
g.LMV_RESOURCE_ROOT = "";

/** Allows for external code, e.g. collosseum tests, to check which version is used. */
g.LMV_IS_FLUENT_BUILD = BUILD_FLAG__FLUENT_PROFILE;

/**
 * When true, non-OTG resources (i.e. 2D documents, image files) will get fetched directly from DS.
 * When false, non-OTG resources will get fetched using OTG-DS proxy.
 * 
 * https://git.autodesk.com/A360/firefly.js/pull/4319
 */
g.USE_OTG_DS_PROXY = BUILD_FLAG__USE_OTG_DS_PROXY;

/**
 * When true, requests to Forge are authenticated with a cookie. 
 * When false, requests to Forge are authenticated with an Authentication header.
 * When undefined, the viewer will first try authentication via cookie, if 
 * that doesn't work it will fallback to using an Authentication header.
 *
 * @type {boolean|undefined}
 * @global
 * @default undefined
 */
g.LMV_THIRD_PARTY_COOKIE = isNodeJS() ? false : undefined;

if (g.LMV_VIEWER_VERSION.charAt(0) === 'v'){
    // remove prefixed 'v'
    // Required due to TeamCity build pipeline (LMV-1361)
    g.LMV_VIEWER_VERSION = g.LMV_VIEWER_VERSION.substr(1);
}


/**
 * When true, the viewer will favor loading the PDF file over the Leaflet derivative, 
 * ignoring the manifest value for `totalRasterPixels`. A true value will take precedence over {@link LMV_RASTER_PDF}.
 *
 * @type {boolean}
 * @default 
 * @global
 */
g.LMV_VECTOR_PDF = false;

/**
 * When true, the viewer will favor loading the Leaflet derivative over the PDF file,
 * ignoring the manifest value for `totalRasterPixels`. When {@link LMV_RASTER_PDF} is true, this value is ignored. 
 *
 * @type {boolean}
 * @default 
 * @global
 */
g.LMV_RASTER_PDF = true;

/**
 * When true, LMV will remove the Forge Logo spinner and the in canvas Forge logo
 * Note: We disable the branding for the fluent build. For the regular build this will be enabled.
 *
 * @private
 */
export let DISABLE_FORGE_LOGO = BUILD_FLAG__FLUENT_PROFILE;


/**
 * When true, LMV will remove the in canvas Forge logo. To remove both the in canvas and the spinner logos use DISABLE_FORGE_LOG
 *
 * @private
 */
export let DISABLE_FORGE_CANVAS_LOGO = true; // Switch to false to enable the in-canvas logo


// TODO:  This is here for now, until we find a better place for it.
//
/**
 * Returns the first source url found containing the given script name.
 *
 * @private
 * @param {string} scriptName - Script name.
 * @returns {HTMLScriptElement} The script element whose source location matches the input parameter.
 */
export function getScript(scriptName) {
    scriptName = scriptName.toLowerCase();
    var scripts = _document.getElementsByTagName('SCRIPT');
    if (scripts && scripts.length > 0) {
        for (var i = 0; i < scripts.length; ++i) {
            if (scripts[i].src && scripts[i].src.toLowerCase().indexOf(scriptName) !== -1) {
                return scripts[i];
            }
        }
    }
    return null;
}

/**
 * Inject a css file into the page.
 * There's a callback if you need to know when it gets downloaded (rare).
 * Accepts both relative and absolute URLs.
 *
 * @param cssUrl
 * @param callback
 * @param onError
 * @private
 */
export function injectCSS(cssUrl, callback, onError) {
    var href = cssUrl.indexOf('://') > 0 ? cssUrl : getResourceUrl(cssUrl);

    // Verify that we haven't downloaded it already
    var results = _document.getElementsByTagName('link');
    for (var i=0, len=results.length; i<len; i++) {
        if (results[i].href === href) {
            // Already downloaded
            callback && callback();
            return;
        }
    }

    // else, download it
    var s = _document.createElement("link");
    s.setAttribute('rel',"stylesheet");
    s.setAttribute('type',"text/css");
    s.setAttribute('href', href);
    if (callback) {
        s.onload = callback;
    }
    if (onError) {
        s.onerror = onError;
    }
    _document.head.appendChild(s);
}

/**
 * Download an HTML template.
 * If successful, will invoke callback(null, templateString)
 * If failure, will invoke callback("some error", null)
 *
 * @param templateUrl
 * @param callback
 * @private
 * @deprecated
 */
export function getHtmlTemplate(templateUrl, callback) {
    var href = templateUrl.indexOf('://') > 0 ? templateUrl : getResourceUrl(templateUrl);
    var request = new XMLHttpRequest();
    request.onload = requestLoad;
    request.onerror = requestError;
    request.ontimeout = requestError;
    request.open('GET', href, true);
    request.send();

    /**
     * @param err
     * @private
     */
    function requestError(err) {
        callback(err, null);
    }
    /**
     * @param event
     * @private
     */
    function requestLoad(event) {
        var content = event.currentTarget.responseText;
        callback(null, content);
    }

}

/**
 * Checks whether an experimental flag has been set into the viewer's' `config`
 * object, which happens to be the same as the extension's `options` object.
 *
 * @param flagName
 * @param config3d
 * @private
 */
export function isExperimentalFlagEnabled(flagName, config3d) {
    if (!config3d || !Array.isArray(config3d.experimental))
        return false;
    return config3d.experimental.indexOf(flagName) !== -1;
}


/**
 * Returns the full url of a resource with version.
 * The version will be determined from the LMV_VIEWER_VERSION variable.
 *
 * @private
 * @param {string} resourceRelativePath - The path of the resource relative to LMV_RESOURCE_ROOT.
 * @returns {string} The full resource path.
 */
export function getResourceUrl(resourceRelativePath) {
    return g.LMV_RESOURCE_ROOT + resourceRelativePath;
}


/**
 * Returns the query parameter value from window url
 * @param {string} name - Parameter name
 * @returns {string} - Parameter value
 * @alias Autodesk.Viewing.getParameterByName
 */
export function getParameterByName(name) {
    if (typeof window === "undefined") {
        return "";
    }
    return getParameterByNameFromPath(name, _window.location.href);
}

/**
 * Parameter from url
 * @param {string} name - Parameter name
 * @param {string} url - URL
 * @returns {string} - Parameter value
 * @alias Autodesk.Viewing.getParameterByNameFromPath
 */
export function getParameterByNameFromPath(name, url) {
    name = name.replace(/[[]/, "\\[").replace(/[\]]/, "\\]");
    var regexS = "[\\?&]" + name + "=([^&#]*)";
    var regex = new RegExp(regexS);
    var results = regex.exec(url);
    if (results == null)
        return "";
    else
        return decodeURIComponent(results[1].replace(/\+/g, " "));
}


/**
 * Creae a dom element
 * @param {string} str - String to generate DOM object
 * @private
 */
export function stringToDOM(str) {
    var d = _document.createElement("div");
    d.innerHTML = str;
    return d.firstChild;
}

/**
 * Convert to url-safe base 64 string
 * @param {string} str - String to convert
 * @returns - Url-safe base64 string
 * @alias Autodesk.Viewing.toUrlSafeBase64
 */
export function toUrlSafeBase64(str) {
    const base64 = btoa(str)
        .replace(/\+/g, '-') // Convert '+' to '-' (dash)
        .replace(/\//g, '_') // Convert '/' to '_' (underscore)
        .replace(/=+$/, ''); // Remove trailing '='

    return base64;
}

/**
 * Decode base64 string
 * @param {string} str - String to convert
 * @returns string after decoding from base64
 * @alias Autodesk.Viewing.fromUrlSafeBase64
 */
export function fromUrlSafeBase64(str) {
    str = str.replace(/-/g, '+');         // Convert '-' (dash) to '+'
    str = str.replace(/_/g, '/');         // Convert '_' (underscore) to '/'
    while (str.length % 4) { str += '='; } // Add padding '='

    if (isNodeJS()) {
        return Buffer.from(str, "base64").toString();
    } else {
        return atob(str);
    }
}
