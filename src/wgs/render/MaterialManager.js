import * as THREE from "three";
import { TextureLoader } from "../../file-loaders/main/TextureLoader";
import { logger } from '../../logger/Logger';
import { LineMaterial } from "./LineMaterial";
import { createLinePatternTexture } from './LineStyleDef';
import { MaterialConverter } from "./MaterialConverter";

function setColor(value, color, opacity) {
    value.x = color.r;
    value.y = color.g;
    value.z = color.b;
    value.w = opacity;
}

// defaults
var _2dSelectionColor = new THREE.Color("#0000FF");
var _2dSelectionOpacity = 0.6;

/**
 * @enum {number}
 * @readonly
 */
export const MATERIAL_VARIANT = {
    INSTANCED:   0,
    VERTEX_IDS:  1
};

const updateValueAndUniform = (material, key, value) => {
    material[key] = value;
    material.needsUpdate = true;
}

/**
 * Helper class that can optionally be used to manage surface/line materials.
 *
 * It has several responsibilities:
 * 1. Keeps track of materials
 * 2. Extends materials with LMV specific properties and keeps
 *    materials in sync whenever the properties change
 *
 * @constructor
 */
export function MaterialManager(renderer) {
    this._renderer = renderer;
    this._textures = {};
    this._texturesToUpdate = [];

    // TODO: use better naming for HDR, non-HDR, override, and line materials
    this._materials = {};
    this._materialsNonHDR = {};

    // Surface material properties
    this._exposureBias = 0.0;
    this._tonemapMethod = 0;
    this._envMapExposure = 1;
    this._envRotationSin = 0.0;
    this._envRotationCos = 1.0;
    this._reflectionMap = null;
    this._irradianceMap = null;
    this._cutplanes = [];
    this._mrtNormals = false;
    this._mrtIdBuffer = undefined;
    this._polygonOffsetOn = false;

    // Line material properties
    this._pixelsPerUnit = 1.0;
    this._lineStyleTex = null;
    this._swapBlackAndWhite = 0.0;
    this._grayscaleLines = 0.0;
    this._depthWriteTransparent = true;
    this._needsTwoSided = false;
    this._hasTransparentMaterial = false;
    this.hasPrism = false;
    this._forceDoubleSided = false;

    // all indexed by modelId
    this._layerMaskTextures = [];
    this._layerMaps = [];
    this._selectionTextures = {}; // yes, an object and not an array.

    // Internal textures used by PrismWood material
    this._prismWoodTextures = undefined;

    this.defaultMaterial = new THREE.MeshPhongMaterial({
                    color: 0x777777,
                    specular: 0x333333,
                    shininess: 30,
                    reflectivity: 0
                });

    //Register the default material
    this.addMaterial("__defaultMaterial__", this.defaultMaterial);

    // Create texture with different line patterns used by line shader for line styles (dashed / dotted etc.)
    this.initLineStyleTexture();

    this.refCount = 0;
}

// Material and texture management

MaterialManager.prototype.dtor = function() {

    this.cleanup();
    THREE.Cache.clear();
    
    this._renderer = null;
};

MaterialManager.prototype._getModelHash = function (model) {
    const modelId = model && (typeof model === 'number' ? model : model.id);
    return 'model:' + (modelId ? modelId : '') + '|';
};

MaterialManager.prototype._getMaterialHash = function(model, name) {

    // OTG-models have sharable materials with globally unique names. For these, we
    // do not use per-model prefixes.
    if (model && model.isOTG()) {
        // Just return identity, because name is already unique.
        return name;
    }

    return this._getModelHash(model) + 'mat:' + name;
};

MaterialManager.prototype._getTextureHash = function(model, imageUri, mapName) {
    //TODO : It's possible that a texture is used as bitmap and bumpmap. In this situation,
    //if the bitmap is loaded first, the bumpscale won't be updated. To fix this, I added the
    //definition as part of the key. This is a easy fix but will make the texture loaded twice.
    //Ideally, we need to improve the current cache to save the texture properties like matrix,
    //invert flag, separately, because a texture can be used in many places and each of them can
    //have different properties.
    return this._getModelHash(model) + 'tex:' + imageUri + '|map:' + mapName;
};

/**
 * Adds surface material without HDR properties.
 * @param {string} name Unique material name.
 * @param {THREE.ShaderMaterial} mat Surface material.
 */
MaterialManager.prototype.addNonHDRMaterial = function(name, mat) {
    if (!mat.doNotCut)
        mat.cutplanes = this._cutplanes;
    this._applyMRTFlags(mat);

    this._materialsNonHDR[name] = mat;
};

/**
 * Remove material without HDR properties.
 * @param {string} name Unique material name.
 */
MaterialManager.prototype.removeNonHDRMaterial = function(name) {
    delete this._materialsNonHDR[name];
};

/**
 * Same as addNonHDRMaterial, used for backwards API compatiblity
 * @param name
 * @param mat
 */
MaterialManager.prototype.addMaterialNonHDR = function(name, mat) {
    this.addNonHDRMaterial(name, mat);
};

/**
 * Adds surface material with HDR properties.
 * @param {string} name Unique material name.
 * @param {THREE.ShaderMaterial} mat Surface material.
 */
MaterialManager.prototype.addHDRMaterial = function(name, mat) {
    if (this._reflectionMap && !mat.disableEnvMap)
        mat.envMap = this._reflectionMap;
    if (this._irradianceMap)
        mat.irradianceMap = this._irradianceMap;
    mat.exposureBias = Math.pow(2.0, this._exposureBias);
    mat.tonemapOutput = this._tonemapMethod;
    mat.envMapExposure = this._envMapExposure;
    mat.envRotationSin = this._envRotationSin;
    mat.envRotationCos = this._envRotationCos;

    this._applyCutPlanes(mat);
    this._applyMRTFlags(mat);
    this._applyPolygonOffset(mat, this._polygonOffsetOn);

    this._materials[name] = mat;
};

/**
 * Makes sure that cutPlanes and side props of a material are set according to the currently set cutplanes.
 * Note that this is no only necessary for new materials or if cutplane count changes between 0 and !=0.
 */
MaterialManager.prototype._applyCutPlanes = function(mat) {

    if (mat.doNotCut) {
        mat.cutplanes = null;
        return;
    }

    mat.cutplanes = this._cutplanes;

    // Actually, we only have to recompile if the material is new or cutplanes change between 0 and !=0.
    // But, this function is only called in these cases anyway, so we don't optimize anything if we check here again.
    mat.needsUpdate = true;

    // Make sure that we render two-sided if cutplanes are used.
    var needCutPlanes = (this._cutplanes && this._cutplanes.length > 0);
    if (needCutPlanes) {
        mat.side = THREE.DoubleSide;
    } else if (!this._needsTwoSided && !mat.is2d && !this._forceDoubleSided) {
        // The code below sets material back to FrontSide. 
        // Problem here is the implicit assumption that this recovers the original value.
        // E.g., it is not true for 2d materials - which are always double-sided (see create2dMaterial)
        // We need some cleaner concept here to always guarantee that we only set FrontSide if this was originally 
        // intended for the material.
        mat.side = THREE.FrontSide;
    }
}

MaterialManager.prototype.addMaterial = function(name, mat, skipSimplePhongHeuristics) {

    var isPrism = (mat.prismType && mat.prismType.indexOf("Prism") !== -1);

    this.hasPrism = isPrism || this.hasPrism;

    MaterialConverter.applyAppearanceHeuristics(mat, isPrism || skipSimplePhongHeuristics, this.isDepthWriteTransparentEnabled());

    if (mat.side === THREE.DoubleSide) {
        this._needsTwoSided = true;
    }

    this.addHDRMaterial(name, mat);
};

/**
 * Adds line material for use in 2D drawings.
 * @param {string} name Unique material name.
 * @param {THREE.ShaderMaterial} lineMaterial Line material.
 */
MaterialManager.prototype.addLineMaterial = function(name, lineMaterial, modelId) {

    var layerTex = (modelId && this._layerMaskTextures[modelId]);
    if (layerTex) {
        lineMaterial.defines["HAS_LAYERS"] = 1;
        lineMaterial.uniforms["tLayerMask"].value = layerTex;
    }

    if (lineMaterial.hasLineStyles) {
        lineMaterial.defines["HAS_LINESTYLES"] = 1;
        lineMaterial.defines["MAX_LINESTYLE_LENGTH"] = this._lineStyleTex.image.width;
        lineMaterial.uniforms["tLineStyle"].value = this._lineStyleTex;
        lineMaterial.uniforms["vLineStyleTexSize"].value.set(this._lineStyleTex.image.width, this._lineStyleTex.image.height);
    }

    lineMaterial.uniforms["swap"].value = this._swapBlackAndWhite;
    lineMaterial.uniforms["grayscale"].value = this._grayscaleLines;

    if (!lineMaterial.doNotCut) {
        lineMaterial.cutplanes = this._cutplanes;
    }

    this._updatePixelScaleForMaterial(lineMaterial);

    this._materials[name] = lineMaterial;

    this._applyMRTFlags(lineMaterial);
};

/**
 * Override materials may contain multiple variants (e.g. with/without instancing).
 *
 * This method is like addMaterialNonHDR, but allows custom variants of
 * this material - which are added as well.
 *
 * Requirement:
 *  Custom variants of an override material m must be available in array property
 *  called m.variants. If there is no such array, the behavior is identical with addMaterialNonHDR.
 *
 * @param {string}         name
 * @param {THREE.Material} material
 */
