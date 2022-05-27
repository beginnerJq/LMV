import {isMobileDevice} from "../../../compat";
import { BVHBuilder } from '../../../wgs/scene/BVHBuilder';
import { LmvVector3 } from "../../../wgs/scene/LmvVector3";
import { ViewingService } from '../../net/Xhr';

import { InputStream } from '../common/InputStream';
import { PackFileReader } from './PackReader';
import { FragList, readFragments, readGeometryMetadata, filterFragments } from './Fragments';
import { readInstance, readInstanceTree } from './Instances';
import { initPlacement, transformAnimations, calculatePlacementWithOffset, transformCameraData } from '../common/SvfPlacementUtils';
import { readCameraDefinition } from './Cameras';
import { readLightDefinition } from './Lights' ;

var Zlib = require("zlibjs/bin/unzip.min.js").Zlib;


/** @constructor */
export function Package(zipPack) {

    this.unzip = new Zlib.Unzip(zipPack);

    this.manifest = null;

    this.materials = null; //The materials json as it came from the SVF

    this.metadata = null; //metadata json

    this.fragments = null; //will be a FragList

    this.geompacks = [];

    //TODO:
    //Those will not be parsed immediately
    //but we will remember the raw arrays
    //and fire off async workers to parse
    //them later, once we are loading geometry packs
    this.instances = [];

    this.cameras = [];
    this.lights = [];

    this.propertydb = {
        attrs : [],
        avs: [],
        ids: [],
        values: [],
        offsets: []
    };

    this.bbox = null; //Overall scene bounds

    this.animations = null; // animations json

    this.pendingRequests = 0;

    this.globalOffset = { x: 0, y: 0, z: 0 };

    this.topologyPath = null; // string path to the topology file

}



Package.prototype.loadAsyncResource = function(loadContext, resourcePath, contents, callback) {

    //Data is immediately available from the SVF zip
    if (contents) {
        callback(contents);
        return;
    }

    //Launch an XHR to load the data from external file
    var svf = this;

    this.pendingRequests ++;

    function xhrCB(responseData) {
        svf.pendingRequests--;

        callback(responseData);

        if (svf.pendingRequests == 0)
            svf.postLoad(loadContext);
    }

    ViewingService.getItem(loadContext, loadContext.basePath + resourcePath,
                            xhrCB,
                            loadContext.onFailureCallback
                           );

};

/**
 * Extracts `manifest.json` file from the geometry pack file. Note that 
 * the call to `Zlib.Unzip.decompress()` throws an exception if the manifest
 * cannot be found in the pack file. The exception will be caught in 
 * `guardFunction` that encapsulates the call, so this function does not 
 * return any value.
 * 
 * @param {object} loadContext The loading context object passed in by an 
 * SvfLoader object as it successfully downloaded a geometry pack file. The 
 * load context is not used in this function.
 * 
 * @throws {Error} `manifest.json` cannot be found within the package.
 */
Package.prototype.loadManifest = function(loadContext) {
    // TODO: zlib.js throws exceptions on failure;
    // it doesn't return null as this code seems to assume.
    // yes, LoadContext is passed in, but is not used.
    var manifestJson = this.unzip.decompress("manifest.json");
    if (!manifestJson)	
        return false;
    var jdr = new InputStream(manifestJson);
    this.manifest = JSON.parse(jdr.getString(manifestJson.byteLength));
};

// Replace default globalOffset from SvfPlacementOffset by a recomputed one computed based on Fragment bboxes.
Package.prototype.applyLargeBoxOffset = function(offset) {
    if (offset && 
        (offset.x !== this.globalOffset.x ||
         offset.y !== this.globalOffset.y || 
         offset.z !== this.globalOffset.z)
    ) {
        // So far, bbox was in viewer-coords, assuming the default globalOffset. Since we modified the offset,
        // we have to adjust the bbox now.
        if (!this.bbox.isEmpty()) {
            this.bbox.translate({ 
                x: this.globalOffset.x - offset.x, 
                y: this.globalOffset.y - offset.y, 
                z: this.globalOffset.z - offset.z 
            });
        }

        // self.globalOffset may not be an LMVVector3, but in that case
        // offset should be self.GlobalOffset, so this should be OK
        this.verylargebbox = true;
        this.globalOffset.copy(offset);
        calculatePlacementWithOffset(this, this.placementTransform);
    }
}

