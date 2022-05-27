
export function getGlobal() {
    return (typeof window !== "undefined" && window !== null)
            ? window
            : (typeof self !== "undefined" && self !== null)
                ? self
                : global;
}

const _window = getGlobal();
const _document = _window && _window.document;

export const isBrowser = (typeof navigator !== "undefined");

export const isNodeJS = function() {
    return !isBrowser;
};

export let isIE11 = isBrowser && !!navigator.userAgent.match(/Edge|Trident\/7\./);

// Although the naming is misleading, isIE11 contains Edge too for some legacy reason.
// For backward compatibility, instead of renaming `isIE11` to `isIEOrEdge`, I just added `isIE11Only`.
export let isIE11Only = isBrowser && !!navigator.userAgent.match(/Trident\/7\./);

// fix IE events
if(typeof window !== "undefined" && isIE11){
    (function () {
        function CustomEvent ( event, params ) {
            params = params || { bubbles: false, cancelable: false, detail: undefined };
            var evt = _document.createEvent( 'CustomEvent' );
            evt.initCustomEvent( event, params.bubbles, params.cancelable, params.detail );
            return evt;
        }

        CustomEvent.prototype = _window.CustomEvent.prototype;

        _window.CustomEvent = CustomEvent;
    })();
}

// IE does not implement ArrayBuffer slice. Handy!
if (!ArrayBuffer.prototype.slice) {
    ArrayBuffer.prototype.slice = function(start, end) {
        // Normalize start/end values
        if (!end || end > this.byteLength) {
            end = this.byteLength;
        }
        else if (end < 0) {
            end = this.byteLength + end;
            if (end < 0) end = 0;
        }
        if (start < 0) {
            start = this.byteLength + start;
            if (start < 0) start = 0;
        }

        if (end <= start) {
            return new ArrayBuffer();
        }

        // Bytewise copy- this will not be fast, but what choice do we have?
        var len = end - start;
        var view = new Uint8Array(this, start, len);
        var out = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            out[i] = view[i];
        }
        return out.buffer;
    };
}

// IE doesn't implement Math.log2
(function(){
    Math.log2 = Math.log2 || function(x) {
        return Math.log(x) / Math.LN2;
    };
})();

//The BlobBuilder object
if (typeof window !== "undefined")
    _window.BlobBuilder = _window.BlobBuilder || _window.WebKitBlobBuilder || _window.MozBlobBuilder || _window.MSBlobBuilder;


// Launch full screen on the given element with the available method
export function launchFullscreen(element, options) {
    if (element.requestFullscreen) {
        element.requestFullscreen(options);
    } else if (element.mozRequestFullScreen) {
        element.mozRequestFullScreen(options);
    } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen(options);
    } else if (element.msRequestFullscreen) {
        element.msRequestFullscreen(options);
    }
};

// Exit full screen with the available method
export function exitFullscreen(_document) {
    if (!inFullscreen(_document)) {
        return;
    }
    if (_document.exitFullscreen) {
        _document.exitFullscreen();
    } else if (_document.mozCancelFullScreen) {
        _document.mozCancelFullScreen();
    } else if (_document.webkitExitFullscreen) {
        _document.webkitExitFullscreen();
    } else if (_document.msExitFullscreen) {
        _document.msExitFullscreen();
    }
};

// Determines if the browser is in full screen
export function inFullscreen(_document){

    // Special case for Ms-Edge that has webkitIsFullScreen with correct value
    // and fullscreenEnabled with wrong value (thanks MS)

    if ("webkitIsFullScreen" in _document) return !!(_document.webkitIsFullScreen);
    if ("fullscreenElement" in _document) return !!(_document.fullscreenElement);
    if ("mozFullScreenElement" in _document) return !!(_document.mozFullScreenElement);
    if ("msFullscreenElement" in _document) return !!(_document.msFullscreenElement);

    return !!(_document.querySelector(".viewer-fill-browser")); // Fallback for iPad
};

export function fullscreenElement(_document) {
    return _document.fullscreenElement || _document.mozFullScreenElement || _document.webkitFullscreenElement || _document.msFullscreenElement;
};

export function isFullscreenAvailable(element) {
    return element.requestFullscreen || element.mozRequestFullScreen || element.webkitRequestFullscreen || element.msRequestFullscreen;
};

