import { ViewingService } from '../net/Xhr';

import { PropertyDatabase } from '../lmvtk/common/Propdb';

import { InstanceTreeStorage, InstanceTreeAccess } from '../../wgs/scene/InstanceTreeStorage';


function PdbCacheEntry(dbPath, isShared) {
    this.pdb = null;
    this.waitingCallbacks = [];
    this.error = false;
    this.dbPath = dbPath;
    this.dbFiles = null;
    this.isShared = isShared;
    this.timestamp = Date.now();
}

function FileCacheEntry(data) {
    this.data = data;
    this.refCount = 1;
}

class PdbCache {

    constructor() {
        this.pdbCache = {};
        this.fileCache = {};
    }

    get(dbPath) {
        let cacheEntry = this.pdbCache[dbPath];

        if (cacheEntry) {
            cacheEntry.timestamp = Date.now();
        }

        return cacheEntry;
    }

    set(dbPath, isShared) {
        let cacheEntry = new PdbCacheEntry(dbPath, isShared);
        this.pdbCache[dbPath] = cacheEntry;
        return cacheEntry;
    }

    getFile(path) {
        let cacheEntry = this.fileCache[path];

        if (cacheEntry) {
            cacheEntry.timestamp = Date.now();
        }

        return cacheEntry;
    }

    setFile(path, data) {
        this.fileCache[path] =  new FileCacheEntry(data);
    }

    delete(dbPath) {
        var cacheEntry = this.get(dbPath);

        if (cacheEntry && cacheEntry.pdb)
            cacheEntry.pdb.refCount--;
        else
            return;

        if (cacheEntry.pdb.refCount === 0) {

            //TODO: erase the entry even if db is shared once it's no longer used?
            //The db files are still cached anyway.
            if (!cacheEntry.isShared) {
                delete this.pdbCache[dbPath];
            }

            if (!cacheEntry.isShared) {
                //Also erase any per-file cache, unless the file is shared across multiple property databases
                for (var fileName in cacheEntry.dbFiles) {
                    var file = cacheEntry.dbFiles[fileName];
                    this.unrefFileCacheEntry(file.storage);
                }
            }
        }
    }

    // Releases a fileCache entry reference if a file is not used anymore.
    //   @param {Object} storage - contains the full file path as (only) key
    unrefFileCacheEntry(storage) {

        // key is the full file path
        for (var key in storage) {
            var fileCacheEntry = this.fileCache[key];
            if (fileCacheEntry) {
                    fileCacheEntry.refCount--;
                    if (fileCacheEntry.refCount === 0)
                            delete this.fileCache[key];
            }
        }
    }
}