Package.prototype.parseFragmentList = function(asset, loadContext, path, contents) {

    var self = this;
    this.loadAsyncResource(loadContext, path, contents, function(data) {
        var pfr = new PackFileReader(data);

        //Use a single large blocks to store all fragment elements
        //TODO: perhaps have a FragList per pack file to keep block size down?
        var frags = self.fragments = new FragList();
        var offset = readFragments(pfr, frags, loadContext.globalOffset, loadContext.placementTransform,
            loadContext.fragmentTransformsDouble, undefined, self.bbox, self.globalOffset);
        pfr = null;

        self.applyLargeBoxOffset(offset);
    });
};

Package.prototype.parseGeometryMetadata = function(asset, loadContext, path, contents) {
    var self = this;
    this.loadAsyncResource(loadContext, path, contents, function(data) {
        var pfr = new PackFileReader(data);

        self.geomMetadata = {};
        readGeometryMetadata(pfr, self.geomMetadata);
        self.numGeoms = self.geomMetadata.primCounts.length;
    });
};


Package.prototype.parseInstanceTree = function(loadContext, path, contents, version) {

    var that = this;

    this.loadAsyncResource(loadContext, path, contents, function(data) {
        var pfr = new PackFileReader(data);
        that.instanceTransforms = readInstanceTree(pfr, version);
    });

};