/**
 * Returns true if full screen mode is enabled. 
 * @param {Document} _document
 * @return {Boolean} - true if full screen mode is enabled false otherwise.
 */
export function isFullscreenEnabled(_document) {
    return (
        _document.fullscreenEnabled ||
        _document.webkitFullscreenEnabled ||
        _document.mozFullScreenEnabled ||
        _document.msFullscreenEnabled
    );
}

// Get the IOS version through user agent.
// Return the version string of IOS, e.g. 14.1.1, 15.4 ... or empty string if version couldn't be detected
// User agents can be changed and thus might be inaccurate or incompatible at some point, but this pattern
// has been stable at least since IOS 5
export function getIOSVersion(ua) {
    ua = ua || navigator.userAgent;
    var match = ua.match(/OS ((\d+)_(\d+)(_(\d+))?) like Mac OS X/);
    if (!match && isIOSDevice()) {
        // On IPadOS Safari requests the desktop version by default with a MacOS user.
        // The major version seems to be reliable, but the minor version might be incorrect.
        match = ua.match(/\/((\d+)\.(\d+)(\.\d)?) Safari\//);
    }

    return match ? match[1].replace('_', '.') : "";
};

// Get the version of the android device through user agent.
// Return the version string of android device, e.g. 4.4, 5.0...
export function getAndroidVersion(ua) {
    ua = ua || navigator.userAgent;
    var match = ua.match(/Android\s([0-9\.]*)/);
    return match ? match[1] : false;
};

// Determine if this is a touch or notouch device.
export function isTouchDevice() {
    /*
    // Temporarily disable touch support through hammer on Android 5, to debug
    // some specific gesture issue with Chromium WebView when loading viewer3D.js.
    if (parseInt(getAndroidVersion()) == 5) {
        return false;
    }
    */

    return (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
};

// Since iOS 13, the iPad identifies itself as a desktop, so the only way to reliably detect is to search for multitouch capabilities
// (insofar as no other Apple device implements it)
const _isIOSDevice = isBrowser && (/ip(ad|hone|od)/.test(navigator.userAgent.toLowerCase()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
export function isIOSDevice() {
    return _isIOSDevice;
}

const _isAndroidDevice = isBrowser && (navigator.userAgent.toLowerCase().indexOf('android') !== -1);
export function isAndroidDevice() {
    return _isAndroidDevice;
}

export function isMobileDevice() {
    if (!isBrowser) return false;
    return isIOSDevice() || isAndroidDevice();
};

export function isPhoneFormFactor() {
    return (
        isMobileDevice() &&
        (_window.matchMedia('(max-width: 750px)').matches || _window.matchMedia('(max-height: 750px)').matches)
    );
}

export function isSafari() {
    if (!isBrowser) return false;
    var _ua = navigator.userAgent.toLowerCase();
    return (_ua.indexOf("safari") !== -1) && (_ua.indexOf("chrome") === -1);
};

export function isFirefox() {
    if (!isBrowser) return false;
    var _ua = navigator.userAgent.toLowerCase();
    return (_ua.indexOf("firefox") !== -1);
};

export function isChrome() {
    if (!isBrowser) return false;
    var _ua = navigator.userAgent.toLowerCase();
    return (_ua.indexOf("chrome") !== -1);
};

export function isMac() {
    if (!isBrowser) return false;
    var _ua = navigator.userAgent.toLowerCase();
    return  (_ua.indexOf("mac os") !== -1);
};

export function isWindows() {
    if (!isBrowser) return false;
    var _ua = navigator.userAgent.toLowerCase();
    return  (_ua.indexOf("win32") !== -1 || _ua.indexOf("windows") !== -1);
};

export function ObjectAssign(des, src) {
    for (var key in src) {
        if (src.hasOwnProperty(key))
            des[key] = src[key];
    }
    return des;
};

// Hack to work around Safari's use of pinch and pan inside the viewer canvas.
function disableTouchSafari(event) {
    var xOff = _window.hasOwnProperty("pageXOffset") ? _window.pageXOffset : _document.documentElement.scrollLeft;
    var yOff = _window.hasOwnProperty("pageYOffset") ? _window.pageYOffset : _document.documentElement.scrollTop;

    // event.pageX and event.pageY returned undefined through Chrome console device mode
    var pageX = typeof event.pageX === "undefined" ? event.changedTouches[0].pageX : event.pageX;
    var pageY = typeof event.pageY === "undefined" ? event.changedTouches[0].pageY : event.pageY;

    // If we aren't inside the canvas, then allow default propagation of the event
    var element = _document.elementFromPoint(pageX - xOff, pageY - yOff);
    if (!element || element.nodeName !== 'CANVAS')
        return true;
    // If it's a CANVAS, check that it's owned by us
    if (element.getAttribute('data-viewer-canvas') !== 'true')
        return true;
    // Inside the canvas, prevent the event from propagating to Safari'safely
    // standard handlers, which will pan and zoom the page.
    event.preventDefault();
    return false;
}

// Hack to work around Safari's use of pinch and pan inside the viewer canvas.
export function disableDocumentTouchSafari() {
    if (isMobileDevice() && isSafari()) {
        // Safari mobile disable default touch handling inside viewer canvas
        // Use capture to make sure Safari doesn't capture the touches and prevent
        // us from disabling them.
        _document.documentElement.addEventListener('touchstart', disableTouchSafari, true);
        _document.documentElement.addEventListener('touchmove', disableTouchSafari, true);
        _document.documentElement.addEventListener('touchcanceled', disableTouchSafari, true);
        _document.documentElement.addEventListener('touchend', disableTouchSafari, true);
    }
};

// Hack to work around Safari's use of pinch and pan inside the viewer canvas.
// This method is not being invoked explicitly.
export function enableDocumentTouchSafari() {
    if (isMobileDevice() && isSafari()) {
        // Safari mobile disable default touch handling inside viewer canvas
        // Use capture to make sure Safari doesn't capture the touches and prevent
        // us from disabling them.
        _document.documentElement.removeEventListener('touchstart', disableTouchSafari, true);
        _document.documentElement.removeEventListener('touchmove', disableTouchSafari, true);
        _document.documentElement.removeEventListener('touchcanceled', disableTouchSafari, true);
        _document.documentElement.removeEventListener('touchend', disableTouchSafari, true);
    }
};


// Convert touchstart event to click to remove the delay between the touch and
// the click event which is sent after touchstart with about 300ms deley.
// Should be used in UI elements on touch devices.
export function touchStartToClick(e) {
    // Buttons that activate fullscreen are a special case. The HTML5 fullscreen spec
    // requires the original user gesture signal to avoid a security issue.  See LMV-2396 and LMV-2326
    if (e.target.className && (e.target.className.indexOf("fullscreen") > -1
        || e.target.className.indexOf("webvr") > -1
        || e.target.className.indexOf("webxr") > -1))
        return;
    e.preventDefault();  // Stops the firing of delayed click event.
    e.stopPropagation();
    e.target.click();    // Maps to immediate click.
}

//Safari doesn't have the Performance object
//We only need the now() function, so that's easy to emulate.
(function() {
    var global = getGlobal();
    if (!global.performance)
        global.performance = Date;
})();

// Polyfill for IE and Safari
// https://developer.mozilla.org/de/docs/Web/JavaScript/Reference/Global_Objects/Number/isInteger
Number.isInteger = Number.isInteger || function(value) {
    return typeof value === "number" &&
        isFinite(value) &&
        Math.floor(value) === value;
};

// Polyfill for IE
String.prototype.repeat = String.prototype.repeat || function(count) {
    if (count < 1) return '';
    var result = '', pattern = this.valueOf();
    while (count > 1) {
        if (count & 1) result += pattern;
        count >>= 1, pattern += pattern;
    }
    return result + pattern;
};

// Polyfill for IE
// https://github.com/jonathantneal/array-flat-polyfill/blob/master/src/polyfill-flat.js
if (!Array.prototype.flat) {
	Object.defineProperty(Array.prototype, 'flat', {
		value: function flat () {
			var depth = isNaN(arguments[0]) ? 1 : Number(arguments[0]);

			return depth ? Array.prototype.reduce.call(this, function (acc, cur) {
				if (Array.isArray(cur)) {
					acc.push.apply(acc, flat.call(cur, depth - 1));
				} else {
					acc.push(cur);
				}

				return acc;
			}, []) : Array.prototype.slice.call(this);
		}
	});
}

// Polyfill for IE
// It doesn't support negative values for start and end; it complicates the code using this function.
if (!Array.prototype.fill) {
    Object.defineProperty(Array.prototype, "fill", {
        enumerable: false,
        value: function(value, start, end) {
            start = (start === undefined) ? 0 : start;
            end = (end === undefined) ? this.length : end;
            for (var i=start; i<end; ++i) 
                this[i] = value;
        }
    });
}
// Polyfill for IE
Int32Array.prototype.lastIndexOf = Int32Array.prototype.lastIndexOf || function(searchElement, fromIndex) {
    return Array.prototype.lastIndexOf.call(this, searchElement, fromIndex);
};

// Polyfill for IE
// It doesn't support negative values for start and end; it complicates the code using this function.
if (!Array.prototype.find) {
    Object.defineProperty(Array.prototype, "find", {
        enumerable: false,
        value: function(callback, _this) {
            var len = this.length;
            for (var i=0; i<len; ++i) {
                var item = this[i];
                if (callback.call(_this, item, i, this))
                    return item;
            }
            return undefined;
        }
    });
}

// Polyfill for IE
if (typeof Object.assign != 'function') {
    // Must be writable: true, enumerable: false, configurable: true
    Object.defineProperty(Object, "assign", {
        value: function assign(target, varArgs) { // .length of function is 2
            'use strict';
            if (target == null) { // TypeError if undefined or null
                throw new TypeError('Cannot convert undefined or null to object');
            }

            var to = Object(target);

            for (var index = 1; index < arguments.length; index++) {
                var nextSource = arguments[index];

                if (nextSource != null) { // Skip over if undefined or null
                    for (var nextKey in nextSource) {
                        // Avoid bugs when hasOwnProperty is shadowed
                        if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
                            to[nextKey] = nextSource[nextKey];
                        }
                    }
                }
            }
            return to;
        },
        writable: true,
        configurable: true
    });
}

// Polyfill for IE and iOS devices
if (typeof window !== "undefined" && (isIE11 || isIOSDevice()) && !HTMLCanvasElement.prototype.toBlob) {
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
        value: function (callback, type, quality) {
        var canvas = this;
        setTimeout(function() {
    
            var binStr = atob( canvas.toDataURL(type, quality).split(',')[1] ),
                len = binStr.length,
                arr = new Uint8Array(len);
    
            for (var i = 0; i < len; i++ ) {
            arr[i] = binStr.charCodeAt(i);
            }
    
            callback( new Blob( [arr], {type: type || 'image/png'} ) );
    
        });
        }
    });
}

// Polyfill for IE (LMV-3823)
if (!Uint8Array.prototype.slice) {

  // This will work for genuine arrays, array-like objects, 
  // NamedNodeMap (attributes, entities, notations),
  // NodeList (e.g., getElementsByTagName), HTMLCollection (e.g., childNodes),
  // and will not fail on other DOM objects (as do DOM elements in IE < 9)
  Uint8Array.prototype.slice = function(begin, end) {
    // IE < 9 gets unhappy with an undefined end argument
    end = (typeof end !== 'undefined') ? end : this.length;

    // For native Array objects, we use the native slice function
    if (Object.prototype.toString.call(this) === '[object Array]'){
      return _slice.call(this, begin, end); 
    }

    // For array like object we handle it ourselves.
    var i, cloned = [],
      size, len = this.length;

    // Handle negative value for "begin"
    var start = begin || 0;
    start = (start >= 0) ? start : Math.max(0, len + start);

    // Handle negative value for "end"
    var upTo = (typeof end == 'number') ? Math.min(end, len) : len;
    if (end < 0) {
      upTo = len + end;
    }

    // Actual expected size of the slice
    size = upTo - start;

    if (size > 0) {
      cloned = new Array(size);
      if (this.charAt) {
        for (i = 0; i < size; i++) {
          cloned[i] = this.charAt(start + i);
        }
      } else {
        for (i = 0; i < size; i++) {
          cloned[i] = this[start + i];
        }
      }
    }

    return cloned;
  }
}