function loadPropertyPacks(loadContext, dbId, onPropertyPackLoadComplete) {

    let _this = loadContext.worker;
    let pdbCache = _this.pdbCache;

    if (!pdbCache) {
        _this.pdbCache = pdbCache = new PdbCache();
    }

    //get the cache entry for the given property database URL
    var cacheEntry = pdbCache.get(loadContext.dbPath);
    var repeatedCall = false;
    if (!cacheEntry) {
        cacheEntry = pdbCache.set(loadContext.dbPath, !!loadContext.sharedDbPath);
    } else {
        repeatedCall = true;
    }

    if (cacheEntry.pdb) {
        onPropertyPackLoadComplete(cacheEntry.pdb, cacheEntry.dbidOldToNew);
        return;
    } else if (!cacheEntry.error) {
        //If we are already loading the same property database, queue the callback
        if (repeatedCall) {
            cacheEntry.waitingCallbacks.push(onPropertyPackLoadComplete);
            return;
        }
    } else {
        onPropertyPackLoadComplete(null);
        return;
    }

    var dbfiles = loadContext.propertydb;
    if (!dbfiles) {
        _this.propdbFailed = true;
        onPropertyPackLoadComplete(null);
        return;
    }

    var loadedDbFiles = {};
    var filesToRequest = [];

    if (dbfiles.avs.length) {

        for (var tag in dbfiles) {
            // Skip loading of externalId table if wanted
            if (loadContext.skipExternalIds && tag == 'ids') {
                 continue;
            }

            loadedDbFiles[tag] = {};
            filesToRequest.push({filename: dbfiles[tag][0].path, isShared: dbfiles[tag][0].isShared, storage: loadedDbFiles[tag] });
        }

    } else {

        //Hardcoded list of pdb files -- deprecated, still used when loading F2D files locally, without
        //having loaded a manifest first. And probably in some other cases.

        loadedDbFiles = {
                ids : {},
                attrs : {},
                offsets : {},
                values: {},
                avs: {}
        };

        filesToRequest.push({filename: dbfiles.attrs.length ? dbfiles.attrs[0] : "objects_attrs.json.gz", storage: loadedDbFiles.attrs});
        filesToRequest.push({filename: dbfiles.values.length ? dbfiles.values[0] : "objects_vals.json.gz", storage: loadedDbFiles.values});
        filesToRequest.push({filename: dbfiles.avs.length ? dbfiles.avs[0] : "objects_avs.json.gz", storage: loadedDbFiles.avs});
        filesToRequest.push({filename: dbfiles.offsets.length ? dbfiles.offsets[0] : "objects_offs.json.gz", storage: loadedDbFiles.offsets});

        // Loading the externalId table is optional
        if (!loadContext.skipExternalIds) {
            filesToRequest.push({filename: dbfiles.ids.length ? dbfiles.ids[0] : "objects_ids.json.gz", storage: loadedDbFiles.ids});
        }
    }

    var filesRemaining = filesToRequest.length;
    var filesFailed = 0;

    function onRequestCompletion(data) {

        filesRemaining--;

        // Rough estimate for progress. Although we just count received files here,
        // it already helps to signficantly reduce the perceived "nothing happens" time periods.
        //
        // Tracking the progress of single requests would be more accurate, but:
        //  - Attaching an onprogress handler to XHR would cause it to consume 2-3x more memory,
        //    because it has to receive the data as text and then convert to array buffer on the fly.
        //  - Due to the content encoding, the progress callbacks wouldn't know the file size, but only
        //    the amount of transferred data, so that they wouldn't help much.
        _this.postMessage({
            cbId: loadContext.cbId,
            progress: {
                // Having all files loaded doesn't mean we are fully done. Reserve 5 percent for the rest.
                percent: 95 * (filesToRequest.length - filesRemaining) / filesToRequest.length
            }
        });

        if (!data)
            filesFailed++;

        // If all of the files we've requested have been retrieved, create the
        // property database.  Otherwise, request the next required file.
        //
        if (!filesRemaining) {
            if (filesFailed) {
                cacheEntry.error = true;
                onPropertyPackLoadComplete(null);
                while (cacheEntry.waitingCallbacks.length) {
                    cacheEntry.waitingCallbacks.shift()(null);
                }
            } else {

                //De-reference the result buffer from this array so that
                //it can be freed on the fly when the PropertyDatabases parses itself
                filesToRequest.forEach(function(f) {
                    f.storage = null;
                });

                //Store the property db instance in its cache entry
                try {
                    cacheEntry.pdb = new PropertyDatabase(loadedDbFiles);
                    cacheEntry.pdb.refCount = 0; //will be incremented by the success callback
                    cacheEntry.loaded = true;
                    cacheEntry.dbFiles = filesToRequest;

                    cacheEntry.timestamp = Date.now();

                    //TODO: revise this to use the pdb.byteSize() call once it's merged in.
                    cacheEntry.byteSize = 0;
                    for (let f in loadedDbFiles) {
                        for (let p in loadedDbFiles[f]) {
                            let fdata = loadedDbFiles[f][p];
                            cacheEntry.byteSize += fdata && fdata.byteLength;
                        }
                    }

                    for (let p in loadedDbFiles.dbid) {
                        var b = loadedDbFiles.dbid[p];
                        cacheEntry.dbidOldToNew = new Int32Array(b.buffer, b.byteOffset, b.byteLength / 4);
                        break;
                    }

                    onPropertyPackLoadComplete(cacheEntry.pdb, cacheEntry.dbidOldToNew);

                    while (cacheEntry.waitingCallbacks.length) {
                        cacheEntry.waitingCallbacks.shift()(cacheEntry.pdb, cacheEntry.dbidOldToNew);
                    }
                }
                catch(err) {
                    onPropertyPackLoadComplete(null, null, (err && err.message) );
                }
            }
        }
    }
    // Request the files.
    //
    filesToRequest.forEach(function(f) {
        requestFile(f.filename, loadContext, onRequestCompletion, f.storage, f.isShared);
    });
}


