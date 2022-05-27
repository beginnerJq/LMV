import { logger } from '../../logger/Logger';
import { ViewingService, pathToURL } from '../net/Xhr';
import { ErrorCodes } from '../net/ErrorCodes';
import * as et from '../../application/EventTypes';
import {initLoadContext} from "../net/endpoints";
import { InstanceTree } from '../../wgs/scene/InstanceTree';
import { InstanceTreeAccess } from '../../wgs/scene/InstanceTreeStorage';
import { createWorkerWithIntercept } from './WorkerCreator';
import { EventDispatcher } from "../../application/EventDispatcher";


    var WORKER_GET_PROPERTIES = "GET_PROPERTIES";
    var WORKER_GET_PROPERTY_SET = "GET_PROPERTY_SET";
    var WORKER_SEARCH_PROPERTIES = "SEARCH_PROPERTIES";
    var WORKER_FIND_PROPERTY = "FIND_PROPERTY";
    var WORKER_FIND_LAYERS = "FIND_LAYERS";
    var WORKER_BUILD_EXTERNAL_ID_MAPPING = "BUILD_EXTERNAL_ID_MAPPING";
    var WORKER_BUILD_LAYER_TO_NODE_ID_MAPPING = "BUILD_LAYER_TO_NODE_ID_MAPPING";
    var WORKER_LOAD_PROPERTYDB = "LOAD_PROPERTYDB";
    var WORKER_CREATE_TREE = "CREATE_TREE";
    var WORKER_UNLOAD_PROPERTYDB = "UNLOAD_PROPERTYDB";
    var WORKER_DIFF_PROPERTIES = "DIFF_PROPERTIES";
    var WORKER_USER_FUNCTION = "USER_FUNCTION";
    var WORKER_LOAD_EXTERNAL_IDS = "LOAD_EXTERNAL_IDS";

    //Use a global property worker thread, which does caching of
    //shared property databases (and database files).
    var propWorker;

    //Keep track of all pending operations/callbacks going into the property worker
    var PROPDB_CB_COUNTER = 1;
    var PROPDB_CALLBACKS = {};

    /**
     * @param e
     * @private
     */
    function propertyWorkerCallback(e) {

        var data = e.data;

        if (data && data.debug) {
            logger.debug(data.message);
            return;
        }

        // find worker callbacks for this message: [onSuccess, onError, onProgress]
        var cbs = data && data.cbId && PROPDB_CALLBACKS[data.cbId];
        if (!cbs) {
            // Callback for this cbId have been unregistered meanwhile.
            // This may happen if a PropDbLoader.dtor is called before all messages were processed.
            // In this case, the message is outdated and we can ignore it.
            return;
        }

        // Handle progress callbacks. Unlike success/error event, they may be triggered multiple times for the same operation/cbId.
        if (data.progress) {
            if (cbs[2]) {
                cbs[2](data.progress);
            }
            
            // Note that we don't remove the cbId here yet. The cbId of this operation
            // is cleaned up later when getting the success or error message (see below)
            return;
        }

        if (data.error) {
            if (cbs[1])
                cbs[1](data.error);
        } else {
            if (cbs[0])
                cbs[0](data.result);
        }

        // Getting success/error message implies that the current operation/cbId is finished.
        delete PROPDB_CALLBACKS[data.cbId];
    }

    /**
     * @param onSuccess
     * @param onError
     * @param onProgress
     * @private
     */
    function registerWorkerCallback(onSuccess, onError, onProgress) {
        var cbId = PROPDB_CB_COUNTER++;

        PROPDB_CALLBACKS[cbId] = [onSuccess, onError, onProgress];

        return cbId;
    }

    /**
     * @param cbId
     * @private
     */
    function unregisterWorkerCallback(cbId) {
        delete PROPDB_CALLBACKS[cbId];
    }

    /**
     * Used by node.js code to get direct access to the worker (which runs on the same thread in node.js)
     * @private
     */
    export function getPropWorker() {
        return propWorker;
    }

    /**
     * Used by Autodesk.Viewing.shutdown() to shutdown the propdb worker thread
     * @private
     */
    export function shutdownPropWorker() {
        if(propWorker) {
            propWorker.clearAllEventListenerWithIntercept();
            propWorker.terminate();
            propWorker = undefined;
        }
    }

    /**
     * @private
     */
    export function clearPropertyWorkerCache() {
        if (!propWorker)
            return;

        propWorker.doOperation({
                "operation": WORKER_UNLOAD_PROPERTYDB,
                "clearCaches": true
        });
    }

    // State enum to manage delay-loading of optional externalID table.
    var IdLoadState = {

        // Indicates that you have to call loadExternalIds() before using externalIds.
        NotLoaded: 0,

        // Indicates that externalIds are available. Either because delay-loading of externalIds is not
        // used or because a prior call to loadExternalIds() succeeded already. Note that this may apply
        // even if propDB is still loading: propDB operations are automatically delayed until propDB is ready.
        Available:  1,

        // Indicates that externalIds were requested via loadExternalIds(), but not finished yet.
        Loading: 2,

        // A prior attempt to load the ids failed.
        Failed:  3
    };

    /**
     * Per model property database interface, talks to the worker thread behind the scenes.
     *
     * @param sharedDbPath
     * @param model
     * @param eventTarget
     * @class
     * @alias Autodesk.Viewing.Private.PropDbLoader
     */
    export var PropDbLoader = function(sharedDbPath, model, eventTarget) {

        this.eventTarget = eventTarget || new EventDispatcher();

        this.model = model;
        this.svf = model && model.getData();

        //Will be initialized by the complex logic below.
        this.dbPath = "";
        this.sharedDbPath = false;

        //If there is a shared db path and there is no
        //per-SVF specific property database, use the shared one
        //NOTE: The check for .is2d is significant here: In cases where there
        //is an OTG v2 property database, we want to use that. Because OTG does not touch F2D files
        //those might still include the v1 property database in their manifest when we really want to use
        //the v2 OTG property db.
        const isOtg = this.svf && this.svf.loadOptions.bubbleNode && this.svf.loadOptions.bubbleNode.findViewableParent()._getOtgManifest();
        const is2dAndOtg = isOtg && this.svf && this.svf.is2d;
        if (this.svf && !is2dAndOtg && this.svf.propertydb && this.svf.propertydb.avs.length) {

            //If the SVF specified its own property db files, assume they are not shared
            this.dbFiles = this.svf.propertydb;

            for (var f in this.dbFiles) {
                if (this.dbFiles[f][0]) {
                    //Revit outputs backslashes in the
                    //relative path in the SVF manifest. WTF?
                    this.dbFiles[f][0].path = this.dbFiles[f][0].path.replace(/\\/g, "/");
                }
            }

            //Now check if the SVF propertydb definition actually refers to the same property database
            //as the shared database path. This is made harder by various "../../.." relative things
            //in the svf property db files list, hence the nasty path normalization stuff.
            var svfPath = pathToURL(this.svf.basePath);
            if (sharedDbPath) {

                var avsPath = ViewingService.simplifyPath(svfPath + this.svf.propertydb.avs[0].path);
                avsPath = avsPath.slice(0, avsPath.lastIndexOf("/")+1);

                //Does the property db path specified in the SVF match the
                //one specified as shared db path in the manifest?
                if (avsPath === sharedDbPath) {

                    //Convert the property db file list to be relative
                    //to the shared property db location, instead of
                    //relative to the SVF location

                    var dbFilesNew = {};
                    for (let f in this.dbFiles) {
                        var fileEntry = this.dbFiles[f][0];
                        var fpath = fileEntry.path;
                        fpath = ViewingService.simplifyPath(svfPath + fpath);

                        if (fpath.indexOf(sharedDbPath) === 0)
                            fpath = fpath.slice(sharedDbPath.length);

                        dbFilesNew[f] = [{path:fpath, isShared:fileEntry.isShared}];
                    }

                    //Replace the loader parameters by the recomputed ones
                    this.dbFiles = dbFilesNew;

                    //Use the less specific out of the SVF and shared bubble
                    //paths, and convert all file paths to be relative from that.
                    this.dbPath = sharedDbPath;
                    this.sharedDbPath = true;

                } else {
                    this.dbPath = svfPath;
                    this.sharedDbPath = false;
                }
            } else {
                this.dbPath = svfPath;
                this.sharedDbPath = false;
            }
        } else {
            this.sharedDbPath = true;

            if (this.svf && this.svf.loadOptions.bubbleNode) {
                //NOTE: sharedDbPath is only used here as a cache key in the property worker.
                //Paths returned by the new getPropertyDbManifest API are fully qualified (starting with "urn:"
                this.dbPath = sharedDbPath;
                let pdbManifest = this.svf.loadOptions.bubbleNode.getPropertyDbManifest();
                this.dbFiles = pdbManifest.propertydb;
                this.needsDbIdRemap = pdbManifest.needsDbIdRemap;
            } else {

                //This fallback lets the worker initialize the file list with defaults
                //to preserve behavior if bubbleNode is not given in the model.
                //This code path should be completely removed eventually.
                logger.warn("Deprecated shared property database initialization without bubbleNode in Model load options.");
                this.dbPath = sharedDbPath;
                this.dbFiles = { attrs : [], avs: [], ids: [], values: [], offsets: [] };
            }
            logger.log("Using shared db path " + sharedDbPath);
        }

        // Apply needsDbIdRemap override, but only for SVF2
        if (isOtg) {
            this.needsDbIdRemap = this.svf.loadOptions.needsDbIdRemap || this.needsDbIdRemap;
        }

        this.queryParams = "";
        let acmSessionId = this.model?.getDocumentNode()?.getDocument()?.getAcmSessionId(this.dbPath);
        acmSessionId = acmSessionId || this.svf?.acmSessionId;
        if (this.svf && acmSessionId) {
            this.queryParams = "acmsession=" + acmSessionId;
        }

        this.loadProgress = 0;

        // Worker callback ID for worker messages during loading.
        this.cbId = undefined;

        // Manage state for optional externalID table.
        this.idLoadState = IdLoadState.NotLoaded;
        this.waitingForExternalIds = []; // Pending {resolve, reject} to be notified when externalId load finished.
    };

    PropDbLoader.prototype.dtor = function() {
        this.asyncPropertyOperation(
            {
                "operation": WORKER_UNLOAD_PROPERTYDB
            },
            function(){}, function(){}
        );

        // If loading is in progress, make sure that no callbacks are triggered anymore
        var loadStarted = Boolean(this.cbId);
        var loadEnded   = this.instanceTree || this.propertyDbError;
        if (loadStarted && !loadEnded) {

            // Disconnect worker callbacks for success, failure, and progress messages
            unregisterWorkerCallback(this.cbId);

            // Some code outside may be waiting for getObjectTree() to fail or succeed.
            // Since we disconnected the worker callbacks, no events will be dispatached anymore.
            // So, we dispatch one right now to avoid getObjectTree() from hanging forever.

            // Note that this.propertyDBError is used by getObjectTree() to distinguish between 
            // success and failure. So, we have to set it before triggering the event.
            this.propertyDbError = { 
                // Indicates that propDb was unloaded while waiting for getObjectTree()
                propDbWasUnloaded: true
            };

            this.eventTarget.dispatchEvent({
                type:   et.OBJECT_TREE_UNAVAILABLE_EVENT,
                svf:    this.svf,
                model:  this.model,
                target: this,
            });
        }

        this.model = null;
        this.svf = null;
    };


    PropDbLoader.prototype.processLoadResult = function(result) {
        var scope = this;

        if (result.instanceTreeStorage) {

            var nodeAccess = new InstanceTreeAccess(result.instanceTreeStorage, result.rootId, result.instanceBoxes);

            scope.instanceTree = new InstanceTree(nodeAccess, result.objectCount, result.maxTreeDepth);
            
            if (scope.svf) {
                //For backwards compatibility, svf.instanceTree has to be set also
                scope.svf.instanceTree = scope.instanceTree;

                // If nodeBoxes are not precomputed, we set the fragBoxes, so that instanceTree can compute nodeBoxes on-the-fly
                scope.instanceTree.setFragmentList(scope.model.getFragmentList());
            }
        }

        if (result.objectCount) {

            //Case where there is no object tree, but objects
            //do still have properties. This is the case for F2D drawings or when
            //the caller explicitly skipped instanceTree derivation.
            scope.hasObjectProperties = result.objectCount;

            if (scope.svf) {
                scope.svf.hasObjectProperties = result.objectCount;
            }
        }

        if (result.dbidOldToNew) {
            this.model.setDbIdRemap(result.dbidOldToNew);
        }

        scope.onLoadProgress(100);

        scope.eventTarget.dispatchEvent({
            type: et.OBJECT_TREE_CREATED_EVENT,
            svf:scope.svf,
            model:scope.model,
            target: scope
        });

    };

    PropDbLoader.prototype.processLoadError = function(error) {

        var scope = this;

        scope.propertyDbError = error;

        scope.onLoadProgress(100);

        scope.eventTarget.dispatchEvent({
            type: et.OBJECT_TREE_UNAVAILABLE_EVENT,
            svf:scope.svf,
            model:scope.model,
            target: scope
        });
    };

    /**
     * Kicks off property database load
     *
     * @param {object} options - Configurations for loading database
     * @param {boolean} options.skipInstanceTreeResult - If set, the loader will skip the step that generates InstanceTreeStorage for use by model tree. Used in server side processing.
     */
    PropDbLoader.prototype.load = function(options) {
        var scope = this;
        options = options || {};

        //Create the shared property worker if not already done
        if (!propWorker) {
            propWorker = createWorkerWithIntercept(true);
            propWorker.addEventListenerWithIntercept(propertyWorkerCallback);
        }

        var onObjectTreeRead = function(result) {
            scope.processLoadResult(result);
        };

        var onObjectTreeError = function(error) {
            scope.processLoadError(error);
        };

        var onObjectTreeProgress = function(progress) {
            scope.onLoadProgress(progress.percent);
        };

        this.cbId = registerWorkerCallback(onObjectTreeRead, onObjectTreeError, onObjectTreeProgress);

        // Precomputed bboxes are only needed when using the model explode feature. If this is not used, we can save some memory and compute boxes on-the-fly instead.
        var loadOptions = this.svf && this.svf.loadOptions;
        var precomputeNodeBoxes = !(loadOptions && loadOptions.disablePrecomputedNodeBoxes);
        var skipExternalIds = !!(loadOptions && loadOptions.skipExternalIds);
        
        // When not using delay-loading, ids are always available. Note that prop operations do always wait
        // until propDB is loaded. So, we can already assume here that prop operations will get the ids.
        if (!skipExternalIds) {
            this.idLoadState = IdLoadState.Available;
        }

        let cmd;
        if (this.svf && this.svf.instanceTree && this.svf.instanceBoxes) {
            cmd = WORKER_CREATE_TREE;
        } else {
            cmd = WORKER_LOAD_PROPERTYDB;
        }

        var xfer = { operation:cmd,
            dbPath: this.dbPath,
            sharedDbPath: this.sharedDbPath,
            propertydb : this.dbFiles,
            fragToDbId: this.svf && this.svf.fragments.fragId2dbId, //the 1:1 mapping of fragment to dbId we got from the SVF or the 1:many we built on the fly for f2d
            fragBoxes : precomputeNodeBoxes && this.svf && this.svf.fragments.boxes, //needed to precompute bounding box hierarchy for explode function (and possibly others)
            needsDbIdRemap: this.needsDbIdRemap,
            is2d: this.svf && this.svf.is2d,
            cbId: this.cbId,
            queryParams : this.queryParams,
            skipExternalIds: skipExternalIds,
            gltfTree: this.svf.instanceTree,
            dbToFragId: this.svf && this.svf.fragments.dbToFragId,
            ...options
            };
            propWorker.doOperation(initLoadContext(xfer)); // Send data to our worker.
    };


    PropDbLoader.prototype.asyncPropertyOperation = function(opArgs, success, fail, progress) {

        const scope = this;

        //Identify which property database we want to work on (the worker can hold multiple property databases)
        opArgs.dbPath = this.dbPath;

        if (scope.instanceTree || scope.hasObjectProperties) {

            opArgs.cbId = registerWorkerCallback(success, fail, progress);

            propWorker.doOperation(opArgs); // Send data to our worker.
        } else if (scope.propertyDbError) {
            if (fail) {
                fail(scope.propertyDbError);
            }
        } else {
            const onEvent = function(e) {

                // Since the event is usually emitted by the viewer, we may receive events from 
                // other models here too. We have to skip those.
                //
                // Note that this is only sufficient because we can safely assume here that there 
                // is always a 1:1 match between models and propDbLoaders.
                //
                // Todo: It would be cleaner to avoid using events from a potentially shared eventTarget, so that
                //       this check wouldn't be needed. But this would require a bit more refactoring 
                //       with more risk of potential side effects.
                if (scope.model !== e.model) {
                    return;
                }

                scope.eventTarget.removeEventListener(et.OBJECT_TREE_CREATED_EVENT, onEvent);
                scope.eventTarget.removeEventListener(et.OBJECT_TREE_UNAVAILABLE_EVENT, onEvent);
                if (scope.instanceTree || scope.hasObjectProperties || scope.propertyDbError) {
                    scope.asyncPropertyOperation(opArgs, success, fail, progress);
                }
                else if (fail) {
                    //avoid infinite recursion.
                    fail({code:ErrorCodes.UNKNOWN_FAILURE, msg:"Failed to load properties"}); 
                }
            };
            scope.eventTarget.addEventListener(et.OBJECT_TREE_CREATED_EVENT, onEvent);
            scope.eventTarget.addEventListener(et.OBJECT_TREE_UNAVAILABLE_EVENT, onEvent);
        }
    };


    /**
     * Gets the properties for an ID.
     *
     * @deprecated Use getProperties2 instead. This avoids the need to load the externalID table unless explicitly needed.
     * This variant always enforces loading when doing queries with empty filter.
     * @param {number} dbId - The database identifier.
     * @param {Callbacks#onPropertiesSuccess} [onSuccess] - Callback for when the properties are fetched.
     * @param {Callbacks#onGenericError} [onError] - Callback for when the properties are not found or another error occurs.
     * @alias Autodesk.Viewing.Private.PropDbLoader#getProperties
     */
    PropDbLoader.prototype.getProperties = function(dbId, onSuccess, onError) {

        if (this.idLoadState === IdLoadState.NotLoaded) {
            logger.warn('Calling getProperties() will cause loading of the potentially large externalIDs file. Use getProperties2() to avoid this warning.');
        }
        this.getProperties2(dbId, onSuccess, onError, { needsExternalId: true });
    };

    /**
     * Gets the properties for an ID. New version of getProperties() that avoids loading of externalId table unless really needed.
     *
     * @param {number} dbId - The database identifier.
     * @param {Callbacks#onPropertiesSuccess} [onSuccess] - Callback for when the properties are fetched.
     * @param {Callbacks#onGenericError} [onError] - Callback for when the properties are not found or another error occurs.
     * @param {object} [options]
     * @param {boolean}[options.needsExternalId] - If true, we enforce loading of externalIDs if necessary. ExternalIds may significantly
     * increase memory consumption and should only be loaded if unavoidable.
     * @alias Autodesk.Viewing.Private.PropDbLoader#getProperties2
     */
    PropDbLoader.prototype.getProperties2 = function(dbId, onSuccess, onError, options) {

        const doGetProps = () => {
            this.asyncPropertyOperation(
                {
                    "operation":WORKER_GET_PROPERTIES,
                    "dbId": dbId,
                    "gltfTree": this.svf && this.svf.instanceTreeBackup
                },
                onSuccess, onError
            );
        };

        // Load externalIDs if necessary
        if (options && options.needsExternalId) {
            this.loadExternalIds()
                .then(doGetProps)
                .catch(onError);
        } else {
            doGetProps();
        }
    };

    /**
     * Bulk property retrieval with property name filter.
     * 
     * @deprecated use getBulkProperties2 instead - which makes sure that externalId table is only loaded if really needed.
     * 
     * @param {number[]} dbIds - array of object dbIds to return properties for.
     * @param {object} [propFilter] - array of property names to retrieve values for. If empty, all properties are returned.
     * @param {Function} onSuccess - Callback function for when results are ready.
     * @param {Function} onError - Callback function for when something went wrong.
     * @param {boolean} [ignoreHidden=false] - true to ignore hidden properties.
     *
     * @alias Autodesk.Viewing.Private.PropDbLoader#getBulkProperties
     */
    PropDbLoader.prototype.getBulkProperties = function(dbIds, propFilter, onSuccess, onError, ignoreHidden) {

        const options = {
            ignoreHidden: ignoreHidden,
            propFilter: propFilter,
            needsExternalId: !propFilter || propFilter.includes("externalId") // Include externalID for empty filters or if explicitly requested
        };

        if (options.needsExternalId && this.idLoadState === IdLoadState.NotLoaded) {
            logger.warn('Calling getProperties() will cause loading of the potentially large externalIDs file. Use getProperties2() to avoid this warning.');
        }

        this.getBulkProperties2(dbIds, options, onSuccess, onError);
    };

    /**
     * Bulk property retrieval with property name filter.
     * 
     * @param {number[]} dbIds - array of object dbIds to return properties for.
     * @param {object}   [options]
     * @param {string[]} [options.propFilter] - array of property names to retrieve values for. If empty, all properties are returned.
     * @param {string[]} [options.categoryFilter] - array of category names to retrieve values for. If empty, all properties are returned.
     * @param {boolean}  [options.ignoreHidden=false] - true to ignore hidden properties.
     * @param {boolean}  [options.needsExternalId] - If true, it is ensured that externalId table is loaded before doing the property query.
     * @param {Function} onSuccess - Callback function for when results are ready.
     * @param {Function} onError - Callback function for when something went wrong.
     *
     * @alias Autodesk.Viewing.Private.PropDbLoader#getBulkProperties2
     */
    PropDbLoader.prototype.getBulkProperties2 = function(dbIds, options = {}, onSuccess, onError) {

        const doGetProps = () => {
            this.asyncPropertyOperation(
                {
                    "operation":WORKER_GET_PROPERTIES,
                    "dbIds": dbIds,
                    "propFilter": options.propFilter,
                    "categoryFilter": options.categoryFilter,
                    "ignoreHidden": options.ignoreHidden
                },
                onSuccess, onError
            );
        };

        // Load externalIDs if necessary
        if (options && options.needsExternalId) {
            this.loadExternalIds()
                .then(doGetProps)
                .catch(onError);
        } else {
            doGetProps();
        }
    };

    /**
     * Retrieves properties related to the specified dbIds.
     * The results object that is passed into the onSuccess callback contains the displayName and displayCategory separated by a '/' as the key and all of the related properties as the entry's value.
     * The results can be used to create a new {@link Autodesk.Viewing.PropertySet|PropertySet} instance.
     * @param {number[]} dbIds - array of object dbIds to return properties for.
     * @param {Object} [options={}]
     * @param {string[]} [options.propFilter] - array of property names to retrieve values for. If empty, all properties are returned.
     * @param {boolean}  [options.ignoreHidden=false] - true to ignore hidden properties.
     * @param {boolean}  [options.needsExternalId] - If true, it is ensured that externalId table is loaded before doing the property query.
     * @param {Function} onSuccess - Callback function for when results are ready.
     * @param {Function} onError - Callback function for when something went wrong.
     * @alias Autodesk.Viewing.Private.PropDbLoader#getPropertySet
     */
    PropDbLoader.prototype.getPropertySet = function (dbIds, options = {}, onSuccess, onError) {
        const doGetProps = () => {
            this.asyncPropertyOperation(
                {
                    operation: WORKER_GET_PROPERTY_SET,
                    dbIds: dbIds,
                    propFilter: options.propFilter,
                    ignoreHidden: options.ignoreHidden,
                    fileType: options.fileType,
                },
                onSuccess,
                onError
            );
        };

        // Load externalIDs if necessary
        if (options && options.needsExternalId) {
            this.loadExternalIds().then(doGetProps).catch(onError);
        } else {
            doGetProps();
        }
    };


    PropDbLoader.prototype.searchProperties = function(searchText, attributeNames, onSuccess, onError, options) {

        this.asyncPropertyOperation(
            {
                "operation": WORKER_SEARCH_PROPERTIES,
                "searchText": searchText,
                "attributeNames" : attributeNames,
                "searchOptions": options
            },
            onSuccess, onError
        );
    };

    PropDbLoader.prototype.findProperty = function(propertyName) {
        
        var that = this;
        return new Promise(function(resolve, reject){
            that.asyncPropertyOperation(
                {
                    "operation": WORKER_FIND_PROPERTY,
                    "propertyName": propertyName
                },
                resolve, reject
            );
        });
    };

    /*
     * Compares this db with another one. The result object passed to onSuccess
     * is an object that contains...
     * {
     *    // An array of all dbIds that...
     *    // a) exist in both databases
     *    // b) have different properties.
     *    changedIds: dbId[]
     *
     *    // Optional: details about what changed exactly.
     *    // If k props changed for a dbId result.changeIds[i], result.propChanges[i]
     *    // is an array of length k. Each element in it describes the change of a single
     *    // property.
     *    propChanges: Object[][]
     * }
     *
     *  @param {PropDbLoader} dbToDiff
     *  @param {function(number[])} onSuccess     - receives the array of dbIds
     *  @param {Object}             [DiffOptions] - Optional diff options object.
     *  @param {function(number)}   onProgress    - Optional callback receiving percent values
     *
     * DiffOptions:
     *   @param {number[]} diffOps.dbIds             - Restrict diff to fixed set of dbIds (otherwise all ids)
     *   @param {boolean}    diffOps.listPropChanges   - If true, result.propChanges is provided (slower)
     *
     * @private
     */
    PropDbLoader.prototype.diffProperties = function(dbToDiff, onSuccess, onError, diffOptions, onProgress) {
        this.asyncPropertyOperation(
            {
                "operation": WORKER_DIFF_PROPERTIES,
                "dbPath2":   dbToDiff, // only pass the second dbPath here. this.dbPath is automatically set (see asyncPropertyOperation)
                "diffOptions": diffOptions
            },
            onSuccess, onError, onProgress
        );
    };

    PropDbLoader.prototype.findLayers = function() {
        
        var that = this;
        return new Promise(function(resolve, reject){
            that.asyncPropertyOperation(
                {
                    "operation": WORKER_FIND_LAYERS
                },
                resolve, reject
            );
        });
    };

    // @param {Object} [extIdFilter] - optional: restricts result to all extIds for which extIdFilter[extId] is true.
    PropDbLoader.prototype.getExternalIdMapping = function(onSuccess, onError, extIdFilter) {

        const doQuery = () => {
            this.asyncPropertyOperation(
                {
                    "operation": WORKER_BUILD_EXTERNAL_ID_MAPPING,
                    "extIdFilter": extIdFilter
                },
                onSuccess, onError
            );
        };
        return this.loadExternalIds().then(doQuery);
    };

    PropDbLoader.prototype.getLayerToNodeIdMapping = function(onSuccess, onError) {

        this.asyncPropertyOperation(
            {
                "operation": WORKER_BUILD_LAYER_TO_NODE_ID_MAPPING
            },
            onSuccess, onError
        );
    };

    /**
     * Allows executing user supplied function code on the worker thread against the 
     * {@link PropertyDatabase} instance. The returned value from the supplied function will
     * be used to resolve the returned Promise. The function must be named `userFunction`.
     *
     * @example
     *     function userFunction(pdb, userData) {
     *          var dbId = 1;
     *          pdb.enumObjectProperties(dbId, function(propId, valueId) { 
     *                // do stuff
     *          });
     *          return 42 * userData; // userData will be 2 in this example
     *     }
     *     executeUserFunction(userFunction, 2).then(function(result) {
     *          console.log(result); // result === 84 === 42 * 2
     *     })
     *
     * @param {Function | string} code - Function takes 1 argument, the {@link PropertyDatabase} instance.
     * @param {*} userData - A value that will get passed to the `code` function when run in the property 
     *                       worker context. it needs to be serializable.
     * 
     * @returns {Promise} - Resolves with the return value of user function.
     *
     * @alias Autodesk.Viewing.Private.PropDbLoader#executeUserFunction
     */
    PropDbLoader.prototype.executeUserFunction = function(code, userData) {
        if (typeof code === "function") {
            code = code.toString();
        } else if (typeof code !== "string") {
            return Promise.reject("Expected Function or string.");
        }

        let blob;
        try {
            blob = new Blob([code], {type: 'application/javascript'});
        } catch (e) {
            // Backward compatibility.
            let builder = new BlobBuilder();
            builder.append(code);
            blob = builder.getBlob();
        }
        let blobUrl = URL.createObjectURL(blob);

        return new Promise( (resolve, reject) => {
            this.asyncPropertyOperation(
                {
                    "operation": WORKER_USER_FUNCTION,
                    "userFunction": blobUrl,
                    "userData": userData
                },
                resolve, reject
            );
        });
    };

    PropDbLoader.prototype.isObjectTreeLoaded = function() {
        return !!this.instanceTree;
    };


    PropDbLoader.prototype.getObjectTree = function(onSuccess, onError) {
        var scope = this;

        if (scope.instanceTree) {
            onSuccess(scope.instanceTree);
        } else if (scope.propertyDbError) {
            if (onError)
                onError(scope.propertyDbError);
        } else if ('hasObjectProperties' in scope) {
            if (scope.svf && scope.svf.is2d && onError)
                onError('F2D files do not have an InstanceTree.');
            else
                onSuccess(null); //loaded property database, but instance tree is empty or not initialized
        } else {
            // Property Db has been requested; waiting for worker to complete //
            var listener = function() {
                scope.eventTarget.removeEventListener(et.OBJECT_TREE_CREATED_EVENT, listener);
                scope.eventTarget.removeEventListener(et.OBJECT_TREE_UNAVAILABLE_EVENT, listener);
                scope.getObjectTree(onSuccess, onError);
            };
            scope.eventTarget.addEventListener(et.OBJECT_TREE_CREATED_EVENT, listener);
            scope.eventTarget.addEventListener(et.OBJECT_TREE_UNAVAILABLE_EVENT, listener);
        }
    };

    PropDbLoader.prototype.onLoadProgress = function(percent) {
        this.eventTarget.dispatchEvent({
            type: et.OBJECT_TREE_LOAD_PROGRESS_EVENT,
            percent: percent,
            svf: this.svf,
            model: this.model,
            target: this
        });
        this.loadProgress = percent;
    };

    /**
     * Estimated load progress in percent.
     *
     * @returns {number} in the range 0..100
     *
     * @alias Autodesk.Viewing.Private.PropDbLoader#getLoadProgress
     */
    PropDbLoader.prototype.getLoadProgress = function() { return this.loadProgress; };


    /**
     * Returns true if loading is finished (either with success or with error)
     *
     * @returns {boolean}
     *
     * @alias Autodesk.Viewing.Private.PropDbLoader#isLoadDone
     */
    PropDbLoader.prototype.isLoadDone = function() { return this.loadProgress==100; };

    // If externalIds were initially skipped using the .skipExternalIds option, this 
    // function allows for loading them later on demand.
    //  @returns {Promise} If resolved, we are ready obtain externalIds from the propDB worker.
    //                     It might be rejected if loading failed or propDB was unloaded while waiting.
    PropDbLoader.prototype.loadExternalIds = function() {

        switch(this.idLoadState) {

            // If ids are already there, we are done.
            case IdLoadState.Available: return Promise.resolve();

            // If we tried to load the ids earlier and failed, we are done as well - just with less success.
            case IdLoadState.Failed: return Promise.reject();

            // If this is the first request for the id-file, send request to worker
            case IdLoadState.NotLoaded: {

                // Avoid to do it again on next call
                this.idLoadState = IdLoadState.Loading;

                // On success, notify everyone that ids are ready
                const onSuccess = () => {
                    this.idLoadState = IdLoadState.Available;
                    this.waitingForExternalIds.forEach(p => p.resolve());
                };

                // On failure, notify everyone that it doesn't make sense to wait anymore
                const onError = () => {
                    this.idLoadState = IdLoadState.Failed;
                    this.waitingForExternalIds.forEach(p => p.reject());
                };

                const options = {
                    operation:   WORKER_LOAD_EXTERNAL_IDS,
                    // Note that values in this.dbFiles are not strings, but 1-element arrays of those.
                    idsFile:     this.dbFiles.ids[0],
                    queryParams: this.queryParams
                };

                // Configure endpoint, credentials etc.
                initLoadContext(options);

                // Setup worker request to load ids file. Note that using asyncPropertyOperation makes sure
                // that this request is delayed until the other propDb files are available.
                this.asyncPropertyOperation(options, onSuccess, onError);
                break;
            }
        }

        // If we get here, the request for id loading must be in progress => resolve/reject later
        return new Promise((resolve, reject) => {
            this.waitingForExternalIds.push({resolve, reject});
        });
    };
