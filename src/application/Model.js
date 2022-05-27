import { RenderModel } from "../wgs/scene/RenderModel";
import { EventDispatcher } from "./EventDispatcher";
import { pathToURL } from "../file-loaders/net/Xhr";
// import { logger } from "../logger/Logger";
import { LmvMatrix4 } from "../wgs/scene/LmvMatrix4";
import { isMobileDevice } from "../compat";
import { FragmentPointer } from "../wgs/scene/FragmentList";
import { UnifiedCamera } from "../tools/UnifiedCamera";
import {getUnitData, fixUnitString, convertUnits, ModelUnits} from "../measurement/UnitFormatter";
import { PropertySet } from "./PropertySet";

/**
 * Core class representing the geometry.
 *
 * @constructor
 * @memberof Autodesk.Viewing
 * @alias Autodesk.Viewing.Model
 */
export function Model( modelData )
{
    RenderModel.call(this);
    this.myData = modelData;
    this.topology = null;
    this.topologyPromise = null;
    this.svfUUID = null;
    this.defaultCameraHash = null;

    // RenderModel overrides

    /**
     * @returns {InstanceTree} Instance tree of the model if available, otherwise null.
     */
    this.getInstanceTree = function() {
        if (this.myData)
            return this.myData.instanceTree;
        return null;
    };

    /**
     * @param {boolean}[ignoreTransform] - Set to true to return the original bounding box in model space coordinates.
     * @param {boolean}[excludeShadow]    - Remove shadow geometry (if exists) from model bounds.
     * @returns {THREE.Box3} Bounding box of the model if available, otherwise null.
     */
    this.getBoundingBox = (function () {
        const bbox = new THREE.Box3();

        return function (ignoreTransform, excludeShadow) {
            if (!this.myData) {
                return null;
            }

            // Prefer returning modelSpaceBBox, which is the original model's bounding box without placementTransform.
            // If for some reason it doesn't exist (missing in loader) - return bbox baked with placementTransform.
            bbox.copy(this.myData.modelSpaceBBox || this.myData.bbox); 

            // Remove shadow geometry if needed.
            if (excludeShadow) {
                bbox.copy(this.trimPageShadowGeometry(bbox));
            }

            // If ignore transform is set, we are done.
            if (ignoreTransform) {
                return bbox;
            }

            // Apply placement transform
            const placementMatrix = this.getData().placementWithOffset;

            // Apply placement transform only if the modelSpace bounding box was used (should be always technically, unless it's missing in the loader).
            if (placementMatrix && this.myData.modelSpaceBBox) {
                bbox.applyMatrix4(placementMatrix);
            }

            // Apply dynamic model transform.
            const modelMatrix = this.getModelTransform();

            if (modelMatrix) {
                bbox.applyMatrix4(modelMatrix);
            }

            return bbox;
        };
    })();

    /**
     * Computes Bounding box of all fragments, but excluding outliers.
     * @param {Object} [options]
     * @param {float}  [options.quantil=0.75]     - in [0,1]. Relative amount of fragments that we consider computation. 
     *                                              By default, we consider the 75% of fragments that are closest to the center. 
     * @param {float}  [options.center]           - Center from which we collect the closest shapes. By default, we use the center of mass.
     * @param {boolean}  [options.ignoreTransforms] - Optional: Ignore modelMatrix and animation transforms
     * @param {Array<number>}   [options.allowlist] - Optional: Fragments to include in fuzzybox, by index.
     * @returns {THREE.Box3}
     */ 
    this.getFuzzyBox = function(options = {}) {

        var ignoreTransforms = Boolean(options.ignoreTransforms);

        var frags = this.getFragmentList();

        // For 2D models, just return regular bounding box.
        // Verify frags exist - there are formats without fragments, like Leaflet.
        if (!frags || this.is2d()) {
            return this.getBoundingBox(ignoreTransforms);
        }

        // Decide which function to use to obtain fragBoxes
        var getFragBounds = null;
        if (ignoreTransforms) {
            // get original fragment bbox without transforms
            var tmpArray = new Array(6);
            
            const pt = this.getData().placementWithOffset;
            const invPt = pt ? pt.clone().invert() : undefined;

            getFragBounds = function (fragId, dstBox) {
                frags.getOriginalWorldBounds(fragId, tmpArray);
                dstBox.min.fromArray(tmpArray);
                dstBox.max.fromArray(tmpArray, 3);

                if (invPt) {
                    dstBox.applyMatrix4(invPt);
                }
            };
        } else {
            // get bounds including model or fragment animation transforms
            getFragBounds = function(fragId, dstBox) {
                frags.getWorldBounds(fragId, dstBox);
            };
        }

        function centerOfMass() {
            
            var box    = new THREE.Box3();
            var center = new THREE.Vector3();
            var size   = new THREE.Vector3();
            var total  = new THREE.Vector3();
            var mass   = 0;
        
            function processOneFragment(f) {
                if (options.allowlist && !options.allowlist.includes(f)) {
                    return;
                }

                // get bbox center
                getFragBounds(f, box);
                box.getCenter(center);
                
                // sum centers weighted by bbox size
                var weight = box.getSize(size).length();
                total.add(center.multiplyScalar(weight));
        
                mass += weight;
            }
        
            for (var i = 0; i < frags.getCount(); i++) {
                processOneFragment(i);
            }
        
            total.multiplyScalar(1/mass);
            return total;
        }

        var center  = options.center || centerOfMass();
        var quantil = options.quantil || 0.75;

        var fragBox = new THREE.Box3();

        // Compute distances of each frag bbox from center
        var fragInfos = [];
        const tmpCenter = new THREE.Vector3();
        for (let i = 0; i < frags.getCount(); i++) {
            if (options.allowlist && !options.allowlist.includes(i)) {
                continue;
            }

            // Skip any empty boxes
            getFragBounds(i, fragBox);
            if (fragBox.isEmpty()) {
                continue;
            }

            // get fragBox->center distance
            var dist = fragBox.distanceToPoint(center);

            // If fragBox contains the center, use fragBox center.
            if (dist === 0) {
                dist = center.distanceTo(fragBox.getCenter(tmpCenter));
            }

            fragInfos.push({
                fragId:   i,
                distance: dist
            });
        }

        // sort by increasing order
        fragInfos.sort(function(a, b) {
            return a.distance - b.distance;
        });

        // union of all fragBoxes, excluding the ones with largest distance to center
        var box = new THREE.Box3();
        for (let i = 0; i < fragInfos.length * quantil; i++) {
            var fi = fragInfos[i];
            getFragBounds(fi.fragId, fragBox);
            box.union(fragBox);
        }
        return box;
    };

    /**
     * @returns {boolean} Whether the model is 2D.
     */
    this.is2d = function() {
        return !!(this.myData && this.myData.is2d);
    };

    /**
     * @returns {boolean} Whether the model is 3D.
     */
    this.is3d = function() {
        return !this.is2d();
    };

    /** 
     * @private
     * @returns {boolean} true if the model is an OTG file - which supports sharing of materials and geometry. 
     */
    this.isOTG = function() {
        return (this.myData && !!this.myData.isOTG);
    };

    /** 
     * @returns {boolean} true if the model is an SVF2 file - which supports sharing of materials and geometry. 
     */
    this.isSVF2 = function() {
        var node = this.getDocumentNode();
        return node ? node.isSVF2() : false;
    };

    /**
     * @param {boolean} onlyPdfSource - Set to true in order to verify that the source file of the model is PDF.
     *                                   .rvt files can get extracted to PDFs for example, and in that case,
     *                                   when using the flag, we'll get false as a result.
     * 
     * @returns {boolean} true if the model is created from a PDF file.
     */
    this.isPdf = function (onlyPdfSource) {
      return !!(
        this.myData &&
        this.myData.isPdf &&
        (!onlyPdfSource || !this.isRevitPdf())
      );
    };

    /**
     * @returns {boolean} true if the model is a PDF that was created from a Revit source file.
     */
    this.isRevitPdf = function() {
        return !!this.getDocumentNode()?.isRevitPdf();
    };

    /**
     * @returns {boolean} true if the model is created from an image file.
     */
    this.isLeaflet = function() {
        return !!(this.myData && this.myData.isLeaflet);
    };

    /**
     * By default, Leaflet documents are being loaded in a normalized coordinate system. Only when
     * using `fitPaperSize` load option, the model will be loaded in page coordinates, like every other 2D model.
     * 
     * @returns {boolean} true if the model is loaded in page coordinates.
     */
    this.isPageCoordinates = function() {
        return this.is2d() && (!this.isLeaflet() || this.loader?.isPageCoordinates());
    };

    /**
     * @returns {boolean} true if the model is created using Autodesk.Viewing.SceneBuilder extension
     */
    this.isSceneBuilder = function() {
        return !!(this.myData && this.myData.isSceneBuilder);
    };
}