function requestFile(filename, loadContext, onRequestCompletion, storage, isShared) {

    function onFailure(status, statusText, data) {
        // We're explicitly ignoring missing property files.
        if (status !== 404) {
            loadContext.onFailureCallback(status, statusText, data);
        }
        onRequestCompletion(null);
    }

    var url;
    if (filename.indexOf("://") !== -1 || filename.indexOf("urn:") === 0) {
        url = filename;
    } else {
        url = (loadContext.dbPath || '') + filename;
    }

    var fullPath = ViewingService.generateUrl(loadContext.endpoint, "items", url);

    var onSuccess = function(response)
    {
        //Cache for future reuse
        if (isShared) {
            loadContext.worker.pdbCache && loadContext.worker.pdbCache.setFile(fullPath, response);
        }

        storage[fullPath] = response;
        onRequestCompletion(response);
    };

    //Fulfill the request from cache if available
    var cacheEntry = loadContext.worker.pdbCache && loadContext.worker.pdbCache.getFile(fullPath);
    if (cacheEntry) {
        cacheEntry.refCount++;
        onSuccess(cacheEntry.data);
    } else {
        ViewingService.getItem(loadContext, url, onSuccess, onFailure);
    }

}

function createTree(node, parent, dbToFrag, nodeStorage) {
    var dbId = node.dbId;
    var children = node.children;
    var childrenIds = [];
    if (children) {
        for (var j=0; j<children.length; j++) {
            var childHasChildren = createTree(children[j], dbId, dbToFrag, nodeStorage);

            if (childHasChildren)
                childrenIds.push(children[j].dbId);
        }
    }

    var fragIds;

    //leaf node
    if (dbToFrag) {
        var frags = dbToFrag[dbId];
        if (frags !== undefined) {
            if (!Array.isArray(frags))
                fragIds = [frags];
            else
                fragIds = frags;
        }
    }

    var childCount = childrenIds.length + (fragIds ? fragIds.length : 0);
    if (childCount) {
        nodeStorage.setNode(dbId, parent, node.name.toString(), 0, childrenIds, fragIds);
    }
    return childCount;
}

function doObjectTreeCreate(loadContext) {
    var _this = loadContext.worker;
    var gltfTree = loadContext.gltfTree;
    var dbToFragId = loadContext.dbToFragId;
    var nodeStorage = new InstanceTreeStorage();

    createTree(gltfTree, 0, dbToFragId, nodeStorage);
    nodeStorage.flatten();

    _this.postMessage({ cbId:loadContext.cbId,
        result : {
            rootId: gltfTree.dbId,
            instanceTreeStorage: nodeStorage
        }
    });
}