MaterialManager.prototype.addOverrideMaterial = function(name, mat) {
    // Add the main (default) override material
    this.addNonHDRMaterial(name, mat);

    // If there is just one variant of the override material, we are done.
    if (!mat.variants) {
        return;
    }

    // For each alternative variant of this material...
    for (var i = 0; i < mat.variants.length; i++) {
        var variant = mat.variants[i];
        if (!variant) {
            continue;
        }
        // Add custom variant with varied name
        var variantName = name + "_variant_" + i;
        this.addNonHDRMaterial(variantName, variant);
    }
};

/**
 * Returns a cloned version of the given material that has support for instancing or per-vertex ids.
 *
 *  The returned material is owned and cached by MaterialManager. It must be associated with a RenderModel
 *  (specified via svfPath) to make sure that it is disposed later with the other materials of this RenderModel.
 *
 *    @param {THREE.Material}   srcMaterial
 *    @param {MATERIAL_VARIANT} variant     - see MATERIAL_VARIANT enum
 *    @param {RenderModel}      model       - determines to which RenderModel the material belongs.
 *                                            this is important to control when the material is disposed.
 */
MaterialManager.prototype.getMaterialVariant = function(srcMaterial, variant, model) {

    // Check if srcMaterial is sharable or owned by a single render model. If shared, the variant will be shared as well.
    var isShared = !!srcMaterial.hash;

    // Create unique name for the new material variant.
    //  - If srcMaterial is not shared, prefix it with model-id string, so that the material will be disposed when RenderModel is removed.
    //  - If srcMaterial is shared, use global srcMaterial hash instead, so that the material variant can be shared by multiple RenderModels.
    var prefix = (isShared ? srcMaterial.hash : this._getModelHash(model) + srcMaterial.id);
    var matName = prefix + '|' + variant;

    var result = this._materials[matName];
    if (!result) {
        // Create cloned material
        result = this.cloneMaterial(srcMaterial, model);

        // Apply variation
        if (variant === MATERIAL_VARIANT.INSTANCED) {
            result.useInstancing = true;
            // IDs are actually provided per instance, but for the shader, it makes no difference.
            result.vertexIds     = true;
        } else if (variant === MATERIAL_VARIANT.VERTEX_IDS) {
            result.vertexIds = true;
        }

        this.addHDRMaterial(matName, result);
    }

    // For shared materials, we must track which RenderModels are using them. This is needed to dispose them
    // in when they are not used anymore. (see this.cleanup)
    if (isShared) {
        this._addMaterialRef(result, model.id);
    }

    return result;
};


/**
 * Adds intancing support for override materials: It attaches an alternative variant
 * with instancing support, which is used by WebGLRenderer to render instanced shapes correctly.
 *
 *  NOTE: This function can only be used for simple override materials that have no
 *        other alternative variants yet.
 *
 *   @param {THREE.Material} material
 */
MaterialManager.prototype.addInstancingSupport = function(material) {

    // create material clone with instancing
    var instMat = material.clone();
    instMat.useInstancing = true;
    instMat.packedNormals = material.packedNormals;

    var wideLinesMat = material.clone();
    wideLinesMat.wideLines = true;
    wideLinesMat.packedNormals = material.packedNormals;

    // Make this available as variant. Note that we generally store
    // material variants as an array member mat.variants, so that we have a uniform way to find them
    // (e.g. see MaterialManager.addOverrideMaterial), no matter if there are more variants or just one.
    material.variants = [instMat, wideLinesMat];

    // Make WebGLRenderer use the instancing material where needed
    material.getCustomOverrideMaterial = function(shapeMaterial) {
        if (shapeMaterial.useInstancing) {
            // use override material with instancing
            return this.variants[0];
        }
        if (shapeMaterial.wideLines) {
            this.variants[1].linewidth = shapeMaterial.linewidth;
            return this.variants[1];
        }
        // use default
        return null;
    };
};

/**
 * Adds support for compact buffer layout to the material
 *
 *  NOTE: This function can only be used for simple override materials that have no
 *        other alternative variants yet.
 *
 *   @param {THREE.Material} material
 */
MaterialManager.prototype.addCompactLayoutSupport = function(material) {

    var cloneMaterial = function(m) {
        var c = m.clone();
        // Share the selection texture and layer mask among variants
        if (material.uniforms.tSelectionTexture.value)
            c.uniforms.tSelectionTexture.value = material.uniforms.tSelectionTexture.value;
        if (material.uniforms.tLayerMask.value)
            c.uniforms.tLayerMask.value = material.uniforms.tLayerMask.value;
        c.is2d = material.is2d;
        c.supportsViewportBounds = material.supportsViewportBounds;
        c.modelScale = material.modelScale;
        c.defines = Object.assign({}, material.defines);
        c.attributes = Object.assign({}, material.attributes);
        return c;
    };

    // create material clone with instancing
    var compactMat = cloneMaterial(material);
    compactMat.defines["UNPACK_POSITIONS"] = 1;

    var instMat = cloneMaterial(material);
    instMat.defines["USE_INSTANCING"] = 1;

    var compactInstMat = cloneMaterial(material);
    compactInstMat.defines["UNPACK_POSITIONS"] = 1;
    compactInstMat.defines["USE_INSTANCING"] = 1;

    // Make this available as variant. Note that we generally store
    // material variants as an array member mat.variants, so that we have a uniform way to find them
    // (e.g. see MaterialManager.addOverrideMaterial), no matter if there are more variants or just one.
    material.variants = [compactMat, instMat, compactInstMat];

    // Make WebGLRenderer use the instancing material where needed
    material.getCustomOverrideMaterial = function(shapeMaterial) {
        if (shapeMaterial.defines) {
            // Use override with appropriate flags
            var index = (shapeMaterial.defines["UNPACK_POSITIONS"] ? 1 : 0) +
                (shapeMaterial.defines["USE_INSTANCING"] ? 2 : 0);
            if (index > 0)
                return this.variants[index - 1];
        }
        // use default
        return null;
    };
};


/**
 * Removes material from the manager.
 * @param {string} name Unique material name.
 */
MaterialManager.prototype.removeMaterial = function(name) {
    delete this._materials[name];
};

/**
 * Finds material by name.
 * @param {RenderModel} [model] Optional model in which to look for the material.
 * @param {string} name Material name.
 * @returns Desired material, or undefined if not found.
 */
MaterialManager.prototype.findMaterial = function(model, name) {
    var hname = this._getMaterialHash(model, name);
    var mat = this._materials[hname];
    return mat;
};

MaterialManager.prototype.convertSharedMaterial = async function(model, matObj, matHash) {

    // check if material is already known from another RenderModel
    var surfaceMat = this.findMaterial(model, matHash);

    if (!surfaceMat) {
        surfaceMat = await this.convertOneMaterial(model, matObj, matHash);
        surfaceMat.hash = matHash;
    }

    // for shared materials, track which RenderModels are using it.
    this._addMaterialRef(surfaceMat, model.id);

    return surfaceMat;
};

