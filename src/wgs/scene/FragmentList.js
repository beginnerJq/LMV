import { memoryOptimizedLoading } from '../globals';
import * as THREE from "three";
import { MeshFlags } from "./MeshFlags";
import { logger } from "../../logger/Logger";
import { allocateUintArray, reallocateUintArrayMaybe } from "./IntArray";
import { VertexBufferReader } from './VertexBufferReader';
import { VertexBufferWriter } from './VertexBufferWriter';


    var _tmpMatrix = new THREE.Matrix4();
    var _tmpBox = new THREE.Box3();
    var _tmpRot = new THREE.Quaternion();
    var _tmpPos = new THREE.Vector3();
    var _tmpScale = new THREE.Vector3();

    /**
     * Represents the full list of all geometry instances associated with
     * a particular model. The order in the list is 1:1 with fragment list
     * in the source LMV/SVF package file.
     * @param {Object} fragments - Fragment data parsed from an SVF file.
     * @param {GeometryList} geoms - Geometry data parsed from an SVF file.
     * @constructor
     */
    export function FragmentList(model) {

        this.is2d = model.is2d();
        this.modelId = model.getModelId();
        this.fragments  = model.getData().fragments;
        this.geoms      = model.getGeometryList();

        //3D SVF files are of known initial size and known world bounds.
        //2D F2D files start out with nothing and get filled up as we load.
        //NOTE: There is a bug here when we have an SVF file with known zero fragments -- it will
        //go into the slower non-fixed size code path. But it doesn't matter, because it's an empty file.
        this.isFixedSize = this.fragments.length > 0;
        if (this.isFixedSize) {
            this.boxes        = this.fragments.boxes;       // Float32Array, stores Boxes as 6 floats per fragment (after applying mesh matrix)
            this.transforms   = this.fragments.transforms;  // Float32Array, stores transforms as 12 floats per fragment (Matrix4 with omitted last row)
            this.useThreeMesh = !memoryOptimizedLoading;
        } else {
            this.boxes        = null;
            this.transforms   = null;
            this.useThreeMesh = true; //This code path will be used for 2D drawings, which stream in with unknown number of meshes
        }

        // initial length for arrays of meshes/geometries/flags
        // Can be zero.
        var initialSize = this.fragments.length;

        this.vizflags  = new Uint16Array(initialSize); // visibility/highlight mode flags

        //This will be the list of all mesh instances in the model.
        //Corresponds to all fragments in the case of SVF.
        if (this.useThreeMesh)
            this.vizmeshes = new Array(initialSize);

        if (model.isOTG()) {
            var stats = model.getData().metadata.stats;
            var nm = stats.num_materials;
            var ng = stats.num_geoms;

            this.materialids = allocateUintArray(initialSize, nm);
            this.geomids = allocateUintArray(initialSize, ng);
        } else {
            this.geomids     = new Int32Array(initialSize); // geomid per fragId. geomids are resolved by this.geoms.GetGeometry(geomid) to obtain BufferGeometry.
            this.materialids = new Int32Array(initialSize); // material per fragId. matIds  are resolved by this.materialmap[matId]
        }
        this.materialmap = {};                          // map from material ids to THREE.ShaderMaterial instances
        this.materialIdMap = {};
        this.nextMaterialId = 1;

        // theming (coloring based on id)
        this.db2ThemingColor = []; // empty if no theming is applied. A theming color db2ThemingColor[dbId] is stored as THREE.Vector4 with values in [0,1].
        this.originalColors  = []; // if vizmesh[i] has modified vertex-colors  due to theming,  originalColors[i]  stores a copy of the original colors.
        this.themingOrGhostingNeedsUpdate = {}; // indicates if vertex-colors of vizmesh[i] needs to be updated based on recent theming or ghosting changes (index by fragId)
        this.themingOrGhostingNeedsUpdateByDbId = {}; // Same as above, but indexed by dbId (for the case where the fragId doesn't exist and might be available later)
        this.dbIdOpacity    = []; // ids with overridden opacity, or hidden by setting alpha to 0

        // ghosting for 2d objects: A ghosted object is reduced in transparency and blended with the pageColor.
        this.dbIdIsGhosted   = [];

        this.animxforms = null; // If animation is used, this is a Float32Array storing 10 floats per fragment to describe scale (3), rotation (4), and translation (3).
                                // See this.updateAnimTransform.

        for (var i = 0; i < initialSize; i++) {
            this.vizflags[i] = 1; //MESH_VISIBLE initially
        }

        // Set the visflags from the fragment visibility, if there is any.
        // For OTG, the flags are not fully loaded at this point. Otg flags are handled in setMesh().
        if (!model.isOTG() && this.fragments.visibilityFlags) {
            this.vizflags.set(this.fragments.visibilityFlags);
        }

        this.allVisible          = true;        // see this.areAllVisible(..). Indicates if MESH_VISIBLE flag is set for all meshes (i.e., not considering culling)
        this.allVisibleDirty     = true;        // if true, this.allVisible is outdated and must be recomputed in this.areAllVisible.
        this.nextAvailableFragID = initialSize;

        // Visibility of lines and points is independent of per-fragment visibility flags
        this.linesHidden  = false;
        this.pointsHidden = false;

        // Optional: Additional transform applied to the whole model 
        this.matrix = null;

        // Optional bounds that limit the fragment's visibility (used for viewport bounds in 2D models)
        this.viewBounds = null;

        // TODO: comment out; for debug
        //this.geomCount = 0;
        //this.geomMax = 100;
    }

    // [HB:] This method is only used in RenderModel.setFragment(), which seems to be not called at all. Can we remove this?
    //       (including the nextAvailableFragID member and RenderModel.setFragment).
    FragmentList.prototype.getNextAvailableFragmentId = function () {
        return this.nextAvailableFragID++;
    };

    // [HB:] When does this method ever return true? vizflags is resized in SetMesh, which only used in RenderModel.activateFragment and 
    //       RenderModel.setFragment (never called). RenderModel.activateFragment(..) is only used by loaders when new fragments have been loaded.
    //       However, for SvfLoader, fragments.length is always the full fragments count and for F2D, new stuff is first added to fragments, then
    //       to VisFlags. 
    //       Maybe this should actually be a "<" and is only relevant for F2D case?
    FragmentList.prototype.fragmentsHaveBeenAdded = function() {
        return this.vizflags.length > this.fragments.length;
    };

    // Returns undefined if fragId has no material 
    FragmentList.prototype.getSvfMaterialId = function (fragId) {
        var mat = this.getMaterial(fragId);
        return mat ? mat.svfMatId : undefined;
    };

    /**
     * Set mesh for a fragment, replacing any temporary previous one.
     * @param {number} fragId - Fragment ID
     * @param {Object} meshinfo - Object as defined in Viewer3DImpl.setupMesh(..). Contains:
     *      geometry: instanceof BufferGeometry
     *      material: instance of THREE.Material
     *      matrix:   instanceof THREE.Matrix4
     *      bbox:     Optional world space bounding box
     *      isLine:   bool to mark line geometry
     *      isWideLine: bool to mark wide line geometry
     *      isPoint:   bool to mark point geometry
     *      is2D:     bool to indicate 2D geometry (e.g., set by F2DLoader) 
     * @param {bool} updateFragmentData - If true, this.bbox and this.transforms is also updated for this fragment.
     *      Only allowed if this.isFixedSize==true. (otherwise, this.boxes and this.transforms is null)
     * @param {bool} [retainMesh] - If true, meshInfo is a THREE.Mesh and this.useThreeMesh, then
     *      meshInfo will be used as the THREE.Mesh for the fragment.
     */
    FragmentList.prototype.setMesh = function (fragId, meshInfo, updateFragmentData, retainMesh) {

        //Remove any temporary geometry we used for the fragment
        //while it was loading
        if (this.vizmeshes) {
            var oldGeom = this.vizmeshes[fragId];
            if (oldGeom && oldGeom.parent) {
                oldGeom.parent.remove(oldGeom);
            }
        }

        //The various data arrays need to be re-sized if the fragment is new
        //so we have to do it manually in case this happens. 
        if (this.vizflags.length <= fragId) {

            // Gradually should only used if isFixedSize is false (as used for F2D geometry)
            if (this.isFixedSize) {
                logger.warn("Attempting to resize a fragments list that was initialized with fixed data. This will have a performance impact.");
                this.isFixedSize = false;
            }

            // determine new length of all per-fragmentId arrays
            var nlen = Math.ceil(1.5 * Math.max(this.vizflags.length, fragId)) || 1;
            if (this.useThreeMesh && nlen < this.vizmeshes.length)
                nlen = this.vizmeshes.length;

            // re-allocate vizflags
            var nflags = new Uint16Array(nlen);
            nflags.set(this.vizflags);
            this.vizflags = nflags;

            // re-allocate other per-fragmentId arrays...

            if (this.transforms) {
                var ntransforms = new Float32Array(nlen * 12);
                ntransforms.set(this.transforms);
                this.transforms = ntransforms;
            }

            if (this.boxes) {
                var nboxes = new Float32Array(nlen * 6);
                nboxes.set(this.boxes);
                this.boxes = nboxes;
            }

            if (this.geomids) {
                var nids = new Int32Array(nlen);
                nids.set(this.geomids);
                this.geomids = nids;

            }

            if (this.materialids) {
                var nmids = new Int32Array(nlen);
                nmids.set(this.materialids);
                this.materialids = nmids;
            }
        }

        //Remember the mesh in the frag->viz mesh array
        if (this.useThreeMesh) {
            var mesh;
            if (retainMesh && meshInfo instanceof THREE.Mesh) {
                mesh = meshInfo;

                if (meshInfo.matrix) {
                    mesh.matrixWorld.copy(meshInfo.matrix);
                }

                mesh.dbId = mesh.dbId || 0;
            } else {
                mesh = new THREE.Mesh(meshInfo.geometry, meshInfo.material);


                // Copy matrix to mesh.matrix and mesh.matrixWorld
                // [HB:] Why copying twice?
                if (meshInfo.matrix) {
                    if (mesh.matrix) {
                        mesh.matrix.copy(meshInfo.matrix);
                    }
                    mesh.matrixWorld.copy(meshInfo.matrix);
                }

                mesh.is2d   = meshInfo.is2d;
                mesh.isLine = meshInfo.isLine;
                mesh.isWideLine = meshInfo.isWideLine;
                mesh.isPoint = meshInfo.isPoint;

                mesh.dbId   = this.fragments.fragId2dbId[fragId] | 0;
            }

            // If we would leave that true, THREE.js would call UpdateMatrix() for this mesh and 
            // overwrite the matrix with another one computed by position, scale, and quaternion.
            mesh.matrixAutoUpdate = false;

            //Add the mesh to the render group for this fragment
            //Note each render group renders potentially many fragments.
            mesh.frustumCulled = false; //we do our own culling in RenderQueue, the renderer doesn't need to

            // keep fragId and dbId
            mesh.fragId = fragId;
            mesh.modelId = this.modelId;

            // If a model matrix already exists, update matrixWorld (like it's done in setModelMatrix)
            // It's possible that the matrix was set before all vizmeshes were set.
            if (this.matrix) {
                mesh.matrixWorld.multiplyMatrices(this.matrix, mesh.matrix);
            }

            // cache the mesh in this.vizmeshes
            this.vizmeshes[fragId] = mesh;
        } else {
            // When not using THREE.Mesh, store ids of BufferGeometry and material instead

            // Handle shared Otg geoms: If the geometry contains a hash, it is a shareable Otg geometry. For these,
            // we cannot use svfid, because the geomId may vary per model.
            //  => For this case, the geomId must be provided separately by the meshInfo
            var geomId = undefined;
            if (meshInfo.geometry.hash) {
                // shared otg geom
                if (meshInfo.geomId === undefined) {
                    console.error("meshInfo must provide geomId");
                }
                geomId = meshInfo.geomId;
            } else {
                // svf geom
                geomId = meshInfo.geometry.svfid;
            }

            this.geomids[fragId]     = geomId;

            this.setMaterial(fragId, meshInfo.material);
        }

        // Don't override the visibility flag which could be set before geometry is ready.
        // This can improve the performance when streaming geometry and rendering happen together.
        var typeFlags = 0;
        if (meshInfo.isLine) typeFlags = MeshFlags.MESH_ISLINE;
        else if (meshInfo.isWideLine) typeFlags = MeshFlags.MESH_ISWIDELINE;
        else if (meshInfo.isPoint) typeFlags = MeshFlags.MESH_ISPOINT;
        if (!this.isFixedSize) {
            this.vizflags[fragId] |= MeshFlags.MESH_VISIBLE | typeFlags;
        }
        else {
            this.vizflags[fragId] |= typeFlags;
        }

        if (updateFragmentData && this.transforms && this.boxes) {
            // Update transform and bb
            var transform = meshInfo.matrix;

            // Copy the transform to the fraglist array
            // We store in column-major order like the elements of the Matrix4, but skip row 3.
            var i    = fragId * 12;
            var cur  = transform.elements;
            var orig = this.transforms;
            orig[i]      = cur[0];
            orig[i + 1]  = cur[1];
            orig[i + 2]  = cur[2];
            orig[i + 3]  = cur[4];
            orig[i + 4]  = cur[5];
            orig[i + 5]  = cur[6];
            orig[i + 6]  = cur[8];
            orig[i + 7]  = cur[9];
            orig[i + 8]  = cur[10];
            orig[i + 9]  = cur[12];
            orig[i + 10] = cur[13];
            orig[i + 11] = cur[14];

            // When using Otg, computed bboxes are only used until we get the actual ones from fragments_extra.
            // Once loaded, they must not be overwritten by computed ones (which are too large in some cases).
            if (!this.fragments.boxesLoaded) {
                if (meshInfo.bbox) {
                    _tmpBox.copy(meshInfo.bbox);
                } else {
                // Transform the local BB to world
                if (meshInfo.geometry && meshInfo.geometry.boundingBox) {
                    _tmpBox.copy(meshInfo.geometry.boundingBox);
                } else {
                    this.geoms.getModelBox(this.geomids[fragId], _tmpBox);
                }

                if (!_tmpBox.isEmpty()) {
                    _tmpBox.applyMatrix4(transform);
                }
                }
    
                // Write bounding box to this.boxes
                var boffset = fragId * 6;
                var bb      = this.boxes;
                bb[boffset]     = _tmpBox.min.x;
                bb[boffset + 1] = _tmpBox.min.y;
                bb[boffset + 2] = _tmpBox.min.z;
                bb[boffset + 3] = _tmpBox.max.x;
                bb[boffset + 4] = _tmpBox.max.y;
                bb[boffset + 5] = _tmpBox.max.z;
            }
        }

        // If there are updates pending because we made a change before the fragment
        // existed for a given dbId, update it now.
        updateVertexBufferPendingThemeChanges(this, fragId);
    };


    FragmentList.prototype.isFlagSet = function (fragId, flag) {
        return !!(this.vizflags[fragId] & flag);
    };

    /**
     * Set/unset flag of a fragment.
     * Note: Changing MESH_VISIBLE requires to update allVisibleDirty as well => Use setVisibility() for this case.
     * @param {number} fragId - Fragment ID.
     * @param {number} flag - Must be one of the flags defined at the beginning of this file, e.g., MESH_HIGHLIGHTED.
     * @returns {bool} False if nothing changed.
     */
    FragmentList.prototype.setFlagFragment = function (fragId, flag, value) {

        // If flag is already defined and has this value, just return false.
        var old = this.vizflags[fragId];
        if (!!(old & flag) == value) // "!!" casts to boolean, "==" is intentional.
            return false;

        // set or unset flag
        if (value)
            this.vizflags[fragId] = old | flag;
        else
            this.vizflags[fragId] = old & ~flag;

        return true;
    };

    /**
     * Set/unset flag for all fragments, e.g. setFlagGlobal(MESH_VISIBLE, true);
     * Note: Changing MESH_VISIBLE requires to update allVisibleDirty as well => use setAllVisibility() for this case.
     * @param {number} flag - Must be one of the flags defined at the beginning of this file, e.g., MESH_HIGHLIGHTED.
     * @param {bool} value - Value to be set to the flag
     */
    FragmentList.prototype.setFlagGlobal = function (flag, value) {
        var vizflags = this.vizflags;
        var i = 0, iEnd = vizflags.length;
        if (value) {
            for (; i < iEnd; i++) {
                vizflags[i] = vizflags[i] | flag;
            }
        } else {
            var notflag = ~flag;
            for (; i < iEnd; i++) {
                vizflags[i] = vizflags[i] & notflag;
            }
        }
    };

    /**
     * Marks all lines as visible or hidden.
     * Works like this.setFlagGlobal(MESH_HIDE, hide), but only affects fragments with MESH_ISLINE flag.
     * @param {bool} hide - Desired visibility status.
     */
    FragmentList.prototype.hideLines = function (hide) {
        this.linesHidden = hide;
    };

    /**
     * Marks all points as visible or hidden.
     * Works like this.setFlagGlobal(MESH_HIDE, hide), but only affects fragments with MESH_ISPOINT flag.
     * @param {bool} hide - Desired visibility status.
     */
    FragmentList.prototype.hidePoints = function (hide) {
        this.pointsHidden = hide;
    };

    /**
     * Marks all fragments with the given flag as visible or hidden.
     * Works like this.setFlagGlobal(MESH_HIDE, hide), but only affects fragments with given flag.
     * @param {number} typeFlag - visibility flag of fragments to change
     * @param {bool} hide - Desired visibility status.
     */
    FragmentList.prototype.hideFragments = function (typeFlag, hide) {

        var flag = MeshFlags.MESH_HIDE;

        var vizflags = this.vizflags;
        var i = 0, iEnd = vizflags.length;
        if (hide) {
            for (; i < iEnd; i++) {
                if (vizflags[i] & typeFlag)
                    vizflags[i] = vizflags[i] | flag;
            }
        } else {
            var notflag = ~flag;
            for (; i < iEnd; i++) {
                if (vizflags[i] & typeFlag)
                    vizflags[i] = vizflags[i] & notflag;
            }
        }

        // Mark allVisible as outdated        
        this.allVisibleDirty = true;
    };
 
    /**
     * Checks visibility of a fragment.
     * @param {number} frag - Fragment ID.
     * @returns {bool} True if the fragment is visible and not highlighted nor hidden.
     */
    FragmentList.prototype.isFragVisible = function (frag) {
        var isHiddenLine  = this.linesHidden  && (this.isLine(frag) || this.isWideLine(frag));
        var isHiddenPoint = this.pointsHidden && this.isPoint(frag);
        return ((this.vizflags[frag] & 7/*MESH_VISIBLE|MESH_HIGHLIGHTED|MESH_HIDE*/) == 1) && !isHiddenLine && !isHiddenPoint;
    };

    FragmentList.prototype.isFragOff = function (frag) {
        return !!(this.vizflags[frag] & MeshFlags.MESH_HIDE);
    };

    /*
     * Returns true if a fragment was excluded from loading or unloaded. 
     *
     * Note that isNotLoaded()==false does not guarantee that geometry and material are already in memory.
     * Only vice versa: If true, it will not be loaded at all.
     */ 
    FragmentList.prototype.isNotLoaded = function (frag) {
        return (this.vizflags[frag] & MeshFlags.MESH_NOTLOADED);
    };

    FragmentList.prototype.isLine = function (frag) {
        return !!(this.vizflags[frag] & MeshFlags.MESH_ISLINE/*MESH_VISIBLE|MESH_HIGHLIGHTED*/);
    };

    FragmentList.prototype.isWideLine = function (frag) {
        return this.isFlagSet(frag, MeshFlags.MESH_ISWIDELINE);
    };

    FragmentList.prototype.isPoint = function (frag) {
        return this.isFlagSet(frag, MeshFlags.MESH_ISPOINT);
    };


    // [HB:] This method does not consider the MESH_HIDE flag, but this.setFragOff seems to expect this, because it sets allVisibleDirty.
    //       Is this a bug?
    FragmentList.prototype.areAllVisible = function () {

        // update allVisible if any flags have changed
        if (this.allVisibleDirty) {

            // allVisible <=> MESH_VISIBLE is set for all fragments
            var vizflags   = this.vizflags;
            var allVisible = true;
            for (var i = 0, iEnd = vizflags.length; i < iEnd; i++) {
                if ((vizflags[i] & 1/*MESH_VISIBLE*/) === 0) {
                    allVisible = false;
                    break;
                }
            }

            this.allVisible = allVisible;
            this.allVisibleDirty = false;
        }

        return this.allVisible;
    };

    // Swaps r/b channels in a THREE.Color object.
    function swapRBChannels(color) {
        var tmp = color.r;
        color.r = color.b;
        color.b = tmp;
        return color;
    }

    /** Linear interpolation between original color and theming color based on theming intensity.
     * @param origColor    {number}        original uint32 color from vertex-buffer. alpha is vertex-opacity
     * @param themingColor {THREE.Vector4} theming color as vec4f. Channels are (r,g,b,a) where alpha is theming intensity.
     * @returns finalColor {number}        final color as uint32
     */
    var applyThemingColorAndVisibility = (function() {
        var tmp1 = null;
        var tmp2 = null;
        var rgbMask   = parseInt("00FFFFFF", 16);
        var alphaMask = parseInt("FF000000", 16);
        return function(origColor, themingColor) {
            if (!tmp1) {
                tmp1 = new THREE.Color();
                tmp2 = new THREE.Color();
            }

            tmp1.set(origColor & rgbMask);

            // THREE.Color denotes uint color in BGRA order (i.e., Blue in the lowest byte).
            // In the vertex-buffer, we use RGBA - so we have to swap when converting between these two.
            swapRBChannels(tmp1);

            if (themingColor) {
                // set tmp2 to theming color
                tmp2.setRGB(themingColor.x, themingColor.y, themingColor.z);

                // blend original color with theming color
                tmp1.lerp(tmp2, themingColor.w);
            }

            // convert back to color-buffer uint32 and preserve original alpha bits
            return swapRBChannels(tmp1).getHex() | (origColor & alphaMask);
        };
    })();

    // Updates the per-vertex array of a mesh to reflect latest theming and ghosting state.
    // Note that this can only work on F2D meshes with known attributes and interleaved vertex buffer.
    function updateVertexBufferForThemingAndGhosting(fragList, fragId) {
        // get backup of original per-vertex colors (undef if color array is currently not modified)
        var origColors  = fragList.originalColors[fragId];

        // get values to access colors and ids
        var geom = fragList.getGeometry(fragId);
        if (!geom || !geom.vb) {
            return;
        }
        const vbr = new VertexBufferReader(geom);
        const vbw = new VertexBufferWriter(geom);

        if (!vbr.isInterleavedVb) {
            // we cannot work on this mesh.
            return;
        }

        // Track if any colors/layers are affected by theming/ghosting. If not, we can drop the color/layer array backup at the end.
        var themingApplied  = false;

        // Constants used for ghosting of 2D objects
        var PaperLayer = 0;    // we use the paper layer to determine the paper sheet background (see F2d.js initSheet). This shape must be excluded from ghosting.
        var vertexCount = vbr.vcount;
        // update vertex-color for each vertex
        for (var i = 0; i < vertexCount; i++) {
            var dbId  = vbr.getDbIdAt(i);
            var color = (origColors  ? origColors[i]  : vbr.getColorAt(i));
            var layer = vbr.getLayerIndexAt(i);

            // sign extend the upper byte to get back negative numbers (since per-vertex ids are clamped from 32 bit to 24 bit)
            dbId = (dbId << 8) >> 8;

            var isPaper = dbId === -1 && layer === PaperLayer;

            // is this id affected by theming?
            var themeColor = fragList.db2ThemingColor[dbId];
            var isHidden   = fragList.dbIdOpacity[dbId] === 0;

            if (!themeColor && !isHidden) {
                // no theming for this vertex
                if (origColors) {
                    // restore original color
                    color = origColors[i];
                } // else: if there is no backup array, the vertex-color is already the original.
            } else {
                // this vertex-color will be affected by theming.
                // make sure that we have backup.
                if (!origColors) {
                    // backup original colors before we modify them.
                    origColors = new Uint32Array(vertexCount);
                    for (var j=0; j<vertexCount; j++) {
                        origColors[j] = vbr.getColorAt(j);
                    }
                    fragList.originalColors[fragId] = origColors;
                }

                // replace vertex-color based on theming and visibility
                if (isHidden) {
                    color = 0;
                } else {
                    color = applyThemingColorAndVisibility(color, themeColor);
                }

                // signal that the color backup array is still needed
                themingApplied = true;
            }

            if (!isHidden) {
                let opacity = fragList.dbIdOpacity[dbId];
                if (!isNaN(opacity)) {
                    const rgbMask = parseInt("00FFFFFF", 16);
                    opacity = (255 * opacity) << 24;
                    color = (color & rgbMask) | (opacity);
                }
            }

            // color -> vertexBuffer
            vbw.setColorAt(i, color);

            // is this id affected by theming?
            var isGhosted  = fragList.dbIdIsGhosted[dbId] && !isPaper;
            var flags = vbr.getVertexFlagsAt(i);
            if (isGhosted)
                flags |= 0xff << 24;
            else
                flags &= ~(0xff << 24);

            // layer -> vertexBuffer
            vbw.setVertexFlagsAt(i, flags);
        }

        // if theming is off for all vertices, drop the backup array
        if (!themingApplied) {
            fragList.originalColors[fragId] = null;
        }

        // trigger refresh of GPU-side vertex buffer
        geom.vbNeedsUpdate = true;
    }

    function updateVertexBufferForThemingAndGhostingIfNeeded(fragList, fragId) {
        // Check if anything changed
        if (!fragList.themingOrGhostingNeedsUpdate[fragId]) {
            return;
        }

        updateVertexBufferForThemingAndGhosting(fragList, fragId);

        // Don't touch this mesh again until new theming changes are done
        fragList.themingOrGhostingNeedsUpdate[fragId] = false;
    }

    function isObjectEmpty(obj) {
        for (let prop in obj) {
            if (obj.hasOwnProperty(prop)) {
                return false;
            }
        }
        return true;
    }

    function updateVertexBufferPendingThemeChanges(fragList, fragId) { 
        if (fragList.is2d && !isObjectEmpty(fragList.themingOrGhostingNeedsUpdateByDbId)) {
            let dbIds = fragList.getDbIds(fragId);
            dbIds = Array.isArray(dbIds) ? dbIds : [dbIds];
            dbIds = dbIds.filter(dbId => fragList.themingOrGhostingNeedsUpdateByDbId[dbId]);
            if (dbIds.length) {
                updateVertexBufferForThemingAndGhosting(fragList, fragId);

                // In the 2D case the mapping is 1 -> many (1 frag -> many dbIds), so after updating this frag we can remove the dbIds from the array
                dbIds.forEach(dbId => {
                    delete fragList.themingOrGhostingNeedsUpdateByDbId[dbId];
                });
            }
        }
    }

    //A scratch object that we fill in and return in the case
    //we don't use THREE.Mesh for persistent storage. If the caller
    //needs to hold on to the mesh outside the callback scope, it has to clone it.
    const createScratchMesh = () => {
        var m = new THREE.Mesh();
        m.isTemp = true;
        m.dbId = 0;
        m.modelId = 0;
        m.fragId = -1;
        m.hide = false;
        m.isLine = false;
        m.isWideLine = false;
        m.isPoint = false;

        return m;
    };

    /**
     * Provides an actual mesh for specific fragment.
     * NOTE: For (this.useThreeMesh==false), the returned value is volatile and will be overwritten on next call!
     * @param {number} fragId - Fragment ID.
     * @returns {THREE.Mesh} Mesh for the given fragment.
     */
    FragmentList.prototype.getVizmesh = function (fragId) {
        // make sure that vertex-colors reflect the latest theming-state
        if (this.is2d) {
            updateVertexBufferForThemingAndGhostingIfNeeded(this, fragId);
        }

        if (this.useThreeMesh) {
            var mesh = this.vizmeshes[fragId];
            if (mesh)
                mesh.themingColor = this.db2ThemingColor[mesh.dbId];
            return mesh;
        } else {
            const m = this.scratchMesh = this.scratchMesh || createScratchMesh();

            // init temp mesh object from geometry, material etc.
            m.geometry = this.getGeometry(fragId); // BufferGeometry
            m.material = this.getMaterial(fragId); // THREE.ShaderMaterial
            m.dbId     = this.getDbIds(fragId);
            m.modelId  = this.modelId;
            m.fragId   = fragId;
            m.visible  = true;
            m.isLine   = this.isLine(fragId);
            m.isWideLine = this.isWideLine(fragId);
            m.isPoint   = this.isPoint(fragId);
            m.hide      = this.isFragOff(fragId);
            m.themingColor = this.db2ThemingColor[m.dbId];

            this.getWorldMatrix(fragId, m.matrixWorld);

            return m;
        }
    };

    FragmentList.prototype.getMaterialId = function (fragId) {
        var m = this.getMaterial(fragId);
        return m ? m.id : 0;
    };

    FragmentList.prototype.getMaterial = function (fragId) {
        // material ids are either stored with vizmeshes or in the material map.
        return this.useThreeMesh ? this.vizmeshes[fragId].material : this.materialIdMap[this.materialids[fragId]];
    };

    FragmentList.prototype.getGeometry = function (fragId) {
        // geometry is either stored in with vizmoeshes or obtained from this.geoms.
        // Make sure this.vizmesh[fragId] isn't null or undefined
        var mesh;
        return this.useThreeMesh
            ? ((mesh = this.vizmeshes[fragId]) ? mesh.geometry : null)
            : this.geoms.getGeometry(this.geomids[fragId]);
    };
    
    FragmentList.prototype.getGeometryId = function (fragId) {
        // When using THREE.Meshes, fragIds and geomids are the same and this.geomids is not used.
        return this.useThreeMesh ? fragId : this.geomids[fragId];
    };

    FragmentList.prototype.setMaterial = function (fragId, material) {

        if (this.useThreeMesh) {

            this.vizmeshes[fragId].material = material;

        } else {

            var matId = this.materialmap[material.id];

            if (!matId) {

                //Material.id is global, hence we can't expect it to be a small
                //integer. Hence the incrementing counter indirection.
                matId = this.nextMaterialId++;

                this.materialids = reallocateUintArrayMaybe(this.materialids, matId);

                this.materialIdMap[matId] = material;

                //remember our local ID for this global material
                this.materialmap[material.id] = matId;
            }

            this.materialids[fragId] = matId;
        }
    };

    FragmentList.prototype.getCount = function () {
        return this.vizmeshes ? this.vizmeshes.length : this.vizflags.length;
    };

    FragmentList.prototype.getDbIds = function (fragId) {
        return this.fragments.fragId2dbId[fragId];
    };

    // glRenderer: instanceof WebGLRenderer (only neeeded when for this.useThreeMesh==false)
    FragmentList.prototype.dispose = function (glrenderer) {
        
        if (this.useThreeMesh) {

            // dispatch remove event to all meshes and dispose events to all BufferGeometry buffers
            // This will trigger EventListeners added by WebGLRenderer that deallocate the geometry later.
            // (see onGeometryDispose(..) in WebGLRenderer.js)
            var DISPOSE_EVENT = {type: 'dispose'};
            var REMOVED_EVENT = {type: 'removed'};
            for (var i = 0; i < this.vizmeshes.length; i++) {
                var m = this.vizmeshes[i];
                if (m) {
                    m.dispatchEvent(REMOVED_EVENT);
                    m.geometry.dispatchEvent(DISPOSE_EVENT);
                }
            }
        } else {
            // Delete all geometry data immediately (see WebGLRenderer.deallocateGeometry)
            this.geoms.dispose(glrenderer);
        }
    };

    FragmentList.prototype.dtor = function(glrenderer) {
        this.dispose(glrenderer);

        this.scratchMesh = null;

        this.fragments = null;
        this.geoms = null;
        this.boxes = null;
        this.transforms = null;
        this.vizflags = null;
        this.vizmeshes = null;

        this.geomids = null;
        this.materialids = null;
        
        this.materialmap = null;
        this.materialIdMap = null;

        this.db2ThemingColor = null;
        this.originalColors  = null;
        this.themingOrGhostingNeedsUpdate = null;
        this.themingOrGhostingNeedsUpdateByDbId = null;
        this.dbIdOpacity = null;
        this.dbIdIsGhosted = null;

        this.animxforms = null; 
        this.matrix = null;
        this.viewBounds = null;
    };