function doObjectTreeParse(loadContext) {

    var _this = loadContext.worker;

    function onPropertyPackLoadComplete(propertyDb, dbidOldToNew, errorMessage) {
        if(!propertyDb) {
            _this.postMessage({
                cbId: loadContext.cbId,
                error: { instanceTree:null, maxTreeDepth:0, err: errorMessage }
            });
            return;
        }

        propertyDb.refCount++;

        //Find the root object:
        //TODO: internalize this into the pdb object.
        if (!loadContext.skipInstanceTreeResult && !propertyDb.rootsDone) {
            propertyDb.idroots = propertyDb.findRootNodes();
            propertyDb.rootsDone = true;
        }

        var rootId;
        var maxDepth = [0];

        var transferList = [];
        var storage;
        let nodeAccess = null;

        var fragToDbId = loadContext.fragToDbId;

        // Only need to rebuild fragToDbId using the old IDs in F2D case.
        if (loadContext.needsDbIdRemap && loadContext.is2d) {
            if (!dbidOldToNew) {
                console.warn("ID remap required, but not loaded.");
            } else if (!fragToDbId) {
                console.warn("No frag->dbid mapping!.");
            } else {

                //Replace the frag2dbid mapping by a new one using the
                //correct property db v2 ids.
                var old2new = dbidOldToNew;
                var fr2id = [];

                for (var i=0; i<fragToDbId.length; i++) {

                    var d = fragToDbId[i];

                    if (!Array.isArray(d)) {
                        fr2id[i] = old2new[d];
                    } else {
                        fr2id[i] = [];
                        for (var j=0; j<d.length; j++) {
                            fr2id[i][j] = old2new[d[j]];
                        }
                    }
                }

                fragToDbId = fr2id;
            }
        }

        //In the cases of 2D drawings, there is no meaningful
        //object hierarchy, so we don't build a tree.
        var idroots = propertyDb.idroots;
        if (idroots && idroots.length)
        {
            storage = new InstanceTreeStorage();

            if (idroots.length == 1 && propertyDb.nodeHasChild(idroots[0])) {
                //Case of a single root in the property database,
                //use that as the document root.
                rootId = idroots[0];
                propertyDb.buildObjectTree(rootId, fragToDbId, maxDepth, storage);
            }
            else {
                //Case of multiple nodes at the root level
                //This happens in DWFs coming from Revit.
                //Create a dummy root and add all the other roots
                //as its children.
                rootId = -1e10;         // Big negative number to prevent conflicts with F2D
                var childrenIds = [];

                for (var i=0; i<idroots.length; i++) {
                    propertyDb.buildObjectTree(idroots[i], fragToDbId, maxDepth, storage);
                    childrenIds.push(idroots[i]);
                }

                storage.setNode(rootId, 0, "", 0, childrenIds, false);
            }

            storage.flatten();
            transferList.push(storage.nodes.buffer);
            transferList.push(storage.children.buffer);
            transferList.push(storage.strings.buf.buffer);
            transferList.push(storage.strings.idx.buffer);


            //Now compute the bounding boxes for instance tree nodes
            if (loadContext.fragBoxes) {
                nodeAccess = new InstanceTreeAccess(storage, rootId);
                nodeAccess.computeBoxes(loadContext.fragBoxes);
                transferList.push(nodeAccess.nodeBoxes.buffer);
            }
        }

        _this.postMessage({ cbId:loadContext.cbId,
                            result : {
                               rootId: rootId,
                               instanceTreeStorage: storage,
                               instanceBoxes: (!!nodeAccess) ? nodeAccess.nodeBoxes : undefined,
                               dbidOldToNew: loadContext.needsDbIdRemap ? dbidOldToNew : null,//If we have a dbId mapping (from new OTG dbIds to old F2D dbIds send it to the main thread.
                               maxTreeDepth:maxDepth[0],
                               objectCount:propertyDb.getObjectCount()
                               }
                          }, transferList);
    }

    loadPropertyPacks(loadContext, null, onPropertyPackLoadComplete);
}

function doPropertySearch(loadContext) {

    var _this = loadContext.worker;

    var cacheEntry = _this.pdbCache && _this.pdbCache.get(loadContext.dbPath);

    if (cacheEntry && cacheEntry.pdb) {
        const searchText = loadContext.searchText;
        var result = cacheEntry.pdb.bruteForceSearch(searchText, loadContext.attributeNames, loadContext.searchOptions);
        _this.postMessage({ cbId:loadContext.cbId, result:result });
    }

}

function doPropertyDiff(loadContext) {

    var _this = loadContext.worker;

    // get property dbs to compare
    var cacheEntry1 = _this.pdbCache && _this.pdbCache.get(loadContext.dbPath);
    var cacheEntry2 = _this.pdbCache && _this.pdbCache.get(loadContext.dbPath2);
    var pdb1 = cacheEntry1 && cacheEntry1.pdb;
    var pdb2 = cacheEntry2 && cacheEntry2.pdb;

    // send messages for progress events to main thread
    var onProgress = function(percent) {
        loadContext.worker.postMessage({
            cbId: loadContext.cbId,
            progress: { percent: percent }
        });
    };

    if (pdb1 && pdb2) {
        var result = pdb1.findDifferences(pdb2, loadContext.diffOptions, onProgress);
        _this.postMessage( { cbId: loadContext.cbId, result: result } );
    }
}

