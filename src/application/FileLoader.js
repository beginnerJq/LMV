/* eslint-disable no-unused-vars */

/**
 * Base class for file loaders.
 *
 * It is highly recommended that file loaders use worker threads to perform the actual loading in order to keep the
 * UI thread free. Once loading is complete, the loader should call viewer.impl.onLoadComplete(). During loading,
 * the loader can use viewer.impl.signalProgress(int) to indicate how far along the process is.
 *
 * To add geometry to the viewer, `viewer.impl.addMeshInstance(geometry, meshId, materialId, matrix)` should be used.
 * Geometry must be THREE.BufferGeometry, meshId is a number, materialId is a string, and matrix is the THREE.Matrix4
 * transformation matrix to be applied to the geometry.
 *
 * Remember to add draw calls to the BufferGeometry if the geometry has more than 65535 faces.
 *
 * @param {Autodesk.Viewing.Viewer3D} viewer - The viewer instance.
 * @constructor
 * @class
 * @abstract
 * @alias Autodesk.Viewing.FileLoader
 */
export function FileLoader(viewer) {
    this.viewer = viewer;
}

FileLoader.prototype.constructor = FileLoader;

/**
 * Initiates the loading of a file from the given URL.
 *
 * This method must be overridden.
 *
 * @param {string} url - The url for the file.
 * @param {object=} options - An optional dictionary of options.
 * @param {string=} options.ids - A list of object id to load.
 * @param {string=} options.sharedPropertyDbPath - Optional path to shared property database.
 * @param {function=} onSuccess - Callback function when the file begins loading successfully. Takes no arguments.
 * @param {function=} onError - Callback function when an error occurs. Passed an integer error code and a string description of the error.
 *
 * @alias Autodesk.Viewing.FileLoader#loadFile
 */
FileLoader.prototype.loadFile = function(url, options, onSuccess, onError) {
    return false;
};

/**
 * Returns true only for a 3D models FileLoader implementation.
 *
 * @alias Autodesk.Viewing.FileLoader#is3d
 */
FileLoader.prototype.is3d = function() {
	return false;
};