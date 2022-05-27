import { pathToURL, ViewingService } from "../../net/Xhr";
import { logger } from "../../../logger/Logger";
import { initPlacement, transformAnimations, transformCameraData } from "../common/SvfPlacementUtils";
import { getHexStringPacked, unpackHexString } from './HashStrings';
import { LmvVector3 } from '../../../wgs/scene/LmvVector3';
import { MeshFlags } from '../../../wgs/scene/MeshFlags';
import { LmvBox3 } from '../../../wgs/scene/LmvBox3';
import { LmvMatrix4 } from '../../../wgs/scene/LmvMatrix4';
import { allocateUintArray } from "../../../wgs/scene/IntArray";
import { ProgressiveReadContext } from "./ProgressiveReadContext";

export const FLUENT_URN_PREFIX = "urn:adsk.fluent:";
export const DS_OTG_CDN_PREFIX = "$otg_cdn$";


export function OtgPackage() {


	this.materials = null; //The materials json as it came from the SVF

	this.fragments = null; //will be wrapped in a FragmentList

	this.geompacks = [];

	this.propertydb = {
		attrs : [],
		avs: [],
		ids: [],
		values: [],
		offsets: [],

		// Table to map between Svf and Otg ids.
		// Note that the same db might be reused by a 2D sheet later. So, it's important to include dbid
		// here as well, even if we don't use it for 3D.
		dbid: [] 
	};

	this.bbox = null; //Overall scene bounds

	this.animations = null; // animations json

	this.pendingRequests = 0;

	this.globalOffset = { x: 0, y: 0, z: 0 };

	this.pendingRequests = 0;
	this.initialLoadProgress = 0;

	this.materialIdToHash = [];

	this.aborted = false;
}

OtgPackage.prototype.getMaterialHash = function(materialIndex) {

	var cached = this.materialIdToHash[materialIndex];
	if (cached)
		return cached;

	// bytes per SHA1 hash
	var stride = this.materialHashes.byteStride;

	//get the hash string that points to the material
	var matHash = getHexStringPacked(this.materialHashes.hashes, materialIndex * stride, stride);

	this.materialIdToHash[materialIndex] = matHash;

	return matHash;
};

OtgPackage.prototype.getGeometryHash = function(geomIndex) {

	// bytes per SHA1 hash
	var stride = this.geomMetadata.byteStride;

	//get the hash string that points to the geometry
	var gHash = getHexStringPacked(this.geomMetadata.hashes, geomIndex * stride, stride);

	return gHash;
};


//Set up the fragments, materials, and meshes lists
//which get filled progressively as we receive their data
OtgPackage.prototype.initEmptyLists = function(loadContext) {

	var svf = this;

	var frags = svf.fragments = {};
	frags.length = svf.metadata.stats.num_fragments;
	frags.numLoaded = 0;
	frags.boxes = loadContext.fragmentTransformsDouble ? new Float64Array(frags.length*6) : new Float32Array(frags.length*6);
	frags.transforms = loadContext.fragmentTransformsDouble ? new Float64Array(frags.length * 12) : new Float32Array(frags.length * 12);
	frags.materials = allocateUintArray(frags.length, svf.metadata.stats.num_materials);
	frags.geomDataIndexes = allocateUintArray(frags.length, svf.metadata.stats.num_geoms);
	frags.fragId2dbId = new Int32Array(frags.length);
	frags.visibilityFlags = new Uint8Array(frags.length);
	frags.mesh2frag = {};
	frags.topoIndexes = null;

	svf.geomMetadata = {
		hashes : null,
		byteStride: 0,
		version: 0,
		numLoaded: 0,
		hashToIndex: {}
	};

	svf.materialHashes = {
		hashes: null,
		byteStride: 0,
		version: 0,
		numLoaded: 0
	};

	//Shell object to make it compatible with SVF.
	//Not sure which parts of this are really needed,
	//SceneUnit is one.
	svf.materials = {
		"name":	"LMVTK Simple Materials",
		"version":	"1.0",
		"scene":	{
			"SceneUnit":	8215,
			"YIsUp":	0
		},
		materials: {}
	};


};


