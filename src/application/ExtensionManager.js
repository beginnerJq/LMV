import { logger } from "../logger/Logger";
import { theResourceLoader } from "../resource-loader";
import * as et from "./EventTypes";
import { analytics } from '../analytics';
import { ExtensionEventsMixin } from './ExtensionEventsMixin';

/**
 * The ExtensionManager manages all the extensions available to the viewer.
 * Register, retrieve, and unregister your extension using the singleton `Autodesk.Viewing.theExtensionManager`.
 *
 * You can load/unload your registered extension into a Viewer by invoking 
 * {@link #loadExtension|viewer.loadExtension(id, options)} and	
 * {@link #unloadExtension|viewer.unloadExtension(id)}, respectively.	
 * 	
 * @memberof Autodesk.Viewing
 * @alias Autodesk.Viewing.ExtensionManager
 */
class ExtensionManager {
    /**
     * @memberof Autodesk.Viewing	
     * @alias Autodesk.Viewing.ExtensionManager	
     * @constructor	
     */
    constructor() {
        // map of extension id : { EXTENSION_CLASS, externalPathOrCallback, downloadPromise }
        this.registeredExtensions = new Map();
    }

    /**
     * Registers a new extension with the given id.
     *
     * @param {string} extensionId - The string id of the extension.
     * @param {Extension} extensionClass - The Extension-derived class representing the extension.
     * @returns {boolean} - True if the extension was successfully registered.
     * @alias Autodesk.Viewing.ExtensionManager#registerExtension
     */
    registerExtension(extensionId, extensionClass) {
        if (this.registeredExtensions.has(extensionId)) {
            const extension = this.registeredExtensions.get(extensionId);

            // extension.EXTENSION_CLASS will be present for built-in extension or
            // if the extension has been downloaded and regisrered already
            if (extension.EXTENSION_CLASS) {
                return false;
            } else {
                // We will get here when the extension is downloaded and registered first time
                extension.EXTENSION_CLASS = extensionClass;
            }
        } else {
            this.registeredExtensions.set(extensionId, { EXTENSION_CLASS: extensionClass });    
        }
        return true;
    }

    /**
     * Returns the class representing the extension with the given id.
     *
     * @param {string} extensionId - The string id of the extension.
     * @returns {Extension|null} - The Extension-derived class if one was registered; null otherwise.
     * @alias Autodesk.Viewing.ExtensionManager#getExtension
     */
    getExtensionClass(extensionId) {
        if (this.registeredExtensions.has(extensionId)) {
            return this.registeredExtensions.get(extensionId).EXTENSION_CLASS;
        }
        return null;
    }

    /**
     * Unregisters an existing extension with the given id.
     *
     * @param {string} extensionId - The string id of the extension.
     * @returns {boolean} - True if the extension was successfully unregistered.
     * @alias Autodesk.Viewing.ExtensionManager#unregisterExtension
     */
    unregisterExtension(extensionId) {
        if (this.registeredExtensions.has(extensionId)) {
            this.registeredExtensions.delete(extensionId);
            return true;
        }
        return false;
    }

    /**
     * Registers an extension that needs to be downloaded before using it.
     * The Viewer ships with some extensions that are not bundled, but can be runtime-fetched.
     *
     * @param {string} extensionId - The string id of the extension.
     * @param {string | function} urlPathOrCallback - The url from where it needs to be pulled from. Can be a relative or an absolute path.
     *                                                Optionally, this can be a callback function that defers the loading to the client
     *                                                application. Useful for webpack import style loading. Callback must return a promise
     *                                                that resolves when loading is finished.
     * @param {string[]} dependencies               - Optional list of extension IDs, whose bundles are needed before this extension can be built.
     * @returns {boolean} - True if the extension was successfully registered.
     * @alias Autodesk.Viewing.ExtensionManager#registerExternalExtension
     */
    registerExternalExtension(extensionId, urlPathOrCallback, dependencies) {
        if (this.registeredExtensions.has(extensionId)) {
            return false;
        }
        // EXTENSION_CLASS will be null initially, and set to the class  
        // after the extension is downloaded
        this.registeredExtensions.set(extensionId, { EXTENSION_CLASS: null, externalPathOrCallback: urlPathOrCallback, dependencies: dependencies });
        return true;
    }


