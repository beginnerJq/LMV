
import * as et from "./EventTypes";
import { logger } from "../logger/Logger";
import { GlobalManagerMixin } from "../application/GlobalManagerMixin";
import { EnumType } from './ProfileSettings';
import { LocalStorage } from './LocalStorage';

/**
 * Application preferences.
 *
 * Optionally uses web storage.
 *
 * Each preference value can have tags associated to them. Developer supported tags are:
 * - 'ignore-producer'
 * - 'no-storage'
 * - '2d'
 * - '3d'
 *
 * Use tag 'ignore-producer' in extensions to avoid having developer-defined
 * render settings overridden by the loaded file.
 *
 * Use tag 'no-storage' in extensions to avoid having User Preferences (from Settings Panel) override
 * default or developer-defined preferences. Useful for render settings.
 *
 * Preferences may apply to all model types, only 2D models (with tag '2d') or 3D models only (with tag '3d').
 *
 * @constructor
 * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer instance.
 * @param {object} options - Contains configuration parameters used to do initializations.
 * @param {boolean} [options.localStorage] - Whether values get stored and loaded back
 * from localStorage. Defaults to `true`.
 * @param {string} [options.prefix] - A string to prefix preference names in web storage.
 * Defaults to `'Autodesk.Viewing.Preferences.'`.
 * @alias Autodesk.Viewing.Private.Preferences
 */
export class Preferences {
    constructor(viewer, opts) {

        this.viewer = viewer;
        let self = this;
        this.options = {};
        this.storageCache = {};
        self.setGlobalManager(viewer.globalManager);
        self.setWebStorageKey('Default');

        // Backwards compatibility for when the 2nd argument was 'prefix' string
        if (typeof opts === 'string') {
            this.options = {
                prefix: opts
            };
        }
        this.options = { ...opts };

        if (!this.options.prefix) {
            this.options.prefix = 'Autodesk.Viewing.Preferences.';
        }
        if (!Object.prototype.hasOwnProperty.call(this.options, 'localStorage')) {
            this.options.localStorage = true;
        }
        this.defaults = {}; // Default values
        this.callbacks = {}; // Changed and Reset listeners
        this.tags = {};
        this.useLocalStorage = this.options.localStorage && LocalStorage.isSupported();


        viewer.addEventListener(et.PREF_CHANGED_EVENT, (event) => {
            var callbacksForName = this.callbacks[event.name];
            if (callbacksForName) {
                callbacksForName.forEach((callbackForName) => {
                    var callback = callbackForName.changed;
                    if (callback && typeof callback === 'function') {
                        callback(event.value);
                    }
                });
            }
        });

        viewer.addEventListener(et.PREF_RESET_EVENT, (event) => {
            var callbacksForName = this.callbacks[event.name];
            if (callbacksForName) {
                callbacksForName.forEach((callbackForName) => {
                    var callback = callbackForName.reset;
                    if (callback && typeof callback === "function") {
                        callback(event.value);
                    }
                });
            }
        });

        // Proxy added for backwards compatibility, settings
        // can be accessed as properties of the preferences object.
        const handler = {
            get: function(target, property) {
                return property in target
                    ? target[property]
                    : target.storageCache[property];
            }
        };

        return new Proxy(this, handler);
    }

    /**
     * Set the web storage key where preference will be saved.
     * No-Op if tag 'no-storage' is associated to the name.
     * @param {string} storageKey - Web Storage key.
     * @private
     */
    setWebStorageKey(storageKey) {
        this.storageKey = storageKey;
    }