OtgPackage.prototype.loadAsyncResource = function(loadContext, resourcePath, responseType, callback) {

	//Launch an XHR to load the data from external file
	var svf = this;

	this.pendingRequests ++;

	function xhrCB(responseData) {
		svf.pendingRequests--;

		callback(responseData);
	}

	resourcePath = pathToURL(resourcePath, loadContext.basePath);

	ViewingService.getItem(loadContext, resourcePath, xhrCB, loadContext.onFailureCallback,
		{ responseType:responseType || "arraybuffer" }
	);

};


OtgPackage.prototype.loadAsyncProgressive = function(loadContext, resourcePath, ctx, resourceName, onFailureCallback) {

	var svf = this;

	resourcePath = pathToURL(resourcePath, loadContext.basePath);

	function onDone(data, receivedLength) {

		ctx.onEnd(data, receivedLength);

		svf.postLoad(loadContext, resourceName, ctx, data);
	}

	function onProgress(receiveBuffer, receivedLength) {

		if (svf.aborted) {
			return true;
		}

		//Read as many fragments as we can at this time
		ctx.onData(receiveBuffer, receivedLength, false);
	}


	ViewingService.getItem(loadContext, resourcePath, onDone, onFailureCallback || loadContext.onFailureCallback,
		{
			responseType: "text",
			onprogress: onProgress
		}
	);

};


OtgPackage.prototype.loadMetadata = function(loadContext, path) {

	var svf = this;

	this.loadAsyncResource(loadContext, path, "json", function(data) {

		//For OTG, there is a single JSON for metadata and manifest,
		//and it's the root
		svf.metadata = data;
		svf.manifest = svf.metadata.manifest;

		// Set numGeoms. Note that this must happen before creating the GeometryList.
		svf.numGeoms = svf.metadata.stats.num_geoms;

		svf.processMetadata(loadContext);

		svf.initEmptyLists(loadContext);

		var manifest = svf.metadata.manifest;

		//Add the shared property db files to the property db manifest
		//TODO: this is a bit hacky and hardcoded
		var spdb = manifest.shared_assets.pdb;
		for (var p in spdb) {
			if (svf.propertydb[p])
				svf.propertydb[p].push({ path: spdb[p], isShared:true});
			else {
				//Skip this property db file from the list,
				//we don't know how to handle it.
			}

		}

		var pdb = manifest.assets.pdb;
		for (var p in pdb) {
			if (svf.propertydb[p])
				svf.propertydb[p].push({path: pdb[p], isShared:false});
			else {
				//Skip this property db file from the list,
				//we don't know how to handle it.
			}
		}

		//Optional resources

		if (manifest.assets.animations) {
			svf.loadAsyncResource(loadContext, manifest.assets.animations, "json", function(data) {
				svf.animations = data;
				transformAnimations(svf);
			});
		}

		if (manifest.assets.topology) {
			svf.loadAsyncResource(loadContext, path, "json", function(data) {
				svf.topology = data;
			});
		}

		loadContext.onLoaderEvent("otg_root");
		svf.postLoad(loadContext, "metadata");
	});

};


