
import { logger } from "../logger/Logger";
import { getGlobal } from "../compat";

var _window = getGlobal();

var _supported;

function LocalStorageClass() {
    if (!this.isSupported()) {
        this._data = {};
    }
}

/**
 * Get an item from localStorage.
 * Returns null localStorage is not available.
 */
LocalStorageClass.prototype.getItem = function(key) {
    if (!this.isSupported()) {
        return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null;
    } else {
        return _window.localStorage.getItem(key);
    }
};

/**
 * Set an item into localStorage.
 * Does nothing if localStorage is not available OR if
 * the max quota is exceeded.
 */
LocalStorageClass.prototype.setItem = function(key, value) {
    if (!this.isSupported()) {
        this._data[key] = String(value);
    } else {
        try {
            _window.localStorage.setItem(key, value);
        } catch (eee) {
            logger.debug('avp.LocalStorage: Failed to setItem()');
        }
    }
};

/**
 * Removes an item from localStorage.
 * Does nothing if localStorage is not available.
 */
LocalStorageClass.prototype.removeItem = function(key) {
    if (!this.isSupported()) {
        delete this._data[key];
    } else {
        _window.localStorage.removeItem(key);
    }
};

/**
 * Empty all keys out of the storage
 */
LocalStorageClass.prototype.clear = function() {
    if (!this.isSupported()) {
        this._data = {};
    } else {
        _window.localStorage.clear();
    }
};

/**
 * Returns true is localStorage is supported.
 */
LocalStorageClass.prototype.isSupported = function() {
    const isLocalStorageSupported = () => {
        if (typeof window === "undefined") {
            return false;
        }

        try {
            const TEST_KEY = "lmv_viewer_test_localStorage";
            const storage = _window.localStorage; // This may assert if browsers disallow sites from setting data.

            if (!storage) {
                return false;
            }

            storage.setItem(TEST_KEY, "1");
            storage.removeItem(TEST_KEY);
            return true;
        } catch (error) {
            return false;
        }
    };

    if (_supported === undefined) {
        _supported = isLocalStorageSupported();
    }

    return _supported;
};

/**
 * Returns all keys from localStorage.
 */
LocalStorageClass.prototype.getAllKeys = function() {
    if (!_supported) {
        return Object.keys(this._data);
    } else {
        return Object.keys(_window.localStorage);
    }
};

/**
 * Global instance for interacting with localStorage.
 * @private
 */
export const LocalStorage = new LocalStorageClass();

