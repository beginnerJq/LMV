//Functional wrapper around a bubble manifest json providing common functionality

var nextId = 1;

function checkForPropertyDb(item) {
	if (item.mime == "application/autodesk-db" && item.urn) {
		//Of course, OSS is a storage system that mangles paths because why not,
		//so it needs special handling to extract the property database path
		if (item.urn.indexOf("urn:adsk.objects:os.object") === 0)
			return item.urn.substr(0, item.urn.lastIndexOf("%2F") + 3);
		else
			return item.urn.substr(0, item.urn.lastIndexOf("/") + 1);
	}
	return null;
}


/**
 * Wrapper and helper for "bubble" data.
 *
 * _Bubble_ is a container of various 2D or 3D viewables (and additional data)
 * that may be generated from a single seed file. The bubble is a JSON structure
 * of nodes that have different roles, for example, they may represent sheets,
 * nested 2D/3D geometry, etc.
 *
 * This class wraps the internal representation of the bubble
 * and adds a couple of helper methods.
 *
 * @constructor
 * @memberof Autodesk.Viewing
 * @alias Autodesk.Viewing.BubbleNode
 * @param {object} rawNode Raw node from the bubble JSON.
 * @param {object} [parent] Parent node from the bubble JSON.
 */
export var BubbleNode = function (rawNode, parent) {

	this.parent = parent;

	//Just an integer ID for use in runtime hashmaps
	this.id = nextId++;

	//TODO: do we need to clone the data into outselves, or just keep pointer as is
	//would be a waste of space to copy...
	this.data = rawNode;

	//Now do some postprocessing / precomputation of things we will need
	//TODO: are there nodes with type==geometry where role isn't 3d nor 2d?
	this.isLeaf = (rawNode.type === "geometry" && (rawNode.role === "3d" || rawNode.role === "2d" || rawNode.role === "lod"));

	if (Array.isArray(rawNode.children) || Array.isArray(rawNode.derivatives)) {
		this.children = [];

		//Recurse
		var rawChildren = rawNode.children || rawNode.derivatives;
		var len = rawChildren.length;

		for (var i = 0; i < len; i++) {
			this.children[i] = new BubbleNode(rawChildren[i], this);
		}

		if (this.children.length > 1) {
			this.children.sort((a, b) => {
				if (!(Object.prototype.hasOwnProperty.call(a.data, 'order') && Object.prototype.hasOwnProperty.call(b.data, 'order'))) return 0;
				return a.data.order - b.data.order; // order number is expected to be an integer
			});
		}

		//Some more postprocessing / precomputation of things we will need
		//Some properties are determined by specific children. Look for those.
		for (let i = 0; i < len; i++) {
			//Find the node's shared property db path -- if there is one, it's one of the children
			var path = checkForPropertyDb(rawChildren[i]);
			if (path)
				this.sharedPropertyDbPath = path;

			//Check if a child geometry is an LOD model
			//TODO: expect a change in the extractor to put the lod role in the node itself
			//so this check will be made on item instead of its children eventually.
			if (rawChildren[i].role === "lod")
				this.lodNode = this.children[i];
		}
	}
};

BubbleNode.prototype.constructor = BubbleNode;

/**
 * Store an instance to the Document.
 * @param {Autodesk.Viewing.Document} lmvDoc 
 */
BubbleNode.prototype.setDocument = function (lmvDoc) {
	this.lmvDocument = lmvDoc;
};

/**
 * Get the Document instance which owns this node.
 * @returns {Autodesk.Viewing.Document|undefined}
 */
BubbleNode.prototype.getDocument = function () {

	let parent = this;
	while (parent.parent)
		parent = parent.parent;

	return parent.lmvDocument;
};

/**
 * @private
 * @returns {boolean} true if the bubble hierarchy contains an embedded otg manifest.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#isOtg
 */
BubbleNode.prototype.isOtg = function () {
	return !!this._getOtgManifest();
};

/**
 * Find the embedded otg_manifest (if avaialble)
 * @private
 * @returns {Object|null}
 */
BubbleNode.prototype._getOtgManifest = function () {

	if ((typeof DISABLE_OTG !== "undefined") && DISABLE_OTG)
		return null;

	var viewable = this.findViewableParent();

	if (!viewable)
		return null;

	var m = viewable.data.otg_manifest;

	//This falls back to no OTG in case OTG conversion
	//is still pending or failed, or otherwise not succeeded.
	//TODO: Probably not the right place for this check in case
	//the application needs to check on the conversion progress, etc...
	//if (!m || m.status !== "success")
	//	return null;

	return m;
};


/**
 * @returns {boolean} true if the bubble is from MD API.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#isSVF2
 */
BubbleNode.prototype.isSVF2 = function () {
	var m = this._getOtgManifest();
	return Boolean(m?.paths?.pharos_type === 'cacheable');
};