function doPropertyFind(loadContext) {

    var _this = loadContext.worker;

    var cacheEntry = _this.pdbCache && _this.pdbCache.get(loadContext.dbPath);

    if (cacheEntry && cacheEntry.pdb) {
        var result = cacheEntry.pdb.bruteForceFind(loadContext.propertyName);
        _this.postMessage({ cbId:loadContext.cbId, result:result });
    }

}

function doLayersFind(loadContext) {
    var _this = loadContext.worker;

    var cacheEntry = _this.pdbCache && _this.pdbCache.get(loadContext.dbPath);

    if (cacheEntry && cacheEntry.pdb) {
        var result = cacheEntry.pdb.findLayers();
        _this.postMessage({ cbId:loadContext.cbId, result:result });
    }
}

function searchTree(node, dbId, result) {
    if(Object.keys(result).length > 0) {
        return;
    }

    if(dbId == node.dbId) {
        result['name'] = node.name;
        result['dbId'] = dbId;
        return;
    }

    var children = node.children;
    if (children) {
        for (var j=0; j<children.length; j++) {
            searchTree(children[j], dbId, result);
        }
    }
}

function getPropertyResults(loadContext) {
    var _this = loadContext.worker;

    var cacheEntry = _this.pdbCache && _this.pdbCache.get(loadContext.dbPath);

    if (!cacheEntry || !cacheEntry.pdb) {
        if (loadContext.gltfTree) {
            var gltfTree = loadContext.gltfTree;
            var result= {};
            searchTree(gltfTree, loadContext.dbId, result);
            return result;
        }
        return;
    }

    var dbId = loadContext.dbId;
    var dbIds = loadContext.dbIds;
    var propFilter = loadContext.propFilter;
    var ignoreHidden = loadContext.ignoreHidden;
    var categoryFilter = loadContext.categoryFilter;
    const fileType = loadContext.fileType;

    if (typeof dbIds !== "undefined") {
        var results = [];
        if (dbIds && dbIds.length) {
            for (var i=0; i<dbIds.length; i++) {
                var result = cacheEntry.pdb.getObjectProperties(dbIds[i], propFilter, ignoreHidden, undefined, categoryFilter);
                if (result)
                    results.push(result);
            }
        } else { //If dbIds is empty, return results for all objects (i.e. no ID filter)
            for (var i=1, last=cacheEntry.pdb.getObjectCount(); i<=last; i++) {
                var result = cacheEntry.pdb.getObjectProperties(i, propFilter, ignoreHidden, undefined, categoryFilter);
                if (result)
                    results.push(result);
            }
        }
        return results;
    } else {
        var result = cacheEntry.pdb.getObjectProperties(dbId, propFilter, undefined, undefined, categoryFilter);
        return result;
    }
}

function doPropertyGet(loadContext) {
    var results = getPropertyResults(loadContext);
    if (!results) {
        loadContext.worker.postMessage({cbId:loadContext.cbId, error: {msg:"Properties are not available."}});
    } else {
        loadContext.worker.postMessage({cbId:loadContext.cbId, result: results});
    }
}