/*
 * Don't set Model's prototype to RenderModel. It's not needed for now.
 */
//Model.prototype = Object.create(RenderModel.prototype);

EventDispatcher.prototype.apply( Model.prototype );
Model.prototype.constructor = Model;


/**
 * Returns the geometry data.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getData
 */
Model.prototype.getData = function()
{
    return this.myData;
};

/**
 * Set a UUID to identify the SVF model
 * @param {string} urn - Data that represents the geometry.
 */
Model.prototype.setUUID = function( urn )
{
    this.svfUUID = btoa(encodeURI(pathToURL(urn)));
};

/**
 * Returns an object wrapping the bubble/manifest entry for the
 * loaded geometry. Contains data such as the viewableID, guid, role...
 * 
 * @returns {Autodesk.Viewing.BubbleNode|null}
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getDocumentNode
 */
Model.prototype.getDocumentNode = function() {
    return this.getData()?.loadOptions?.bubbleNode ?? null;
};

/**
 * Returns the root of the geometry node graph.
 * @returns {object} The root of the geometry node graph. Null if it doesn't exist.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getRoot
 */
Model.prototype.getRoot = function()
{
    var data = this.getData();
    if (data && data.instanceTree)
        return data.instanceTree.root;
    return null;
};

/**
 * Returns the root of the geometry node graph.
 * @returns {number} The ID of the root or null if it doesn't exist.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getRootId
 */
Model.prototype.getRootId = function()
{
    var data = this.getData();
    return (data && data.instanceTree && data.instanceTree.getRootId()) || 0;
};

/**
 * Returns an object that contains the standard unit string (unitString) and the scale value (unitScale).
 * @param {string} unit - Unit name from the metadata
 * @returns {object} this object contains the standardized unit string (unitString) and a unit scaling value (unitScale)
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getUnitData
 */