Package.prototype.loadRemainingSvf = function(loadContext) {
    var svf = this;

    var unzip = this.unzip;

    //var filenames = unzip.getFilenames();
    this.manifest = loadContext.manifest;
    var manifest = this.manifest;

    var assets = manifest["assets"];

    var metadataJson = unzip.decompress("metadata.json");
    var jdr = new InputStream(metadataJson);

    // Test to see if this is json (not a binary header)
    // Done by verifying that there is no 0 (Hence ASCII)
    if(metadataJson.byteLength > 3 && metadataJson[3] !== 0) {
        this.metadata = JSON.parse(jdr.getString(metadataJson.byteLength)).metadata;

        initPlacement(this, loadContext);
    }

    //Version strings seem to be variable at the moment.
    //var manifestVersion = manifest["manifestversion"];
    //if (   manifest["name"] != "LMV Manifest"
    //    || manifest["manifestversion"] != 1)
    //    return false;

    this.packFileTotalSize = 0;
    this.primitiveCount = 0;

    var typesetsList = manifest["typesets"];
    var typesets = {};
    for (var i=0; i<typesetsList.length; i++) {
        var ts = typesetsList[i];
        typesets[ts['id']] = ts['types'];
    }

    //Loop through the assets, and schedule non-embedded
    //ones for later loading.
    //TODO: currently only geometry pack files are stored for later
    //load and other assets will be loaded by this worker thread before
    //we return to the SvfLoader in the main thread.

    for (var i=0; i<assets.length; i++)
    {
        var asset = assets[i];
        if (isMobileDevice() && (asset.id === "Set.bin"))
            continue;
        var type = asset["type"];
        if (type.indexOf("Autodesk.CloudPlatform.") == 0)
            type = type.substr(23);
        var uri = asset["URI"];
        var typeset = asset["typeset"] ? typesets[asset["typeset"]] : null;
        var usize = asset["usize"] || 0;
        var megaBytes = (Math.round(usize/1048576*100000)/100000) | 0;

        //If the asset is a geometry pack or property pack
        //just remember it for later demand loading
        if (uri.indexOf("embed:/") != 0) {
            if (type == "PackFile") {
                var typeclass = typeset ? typeset[0]["class"] : null;

                if (typeclass == "Autodesk.CloudPlatform.Geometry") {

                    this.packFileTotalSize += usize;

                    this.geompacks.push({ id: asset["id"], uri: uri, usize: usize });
                }
            }
            else if (type == "PropertyAttributes") {
                this.propertydb.attrs.push({path:uri});
            }
            else if (type == "PropertyAVs") {
                this.propertydb.avs.push({path:uri});
            }
            else if (type == "PropertyIDs") {
                this.propertydb.ids.push({path:uri});
            }
            else if (type == "PropertyOffsets") {
                this.propertydb.offsets.push({path:uri});
            }
            else if (type == "PropertyValues") {
                this.propertydb.values.push({path:uri});
            }
        }

        //parse assets which we will need immediately when
        // setting up the scene (whether embedded or not)
        var path = asset["URI"];
        var contents = null; //if the data was in the zip, this will contain it
        if (path.indexOf("embed:/") == 0) {
            path = path.substr(7);
            contents = unzip.decompress(path);
        }

        if (type == "ProteinMaterials") {
            //For simple materials, we want the file named "Materials.json" and not "ProteinMaterials.json"
            if (path.indexOf("Protein") == -1) {
                this.loadAsyncResource(loadContext, path, contents, function(data) {
                    var jdr = new InputStream(data);
                    var byteLength = data.byteLength;
                    if (0 < byteLength) {
                        svf.materials = JSON.parse(jdr.getString(byteLength));
                    } else {
                        svf.materials = null;
                    }
                });
            } else {
                //Also parse the Protein materials -- at the moment this helps
                //With some Prism materials that have properties we can handle, but
                //are not in the Simple variant.
                this.loadAsyncResource(loadContext, path, contents, function(data) {
                    var jdr = new InputStream(data);
                    var byteLength = data.byteLength;
                    if (0 < byteLength) {
                        try {
                            svf.proteinMaterials = JSON.parse(jdr.getString(byteLength));
                        } catch (e) {
                            //TS: This is dumb, but what can we do... Revit extractor had (has?) a bug where
                            //materials are written as ANSI instead of UTF8 encoded. So we have this fallback attempt
                            var ansi = "";
                            for (var i=0; i<data.length; i++)
                                ansi += String.fromCharCode(data[i]);

                            try {
                                svf.proteinMaterials = JSON.parse(ansi);
                            } catch (e) {
                                console.error("Failed to parse Protein materials file either as UTF8 or ANSI");
                            }
                        }
                    } else {
                        svf.proteinMaterials = null;
                    }
                });
            }
        }
        else if (type == "StandardMaterials") {

            this.loadAsyncResource(loadContext, path, contents, function(data) {
                    var jdr = new InputStream(data);
                    var byteLength = data.byteLength;
                    if (0 < byteLength) {
                        var strContent = jdr.getString(byteLength);
                        svf.stdSurfMats = JSON.parse(strContent);
                    } else {
                        svf.stdSurfMats = null;
                    }
                });
        }

        else if (type == "MaterialX") {
            this.loadAsyncResource(loadContext, path, contents, function(data) {
                    var jdr = new InputStream(data);
                    var byteLength = data.byteLength;
                    if (0 < byteLength) {
                        svf.mtlx = jdr.getString(byteLength);
                    } else {
                        svf.mtlx = null;
                    }
                });
                
        }
        else if (type == "FragmentList") {

            this.parseFragmentList(asset, loadContext, path, contents);

        }
        else if (type == "GeometryMetadataList") {

            this.parseGeometryMetadata(asset, loadContext, path, contents);

        }
        else if (type == "PackFile") {

            if (path.indexOf("CameraDefinitions.bin") != -1) {
                this.loadAsyncResource(loadContext, path, contents, function(data) {
                    svf.camDefPack = new PackFileReader(data);
                });
            }

            else if (path.indexOf("CameraList.bin") != -1) {
                this.loadAsyncResource(loadContext, path, contents, function(data) {
                    svf.camInstPack = new PackFileReader(data);
                });
            }

            else if (path.indexOf("LightDefinitions.bin") != -1) {
                this.loadAsyncResource(loadContext, path, contents, function(data) {
                    svf.lightDefPack = new PackFileReader(data);
                });
            }

            else if (path.indexOf("LightList.bin") != -1) {
                this.loadAsyncResource(loadContext, path, contents, function(data) {
                    svf.lightInstPack = new PackFileReader(data);
                });
            }
        }
        else if (type == "Animations") {
            this.loadAsyncResource(loadContext, path, contents, function(data) {
                var jdr = new InputStream(data);
                var byteLength = data.byteLength;
                if (0 < byteLength) {
                    svf.animations = JSON.parse(jdr.getString(byteLength));
                } else {
                    svf.animations = null;
                }
            });
        }
        else if (type == "Topology") {

            // save the path for later download.
            svf.topologyPath   = loadContext.basePath + path;
            svf.topologySizeMB = megaBytes;

        }
        else if (loadContext.loadInstanceTree &&
                    (type == "InstanceTree" || type == "InstanceTreeTree")) { //Yes, the typo does occur in some older files

            //Instance tree node serialization version is stored in the type set
            var version = typeset ? typeset[0]["version"] : 1;

            this.parseInstanceTree(loadContext, path, contents, version);
        }
    }


    if (this.pendingRequests == 0)
        this.postLoad(loadContext);

    delete this.unzip;
};