    /**
     * Get/set preference value in web storage.
     * No-Op if tag 'no-storage' is associated to the name.
     * @param {string} name - Preference name.
     * @param {*} [value] - Preference value.
     * @returns {*} Preference value or undefined if not available.
     * @private
     */
    webStorage(name, value) {
        if (this.useLocalStorage) {

            // Avoid storage for 'no-storage' tags
            if (this.hasTag(name, 'no-storage')) {
                return undefined;
            }

            // Prefix our names, so we don't pollute the localStorage of the embedding application            
            const prefixedStorageKey = this.getLocalStoragePrefix() + this.storageKey;

            let preferences = LocalStorage.getItem(prefixedStorageKey);
            preferences = JSON.parse(preferences || '{}');

            // If value is specified, we set this value in localStorage.
            // Otherwise,  the value from local storage is returned.
            if (value !== undefined) {
                if (value instanceof EnumType) {
                    value = value.toString();
                }
                preferences[name] = value;
                LocalStorage.setItem(prefixedStorageKey, JSON.stringify(preferences));
            } else {
                value = preferences[name];
                if (value !== undefined) {
                    try {
                        value = JSON.parse(value);
                        if(value.type === '__enum') {
                            value = EnumType.deSerialize(value);
                        }
                    } catch (e) {
                        logger.log('Preferences: Cannot deserialize value =' + value);
                        value = undefined;
                    }
                }
            }
            return value;
        }
        return undefined;
    }

    /**
     * Get preference value in web storage.
     * No-Op if tag 'no-storage' is associated to the name.
     * @param {string} name - Preference name.
     * @returns {*} Preference value or undefined if not available.
     * @private
     */
    getPrefFromLocalStorage(name) {
        return this.webStorage(name);
    }

    /**
     * Set preference value in web storage.
     * No-Op if tag 'no-storage' is associated to the name.
     * @param {string} name - Preference name.
     * @param {*} value - Preference value.
     * @returns {*} Preference value or undefined if not available.
     * @private
     */
    setPrefInLocalStorage(name, value) {
        return this.webStorage(name, value);
    }

    /**
     * Adds a preference name + default value, tries to load value from web storage.
     * @param {string} name - Preference name.
     * @param {*} defaultValue
     * @private
     */
    addPref(name, defaultValue) {
        if (typeof name !== 'string' || typeof this.storageCache[name] === 'function') {
            logger.log('Preferences: invalid name=' + name);
            return;
        }

        // Use a clone of the EnumType to protect from external object changes.
        if (defaultValue instanceof EnumType) {
            defaultValue = defaultValue.clone();
        }

        // Use default if nothing in web storage.
        const value = this.webStorage(name);
        this.storageCache[name] = value ? value : defaultValue;
        this.tags[name] = {};
    }

    /**
     * Load preference values from web storage/defaults.
     * @param {object} defaultValues - Preference names and their default values.
     */
    load(defaultValues) {
        this.defaults = defaultValues;
        for (var name in this.defaults) {
            if (Object.prototype.hasOwnProperty.call(this.defaults, name)) {
                this.addPref(name, this.defaults[name]);
            }
        }
    }

    /**
     * Add tags for a specific preference name.
     * @param {string} name - preference name
     * @param {string[]|string} tags - tags for the preference.
     * @returns {boolean} - true if the tags were added, false otherwise.
     */
    addTags(name, tags) {
        if (!tags || !name) return false;
        tags = !Array.isArray(tags) ? [tags] : tags;

        for (var i = 0; i < tags.length; ++i) {
            this.tag(tags[i], name);
        }
        return true;
    }

    /**
     * Adds a tag to the specified preferences.
     * These are used by reset().
     * @param {string} tag
     * @param {string[]|string} [names] - Preference names, default all preferences.
     */
    tag(tag, names) {
        if (tag) {
            if (!names) {
                names = Object.keys(this.defaults);
            } else if (!Array.isArray(names)) {
                names = [names];
            }
            for (var i = 0; i < names.length; ++i) {
                if (this.tags[names[i]]) {
                    this.tags[names[i]][tag] = true;
                }
            }
        }
    }

    /**
     * Removes a tag from the specified preferences.
     * These are used by reset().
     * @param {string} tag
     * @param {string[]|string} [names] - Preference names, default all preferences.
     */
    untag(tag, names) {
        if (tag) {
            if (!names) {
                names = Object.keys(this.defaults);
            } else if (!Array.isArray(names)) {
                names = [names];
            }
            for (var i = 0; i < names.length; ++i) {
                if (this.tags[names[i]]) {
                    this.tags[names[i]][tag] = false;
                }
            }
        }
    }