/**
 * Returns the OTG viewable from an otg manifest (if available, otherwise undefined)
 * 
 * @returns {Autodesk.Viewing.BubbleNode|undefined}
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#getOtgGraphicsNode
 */
BubbleNode.prototype.getOtgGraphicsNode = function () {

	if (this.isViewPreset()) {
		return this.findParentGeom2Dor3D().getOtgGraphicsNode();
	}

	var otgManifest = this._getOtgManifest();
	return otgManifest && otgManifest.views && otgManifest.views[this.guid()];
};


/**
 * Returns a list of property database files.
 * Previously, for v1, this list was hardcoded in PropWorker/
 * This function knows about v2 and cross-version sharing of OTG property databases
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#getPropertyDbManifest
 */
BubbleNode.prototype.getPropertyDbManifest = function () {
	var otgManifest = this._getOtgManifest();
	var result;

	if (otgManifest && otgManifest.pdb_manifest) {

		var pdbManifest = otgManifest.pdb_manifest;
		result = {
			propertydb: {},
			isOtg: true
		};

		for (var i = 0; i < pdbManifest.assets.length; i++) {
			var asset = pdbManifest.assets[i];

			//OTG v2 property databases do not have a single root path.
			//They have shared (cross-version) components and also per-version
			//components. Construct the paths accordingly.
			var path;
			if (asset.isShared) {
				path = otgManifest.paths.shared_root + pdbManifest.pdb_shared_rel_path;
			} else {
				path = otgManifest.paths.version_root + pdbManifest.pdb_version_rel_path;
			}

			result.propertydb[asset.tag] = [{ path: path + asset.uri, isShared: asset.isShared }];
		}

		//If the property database is OTG, but the specific node we are asking about is not
		//e.g. it is an F2D or SVF, we need to indicate that the Ids mapping needs to be loaded as well.
		var otgNode = this.getOtgGraphicsNode();
		if (!otgNode) {
			result.needsDbIdRemap = true;
		}

	} else {

		//relative to the shared property db path.
		//Same as the list hardcoded in PropWorker.
		//TODO: Get rid of the list hardcoded in the worker and use this one always.
		let path = this.findPropertyDbPath();

		if (path === null) {
			console.warn("Missing property database entry in manifest.");
			path = "";
		}

		if (path.indexOf("$file$") === 0) {
			console.warn("Bubble local path given for shared property DB files. Assuming that sharedPropertyDbPath is specified correctly by loadDocumentNode().");
			path = "";
		}

		const _document = this.getDocument();
		if (_document && path.indexOf('urn') === 0) {
			path = _document.getFullPath(path);
		}

		result = {
			propertydb: {
				attrs: [{ path: path + "objects_attrs.json.gz" }],
				values: [{ path: path + "objects_vals.json.gz" }],
				avs: [{ path: path + "objects_avs.json.gz" }],
				offsets: [{ path: path + "objects_offs.json.gz" }],
				ids: [{ path: path + "objects_ids.json.gz" }]
			}
		};

	}

	return result;
};

/**
 * @returns {Autodesk.Viewing.BubbleNode} Top-most bubble node.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#getRootNode
 */
BubbleNode.prototype.getRootNode = function () {

	if (this.parent)
		return this.parent.getRootNode();

	return this;
};

/**
 * Whether the manifest comes form Forge (modelDerivativeV2) or not (derivativeV2).
 * Applies only to the root node. Used internally.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#isForgeManifest
 */
BubbleNode.prototype.isForgeManifest = function () {

	var root = this.getRootNode();

	// Forge manifest contains attribute `type` with value `manifest`. Other manifest do not.
	return root.data.type === "manifest";
};

/**
 * Finds shared property DB if there is one.
 *
 * @returns {?string} Shared property DB path, or null.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#findPropertyDbPath
 */
BubbleNode.prototype.findPropertyDbPath = function () {

	//In the case of OTG manifest, always return the shared property database path from
	//the property database entry in the OTG manifest. This is even in the case where
	//we are loading F2D file, or falling back to an SVF in case of missing OTG (deprecated code path).
	//In the F2D and fallback SVF case, the
	var otgManifest = this._getOtgManifest();
	var pdbManifest = otgManifest && otgManifest.pdb_manifest;
	if (pdbManifest && pdbManifest.assets && pdbManifest.assets.length) {
		var versionRoot = otgManifest.paths.version_root;
		var pdbRelPath = otgManifest.pdb_manifest.pdb_version_rel_path;
		return versionRoot + pdbRelPath;
	} else if (otgManifest) {
		console.warn("Unexpected: OTG manifest exists, but it has no property database manifest.");
	}

	if (this.sharedPropertyDbPath)
		return this.sharedPropertyDbPath;

	if (this.parent)
		return this.parent.findPropertyDbPath();

	return null;
};