Package.prototype.addTransparencyFlagsToMaterials = function(mats) {
    for(var id in mats) {
        var mat = mats[id];
        var userAssets = mat["userassets"];
        var innerMats = mat["materials"];
        var innerMat = innerMats[userAssets[0]];
        mat.transparent = innerMat["transparent"];
    }
};

Package.prototype.postLoadOfCam = function(loadContext) {

    //Combine camera instances and camera definitions -- we need
    //both to be loaded to get the camera list
    if (this.camDefPack && this.camInstPack) {
        const tmpCenter = new LmvVector3();
        for (var k = 0, kEnd = this.camInstPack.getEntryCounts(); k < kEnd; k++) {
            var inst = readInstance(this.camInstPack, k, this.placementTransform, this.globalOffset);
            var cam = readCameraDefinition(this.camDefPack, inst);

            //Apply any instance transform to get the camera to world space.
            transformCameraData(cam, inst.transform);

            // Fix camera's target if it is not inside the scene's bounding box.
            var bbox = this.bbox;
            if (bbox && !bbox.containsPoint(cam.target)) {
                var distanceFromCenter = bbox.getCenter(tmpCenter).distanceTo(cam.position);
                var direction = new LmvVector3().copy(cam.target).sub(cam.position).normalize().multiplyScalar(distanceFromCenter); 
                cam.target = new LmvVector3().copy(cam.position).add(direction); 
            }

            this.cameras.push(cam);
        }

        delete this.camDefPack;
        delete this.camInstPack;
    }

};

Package.prototype.postLoadOfLight = function(loadContext) {

    //Lights need the same thing as the cameras
    if (this.lightDefPack && this.lightInstPack) {
        for (var k = 0, kEnd = this.lightInstPack.getEntryCounts(); k < kEnd; k++) {
            var inst = readInstance(this.lightInstPack, k, this.placementTransform, this.globalOffset);
            this.lights.push(readLightDefinition(this.lightDefPack, inst.definition));
        }

        delete this.lightInstPack;
        delete this.lightDefPack;
    }

};

Package.prototype.postLoadOfFragments = function(loadContext) {

    //Post processing step -- splice geometry metadata information
    //into the fragments list, in case it was given separately
    //TODO: consider keeping the geom metadata as is instead of splicing
    //into the fragments, as it would be more efficient --
    //but that would require special handling on the viewer side,
    //changing the fragment filter code, etc.
    var frags = this.fragments;

    if (this.geomMetadata) {

        //reusing the geomDataIndexes array to store
        //polygon counts, now that we don't need the geomIndexes
        //after this loop.
        frags.polygonCounts = frags.geomDataIndexes;

        var gm = this.geomMetadata;

        // Holds the indexes to the topology data.
        if (gm.topoIndexes != undefined) {
            frags.topoIndexes = new Int32Array(frags.length);
        }

        for (var i= 0, iEnd=frags.length; i<iEnd; i++) {
            var geomIndex = frags.geomDataIndexes[i];
            frags.entityIndexes[i] = gm.entityIndexes[geomIndex];
            frags.packIds[i] = gm.packIds[geomIndex];

            frags.polygonCounts[i] = gm.primCounts[geomIndex];
            this.primitiveCount += gm.primCounts[geomIndex];

            // Fills in the indexes to the topology data.
            if (gm.topoIndexes != undefined) {
                frags.topoIndexes[i] = gm.topoIndexes[geomIndex];
            }
        }

        frags.geomDataIndexes = null;

        this.geomMetadata = null;
    }

    //Build a map from mesh to its referencing fragment(s)
    //So that we can quickly find them once meshes begin loading
    //incrementally. This requires the packIds and entityIndexes
    //to be known per fragment, so it happens after geometry metadata
    //is resolved above
    this.calculateMesh2Frag(frags);
};