    /**
     * Checks whether a tag is associated to a name
     * @param {string} name - Preference name
     * @param {string} tag - The tag to check for
     */
    hasTag(name, tag) {
        var nameKey = this.tags[name];
        if (nameKey) {
            return nameKey[tag] === true;
        }
        return false;
    }

    /**
     * Adds a new preference name + default value.
     * This preference was not previously loaded via load().
     * @param {string} name - Preference name.
     * @param {*} defaultValue - Preference default value.
     * @param {string[]|string} [tags] - Optional tags.
     * @param {boolean} [override] - Override existing preference if it already exists and fires an event.
     * @returns {boolean} true if the preference was added.
     */
    add(name, defaultValue, tags, override) {
        if (Object.prototype.hasOwnProperty.call(this.defaults, name) && !override) {
            logger.log("Preferences: " + name + " already exists");

        } else {
            this.setDefault(name, defaultValue);
            this.addPref(name, defaultValue);

            this.addTags(name, tags);
            // dispatch the preference event when overriding the preference.
            if (override) {
                this.viewer.dispatchEvent({
                    type: et.PREF_CHANGED_EVENT,
                    name: name,
                    value: this.get(name),
                });
            }
            return true;
        }
        return false;
    }


    /**
     * Update the preference's default value.
     * @param {string} name - Preference name.
     * @param {*} defaultValue - Preference default value.
     */
    setDefault(name, defaultValue) {
        if (!name || defaultValue == null) return;
        
        if (defaultValue instanceof EnumType) {
            this.defaults[name] = defaultValue.clone();
        }
        else {
            this.defaults[name] = defaultValue;
        }
    }

    /**
     * Removes an existing preference.
     * @param {string} name - Preference name.
     * @param {boolean} [removeFromWebStorage=false] - True to clear the web storage entry for this preference.
     * @returns {boolean} True if the preference was removed.
     */
    remove(name, removeFromWebStorage) {
        if (Object.prototype.hasOwnProperty.call(this.defaults, name)) {
            delete this.defaults[name];
            delete this.tags[name];

            if (this.storageCache) {
                delete this.storageCache[name];
            }

            if (removeFromWebStorage) {
                this.deleteFromWebStorage(name);
            }

            return true;
        }
        return false;
    }

    deleteFromWebStorage(name) {
        if (this.useLocalStorage) {
            const prefixedStorageKey = this.getLocalStoragePrefix() + this.storageKey;
            let preferences = LocalStorage.getItem(prefixedStorageKey);
            preferences = JSON.parse(preferences || '{}');
            delete preferences[name];

            LocalStorage.setItem(prefixedStorageKey, JSON.stringify(preferences));
        }
    }

    /**
     * Removes preferences from the browser's localStorage that are associated with the options prefix.
     */
    clearWebStorage() {
        const prefix = this.getLocalStoragePrefix();
        if (this.useLocalStorage) {
            for (let key of LocalStorage.getAllKeys()) {
                if (key.indexOf(prefix) !== -1) {
                    LocalStorage.removeItem(key);
                }
            }
        }
    }

    /**
     * Reset preferences to default values.
     * If a tag is specified, then only certain preferences are reset.
     * @param {string} [tag] - Optional tag.
     * @param {boolean} [include=true] True to reset only preferences with matching tags.
     */
    reset(tag, include) {
        if (tag && include === undefined) {
            include = true;
        }

        for (var name in this.defaults) {
            if (Object.prototype.hasOwnProperty.call(this.defaults, name)) {
                if (tag) {
                    var tagged = !!this.tags[name][tag];
                    if ((include && !tagged) || (!include && tagged)) {
                        continue;
                    }
                }

                if (this.set(name, this.defaults[name], false)) {
                    this.viewer.dispatchEvent({
                        type: et.PREF_RESET_EVENT,
                        name: name,
                        value: this.get(name)
                    });
                }

                this.deleteFromWebStorage(name);
            }
        }
    }

    /**
     * Get the web storage prefix used to store preferences.
     * @returns {String} - Prefix value.
     */
    getLocalStoragePrefix() {
        return this.options.prefix;
    }
    
    /**
     * Get named preference value.
     * Shortcut: prefs[name]
     * @param {string} name - Preference name.
     * @returns {*} Preference value.
     */
    get(name) {
        return (this.storageCache[name] instanceof EnumType)
            ? this.storageCache[name].value
            : this.storageCache[name];
    }