MaterialManager.prototype.convertOneMaterial = async function(model, matObj, matName) {    

    var isPrism = MaterialConverter.isPrismMaterial(matObj);
    if (isPrism) {
        await MaterialConverter.loadMaterialConverterPrismLibrary();
    }

    var svf = model.getData();
    var sceneUnit = (svf && svf.materials) ? svf.materials.scene.SceneUnit : "inch";
    // Set the prism wood textures for this MaterialManager, and save the old ones
    var woodTextures = isPrism && MaterialConverter.swapPrismWoodTextures(this._prismWoodTextures);
    if (woodTextures) {
        // We don't expect there to ever be wood textures outside of the material manager
        // but if an application calls MaterialConverter.convertMaterial directly this can happen.
        logger.warn("Unexpected wood textures converting a material");
    }
    // gets material, or grout material if tiling is found
    var surfaceMat = await MaterialConverter.convertMaterial(matObj, sceneUnit);

    // We obey the double-sided global flag, but have asked ATF to minimize its use in the future.
    // Unnecessarily setting this to true wastes GPU cycles by processing hidden geometry.
    //TODO: it sucks to have this hack here, but it's the last place where we have the model
    //available to check the global double sided flag.
    if (svf.doubleSided)
        surfaceMat.side = THREE.DoubleSide;

    // last thing: add material to the materials array, performing any special processing needed.
    this.addMaterial(matName, surfaceMat);

    // Note if any material added this way is transparent. This property can be used to shortcut various
    // refreshes, etc. This must be done in this method, not addMaterial itself, as the default _fadeMaterial
    // is transparent. We care only about objects' materials here.
    this._hasTransparentMaterial = this._hasTransparentMaterial || surfaceMat.transparent;

    // Process tiling, if any
    if ( MaterialConverter.hasTiling(matObj) ) {
        // The decals system is used for both tilings and decals:
        //   draw the grout (underlying) surface material fully
        //   draw all the tiles, composited atop
        //   draw all the decals, composited atop
        // Tilings are applied, one by one, then decals.
        surfaceMat.decals = [];

        // extract the tile descriptions from the matObj into an array
        var innerMats = matObj['materials'];
        var globalTile = innerMats[matObj['userassets'][0]];
        let materialIndices = globalTile.properties.references.base_materials.connections;
        let tileIndices = globalTile.properties.references.tiles.connections;
        let inputTiles = [];
        // put tiles in list into inputTiles, and generate output materials for each into the decals list
        for ( let i = 0; i < tileIndices.length; i++ ) {
            let innerTile = innerMats[tileIndices[i]];
            inputTiles.push(innerTile);
            // add a decal material for each tile, which gets parameters added to by materialTilingPattern.
            var material = await MaterialConverter.convertMaterial(matObj, sceneUnit, null, materialIndices[i] );
            material.useTiling = true;
            // Make it transparent for AA to work properly - TODOTODO could make this optional, but I think it's better always on.
            // Still, doing so does cost a bit of performance: blending is always more involved than simple replace.
            // If AA is off, this value can be false, for (slightly?) faster performance
            material.transparent = true;
            surfaceMat.decals.push({
                uv: 0,  // TODOTODO - assumes UV channel 0 is used - this might be wrong; hard to tell without good test data
                material: material
            });
            this.addMaterial(matName + '|tile|' + i, material);    // giving it a unique name - TODOTODO: do we need something else here?
        }

        // We have already processed the grout with convertMaterial, above.
        // Now walk through the tilings, find their related materials, put in two arrays, while also gathering the
        // global tiling information and using that to fully form the "decals" materials.
        // At this point each inputTiles element in the array will directly correspond to a material in the decals array.
        // To clarify:
        // * matObj contains the read-in ProteinMaterials.json file (it should also work on non-PRISM materials; future-proof)
        // * globalTile is a temporary object of the "tile" global information, that affects all tiles
        // * inputTiles is an array of the TilingAppearanceSchema (the individual tiles) in the matObj, for convenience;
        //   this array could be made inside materialTilingPattern, but it felt a bit more structured to just do so here.
        // * surfaceMat.decals is the list of decal material, already created above, that will then get tiling information
        //   added to them. Note no rendering changes are needed: tiles and decals are put into this same array, and are
        //   rendered and composited on top of each other, one after the other.
        // * sceneUnit - the global scene unit, used when extracting information from matObj
        MaterialConverter.materialTilingPattern(matObj, globalTile, inputTiles, surfaceMat.decals, sceneUnit);
    }

    // Process decals
    if (matObj.decals) {
        // may have been defined by a tiling
        if ( !surfaceMat.decals ) {
            surfaceMat.decals = [];
        }
        for (var di = 0, dlen = matObj.decals.length; di < dlen; di++) {
            var decal = matObj.decals[di];
            var material = await MaterialConverter.convertMaterial(decal.material, sceneUnit);
            surfaceMat.decals.push({
                uv: decal.uv || 0,
                material: material
            });
            this.addMaterial(matName + '|decal|' + di, material);
        }
    }

    /* standalone, convert decals to tiles, test code. Left here to show some sample tiling patterns and how they're set.
    // fake out: turn decals into tiles
    if (matObj.decals) {
        // 0 - diamonds (no longer supported?)
        // 1 - Hexagons 2x2 - TilingPattern-012
        // 2 - Basketweave - TilingPattern-014
        // 3 - Herringbone 3x1 - TilingPattern-006
        // 4 - Hopscotch 1/4 - TilingPattern-017
        let pattern = 3;
        let vector_a = [
            new THREE.Vector2( 1.02286470, 1.77165353 ),
            new THREE.Vector2( 2, 0 ),
            new THREE.Vector2( 2, 2 ),
            new THREE.Vector2( 1, 1 ),
            new THREE.Vector2( 1.0,-0.25 )
        ];
        let vector_b = [
            new THREE.Vector2( 2.04572940, 0.0 ),
            new THREE.Vector2( 0, 1.732051 ),
            new THREE.Vector2( 2, -2 ),
            new THREE.Vector2( 3, -3 ),
            new THREE.Vector2( 1.25,0.75 )
        ];
        let num_tiles = [3,4,4,2,2];
        // see https://wiki.autodesk.com/x/3wAjFQ for more information
        let incomingTileDescription = {tiling: null};
        incomingTileDescription.tiling = {
            // one tiling direction
            offset_vector_a: vector_a[pattern],
            offset_vector_a_x_units: "mm",   // OGS uses two units: scale_factor_x and scale_factor_y. See MaterialTilingPattern
            offset_vector_a_y_units: "mm",
            // the other tiling direction
            offset_vector_b: vector_b[pattern],
            offset_vector_b_x_units: "mm",
            offset_vector_b_y_units: "mm",
            // implied: grout_material
            // A 2D vector that specifies what 1 horizontal and 1 vertical length unit in the tiling description
            // maps to in real world units (e.g. 1 inch, 2 cm, etc.). This applies to the tile vertex coordinates and the
            // tile axis vectors a and b. In other words, this scaling only affects tile shapes. It does not scale texture
            // space, and does not affect the parameters below (inset, rounding, overall offset).
            scale_factor: new THREE.Vector2( 1,1 ),
            //scale_factor: new THREE.Vector2( 0.254, 0.254 ),    // for OGS tiling 17 testing
            scale_factor_x_units: "mm",
            scale_factor_y_units: "mm",
            // Width of each tile along its edge that should instead be grout. Note that the grout width is then 2x this size.
            inset_size: 0.0, // 0.005, // 0 * 0.4,
            inset_size_units: "mm",
            // The distance from the nearest tile edge where rounding will start. It is a scalar
            // with a specified unit.
            corner_rounding_size: 0.2, // 0.05,  // aka mInsetRadius in OGS
            corner_rounding_size_units: "mm",
            // The angle between the original tile normal and the modified (rounded) normal
            // at the edge of the tile (default unit: degrees).
            corner_rounding_angle: 45.0,
            corner_rounding_angle_units: "",
            // Offset the whole tiling in a given 2D direction, with a specified unit.
            overall_offset_vector: new THREE.Vector2( 0.0, 0.0 ),
            // Rotate the whole tiling by this angle (default unit: degrees).
            overall_rotation_angle: 0,
            overall_rotation_angle_units: "",
        };

        (surfaceMat as any).decals = [];
        let materials = [];
        if ( matObj.decals.length > num_tiles[pattern] ) {
            matObj.decals = matObj.decals.slice(0,num_tiles[pattern]);
        }
        for (var di = 0, dlen = matObj.decals.length; di < dlen; di++) {
            var decal = matObj.decals[di];
            //var material = MaterialConverter.convertMaterial(decal.material, sceneUnit);
            // CHEAT - use surface (prism) material, by making a copy of it
            var material = MaterialConverter.convertMaterial(matObj, sceneUnit);
            // needs to be at the material level so it's in "parameters"
            material.useTiling = true;
            // Controls the randomization of base material position within the tile. The possible
            // values are offset_none (points on the tile use standard UV queries as if the material was not tiled),
            // offset_within (map tile to a random position within the material, not crossing texture boundaries),
            // and offset_any (map tile to a random position within the material).
            // no randomness
            // None = 0,
            // random offset within texture
            // Bounded = 1,
            // random offset in any value
            // Uniform = 2

            // this needs to be set per tile by incoming data
            decal.randomOffsetMode = 2; //1; // 0, 1, 2
            // Per tile rotation of the underlying material UV space (not rotating the tile itself). Default unit: degrees.
            decal.rotationAngle = 0; //( di === 0 ? 10.0 : ( di === 1 ? 20.0 : 30.0 ));
            // per tile scale
            decal.vertices_units = "mm";

            // make it transparent for AA to work properly
            material.transparent = true;
            if ( di == 0 ) {
                //material.color.setRGB( 1.0, 0.0, 0.0 );
                material.opaque_albedo.setRGB( 1.0, 1.0, 1.0 );
                //material.surface_albedo.setRGB( 1.0, 0.0, 0.0 );
                // lower right
                if ( pattern === 0 ) {
                    // diamonds (no longer supported?)
                    decal.vertices = [
                        new THREE.Vector2(2.91029167, 6.67924833),
                        new THREE.Vector2(2.91029167, 5.49814606),
                        new THREE.Vector2(3.93315625, 4.90759516),
                        new THREE.Vector2(3.93315625, 6.08869743) ];
                } else if ( pattern === 1 ) {
                    // Hexagons 2x2 - TilingPattern-012
                    decal.vertices = [
                        new THREE.Vector2(1,0.86603),
                        new THREE.Vector2(0.5,1.1547),
                        new THREE.Vector2(0,0.86603),
                        new THREE.Vector2(0,0.28868),
                        new THREE.Vector2(0.5,0),
                        new THREE.Vector2(1,0.28868) ];
                } else if ( pattern === 2 ) {
                    // Basketweave - TilingPattern-014
                    decal.rotationAngle += 90;
                    decal.vertices = [
                        new THREE.Vector2(1,3),
                        new THREE.Vector2(0,3),
                        new THREE.Vector2(0,0),
                        new THREE.Vector2(1,0) ];
                } else if ( pattern === 3 ) {
                    // Herringbone 3x1 - TilingPattern-006
                    decal.vertices = [
                        new THREE.Vector2(3,1),
                        new THREE.Vector2(0,1),
                        new THREE.Vector2(0,0),
                        new THREE.Vector2(3,0) ];
                } else {
                    // Hopscotch 1/4 - TilingPattern-017
                    decal.vertices = [
                        new THREE.Vector2(1,1),
                        new THREE.Vector2(0,1),
                        new THREE.Vector2(0,0),
                        new THREE.Vector2(1,0) ];
                }
            }
            else if ( di == 1 ) {
                //material.color.setRGB( 0.0, 1.0, 0.0 );
                material.opaque_albedo.setRGB( 0.3, 0.3, 0.3 );
                //material.surface_albedo.setRGB( 0.0, 1.0, 0.0 );
                // top
                if ( pattern === 0 ) {
                    decal.vertices = [
                        new THREE.Vector2(4.95602083, 6.67924833),
                        new THREE.Vector2(3.93315625, 7.26979971),
                        new THREE.Vector2(2.91029167, 6.67924833),
                        new THREE.Vector2(3.93315625, 6.08869743) ];
                } else if ( pattern === 1 ) {
                    decal.vertices = [
                        new THREE.Vector2(2,0.86603),
                        new THREE.Vector2(1.5,1.1547),
                        new THREE.Vector2(1,0.86603),
                        new THREE.Vector2(1,0.28868),
                        new THREE.Vector2(1.5,0),
                        new THREE.Vector2(2,0.28868) ];
                } else if ( pattern === 2 ) {
                    decal.vertices = [
                        new THREE.Vector2(2,1),
                        new THREE.Vector2(1,1),
                        new THREE.Vector2(1,0),
                        new THREE.Vector2(2,0) ];
                } else if ( pattern === 3 ) {
                    // Herringbone 3x1
                    decal.rotationAngle += 90;
                    decal.vertices = [
                        new THREE.Vector2(1,4),
                        new THREE.Vector2(0,4),
                        new THREE.Vector2(0,1),
                        new THREE.Vector2(1,1) ];
                } else {
                    decal.vertices = [
                        new THREE.Vector2(1.25,1),
                        new THREE.Vector2(1,1),
                        new THREE.Vector2(1,0.75),
                        new THREE.Vector2(1.25,0.75) ];
                }
            }
            else if ( di == 2 ) {
                //material.color.setRGB( 0.0, 0.0, 1.0 );
                material.opaque_albedo.setRGB( 1.0, 0.2, 0.2 );
                //material.surface_albedo.setRGB( 0.0, 0.0, 1.0 );
                // lower left
                if ( pattern === 0 ) {
                    decal.vertices = [
                        new THREE.Vector2(4.95602083, 6.67924833),
                        new THREE.Vector2(3.93315625, 6.08869743),
                        new THREE.Vector2(3.93315625, 4.90759516),
                        new THREE.Vector2(4.95602083, 5.49814606) ];
                } else if ( pattern === 1 ) {
                    decal.vertices = [
                        new THREE.Vector2(1.5,1.7321,1,2.0207,0.5,1.7321,0.5,1.1547,1,0.86603,1.5,1.1547),
                        new THREE.Vector2(1,2.0207),
                        new THREE.Vector2(0.5,1.7321),
                        new THREE.Vector2(0.5,1.1547),
                        new THREE.Vector2(1,0.86603),
                        new THREE.Vector2(1.5,1.1547) ];
                } else if ( pattern === 2 ) {
                    decal.vertices = [
                        new THREE.Vector2(4,1),
                        new THREE.Vector2(4,2),
                        new THREE.Vector2(1,2),
                        new THREE.Vector2(1,1) ];
                }
            }
            else if ( di == 3 ) {
                //material.color.setRGB( 0.0, 0.0, 1.0 );
                material.opaque_albedo.setRGB( 1.0, 1.0, 0.2 );
                //material.surface_albedo.setRGB( 0.0, 0.0, 1.0 );
                // lower left
                if ( pattern === 1 ) {
                    decal.vertices = [
                        new THREE.Vector2(2.5,1.7321),
                        new THREE.Vector2(2,2.0207),
                        new THREE.Vector2(1.5,1.7321),
                        new THREE.Vector2(1.5,1.1547),
                        new THREE.Vector2(2,0.86603),
                        new THREE.Vector2(2.5,1.1547) ];
                } else if ( pattern === 2 ) {
                    decal.vertices = [
                        new THREE.Vector2(2,3),
                        new THREE.Vector2(1,3),
                        new THREE.Vector2(1,2),
                        new THREE.Vector2(2,2) ];
                }
            }
            (surfaceMat as any).decals.push({
                uv: 0,
                //uv: decal.uv || 0,
                material: material
            });
            this.addMaterial(matName + '|decal|' + di, material);
            materials[di] = material;
        }
        // surfaceMat.tiling is kept around, with the processed values that go into uniforms.
        MaterialConverter.materialTilingPattern(matObj.decals, incomingTileDescription.tiling, materials, sceneUnit);
    }
    */

    // Restore the old wood textures and get the current ones for this MaterialManager.
    this._prismWoodTextures = isPrism && MaterialConverter.swapPrismWoodTextures(woodTextures);
    return surfaceMat;
};