    /**
     * Returns the url path from where to download the extension; null if not registered through registerExternalExtension().
     *
     * @param {string} extensionId - The string id of the extension.
     * @returns {url|null} - The url from where to download the extension; null if not download is needed.
     * @alias Autodesk.Viewing.ExtensionManager#getExternalPath
     */
    getExternalPath(extensionId) {
        if (this.registeredExtensions.has(extensionId)) {
            return this.registeredExtensions.get(extensionId).externalPathOrCallback;
        }
        return null;
    }

    /**
     * Gets a list of all the extensions that are available for usage.
     * Some are already available in memory, while others may require
     * an additional file to be downloaded prior to its usage.
     * @returns {string[]}
     * @alias Autodesk.Viewing.ExtensionManager#getRegisteredExtensions
     */
    getRegisteredExtensions() {
        return Array.from(this.registeredExtensions).map(([key, val]) => ({
            id: key,
            inMemory: !!val.EXTENSION_CLASS,
            isAsync: !!val.externalPathOrCallback
        }));
    }

    /**
     * Download the extension and return its downloading promise
     * @param {string} extensionId 
     * @returns {Promise} resolves when the extension class is ready for usage.
     */
    downloadExtension(extensionId) {

        if (!this.registeredExtensions.has(extensionId)) {
            return Promise.reject('Extension not found: ' + extensionId + '. Has it been registered(1)?');
        }

        const extensionState = this.registeredExtensions.get(extensionId);        

        if (!extensionState.externalPathOrCallback) {
            return Promise.reject('Extension not found: ' + extensionId + '. Has it been registered(2)?');
        }

        if (extensionState.downloadPromise) {
            // extension download is in progess
            return extensionState.downloadPromise;
        }

        // If the extension has dependencies, download the corresponding bundles first
        const dependencies = extensionState.dependencies || [];
        const dependencyLoads = dependencies.map(extId => this.downloadExtension(extId));
        const dependencyPromise = Promise.all(dependencyLoads);

        extensionState.downloadPromise = dependencyPromise.then(() => {
            if (typeof extensionState.externalPathOrCallback === 'string') {    // Create a new download
                return theResourceLoader.loadScript(extensionState.externalPathOrCallback, extensionId);
            } else {    // A callback to download was provided, must return a promise
                return extensionState.externalPathOrCallback();
            }
        }).then(() => {
            // No longer need the promise
            delete extensionState.downloadPromise;

            if (!extensionState.EXTENSION_CLASS) {
                // After downloading, the downloaded script would call
                // theExtensionManager.registerExtension(), with the extension class
                // Not having a class means the extension did not call registerExtension
                throw new Error('Extension not found: ' + extensionId + '. Has it been registered(3)?');
            }

            // resolve with the extension class
            return extensionState.EXTENSION_CLASS;
        });

        return extensionState.downloadPromise;
    }

    /**
     * Iterates over each registered Extension class and invokes
     * static method 'populateDefaultOptions' if available.
     * 
     * The objective is to gather all supported configuration options
     * across all extensions.
     * @private
     */
    popuplateOptions(options) {
        this.registeredExtensions.forEach(ext => {
            ext.EXTENSION_CLASS.populateDefaultOptions(options);
        });
    }

    /**
     * Is the extension being downloaded?
     * @param {string} extensionId 
     */
    isDownloading(extensionId) {
        if (this.registeredExtensions.has(extensionId)) {
            return !!this.registeredExtensions.get(extensionId).downloadPromise;
        }
        return false;
    }

    /**
     * Is the extension class available?
     * @param {string} extensionId 
     */
    isAvailable(extensionId) {
        return !!this.getExtensionClass(extensionId);
    }

}

export const theExtensionManager =  new ExtensionManager();

/***
 * Augments a class by extension load/unload functionality.
 */
export const ExtensionMixin = function() {};