// Deprecated. Avoid using this from the outside.
BubbleNode.prototype._raw = function () {
	return this.data;
};

/**
 * @returns {string} Node name.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#name
 */
BubbleNode.prototype.name = function () {
	return this.data.name || '';
};

/**
 * @returns {string} Node GUID.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#guid
 */
BubbleNode.prototype.guid = function () {
	return this.data.guid;
};


/**
 * @returns {string} Node type.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#type
 */
BubbleNode.prototype.type = function () {
	return this.data.type;
};

/**
 * @returns {?string[]} Either an Array of extension ids, or undefined.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#extensions
 */
BubbleNode.prototype.extensions = function () {
	if (this.data.extensions) {
		return Array.isArray(this.data.extensions) ? this.data.extensions : [this.data.extensions];
	}
	return undefined;
};

/**
 * Retrieves the URN of the node or its closest ancestor.
 *
 * @param {boolean} searchParent If URN is not available for this node,
 * search through its ancestors, too.
 * @returns {string} Viewable URN.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#urn
 */
BubbleNode.prototype.urn = function (searchParent) {

	var urn = this.data.urn;

	if (!searchParent)
		return urn;

	var n = this.parent;
	while (!urn && n) {
		urn = n.data.urn;
		n = n.parent;
	}

	return urn;
};

/**
 * Retrieves the lineageUrn of the node.
 * 
 * @param {boolean} [encode=false] - Whether to return the result base64 encoded or not.
 * 
 * @returns {string|null} Viewable lineageUrn. returns null in case of an error.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#lineageUrn
 */
BubbleNode.prototype.lineageUrn = function (encode) {

	const encodedUrn = this.getRootNode().urn();

	let lineageUrn = BubbleNode.parseLineageUrnFromEncodedUrn(encodedUrn);

	if (encode) {
		lineageUrn = Autodesk.Viewing.toUrlSafeBase64(lineageUrn);
	}

	return lineageUrn;
};

/**
 * Extracts the lineageID string from a base64-encoded version urn
 * Example: dXJuOmFkc2sud2lwc3RnOmZzLmZpbGU6dmYuM3Q4QlBZQXJSSkNpZkFZUnhOSnM0QT92ZXJzaW9uPTI 
 *          => (decoded) "urn:adsk.wipstg:fs.file:vf.3t8BPYArRJCifAYRxNJs4A?version=2"
 *          => "urn:adsk.wipstg:dm.lineage:3t8BPYArRJCifAYRxNJs4A"
 */
BubbleNode.parseLineageUrnFromEncodedUrn = function (encodedUrn) {

	if (!encodedUrn) {
		return null;
	}

	const parts = encodedUrn.split('/');

	let decodedPart = null;

	// An edge case that is being handled here in the loop is of a urn that has been created on offline mode.
	// In this case, it might look like this: "OfflineFiles/dXJuOmFkc2sud2lwZW1lYTpkbS5saW5lYWdlOjRlV01pbFl5UkV1SEIzZHQxTHBNUWc/6/dXJuOmFkc2sud2lwZW1lYTpmcy5maWxlOnZmLjRlV01pbFl5UkV1SEIzZHQxTHBNUWc_dmVyc2lvbj02/output/0/0.svf".
	for (let i = parts.length - 1; i >= 0; i--) {
		try {
			decodedPart = Autodesk.Viewing.fromUrlSafeBase64(parts[i]);
		} catch (e) {
			// That's ok. a possible exception should be catched in case we are viewing an offline file - See comment above.
		}

		if (decodedPart?.indexOf('file:') != -1) {
			break;
		} else {
			decodedPart = null;
		}
	}

	return BubbleNode.parseLineageUrnFromDecodedUrn(decodedPart);
};

/**
 * Extracts the lineageID string from a decoded version urn
 * Example: "urn:adsk.wipstg:fs.file:vf.3t8BPYArRJCifAYRxNJs4A?version=2"
 *          => "urn:adsk.wipstg:dm.lineage:3t8BPYArRJCifAYRxNJs4A"
 */
 BubbleNode.parseLineageUrnFromDecodedUrn = function (urn) {

	if (!urn) {
		return null;
	}

	urn = urn.replace('fs.file:vf.', 'dm.lineage:');

	// Trim the "version" part.
	const end = urn.indexOf('?version');

	return urn.substring(0, end);
};

/** 
 * @returns {boolean} Is this a geometry leaf node. 
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#isGeomLeaf
 */
BubbleNode.prototype.isGeomLeaf = function () {
	return this.isLeaf;
};

/** 
 * @returns {boolean} Is this a viewable node. 
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#isViewable
 */