Package.prototype.calculateMesh2Frag = function(frags) {
    var mesh2frag = frags.mesh2frag = {};
    var packIds = frags.packIds;
    var entityIndexes = frags.entityIndexes;

    for (var i= 0, iEnd=frags.length; i<iEnd; i++) {
        var meshid = packIds[i] + ":" + entityIndexes[i];

        var meshRefs = mesh2frag[meshid];
        if (meshRefs === undefined) {
            //If it's the first fragments for this mesh,
            //store the index directly -- most common case.
            mesh2frag[meshid] = i;
        }
        else if (!Array.isArray(meshRefs)) {
            //otherwise put the fragments that
            //reference the mesh into an array
            mesh2frag[meshid] = [meshRefs, i];
        }
        else {
            //already is an array
            meshRefs.push(i);
        }
    }
}

Package.prototype.postLoadOfBBox = function(loadContext) {

    //if we don't know the overall scene bounds, compute them from the
    //fragment boxes
    if (!this.bbox || loadContext.placementTransform) {

        var totalbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        var frags = this.fragments;
        var fragBoxes = frags.boxes;

        for (var f= 0, fEnd=frags.length; f<fEnd; f++) {
            var bboff = f*6;
            var i;
            for (i=0; i<3; i++)
                if (fragBoxes[bboff+i] < totalbox[i])
                    totalbox[i] = fragBoxes[bboff+i];

            for (i=3; i<6; i++)
                if (fragBoxes[bboff+i] > totalbox[i])
                    totalbox[i] = fragBoxes[bboff+i];
        }

        this.bbox = {
                        min: { x:totalbox[0], y:totalbox[1], z:totalbox[2]},
                        max: { x:totalbox[3], y:totalbox[4], z:totalbox[5]}
                     };
    }


};

Package.prototype.postLoadOfObjectIds = function(loadContext) {

    // If object ids are specified, clean up pack file list by only keeping the packs that's
    // we intended to load.
    let ids = new Set(loadContext.objectIds);
    if (ids.size > 0) {
        let packIds = new Set();
        let fragIds = new Set();
        // Pick out pack ids that referenced by fragments with specified db ids.

        for (let j = 0; j < this.fragments.length; ++j) {
            if (ids.has(this.fragments.fragId2dbId[j])) {
                packIds.add(this.fragments.packIds[j]);
                fragIds.add(j);
            }
        }

        // Reduce pack files based on selected pack ids.
        let packs = new Set();
        for (let i = 0; i < this.geompacks.length; ++i) {
            // LMVTK pre-2.0 release uses integers for pack file id.
            // LMVTK 2.0 release uses integer + .pf as id.
            // We just drop the suffix here as we did in SVFLoader.
            // More info: https://git.autodesk.com/A360/LMVTK/commit/68b8c07a643a7ac39ecd5651d031d170e3a325be
            if (packIds.has(parseInt(this.geompacks[i].id))) {
                packs.add(this.geompacks[i]);
            }
        }
        this.geompacks = [...packs];

        let bb = filterFragments(this.fragments, [...fragIds]);
        this.bbox = {
                        min: { x:bb[0], y:bb[1], z:bb[2] },
                        max: { x:bb[3], y:bb[4], z:bb[5]}
                    };
    }

};

Package.prototype.postLoadComplete = function(loadContext) {

    loadContext.loadDoneCB("svf");

    if (this.fragments.polygonCounts) {
        //Build the R-Tree
        var t0 = performance.now();
        var mats = this.materials ? this.materials["materials"] : null;
        if (mats)
            this.addTransparencyFlagsToMaterials(mats);
        this.bvh = new BVHBuilder(this.fragments, mats);
        this.bvh.build(loadContext.bvhOptions);
        var t1 = performance.now();
        loadContext.worker.debug("BVH build time (worker thread):" + (t1 - t0));

        // In normal mode, just post back BVH as svf is already posted back earlier.
        loadContext.loadDoneCB("bvh");
    }

    loadContext.loadDoneCB("done");
};

Package.prototype.postLoad = function(loadContext) {

    transformAnimations(this);

    this.postLoadOfCam(loadContext);

    this.postLoadOfLight(loadContext);

    this.postLoadOfFragments(loadContext);

    this.postLoadOfBBox(loadContext);

    this.postLoadOfObjectIds(loadContext);

    this.postLoadComplete(loadContext);
};