ExtensionMixin.prototype = {

    /**
     * Loads the extension with the given id and options.
     *
     * @memberof! Autodesk.Viewing.Viewer3D#
     * @param {string} extensionId - The string id of the extension.
     * @param {Object} options - An optional dictionary of options.
     *
     * @returns {Promise} - Resolves with the extension requested.
     */
    loadExtension : function(extensionId, options) {
        // map of extensionId : instance
        this.loadedExtensions = this.loadedExtensions || {};

        
        // Is the extension registered and the extension
        // constructor available?
        if (theExtensionManager.isAvailable(extensionId)) {
            return this.loadExtensionLocal(extensionId, options);
        }

        // requires download
        this.loadExtensionPromises = this.loadExtensionPromises || {};
        if (extensionId in this.loadExtensionPromises) {
            return this.loadExtensionPromises[extensionId];
        }
        
        this.loadExtensionPromises[extensionId] = theExtensionManager.downloadExtension(extensionId).then(() => {

            // Don't need the downloading promise anymore
            delete this.loadExtensionPromises[extensionId];

            // Abort if a teardown is in progress
            if (!this.loadedExtensions) {
                logger.info(`Abort loadExtension('${extensionId}') - teardown in progress`);
                return; // This is not considered an error
            }

            // user unloaded an extension while download is in progress
            if (this.cancelledExtensions && extensionId in this.cancelledExtensions) {
                delete this.cancelledExtensions[extensionId];
                throw new Error(`Abort loadExtension('${extensionId}') - extension has been unloaded`);
            }

            return this.loadExtensionLocal(extensionId, options);
        });

        return this.loadExtensionPromises[extensionId];
    },

    /**
     * Returns the loaded extension.
     * @memberof! Autodesk.Viewing.Viewer3D#
     * @param {string} extensionId - The string id of the extension.
     * @param {function} [callback] - That receives an extension instance as argument.
     * @returns {?Object} - Extension.
     */
    getExtension : function (extensionId, callback) {   
        var ext = (this.loadedExtensions && extensionId in this.loadedExtensions) ? this.loadedExtensions[extensionId] : null;
        if (ext && callback) {
            callback(ext);
        }
        return ext;
    },

    /**
     * Returns a promise with the loaded extension.
     * @memberof! Autodesk.Viewing.Viewer3D#
     * @param {string} extensionId - The string id of the extension.
     * @returns {Promise} - Resolves with the loaded extension.
     */
    getExtensionAsync : function (extensionId) {
        let extension = this.getExtension(extensionId);

        if (extension) {
            return Promise.resolve(extension);
        } else {
            return new Promise(resolve => {
                this.addEventListener(et.EXTENSION_LOADED_EVENT, function onExtensionLoaded(event) {
                    if (event.extensionId === extensionId) {
                        this.removeEventListener(et.EXTENSION_LOADED_EVENT, onExtensionLoaded);
                        extension = this.getExtension(extensionId);
                        resolve(extension);
                    }
                });
            });
        }
    },

    /**
     * Unloads the extension with the given id.
     *
     * @memberof! Autodesk.Viewing.Viewer3D#
     * @param {string} extensionId - The string id of the extension.
     * @returns {boolean} - True if the extension was successfully unloaded.
     */
    unloadExtension : function (extensionId) {
        this.cancelledExtensions = this.cancelledExtensions || {};
        if (theExtensionManager.isDownloading(extensionId)) {
            // cancel mid download
            this.cancelledExtensions[extensionId] = true; 
            return false;
        }

        let success = false;
        const ext = this.getExtension(extensionId);

        if (ext) {
            success = ext.unload();
            logger.info('Extension unloaded: ' + extensionId);
            delete this.loadedExtensions[extensionId];

            analytics.track('viewer.extensionManager.extensionUnloaded', {
                extensionId: extensionId
            });

            this.dispatchEvent({ type: et.EXTENSION_UNLOADED_EVENT, extensionId: extensionId });
        } else {
            logger.warn('Extension not found: ' + extensionId);
        }

        return success;
    },


    /**
     * Loads the extension with the given id and options.
     * For internal use only.
     *
     * @memberof! Autodesk.Viewing.Viewer3D#
     * @param {string} extensionId - The string id of the extension.
     * @param {Object} options - An optional dictionary of options.
     *
     * @returns {Promise} - Resolves with the extension requested.
     */
    loadExtensionLocal : function (extensionId, options) {
        // Instantiate the extension
        const EXTENSION_CLASS = theExtensionManager.getExtensionClass(extensionId);
        if (!EXTENSION_CLASS) {
            return Promise.reject('Extension not found : ' + extensionId);
        }

        // Extension already loaded?
        let extension = this.getExtension(extensionId);
        if (extension) {
            return Promise.resolve(extension);
        }

        // Is an extension with async load in progress?
        if (this.loadingExtensions && extensionId in this.loadingExtensions) {
            return this.loadingExtensions[extensionId];
        }

        // Create a new one
        extension = ExtensionEventsMixin(new EXTENSION_CLASS(this, options));
        extension.id = extensionId;
        
        const onFailure = () => Promise.reject('Extension failed to .load() : ' + extensionId);

        const loadResult = extension.load();
        if (!loadResult) {
            return onFailure();
        }

        const onSuccess = () => {
            this.loadedExtensions[extensionId] = extension;
            this.onPostExtensionLoad(extension);
            logger.info('Extension loaded: ' + extensionId);

            analytics.track('viewer.extensionManager.extensionLoaded', {
                extensionId: extensionId
            });

            //Queue the extension loaded event, but do not notify immediately.
            //This is because the event handler can try to unload the extension being loaded,
            //which will make the return logic below confused.
            setImmediate(() => {
                if (this.getExtension(extensionId)) {
                    this.dispatchEvent({ type: et.EXTENSION_LOADED_EVENT, extensionId: extensionId });
                }
            });

            return Promise.resolve(extension);
        };

        if (loadResult instanceof Promise) {
            // We need to know if there is already an async extension load in progress
            this.loadingExtensions = this.loadingExtensions || {}; 
            this.loadingExtensions[extensionId] = loadResult.then((result) => {
                if (result) {
                    return onSuccess();
                } else {
                    return onFailure();
                }
            }).finally(() => {
                // Extension load eirther succeded or failed
                delete this.loadingExtensions[extensionId];
            });

            return this.loadingExtensions[extensionId];
        } else {
            //In case success is not a Promise but a truthy value,
            //set the extension immediately into the loadedExtensions map,
            //in order to support backwards compatibility with callers who do not
            //wait on the returned Promise but try to use the extension immediately after loadExtension returns.
            return onSuccess();
        }

    },

    /**
     * Virtual method that hooks into the extension's loading process.
     * Gets invoked after {@link Autodesk.Viewing.Extension#load|extension.load()} 
     * but before event `EXTENSION_LOADED_EVENT` gets fired.
     *
     * @virtual
     */
    onPostExtensionLoad : function(extension) {
        // virtual method //
    },

    /**
     * Iterate over each extension that has been successfully loaded and invokes a callback function for them.
     * @param {function} callback - That receives an extension instance as argument.
     *
     * @example
     *    forEachExtension(function(ext){
     *       console.log(ext.id);
     *    })
     *
     * @memberof! Autodesk.Viewing.Viewer3D#
     */
    forEachExtension : function( callback ) {
        const loadedIds = this.loadedExtensions || {};
        for (let id in loadedIds) {
            if (Object.prototype.hasOwnProperty.call(loadedIds, id)) {
                callback(loadedIds[id]);
            }
        }
    },


    apply : function(object) {

        var me = ExtensionMixin.prototype;

        object.loadExtension = me.loadExtension;
        object.getExtension = me.getExtension;
        object.getExtensionAsync = me.getExtensionAsync;
        object.unloadExtension = me.unloadExtension;
        object.loadExtensionLocal = me.loadExtensionLocal;
        object.forEachExtension = me.forEachExtension;
        object.onPostExtensionLoad = me.onPostExtensionLoad;

    }

};