Model.prototype.getUnitData = function(unit) {
    console.warn("Model.getUnitData is deprecated and will be removed in a future release, use Autodesk.Viewing.Private.getUnitData() instead.");
    return getUnitData(unit);
};

/**
 * Returns the scale factor of model's distance unit to meters.
 * @returns {number} The scale factor of the model's distance unit to meters or unity if the units aren't known.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getUnitScale
 */
Model.prototype.getUnitScale = function()
{
    return convertUnits(this.getUnitString(), ModelUnits.METER, 1, 1);
};

/**
 * Returns a standard string representation of the model's distance unit.
 * @returns {string} Standard representation of model's unit distance or null if it is not known.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getUnitString
 */
Model.prototype.getUnitString = function() {

    var unit;

    if (!this.is2d()) {
        // Check if there's an overridden model units in bubble.json (this happens in Revit 3D files)
        var data = this.getData();
        if (data && data.overriddenUnits) {
            // explicit override trumps all
            unit = data.overriddenUnits;
        } else if(data && data.scalingUnit) {
            unit = data.scalingUnit; // only using if scaling was actually applied
        } else {
            unit = this.getMetadata('distance unit', 'value', null);
        }
    }
    else {
        // Model units will be used for calculating the initial distance.
        unit = this.getMetadata('page_dimensions', 'model_units', null) || this.getMetadata('page_dimensions', 'page_units', null);
    }

    return fixUnitString(unit);
};

/**
 * Returns a standard string representation of the model's display unit.
 * @returns {string} Standard representation of model's display unit or null if it is not known.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getDisplayUnit
*/
Model.prototype.getDisplayUnit = function() {
    var unit;

    if (!this.is2d()) {
        var data = this.getData();
        if(data && data.scalingUnit) {
             unit = data.scalingUnit; // only using if scaling was actually applied
        } else {
            unit = this.getMetadata('default display unit', 'value', null) || this.getMetadata('distance unit', 'value', null);
        }
    }
    else {

        // When model units is not set, it should be assumed to be the same as paper units.
        unit = this.getMetadata('page_dimensions', 'model_units', null) || this.getMetadata('page_dimensions', 'page_units', null);
    }

    return fixUnitString(unit);
};

/** 
 * Returns source file's units.
 * @returns {string} Source file's units.
 */
Model.prototype.getSourceFileUnits = function () {
    const node = this.getDocumentNode();
    return node?.getSourceFileUnits();
};

/**
 * Return metadata value.
 * @param {string} itemName - Metadata item name.
 * @param {string} [subitemName] - Metadata subitem name.
 * @param {*} [defaultValue] - Default value.
 * @returns {*} Metadata value, or defaultValue if no metadata or metadata item/subitem does not exist.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getMetadata
 */
Model.prototype.getMetadata = function (itemName, subitemName, defaultValue) {
    var data = this.getData();
    if (data) {
        var metadata = data.metadata;
        if (metadata) {
            var item = metadata[itemName];
            if (item !== undefined) {
                if (subitemName) {
                    var subitem = item[subitemName];
                    if (subitem !== undefined) {
                        return subitem;
                    }
                } else {
                    return item;
                }
            }
        }
    }
    return defaultValue;
};

/*
Model.prototype.displayMetadata = function () {
    logger.log('metadata:');
    var data = this.getData();
    if (data) {
        var metadata = data.metadata;
        if (metadata) {
            for (itemName in metadata) {
                if (metadata.hasOwnProperty(itemName)) {
                    logger.log('  ' + itemName);
                    var item = metadata[itemName];
                    if (item) {
                        for (subItemName in item) {
                            if (item.hasOwnProperty(subItemName)) {
                                logger.log('    ' + subItemName + '=' + JSON.stringify(item[subItemName]));
                            }
                        }
                    }
                }
            }
        }
    }
};
*/

/**
 * Returns the default camera.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getDefaultCamera
 */
Model.prototype.getDefaultCamera = function() {

    var myData = this.getData();

    if (!myData)
        return null;

    var defaultCamera = null;
    var numCameras = myData.cameras ? myData.cameras.length : 0;
    if (0 < numCameras) {
        // Choose a camera.
        // Use the default camera if specified by metadata.
        //
        var defaultCameraIndex = this.getMetadata('default camera', 'index', null);
        if (defaultCameraIndex !== null && myData.cameras[defaultCameraIndex]) {
            defaultCamera = myData.cameras[defaultCameraIndex];

        } else {

            // No default camera. Choose a perspective camera, if any.
            //
            for (var i = 0; i < numCameras; i++) {
                var camera = myData.cameras[i];
                if (camera.isPerspective) {
                    defaultCamera = camera;
                    break;
                }
            }

            // No perspective cameras, either. Choose the first camera.
            //
            if (!defaultCamera) {
                defaultCamera = myData.cameras[0];
            }
        }
    }

    // Consider model matrix if specified
    var matrix = this.getModelTransform();
    if (defaultCamera && matrix) {

        // Create or reuse copy of the default camera
        const transformedDefaultCamera = UnifiedCamera.copyViewParams(defaultCamera);

        // Apply matrix to camera params
        UnifiedCamera.transformViewParams(transformedDefaultCamera, matrix);

        // Apply some traditional auto-repair magic if necessary.
        //
        // Note: Actually, this is already done by Viewer3DImpl.setViewFromCamera. However,
        //       this only fixes the viewer main camera, but later calls to getDefaultCamera
        //       would still get the unfixed one. In the past, this problem was just hidden,
        //       because this function returned a pointer to the internal camera which was
        //       then modified from outside.
        UnifiedCamera.adjustOrthoCamera(transformedDefaultCamera, this.getBoundingBox());

        return transformedDefaultCamera;
    }

    return defaultCamera;
};