/**
 * Executes callback function for each material.
 * @param {function} callback Callback function with material and material name as parameters.
 * @param {bool} [exclude2d] - skip 2d materials
 * @param {bool} [includeVariants] - Include material variants, if any
 * @param {Object.<string,THREE.Material>} [materials] - Optional material set to iterate. Default to this._materials
 */
MaterialManager.prototype.forEach = function(callback, exclude2d, includeVariants, materials) {
    materials = materials || this._materials;
    for (var name in materials) {
        var material = materials[name];
        if (exclude2d && material.is2d) {
            continue;
        }
        callback(material, name);

        if (includeVariants && material.variants) {
            material.variants.forEach(function(m) {
                m && callback(m);
            });
        }
    }
};

/**
 * Executes callback function for each material in a model
 * @param {Autodesk.Viewing.Model} model - the model on which to iterate.
 * @param {bool} includeVariants - Include material variants, if any.
 * @param {function} callback - Callback function with material as parameter.
 */
MaterialManager.prototype.forEachInModel = function(model, includeVariants, callback) {
    const hash = this._getModelHash(model);
    // TODO: Add option to include OTG materials. Since this is so far being used only for 2D model operations
    // it's not an immediate need. See getOtgMaterials for how to identify them.

    const onMaterial = (material, name) => {
        if (name.indexOf(hash) !== -1) {
            callback(material);
        }
    };
        
    this.forEach(onMaterial, false, includeVariants);
    this.forEach(onMaterial, false, includeVariants, this._materialsNonHDR);    
};

var _result = { needsClear: false, needsRender: false, overlayDirty: false };

//Called at the beginning of every frame, to perform pending
//operations like texture updates. This function also
//has a chance to request full repaint at that time.
MaterialManager.prototype.updateMaterials = function() {

    _result.needsRender = false;

    while (this._texturesToUpdate.length)
    {
        var def = this._texturesToUpdate.pop();
        for (let slot in def.slots) {
            let mats = def.slots[slot];
            for (var i = 0; i < mats.length; i++) {
                mats[i][slot] = def.tex;
                mats[i].needsUpdate = true;

                //If there are transparent objects in the scene, this will result in them appearing darker
                //in the case when the model is still loading and we overdraw the same object on top of itself.
                //This is a tradeoff to avoid screen flashing if we set needsClear instead -- with the assumption
                //that transparent objects will tend to come later in the fragment list.
                _result.needsRender = true;
            }
        }
    }
    return _result;
};

function addMaterialToPendingTexture(def, mat, slot) {
    let mats = def.slots[slot];
    if (mats) {
        if (mats.indexOf(mat) == -1) {
            mats.push(mat);
        }
    } else {
        def.slots[slot] = [mat];
    }
}


MaterialManager.prototype.setTextureInCache = function(model, map, tex) {

    // Texture loaded successfully
    var texName = this._getTextureHash(model, map.uri, map.mapName);
    var def = this._textures[texName];

    // If the model was unloaded before the texture loaded, the texture def will no longer exist
    if (!def)
        return;

    if (!def.tex)
        def.tex = tex;

    // Set it on all materials that use it
    for (var s in def.slots) {
        var mats = def.slots[s];
        for (var i=0; i<mats.length; i++)
            mats[i][s] = tex;
    }

    // Keep track of materials that need updating on the
    // next frame. We can use this to throttle texture GPU upload
    this._texturesToUpdate.push(def);

};


MaterialManager.prototype.loadTextureFromCache = function(model, material, map, slotName) {

    var texName = this._getTextureHash(model, map.uri, map.mapName);

    var def = this._textures[texName];
    if (def) {
        //Cache entry exists

        if (def.tex) {
            //Texture is already loaded, update the material directly
            material[slotName] = def.tex;
            material.needsUpdate = true;
        } else {
            //Texture started loading but is not yet here, add the material
            //to the list of materials waiting for the texture.
            if (!def.slots[slotName])
                def.slots[slotName] = [];
            def.slots[slotName].push(material);
        }
    } else {

        //Create a blank cache entry
        var slots = {};
        slots[slotName] = [material];
        this._textures[texName] = { slots: slots, tex: null };
    }

    return !!def;
};

/** Returns all materials of the given OTG RenderModel from this manager.
 *  Note that the materials in OTG are shared, so changing a property in
 *  a returned material could affect other models.
 *   @param {RenderModel} model
 */
MaterialManager.prototype.getOtgMaterials = function(model) {
    // Returns an object containing the hash and hash index in the matKeys
    const getOtgMatData = (matHash, matKeys) => {
        const matIdx = matKeys.indexOf(matHash);
        if (matIdx !== -1) {
            return { hash: matHash, idx: matIdx };
        }

        // Check if the instanced material variant exists
        const instHash = matHash + '|' + MATERIAL_VARIANT.INSTANCED;
        const instIdx = matKeys.indexOf(instHash);
        if (instIdx !== -1) {
            return { hash: instHash, idx: instIdx };
        }

        // Check if the vertex material variant exists
        const vertHash = matHash + '|' + MATERIAL_VARIANT.VERTEX_IDS;
        const vertIdx = matKeys.indexOf(vertHash);
        if (vertIdx !== -1) {
            return { hash: vertHash, idx: vertIdx };
        }
    };

    let materials = {};
    // NOTE: Materials are shared between OTG models.
    // Even though the materials are shared,
    // we do not want to apply the doubleSided flag to global materials.
    // Example: this function will not toggle the __defaultMaterial__, __fadeMaterial__, etc. materials
    const modelData = model.getData();
    const modelMatIndices = modelData.fragments.materials;
    const matKeys = Object.keys(this._materials);
    for (let i = 0; i < modelMatIndices.length; i++) {
        const matIndex = modelMatIndices[i];
        const matHash = modelData.getMaterialHash(matIndex);
        const matData = getOtgMatData(matHash, matKeys);
        if (matData) {
            materials[matData.hash] = this._materials[matData.hash];
            matKeys.splice(matData.idx, 1);
        }
    }

    return materials;
}

