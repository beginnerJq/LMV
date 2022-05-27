import { getScript, getResourceUrl } from './globals';
import { getGlobal } from './compat';

const _window = getGlobal();
const _document = _window.document;

// Class for loading external resources, such as scripts and stylesheets
class ResourceLoader {
  constructor() {
    // Contains one promise for each requested resource
    this.loadPromises = {};
  }

  /**
   * Returns the full url of a resource with version.
   * The version will be determined from the LMV_VIEWER_VERSION variable.
   * @private
   * @param {string} url
   * @returns {string} The full resource path.
   */
  getResourceUrl(url) {
    return url.indexOf('://') > 0 ? url : getResourceUrl(url);
  }

  /**
   * Load a script into the DOM
   * @param {string} url - relative or absolute url
   * @param {string} [libNamespace] - window property name expected to be loaded after library is downloaded. Can be undefined, too
   * @param {function} onSuccess - called when the script is loaded into the DOM
   * @param {function} [onError] - called when an error occurs
   */
  loadScriptIntoDom(url, onSuccess, onError) {
    const s = _document.createElement('SCRIPT');
    s.src = url;

    const clearCallbacks = function() {
      s.onerror = null;
      s.onload = null;
    };
    const errCallback = function(err) {
      clearCallbacks();
      onError && onError(new Error(`Error loading script ${url}, with error ${err}`));
    };
    const successCallback = function() {
      clearCallbacks();
      onSuccess();
    };

    s.onload = successCallback;
    s.onerror = errCallback;

    _document.head.appendChild(s);
  }

  /**
   *
   * @param {string} url - relative or absolute url
   * @param {string} libNamespace - window property name expected to be loaded after library is downloaded. Can be undefined, too
   * @returns {Promise} - of successful load
   */
  loadScript(url, libNamespace) {
    // library namespace already present, indicates already loaded
    if (libNamespace && _window[libNamespace] !== undefined) {
      return Promise.resolve();
    }

    url = this.getResourceUrl(url);
    const key = url.toLowerCase();
    if (key in this.loadPromises) {
      return this.loadPromises[key];
    }

    const script = getScript(url);
    if (script) {
      // already downloaded, resolve immediately
      this.loadPromises[key] = Promise.resolve();
    } else {
      // load the resource
      this.loadPromises[key] = new Promise((resolve, reject) => {
        this.loadScriptIntoDom(url, resolve, reject);
      });
    }

    return this.loadPromises[key];
  }

  /**
   *
   * @param {string} - valid url
   * @private
   */
  _getLink(url) {
    const results = _document.getElementsByTagName('link');
    for (let i = 0, len = results.length; i < len; i++) {
      if (results[i].href === url) {
        // Already downloaded
        return results[i];
      }
    }
    return null;
  }
}

// export an immutable singleton
export const theResourceLoader = new ResourceLoader();
Object.freeze(theResourceLoader);


// For backwards compatibility, keep exporting avp.loadDependency()
// TODO: Remove in v8.0.0
export function loadDependency(libNamespace, libNameOrUrl, callback, onError /*,amdName*/) {
  theResourceLoader.loadScript(libNameOrUrl, libNamespace)
    .then(() => {
       callback && callback();
    })
    .catch((err) => {
       onError && onError(err);
    });
}