OtgPackage.prototype.loadFragmentList = function(loadContext, path) {

	var svf = this;

	var _t = new LmvVector3();
	var _s = new LmvVector3();
	var _q = { x:0, y:0, z:0, w:1 };
	var _m = new LmvMatrix4(true);
	var _b = new LmvBox3();
	var _zero = { x:0, y:0, z:0 };

	function readOneFragment(ctx, i) {

		//The index is 1-based (due to the record at index 0 being the file header
		//while the runtime FragmentList is a classic 0-based array, so we subtract 1 here.
		i -= 1;

		//Fragments have ot wait for the metadata (placement transform)
		//before they can be fully processed
		if (!svf.metadata)
			return false;

		var idata = ctx.idata();
		var fdata = ctx.fdata();
		var offset = 0;

		var frags = svf.fragments;
		var meshid = frags.geomDataIndexes[i] = idata[offset];
		var materialId = frags.materials[i] =   idata[offset+1];
		var dbId = frags.fragId2dbId[i] =       idata[offset+2];
		var flags =                             idata[offset+3];

		//check if the fragment's material and geometry hashes are already known
		//If not, then pause fragment processing until they are
		//NOTE: mesh ID and material ID are 1-based indices.
		if (meshid > svf.geomMetadata.numLoaded
		|| materialId > svf.materialHashes.numLoaded) {
			//console.log("Delayed fragment", i);
			return false;
		}

		//Add the fragment's mesh to the reverse mapping of geom->fragment
		var meshRefs = frags.mesh2frag[meshid];
		if (meshRefs === undefined) {
			//If it's the first fragments for this mesh,
			//store the index directly -- most common case.
			frags.mesh2frag[meshid] = i;
		}
		else if (!Array.isArray(meshRefs)) {
			//otherwise put the fragments that
			//reference the mesh into an array
			frags.mesh2frag[meshid] = [meshRefs, i];
		}
		else {
			//already is an array
			meshRefs.push(i);
		}

		//Decode mesh flags (currently, we only support bitvalue 1 to mark hidden-by-default meshes)
		//If a filter is specified, set the "unloaded" flag to prevent the mesh geometry from being loaded up front
		var wantLoad = svf.dbIdFilter ? svf.dbIdFilter[dbId] : true;
		var hideBit;
		if (!wantLoad) {
			hideBit = MeshFlags.MESH_NOTLOADED;
		} else {
			hideBit = (flags & 1) ? MeshFlags.MESH_HIDE : 0;
		}
		frags.visibilityFlags[i] = hideBit;

		var lo = svf.metadata.fragmentTransformsOffset || _zero;

		//Read the fragment transform
		var to = offset + 4;
		_t.set(fdata[to+0] + lo.x, fdata[to+1] + lo.y, fdata[to+2] + lo.z);
		_q.x = fdata[to+3];
		_q.y = fdata[to+4];
		_q.z = fdata[to+5];
		_q.w = fdata[to+6];
		_s.set(fdata[to+7], fdata[to+8], fdata[to+9]);

		_m.compose(_t, _q, _s);

		if (svf.placementWithOffset) {
			_m.multiplyMatrices(svf.placementWithOffset, _m);
		}

		var e = _m.elements;
		var dst = frags.transforms;
		var off = i * 12;
		dst[off+0] = e[0]; dst[off+1] = e[1]; dst[off+2] = e[2];
		dst[off+3] = e[4]; dst[off+4] = e[5]; dst[off+5] = e[6];
		dst[off+6] = e[8]; dst[off+7] = e[9]; dst[off+8] = e[10];
		dst[off+9] = e[12]; dst[off+10] = e[13]; dst[off+11] = e[14];

		//Estimated bounding box based on known unit box for the mesh, and the fragment's world transform
        // These are just used temporarily for early rendering until we get the exact bboxes are obtained from BVHWorker.
        // The estimated mostly work, but may be too large in some cases where the PCA axes do not match those of the minimum oriented bbox.
		_b.min.x = -0.5; _b.min.y = -0.5; _b.min.z = -0.5;
		_b.max.x =  0.5; _b.max.y =  0.5; _b.max.z =  0.5;
		_b.applyMatrix4(_m);

        // If we obtained the exact bboxes from BVHWorker already, don't overwrite them.
        if (!frags.boxesLoaded) {
            dst = frags.boxes;
            off = i * 6;
            dst[off+0] = _b.min.x;
            dst[off+1] = _b.min.y;
            dst[off+2] = _b.min.z;
            dst[off+3] = _b.max.x;
            dst[off+4] = _b.max.y;
            dst[off+5] = _b.max.z;
        }

		frags.numLoaded = i+1;

		loadContext.onLoaderEvent("fragment", i);

		return true;
	}


	let ctx = new ProgressiveReadContext(readOneFragment, 13*4);
	this.loadAsyncProgressive(loadContext, path, ctx, "all_fragments");

	return ctx;
};

