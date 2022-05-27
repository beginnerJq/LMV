import { LmvBox3 } from '../../../wgs/scene/LmvBox3';
import { LmvMatrix4 } from '../../../wgs/scene/LmvMatrix4';
import { LmvVector3 } from '../../../wgs/scene/LmvVector3';
import { isMobileDevice } from '../../../compat';
import { MeshFlags } from '../../../wgs/scene/MeshFlags';

//FragList represents an array of fragments, stored in Structure of Arrays form
//which allows us to free some parts easily and transfer the fragment information in large chunks.
var NUM_FRAGMENT_LIMITS = (isMobileDevice()) ? null : null;
var MAX_BBOX_RATIO = 100;

/** @constructor */
// note: update transferable var list in SvfWorker.ts if you add a new field
export function FragList() {
    this.length = 0;
    this.numLoaded = 0;

    this.boxes = null;
    this.transforms = null;
    this.materials = null;

    this.packIds = null;
    this.entityIndexes = null;

    this.fragId2dbId = null;

    this.topoIndexes = null;

    this.visibilityFlags = null;
}

export function readGeometryMetadataIntoFragments(pfr, fragments) {
    var length = fragments.geomDataIndexes.length;
    var stream = pfr.stream;
    var primsCount = 0;

    // Read from cache if the same entry has been reading from stream.
    var entryCache = {};
    var mesh2frag = fragments.mesh2frag = {};
    fragments.polygonCounts = fragments.geomDataIndexes;
    for (var g = 0; g < length; g++) {
        var entry = fragments.geomDataIndexes[g];

        if (entryCache[entry]) {
            var i = entryCache[entry];
            fragments.polygonCounts[g] = fragments.polygonCounts[i];
            fragments.packIds[g] = fragments.packIds[i];
            fragments.entityIndexes[g] = fragments.entityIndexes[i];
            primsCount += fragments.polygonCounts[g];
        }
        else {
            var tse = pfr.seekToEntry(entry);
            if (!tse)
                return;

            // Frag type, seems no use any more.
            stream.getUint8();
            //skip past object space bbox -- we don't use that
            stream.seek(stream.offset + 24);

            fragments.polygonCounts[g] = stream.getUint16();
            fragments.packIds[g] = parseInt(pfr.readString());
            fragments.entityIndexes[g] = pfr.readU32V();
            primsCount += fragments.polygonCounts[g];

            entryCache[entry] = g;
        }
        
        // Construct mesh2frag here directly
        var meshid = fragments.packIds[g] + ":" + fragments.entityIndexes[g];
        var meshRefs = mesh2frag[meshid];
        if (meshRefs === undefined) {
            //If it's the first fragments for this mesh,
            //store the index directly -- most common case.
            mesh2frag[meshid] = g;
        }
        else if (!Array.isArray(meshRefs)) {
            //otherwise put the fragments that
            //reference the mesh into an array
            mesh2frag[meshid] = [meshRefs, g];
        }
        else {
            //already is an array
            meshRefs.push(g);
        }

    }
    fragments.geomDataIndexes = null;
    entryCache = null;

    return primsCount;
}

export function readGeometryMetadata(pfr, geoms)
{
    var numGeoms = pfr.getEntryCounts();
    var stream = pfr.stream;

    geoms.length = numGeoms;
    var fragTypes = geoms.fragTypes = new Uint8Array(numGeoms);
    var primCounts = geoms.primCounts = new Uint16Array(numGeoms);
    var packIds = geoms.packIds = new Int32Array(numGeoms);
    var entityIndexes = geoms.entityIndexes = new Int32Array(numGeoms);
    // Holds the indexes to the topology data.
    var topoIndexes;

    for (var g = 0, gEnd = numGeoms; g<gEnd; g++) {
        var tse = pfr.seekToEntry(g);
        if (!tse)
            return;

        fragTypes[g] = stream.getUint8();
        //skip past object space bbox -- we don't use that
        stream.seek(stream.offset + 24);
        primCounts[g] = stream.getUint16();
        packIds[g] = parseInt(pfr.readString());
        entityIndexes[g] = pfr.readU32V();

        if (tse.version > 2) {
            var topoIndex = stream.getInt32();
            if (topoIndex != -1 && topoIndexes === undefined) {
                 topoIndexes = geoms.topoIndexes = new Int32Array(numGeoms);
                 // Fill in the first entries to indicate
                 for(var i = 0; i < g; i++)
                     topoIndexes[i] = -1;
            }

            if (topoIndexes != undefined)
                 topoIndexes[g] = topoIndex;
        }

    }
}