BubbleNode.prototype.isViewable = function () {

	return this.data.role === "viewable" || 	// derivativeService/v2/
		this.data.outputType === "svf"; 		// modelDerivative/v2/
};

/** 
 * @returns {boolean} Is this an LOD node. 
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#getLodNode
 */
BubbleNode.prototype.getLodNode = function () {
	return this.lodNode;
};

/** 
 * @returns {boolean} Is this a geometry node. 
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#isGeometry
 */
BubbleNode.prototype.isGeometry = function () {
	return this.data.type === "geometry";
};

/** 
 * @returns {boolean} Is this a view preset/camera definition node. 
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#isViewPreset
 */
BubbleNode.prototype.isViewPreset = function () {
	return this.data.type === "view";
};


/** 
 * @returns {boolean} Is this a 2D node. 
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#is2D
 */
BubbleNode.prototype.is2D = function () {
	return this.data.role === "2d";
};

/** 
 * @returns {boolean} Is this a 3D node. 
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#is3D
 */
BubbleNode.prototype.is3D = function () {
	return this.data.role === "3d";
};

/** 
 * @returns {boolean} Is this a 2D geometry node. 
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#is2DGeom
 */
BubbleNode.prototype.is2DGeom = function () {
	return this.isGeometry() && this.is2D();
};

/** 
 * @returns {boolean} Is this a 3D geometry node. 
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#is3DGeom
 */
BubbleNode.prototype.is3DGeom = function () {
	return this.isGeometry() && this.is3D();
};

/** 
 * @returns {boolean} true if the node is meant to be loaded initially.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#useAsDefault
 */
BubbleNode.prototype.useAsDefault = function () {
	return this.data.useAsDefault === true;
};

/** 
 * @param {boolean} [searchMasterview=false] - Search for master view
 * @param {boolean} [loadLargestView=false] - Sort by geometry size
 * @returns {BubbleNode} A geometry node marked as `useAsDefault=true`. When none is found,
 *                       it returns the first element from `this.search({'type': 'geometry'})`.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#getDefaultGeometry
 */
BubbleNode.prototype.getDefaultGeometry = function (searchMasterview = false, loadLargestView = false) {
	var geoms = [];

	if (searchMasterview) {
		let masterViews = this.search(BubbleNode.MASTER_VIEW_NODE);
		if (masterViews.length) {
			geoms = masterViews[0].search({ 'type': 'geometry' });
		}
	}

	if (geoms.length == 0) {
		geoms = this.search({ 'type': 'geometry' });
	}

	if (loadLargestView) {
		geoms.sort(function (a, b) {
			return b.data.size - a.data.size;
		});
	}

	for (var i = 0; i < geoms.length; ++i) {
		if (geoms[i].useAsDefault())
			return geoms[i];
	}
	return geoms[0]; // just get the first one.
};

/**
*  @deprecated
 * @returns {object} Placement transform of the node.
 *
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#getPlacementTransform
 */
BubbleNode.prototype.getPlacementTransform = function () {

	console.warn("BubbleNode.getPlacementTransform is deprecated. Sheet placement information is stored in AECModelData.json");
	return null;
};

/**
 * @deprecated
 */
BubbleNode.prototype.getHash = function () {

	console.warn("BubbleNode.getHash is deprecated and will be removed in a future release.");
	return null;
};

/**
 * Returns a rectangular area. Applies only to 2D documents.
 * 
 * @returns {Array} containing 4 numbers: left, top, right, bottom
 */
BubbleNode.prototype.getViewBox = function () {
	return this.data.viewbox;
};

/** 
 * @returns {boolean} Is this a metadata node. 
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#isMetadata
 */
BubbleNode.prototype.isMetadata = function () {
	//Certain nodes are not relevant for display purposes,
	//as they contain no graphics and provide extra information for
	//the graphics nodes.
	if (this.data.role) {
		if (this.data.role.indexOf("Autodesk.CloudPlatform.DesignDescription") !== -1)
			return true;
		if (this.data.role === "Autodesk.CloudPlatform.PropertyDatabase")
			return true;
	}

	return false;
};

/**
 * @returns {?Autodesk.Viewing.BubbleNode} First parent in the hierarchy that is a viewable. If called
 * on the top level design node, returns the first child of the design node that is a viewable.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#findViewableParent
 */
BubbleNode.prototype.findViewableParent = function () {

	//Some manifests have weird structure where lower level
	//folders also claim they are viewables, so we have to skip
	//past those and keep going up the chain.
	var topViewable = null;

	var p = this;
	while (p) {
		if (p.isViewable())
			topViewable = p;
		p = p.parent;
	}

	//If this is the top level design node, get the viewable node
	//from its children (most of the time it's the first and only viewable child)
	if (!topViewable && !this.parent && this.children) {
		for (var i = 0; i < this.children.length; i++) {
			var c = this.children[i];
			if (c.isViewable()) {
				topViewable = c;
				break;
			}
		}
	}

	return topViewable;
};