OtgPackage.prototype.handleHashListRequestFailures = function(loadContext) {

	if (!this.metadata) {
		// Model root not known yet => Retry later when model root is available
		return;
	}

	// If the model is empty, the hash list files don't exist by design.
	// For this case, we suppress the request failure error.
	if (this.geomHashListFailure && this.metadata.stats.num_geoms > 0) {
		loadContext.onFailureCallback.apply(loadContext, this.geomHashListFailure);
	}

	if (this.matHashListFailure && this.metadata.stats.num_materials > 0) {
		loadContext.onFailureCallback.apply(loadContext, this.matHashListFailure);
	}

	this.geomHashListFailure = null;
	this.matHashListFailure  = null;
};

OtgPackage.prototype.loadGeometryHashList = function(loadContext, path) {

	var svf = this;

	function readOneHash(ctx, i) {

		//have ot wait for the metadata
		//before they can be fully processed
		if (!svf.metadata)
			return false;

		if (!svf.geomMetadata.hashes) {
			svf.geomMetadata.hashes = new Uint8Array(ctx.byteStride() * (svf.numGeoms + 1));
			svf.geomMetadata.byteStride = ctx.byteStride();
			svf.geomMetadata.version = ctx.version();
		}

		svf.geomMetadata.hashes.set(ctx.bdata(), i * ctx.byteStride());

//this is curretly set by the OtgLoader
//		svf.geomMetadata.hashToIndex[] = i;

		svf.geomMetadata.numLoaded = i;

		return true;
	}

	// Hash list request error handling is deferred until model root is known
	var onFailure = function() {
		svf.geomHashListFailure = arguments;
		svf.handleHashListRequestFailures(loadContext);
		svf.postLoad(loadContext, "geometry_ptrs", ctx); // Finish hash-list loading state
	};

	let ctx = new ProgressiveReadContext(readOneHash, 20);
	this.loadAsyncProgressive(loadContext, path, ctx, "geometry_ptrs", onFailure);

	return ctx;
};

OtgPackage.prototype.loadMaterialHashList = function(loadContext, path) {

	var svf = this;

	function readOneHash(ctx, i) {

		//have ot wait for the metadata
		//before they can be fully processed
		if (!svf.metadata)
			return false;

		if (!svf.materialHashes.hashes) {
			svf.numMaterials = svf.metadata.stats.num_materials;
			svf.materialHashes.hashes = new Uint8Array(ctx.byteStride() * (svf.numMaterials + 1));
			svf.materialHashes.byteStride = ctx.byteStride();
			svf.materialHashes.version = ctx.version();
		}

		svf.materialHashes.hashes.set(ctx.bdata(), i * ctx.byteStride());

		svf.materialHashes.numLoaded = i;

		return true;
	}

	// Hash list request error handling is deferred until model root is known
	var onFailure = function() {
		svf.matHashListFailure = arguments;
		svf.handleHashListRequestFailures(loadContext);
		svf.postLoad(loadContext, "material_ptrs", ctx); // Finish hash-list loading state
	};

	let ctx = new ProgressiveReadContext(readOneHash, 20);
	this.loadAsyncProgressive(loadContext, path, ctx, "material_ptrs", onFailure);

	return ctx;
};


OtgPackage.prototype.processMetadata = function(loadContext) {

	var svf = this;

	var metadata = svf.metadata;

	initPlacement(svf, loadContext);
	var pt = svf.placementWithOffset;

	if (metadata.cameras) {
		svf.cameras = metadata.cameras;

		for (var i=0; i<svf.cameras.length; i++) {
			var cam = svf.cameras[i];

			cam.position = new LmvVector3(cam.position.x, cam.position.y, cam.position.z);
			cam.target = new LmvVector3(cam.target.x, cam.target.y, cam.target.z);
			cam.up = new LmvVector3(cam.up.x, cam.up.y, cam.up.z);

			if (pt) {
				transformCameraData(cam, pt);
			}
		}
	}

};