/** Returns all materials of the given RenderModel from this manager
 *   @param {RenderModel} model
 *   @param [boolean] includeOTG - default false
 * @returns {Object} Contains all materials indexed by name
 */
MaterialManager.prototype.getModelMaterials = function(model, includeOTG) {
    var hash = this._getModelHash(model);

    // Materials and materials keys for this model
    let modelMaterials = {};
    const selectionMaterials = {};

    if (includeOTG && model.isOTG()) {
        modelMaterials = this.getOtgMaterials(model);
    }

    for (let m in this._materials) {
        if (m.indexOf(hash) !== -1) {
            var mat = this._materials[m];

            var isSelectionMaterial = (mat.defines && mat.defines.hasOwnProperty("SELECTION_RENDERER"));
            if (isSelectionMaterial) {
                selectionMaterials[m] = mat;
            } else {
                modelMaterials[m] = mat;
            }
        }
    }

    // Non-HDR materials
    var modelMaterialsNonHDR = {};
    for (let m in this._materialsNonHDR) {
        if (m.indexOf(hash) !== -1) {
            modelMaterialsNonHDR[m] = this._materialsNonHDR[m];
        }
    }

    // Cached textures
    var modelTextures = {};
    for (let t in this._textures) {
        if (t.indexOf(hash) !== -1) {
            modelTextures[t] = this._textures[t];
        }
    }

    return {
        mats: modelMaterials,
        selectionMats: selectionMaterials,
        matsNonHDR: modelMaterialsNonHDR,
        textures: modelTextures
    };
};

/** Removes all materials of the given RenderModel from this manager and collects them in
 *  a container object. This object can be used to import these materials into another MaterialManager.
 *   @param {RenderModel} model
 */
MaterialManager.prototype.exportModelMaterials = function(model, targetManager) {
    // Remember all model materials before cleaning up
    const materials = this.getModelMaterials(model);

    // Dispose all GPU resources for this model
    this.cleanup(model);

    return materials;
};

/** Adds all materials of a RenderModel to this MaterialManager. Note that Materials cannot
 *  be owned by multiple MaterialManagers at once.
 *   @param {Object} modelMaterials - must be obtained by a prior exportModelMaterials() call
 *                                    to this or another MaterialManager.
 */
MaterialManager.prototype.importModelMaterials = function(modelMaterials, modelId) {
    // Add materials to the new MaterialManager.
    // Note that we exploit here that material names are unique across different MaterialManagers.
    for (var m in modelMaterials.mats) {
        var mat = modelMaterials.mats[m];
        if (mat.is2d) {
            this.addLineMaterial(m, mat, modelId);
        } else {
            this.addHDRMaterial(m, mat);
        }
    }

    // Add all non-hdr materials
    for (var m in modelMaterials.matsNonHDR) {
        this.addMaterialNonHDR(m, modelMaterials.matsNonHDR[m]);
    }

    // Add all textures
    for (var t in modelMaterials.textures) {
        this._textures[t] = modelMaterials.textures[t];
    }
};

/**
 * Returns a copy of the given material. Note that textures are shared, not copied.
 * If not all textures of mat are loaded yet, the owning RenderModel is required
 * to enure that the cloned material receives the textures as well.
 *
 * @param {THREE.Material}    mat
 * @param {RenderModel}       Required if some textures might not be loaded yet.
 * @returns {THREE.Material}
 */
MaterialManager.prototype.cloneMaterial = function(mat, model) {
    var material = mat.clone();

    //Have to clone this manually, otherwise it's shared between the clones
    if (mat.defines) {
        material.defines = Object.assign({}, mat.defines);
    }

    // clone additional properties
    if (material instanceof THREE.MeshPhongMaterial || material.isPrismMaterial) {
        material.packedNormals = mat.packedNormals;
        material.exposureBias = mat.exposureBias;
        material.irradianceMap = mat.irradianceMap;
        material.envMapExposure = mat.envMapExposure;
        material.envRotationSin = mat.envRotationSin;
        material.envRotationCos = mat.envRotationCos;
        material.proteinType = mat.proteinType;
        material.proteinMat = mat.proteinMat;
        material.proteinCategories = mat.proteinCategories;
        material.tonemapOutput = mat.tonemapOutput;
        material.cutplanes = mat.cutplanes;
        material.textureMaps = mat.textureMaps;
        material.texturesLoaded = mat.texturesLoaded;
    }

    if (mat.doNotCut) {
        material.doNotCut = true;
    }

    if (mat.is2d) {
        material.is2d = true;
    }
    if (mat.disableEnvMap) {
       material.disableEnvMap = true;
    }

    if (mat.supportsViewportBounds) {
        material.supportsViewportBounds = true;
    }

    if (mat.textureMaps) {
        for (var mapName in mat.textureMaps) {
            if (mat[mapName]) {
                // texture is already loaded - we can share it right now
                material[mapName] = mat[mapName];
            } else if (model) {
                // texture loading is in progress. Make sure that the cloned
                // material receives it as well.

                // get texture name
                var mapDef = material.textureMaps[mapName];
                var texUri  = mapDef.uri;
                var sharedMapName = mapDef.mapName; //NOTE: mapName and mapDef.mapName could differ in case a physical texture is shared between e.g. the diffuse and bump maps
                var texName = this._getTextureHash(model, texUri, sharedMapName);

                // add new material to receiver list
                var texReceiverObj = this._textures[texName];
                if (!texReceiverObj) {
                    logger.error("Missing texture receiver", texName);
                } else {
                    addMaterialToPendingTexture(texReceiverObj, material, mapName);
                }
            } else {
                logger.error("Cannot connect pending texture maps because cloneMaterial was called without a model");
            }
        }
    }

    this._applyMRTFlags(material);

    return material;
};

/**
 * Sets up the THREE.Material for a fragment.
 */
MaterialManager.prototype.setupMaterial = function(model, threegeom, materialId) {

    var svf = model.getData();

    var material = this.findMaterial(model, materialId);

    // This code works around an issue with the SVF data, where geometry references
    // material definitions that are not part of the SVF (FORCE-1510)
    if (!material) {
        material = this.cloneMaterial(this.defaultMaterial, model);
        var hname = this._getMaterialHash(model, materialId);
        this._materials[hname] = material;
        logger.warn('Material (' + materialId + ') missing, using default material instead.');
    }

    // Check if this geometry is to be rendered with a line mesh
    if ( threegeom.isLines || threegeom.isWideLines || threegeom.isPoints ) {
        // Check to see if there are vertex colors
        var vertexColors = !!threegeom.attributes.color;
        // Create a new LineBasicMaterial with vertexColors true/false depending on above
        //TODO: this material also needs to be added to the materials set, but first
        //make sure this will not cause line display side effects.

        var svfmat = material;

        if (!svfmat)
            svfmat = this.defaultMaterial.clone();

        if (threegeom.isPoints) {
            material = new THREE.PointCloudMaterial(
                {
                    vertexColors: vertexColors,
                    size: threegeom.pointSize
                }
            );
        } else {
            var cache = vertexColors ? "cachedLineMaterialVC" : "cachedLineMaterial";
            material = svfmat[cache];
            if (threegeom.isWideLines) {
                if (!material) {
                    material = svfmat[cache] = new THREE.MeshBasicMaterial({ vertexColors:vertexColors });
                    material.wideLines = true;
                    threegeom.isLines = false;
                }

                material.polygonOffset = svfmat.polygonOffset;
                material.polygonOffsetFactor = svfmat.polygonOffsetFactor;
                material.polygonOffsetUnits = svfmat.polygonOffsetUnits;
                material.linewidth = svfmat.linewidth;
            } else if (!material) {
                material = svfmat[cache] = new THREE.LineBasicMaterial({ vertexColors: vertexColors });
            }
        }

        // If there are no vertex colors, default to the material color
        if(!vertexColors){
            material.color = svfmat.color;
        }

        // Save in material so we can map back from material to SVF id.
        material.svfMatId = materialId;

        // NOTE: For points, this will currently create one material per mesh - which should be improved.
        //Register it with material manager so that cutplanes get updated and it gets cleaned
        //up when the model unloads.
        var matHash = this._getMaterialHash(model, materialId + "_line_" + material.id);
        this.addMaterialNonHDR(matHash , material);

        // Use line mesh
        svf.hasLines = true;
    } else {
        
        // Save in material so we can map back from material to SVF id.
        material.svfMatId = materialId;
        MaterialConverter.applyGeometryFlagsToMaterial(material, threegeom);
    }

    return material;
};

// Track which RenderModels are using a shared material.
// Note that we don't count references per model, but just track whether a RenderModel is using the material or not.
MaterialManager.prototype._addMaterialRef = function(sharedMat, modelId) {

    // create model-id array on first ref
    if (!sharedMat._sharedBy) {
        sharedMat._sharedBy = [];
    }
    var refs = sharedMat._sharedBy;

    // don't add any model id twice
    var index = refs.indexOf(modelId);
    if (index !== -1) {
        return;
    }

    refs.push(modelId);
};

// Called if a material is not used by the given RenderModel anymore.
MaterialManager.prototype._removeMaterialRef = function(sharedMat, modelId) {

    var refs = sharedMat._sharedBy;

    // find modelId in reference list
    var index = (refs ? refs.indexOf(modelId) : -1);
    if (index !== -1) {
        // remove modeId from reference list
        refs.splice(index, 1);
    }
};

/**
 * Deallocates any material related GL objects associated with the given model.
 * !model means Deallocate all materials.
 */