/**
 * 
 * @param {object} [options] - Advance usage options
 * @param {Autodesk.Viewing.BubbleNode} [options.fallbackParent] - Gets returned when no geometry node is available after iterating through the parent chain.
 * 
 * @returns {?Autodesk.Viewing.BubbleNode} First parent in the hierarchy that is a 2D or 3D geometry.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#findParentGeom2Dor3D
 */
BubbleNode.prototype.findParentGeom2Dor3D = function (options) {

	var p = this;
	while (p && !p.is2DGeom() && !p.is3DGeom())
		p = p.parent;

	// Some InfraWork translations generate manifests where view-nodes are not
	// direct children of geometry nodes, but instead they are uncles.
	// Therefore, to have the functionality somewhat work, the uncle attempts to 
	// find one of the nephews.
	if (!p && this.isViewPreset()) {
		var geometrySiblings = this.findGeometryFromSiblings();

		// We have no good criteria here to pick one of those siblings,
		// so just return the first one from the list.
		p = geometrySiblings[0];

		// If a fallback parent is available, use it
		if (options && options.fallbackParent) {
			p = options.fallbackParent;
		}
	}

	return p;
};

/**
 * Iterate over all siblings and return a list containing all
 * available geometry nodes.
 * 
 * @return {Autodesk.Viewing.BubbleNode[]} - list of BubbleNodes of geometry type.
 */
BubbleNode.prototype.findGeometryFromSiblings = function () {

	var dad = this.parent;
	if (!dad)
		return [];

	var allCandidates = [];
	for (var i = 0, len = dad.children.length; i < len; ++i) {
		var child = dad.children[i];

		// Skip ourselves
		if (child === this)
			continue;

		var candidate;
		child.traverse((item) => {
			if (item.isGeometry() && (item.is2D() || item.is3D())) {
				candidate = item;
				return true;
			}
		});

		if (candidate)
			allCandidates.push(candidate);
	}

	return allCandidates;
};

/**
 * @returns {Autodesk.Viewing.BubbleNode[]} - Array with all of the viewables under this node.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#findAllViewables
 */
BubbleNode.prototype.findAllViewables = function () {

	var ret = [];

	const isForge = this.isForgeManifest();
	if (isForge) {
		ret = this.search({ outputType: "svf" });
	}

	var ret2 = this.search({ role: "viewable" });
	return ret.concat(ret2); // the order here matters.
};

/**
 * Looks for the viewable root path in this node and all its children.
 * @param {Boolean} ignoreLeaflet If set, it will skip any image pyramid sub-nodes and return a path to F2D file if available.
 * @returns {?string} Viewable root path, or null.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#getViewableRootPath
 */
BubbleNode.prototype.getViewableRootPath = function (ignoreLeaflet) {

	// If we have an embedded otg manifest, use it to get otg path for the resource,
	// by looking for its GUID in the OTG manifest mapping.
	// in case of translation error or missing urn, ignore the otgNode
	var otgGraphicsNode = this.getOtgGraphicsNode();
	if (otgGraphicsNode && otgGraphicsNode.urn && !otgGraphicsNode.error) {
		var otgManifest = this._getOtgManifest();
		return otgManifest.paths.version_root + otgGraphicsNode.urn;
	}

	if (!this.isGeomLeaf())
		return this.urn();

	if (this.is2D()) {
		//prioritize Leaflet image pyramids over the blank F2Ds that they have alongside them
		if (!ignoreLeaflet) {
			var leafletItems = this.search({ role: "leaflet" });
			if (leafletItems && leafletItems.length) {
				return leafletItems[0].urn();
			}
		}

		// PDF
		const pdfItems = this.search(BubbleNode.PDF_PAGE_NODE);

		if (pdfItems?.length) {
			return pdfItems[0].urn();
		}
	}

	var mime = this.is2D() ? "application/autodesk-f2d" : "application/autodesk-svf";

	var items = this.search({ mime: mime });

	if (items && items.length) {
		var path = items[0].urn();
		return path;
	}

	return null;
};

/**
 * Returns all the named view in the viewable. 
 * Named views are obtained from the document’s manifest which contains camera information and a string identifier.
 *
 * @returns {array} All named views. Returns empty array if none are found.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#getNamedViews
 */
BubbleNode.prototype.getNamedViews = function () {
	var views = this.search({ "type": "view" });
	// Only keep views that have names and camera info
	views = views.filter(function (bubbleNode) {
		if (!bubbleNode.data.name) return false;
		if (!Array.isArray(bubbleNode.data.camera)) return false;
		return true;
	});
	return views;
};