OtgPackage.prototype.beginLoad = function(loadContext, otgPath) {

	this.loadMetadata(loadContext, otgPath);

	let ids = loadContext.objectIds;
	if (ids) {
		this.dbIdFilter = {};
		for (let i=0, iEnd=ids.length; i<iEnd; i++) {
			this.dbIdFilter[ids[i]] = 1;
		}
	}

	//These are fundamental and always there.
	//Because the file names are fixed, we can kick off those requests together with the root json.
	//TODO: This needs to be revised in case the filenames become variable (i.e. wait
	//until we can get them from metadata.manifest.assets.
	/*
	this.loadMaterialHashList(loadContext, manifest.assets.materials_ptrs);
	this.loadGeometryHashList(loadContext, manifest.assets.geometry_ptrs);
	this.loadFragmentList(loadContext, manifest.assets.fragments);
	*/
	this.materialsCtx = this.loadMaterialHashList(loadContext, "materials_ptrs.hl");
	this.geometryCtx = this.loadGeometryHashList(loadContext, "geometry_ptrs.hl");
	this.fragmentsCtx = this.loadFragmentList(loadContext, "fragments.fl");
};


OtgPackage.prototype.makeSharedResourcePath = function(cdnUrl, whichType, hash) {

	//TODO: Make this logic preferentially use the CDN paths settings from the
	//viewable manifest instead of the .shared_assets in the per-model settings.
	//In general those will be equal though.

	if (hash.length === 10)
		hash = unpackHexString(hash);

	if (cdnUrl) {

		var shardChars = this.manifest.shared_assets.global_sharding || 0;

		//The shard prefix is a number of character cut off from the hash
		//string and brought to the beginning of the S3 key to improve S3 read
		//preformance.
		var fname = hash;
		var shardPrefix = "";
		if (shardChars) {
			shardPrefix = "/" + hash.slice(0, shardChars);
			fname = hash.slice(shardChars);
		}

		//This prefix is an account ID hash, plus a relative path
		//that is one of /t /g or /m (texture, geometry, material)
		var prefix = this.manifest.shared_assets[whichType];

		if (prefix.indexOf(FLUENT_URN_PREFIX) === 0 || prefix.indexOf(DS_OTG_CDN_PREFIX) === 0) {
			//The CDN bucket name is the first string after the last ":", so skip that too,
			//by slicing up to the first slash
			prefix = prefix.slice(prefix.indexOf("/"));
		} else {
			//it can be a relative path in case of local testing data
			//TODO: not sure this branch will ever get hit
			var split = prefix.split("/");
			prefix = "/" + (split[split.length - 1] || split[split.length - 2])+ "/";
		}

		return cdnUrl + shardPrefix + prefix + fname;

	} else {
		//Locally stored data (testing only) defaults to sharding size of 2 chars
		var shardChars = this.manifest.shared_assets.global_sharding || 2;

		var fname = hash;
		var shardPrefix = "";
		if (shardChars) {
			shardPrefix = "/" + hash.slice(0, shardChars) + "/";
			fname = hash.slice(shardChars);
		}

		var modelBasePath = pathToURL(this.basePath);
		return modelBasePath + this.manifest.shared_assets[whichType] + shardPrefix + fname;
	}
};

OtgPackage.prototype.postLoad = function(loadContext, what, ctx, data) {

	if (what) {
		//console.log("what", what);
		this.initialLoadProgress++;
	}

	//If required files are loaded, continue with the next
	//step of the load sequence
	if (this.initialLoadProgress === 4) {

		//Finish processing the data streams in order of dependcy

		this.materialsCtx.flush();
		this.geometryCtx.flush();
		this.fragmentsCtx.flush();

		this.materialsCtx = null;
		this.geometryCtx = null;
		this.fragmentsCtx = null;

		if (this.fragments.numLoaded < this.metadata.stats.num_fragments)
			logger.warn("Fragments actually loaded fewer than expected.");

		loadContext.onLoaderEvent("all_fragments");
	} else {
		//In rare cases (especially node.js use), one of the content
		//files can appear before the metadata json is loaded.
		//so we have to do a flush when the metadata arrives in order
		//to get the processing unstuck (since readOne bails if there is no metadata).
		if (what === "metadata") {
			this.materialsCtx.flush();
			this.geometryCtx.flush();
			this.fragmentsCtx.flush();
		}
    }
};


OtgPackage.prototype.abort = function() {
	this.aborted = true;
};