// Convert a list of object id (dbid) to a list of integers where each integer is an index of the fragment
// in fragment list that associated with the object id.
function objectIds2FragmentIndices(pfr, ids) {
    var ret = [];

    if (!ids) {
        return ret;
    }

    var counts = pfr.getEntryCounts();
    var stream = pfr.stream;
    for (var entry = 0; entry < counts; entry++) {
        var tse = pfr.seekToEntry(entry);
        if (!tse)
            return;
        if (tse.version > 5)
            return;

        // Keep reading fragment fields as usual, but does not store anything as we only
        // interested in the data base id / object id field at the very end.
        if ( tse.version > 4 ) {
            // Flag byte.
            pfr.readU8();
        }
        // Material index
        pfr.readU32V();
        if (tse.version > 2) {
            // Geometry metadata reference
            pfr.readU32V();
        } else {
            // Pack file reference
            pfr.readString();
            pfr.readU32V();
        }

        // Transform
        pfr.readTransform(entry, null, 12 * entry);

        // Bounding box
        for (var i = 0; i < 6; i++) {
            stream.getFloat32();
        }

        if (tse.version > 1) {
            var dbid = pfr.readU32V();
            if (ids.indexOf(dbid) >= 0) {
                ret.push(entry);
            }
        }
    }

    return ret;
}

var _tmpVector = new LmvVector3();