/**
 * Returns first node from the bubble matching a GUID.
 *
 * Note that some GUIDs in the bubble are not unique, you have to be sure
 * you are looking for a GUID that is unique if you want correct result
 * from this function. Otherwise use the generic search.
 *
 * @param {string} guid Node GUID.
 * @returns {?Autodesk.Viewing.BubbleNode} Matching bubble node, or null.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#findByGuid
 */
BubbleNode.prototype.findByGuid = function (guid) {
	var item = null;

	this.traverse(function (node) {
		if (node.data.guid === guid) {
			item = node;
			return true;
		}
	});

	return item;
};

/**
 * Finds nodes from the bubble matching one or more properties.
 *
 * @param {object} propsToMatch Filter criteria:
 * To match, nodes must have the specified properties and values.
 * Use comma-separated _property:value_ pairs or named preset object.
 * (See comments in examples below.)
 * @returns {?(BubbleNode[])} Matching nodes, or null.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#search
 * @example
 * // Filter criteria syntax:
 * //   { "property":"value" [, "property":"value", ...] }
 * // or use named preset objects:
 * //   BubbleNode.MODEL_NODE           { "role":"3d", "type":"geometry" }
 * //   BubbleNode.GEOMETRY_SVF_NODE    { "role":"graphics", "mime": "application/autodesk-svf" }
 * //   BubbleNode.SHEET_NODE           { "role":"2d", "type":"geometry" }
 * //   BubbleNode.LEAFLET_NODE         { "role":"leaflet" }
 * //   BubbleNode.IMAGE_NODE           { "role":"image" }
 * //   BubbleNode.GEOMETRY_F2D_NODE    { "role":"graphics", "mime": "application/autodesk-f2d" }
 * //   BubbleNode.VIEWABLE_NODE        { "role":"viewable" }
 * //   BubbleNode.AEC_MODEL_DATA       { "role":"Autodesk.AEC.ModelData"}
 * 
 * var singleProps = myBubbleNode.search({ "type":"geometry" });
 * var multiProps  = myBubbleNode.search({ "role":"3d", "type":"geometry" });
 * var presetProps = myBubbleNode.search( myBubbleNode.SHEET_NODE );
 */
BubbleNode.prototype.search = function (propsToMatch) {

	var result = [];

	this.traverse(function (node) {
		var found = true;
		for (var p in propsToMatch) {
			if (!Object.prototype.hasOwnProperty.call(node.data, p) || node.data[p] !== propsToMatch[p]) {
				found = false;
				break;
			}
		}
		if (found)
			result.push(node);
	});

	return result;
};


/**
 * Recursively traverses the bubble, calling a callback function for each node,
 * for as long as the callback function keeps returning false.
 *
 * @param {function} cb Callback function, accepts a bubble node as an argument,
 * and returns true if the traversal should be terminated.
 * @returns {boolean} Result of the last callback invokation.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#traverse
 */
BubbleNode.prototype.traverse = function (cb) {

	//Allow the callback to exit early if it meets
	//some internal condition and returns true.
	if (cb(this)) return true;

	if (this.children) {

		for (var i = 0; i < this.children.length; i++) {

			if (this.children[i].traverse(cb))
				return true;

		}

	}

	return false;
};


//======================================================================================
// Revit/Fluent/Docs specific functionality
//======================================================================================

/**
 * Checks whether the storage URN of a viewable node matches the given Derivative Service design URN.
 * If the two don't match, then the Derivative Service URN is most likely a shallow copy model,
 * and the actual model storage belongs to the full original URN (returned by this function)
 */
BubbleNode.prototype.getShallowCopySource = function (fromUrn) {

	if (!this.isViewable()) {
		console.error("getShallowCopySource must be called with a viewable node.");
		return null;
	}

	//Get the design URN if not explicitly given
	if (!fromUrn)
		fromUrn = this.parent.urn();

	//Detect shallow copied URNs -- in such case we have to get
	//the OTG data from the original seed.
	var myUrn = this.urn();
	if (myUrn !== fromUrn) {
		if (!myUrn) {
			console.warn(`Unexpected: manifest viewable node does not have a urn property.\n${JSON.stringify(this._raw())}`);
		} else {
			console.log(`Redirecting shallow copied URN ${fromUrn} to ${myUrn}`);
			fromUrn = myUrn;
		}
	}
	return fromUrn;
};


/**
 * @deprecated
 * Returns the contents of the AECModelData.json supplementary file, if available.
 */