function doPropertySetGet(loadContext) {
    var results = getPropertyResults(loadContext);
    if (!results) {
        loadContext.worker.postMessage({cbId:loadContext.cbId, error: {msg:"Properties are not available."}});
    }

    var map = {};
    var names = [];

    // Process the results and generate a map.
    // The map's keys are "displayCategory/displayName" and the map's values are all of the properties containing the same name and category.
    for (var i = 0; i < results.length ; ++i) {
        var result = results[i];
        const props = result.properties;

        // Not every document type has a proper externalId
        // We will handle only RVT which has translatable from Hex to Decimal value
        if (loadContext.fileType === 'rvt') {
            try {
                let elementId;

                // Check if the properties include an element ID already
                const elementIdProperty = props.find(each => each.attributeName === "ElementId");

                if (elementIdProperty) {
                    elementId = elementIdProperty.displayValue;
                }

                // Or fall back and generate it from the external ID, if the external ID is present
                if (result.externalId && !elementId) {
                    const externalIdSplit = result.externalId.split('-');

                    if (externalIdSplit.length) {
                        elementId = parseInt(externalIdSplit[externalIdSplit.length - 1], 16);
                    }
                }

                // since in this context we don't know either model OTG/SVF, we will add elementId only if name isn't already included
                if (elementId && !result.name.includes(elementId)) {
                    result.name += ` [${elementId}]`;
                }
            } catch (e) {
                // We don't want failures to generate ElementId to fail the whole PropertySet process.
                console.warn(`Caught error in updating ElementIds, object with dbId ${result.dbId} skipped`, e);
            }
        }

        props.forEach(function (prop) {
            // The category is always present for revit but not fusion.
            // Make sure to add a Name key to the property set map.
            if (prop.displayName === 'Name' && !prop.displayCategory) {
                // Keep track of the Name entries.
                names.push(result.name);
            }

            var identifier = !prop.displayCategory ? prop.displayName : `${prop.displayCategory}/${prop.displayName}`;
            if (!map.hasOwnProperty(identifier)) {
                map[identifier] = [];
            }
            prop.parentName = result.name;
            prop.dbId = result.dbId;
            map[identifier].push(prop);
        });

        // Add a Name key to the property set map.
        if (result.hasOwnProperty('name') && names.indexOf(result.name) === -1) {
            if (!map.hasOwnProperty('Name')) {
                map['Name'] = [];
            }

            map['Name'].push({
                displayName: 'Name',
                displayValue: result.name,
                displayCategory: null,
                attributeName: 'Name',
                type: 20,
                units: null,
                hidden: false,
                precision: 0,
                dbId: result.dbId,
                parentName: result.name,
            });
        }
    }
    names = [];
    map["__selected_dbIds__"] = loadContext.dbIds;
    loadContext.worker.postMessage({cbId:loadContext.cbId, result: map});
}


function doBuildExternalIdMapping(loadContext) {

    var _this = loadContext.worker;

    var cacheEntry = _this.pdbCache && _this.pdbCache.get(loadContext.dbPath);

    if (cacheEntry && cacheEntry.pdb) {
        var mapping = cacheEntry.pdb.getExternalIdMapping(loadContext.extIdFilter);
        _this.postMessage({cbId : loadContext.cbId, result: mapping});
    }
}

function doBuildLayerToNodeIdMapping(loadContext) {
    var _this = loadContext.worker;

    var cacheEntry = _this.pdbCache && _this.pdbCache.get(loadContext.dbPath);

    if (cacheEntry && cacheEntry.pdb) {
        var mapping = cacheEntry.pdb.getLayerToNodeIdMapping();
        _this.postMessage({cbId : loadContext.cbId, result: mapping});
    }
}

function doUnloadPropertyDb(loadContext) {
    var _this = loadContext.worker;

    if (loadContext.clearCaches) {
        _this.pdbCache = null;
        return;
    }

    _this.pdbCache && _this.pdbCache.delete(loadContext.dbPath);
}

