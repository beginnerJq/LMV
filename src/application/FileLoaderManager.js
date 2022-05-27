
"use strict";

    /**
     * The FileLoaderManager manages a set of file loaders available to the viewer.
     * Register, retrieve, and unregister your file loaders using the singleton theFileLoader.
     * @private
     */
    var fileLoaders = {};

    /**
     * Registers a new file loader with the given id.
     *
     * @param {String} fileLoaderId - The string id of the file loader.
     * @param {String[]} fileExtensions - The array of supported file extensions. Ex: ['stl', 'obj']
     * @param {Function} fileLoaderClass - The file loader constructor.
     * @returns {Boolean} - True if the file loader was successfully registered.
     * 
     * @private
     */
    function registerFileLoader(fileLoaderId, fileExtensions, fileLoaderClass) {
        if (!fileLoaders[fileLoaderId]) {
            fileLoaders[fileLoaderId] = {
                loader: fileLoaderClass,
                extensions: fileExtensions
            };
            return true;
        }
        return false;
    }

    /**
     * Returns the file loader for a given ID.
     *
     * @param {String} fileLoaderId - The string id of the file loader.
     * @returns {Function?} - The file loader constructor if one was registered; null otherwise.
     * 
     * @private
     */
    function getFileLoader(fileLoaderId) {
        if (fileLoaders[fileLoaderId]) {
            return fileLoaders[fileLoaderId].loader;
        }
        return null;
    }

    /**
     * Unregisters an existing file loader with the given id.
     *
     * @param {String} fileLoaderId - The string id of the file loader.
     * @returns {Boolean} - True if the file loader was successfully unregistered.
     * 
     * @private
     */
    function unregisterFileLoader(fileLoaderId) {
        if (fileLoaders[fileLoaderId]) {
            delete fileLoaders[fileLoaderId];
            return true;
        }
        return false;
    }

    /**
     * Returns a file loader that supports the given extension.
     *
     * @param {String} fileExtension - The file extension.
     *
     * @returns {Function?} - The file loader constructor if one is found; null otherwise.
     * 
     * @private
     */
    function getFileLoaderForExtension(fileExtension) {
        fileExtension = fileExtension ? fileExtension.toLowerCase() : "";
        for (var fileLoaderId in fileLoaders) {
            var fileLoader = fileLoaders[fileLoaderId];
            if (fileLoader) {
                for (var i = 0; i < fileLoader.extensions.length; i++) {
                    if (fileLoader.extensions[i].toLowerCase() === fileExtension) {
                        return fileLoader.loader;
                    }
                }
            }
        }

        return null;
    }

    export let FileLoaderManager = {
        registerFileLoader: registerFileLoader,
        getFileLoader: getFileLoader,
        getFileLoaderForExtension: getFileLoaderForExtension,
        unregisterFileLoader: unregisterFileLoader
    };