/**
 * @returns {boolean}  true when the "AEC" loader settings were used when loading the model
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#isAEC
 */
Model.prototype.isAEC = function() {
    return !!this.getData().loadOptions.isAEC;
};

/**
 * @returns {boolean}  true when a 2D model has a page shadow
 *
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#hasPageShadow
 */
Model.prototype.hasPageShadow = function() {
    return this.getData().hasPageShadow;
};

/**
 * Returns up vector as an array of 3.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getUpVector
 */
Model.prototype.getUpVector = function() {
    return this.getMetadata('world up vector', 'XYZ', null);
};

/**
 * Returns the polygon count.
 * @returns {number}
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#geomPolyCount
 */
Model.prototype.geomPolyCount = function() {

    var geomList = this.getGeometryList();
    if (!geomList) {
        return null;
    }

    return geomList.geomPolyCount;
};

/**
 * Returns the instanced polygon count.
 * @returns {number}
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#instancePolyCount
 */
Model.prototype.instancePolyCount = function() {

    var geomList = this.getGeometryList();
    if (!geomList) {
        return null;
    }

    return geomList.instancePolyCount;
};

/**
 * Returns true if the model with all its geometries has loaded.
 * 
 * @param {boolean} [checkTextures] - Ensures that the model's textures were completely loaded.
 * 
 * @returns {boolean}
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#isLoadDone
 */
Model.prototype.isLoadDone = function(checkTextures) {
    const data = this.getData();

    // Specifically verify texLoadDone is not `false` - since undefined means that textures are not relevant for the loader type.
    const texturesDone = !checkTextures || data.texLoadDone !== false;
    return !!(data && data.loadDone && texturesDone);
};

/**
 * Returns true if the frag to node id mapping is done.
 * @returns {boolean}
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#isObjectTreeCreated
 */
Model.prototype.isObjectTreeCreated = function() {

    return !!(this.getData().instanceTree);

};

/**
 * Returns an instance of {@link PropDbLoader|PropertyDatabase Loader},
 * responsible for communicating with the PropertyDatabase instance hosted in a browser worker thread.
 *
 * @returns {PropDbLoader}
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getPropertyDb
 */
Model.prototype.getPropertyDb = function() {
    var data = this.getData();
    return data && data.propDbLoader;
};

/**
 * Asyncronous method that gets object properties
 * @deprecated Use getProperties2 instead - which makes sure that externalId table is only loaded if really needed.
 * 
 * @param {number} dbId - The database identifier.
 * @param {Callbacks#onPropertiesSuccess} [onSuccessCallback] - Callback for when the properties are fetched.
 * @param {Callbacks#onGenericError} [onErrorCallback] - Callback for when the properties are not found or another error occurs.
 * 
 * @alias Autodesk.Viewing.Model#getProperties
 */
Model.prototype.getProperties = function( dbId, onSuccessCallback, onErrorCallback )
{
    var pdb = this.getPropertyDb();

    // Negative dbIds will not have properties.
    // Negative dbIds are either paper (-1) or generated ids for 2d-texts
    // dbIds start at 1, so 0 can be skipped as well.
    if (!pdb || dbId <= 0) {
        onErrorCallback && onErrorCallback();
        return;
    }

    pdb.getProperties( dbId, onSuccessCallback, onErrorCallback );
};

/**
 * Asyncronous method that gets object properties
 * 
 * @param {number} dbId - The database identifier.
 * @param {Callbacks#onPropertiesSuccess} [onSuccessCallback] - Callback for when the properties are fetched.
 * @param {Callbacks#onGenericError} [onErrorCallback] - Callback for when the properties are not found or another error occurs.
 * @param {Object}  [options]
 * @param {boolean} [options.needsExternalId] - Ensures loading of externalID table if necessary. This may consume a lot of memory. Only use if you really need externalIds.
 * @alias Autodesk.Viewing.Model#getProperties2
 */
Model.prototype.getProperties2 = function( dbId, onSuccessCallback, onErrorCallback, options )
{
    var pdb = this.getPropertyDb();

    // Negative dbIds will not have properties.
    // Negative dbIds are either paper (-1) or generated ids for 2d-texts
    // dbIds start at 1, so 0 can be skipped as well.
    if (!pdb || dbId <= 0) {
        onErrorCallback && onErrorCallback();
        return;
    }

    pdb.getProperties2( dbId, onSuccessCallback, onErrorCallback, options );
};

/**
 * Returns properties for multiple objects with an optional filter on which properties to retrieve.
 * @deprecated Use getBuldProperties2 instead.
 *
 * @param {number[]} dbIds - IDs of the nodes to return the properties for.
 * @param {object|undefined} options - Dictionary with options.
 * @param {string[]} [options.propFilter] - Array of property names to return values for. Use null for no filtering.
 * Filter applies to "name" and "externalId" fields also.
 * @param {boolean} [options.ignoreHidden] - Ignore hidden properties
 * @param {function} onSuccessCallback - This method is called when request for property db succeeds.
 * @param {function} onErrorCallback - This method is called when request for property db fails.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getBulkProperties
 */