MaterialManager.prototype.cleanup = function(model) {
    var hash = this._getModelHash(model);

    //Dispose all textures that were loaded as part of the given SVF
    var newTex = {};

    for (var t in this._textures) {
        var tdef = this._textures[t];
        if (t.indexOf(hash) === -1)
            newTex[t] = tdef;
        else if (tdef.tex) {
            tdef.tex.dispose();
            tdef.tex.needsUpdate = true;
        }
    }
    this._textures = newTex;

    //Remove all materials that were used by the given SVF
    var newMats = {};
    var DISPOSE_EVENT = { type: 'dispose' };

    for (var m in this._materials) {

        var mat = this._materials[m];

        // If the material was solely owned by this model, or we are disposing everything, we can dispose it.
        var disposeMat = (!model || m.indexOf(hash) !== -1);

        // If the material is shared, check if this was the last RenderModel using it
        if (mat._sharedBy) {
            if (disposeMat) {
                mat._sharedBy.length = 0;
            } else {

                // remove model from list of models that are using this material
                this._removeMaterialRef(mat, model.id);

                // if model was the last one, dispose material
                if (mat._sharedBy.length === 0) {
                    disposeMat = true;
                }
            }
        }

        if (!disposeMat) {
            newMats[m] = this._materials[m];
        } else {
            var mat = this._materials[m];
            mat.dispatchEvent(DISPOSE_EVENT);
            mat.needsUpdate = true; //in case it gets used again
            mat.envMap = null;
            if (mat.is2d) {
                // decouple from textures owned by MaterialManager
                mat.uniforms["tLayerMask"].value = null;
                mat.uniforms["tLineStyle"].value = null;

                // dispose raster texture
                var rasterTex = mat.uniforms["tRaster"];
                if (rasterTex && rasterTex.value instanceof THREE.Texture) {
                    rasterTex.value.dispose();
                    rasterTex.value.needsUpdate = true;
                }
            }
        }
    }

    this._materials = newMats;

    // cleanup non-HDR materials
    var newMatsNonHDR = {};
    for (var m in this._materialsNonHDR) {
        if (model && m.indexOf(hash) === -1) {
            newMatsNonHDR[m] = this._materialsNonHDR[m];
        } else {
            var mat = this._materialsNonHDR[m];
            mat.dispatchEvent(DISPOSE_EVENT);
            mat.needsUpdate = true; //in case it gets used again
        }
    }
    this._materialsNonHDR = newMatsNonHDR;

    // Dispose selection texture (for F2D models)
    var disposeSelectionTex = (modelId, removeKey) => {
        var selectionTex = this._selectionTextures[modelId];
        if (selectionTex) {
            selectionTex.dispose();
            selectionTex.needsUpdate = true;
            if (removeKey) delete this._selectionTextures[modelId];
        }
    };

    // dispose of prism wood textures, if there are any
    this._prismWoodTextures && MaterialConverter.disposePrismWoodTextures(this._prismWoodTextures);
    this._prismWoodTextures = undefined;

    if (model) {
        // dispose selection tex for single model
        disposeSelectionTex(model.id, true);
        delete this._layerMaskTextures[model.id];
        delete this._layerMaps[model.id];
    } else {
        // dispose all selection textures
        for (var key in this._selectionTextures) {
            if (this._selectionTextures.hasOwnProperty(key)) {
                disposeSelectionTex(key, false);
            }
        }
        this._selectionTextures = {};
        this._layerMaskTextures = {};
        this._layerMaps = {};

        this._reflectionMap = null;
        this._irradianceMap = null;
    }
};


MaterialManager.prototype.toggleDepthWriteTransparent = function(enable) {
    if (this._depthWriteTransparent != enable) {
        this._depthWriteTransparent = enable;
        // Change depth write for the transparent objects.
        this.forEach(function(mtl) {
            if (mtl.lmv_depthWriteTransparent)
                mtl.depthWrite = enable;
        }, false, true);
    }
};

MaterialManager.prototype.isDepthWriteTransparentEnabled = function() {
    return this._depthWriteTransparent;
};

// Reports whether the manager has encountered a material that needs two-sided rendering.
MaterialManager.prototype.hasTwoSidedMaterials = function() {
    return this._needsTwoSided;
};

MaterialManager.prototype.hasTransparentMaterial = function() {
    return this._hasTransparentMaterial;
};


MaterialManager.prototype.texturesLoaded = function() {
    return this._texturesToUpdate.length === 0;
};

MaterialManager.prototype.renderer = function() {
    return this._renderer;
};

// Surface material properties

/**
 * Sets exposure bias for all surface materials.
 *
 * Exposure correction of 2^exposureBias applied to rendered output color
 * before passing into the tone mapper.
 *
 * @param {number} exposureBias Exposure bias input.
 */
MaterialManager.prototype.setTonemapExposureBias = function(exposureBias) {
    this._exposureBias = exposureBias;
    var bias = Math.pow(2.0, exposureBias);
    this.forEach(function(m) {
        updateValueAndUniform(m, 'exposureBias', bias);
    }, true, true);
};

/**
 * Sets tone mapping method for all surface materials.
 * @param {number} method Tone mapping method (0: none, 1: Canon lum., 2: Canon RGB)
 */
MaterialManager.prototype.setTonemapMethod = function(method) {
    this._tonemapMethod = method;
    this.forEach(function(m) {
        m.tonemapOutput = method;
        m.needsUpdate = true;
    }, true, true);
};

/**
 * Sets env. exposure for all surface materials.
 *
 * An additional multiplier of 2^envExposure will be applied
 * to the env. map intensities, in case RGBM environment map is used.
 *
 * @param {number} envExposure Environment exposure input.
 */
MaterialManager.prototype.setEnvExposure = function(envExposure) {
    var scale = Math.pow(2.0, envExposure);
    this._envMapExposure = scale;
    this.forEach(function(m) {
        updateValueAndUniform(m, 'envMapExposure', scale);
    }, true, true);
};

/**
 * Sets env. rotation for all surface materials.
 * @param {number} rotation Relative angle in radians (-Pi..Pi).
 */
MaterialManager.prototype.setEnvRotation = function(rotation) {
    var s = this._envRotationSin = Math.sin(rotation);
    var c = this._envRotationCos = Math.cos(rotation);
    this.forEach(function(m) {
        m.envRotationSin = s;
        m.envRotationCos = c;
        m.needsUpdate = true;
    }, true, true);
};

/**
 * Sets reflection map (env. map) for all surface materials.
 * @param {THREE.Texture} map Reflection map.
 */
MaterialManager.prototype.setReflectionMap = function(map) {
    this._reflectionMap = map;
    this.forEach(function(m) {
        if (!m.disableEnvMap) {
            updateValueAndUniform(m, 'envMap', map);
        }
    }, true, true);
};

/**
 * Sets irradiance map for all surface materials.
 * @param {THREE.Texture} map Irradiance map.
 */
MaterialManager.prototype.setIrradianceMap = function(map) {
    this._irradianceMap = map;
    this.forEach(function(m) {
        updateValueAndUniform(m, 'irradianceMap', map);
    }, true, true);
};

/**
 * Sets a model's surface materials to double sided or single sided.
 * @param {boolean} enable - sets each material to double sided.
 * @param {Autodesk.Viewing.Model} model - model instance.
 */
MaterialManager.prototype.setDoubleSided = function(enable, model) {
    this._forceDoubleSided = enable; // LMV-5732 - ensure that when cutplanes are removed, single sided materials are not applied to the materials.
    let materials = {};
    if (model) {
        materials = this.getModelMaterials(model, true).mats;
    } else {
        // Use all of the materials if the model does not exist.
        materials = this._materials;
    }

    this.forEach(function (m) {
        m.side = enable ? THREE.DoubleSide : THREE.FrontSide;
        m.needsUpdate = true;
    }, true, true, materials);
}

/**
 * Sets cut planes for all materials
 * Clears any existing cutplanes and populates with the new ones
 * If empty array or undefined, cut planes will be turned off (cleared)
 * When turning on cut planes, materials are changed to double sided.
 * When turning off cut planes, material are change to front side, if
 * no double sided materials were added to the material manager.
 * Return a boolean that indicates whether materials are double or single sided.
 */
MaterialManager.prototype.setCutPlanes = function(cutplanes) {
    // Update shaders if num of planes changed
    var doubleSided = false;

    // Check if we need to recompile material shaders. This happens (only) if the cutplane count
    // changes between 0 and !=0
    var needsUpdate = this._cutplanes.length !== (cutplanes ? cutplanes.length || 0 : 0);

    // Empty array (http://jsperf.com/empty-javascript-array)
    while(this._cutplanes.length > 0) this._cutplanes.pop();

    // Copy cutplanes
    if (cutplanes) {
        for (var i = 0; i < cutplanes.length; i++) {
            this._cutplanes.push(cutplanes[i].clone());
        }
    }

    if (needsUpdate) {

        this.forEach(mat => {
            this._applyCutPlanes(mat);
            doubleSided = doubleSided || (mat.side == THREE.DoubleSide);
        }, false, true);

        for (var p in this._materialsNonHDR) {
            if (!this._materialsNonHDR[p].doNotCut)
                this._materialsNonHDR[p].needsUpdate = true;
        }
    }

    return doubleSided || this._needsTwoSided;
};

/**
 * Returns a copy of cut planes
 */
MaterialManager.prototype.getCutPlanes = function() {
    return this._cutplanes.slice();
};
/**
 * @returns {Array} The internal cutplanes array (not a copy, the actual thing)
 */
MaterialManager.prototype.getCutPlanesRaw = function() {
    return this._cutplanes;
};


MaterialManager.prototype._applyPolygonOffset = function(mat) {

    if (mat instanceof THREE.MeshPhongMaterial || mat.isPrismMaterial) {
        mat.polygonOffset = this._polygonOffsetOn;
        mat.polygonOffsetFactor = this._polygonOffsetFactor;
        mat.polygonOffsetUnits = this._polygonOffsetUnits;
        if (mat.extraDepthOffset) {
            mat.polygonOffsetFactor += mat.extraDepthOffset;
        }
        mat.needsUpdate = true;
    }
};