// globalOffset:        GlobalOffset as specified by loadOptions (may be undefined)
// defaultGlobalOffset: GlobalOffset as initially chosen by SvfPlacementUtil.initPlacement
export function readFragments(pfr, frags, globalOffset, placementTransform, fragmentTransformsDouble, ids, bbox, defaultGlobalOffset) {
    var filteredIndices = objectIds2FragmentIndices(pfr, ids);

    //Initialize all the fragments structures
    //once we know how many fragments we have.
    var numFrags = filteredIndices.length ? filteredIndices.length : pfr.getEntryCounts();
    var stream = pfr.stream;

    if (NUM_FRAGMENT_LIMITS && numFrags > NUM_FRAGMENT_LIMITS) {
        numFrags = NUM_FRAGMENT_LIMITS;
    }

    // Recored the total length of the fragments
    frags.totalLength = pfr.getEntryCounts();
    frags.length = numFrags;
    frags.numLoaded = 0;

    //Allocate flat array per fragment property
    var fragBoxes       = frags.boxes =                 fragmentTransformsDouble ? new Float64Array(6*numFrags) : new Float32Array(6*numFrags);
    var transforms      = frags.transforms =            fragmentTransformsDouble ? new Float64Array(12*numFrags): new Float32Array(12*numFrags);
    var materials       = frags.materials =             new Int32Array(numFrags);
    var packIds         = frags.packIds =               new Int32Array(numFrags);
    var entityIndexes   = frags.entityIndexes =         new Int32Array(numFrags);
    var geomDataIndexes = frags.geomDataIndexes =       new Int32Array(numFrags);
    var fragId2dbId     = frags.fragId2dbId =           new Int32Array(numFrags); //NOTE: this potentially truncates IDs bigger than 4 billion -- can be converted to array if needed.
    var visibilityFlags = frags.visibilityFlags =       new Uint16Array(numFrags);

    var tmpBox;
    var tmpMat;
    var boxTranslation = [0,0,0];
    if (placementTransform) {
        tmpBox = new LmvBox3();
        tmpMat = new LmvMatrix4(true).fromArray(placementTransform.elements);
    }

    var calculateOffset = !globalOffset && bbox;
    var dpTranslations = transforms;
    // Normally the translations component of transforms is 12 entries for each
    // transform and then offset by 9 in the transform.
    var translationSize = 12;
    var translationOff = 9;
    if (calculateOffset) {
        // A global offset wasn't specified in the load context, so we will calculate one
        // here. We normally use the center of the bbox, but if the bbox is signficantly
        // larger than the objects in the model, then we make the global offset the
        // average of the centers of the fragment bounding boxes, which will push
        // offset toward places where there are more fragments.
        if (!fragmentTransformsDouble) {
            // We need to keep bboxes and transform translations in double precision
            // to guarantee precision in large bbox cases
            fragBoxes = new Float64Array(6*numFrags);
            dpTranslations = new Float64Array(3*numFrags);
            // In this case the translations are 3 entries offset by 0
            translationSize = 3;
            translationOff = 0;
        }
    }

    //Helper functions used by the main fragment read loop.

    function applyPlacement(index) {
        if (placementTransform) {
            var offset = index * 6;
            tmpBox.setFromArray(fragBoxes, offset);
            tmpBox.applyMatrix4(tmpMat);
            tmpBox.copyToArray(fragBoxes, offset);
        }
    }

    function readBoundingBox(entry) {
        var offset = entry * 6;
        for (var i=0; i<6; i++)
            fragBoxes[offset++] = stream.getFloat32();
    }

    function readBoundingBoxOffset(entry, boxTranslation) {
        var offset = entry * 6;
        for (var i=0; i<6; i++)
            fragBoxes[offset++] = stream.getFloat32() + boxTranslation[i % 3];
    }

    //Spin through all the fragments now
    for (var entry=0, eEnd=frags.length; entry<eEnd; entry++) {
        var tse = filteredIndices.length ? pfr.seekToEntry(filteredIndices[entry]) : pfr.seekToEntry(entry);

        if (!tse)
            return;
        if (tse.version > 5)
            return;

        var isVisible = true;
        if ( tse.version > 4 ) {
            // Fragments v5+ include a flag byte, the LSB of which denotes
            // visibility
            var flags = pfr.readU8();
            isVisible = (flags & 0x01) != 0;
        }
        visibilityFlags[entry] = isVisible ? MeshFlags.MESH_VISIBLE : 0;

        materials[entry] = pfr.readU32V();

        if (tse.version > 2) {
            //In case it's new style fragment that
            //points to a geometry metadata entry
            geomDataIndexes[entry] = pfr.readU32V();
        }
        else {
            //Old style fragment, pack reference is directly
            //encoded in the fragment entry
            packIds[entry] = parseInt(pfr.readString());
            entityIndexes[entry] = pfr.readU32V();
        }

        pfr.readTransform(entry, transforms, 12*entry, placementTransform, globalOffset, boxTranslation);
        if (calculateOffset && dpTranslations !== transforms) {
            dpTranslations.set(boxTranslation, entry * translationSize + translationOff);
        }

        if (tse.version > 3) {
            // With this version the transform's (double precision) translation is subtracted from the BB,
            // so we have to add it back
            readBoundingBoxOffset(entry, boxTranslation);
        }
        else {
            readBoundingBox(entry);
        }

        //Apply the placement transform to the world space bbox
        applyPlacement(entry);

        //Apply any global offset to the world space bbox
        if (globalOffset) {
            var offset = entry * 6;
            fragBoxes[offset++] -= globalOffset.x;
            fragBoxes[offset++] -= globalOffset.y;
            fragBoxes[offset++] -= globalOffset.z;
            fragBoxes[offset++] -= globalOffset.x;
            fragBoxes[offset++] -= globalOffset.y;
            fragBoxes[offset++] -= globalOffset.z;
        }

        if (tse.version > 1) {
            fragId2dbId[entry] = pfr.readU32V();
        }
        // Skip reading path ID which is not in use now.
        // pfr.readPathID();
    }

    if (calculateOffset) {
        // We compare the size of the bbox against the size of the largest
        // max size of the bounding boxes in the model to see decide
        // what to use as the globalOffset.

        // First calculate the max of object box sizes
        var maxX = -1, maxY = -1, maxZ = -1;
        var boxEnd = fragBoxes.length;
        // Effectively this calculates the average of the centers of the fragment bboxes
        for (var i = 0; i < boxEnd; i += 6) {
            maxX = Math.max(maxX, fragBoxes[i + 3] - fragBoxes[i]);
            maxY = Math.max(maxY, fragBoxes[i + 4] - fragBoxes[i + 1]);
            maxZ = Math.max(maxZ, fragBoxes[i + 5] - fragBoxes[i + 2]);
        }

        var size = bbox.getSize(_tmpVector);
        if (size.x > maxX * MAX_BBOX_RATIO || size.y > maxY * MAX_BBOX_RATIO || size.z > maxZ * MAX_BBOX_RATIO) {
            // Now calculate the weighted offset. The weighted globalOffset is
            // weighted to be close to places with more fragments.
            var offsetX = 0, offsetY = 0, offsetZ = 0;
            // Effectively this calculates the average of the centers of the fragment bboxes
            for (var i = 0; i < boxEnd; i += 3) {
                offsetX += fragBoxes[i];
                offsetY += fragBoxes[i + 1];
                offsetZ += fragBoxes[i + 2];
            }
            globalOffset = new LmvVector3(offsetX * 3 / boxEnd, offsetY * 3 / boxEnd, offsetZ * 3 / boxEnd);
        } else {
            globalOffset = defaultGlobalOffset;
        }

        // Need to addjust the bounding boxes, using the globalOffset
        var outBoxes = frags.boxes;
        for (i = 0; i < boxEnd; i += 3) {
            outBoxes[i] = fragBoxes[i] - globalOffset.x;
            outBoxes[i + 1] = fragBoxes[i + 1] - globalOffset.y;
            outBoxes[i + 2] = fragBoxes[i + 2] - globalOffset.z;
        }

        if (placementTransform && dpTranslations !== transforms) {
            var tmpVec = new LmvVector3();
            // And adjust the transforms, too
            for (entry = 0; entry < eEnd; ++entry) {
                const from = entry * translationSize + translationOff;
                tmpVec.fromArray(dpTranslations, from).applyMatrix4(tmpMat).toArray(dpTranslations, from);
            }
        }

        // And adjust the transforms, too
        for (entry = 0; entry < eEnd; ++entry) {
            var to = entry * 12 + 9;
            var from = entry * translationSize + translationOff;
            transforms[to] = dpTranslations[from] - globalOffset.x;
            transforms[to + 1] = dpTranslations[from + 1] - globalOffset.y;
            transforms[to + 2] = dpTranslations[from + 2] - globalOffset.z;
        }
    }

    frags.finishLoading = true;

    return globalOffset;
}