Model.prototype.getBulkProperties = function( dbIds, options, onSuccessCallback, onErrorCallback )
{
    if (Array.isArray(options)) {
        // backwards compatibility for when options was actually propFilter.
        options = { propFilter: options };
    }

    options = options || {};
    var propFilter = options.propFilter || null;
    var ignoreHidden = options.ignoreHidden || false;

    var pdb = this.getPropertyDb();
    if (!pdb) {
        onErrorCallback && onErrorCallback();
        return;
    }

    pdb.getBulkProperties( dbIds, propFilter, onSuccessCallback, onErrorCallback, ignoreHidden );
};

/**
 * Returns properties for multiple objects with an optional filter on which properties to retrieve.
 *
 * @param {int[]} dbIds - IDs of the nodes to return the properties for.
 * @param {object|undefined} options - Dictionary with options.
 * @param {string[]} [options.propFilter] - Array of property names to return values for. Use null for no filtering.
 * Filter applies to "name" and "externalId" fields also.
 * @param {string[]} [options.categoryFilter] - Array of category names to return values for. Use null for no filtering.
 * @param {boolean} [options.ignoreHidden] - Ignore hidden properties
 * @param {boolean} [options.needsExternalId] - Ensures loading of externalID table if necessary. This may consume a lot of memory. Only use if you really need externalIds.
 * @param {function} onSuccessCallback - This method is called when request for property db succeeds.
 * @param {function} onErrorCallback - This method is called when request for property db fails.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getBulkProperties2
 */
Model.prototype.getBulkProperties2 = function( dbIds, options, onSuccessCallback, onErrorCallback )
{
    var pdb = this.getPropertyDb();
    if (!pdb) {
        onErrorCallback && onErrorCallback();
        return;
    }

    pdb.getBulkProperties2( dbIds, options, onSuccessCallback, onErrorCallback );
};

/**
 * Returns a Promise that resolves with {@link Autodesk.Viewing.PropertySet|PropertySet} for multiple objects.
 * An optional filter can be passed in to specify which properties to retrieve.
 *
 * @param {int[]} dbIds - IDs of the nodes to return the properties for.
 * @param {Object} [options] - Dictionary with options.
 * @param {string[]} [options.propFilter] - Array of property names to return values for. Use null for no filtering.
 * Filter applies to "name" and "externalId" fields also.
 * @param {boolean} [options.ignoreHidden] - Ignore hidden properties
 * @param {boolean} [options.needsExternalId] - Ensures loading of externalID table if necessary. This may consume a lot of memory. Only use if you really need externalIds.
 * @returns {Promise<Autodesk.Viewing.PropertySet>} - Returns a promise that resolves with an instance of a Autodesk.Viewing.PropertySet
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getPropertySetAsync
 */
Model.prototype.getPropertySetAsync = function (dbIds, options) {
    return new Promise((resolve, reject) => {
        this.getPropertySet(dbIds, resolve, reject, options);
    });
};

/**
 * Gets the property {@link Autodesk.Viewing.PropertySet|PropertySet} for multiple objects.
 * An optional filter can be passed in to specify which properties to retrieve.
 * 
 * For the async version see {@link Autodesk.Viewing.Model#getPropertySetAsync|getPropertySetAsync}
 *
 * @param {int[]} dbIds - IDs of the nodes to return the properties for.
 * @param {function} onSuccessCallback - This method is called when request for property db succeeds.
 * @param {function} onErrorCallback - This method is called when request for property db fails.
 * @param {Object} [options] - Dictionary with options.
 * @param {string[]} [options.propFilter] - Array of property names to return values for. Use null for no filtering.
 * Filter applies to "name" and "externalId" fields also.
 * @param {boolean} [options.ignoreHidden] - Ignore hidden properties
 * @param {boolean} [options.needsExternalId] - Ensures loading of externalID table if necessary. This may consume a lot of memory. Only use if you really need externalIds.
 * @returns {Promise<Autodesk.Viewing.PropertySet>} - Returns a promise that resolves with an instance of a Autodesk.Viewing.PropertySet
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getPropertySet
 */
Model.prototype.getPropertySet = function (dbIds, onSuccessCallback, onErrorCallback, options) {
    var pdb = this.getPropertyDb();
    if (!pdb) {
        onErrorCallback && onErrorCallback('Properties failed to load.');
    }

    pdb.getPropertySet(
        dbIds,
        options,
        (result) => {
            onSuccessCallback(new PropertySet(result));
        },
        onErrorCallback
    );
};

/**
 * Returns an object with key values being dbNodeIds and values externalIds.
 * Useful to map LMV node ids to Fusion node ids.
 *
 * @param {function} onSuccessCallback - This method is called when request for property db succeeds.
 * @param {function} onErrorCallback - This method is called when request for property db fails.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getExternalIdMapping
 */
Model.prototype.getExternalIdMapping = function( onSuccessCallback, onErrorCallback )
{
    var pdb = this.getPropertyDb();

    if (!pdb) {
        onErrorCallback && onErrorCallback();
        return;
    }

    pdb.getExternalIdMapping( onSuccessCallback, onErrorCallback );
};

/**
 * Returns an object with key values being layer names, pointing to Arrays containing dbIds.
 *
 * @param {function} onSuccessCallback - This method is called when request for property db succeeds.
 * @param {function} onErrorCallback - This method is called when request for property db fails.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getLayerToNodeIdMapping
 */