BubbleNode.prototype.getAecModelData = function () {

	var viewable = this.findViewableParent();

	if (!viewable)
		return null;

	if (!viewable.data.aec_model_data) {

		// No AecModelData found. One possible reason is that the client didn't make sure that downloadAecModelData() was called (and finished) first.
		// In this case, we warn. However, if the data just doesn't have AecModelData at all (e.g. for Civil terrains and various other formats), don't
		// bother with a warning.
		var docRoot = this.getRootNode();
		var aecNode = docRoot.search({ role: 'Autodesk.AEC.ModelData' })[0];
		var shouldHaveAecData = Boolean(aecNode);
		if (shouldHaveAecData) {
			console.warn("Use Document.getAecModelData(bubbleNode) instead of BubbleNode.getAecModelData(), or make sure Document.downloadAecModelData is loaded before using this API");
		}
		return null;
	}

	return viewable.data.aec_model_data;
};

/**
 * Returns refpoint transform from aecModelData as Matrix4
 */
BubbleNode.prototype.extractRefPointTransform = function () {
	var aec = this.getAecModelData();
	return aec && aec.refPointTransformation && BubbleNode.readMatrixFromArray12(aec.refPointTransformation);
};

/**
 * Find and decode camera (if found). Works on geometry nodes and view nodes.
 *  @returns {Object|null} - camera object with position, target etc. (see readCameraFromArray)
 */
BubbleNode.prototype.extractCamera = function () {

	// view-nodes contain the camera directly
	if (this.data.camera) {
		return BubbleNode.readCameraFromArray(this.data.camera);
	}

	// For geometry nodes, find a contained view preset
	var viewNode = this.isGeometry() && this.search({ type: 'view' })[0];
	return viewNode ? viewNode.extractCamera() : null;
};

/**
 * Returns the Revit Level/Floor of this bubble node. 
 * Only relevant for 2d sheets coming from Revit at the moment.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#getLevel
 */
BubbleNode.prototype.getLevel = function () {

	// Eventually Revit should tag the bubble nodes with this value,
	// currently it's just a guess done by Fluent.guessObjectLevels().

	var level = this.data.levelNumber;

	//TODO: for now, return the first level if a sheet shows multiple levels,
	//since the UI code can't handle it.
	if (Array.isArray(level))
		return level[0];

	return level;
};

/**
 * Returns the Revit Level/Floor name of this bubble node. 
 * Only relevant for 2d sheets coming from Revit at the moment.
 * 
 * @memberof Autodesk.Viewing.BubbleNode
 * @alias Autodesk.Viewing.BubbleNode#getLevelName
 */
BubbleNode.prototype.getLevelName = function () {
	return this.data.levelName || this.getLevel();
};

/**
 * Returns true if the current node is a sheet.
 * @returns {boolean} - true if a sheet false other wise.
 */
BubbleNode.prototype.isSheet = function () {
	let parent = this.parent;

	while (parent) {
		if (parent.name() === "Sheets") return true;
		parent = parent.parent;
	}
	return false;
};

/**
 * Check if the current bubble node is a master view
 * @returns {boolean} - true if the view is a master view false otherwise.
 */
BubbleNode.prototype.isMasterView = function () {
	const masterViewName = BubbleNode.MASTER_VIEW_NODE.name;
	let parent = this;

	while (parent) {
		if (parent.name() === masterViewName) return true;
		parent = parent.parent;
	}
	return false;
};

/**
 * Return name of the model file. This is usually the name of the first child of the root node.
 * @returns {string} - model file name.
 */
BubbleNode.prototype.getModelName = function () {
	const root = this.getRootNode();
	const firstChild = root.children[0];
	return firstChild?.name();
};

/**
 * Return input file type.
 * @returns {string} - file type. i.e. "rvt", "dwg", "nwc", "ifc", "pdf".
 */
BubbleNode.prototype.getInputFileType = function () {
	const root = this.getRootNode();
	const firstChild = root.children?.[0];
	return firstChild?.data.inputFileType;
};

/**
 * @returns {boolean} true if the model is a PDF that was created from a Revit source file.
 */
BubbleNode.prototype.isRevitPdf = function () {
	return !!(this.data.isVectorPDF && this.getInputFileType() === 'rvt');
};

/**
 * Returns a string to uniquely identify a single model.
 * @returns {string} - Unique model key.
 */
BubbleNode.prototype.getModelKey = function () {
	// Note that we cannot simply use bubbleNode.guid(), because these are not really unique.
	//
	// TODO: Consider to just use Urn + viewableId here. The originModel had been recently added to fix problems with issues-ui
	//       (https://git.autodesk.com/fluent/design-collaboration/pull/2528), which looked okay at first glance, because the manifests
	//       are indeed different.
	//       But: When switching between two shallow copies of the same model, this will mean we load (+consolidate) the same model twice.
	// Added bubbleNode.guid() in order to support image files, that don't have viewableRootPath nor originalModel
	const path = `${this.getViewableRootPath()}${this.originModel}${this.guid()}`;

	// Eliminate potential encoding differences. Strictly speaking, we would need a more general url normalization here.
	// But since the paths are all generated by code (and not user input), we don't expect much variation anyway.
	return decodeURIComponent(path);
};