// Filter fragments based on specified object id list, by picking
// up fragment whose id is in the specified id list, and dropping others.
// This is used to produce a list of fragments that matches a search hit.
export function filterFragments(frags, ids) {
    frags.length = ids.length;
    frags.numLoaded = 0;
    let numFrags = frags.length;
    let bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

    let fragBoxes       = new Float32Array(6 * numFrags);
    let transforms      = new Float32Array(12 * numFrags);
    let materials       = new Int32Array(numFrags);
    let packIds         = new Int32Array(numFrags);
    let entityIndexes   = new Int32Array(numFrags);
    let visibilityFlags = new Uint16Array(numFrags);
    let fragId2DbId     = new Int32Array(numFrags);
    let polygonCounts   = new Int32Array(numFrags);
    let geomDataIndexes = frags.geomDataIndexes ? new Int32Array(numFrags) : null;
    let topoIndexes     = frags.topoIndexes ? new Int32Array(numFrags) : null;

    var mesh2frag = {};

    for (let i = 0; i < ids.length; ++i) {
        let index = ids[i];

        let idxOld = index * 6;
        let idxNew = i * 6;
        for (let j = 0; j < 6; ++j)
            fragBoxes[idxNew++] = frags.boxes[idxOld++];

        idxOld = index * 12;
        idxNew = i * 12;
        for (let j = 0; j < 12; ++j)
            transforms[idxNew++] = frags.transforms[idxOld++];

        materials[i] = frags.materials[index];
        packIds[i] = frags.packIds[index];
        entityIndexes[i] = frags.entityIndexes[index];
        visibilityFlags[i] = frags.visibilityFlags[index];
        fragId2DbId[i] = frags.fragId2dbId[index];
        polygonCounts[i] = frags.polygonCounts[index];
        if (geomDataIndexes) {
            geomDataIndexes[i] = frags.geomDataIndexes[index];
        }
        if (topoIndexes) {
            topoIndexes[i] = frags.topoIndexes[index];
        }

        // TODO: consolidate this with addToMeshMap.
        let meshID = frags.packIds[index] + ":" + frags.entityIndexes[index];
        let meshRefs = mesh2frag[meshID];
        if (meshRefs == undefined) {
            mesh2frag[meshID] = i;
        }
        else if (!Array.isArray(meshRefs)) {
            mesh2frag[meshID] = [meshRefs, i];
        }
        else {
            meshRefs.push(i);
        }

        let bbIndex = i * 6;
        for (let j = 0; j < 3; ++j)
            if (fragBoxes[bbIndex + j] < bb[j])
                bb[j] = fragBoxes[bbIndex + j];
        for (let j = 3; j < 6; ++j)
            if (fragBoxes[bbIndex + j] > bb[j])
                bb[j] = fragBoxes[bbIndex + j];
    }

    frags.boxes = fragBoxes;
    frags.transforms = transforms;
    frags.materials = materials;
    frags.packIds = packIds;
    frags.entityIndexes = entityIndexes;
    frags.mesh2frag = mesh2frag;
    frags.visibilityFlags = visibilityFlags;
    frags.fragId2dbId = fragId2DbId;
    frags.polygonCounts = polygonCounts;
    frags.geomDataIndexes = geomDataIndexes;
    frags.topoIndexes = topoIndexes;

    frags.totalLength = numFrags;

    return bb;
}