Model.prototype.getLayerToNodeIdMapping = function( onSuccessCallback, onErrorCallback )
{
    var pdb = this.getPropertyDb();

    if (!pdb) {
        onErrorCallback && onErrorCallback();
        return;
    }

    pdb.getLayerToNodeIdMapping( onSuccessCallback, onErrorCallback );
};


/**
 * Asyncronous operation that gets a reference to the object tree.
 *
 * You can use the model object tree to get information about items in the model.  The tree is made up
 * of nodes, which correspond to model components such as assemblies or parts.
 *
 * @param {Callbacks#onObjectTreeSuccess} [onSuccessCallback] - Success callback invoked once the object tree is available.
 * @param {Callbacks#onGenericError} [onErrorCallback] - Error callback invoked when the object tree is not found available.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getObjectTree
 */
Model.prototype.getObjectTree = function( onSuccessCallback, onErrorCallback )
{
    // Scene builder has an instance tree but no property database.
    const it = this.getData().instanceTree;
    if (it) {
        onSuccessCallback(it);
        return;
    }

    var pdb = this.getPropertyDb();

    if (!pdb) {
        onErrorCallback && onErrorCallback();
        return;
    }

    pdb.getObjectTree( onSuccessCallback, onErrorCallback );
};

/**
 * Returns ``true`` only when the object tree is loaded into memory.
 * Will return ``false`` while the object tree is still loading,
 * or when the object tree fails to load.
 *
 * @returns {boolean}
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#isObjectTreeLoaded
 */
Model.prototype.isObjectTreeLoaded = function()
{
    var pdb = this.getPropertyDb();

    if (!pdb) {
        return false;
    }

    return pdb.isObjectTreeLoaded();
};


/**
 * Async operation to search the object property database.
 *
 * @param {string} text - The search term (not case sensitive).
 * @param {Callbacks#onSearchSuccess} onSuccessCallback - Invoked when the search results are ready.
 * @param {Callbacks#onGenericError} onErrorCallback - Invoke when an error occured during search.
 * @param {string[]} [attributeNames] - Restricts search to specific attribute names.
 * @param {Object} [options] - Search options. Currently only supported option is searchHidden
 * @param {boolean} [options.searchHidden=false] - Set to true to also search hidden properties
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#search
 */
Model.prototype.search = function(text, onSuccessCallback, onErrorCallback, attributeNames, options = { searchHidden: false})
{
    var pdb = this.getPropertyDb();

    if (!pdb) {
        onErrorCallback && onErrorCallback();
        return;
    }

    pdb.searchProperties(text, attributeNames, onSuccessCallback, onErrorCallback, options);
};

/**
 * Searches the property database for all dbIds that contains a specific property name.
 *
 * @param {string} propertyName - The property name to search for (case sensitive).
 * @returns {Promise} that resolves with an Array of dbIds containing the specified property.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#findProperty
 */
Model.prototype.findProperty = function(propertyName)
{
    var pdb = this.getPropertyDb();

    if (!pdb) {
        return Promise.reject('Model doesn\'t have any properties.');
    }

    return pdb.findProperty(propertyName);
};


//========================================================
// Utility functions used by page->model conversions below

var repairViewportMatrix = function(elements) {
    // Sometimes the rows of matrix are swapped
    var precision = 1e-3;
    var e = elements;
    if (Math.abs(e[0]) < precision) {
        if (Math.abs(e[4]) > precision) {
            // swap row 1 and row 2
            for (var i = 0; i < 4; i++) {
                var temp = e[i];
                e[i] = e[i + 4];
                e[i + 4] = temp;
            }
        }
        else {
            // swap row 1 and row 3
            for (let i = 0; i < 4; i++) {
                const temp = e[i];
                e[i] = e[i + 8];
                e[i + 8] = temp;
            }
        }
    }
    if (Math.abs(e[5]) < precision) {
        // swap row 2 and row 3
        for (let i = 4; i < 8; i++) {
            const temp = e[i];
            e[i] = e[i + 4];
            e[i + 4] = temp;
        }
    }
};


var pointInContour = function(x, y, cntr, pts) {
    var yflag0, yflag1;
    var vtx0X, vtx0Y, vtx1X, vtx1Y;

    var inside_flag = false;

    // get the last point in the polygon
    vtx0X = pts[cntr[cntr.length-1]].x;
    vtx0Y = pts[cntr[cntr.length-1]].y;

    // get test bit for above/below X axis
    yflag0 = (vtx0Y >= y);

    for (var j= 0, jEnd=cntr.length; j<jEnd; ++j)
    {
        vtx1X = pts[cntr[j]].x;
        vtx1Y = pts[cntr[j]].y;

        yflag1 = (vtx1Y >= y);

        // Check if endpoints straddle (are on opposite sides) of X axis
        // (i.e. the Y's differ); if so, +X ray could intersect this edge.
        // The old test also checked whether the endpoints are both to the
        // right or to the left of the test point.  However, given the faster
        // intersection point computation used below, this test was found to
        // be a break-even proposition for most polygons and a loser for
        // triangles (where 50% or more of the edges which survive this test
        // will cross quadrants and so have to have the X intersection computed
        // anyway).  I credit Joseph Samosky with inspiring me to try dropping
        // the "both left or both right" part of my code.
        if (yflag0 != yflag1)
        {
            // Check intersection of pgon segment with +X ray.
            // Note if >= point's X; if so, the ray hits it.
            // The division operation is avoided for the ">=" test by checking
            // the sign of the first vertex wrto the test point; idea inspired
            // by Joseph Samosky's and Mark Haigh-Hutchinson's different
            // polygon inclusion tests.
            if (((vtx1Y-y)*(vtx0X-vtx1X) >=
                (vtx1X-x)*(vtx0Y-vtx1Y)) == yflag1)
            {
                    inside_flag = !inside_flag;
            }
        }

        // move to the next pair of vertices, retaining info as possible
        yflag0 = yflag1;
        vtx0X = vtx1X;
        vtx0Y = vtx1Y;
    }

    return inside_flag;
};