// Required params
//  @param {string} loadContext.dbPath
//  @param {string} loadContext.idsFile - filename of the ids-file
//  @param {string} loadContext.cbId    - worker callback id
//  @param {Object} loadContext.worker  - global worker context
//
// Preconditions:
//  - PropDbLoader makes sure that this task is not called before propDb finished loading. (see asyncPropertyOperation in PropDblLoader)
function doLoadExternalIds(loadContext) {

    var _this = loadContext.worker;

    // Deprecated case: If pdbFiles are not known use hard-wired one (see comment in loadPropertyPacks)
    var idsFileEntry = loadContext.idsFile || { path: "objects_ids.json.gz" };

    // After loading, storage[fullPath] will contain the response blob.
    var storage = {};

    // Purpose of doLoadExternalIds is to delay-load the ids for a PropDb.
    // If this propDb is not loaded and not even requested to load, we cannot add externalIds to it.
    var cacheEntry = _this.pdbCache.get(loadContext.dbPath);
    if (!cacheEntry) {
        console.error('Delay-loading of externalIDs requires to load the propDb first.');
        return;
    }

    // Skip here if we have the ids already. Note that this will usually be prevented by propDbLoader already.
    if (cacheEntry.pdb && cacheEntry.pdb.externalIdsLoaded()) {
        _this.postMessage({cbId: loadContext.cbId});
        return;
    }

    // Receives ids-file blob (or null on failure)
    var onDone = function(data) {

        if (!data) {
            // Loading failed. requestFile() already posted an error message in this case.
            return;
        }

        // Find propertyDB in cache that we want to load ids for
        let pdbCache = _this.pdbCache;
        cacheEntry = pdbCache.get(loadContext.dbPath);
        if (!cacheEntry || !cacheEntry.pdb) {

            // PropDBLoader delays id-loading until propertyDB finished loading.
            // So, if we get here and cannot find the propDb, we can assume that the propertyDb must have been unloaded meanwhile.

            // Make sure that we don't leak the blob in the file-cache (requestFile adds the reference automatically)
            pdbCache.unrefFileCacheEntry(storage);

            // Send message to inform that waiting makes no sense anymore, because
            // propDb has been unloaded meanwhile.
            _this.postMessage({
                cbId: loadContext.cbId,
                error: {
                    propDbWasUnloaded: true
                }
            });
        }

        // Make ids available in pdb
        cacheEntry.pdb.setIdsBlob(data);
        cacheEntry.byteSize += data.byteLength;

        // Append entry to cacheEntry.dbFiles. This makes sure that the id file blob is released just like
        // all other dbFiles when the propDb is unloaded later. (see unloadPropertyDb)
        var newFile = {
            filename: idsFileEntry.path,
            storage: storage,
        };
        cacheEntry.dbFiles.push(newFile);

        // Signal that we are done - main thread is now ready to query externalIds.
        _this.postMessage({cbId: loadContext.cbId});
    };

    requestFile(idsFileEntry.path, loadContext, onDone, storage, idsFileEntry.isShared);
}

function doExecuteCode(loadContext) {

    var _this = loadContext.worker;

    //This is expected to load a function named "userFunction"
    if (loadContext.userFunction) {
        try {
            importScripts(loadContext.userFunction);
        } catch(err) {
            console.error(err);
            _this.postMessage({ cbId: loadContext.cbId, error: { msg: "Error while importing 'userFunction'." } });
            return;
        }
    }

    if (!self.userFunction) {
        _this.postMessage({ cbId: loadContext.cbId, error: { msg: "function 'userFunction' was not found." } });
        return;
    }

    var cacheEntry = _this.pdbCache && _this.pdbCache.get(loadContext.dbPath);

    if (cacheEntry && cacheEntry.pdb) {
        var result;
        try {
            result = self.userFunction(cacheEntry.pdb, loadContext.userData);
        } catch (err) {
            console.error(err);
            _this.postMessage({ cbId: loadContext.cbId, error: { msg: "Error while executing 'userFunction'." } });
            return;
        } finally {
            self.userFunction = undefined; // cleanup
        }
        _this.postMessage({cbId : loadContext.cbId, result: result});
    }
}

export function register(workerMain) {
    workerMain.register("BUILD_EXTERNAL_ID_MAPPING", { doOperation: doBuildExternalIdMapping });
    workerMain.register("BUILD_LAYER_TO_NODE_ID_MAPPING", { doOperation: doBuildLayerToNodeIdMapping });
    workerMain.register("GET_PROPERTIES", { doOperation: doPropertyGet });
    workerMain.register("GET_PROPERTY_SET", { doOperation: doPropertySetGet });
    workerMain.register("SEARCH_PROPERTIES", { doOperation: doPropertySearch });
    workerMain.register("DIFF_PROPERTIES", { doOperation: doPropertyDiff });
    workerMain.register("FIND_PROPERTY", { doOperation: doPropertyFind });
    workerMain.register("FIND_LAYERS", { doOperation: doLayersFind });
    workerMain.register("LOAD_PROPERTYDB", { doOperation: doObjectTreeParse });
    workerMain.register("CREATE_TREE", { doOperation: doObjectTreeCreate });
    workerMain.register("UNLOAD_PROPERTYDB", { doOperation: doUnloadPropertyDb });
    workerMain.register("USER_FUNCTION", { doOperation: doExecuteCode });
    workerMain.register("LOAD_EXTERNAL_IDS", { doOperation: doLoadExternalIds });
}