MaterialManager.prototype.getPolygonOffsetOn = function() {
    return this._polygonOffsetOn;
};
MaterialManager.prototype.getPolygonOffsetFactor = function() {
    return this._polygonOffsetFactor;
};
MaterialManager.prototype.getPolygonOffsetUnits = function() {
    return this._polygonOffsetUnits;
};


MaterialManager.prototype.togglePolygonOffset = function(state, factor, units) {

    this._polygonOffsetOn = state;
    this._polygonOffsetFactor = state ? (factor || 1) : 0;
    this._polygonOffsetUnits = state ? (units || 0.1) : 0; // 1.0 is much too high, see LMV-1072; may need more adjustment

    var scope = this;

    this.forEach(function(mat) {
        scope._applyPolygonOffset(mat);
    }, false, true);
};


MaterialManager.prototype._applyMRTFlags = function(mat) {

    // Activating MRTNormals requires the existence of a variable geomNormals in the shader. (see final_frag.glsl)
    // E.g., for MeshBasicMaterials, setting MRTNormals would cause a compile error. Therefore,
    // we whitelist materials here that support MRT normals.
    var matSupportsMrtNormals = mat.supportsMrtNormals
        || mat instanceof THREE.MeshPhongMaterial
        || mat.isPrismMaterial
        || mat instanceof THREE.MeshBasicMaterial
        || mat instanceof THREE.LineBasicMaterial
        || mat instanceof THREE.PointCloudMaterial
        || mat instanceof THREE.PointsMaterial;


    var oldN = mat.mrtNormals;
    var oldI = mat.mrtIdBuffer;
    var hasMRT = false;
    hasMRT = this._renderer && this._renderer.supportsMRT();
    /// #endif

    // The original logic here doesnot honor the configuration from Material
    // Add extra config, if the material specify it does not need mrtNormals, we need honor that config.
    if(!mat.skipMrtNormals) {
        mat.mrtNormals = matSupportsMrtNormals && hasMRT && this._mrtNormals;
    }
    
    mat.mrtIdBuffer = hasMRT ? this._mrtIdBuffer : undefined;
    if (mat.mrtNormals !== oldN || mat.mrtIdBuffer !== oldI)
        mat.needsUpdate = true;
};

MaterialManager.prototype.toggleMRTSetting = function(flags) {
    this._mrtNormals = flags.mrtNormals;
    this._mrtIdBuffer = flags.mrtIdBuffer;
    var self = this;
    function setFlags(m) {
        self._applyMRTFlags(m);
    }
    this.forEach(setFlags, false, true);
    this.forEach(setFlags, false, true, this._materialsNonHDR);
};

/**
 * Update a material not tracked by MaterialManager according to the current MRT settings.
 * (e.g., when AO settings have changed)
 * @param {any} material 
 */
MaterialManager.prototype.adjustMaterialMRTSetting = function(material) {
    this._applyMRTFlags(material);
};

// Line material properties

MaterialManager.prototype.initLineStyleTexture = function() {
    this._lineStyleTex = createLinePatternTexture();
};

/**
 * For Vector PDF, Dashed line will be generated based on the pattern,
 * It requires this API to override the existing _lineStyleTex.
 */
MaterialManager.prototype.setLineStyleTexture = function(texture) {
    this._lineStyleTex = texture;
}

/**
 * Creates a texture where each pixel corresponds to the visibility of a 2D layer.
 * The LineShader samples the texture to determine if a geometry is visible
 * based on its layer visibility.
 */
MaterialManager.prototype.initLayersTexture = function(count, layerMap, modelId) {

    //TODO: Layer and selection textures need to contain information about all models.
    //This means that each loaded 2d model needs to have a base offset into the layer and selection
    //textures, so that we are able to highlight and determine which specific model a pixel belongs to.
    //If you fix this, you will need to worry about the id material, which isn't model specific,
    //because the RenderContext just keeps one. There are other issues with multi-model scenarios.
    //Each model has a layersMap but we only keep one, here. Also each model will call
    //this method and changed the layer mask texture, without updating materials that use
    //the texture being replaced. Use the layersMap and texture for the first model.
    //This will cause problems if the first model is transfered to a new RenderContext.

    // TODO: Once arbitrary layer texture size works
    // we can base the allocation size on the layerCount
    var tw = 256;

    // TODO: Currently the shader math is limited to
    // a square 256x256 layers mask, since it just does a
    // scale of the two layer bytes by 1/255. We would need to
    // send the height of the layer texture to do something smarter,
    // or wait for texture size query in WebGL 2.
    // var th = 0 | Math.ceil((layersList.length) / 256.0);
    var th = 256;

    // allocate data array if needed
    var layerMaskTex = this._layerMaskTextures[modelId];
    var layerMask = layerMaskTex ? layerMaskTex.image.data : new Uint8Array(tw * th);

    // reset values
    for (var l= 0, lEnd = count; l<lEnd; l++) {
        layerMask[l] = 0xff;
    }

    // alloc texture if needed
    layerMaskTex = layerMaskTex || new THREE.DataTexture(layerMask, tw, th,
        THREE.LuminanceFormat,
        THREE.UnsignedByteType,
        THREE.UVMapping,
        THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping,
        THREE.NearestFilter, THREE.NearestFilter, 0);
    layerMaskTex.generateMipmaps = false;
    layerMaskTex.flipY = false;
    layerMaskTex.needsUpdate = true;    
                                   
     
                                              
     
              

    this._layerMaskTextures[modelId] = layerMaskTex;
    this._layerMaps[modelId] = layerMap;
};

/**
 * Toggles 2D layer visibility by setting the corresponding pixel in the layers texture.
 */
MaterialManager.prototype.setLayerVisible = function(layerIndexes, visible, modelId) {
    var layerMaskTex = this._layerMaskTextures[modelId],
        layerMaskData = layerMaskTex.image.data,
        layerMap = this._layerMaps[modelId],
        mask = visible ? 0xff : 0;

    for (var i = 0; i < layerIndexes.length; ++i) {
        var layerIndex = layerIndexes[i];
        layerMaskData[layerMap[layerIndex]] = mask;
    }

    layerMaskTex.needsUpdate = true;

    this.forEach(function(m) {
        if (m.is2d) {
            m.needsUpdate = true;
        }
    });
};

/**
 * @param {number} maxObjectCount Upper boundary of all ids we can expect. Used to determine required size.
 */
MaterialManager.prototype.initSelectionTexture = function(maxObjectCount, modelId) {
    if (this._selectionTextures[modelId]) {
        return this._selectionTextures[modelId];   
    }
    var numObj = maxObjectCount || 1;

    // determine texture extents
    var tw = 4096; //NOTE: This size is assumed in the shader, so update the shader if this changes!
    var th = 0 | Math.ceil(numObj / tw);
    var p2 = 1;
    while (p2 < th)
        p2 *= 2;
    th = p2;

    // init all pixels with 0
    var selectionMask = new Uint8Array(tw*th);
    for (var i= 0; i<numObj; i++) {
        selectionMask[i] = 0;
    }

    // create texture
    var selectionTex = new THREE.DataTexture(selectionMask, tw, th,
        THREE.LuminanceFormat,
        THREE.UnsignedByteType,
        THREE.UVMapping,
        THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping,
        THREE.NearestFilter, THREE.NearestFilter, 0);
    selectionTex.generateMipmaps = false;
    selectionTex.flipY = false;
    selectionTex.needsUpdate = true;
                                   
     
                                              
     
              

    this._selectionTextures[modelId] = selectionTex;
    return selectionTex;
};


//Meshes for 2d drawings contain many objects in a single mesh.
//So we use a mask texture to pick out which object specifically
//to highlight or render in ghosted style. The shader samples this texture to deside whether
//to draw or not.
MaterialManager.prototype.highlightObject2D = function(dbId, state, modelId) {
    var tex = this._selectionTextures[modelId];
    if (tex) {
        var data = tex.image.data;

        data[dbId] = state ? 0xff : 0;

        //TODO: partial texture update using TexSubImage possible?
        tex.needsUpdate = true;
    }
};

MaterialManager.prototype._updatePixelScaleForMaterial = function (
    m,
    camera = this._camera,
    deviceWidth = this._deviceWidth,
    deviceHeight = this._deviceHeight,
    pixelsPerUnit = this._pixelsPerUnit,
    scaling = 1) {

    if (m.is2d) {
        if (m.isScreenSpace) {
            m.uniforms["size"].value.set(deviceWidth, deviceHeight);
            m.uniforms["aaRange"].value = 0.5;
            if (camera?.isPerspective) {
                // Pass parameters to calculate pixelPerUnit for each vertex
                m.uniforms["cameraPos"].value.copy(camera.position);
                const fovInRad = camera.fov * Math.PI / 180.0;
                m.uniforms["tanHalfFov"].value = Math.tan(fovInRad * 0.5)
            } else {
                m.uniforms["tanHalfFov"].value = 0; // A value of 0 signals to use the global pixelsPerUnit from uniform
            }
        } else {
            m.uniforms["aaRange"].value = 0.5 / (pixelsPerUnit * m.modelScale * scaling);
        }
        m.uniforms["pixelsPerUnit"].value = (pixelsPerUnit * m.modelScale * scaling);
    }
};


MaterialManager.prototype.updatePixelScale = function(pixelsPerUnit, deviceWidth, deviceHeight, camera) {

    this._pixelsPerUnit = pixelsPerUnit;
    this._deviceWidth = deviceWidth;
    this._deviceHeight = deviceHeight;
    this._camera = camera;

    this.forEach(m => this._updatePixelScaleForMaterial(m, camera, deviceWidth, deviceHeight, pixelsPerUnit));
};