// This function should probably not be called outside VisibityManager
// in order to maintain node visibility state.
    FragmentList.prototype.setVisibility = function (fragId, value) {
        this.setFlagFragment(fragId, MeshFlags.MESH_VISIBLE, value);
        this.allVisibleDirty = true;
    };


    // Note that this function switches whole meshes on/off. It cannot be used to toggle visibility of
    // single 2D objects within a single mesh. For this one, use setObject2DVisible instead.
    FragmentList.prototype.setFragOff = function (fragId, value) {
        this.setFlagFragment(fragId, MeshFlags.MESH_HIDE, value);
        this.allVisibleDirty = true; // [HB:] Either this should be removed or this.areAllVisible should consider MESH_HIDE
    };


    FragmentList.prototype.setAllVisibility = function (value) {
        if (this.is2d) {
            var frags = this.fragments;
            if (frags && frags.dbId2fragId) {
                for (var id in frags.dbId2fragId) {
                    this.setObject2DGhosted(parseInt(id), !value);
                }
            }
        } else {
            this.setFlagGlobal(MeshFlags.MESH_VISIBLE, value);
        }

        this.allVisible = value;
        this.allVisibleDirty = false;
    };

    /**
     * Updates animation transform of a specific fragment.
     * Note: 
     *      - If scale/rotation/translation are all null, the call resets the whole transform, i.e., no anim transform is assigned anymore.
     *      - Leaving some of them null means to leave them unchanged.
     * @param {number} fragId - Fragment ID.
     * @param {Vector3=} scale
     * @param {Quaternion=} rotationQ
     * @param {Vector3=} translation
     */
    FragmentList.prototype.updateAnimTransform = function (fragId, scale, rotationQ, translation) {

        var ax = this.animxforms;
        var off;

        //Allocate animation transforms on first use.
        if (!ax) {
            var count = this.getCount();
            ax = this.animxforms = new Float32Array(10 * count); //3 scale + 4 rotation + 3 translation
            for (var i = 0; i < count; i++) {                
                // get start index of the anim transform of fragment i
                off = i * 10;       

                // init as identity transform
                ax[off] = 1;        // scale.x
                ax[off + 1] = 1;    // scale.y
                ax[off + 2] = 1;    // scale.z
                ax[off + 3] = 0;    // rot.x
                ax[off + 4] = 0;    // rot.y
                ax[off + 5] = 0;    // rot.z
                ax[off + 6] = 1;    // rot.w
                ax[off + 7] = 0;    // trans.x
                ax[off + 8] = 0;    // trans.y
                ax[off + 9] = 0;    // trans.z
            }
        }

        off = fragId * 10;
        var moved = false;

        if (scale) {
            ax[off] = scale.x;
            ax[off + 1] = scale.y;
            ax[off + 2] = scale.z;
            moved = true;
        }

        if (rotationQ) {
            ax[off + 3] = rotationQ.x;
            ax[off + 4] = rotationQ.y;
            ax[off + 5] = rotationQ.z;
            ax[off + 6] = rotationQ.w;
            moved = true;
        }

        if (translation) {
            ax[off + 7] = translation.x;
            ax[off + 8] = translation.y;
            ax[off + 9] = translation.z;
            moved = true;
        }

        // Set MESH_MOVED if an animation transform has been assigned. Just if scale/rotation/translation are all null, unset the flag.
        this.setFlagFragment(fragId, MeshFlags.MESH_MOVED, moved);

        //Assume that if we are called with null everything the caller wants to reset the transform.
        if (!moved) {
            // reset to identity transform
            ax[off] = 1;
            ax[off + 1] = 1;
            ax[off + 2] = 1;
            ax[off + 3] = 0;
            ax[off + 4] = 0;
            ax[off + 5] = 0;
            ax[off + 6] = 1;
            ax[off + 7] = 0;
            ax[off + 8] = 0;
            ax[off + 9] = 0;
        }
    };

    /**
     * Returns animation transform of a specific fragment.
     * @param {number} fragId - Fragment ID.
     * @param {THREE.Vector3=} scale - Output param.
     * @param {THREE.Quaternion=} rotationQ - Output param.
     * @param {THREE.Vector3=} translation - Output param.
     * @returns {bool} True if an anim transform is assigned to the given fragment.
     *      If so, it is written to the given out params. False otherwise (outparams not changed).
     */
    FragmentList.prototype.getAnimTransform = function (fragId, scale, rotationQ, translation) {

        if (!this.animxforms)
            return false;

        if (!this.isFlagSet(fragId, MeshFlags.MESH_MOVED))
            return false;

        var off = fragId * 10;
        var ax = this.animxforms;

        if (scale) {
            scale.x = ax[off];
            scale.y = ax[off + 1];
            scale.z = ax[off + 2];
        }

        if (rotationQ) {
            rotationQ.x = ax[off + 3];
            rotationQ.y = ax[off + 4];
            rotationQ.z = ax[off + 5];
            rotationQ.w = ax[off + 6];
        }

        if (translation) {
            translation.x = ax[off + 7];
            translation.y = ax[off + 8];
            translation.z = ax[off + 9];
        }

        return true;
    };

    /**
     * Returns world matrix of a fragment.
     * @param {number} index - Fragment ID.
     * @param {THREE.Matrix4} dstMtx - Out param to receive the matrix.
     */
    FragmentList.prototype.getOriginalWorldMatrix = function (index, dstMtx) {
        var i = index * 12;

        var cur  = dstMtx.elements;
        var orig = this.transforms;

        if (orig) {
            // If this.transforms is defined, copy transform from this array            

            // In this.transforms, we only store the upper 3 rows explicitly. 
            // The last row is alway (0,0,0,1).
            cur[0] = orig[i];
            cur[1] = orig[i + 1];
            cur[2] = orig[i + 2];
            cur[3] = 0;
            cur[4] = orig[i + 3];
            cur[5] = orig[i + 4];
            cur[6] = orig[i + 5];
            cur[7] = 0;
            cur[8] = orig[i + 6];
            cur[9] = orig[i + 7];
            cur[10] = orig[i + 8];
            cur[11] = 0;
            cur[12] = orig[i + 9];
            cur[13] = orig[i + 10];
            cur[14] = orig[i + 11];
            cur[15] = 1;
        } else if (this.useThreeMesh) {
            // get matrix directly from THREE.Mesh
            var m = this.vizmeshes[index];
            if (m)
                dstMtx.copy(m.matrix); // Was matrixWorld, but that is now being used for the alignment transform
            else
                dstMtx.identity();
        } else {
            dstMtx.identity();
        }
    };


    /**
     * Writes the final world matrix of a fragment to out param dstMtx.
     * The world matrix results from original transform and anim transform (if any).
     * @param {number} index - Fragment ID.
     * @param {THREE.Matrix4} dstMtx - Out param to receive the matrix.
     */
    FragmentList.prototype.getWorldMatrix = (function() {

        //Allocate a second temp variable here because the input can be the class scoped
        //temporary matrix in some call sequences.
        var tmp = new THREE.Matrix4();

        return function (index, dstMtx) {

            this.getOriginalWorldMatrix(index, dstMtx);

            //If mesh hasn't moved from its original location, just use that.
            if (this.isFlagSet(index, MeshFlags.MESH_MOVED)) {

                //Otherwise construct the overall world matrix
                this.getAnimTransform(index, _tmpScale, _tmpRot, _tmpPos);

                // compose matrix from pos, rotation, and scale
                tmp.compose(_tmpPos, _tmpRot, _tmpScale);

                // First apply original matrix (in dstMtx), then anim matrix (in tmp).
                // Note that tmp muist be multipled from left for this.
                dstMtx.multiplyMatrices(tmp, dstMtx);
            }

            // Apply optional model-transform
            if (this.matrix) {
                // Apply fragment matrix first (=dst), then model matrix (=this.matrix).
                // Note that model matrix must be multipled from left for this.
                dstMtx.multiplyMatrices(this.matrix, dstMtx);
            }
        }
    })();

    FragmentList.prototype.setModelMatrix = function(matrix) {
        if (matrix) {
            this.matrix = this.matrix || new THREE.Matrix4();
            this.matrix.copy(matrix);
            if (this.useThreeMesh) {
                // For ThreeJS meshes we use matrixWorld to store the alignment matrix
                this.vizmeshes.forEach(mesh => {
                    mesh.matrixWorld.multiplyMatrices(this.matrix, mesh.matrix);
                });
            }
        } else {
            this.matrix = null;
            if (this.useThreeMesh) {
                this.vizmeshes.forEach(mesh => {
                    mesh.matrixWorld.copy(mesh.matrix);
                });
            }
        }
        this.invMatrix = null;
    };

    FragmentList.prototype.getInverseModelMatrix = function() {
        if (this.matrix) {
            if (!this.invMatrix) {
                this.invMatrix = this.matrix.clone().invert();
            }

            return this.invMatrix;
        }

        return null;
    };

    /**
     * Writes the world box to dstBox outparams, considering matrix and anim transform (if specified).
     * @param {number} index - Fragment ID.
     * @param {THREE.Box3|LmvBox3} dstBox - result is saved here
     */
    FragmentList.prototype.getWorldBounds = function (index, dstBox) {

        //Check if the world transform of the mesh is unchanged from
        //the original LMV file -- in such case we can use the original
        //bounding box from the LMV package, which is presumably more precise (tighter)
        //than just transforming the model box.
        //This is important if we want to keep our bounding volume hierarchy efficient.
        if (this.boxes && !this.isFlagSet(index, MeshFlags.MESH_MOVED)) {
            var b       = this.boxes;
            var boffset = index * 6;
            dstBox.min.x = b[boffset];
            dstBox.min.y = b[boffset + 1];
            dstBox.min.z = b[boffset + 2];
            dstBox.max.x = b[boffset + 3];
            dstBox.max.y = b[boffset + 4];
            dstBox.max.z = b[boffset + 5];

            // Consider optional model matrix if there is one
            if (this.matrix) {
                dstBox.applyMatrix4(this.matrix);
            }

            return;
        }

        // get original model box
        if (this.useThreeMesh) {
            // either from THREE.Mesh
            var m = this.vizmeshes[index];
            if (m && m.geometry) {
                dstBox.copy(m.geometry.boundingBox);
            }
        }
        else {
            // or from GeometryList
            this.geoms.getModelBox(this.geomids[index], dstBox);
        }

        if (this.viewBounds) {
            // Crop the box by the viewing bounds
            dstBox.intersect(this.viewBounds);
        }

        if (!dstBox.isEmpty()) {
            // apply world matrix to dstBox.
            // Note that the worldMatrix includes the model matrix as well.
            this.getWorldMatrix(index, _tmpMatrix);
            dstBox.applyMatrix4(_tmpMatrix);
        } else {
            // dstBox could be empty from intersect, but not on all axis.
            // Make sure all coordinates are really empty so we don't add anything irrelevaant
            // when accumulating the result.
            dstBox.makeEmpty();
        }
    };


    /**
     * Writes the original (as loaded) world box to dstBox outparams. Does not take into account changes
     * to object position like explode/animation or model matrix.
     * @param {number} index - Fragment ID.
     * @param {Array} dstBox - Array where result is stored as 6 consecutive numbers
     */
    FragmentList.prototype.getOriginalWorldBounds = function (index, dstBox) {

        if (this.boxes) {
            var b       = this.boxes;
            var boffset = index * 6;
            dstBox[0] = b[boffset];
            dstBox[1] = b[boffset + 1];
            dstBox[2] = b[boffset + 2];
            dstBox[3] = b[boffset + 3];
            dstBox[4] = b[boffset + 4];
            dstBox[5] = b[boffset + 5];
            return;
        }

        // get original model box
        if (this.useThreeMesh) {
            // either from THREE.Mesh
            var m = this.vizmeshes[index];
            if (m && m.geometry) {
                _tmpBox.copy(m.geometry.boundingBox);
            }
        }
        else {
            // or from GeometryList
            this.geoms.getModelBox(this.geomids[index], _tmpBox);
        }

        if (!_tmpBox.isEmpty()) {
            // apply world matrix to dstBox
            this.getOriginalWorldMatrix(index, _tmpMatrix);
            _tmpBox.applyMatrix4(_tmpMatrix);
        }

        dstBox[0] = _tmpBox.min.x;
        dstBox[1] = _tmpBox.min.y;
        dstBox[2] = _tmpBox.min.z;
        dstBox[3] = _tmpBox.max.x;
        dstBox[4] = _tmpBox.max.y;
        dstBox[5] = _tmpBox.max.z;
    };

    /**
     * Set themingNeedsUpdate flag for all vizmeshes that contain a given dbId
     * @param {Autodesk.Viewing.Private.FragmentList} fragList 
     * @param {number} dbId 
     */
    function setThemingOrGhostingNeedsUpdateFlag(fragList, dbId) {

        if (!fragList.is2d) {
            // In this case (3D model), we just have theming colors per mesh and don't need to update vertex buffers.
            return;
        }

        // get id(s) of affected mesh(es) that needs a vertex-color update
        var fragIds = fragList.fragments.dbId2fragId[dbId];

        //  trigger update for single id or an array of ids
        if (Array.isArray(fragIds)) {
            for (var i=0; i<fragIds.length; i++) {
                fragList.themingOrGhostingNeedsUpdate[fragIds[i]] = true;
            }
        } else if (typeof fragIds === 'number') {
            fragList.themingOrGhostingNeedsUpdate[fragIds] = true;
        } else {
            // In case the fragment doesn't exist, it might be that is hasn't been loaded yet.
            // Keep the needsUpdate by dbId in case it's loaded later.
            fragList.themingOrGhostingNeedsUpdateByDbId[dbId] = true;
        }
    }

    /**
     * Applies a theming color that is blended with the final fragment color of a material shader.
     * @param {number}        dbId
     * @param {THREE.Vector4} [color] - theming color (in xyz) and intensity (in w). All components in [0,1].
     *                                  Set to undefined for 'no theming'
     */
    FragmentList.prototype.setThemingColor = function(dbId, color) {
        // Stop if color keeps the same
        var oldColor    = this.db2ThemingColor[dbId];
        var colorsEqual = (oldColor === color || (oldColor && color && oldColor.equals(color)));
        if (!colorsEqual) {
            this.db2ThemingColor[dbId] = color || undefined;
            setThemingOrGhostingNeedsUpdateFlag(this, dbId);
        }
    };

    /** Restore original colors for all themed shapes. */
    FragmentList.prototype.clearThemingColors = function() {

        // When using F2D (model.is2d()==true), we have to update the restore the original
        // per-vertex colors. For 3D, we can use per-shape colors, so that this step is not
        // needed.
        if (this.is2d) {
            // trigger update for all meshes that were affected by theming before
            // Note that dbId2fragId only exists for F2D models.
            for (var id in this.fragments.dbId2fragId) {
                setThemingOrGhostingNeedsUpdateFlag(this, parseInt(id));
            }
            delete this.db2ThemingColor['-1']; // Delete theming for sheet
        }

        // clear theming-color map
        this.db2ThemingColor.length = 0;
    };

    /** Set ghosting flag for a 2D object. This reduces the objects opacity, blends it with pageColor, and excludes it from selection.
     *  @param {number} dbId
     *  @param {bool}   state
     */
    FragmentList.prototype.setObject2DGhosted = function(dbId, state) {
        var oldState = this.dbIdIsGhosted[dbId];
        if (!!state !== !!oldState) {
            this.dbIdIsGhosted[dbId] = state;
            setThemingOrGhostingNeedsUpdateFlag(this, dbId);
        }
    };

    /** Set an opacity value for a 2D object.
     *  @param {number} dbId
     *  @param {number}  opacity
     */
    FragmentList.prototype.setObject2DOpacity = function(dbId, opacity) {
        var oldOpacity = this.dbIdOpacity[dbId];
        if (opacity !== oldOpacity) {
            this.dbIdOpacity[dbId] = opacity;
            setThemingOrGhostingNeedsUpdateFlag(this, dbId);
        }
    };

    /** Set hide flag for a 2D object. This sets opacity to 0.0, which also excludes it from selection.
     *  @param {number} dbId
     *  @param {bool}   visible
     */
    FragmentList.prototype.setObject2DVisible = function(dbId, visible) {
        var wasVisible = this.dbIdOpacity[dbId] !== 0;
        if (visible !== wasVisible) {
            this.dbIdOpacity[dbId] = (visible | 0);
            setThemingOrGhostingNeedsUpdateFlag(this, dbId);
        }
    };

    FragmentList.prototype.getViewBounds = function() {
        return this.viewBounds;
    };

    FragmentList.prototype.setViewBounds = function(bounds) {
        if (!bounds) {
            this.viewBounds = null;
            return;
        }
        
        this.viewBounds = this.viewBounds || new THREE.Box3();

        this.viewBounds.copy(bounds);

        // If the bounds passed are 2D set Z bounds to infinity
        if (!bounds.max.hasOwnProperty('z')) {
            this.viewBounds.max.z = Infinity;
            this.viewBounds.min.z = -Infinity;
        }
    };

    FragmentList.prototype.getDoNotCut = function() {
        return this.doNotCut;
    };

    FragmentList.prototype.setDoNotCut = function(doNotCut) {
        this.doNotCut = doNotCut;
    };

    /**
     * Convenience class encapsulating a single fragment in a given FragmentList.
     * Use sparingly, as it is expensive to have those for every fragment in memory.
     * 
     * @see Autodesk.Viewing.Viewer3D#getFragmentPointer
     * @see Autodesk.Viewing.Viewer3D#getModel
     * 
     * @example
     * var avp = Autodesk.Viewing.Private;
     * var fragPointer = new avp.FragmentPointer(viewer.model.getFragmentList(), 4); // Get the fragment proxy for some frag id
     * // The Model class also exposes the following method to get the FragmentPointer:
     * // var fragPointer = viewer.model.getFragmentPointer(4); 
     * 
     * @constructor
     * 
     * @param {Autodesk.Viewing.Private.FragmentList} frags - the fragment list
     * @param {number} fragId - the fragment id
     * 
     * @alias Autodesk.Viewing.Private.FragmentPointer
     */
    export function FragmentPointer(frags, fragId) {

        this.frags  = frags;    // fragment list
        this.fragId = fragId;   // id of a fragment in frags

        // used by MeshAnimation
        this.scale      = null;
        this.quaternion = null;
        this.position   = null;
    }

    /**
     * Writes the final world matrix of a fragment to dst.
     * The world matrix results from original transform and anim transform (if any).
     * @param {THREE.Matrix4} dst - Out param to receive the matrix.
     * @example
     * var matrix = new THREE.Matrix4() // Create an empty Matrix4
     * fragPointer.getWorldMatrix(matrix); // Set the new values to the matrix variable
     */
    FragmentPointer.prototype.getWorldMatrix = function (dst) {
        this.frags.getWorldMatrix(this.fragId, dst);
    };

    /**
     * Writes the original world matrix of a fragment to dst.
     * @param {THREE.Matrix4} dst - Out param to receive the matrix.
     * @example
     * var matrix = new THREE.Matrix4() // Create an empty Matrix4
     * fragPointer.getOriginalWorldMatrix(matrix); // Set the new values to the matrix variable
     */
    FragmentPointer.prototype.getOriginalWorldMatrix = function(dst) {
        this.frags.getOriginalWorldMatrix(this.fragId, dst);
    };

    /**
     * Writes the world box to dst param, considering matrix and anim transform (if specified).
     * @param {THREE.Box3|LmvBox3} dst - result is saved here
     * @example
     * var box = new THREE.Box3(); // Create an empty Box3
     * fragPointer.getWorldBounds(box); // Set the new values to the box variable
     * 
     */
    FragmentPointer.prototype.getWorldBounds = function (dst) {
        return this.frags.getWorldBounds(this.fragId, dst);

    };

    /**
     * Sets the scale, quaternion and position to the animation transform of the the fragment.
     * @returns {boolean} True if an animation transform is set. Otherwise, it returns false and transform is set to identity.
     */
    FragmentPointer.prototype.getAnimTransform = function () {

        if (!this.scale) {
            this.scale      = new THREE.Vector3(1, 1, 1);
            this.quaternion = new THREE.Quaternion(0, 0, 0, 1);
            this.position   = new THREE.Vector3(0, 0, 0);
        }

        return this.frags.getAnimTransform(this.fragId, this.scale, this.quaternion, this.position);

    };

    /**
     * Applies current scale/quaternion/position to the fragment.
     */
    FragmentPointer.prototype.updateAnimTransform = function () {
        
        if (!this.scale) {
            this.scale      = new THREE.Vector3(1, 1, 1);
            this.quaternion = new THREE.Quaternion(0, 0, 0, 1);
            this.position   = new THREE.Vector3(0, 0, 0);
        }

        this.frags.updateAnimTransform(this.fragId, this.scale, this.quaternion, this.position);
    };

    /**
     * Returns the material associated with the fragment
     * @returns {THREE.Material} - Material
     */
    FragmentPointer.prototype.getMaterial = function () {
        return this.frags.getMaterial(this.fragId);

    };

    /**
     * Set a material to the current fragment
     * @example
     * var material = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Create a new material
     * fragPointer.setMaterial(material); // Assign the new material to the fragment
     */
    FragmentPointer.prototype.setMaterial = function (material) {

        return this.frags.setMaterial(this.fragId, material);

    };