    /**
     * Set named preference value.
     * Value is not persisted if tag 'no-storage' is set.
     * Do not use shortcut prefs[name] = value.
     * @param {string} name - Preference name.
     * @param {*} value - Preference value.
     * @param {boolean} [notify=true] - If true then PREF_CHANGED_EVENT is fired.
     * @returns {boolean} True if the value changed, false otherwise.
     */
    set(name, value, notify) {
        const fieldValue = value instanceof EnumType ? value.value : value;
        
        function isEqual(val1, val2) {
            const getVal = (v) => {
                return typeof v === 'object' ? JSON.stringify(v) : v;
            };
            return getVal(val1) === getVal(val2);
        }
        // Updates the cached value as well as the value in the web storage
        // TODO: This logic assumes the value is already cached, more robust solution will not assume that.
        if (!isEqual(this.get(name), fieldValue)) {
            if (this.storageCache[name] instanceof EnumType) {
                this.storageCache[name].value = fieldValue;
            } else if (value instanceof EnumType) {
                this.storageCache[name] = value.clone();
            }
            else {
                this.storageCache[name] = fieldValue;
            }

            // LMV-5803: Do use the variable "value" when storing the preference's value in the localstorage. 
            // We need to store the entire serialized enumType (not just enumType.value) to restore these preferences between viewer sessions.  
            this.webStorage(name, this.storageCache[name]);

            if (notify === undefined || notify) {
                this.viewer.dispatchEvent({
                    type: et.PREF_CHANGED_EVENT,
                    name: name,
                    value: this.get(name)
                });
            }

            return true;
        }
        return false;
    }

    /**
     * Dispatches an event for the specific preference.
     */
    dispatchEvent(name) {
        const value = this.get(name);
        const type = et.PREF_CHANGED_EVENT;
        this.viewer.dispatchEvent({ type, name, value });
    }

    /**
     * Listen for preference changed and reset events.
     * @param {string} name - Preferences name.
     * @param {function} onChangedCallback - Function called when preferences are changed.
     * @param {function} onResetCallback - Function called when preferences are reset.
     */
    addListeners(name, onChangedCallback, onResetCallback) {
        if (!this.callbacks[name])
            this.callbacks[name] = [];

        // Reuse the onChangedCallback if the resetCallback is not passed.
        if (!onResetCallback) onResetCallback = onChangedCallback;
        this.callbacks[name].push({ changed: onChangedCallback, reset: onResetCallback });
    }

    /**
     * Remove listeners for preference changed and reset events.
     * All of the registered callbacks are removed if the onChangedCallback and the onResetCallback are not passed in.
     * @param {string} name - Preferences name.
     * @param {function} [onChangedCallback] - callback for preference changes.
     * @param {function} [onResetCallback] - callback for preference reset.
     */
    removeListeners(name, onChangedCallback, onResetCallback) {
        if (this.callbacks[name] === undefined) return;

        // This is the old functionality. If the onChangedCallback and the onResetCallback are not passed in delete all of the callbacks.
        // TODO: Remove this for the next breaking change (v8.0.0).
        if (!onChangedCallback && !onResetCallback) {
            delete this.callbacks[name];
            return;
        }

        if (!onResetCallback) {
            onResetCallback = onChangedCallback;
        }

        for (let i = 0; i < this.callbacks[name].length; ++i) {
            if (this.callbacks[name][i].changed === onChangedCallback && this.callbacks[name][i].reset === onResetCallback) {
                this.callbacks[name].splice(i, 1);
                break;
            }
        }
    }

    /**
     * Clears all preference listeners that are added by {@link Autodesk.Viewing.Private.Preferences#addListeners}.
     */
    clearListeners() {
        this.callbacks = {};
    }

    /**
     * Whether values are stored into browser's localStorage or read back from it.
     * @param {boolean} useIt - true to use browser's `localStorage`
     */
    setUseLocalStorage(useIt) {
        this.useLocalStorage = !!useIt;
    }
}

GlobalManagerMixin.call(Preferences.prototype);