Model.prototype.pointInPolygon = function(x, y, contours, points) {
    var inside = false;

    for (var i=0; i<contours.length; i++) {

        if (pointInContour(x, y, contours[i], points))
            inside = !inside;
    }

    return inside;
};




Model.prototype.getPageToModelTransform = function(vpId) {

    var data = this.getData();
    if (data.pageToModelTransform) {
        return data.pageToModelTransform;
    }

    var f2d = data;
    var metadata = f2d.metadata;
    var pd = metadata.page_dimensions;

    var vp = f2d.viewports && f2d.viewports[vpId];
    if (!vp) {
      return new THREE.Matrix4();
    }

    if (!f2d.viewportTransforms)
        f2d.viewportTransforms = new Array(f2d.viewports.length);

    //See if we already cached the matrix
    var cached = f2d.viewportTransforms[vpId];
    if (cached)
        return cached;

    //Do the matrix composition in double precision using LmvMatrix,
    //which supports that optionally
    var pageToLogical = new LmvMatrix4(true).set(
      pd.logical_width/pd.page_width, 0, 0, pd.logical_offset_x,
      0, pd.logical_height/pd.page_height, 0, pd.logical_offset_y,
      0, 0, 1, 0,
      0, 0, 0, 1
    );

    var modelToLogicalArray = vp.transform.slice();

    repairViewportMatrix(modelToLogicalArray);

    var modelToLogical = new LmvMatrix4(true);
    modelToLogical.elements.set(modelToLogicalArray);

    var logicalToModel = new LmvMatrix4(true);
    logicalToModel.copy(modelToLogical).invert();

    logicalToModel.multiply(pageToLogical);

    //Cache for future use
    f2d.viewportTransforms[vpId] = logicalToModel;

    return logicalToModel;
};


/**
 * Paper coordinates to Model coordinates
*/
Model.prototype.pageToModel = function( point1, point2, vpId, inverse ) {

    let vpXform = this.getPageToModelTransform(vpId);
    if (inverse) {
        vpXform = vpXform.clone().invert();
    }

    function applyToPoint(point) {
        if (point) {
            var modelPt = new THREE.Vector3().set(point.x, point.y, 0).applyMatrix4(vpXform);
            point.x = modelPt.x;
            point.y = modelPt.y;
            point.z = modelPt.z;
        }
    }

    applyToPoint(point1);
    applyToPoint(point2);
};


/**
 * Find the viewports that point lies in its bounds.
*/
Model.prototype.pointInClip = function(point, vpId) {

    var clips = this.getData().clips;
    var clipIds = []; // This will store ids of clip where point lies in

    // clip index starts at 1
    for (var i = 1; i < clips.length; i++) {
        // Don't need to check the point's own viewport's clip, it must be in that clip.
        if (i === vpId)
            continue;

        var contour = [];
        var contours = [];
        var contourCounts = clips[i].contourCounts;
        var points = clips[i].points;
        var index = 0;
        var pts = [];

        // Reorganize contour data
        for (var j = 0; j < contourCounts.length; j++) {
            for (var k = 0; k < contourCounts[j]; k++) {
                contour.push(index);
                index++;
            }
            contours.push(contour);
            contour = [];
        }
        for (let j = 0; j < points.length; j += 2) {
            var pt = {x: points[j], y: points[j+1]};
            pts.push(pt);
        }

        var inside = this.pointInPolygon(point.x, point.y, contours, pts);
        if (inside)
            clipIds.push(i);
    }

    return clipIds;
};

Model.prototype.getClip = function(vpId) {

    var clips = this.getData().clips;

    var contour = [];
    var contours = [];
    var contourCounts = clips[vpId].contourCounts;
    var points = clips[vpId].points;
    var index = 0;
    var pts = [];

    // Reorganize contour data
    for (var j = 0; j < contourCounts.length; j++) {
        for (var k = 0; k < contourCounts[j]; k++) {
            contour.push(index);
            index++;
        }
        contours.push(contour);
        contour = [];
    }
    for (let j = 0; j < points.length; j += 2) {
        var pt = {x: points[j], y: points[j+1]};
        pts.push(pt);
    }

    return { "contours" : contours, "points" : pts };
};


/**
 * Return topology index of the fragment.
 * @param {number} fragId - Fragment ID.
 * @returns {number} Topology index.
 */
Model.prototype.getTopoIndex = function( fragId ) {
    var data = this.getData();
    if (data && data.fragments) {
        var topoIndexes = data.fragments.topoIndexes;
        if (topoIndexes) {
            return topoIndexes[fragId];
        }
    }
};

/**
 * Return topology data of one fragment.
 * 
 * Requires topology data to have been fetched with  
 * {@link Autodesk.Viewing.Model#fetchTopology|fetchTopology()}.
 * 
 * @param {number} index - Topology index.
 * @returns {object} Topology data.
 * 
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#getTopology
 */
