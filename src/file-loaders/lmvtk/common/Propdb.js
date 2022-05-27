
import { blobToJson, parseIntArray, findValueOffsets, subBlobToJson, subBlobToJsonInt } from '../common/StringUtils';
import { binarySearch } from '../common/SearchUtils';

import { AttributeType, AttributeFlags, RVT_DIM_PROPS } from './PropdbEnums';

//Inlined into enumObjectProperties below
/*
function readVarint(buf, offset) {
    var b;
    var value = 0;
    var shiftBy = 0;
    do {
        b = buf[offset[0]++];
        value |= (b & 0x7f) << shiftBy;
        shiftBy += 7;
    } while (b & 0x80);
    return value;
}
*/

/**
 * The Property Database contains property information for each part of a model.
 * The data is read-only, since it has been packed to optimize memory footprint.
 * It's implemented as an Entity-Atribute-Value (EAV) set of tables.
 * LMV keeps the PropertyDatabase in a browser worker thread to prevent compute-intensive
 * methods to block the main browser UI thread.
 * Words "Attribute" and "Property" are use interchangeably.
 *
 * @param dbjsons
 * @class
 * @class
 */
export function PropertyDatabase(dbjsons) {

    "use strict";

    var _this = this;

    var _isV2 = false;
    var _isVarint = false;

    //The property db json arrays.
    //Some of them are held unparsed in blob form
    //with helper arrays containing offsets into the blobs for each value to be parsed on demand
    var _attrs; // Array of arrays. Inner array is in the form [attrName(0), category(1), dataType(2), dataTypeContext(3), description(4), displayName(5), flags(6), precision(7) ] 
                // See struct AttributeDef in https://git.autodesk.com/A360/platform-translation-propertydb/blob/master/propertydb/PropertyDatabase.h 
    var _offsets;
    var _avs;
    var _valuesBlob;
    var _valuesOffsets;
    var _idsBlob;
    var _idsOffsets;

    //Cached ids of commonly used well known attributes (child, parent, name)
    var _childAttrId;
    var _parentAttrId;
    var _nameAttrId;
    var _instanceOfAttrId;
    var _viewableInAttrId;
    var _externalRefAttrId;
    var _nodeFlagsAttrId;
    var _layersAttrId;

    //Transient structures for detecting invalid cycles in buildObjectTree()
    var _processedIds;
    var _cyclesCount;

    // Used for memoizing recursive calls to getNodeNameAndChildren
    let _instanceNodeCache = {};

    //dbjsons is expected to be of the form
    //{ attrs: {filename1:x, filename2:y}, ids: {filename1:x... }, values: {... }, offsets: {... }, avs: {... } }
    //where each of the elements of each array is a pair of the original name and the unzipped *raw* byte
    //array buffer corresponding to the respective property database constituent. In the current implementation
    //each array is expected to only have one name-value element.


    //=========================================================================

    //The attribute definitions blob is considered small enough
    //to parse using regular APIs
    for (var p in dbjsons.attrs) {
        _attrs = blobToJson(dbjsons.attrs[p]);

        if (_attrs[0] === "pdb version 2")
            _isV2 = true;

        for (var i = 1; i<_attrs.length; i++) {

            var attrName = _attrs[i][0];
            switch (attrName) {
                case "Layer": _layersAttrId = i; break;
                default: break;
            }

            var category = _attrs[i][1];

            switch (category) {
                case "__parent__":      _parentAttrId = i; break;
                case "__child__":       _childAttrId = i; break;
                case "__name__":        _nameAttrId = i; break;
                case "__instanceof__":  _instanceOfAttrId = i; break;
                case "__viewable_in__": _viewableInAttrId = i; break;
                case "__externalref__": _externalRefAttrId = i; break;
                case "__node_flags__": _nodeFlagsAttrId = i; break;
                default: break;
            }

            //As of V2, DbKey attribute values are stored directly into the AV array
            if (_isV2 && _attrs[i][2] === AttributeType.DbKey) {
                _attrs[i][6] = _attrs[i][6] | AttributeFlags.afDirectStorage;
            }
        }

        break; //currently we can only handle single property file (no chunking)
    }

    //manual parse of the attribute-value index pairs array
    for (let p in dbjsons.avs) {

        let buf = dbjsons.avs[p];

        if (buf[0] === "[".charCodeAt(0)) {
            _avs = parseIntArray(dbjsons.avs[p], 0);
        } else {
            _avs = buf;
            _isVarint = true;
        }

        delete dbjsons.avs; //don't need this blob anymore

        break; //currently we can only handle single property file (no chunking)

    }


    //manual parse of the offsets array
    for (let p in dbjsons.offsets) {

            let buf = dbjsons.offsets[p];

            if (buf[0] === "[".charCodeAt(0)) {
                _offsets = parseIntArray(buf, 1); //passing in 1 to reserve a spot for the sentinel value

                //just a sentinel value to make lookups for the last item easier
                _offsets[_offsets.length-1] = _avs.length / 2;
            } else {
                _offsets = new Int32Array(buf.buffer, buf.byteOffset, buf.byteLength/4);
            }

        delete dbjsons.offsets; //don't need this

        break; //currently we can only handle single property file (no chunking)

    }

    //Instead of parsing the values and ids arrays, find the
    //offset of each json item in the blob, and then we can
    //pick and parse specific items later on demand, without
    //parsing the potentially large json blob up front.
    for (let p in dbjsons.values) {
        _valuesBlob = dbjsons.values[p];
        _valuesOffsets = findValueOffsets(_valuesBlob);

        break; //currently we can only handle single property file (no chunking)

    }

    // Get externalIds from data blob. Unlike the other data, this one is optional
    // and may be loaded later or not at all to save memory.
    this.setIdsBlob = function(data) {
        // Just like for _valuesBlob: Find the offset to each value 
        //  but skip the full parse.
        _idsBlob = data;
        _idsOffsets = findValueOffsets(data);
    };

    //Set ids array (if available). Note that the ids array is
    //optional and LMV does not require them. (Just some extensions might do - like PushPins)
    for (let p in dbjsons.ids) {
        this.setIdsBlob(dbjsons.ids[p]);
        break; //currently we can only handle single property file (no chunking)
    }

    //=========================================================================

    /**
     * Obtains the number of database ids (dbIds) available. 
     * These ids range betwee 1 (inclusive) up to getObjectCount() (exclusive).
     *
     * @returns {number}
     */
    this.getObjectCount = function() {
        return _offsets.length-1;
    };

    this.getValueAt = function(valId) {
        return subBlobToJson(_valuesBlob, _valuesOffsets[valId]);
    };

    //faster variant used for traversing the object hierarchy where
    //we know the data type of the value to be an integer
    this.getIntValueAt = function(valId) {
        return subBlobToJsonInt(_valuesBlob, _valuesOffsets[valId]);
    };


    this.getIdAt = function(entId) {
        return subBlobToJson(_idsBlob, _idsOffsets[entId]);
    };

    // Loading the (large) externalIDs can be skipped to save memory.
    this.externalIdsLoaded = function() {
        return Boolean(_idsBlob);
    };

    /**
     * Obtains the actual value of a property.
     *
     * @param {number} attrId - The attribute id
     * @param {number} valId - The value id
     * @param {boolean} [integerHint] - If true the return value will be casted to integer.
     *
     * @returns {*} 
     */
     this.getAttrValue = function(attrId, valId, integerHint) {
        var attr = _attrs[attrId];
        if (attr[6] & AttributeFlags.afDirectStorage) {
            if (attr[2] === AttributeType.DbKey) {
                //db keys are stored directly in the EAV triplet
                return valId;
            }
        }

        return integerHint ? this.getIntValueAt(valId) : this.getValueAt(valId);
    };

    this._getObjectProperty = function(attrId, valId) {

        var attr        = _attrs[attrId];
        var displayName = (attr[5]) ? attr[5] : attr[0];
        var hidden      = this.attributeHidden(attrId);
        
        // type values match those in PropertyDatabase.h
        // See: https://git.autodesk.com/A360/platform-translation-propertydb/blob/master/propertydb/PropertyDatabase.h#L67
        return {
            displayName: displayName,
            displayValue: _this.getAttrValue(attrId, valId),
            displayCategory: attr[1],
            attributeName: attr[0],
            type: attr[2],
            units: attr[3],
            hidden: hidden,
            precision: attr[7] || 0
        };
    };

    /**
     * Obtains all properties for a given database id.
     *
     * @param {number} dbId - The database id
     * @param {string[]} [propFilter=null] - Array of property names to return values for. Use null for no filtering.
     * @param {boolean} [ignoreHidden=false] - true to ignore hidden properties.
     * @param {string[]} [propIgnored=null] - Array of property names to not include in the return value.
     *
     * @returns {object} consisting of attributes `name`, `dbId`, `properties` and `externalId`.
     */
    this.getObjectProperties = function(dbId, propFilter, ignoreHidden, propIgnored, categoryFilter) {
        var result = {
            "dbId":dbId,
            "properties": []
        };

        var needName = false;

        // Check if externalIds are wanted and available
        var filterContainsId = propFilter && (propFilter.indexOf("externalId") !== -1);
        var idsLoaded        = this.externalIdsLoaded();

        // If externalIds are explicitly addressed in the filter, we can assume that the caller expects
        // to have them in the result. So we should report an error if they are not loaded.
        if (filterContainsId && !idsLoaded) {
            console.error('Requesting externalID requires loading of the externalID table');
        }

        // We add externalIds to the result if...
        //  1. externalIds are in memory
        //  2. Either the filter includes externalIds or there is no filter
        var addExternalId = idsLoaded && (!propFilter || filterContainsId);
        if (addExternalId) {
            result.externalId = this.getIdAt(dbId);

            // If there are no other properties required, then just return.
            // Useful when we only care about fetching externalId-only data.
            if (propFilter && propFilter.length === 1) {
                return result;
            }
        }

        var parentProps = null;

        //Loop over the attribute index - value index pairs for the objects
        //and for each one look up the attribute and the value in their
        //respective arrays.
        this.enumObjectProperties(dbId, function(attrId, valId) {
            if (attrId == _instanceOfAttrId) {
                //Recursively resolve any common properties from the parent of this instance
                //NOTE: Here we explicitly ignore hidden properties, because we don't 
                //want the parent instance to override parent/child nodes and other structural 
                //attributes. Specifically, Revit extraction has a bug where the model tree parent is 
                //also instance prototype for its children, so we need to prevent the child
                //from gaining all its siblings as children of its own due to this inheritance.
                var res = _this.getObjectProperties(_this.getAttrValue(attrId, valId), propFilter, true /*ignoreHidden*/, propIgnored, categoryFilter);
                if (res && res.properties) {
                    parentProps = res;
                }
                return;
            }

            var attr = _attrs[attrId];

            if (propFilter && propFilter.indexOf(attr[0]) === -1 && propFilter.indexOf(attr[5]) === -1 )
                return;

            if (categoryFilter && categoryFilter.indexOf(attr[1]) === -1)
                return;

            if (propIgnored && (propIgnored.indexOf(attr[0]) > -1 || propIgnored.indexOf(attr[5]) > -1 ))
                return;

            if (attrId == _nameAttrId) {
                var val = _this.getAttrValue(attrId, valId);
                needName = true;
                result.name = val;
            }
            else {
                                
                //skip structural attributes, we don't want those to display
                //NOTE: The list of structural attributes that we check explicitly is not marked
                //as hidden in older versions of the property database, so if we ever want to
                //add them to the result list, we have to explicitly set the hidden flag for those.
                var hidden = _this.attributeHidden(attrId);
                if (ignoreHidden && hidden) {
                    return;
                }

                var prop = _this._getObjectProperty(attrId, valId);
                result.properties.push(prop);
            }
        });

        //Combine instance properties with any parent object properties
        if (parentProps) {
            var myProps = {};
            var rp = result.properties;
            for (let i=0; i<rp.length; i++) {
                myProps[rp[i].displayName] = 1;
            }

            if (!result.name)
                result.name = parentProps.name;

            var pp = parentProps.properties;
            for (let i=0; i<pp.length; i++) {
                if (!Object.prototype.hasOwnProperty.call(myProps, pp[i].displayName)) {
                    rp.push(pp[i]);
                }
            }
        }

        if (categoryFilter && !result.properties.length)
            return null;

        if (propFilter && !result.properties.length && !addExternalId && !needName)
            return null;

        return result;
    };

    /**
     * Obtains a map between each database id (dbId) and their corresponding external-id.
     * The external-id is the identifier used by the source file. 
     * Example: A translated Revit file has a wall with dbId=1, but in Revit (desktop application) the identifier of that wall is "Wall-06-some-guid-here".
     *
     * @param {number[]} [extIdFilter] - Limits the result to only contain the ids in this array.
     *
     * @returns {object} map from dbId into external-id.
     */
    this.getExternalIdMapping = function(extIdFilter) {
        var mapping = {};
        if (_idsOffsets && 'length' in _idsOffsets) { // Check that it's an indexable type
            for (var dbId=1, len=_idsOffsets.length; dbId<len; ++dbId) {
                var externalId = this.getIdAt(dbId);
                if (!extIdFilter || extIdFilter[externalId]===true) {
                    mapping[externalId] = dbId;
                }
            }
        }
        return mapping;
    };

    //Heuristically find the root node(s) of a scene
    //A root is a node that has children, has no (or null) parent and has a name.
    //There can be multiple nodes at the top level (e.g. Revit DWF), which is why
    //we should get the scene root with absolute certainty from the SVF instance tree,
    //but we would have to uncompress and parse that in -- something that is
    //not currently done. This is good enough for now (if pretty slow).
    this.findRootNodes = function() {

        var idroots = [];
        var idDetachedNodes = []; // These are nodes without a parent or child

        this.enumObjects(function(id) {
            var hasChild = false;
            var hasParent = false;
            var hasName = false;

            _this.enumObjectProperties(id, function(attrId, valId) {
                if (attrId == _parentAttrId) {
                    if (_this.getAttrValue(attrId, valId, true)) //checks for null or zero parent id, in which case it's considered non-parent
                        hasParent = true;
                } else if (attrId == _childAttrId) {
                    hasChild = true;
                }
                else if (attrId == _nameAttrId) {
                    hasName = true;
                }
            });

            if (hasName && !hasParent) {
                hasChild ? idroots.push(id) : idDetachedNodes.push(id);
            }
        });

        // Some dwfx files can have only detached nodes, in which case, we treat them as roots
        return idroots.length > 0 ? idroots : idDetachedNodes; 
    };

    // Does the node have atleast one child?
    this.nodeHasChild = function(dbId) {
        let hasChild = false;

        this.enumObjectProperties(dbId, function(attrId) {
            if (attrId === _childAttrId) {
                hasChild = true;
                return true; // break from enumerating
            }
        });

        return hasChild;
    };
    

    //Gets the immediate children of a node with the given dbId
    this.getNodeNameAndChildren = function(node /* {dbId:X, name:""} */, skipChildren) {

        var id = node.dbId;

        var children;
        var instanceOfValId;

        this.enumObjectProperties(id, function(attrId, valId) {
            var val;

            if (attrId === _parentAttrId) {
                //node.parent = this.getAttrValue(attrId, valId, true); //eventually we will needs this instead of setting parent pointer when creating children below.
            } else if (attrId == _childAttrId && !skipChildren) {
                val = _this.getAttrValue(attrId, valId, true);

                // avoid parent->child links to the same dbId
                if (val !== node.dbId) {
                    var child = { dbId:val, parent:node.dbId };
                    if (!children)
                        children = [child];
                    else
                        children.push(child);
                }

            } else if (attrId === _nameAttrId) {
                node.name = _this.getAttrValue(attrId, valId); //name is necessary for GUI purposes, so add it to the node object explicitly
            } else if (attrId === _nodeFlagsAttrId) {
                node.flags = _this.getAttrValue(attrId, valId, true); //flags are necessary for GUI/selection purposes, so add them to the node object
            } else if (attrId === _instanceOfAttrId) {
                instanceOfValId = valId;
            }
        });

        //If this is an instance of another object,
        //try to get the object name/flags from there.
        //This is not done in the main loop above for performance reasons,
        //we only want to do the expensive thing of going up the object hierarchy
        //if the node does not actually have a name/flags attributes.
        if ((!node.name || !node.flags) && instanceOfValId) {
            const dbIdOfInstance = _this.getAttrValue(_instanceOfAttrId, instanceOfValId, true);

            // Check if the instance node already exists in cache.
            let tmp = _instanceNodeCache[dbIdOfInstance];

            if (!tmp) {
                // Fetch instance node and memoize it.
                _instanceNodeCache[dbIdOfInstance] = tmp = { dbId: dbIdOfInstance, name: null, flags: null };
                _this.getNodeNameAndChildren(tmp, true);
            }

            //Take the name from the prototype object if the instance doesn't have it
            if (tmp.name && !node.name)
                node.name = tmp.name;

            //Take the node flags from the prototype object if the instance doesn't have it
            if (typeof node.flags !== "number" && typeof tmp.flags === "number")
                node.flags = tmp.flags;
        }

        return children;
    };


    /**
     * @param fragToDbId
     * @private
     */
    function buildDbIdToFragMap(fragToDbId) {
        var ret = {};
        for (var i= 0, iEnd=fragToDbId.length; i<iEnd; i++) {

            var dbIds = fragToDbId[i];

            //In 2D drawings, a single fragment (consolidation mesh)
            //can contain multiple objects with different dbIds.
            if (!Array.isArray(dbIds)) {
                dbIds = [dbIds];
            }

            for (var j=0; j<dbIds.length; j++) {
                var dbId = dbIds[j];
                var frags = ret[dbId];
                if (frags === undefined) {
                    //If it's the first fragments for this dbid,
                    //store the index directly -- most common case.
                    ret[dbId] = i;
                }
                else if (!Array.isArray(frags)) {
                    //otherwise put the fragments that
                    //reference the dbid into an array
                    ret[dbId] = [frags, i];
                }
                else {
                    //already is an array
                    frags.push(i);
                }
            }
        }

        return ret;
    }

    this.buildDbIdToFragMap = buildDbIdToFragMap;

//Duplicated from InstanceTree.js
var NODE_TYPE_ASSEMBLY   = 0x0,    // Real world object as assembly of sub-objects
    NODE_TYPE_GEOMETRY   = 0x6;    // Leaf geometry node

    //Builds a tree of nodes according to the parent/child hierarchy
    //stored in the property database, starting at the node with the given dbId
    this.buildObjectTree = function(rootId, //current node dbId
                                    fragToDbId, //array of fragId->dbId lookup
                                    maxDepth, /* returns max tree depth */
                                    nodeStorage
                                    ) {

        //Build reverse lookup for dbId->fragId
        var dbToFragId;
        if (fragToDbId) {
            dbToFragId = buildDbIdToFragMap(fragToDbId);
        }

        _processedIds = {};
        _cyclesCount = 0;

        //Call recursive implementation
        var ret = this.buildObjectTreeRec(rootId, 0, dbToFragId, 0, maxDepth, nodeStorage);
        if (_cyclesCount > 0) {
            console.warn('Property database integrity not guaranteed (' + _cyclesCount + ').');
        }

        _processedIds = null;

        // Clean cache
        _instanceNodeCache = {};

        return ret;
    };

    //Recursive helper for buildObjectTree
    this.buildObjectTreeRec = function(dbId, //current node dbId
                                    parent, //parent dbId
                                    dbToFrag, //map of dbId to fragmentIds
                                    depth, /* start at 0 */
                                    maxDepth, /* returns max tree depth */
                                    nodeStorage
                                    ) {

        // Check for cycles in the tree.
        // There shouldn't be any cycles in the tree...
        if (_processedIds[dbId]) {
            _cyclesCount++;
            return 0;
        }

        _processedIds[dbId] = parent || dbId;

        if (depth > maxDepth[0])
            maxDepth[0] = depth;

        var node = {dbId : dbId};
        var children = this.getNodeNameAndChildren(node);

        var childrenIds = [];

        if (children) {
            for (var j=0; j<children.length; j++) {
                var childHasChildren = this.buildObjectTreeRec(children[j].dbId, dbId, dbToFrag, depth+1, maxDepth, nodeStorage);

                //For display purposes, prune children that are leafs without graphics
                //and add the rest to the node
                if (childHasChildren)
                    childrenIds.push(children[j].dbId);
            }
        }

        var fragIds;

        //leaf node
        if (dbToFrag) {
            var frags = dbToFrag[dbId];
            if (frags !== undefined) {

                //if (childrenIds.length)
                //    console.error("Node that has both node children and fragment children!", node.name, children, childrenIds, frags);

                if (!Array.isArray(frags))
                    fragIds = [frags];
                else
                    fragIds = frags;
            }
        }

        //Use default node flags in case none are set
        //This is not the best place to do this, but it's
        //the last place where we can differentiate between "not set" and zero.
        var flags = node.flags || 0;
        if (flags === undefined) {
            if (fragIds && fragIds.length)
                flags = NODE_TYPE_GEOMETRY;
            else if (childrenIds.length)
                flags = NODE_TYPE_ASSEMBLY;
            else
                flags = 0; //??? Should not happen (those nodes are pruned above)
        }

        // Get child count (nodes + fragments)
        var childCount = childrenIds.length + (fragIds ? fragIds.length : 0);

        // Skip nodes that contain neither children nor any fragments
        if (childCount) {
            nodeStorage.setNode(dbId, parent, node.name, flags, childrenIds, fragIds);
        }

        return childCount;
    };

    /**
     * Given a text string, returns an array of individual words separated by
     * white spaces.
     * Will preserve white spacing within double quotes.
     *
     * @param {string} searchText - Text to search
     */
    this.getSearchTerms = function(searchText) {
        searchText = searchText.toLowerCase();
        //regex preserves double-quote delimited strings as phrases
        var searchTerms = searchText.match(/"[^"]+"|[^\s]+/g) || [];
        var i = searchTerms.length;
        while (i--) {
            searchTerms[i] = searchTerms[i].replace(/"/g, "");
        }
        var searchList = [];
        for (i=0; i<searchTerms.length; i++) {

            if (searchTerms[i].length > 1)
                searchList.push(searchTerms[i]);
        }
        return searchList;
    };

    /**
     * Searches the property database for a string.
     *
     * @param searchText
     * @param attributeNames
     * @param searchOptions
     * @returns Array of ids.
     * @private
     */
    this.bruteForceSearch = function(searchText, attributeNames, searchOptions) {

        const searchList = this.getSearchTerms(searchText);
        if (searchList.length === 0)
            return [];

        //For each search word, find matching IDs
        var results = [];

        const searchHidden = searchOptions?.searchHidden;
        const includeInherited = searchOptions?.includeInherited;
        // { x: [ a, b, c ]}, a,b,c are instances of x
        const inheritanceMap = {};

        for (let k=0; k<searchList.length; k++) {
            var result = [];

            //Find all values that match the search text
            var matching_vals = [];
            for (var i=0, iEnd=_valuesOffsets.length; i<iEnd; i++) {
                var val = this.getValueAt(i);
                if (val === null)
                    continue;
                if (val.toString().toLowerCase().indexOf(searchList[k]) !== -1)
                    matching_vals.push(i);
            }

            if (matching_vals.length === 0) {
                results.push(result);
                continue;
            }
            
            // values should be sorted at this point, but it doesn't hurt making sure they are.
            matching_vals.sort(function(a,b){
                return a - b;
            });

            this.enumObjects(function(id) {

                _this.enumObjectProperties(id, function(attrId, valId) {

                    if (includeInherited && attrId === _instanceOfAttrId) {
                        const pid = parseInt(_this.getAttrValue(attrId, valId));
                        inheritanceMap[pid] = inheritanceMap[pid] || [];
                        inheritanceMap[pid].push(id);
                    }

                    if (!searchHidden) {
                        // skip hidden attributes
                        var isHidden = _this.attributeHidden(attrId);
                        if (isHidden){
                            return;
                        }
                    }

                    var iFound = binarySearch(matching_vals, valId);
                    if (iFound !== -1) {
                        //Check attribute name in case a restriction is passed in
                        if (attributeNames && attributeNames.length && attributeNames.indexOf(_attrs[attrId][0]) === -1)
                            return;

                        result.push(id);
                        return true;
                    }
                });

            });

            results.push(result);
        }

        const addInheritedIds = (ids, inheritanceMap) => {
            // traverse inheritance and add to ids list
            const seen = new Set(ids);
            for (let i = 0; i < ids.length; ++i) {
                const id = ids[i];
                if (!(id in inheritanceMap)) continue;
                const cids = inheritanceMap[id];
                for (let j = 0; j < cids.length; ++j) {
                    const cid = cids[j];
                    if (!seen.has(cid)) {
                        ids.push(cid);
                        seen.add(cid);
                    }
                }
            }
        };

        if (results.length === 1) {
            if (includeInherited) {
                addInheritedIds(results[0], inheritanceMap);
            }
            return results[0];
        }

        //If each search term resulted in hits, compute the intersection of the sets
        var map = {};
        var hits = results[0];
        for (let i=0; i<hits.length; i++)
            map[hits[i]] = 1;


        for (let j=1; j<results.length; j++) {
            hits = results[j];
            var mapint = {};

            for (let i=0; i<hits.length; i++) {
                if (map[hits[i]] === 1)
                    mapint[hits[i]] = 1;
            }

            map = mapint;
        }

        result = [];
        for (let k in map) {
            result.push(parseInt(k));
        }

        if (includeInherited) {
            addInheritedIds(result, inheritanceMap);
        }

        return result;
    };


    /**
     * Given a property name, it returns an array of ids that contain it.
     *
     * @param {string} propertyName - Property name
     */
    this.bruteForceFind = function(propertyName) {

        var results = [];
        this.enumObjects(function(id) {
            
            var idContainsProperty = false;
            _this.enumObjectProperties(id, function(attrId) {

                var attr = _attrs[attrId];
                var propName = attr[0];
                var displayName = attr[5];

                if (propName === propertyName || displayName === propertyName) {
                    idContainsProperty = true;
                    return true;
                }
            });

            if (idContainsProperty) {
                results.push(id);
            }

        });

        return results;
    };

    /**
     * Specialized function that returns:
     * {
     *    'layer-name-1': [id1, id2, ..., idN],
     *    'layer-name-2': [idX, idY, ..., idZ],
     *    ...
     * }
     */
    this.getLayerToNodeIdMapping = function() {
        
        var results = {};
        this.enumObjects(function(id) {
            
            _this.enumObjectProperties(id, function(attrId, valId) {

                if (attrId != _layersAttrId)
                    return;

                var val = _this.getAttrValue(attrId, valId);
                if (!Array.isArray(results[val])) {
                    results[val] = [];
                }
                results[val].push(id);
                return true;
            });

        });

        return results;
    };

    /**
     * Unpacks an attribute value into all available components.
     *
     * @param {number} attrId - The attribute id.
     *
     * @returns {object} containing `name`, `category`, `dataType`, `dataTypeContext`, `description`, `displayName` and `flags`.
     */
    this.getAttributeDef = function(attrId) {
        var _raw = _attrs[attrId];
        return {
            //attrName(0), category(1), dataType(2), dataTypeContext(3), description(4), displayName(5), flags(6), precision(7)
            name:_raw[0],
            category: _raw[1],
            dataType: _raw[2],
            dataTypeContext: _raw[3],
            description: _raw[4],
            displayName: _raw[5],
            flags: _raw[6],
            precision: (_raw.length > 7) ? _raw[7] : 0
        };
    };

    /**
     * Invokes a callback function for each attribute-id in the model.
     *
     * @example
     *      pdb.enumAttributes(function(attrId, attrDef) {
     *           // attrDef is an object
     *           if (attrDef.name === 'name') {
     *               return true; // return true to stop iteration.
     *           }
     *      })
     * 
     * @param {Function} cb - Callback invoked
     */
    this.enumAttributes = function(cb) {
        for (var i=1; i<_attrs.length; i++) {
            if (cb(i, this.getAttributeDef(i), _attrs[i]))
                break;
        }
    };


    //See API doc for this.enumObjectProperties below
    /**
     * @param dbId
     * @param cb
     * @private
     */
    function enumObjectPropertiesV1(dbId, cb) {
        //Start offset of this object's properties in the Attribute-Values table
        let propStart = 2 * _offsets[dbId];

        //End offset of this object's properties in the Attribute-Values table
        let propEnd = 2 * _offsets[dbId+1];

        //Loop over the attribute index - value index pairs for the objects
        //and for each one look up the attribute and the value in their
        //respective arrays.
        for (let i=propStart; i<propEnd; i+=2) {
            let attrId = _avs[i];
            let valId = _avs[i+1];

            if (cb(attrId, valId))
                break;
        }
    }

    //See API doc for this.enumObjectProperties below
    /**
     * @param dbId
     * @param cb
     * @private
     */
    function enumObjectPropertiesV2(dbId, cb) {
        //v2 variable length encoding. Offsets point into delta+varint encoded a-v pairs per object
        let offset = _offsets[dbId];
        let propEnd = _offsets[dbId+1];
        let buf = _avs;

        let a = 0;
        while (offset < propEnd) {

            //Inlined version of readVarint
            let b = buf[offset++];
            let value = b & 0x7f;
            let shiftBy = 7;
            while (b & 0x80) {
                b = buf[offset++];
                value |= (b & 0x7f) << shiftBy;
                shiftBy += 7;
            }

            //attribute ID is delta encoded from the previously seen attribute ID, add that back in
            a += value;

            //Inlined version of readVarint
            b = buf[offset++];
            value = b & 0x7f;
            shiftBy = 7;
            while (b & 0x80) {
                b = buf[offset++];
                value |= (b & 0x7f) << shiftBy;
                shiftBy += 7;
            }

            if (cb(a, value))
                break;
        }
    }

    /**
     * Iterates over all properties for a given database id and invokes the supplied callback function.
     *
     * @param {number} dbId - The attribute id.
     * @param {Function} cb - callback function, that receives 2 arguments: attribute-id (`attrId`) and value-id (`valId`). Have the function return `true` to abort iteration.
     *
     */
    this.enumObjectProperties = _isVarint ? enumObjectPropertiesV2 : enumObjectPropertiesV1;


    let _instanceOfCache = {};

    //See API documentation in this.getPropertiesSubsetWithInheritance below
    /**
     * @param dbId
     * @param desiredAttrIds
     * @param dstValIds
     * @private
     */
    function getPropertiesSubsetWithInheritanceV1(dbId, desiredAttrIds, dstValIds) {

        //Start offset of this object's properties in the Attribute-Values table
        let propStart = 2 * _offsets[dbId];

        //End offset of this object's properties in the Attribute-Values table
        let propEnd = 2 * _offsets[dbId+1];

        let res = [];
        let instanceOfVals = [];
        dstValIds = dstValIds || {};

        //Loop over the attribute index - value index pairs for the objects
        //and for each one look up the attribute and the value in their
        //respective arrays.
        for (let i=propStart; i<propEnd; i+=2) {
            let a = _avs[i];
            let value = _avs[i+1];

            if (a === _instanceOfAttrId) {
                //remember instanceof inheritance for later
                let iofDbId = _this.getAttrValue(a, value);
                instanceOfVals.push(iofDbId);
            } else {
                if (!desiredAttrIds || desiredAttrIds[a]) {
                    dstValIds[a] = value;
                    res.push(a);
                    res.push(value);
                }
            }
        }

        //Really, we only expect one instanceof inheritance, but
        //it's theoretically possible to have several
        for (let i=0; i<instanceOfVals.length; i++) {

            let iofDbId = instanceOfVals[i];

            let cached = _instanceOfCache[iofDbId];
            if (!cached) {
                 _instanceOfCache[iofDbId] = cached = getPropertiesSubsetWithInheritanceV2(iofDbId);
            }

            for (let j=0; j<cached.length; j+=2) {
                let a = cached[j];
                let v = cached[j+1];

                if (desiredAttrIds && !desiredAttrIds[a]) {
                    continue;
                }

                if (!dstValIds[a] && !_this.attributeHidden(a)) {
                    dstValIds[a] = v;
                    res.push(a);
                    res.push(v);
                }
            }
        }

        return res;
    }

    //See API documentation in this.getPropertiesSubsetWithInheritance below
    /**
     * @param dbId
     * @param desiredAttrIds
     * @param dstValIds
     * @private
     */
    function getPropertiesSubsetWithInheritanceV2(dbId, desiredAttrIds, dstValIds) {

        //v2 variable length encoding. Offsets point into delta+varint encoded a-v pairs per object
        let offset = _offsets[dbId];
        let propEnd = _offsets[dbId+1];
        let buf = _avs;

        let res = [];
        let instanceOfVals = [];
        dstValIds = dstValIds || {};

        let a = 0;
        while (offset < propEnd) {

            let b = buf[offset++];
            let value = b & 0x7f;
            let shiftBy = 7;
            while (b & 0x80) {
                b = buf[offset++];
                value |= (b & 0x7f) << shiftBy;
                shiftBy += 7;
            }

            //attribute ID is delta encoded from the previously seen attribute ID, add that back in
            a += value;

            b = buf[offset++];
            value = b & 0x7f;
            shiftBy = 7;
            while (b & 0x80) {
                b = buf[offset++];
                value |= (b & 0x7f) << shiftBy;
                shiftBy += 7;
            }

            if (a === _instanceOfAttrId) {
                //remember instanceof inheritance for later
                let iofDbId = _this.getAttrValue(a, value);
                instanceOfVals.push(iofDbId);
            } else {
                if (!desiredAttrIds || desiredAttrIds[a]) {
                    dstValIds[a] = value;
                    res.push(a);
                    res.push(value);
                }
            }
        }

        //Really, we only expect one instanceof inheritance, but
        //it's theoretically possible to have several
        for (let i=0; i<instanceOfVals.length; i++) {

            let iofDbId = instanceOfVals[i];

            let cached = _instanceOfCache[iofDbId];
            if (!cached) {
                 _instanceOfCache[iofDbId] = cached = getPropertiesSubsetWithInheritanceV2(iofDbId);
            }

            for (let j=0; j<cached.length; j+=2) {
                let a = cached[j];
                let v = cached[j+1];

                if (desiredAttrIds && !desiredAttrIds[a]) {
                    continue;
                }

                if (!dstValIds[a] && !_this.attributeHidden(a)) {
                    dstValIds[a] = v;
                    res.push(a);
                    res.push(v);
                }
            }
        }

        return res;
}

    /**
     * Given an object ID, returns the corresponding value IDs for the given list of attribute Ids.
     * Takes into account instance_of inheritance of properties.
     *
     * @param {number} dbId - Integer input object ID
     * @param {object} desiredAttrIds - An optional map of the requested attribute Ids, where desiredAttrIds[attrId] is "truthy".
     *                                  If not provided, all properties will be returned.
     * @param {object} dstValIds - A storage target map, such that dstValIds[attrId] will be the resulting value ID.
     *                             It is the responsibility of the caller to zero initialize this map.
     *
     * @returns {number[]} - A flat list of integers attributeId - valueId pairs. This is in addition to the dstValIds, for cases
     *                        where the object has mutliple properties of the same type, e.g. children, __viewable_in__, etc.
     */
    this.getPropertiesSubsetWithInheritance = _isVarint ? getPropertiesSubsetWithInheritanceV2 : getPropertiesSubsetWithInheritanceV1;

    /**
     * Iterates over the property database and finds all layers.
     *
     * @returns {object}
     */
    this.findLayers = function() {

        // Same format as F2d.js::createLayerGroups()
        var ret = { name: 'root', id: 1, index: 1,  children: [], isLayer: false, childCount: 0 };

        // Return early when no Layer attribute is present
        if (_layersAttrId === undefined) {
            return ret;
        }

        // Grab all Layer names
        var layers = [];
        var scope = this;
        this.enumObjects(function(dbId) {
            scope.enumObjectProperties(dbId, function(attrId, valId) {
                if (attrId === _layersAttrId) {
                    var layerName = scope.getValueAt(valId);
                    if (layers.indexOf(layerName) === -1) {
                        layers.push(layerName);
                    }
                    // We found what we wanted => skip remaining attribs for this object
                    return true;
                }
            });
        });

        layers.sort(function (a, b) {
            return a.localeCompare(b, undefined, {sensitivity: 'base', numeric: true});
        });

        // Format output to match F2d.js::createLayerGroups()
        ret.childCount = layers.length;
        ret.children = layers.map(function(layerName, index){
            return {
                name: layerName,
                index: index+1,
                id: index+1,
                isLayer: true
            };
        });

        return ret;
    };

    /**
     * Iterates over all database ids and invokes a callback function.
     *
     * @param {Function} cb - callback function. Receives a single parameter: the database-id. Have the function return true to abort iteration.
     * @param {number} fromId - starting id (inclusive)
     * @param {number} toId - end id (exclusive)
     *
     */
    this.enumObjects = function(cb, fromId, toId) {

        // For a given id, the range in _avs is specified by [offsets[id], _offsets[id+1]].
        // The last element in _offsets is just the range end of the final range.
        var idCount = _offsets.length - 1; //== this.getObjectCount()

        if (typeof fromId === "number") {
            fromId = Math.max(fromId, 1);
        } else {
            fromId = 1;
        }

        if (typeof toId === "number") {
            toId = Math.min(idCount, toId);
        } else {
            toId = idCount;
        }

        for (var id=fromId; id<toId; id++) {
            if (cb(id))
                break;
        }
    };

    this.getAttrChild = function() {
        return _childAttrId;
    };

    this.getAttrParent = function() {
        return _parentAttrId;
    };

    this.getAttrName = function() {
        return _nameAttrId;
    };

    this.getAttrLayers = function() {
        return _layersAttrId;
    };

    this.getAttrInstanceOf = function() {
        return _instanceOfAttrId;
    };

    this.getAttrViewableIn = function() {
        return _viewableInAttrId;
    };

    this.getAttrXref = function() {
        return _externalRefAttrId;
    };

    this.getAttrNodeFlags = function() {
        return _nodeFlagsAttrId;
    };

    /**
     * Checks whether an attirbute is hidden or not.
     *
     * @param {number} attrId - The attribute id.
     *
     * @returns {boolean} - true if the attribute is a hidden one.
     */
    this.attributeHidden = function(attrId) {
        var _raw = _attrs[attrId];
        var flags = _raw[6];

        return (flags & 1 /*afHidden*/)
            || attrId == _parentAttrId
            || attrId == _childAttrId
            || attrId == _viewableInAttrId
            || attrId == _externalRefAttrId;
    };

    this._attributeIsBlacklisted = function(attrId) {
        var _raw = _attrs[attrId];
        var name = _raw[0];
        var category = _raw[1];

        //Dimension properties were added at a later time, so
        //some diffs will fail when comparing a file with vs. file without those.
        //Anyway, it's beter to skip those for diff purposes, since they can have numeric
        //noise and result in spurious diffs.
        //See also: https://git.autodesk.com/fluent/modeldb/commit/584d39d5f85a8d2954da557859bb52c224c402af
        if (category === "Dimensions" && RVT_DIM_PROPS.indexOf(name) !== -1)
                return true;

        return false;

    };

    // Returns parent id of dbId or null if there is none. 
    this.findParent = function(dbId) {

        let parent = null;
        _this.enumObjectProperties(dbId, function(attrId, valId) {
            if (attrId === _parentAttrId) {
                parent = _this.getAttrValue(attrId, valId, true);
            }
        });
        return parent;
    };

    // Helper function for _findDifferences.
    // Finds all attributeIds and valueIds - including inherited ones.
    // Results are pushed to 'result' array as objects { attrId, valId }.
    // Hidden attributes are excluded.
    this._getAttributeAndValueIds = function(dbId, result) {

        let avList = this.getPropertiesSubsetWithInheritance(dbId);

        //Convert result to array and sort by attrId so diff can work.
        for (let i=0; i<avList.length; i+=2) {
            let a = avList[i];

            if (this._attributeIsBlacklisted(a) || this.attributeHidden(a))
                continue;

            result.push({
                    attrId: a,
                    valId: avList[i+1]
            });
        }

        result.sort(function byIncAtribId(a,b) {
            return a.attrId - b.attrId;
        });
    };

    /* Finds all common dbIds of this and another db for which the properties are not identical.
     * Hidden attributes are excluded.
     *  @param {PropertyDatabase} dbToCompare
     *  @param {Object} [DiffOptions] diffOptions 
     *  @param {function(number)} [onProgress] gets progress values in percent
     *  @returns {Object} 
     * See PropDbLoader.diffProperties for details about diffOptions and return value.
     *
     * NOTE: Current implementation only supports Otg models.
     *
     * @private
     */
    this.findDifferences = function(dbToCompare, diffOptions, onProgress) {

        var result = {
            changedIds: []
        };

        // Optional: Restrict search to the given ids
        var dbIds = diffOptions && diffOptions.dbIds;

        // Optional: Collect details about which props have changed
        var listPropChanges = diffOptions && diffOptions.listPropChanges;
        if (listPropChanges) {
            result.propChanges = [];
        }

        var db1 = this;
        var db2 = dbToCompare;

        // Reused array of { attrId, valId } pairs.
        var propIds1 = [];
        var propIds2 = [];
        
        // To support instanceOf attributes, we need to recursively check parent attributes/values too. (see getAttributesAndValues)
        // Since the parent of subsequent dbId is often the same, we cache the parent attribs/values that we got from last call.
        // This avoids to do the same check several times and can make diff significantly faster.
        var cachedParentAttribs1 = { result: [], dbId: -1 };
        var cachedParentAttribs2 = { result: [], dbId: -1 };        
        
        var diffObject = function(dbId) {
            
            // get sorted array of {attrIds, valIds} pairs for both objects
            var i1 = 0;
            var i2 = 0;
            propIds1.length = 0;
            propIds2.length = 0;

            db1._getAttributeAndValueIds(dbId, propIds1, true, cachedParentAttribs1);
            db2._getAttributeAndValueIds(dbId, propIds2, true, cachedParentAttribs2);
            
            if (!propIds1.length || !propIds2.length) {
                // If an array is empty, this dbId does only exist
                // in one of the two dbs, i.e, the whole object was added or removed.
                // We are only interested in prop changes of matching objects.
                return;
            } 

            var changeFound = false;
            
            // array of prop changes for current dbId
            var propChanges = undefined;

            while(i1 < propIds1.length && i2 < propIds2.length) {
                
                // Note that some values may be undefined if one of the arrays ended.
                var elem1 = propIds1[i1];
                var elem2 = propIds2[i2];
                var a1 = elem1 && elem1.attrId;
                var v1 = elem1 && elem1.valId;
                var a2 = elem2 && elem2.attrId;
                var v2 = elem2 && elem2.valId;
                
                // If everything is equal, we are done with this attribute
                if (a1 === a2 && v1 === v2) {
                    i1++;
                    i2++;
                    continue;
                }
                
                // If we get here, the current attribute has changed
                changeFound = true;
                
                // If no details are requested, we are done with this dbId
                if (!listPropChanges) {
                    break;
                }
                
                // We exploit here that attributeIds in OTG are always sorted in ascending order
                // Therefore, if a1 > a2, we can safely assume that a1 does not exist in iterator2,
                // but possibly vice versa.
                var prop1Missing = (a1 === undefined || a1 > a2);
                var prop2Missing = (a2 === undefined || a2 > a1);
 
                var change = undefined;
                
                // Handle case that property has been added or removed
                if (prop1Missing) {
 
                    // property was added in db2
                    change = db2._getObjectProperty(a2, v2);    
                    change.displayValueB = change.displayValue;
                    change.displayValue  = undefined;   
             
                    // a2 has been detected as added. Skip it and continue.
                    i2++;
                } else if (prop2Missing) {

                    // property was removed in db2
                    change = db1._getObjectProperty(a1, v1);
                    change.displayValueB = undefined;

                    // a1 has been detected as removed. Skip it and continue.
                    i1++;
                } else {
                    // attrib exists in both, but value has changed
                    change = db1._getObjectProperty(a1, v1);
                    change.displayValueB = _this.getAttrValue(a2, v2);
             
                    i1++;
                    i2++;
                }
                
                // If this is the first prop that change, alloc array for it
                if (!propChanges) {
                    propChanges = [];
                }
                
                propChanges.push(change);
            }
            
            // Collect dbId of modified object
            if (changeFound) {
                result.changedIds.push(dbId);

                // collect correspondign prop change details
                if (listPropChanges) {
                    result.propChanges.push(propChanges);
                }
            }
        };

        // Track progress
        var lastPercent = -1;
        var trackProgress = function(idsDone, idsTotal) {
            // Limit calls to 100 - otherwise it would slow-down everything.
            var percent = Math.floor(100 * idsDone / idsTotal);
            if (percent != lastPercent) {
                onProgress && onProgress(percent);
                lastPercent = percent;
            }
        };

        if (dbIds) {
            // diff selected set of Ids
            for (var i=0; i<dbIds.length; i++) {
                let dbId = dbIds[i];
                diffObject(dbId);
                trackProgress(i, dbIds.length);
            }
        } else {
            // diff all objects
            // Note: We are only searching for common objects that changed. Therefore, the loop
            //       runs only over dbIds that are within the valid range for both.
            var dbIdEnd = Math.min(db1.getObjectCount(), this.getObjectCount());
            for (let dbId = 1; dbId<dbIdEnd; dbId++) {
                diffObject(dbId);
                trackProgress(dbId, dbIdEnd);
            }
        }

        return result;
    };

    this.dtor = function() {
        _attrs = null;
        _offsets = null;
        _avs = null;
        _valuesBlob = null;
        _valuesOffsets = null;
        _idsBlob = null;
        _idsOffsets = null;

        _childAttrId = 0;
        _parentAttrId = 0;
        _nameAttrId = 0;
        _instanceOfAttrId = 0;
        _viewableInAttrId = 0;
        _externalRefAttrId = 0;
        _nodeFlagsAttrId = 0;
    };
}