/* 
 * Reads a camera specification, which is stored as 12 floats in view nodes. 
 *  @param {number[]} params     - array of 12 floats
 *  @param {Matrix4} [transform] - optional: transform applied to the camera
 *  @returns {Object|null}       - camera object (see below)
 * @static
 */
BubbleNode.readCameraFromArray = function (params, transform) {
	if (!Array.isArray(params))
		return null;

	// Convert THREE.Vector3 and Object {x:Number y:Number z:Number} into a THREE.Matrix4
	// for backwards compatibility.
	// Can be removed in v8.0.0
	if (transform && !transform.elements) {
		if (!(transform instanceof THREE.Vector3)) {
			transform = new THREE.Vector3().copy(transform);
		}
		var mat = new THREE.Matrix4();
		mat.setPosition(transform);
		transform = mat;
	}

	var camera = {
		position: new THREE.Vector3(params[0], params[1], params[2]),
		target: new THREE.Vector3(params[3], params[4], params[5]),
		up: new THREE.Vector3(params[6], params[7], params[8]),
		aspect: params[9],
		fov: THREE.Math.radToDeg(params[10]),
		orthoScale: params[11],
		isPerspective: !params[12]
	};

	// Apply the transform to the camera
	if (transform) {
		camera.position.applyMatrix4(transform);
		camera.target.applyMatrix4(transform);
		camera.up.transformDirection(transform);
	}

	//Ortho scale hack to fix incorrect ortho scale in Revit view parameters
	//Weirdly, the position-target distance is correct here but when taking from the
	//bubble parameters is the other way around.
	//TODO: the reverse operation is done in viewer.impl.adjustOrthoCamera, perhaps we
	//can remove both code blocks and still retain the same functionality in all code paths?
	if (params[10] === 0 && params[11] === 1 && params[12] === 1) {
		camera.orthoScale = camera.position.distanceTo(camera.target);
	}

	return camera;
};

/*
 * Reads a matrix from 12 floats (upper-left 3x3-matrix + translation offset)
 */
BubbleNode.readMatrixFromArray12 = function (params) {
	return new THREE.Matrix4().fromArray([
		params[0], params[1], params[2], 0.0,
		params[3], params[4], params[5], 0.0,
		params[6], params[7], params[8], 0.0,
		params[9], params[10], params[11], 1.0 // Note that the 1 is essential - otherwise multiplying with translations has no effect!
	]);
};

/** 
 * Returns source file's units.
 * @returns {string} Source file's units.
 */
BubbleNode.prototype.getSourceFileUnits = function () {
	return this.data.units;
};
// ACC-specific helpers to find master views in Revit Extractor derivatives

// Master views from RevitExtractor are always located in a sub-folder name with fixed name.
const masterViewFolderName = '08f99ae5-b8be-4f8d-881b-128675723c10';

BubbleNode.prototype.getMasterViews = function () {
	const root = this.getRootNode();
	const masterViewsBubble = root.search({ name: masterViewFolderName });
	return masterViewsBubble && masterViewsBubble.length > 0 && masterViewsBubble[0].children || [];
};

// @returns {BubbleNode|null} - may be null if there is no master view for the given phaseName
BubbleNode.prototype.getMasterView = function (phaseName) {
	const masterViews = this.getMasterViews();
	const masterView = masterViews.find(view => view.data.phaseNames === phaseName);
	return masterView;
};

BubbleNode.prototype.get3DModelNodes = function () { return this.search(BubbleNode.MODEL_NODE); };
BubbleNode.prototype.getSheetNodes = function () { return this.search(BubbleNode.SHEET_NODE); };

//BubbleNode search patterns for often used nodes (yes, they are confusing, hence pre-defined to
//help you not go insane).
BubbleNode.MODEL_NODE = { "role": "3d", "type": "geometry" };
BubbleNode.GEOMETRY_SVF_NODE = { "role": "graphics", "mime": "application/autodesk-svf" };
BubbleNode.SHEET_NODE = { "role": "2d", "type": "geometry" };
BubbleNode.LEAFLET_NODE = { "role": "leaflet" };
BubbleNode.PDF_PAGE_NODE = { "role": "pdf-page" };
BubbleNode.IMAGE_NODE = { "role": "image" };
BubbleNode.GEOMETRY_F2D_NODE = { "role": "graphics", "mime": "application/autodesk-f2d" };
BubbleNode.VIEWABLE_NODE = { "role": "viewable" };
BubbleNode.AEC_MODEL_DATA = { "role": "Autodesk.AEC.ModelData" };
BubbleNode.MASTER_VIEW_NODE = { "name": "08f99ae5-b8be-4f8d-881b-128675723c10" };