Model.prototype.getTopology = function( index ) {
    if (this.topology) {
        return this.topology[index];
    }
    return null;
};

/**
 * See also {@link Autodesk.Viewing.Model#fetchTopology|fetchTopology()}.
 * @returns {boolean} true if topology data has been downloaded and is available in memory
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#hasTopology
 */
Model.prototype.hasTopology = function() {
    return !!this.topology;
};

/**
 * Downloads the topology file, if one is available.
 * The file may not get downloaded if the topology content size in memory is bigger
 * than a specified limit (100 MB by default, 20 MB for mobile).
 * 
 * @param {number} [maxSizeMB] - Maximum uncompressed topology size allowed (in MegaBytes).
 * 
 * @returns {Promise} that resolves with the topology object.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#fetchTopology
 */
Model.prototype.fetchTopology = function(maxSizeMB) {

    // Debugging
   /*return new Promise(function(resolve, reject){
        function aaa() {
            if (avp.debug_topo_yes) {
                resolve([]);
                return;
            }
            if (avp.debug_topo_no) {
                reject('Buuuu');
                return;
            }
            requestAnimationFrame(aaa);
        }
        aaa();
    });
   // */
    // Debugging end
    
    if (this.topology)  // Already downloaded
        return Promise.resolve(this.topology);

    var data = this.getData();
    if (!data.topologyPath) // No path from where to download it
        return Promise.reject({ error: "no-topology" });

    var maxTopologyFileSizeMB = maxSizeMB || (isMobileDevice() ? 20 :  100); // MegaBytes; Non-gzipped
    if (data.topologySizeMB > maxTopologyFileSizeMB) // File is too big to download.
        return Promise.reject({ error: "topology-too-big", limitMB: maxTopologyFileSizeMB, topologyMB: data.topologySizeMB }); 

    if (!this.topologyPromise) // Fetch it!
    {
        var that = this;        
        this.topologyPromise = new Promise(function(resolve, reject){
            that.loader.fetchTopologyFile( that.getData().topologyPath, function onComplete( topoData ) {
                if (topoData && topoData.topology) {
                    that.topology = topoData.topology;
                    resolve(topoData.topology);
                } else {
                    reject(topoData);
                }
            });
        });
    }

    return this.topologyPromise;
};

/**
 * @returns {boolean} true if the model loaded contains at least 1 fragment.
 * 
 * @memberof Autodesk.Viewing.Model
 * @alias Autodesk.Viewing.Model#hasGeometry
 */
Model.prototype.hasGeometry = function() {
    var data = this.getData();
    if (data){
        if (data.isLeaflet) { // see LeafletLoader.js
            return true;
        }
        if (data.isSceneBuilder) {
            return true; // We claim scene builder scenes are never empty, even if it contains no geometry
        }
        return data.fragments.length > 0;
    }
    return false;
};

/**
 * Returns the FragmentPointer of the specified fragId in the model.
 * This method returns null if the fragId is not passed in.
 * 
 * @param {number} fragId - fragment id in the model
 * @returns {Autodesk.Viewing.Private.FragmentPointer|null} returns the FragmentPointer
 * 
 * @alias Autodesk.Viewing.Model#getFragmentPointer
 */
Model.prototype.getFragmentPointer = function(fragId) {
    if (!fragId) return null;
    return new FragmentPointer(this.getFragmentList(), fragId);
};

/**
 * Returns a shallow copy of the model.
 * All the inner state (Fragments, Geometries etc.) are shared.
 *
 * @returns {Autodesk.Viewing.Model} returns a shallow copy of the model.
 * 
 * @alias Autodesk.Viewing.Model#clone
 */
Model.prototype.clone = function() {
    const clone = new Model(this.myData);
    clone.topology = this.topology;
    clone.topologyPromise = this.topologyPromise;
    clone.svfUUID = this.svfUUID;
    clone.defaultCameraHash = this.defaultCameraHash;
    clone.loader = this.loader;
    clone.setInnerAttributes(this.getInnerAttributes());

    return clone;
};

/**
 * Returns the URN of the document model.
 * @returns {string} Model URN.
 */
Model.prototype.getSeedUrn = function () {
    return this.loader?.svfUrn || "";
};

/**
 * Check if node exist in instance tree or fragment list. 
 * @param {number} dbId - can be a single dbId or node with children (as appears in Model Browser)
 * @return {boolean} nodeExists - false if no elements found
 */
Model.prototype.isNodeExists = function (dbId) {
    let dbIdExists;
    const it = this.getInstanceTree();

    if (it) {
        it.enumNodeChildren(dbId, function (dbId) {
            it.enumNodeFragments(dbId, function () {
                dbIdExists = true;
            });
        }, true);
    }
    else {
        const fragments = this.getFragmentList().fragments;
        if (fragments.dbId2fragId?.[dbId]) {
            dbIdExists = true;
        }
    }
    return !!dbIdExists;
};

Model.prototype.getModelKey = function() {
    const documentNode = this.getDocumentNode();

    if (documentNode) {
        return documentNode.getModelKey();
    } else {
        return this.getData().urn;
    }
};

Model.prototype.dispose = function() {
    const instanceTree = this.getInstanceTree();
    instanceTree?.dtor();

    this.myData = null;
    this.topology = null;
    this.topologyPromise = null;
};