MaterialManager.prototype.updatePixelScaleForModel = function(model, pixelsPerUnit, deviceWidth, deviceHeight, scaling, camera) {
    const modelMaterials = this.getModelMaterials(model);
    const cb = m => this._updatePixelScaleForMaterial(m, camera, deviceWidth, deviceHeight, pixelsPerUnit, scaling);
    Object.values(modelMaterials.mats).forEach(cb);
    Object.values(modelMaterials.matsNonHDR).forEach(cb);
    Object.values(modelMaterials.selectionMats).forEach(cb);
};

MaterialManager.prototype.updateSwapBlackAndWhite = function(reverse) {
    var val = this._swapBlackAndWhite = reverse ? 1.0 : 0.0;
    this.forEach(function(m) {
        if (m.is2d) {
            m.uniforms["swap"].value = val;
        }
    });
};

MaterialManager.prototype.setGrayscale = function(activate) {
    var val = this._grayscaleLines = activate ? 1.0 : 0.0;
    this.forEach(function(m) {
        if (m.is2d) {
            m.uniforms["grayscale"].value = val;
        }
    });
};

MaterialManager.prototype.updateViewportId = function(vpId) {
    this.forEach(function(m) {
        if (m.is2d) {
            m.uniforms["viewportId"].value = vpId;
            m.needsUpdate = true;
        }
    });
};

MaterialManager.prototype.create2DMaterial = function(model, material, isIdMaterial, selectionTexture, onReady) {
    var svf = model ? model.getData() : null;

    //Create a hash string of the material to see if we have
    //already created it
    var name = "__lineMaterial__";
    if (material.image)
        name += "|image:" + material.image.name;
    if (material.clip)
        name += "|clip:" + JSON.stringify(material.clip);
    if (isIdMaterial)
        name += "|id";
    if (selectionTexture)
        name += "|selection";
    if (material.skipEllipticals)
        name += "|skipEllipticals";
    if (material.skipCircles)
        name += "|skipCircles";
    if (material.skipTriangleGeoms)
        name += "|skipTriangleGeoms";
    if (material.useInstancing)
        name += "|useInstancing";
    if (material.isScreenSpace)
        name += "|isScreenSpace";
    if (material.unpackPositions)
        name += "|unpackPositions";
    if (material.hasLineStyles)
        name += "|hasLineStyles";
    if (material.compositeOperation)
        name += "|" + material.compositeOperation;
    if (material.hasOpacity)
        name += "|hasOpacity"; // LMV-5840: Apply opacity to the material.
    if (material.noIdOutput)
        name += "|noIdOutput";

    var hash = this._getMaterialHash(model, name);

    if (!this._materials.hasOwnProperty(hash))
    {
        var lineMaterial = new LineMaterial(material);

        if (isIdMaterial) {
            //Is the caller requesting the special case of
            //shader that outputs just IDs (needed when MRT not available)?
            lineMaterial.defines["ID_COLOR"] = 1;
            lineMaterial.blending = THREE.NoBlending;
        }
        else if (selectionTexture) {
            lineMaterial.uniforms["tSelectionTexture"].value = selectionTexture;
            lineMaterial.uniforms["vSelTexSize"].value.set(selectionTexture.image.width, selectionTexture.image.height);
            lineMaterial.defines["SELECTION_RENDERER"] = 1;
            this.get2dSelectionColor(lineMaterial.uniforms.selectionColor);
        }
        else {
            this.get2dSelectionColor(lineMaterial.uniforms.selectionColor);
            let hasMRT = false;
                                           
            {
                hasMRT = this.renderer() && this.renderer().supportsMRT();
            }
                     
             
                                                                                  
             
                      

            if (hasMRT) {
                //If the renderer can do MRT, enable it in the shader
                //so we don't have to draw the ID buffer separately.
                lineMaterial.mrtIdBuffer = this._mrtIdBuffer;
            }
        }

        if (!material.skipEllipticals) {
            lineMaterial.defines["HAS_ELLIPTICALS"] = 1;
        }

        if (!material.skipCircles) {
            lineMaterial.defines["HAS_CIRCLES"] = 1;
        }

        if (!material.skipTriangleGeoms) {
            lineMaterial.defines["HAS_TRIANGLE_GEOMS"] = 1;
        }

        if (material.noIdOutput) {
            lineMaterial.defines["NO_ID_OUTPUT"] = 1;
        }

        if (material.useInstancing) {
            lineMaterial.defines["USE_INSTANCING"] = 1;
        }

        if (material.unpackPositions && !isIdMaterial) {
            lineMaterial.defines["UNPACK_POSITIONS"] = 1;
        }

        if (material.msdfFontTexture) {
            lineMaterial.defines["MSDF_TEXTURE_FONT"] = 1;
        }

        if (material.imageUVTexture) {
            lineMaterial.defines["IMAGE_UV_TEXTURE"] = 1;
        }

        if (material.viewportBounds) {
            // Before the viewportBounds was set here, without cloning. That meant that changing the value of one
            // material's uniform would change the value for all materials. This could be convenient, but it's better
            // to avoid relying on this kind of side effects unless the benefit really justifies it.
            lineMaterial.uniforms["viewportBounds"].value = material.viewportBounds.clone();
            lineMaterial.defines["VIEWPORT_CLIPPING"] = 1;
        }

        if (typeof material.opacity === "number") {
            lineMaterial.uniforms["opacity"].value = material.opacity;
        }

        if (material.image) {

            var onTexLoad = function(texture, isNPOT) {

                if (!texture) {
                    if (onReady) {
                        onReady(texture, model, material);
                    }
                    return;
                }

                texture.wrapS = THREE.ClampToEdgeWrapping;
                texture.wrapT = THREE.ClampToEdgeWrapping;
                texture.minFilter = isNPOT ? THREE.LinearFilter : THREE.LinearMipMapLinearFilter;
                texture.magFilter = THREE.LinearFilter;
                texture.anisotropy = 1; // renderer.getMaxAnisotropy();
                texture.flipY = true;
                texture.generateMipmaps = true;

                texture.needsUpdate = true;

                if(!material.msdfFontTexture && !material.imageUVTexture) {
                    lineMaterial.defines["HAS_RASTER_QUADS"] = 1;
                }
                
                lineMaterial.uniforms["tRaster"].value = texture;

                lineMaterial.needsUpdate = true;
                if (onReady) {
                    onReady(texture, model);
                }
            };

            if (  (typeof HTMLCanvasElement !== "undefined" && material.image instanceof HTMLCanvasElement)
               || (typeof HTMLImageElement !== "undefined" && material.image instanceof  HTMLImageElement)) {
                var texture = new THREE.Texture( TextureLoader.imageToCanvas(material.image, material.compositeOperation == "multiply", material.compositeCanvasColor), THREE.UVMapping );
                onTexLoad(texture, true);
            } else {
                TextureLoader.loadTextureWithSecurity(material.image.dataURI, THREE.UVMapping, onTexLoad, null, svf.acmSessionId);
            }
        }

        lineMaterial.modelScale = material.modelScale || 1;

        if (material.doNotCut) {
            lineMaterial.doNotCut = true;
        }

        //Initialize to blank so that TextureLoader can trivially loop over the non-existing texture maps
        lineMaterial.textureMaps = {};

        this.addLineMaterial(hash, lineMaterial, model && model.id);
        if (isIdMaterial || selectionTexture) {
            this.addCompactLayoutSupport(lineMaterial);
        }
    }

    return name;
};

MaterialManager.prototype.set2dSelectionColor = function(color, opacity) {
    _2dSelectionColor = new THREE.Color(color);
    _2dSelectionOpacity = opacity === undefined || opacity === null ? _2dSelectionOpacity : opacity;
    this.forEach(function(material) {
        if (material.is2d && material.uniforms) {
            var selectionColor = material.uniforms.selectionColor;
            if (selectionColor) {
                setColor(selectionColor.value, _2dSelectionColor, _2dSelectionOpacity);
                material.needsUpdate = true;
            }
        }
    });
};

MaterialManager.prototype.get2dSelectionColor = function(targetUniform) {
    if (targetUniform)
        setColor(targetUniform.value, _2dSelectionColor, _2dSelectionOpacity);

    return _2dSelectionColor;
};

MaterialManager.prototype.get2dSelectionOpacity = function() {
    return _2dSelectionOpacity;
};

/**
 * Sets 2D material viewport bounds. Pixels outside of these bounds won't be rendered.
 * 
 * @param {THREE.ShaderMaterial} mat material.
 * @param {Box2} bounds viewport bounds box. Pass without bounds in order to restore original viewport values.
 */
MaterialManager.prototype.setMaterialViewportBounds = function(mat, bounds) {
    // viewportBounds is only supported by 2D materials & Leaflets.
    if (!mat.supportsViewportBounds) {
        return;
    }

    if (bounds) {
        if (!mat.defines["VIEWPORT_CLIPPING"]) {
            // `bounds` is a THREE.Box2, while the shader expects to get a Vector4.
            mat.uniforms["viewportBounds"].value = new THREE.Vector4(bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y);
            mat.defines["VIEWPORT_CLIPPING"] = 1;
            mat.needsUpdate = true;
        } else {
            mat.uniforms["viewportBounds"].value.set(bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y);
        }        
    } else { // no bounds - reset.
        if (mat.defines["VIEWPORT_CLIPPING"]) {
            delete mat.defines["VIEWPORT_CLIPPING"];
            mat.needsUpdate = true;
        }
    }
};

MaterialManager.prototype.setViewportBoundsForModel = function(model, bounds) {
    this.forEachInModel(model, false, material => {
        this.setMaterialViewportBounds(material, bounds);
    });
};