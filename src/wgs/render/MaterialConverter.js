
import * as THREE from "three";
import { parseMaterialColor, parseMaterialScalar, parseMaterialBoolean, Get2DSimpleMapTransform} from "./MaterialConverterCommon";

const av = Autodesk.Viewing;

export let MaterialConverter = {
    convertMaterial,
    convertTexture,
    isPrismMaterial,
    convertMaterialGltf,
    applyAppearanceHeuristics,
    applyGeometryFlagsToMaterial,
    hasTiling,
    loadMaterialConverterPrismLibrary
};

function hasTiling(material) {
    var innerMats = material['materials'];
    var innerMat = innerMats[material['userassets'][0]];
    if (innerMat) {
        var definition = innerMat['definition'];
        if ( definition === 'TilingPattern' ) {
            return true;
        }
    }
    return false;
}

async function loadMaterialConverterPrismLibrary() {
    // Load the extension if the library is not present
    // For nodejs build, the converter library is bundled in
    if (!(av.MaterialConverterPrism && av.MaterialConverterPrism.convertPrismMaterial)) {
        await av.theExtensionManager.downloadExtension('Autodesk.Viewing.MaterialConverterPrism');
    }

    // Re-export those functions in MaterialConverter
    if (!MaterialConverter.convertPrismMaterial) {
        for (let func in av.MaterialConverterPrism) {
            MaterialConverter[func] = av.MaterialConverterPrism[func];
        }
    }
}

async function convertMaterial(matObj, sceneUnit, tm, index) {

    var isPrism = isPrismMaterial(matObj);

    if (isPrism) {

        await loadMaterialConverterPrismLibrary();
        
        tm = MaterialConverter.convertPrismMaterial(matObj, sceneUnit, tm, index);

        //Add the transparent flag as a top level property of the
        //Protein JSON. This is currently how the BVH builder decides
        //whether an object is transparent. See also Package.addTransparencyFlagsToMaterials
        //which is an equivalent hack done on the web worker side.
        //Normally the BVH will be built on the worker side, so this property set here is
        //probably not needed.
        matObj.transparent = tm.transparent;
        return tm;
    }

    index = index || matObj["userassets"];
    var innerMats = matObj["materials"];
    var innerMat = innerMats[index];

    var props = innerMat["properties"];

    if (!tm) {
        tm = new THREE.MeshPhongMaterial();
    } else if (!(tm instanceof THREE.MeshPhongMaterial)) {
        return null;
    } else {
        tm.needsUpdate = true;
    }

    var map, texProps;
    tm.proteinMat = matObj;
    tm.proteinCategories = innerMat.categories;
    tm.packedNormals = true;

    if (innerMat && innerMat["definition"] === "SimplePhong") {

        tm.tag = innerMat["tag"];
        tm.proteinType = innerMat["proteinType"];
        if (tm.proteinType === undefined)
            tm.proteinType = null;

        var baked_lighting = parseMaterialBoolean(props, "generic_baked_lighting", false);
        tm.disableEnvMap = baked_lighting;

        var a = tm.ambient =  parseMaterialColor(props, "generic_ambient");
        var d = tm.color =    parseMaterialColor(props, "generic_diffuse");
        var s = tm.specular = parseMaterialColor(props, "generic_specular");
        var e = tm.emissive = parseMaterialColor(props, "generic_emissive");

        tm.shininess = parseMaterialScalar(props, "generic_glossiness", 30);
        tm.opacity = 1.0 - parseMaterialScalar(props, "generic_transparency", 0);
        tm.reflectivity = parseMaterialScalar(props, "generic_reflectivity_at_0deg", 0);

        var isNormal = parseMaterialBoolean(props, "generic_bump_is_normal");
        var scale = parseMaterialScalar(props, "generic_bump_amount", 0);

        // If cannot read the scale, set the scale to 1 which is the default value for prism and protein.
        if (scale == null)
            scale = 1;

        if (isNormal) {
            if (scale > 1)
                scale = 1;
            tm.normalScale = new THREE.Vector2(scale, scale);
        }
        else {
            if (scale >= 1.0)
                scale = 0.03;
            tm.bumpScale = scale;
        }

        var isMetal = parseMaterialBoolean(props, "generic_is_metal");
        if (isMetal !== undefined)
            tm.metal = isMetal;

        var backfaceCulling = parseMaterialBoolean(props, "generic_backface_cull");
        if (backfaceCulling !== undefined && !backfaceCulling)
            tm.side = THREE.DoubleSide;

        tm.transparent = innerMat["transparent"];

        tm.textureMaps = {};
        var textures = innerMat["textures"];
        for (var texType in textures) {

            map = {};

            map.textureObj = innerMats[ textures[texType]["connections"][0] ];
            texProps = map.textureObj["properties"];
            map.textureObj.matrix = get2DMapTransform(map.textureObj, false, sceneUnit);
            
            // Grab URI
            //The uriPointer is used for transforming texture paths in material rewrite workflows
            map.uriPointer = texProps["uris"]["unifiedbitmap_Bitmap"]["values"];
            map.uri = map.uriPointer[0];
            if (!map.uri)
                continue;

            // Figure out map name

            if (texType == "generic_diffuse") {
                map.mapName = "map";

                if (!tm.color || (tm.color.r === 0 && tm.color.g === 0 && tm.color.b === 0))
                    tm.color.setRGB(1, 1, 1);
            }
            else if (texType == "generic_bump") {
                if (isNormal)
                    map.mapName = "normalMap";
                else
                    map.mapName = "bumpMap";
            }
            else if (texType == "generic_specular") {
                map.mapName = "specularMap";
            }
            else if (texType == "generic_alpha") {
                map.mapName = "alphaMap";
                tm.side = THREE.DoubleSide;
                tm.transparent = true;
            }
            // Environment maps from SVF turned off since we have better defaults
            // else if (texType == "generic_reflection") {
            //     mapName = "envMap";
            // }
            else {
                // no map name recognized, skip
                continue;
            }

            tm.textureMaps[map.mapName] = map;
        }

        //If the material is completely black, use a default material.
        if (  d.r === 0 && d.g === 0 && d.b === 0 &&
            s.r === 0 && s.g === 0 && s.b === 0 &&
            a.r === 0 && a.g === 0 && a.b === 0 &&
            e.r === 0 && e.g === 0 && e.b === 0)
            d.r = d.g = d.b = 0.4;

        // Apply extra polygon offset to material if applicable
        // larger value means further away
        tm.extraDepthOffset = parseMaterialScalar(props, "generic_depth_offset");
        if (tm.extraDepthOffset) {
            // these values are overridden after the initial render by MaterialManager.prototype.togglePolygonOffset()
            tm.polygonOffset = true;
            tm.polygonOffsetFactor = tm.extraDepthOffset;
            tm.polygonOffsetUnits = 0;
        }

    } else {
        // unknown material, use default colors
        tm.ambient = new THREE.Color(0x030303);
        tm.color = new THREE.Color(0x777777);
        tm.specular = new THREE.Color(0x333333);
        tm.shininess = 30;
        tm.shading = THREE.SmoothShading;
    }

    //Add the transparent flag as a top level property of the
    //Protein JSON. This is currently how the BVH builder decides
    //whether an object is transparent. See also Package.addTransparencyFlagsToMaterials
    //which is an equivalent hack done on the web worker side.
    //Normally the BVH will be built on the worker side, so this property set here is
    //probably not needed.
    matObj.transparent = tm.transparent;

    return tm;
}

function convertSimpleTexture(textureObj, texture) {

    if (!textureObj)
        return;

    var texProps = textureObj["properties"];

    // Note that the format of these booleans is different for Protein than for regular materials:
    // Prism: "texture_URepeat": { "values": [ false ] },
    // simple texture: "texture_URepeat":    false,
    texture.invert = parseMaterialBoolean(texProps, "unifiedbitmap_Invert");
    texture.clampS = !parseMaterialBoolean(texProps, "texture_URepeat", true);  // defaults to wrap
    texture.clampT = !parseMaterialBoolean(texProps, "texture_VRepeat", true);
    texture.wrapS = !texture.clampS ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.wrapT = !texture.clampT ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;

    texture.matrix = textureObj.matrix || (textureObj.matrix = Get2DSimpleMapTransform(texProps));
}

function get2DMapTransform(textureObj) {
    if (!textureObj.matrix) {
        textureObj.matrix = Get2DSimpleMapTransform(textureObj.properties);
    }
    return textureObj.matrix;
}

function convertTexture(textureDef, texture, sceneUnit, maxAnisotropy) {

    if (textureDef.mapName == "bumpMap" || textureDef.mapName == "normalMap") {
        texture.anisotropy = 0;
    } else {
        texture.anisotropy = maxAnisotropy || 0;
    }

    // Default params
    texture.flipY = (textureDef.flipY !== undefined) ? textureDef.flipY : true;
    texture.invert = false;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    //Per material type settings
    if (textureDef.isPrism)
        MaterialConverter.convertPrismTexture(textureDef.textureObj, texture, sceneUnit);
    else
        convertSimpleTexture(textureDef.textureObj, texture);

    // semi-fix for LMV-1832 - doesn't work for procedural wood, though.
    // if ( av.isIE11 && textureDef.isPrism ) {
    //      for (var i = 0; i < 4; i++)
    //          texture.matrix.elements[(i<2)?i:(i+1)] *= 0.5;  // elements 0,1,3,4
    // }
}


function isPrismMaterial(material) {
    var innerMats = material['materials'];
    var innerMat = innerMats[material['userassets'][0]];
    if (innerMat) {
        var definition = innerMat['definition'];
        if ( definition === 'TilingPattern' ) {
            // if first "material" is a tiling pattern, look at the grout material, which must always exist.
            var idx = innerMat.properties.references.grout_material.connections[0];
            innerMat = innerMats[idx];
            if (innerMat) {
                definition = innerMat['definition'];
            }   // else it stays TilingPattern and will fail below
        }
        return definition === 'PrismLayered' ||
            definition === 'PrismMetal' ||
            definition === 'PrismOpaque' ||
            definition === 'PrismTransparent' ||
            definition === 'PrismGlazing' ||
            definition === 'PrismWood';
    }
    return false;
}

var ALPHA_MODES = {
    OPAQUE: 'OPAQUE',
    MASK: 'MASK',
    BLEND: 'BLEND'
};

function convertMaterialGltf(matObj, svf) {
    var tm = new THREE.MeshPhongMaterial();
    tm.packedNormals = true;
    tm.textureMaps = {};
    tm.reflectivity = 0;

    var metallicRoughness = matObj.pbrMetallicRoughness || {};
    var diffuse = metallicRoughness.baseColorTexture || metallicRoughness.baseColorFactor;
    if (diffuse) {
        if (Array.isArray(diffuse)) {
            tm.color = new THREE.Color(diffuse[0], diffuse[1], diffuse[2]);
            tm.opacity = diffuse[3];
        } else if (typeof diffuse === "object") {
            //texture
            tm.color = new THREE.Color(1,1,1);
            var map = {};
            map.mapName = "map";

            var texture = svf.gltf.textures[diffuse.index];

            //Use the ID of the texture, because in MaterialManager.loadTexture, the ID
            //is mapped to the path from the asset list. The logic matches what is done
            //with SVF materials.
            map.uri = svf.gltf.images[texture.source].uri;
            map.flipY = false; //For GLTF, texture flip is OpenGL style by default, unlike Protein/Prism which is DX

            tm.textureMaps[map.mapName] = map;
        }
    }

    var metallicRoughnessTexture = metallicRoughness.metallicRoughnessTexture;
    if (metallicRoughnessTexture) {
        var map = {};
        map.mapName = "metallicRoughnessTexture";
        var texture = svf.gltf.textures[metallicRoughnessTexture.index];
        map.uri = svf.gltf.images[texture.source].uri;
        map.flipY = false;
        tm.textureMaps[map.mapName] = map;
    } else {
        tm.metalness = metallicRoughness.metallicFactor !== undefined ? metallicRoughness.metallicFactor : 1.0;
        tm.roughness = metallicRoughness.roughnessFactor !== undefined ? metallicRoughness.roughnessFactor : 1.0;
    }

    if (matObj.doubleSided === true) {
        tm.side = THREE.DoubleSide;
    }

    var alphaMode = matObj.alphaMode || ALPHA_MODES.OPAQUE;

    if (alphaMode === ALPHA_MODES.BLEND) {
        tm.transparent = true;
        tm.depthWrite = false;
    } else {
        tm.transparent = false;
        if (alphaMode === ALPHA_MODES.MASK) {
            tm.alphaTest = matObj.alphaCutoff !== undefined ? matObj.alphaCutoff : 0.5;
        }
    }

    if (matObj.normalTexture !== undefined) {
        var map = {};
        map.mapName = "normalTexture";
        var texture = svf.gltf.textures[matObj.normalTexture.index];
        map.uri = texture.source;
        map.flipY = false;
        map.uri = svf.gltf.images[texture.source].uri;
        tm.normalScale = new THREE.Vector2( 1, 1 );
        if ( matObj.normalTexture.scale !== undefined ) {
            tm.normalScale.set( matObj.normalTexture.scale, matObj.normalTexture.scale );
        }
    }

    if (matObj.occlusionTexture !== undefined) {
        var map = {};
        map.mapName = "occlusionTexture";
        var texture = svf.gltf.textures[matObj.occlusionTexture.index];
        map.uri = svf.gltf.images[texture.source].uri;
        map.flipY = false;
        tm.textureMaps[map.mapName] = map;
        if (matObj.occlusionTexture.strength !== undefined) {
            tm.aoMapIntensity = matObj.occlusionTexture.strength;
        }
    }

    if (matObj.emissiveFactor !== undefined) {
        tm.emissive = new THREE.Color().fromArray( matObj.emissiveFactor );
    }

    if (matObj.emissiveTexture !== undefined) {
        var map = {};
        map.mapName = "emissiveTexture";
        var texture = svf.gltf.textures[matObj.emissiveTexture.index];
        map.uri = svf.gltf.images[texture.source].uri;
        map.flipY = false;
        tm.textureMaps[map.mapName] = map;
    }
    return tm;
}


//Using post-gamma luminance, since input colors are assumed to
//have gamma (non-linearized).
function luminance(c) {
    return (0.299 * c.r) + (0.587 * c.g) + (0.114 * c.b);
}


function applyAppearanceHeuristics(mat, skipSimplePhongSpecific, depthWriteTransparent) {

    var proteinMaterial = mat.proteinMat ? mat.proteinMat : null;

    var isPrism = (mat.prismType && mat.prismType.indexOf("Prism") !== -1);
    if (isPrism && mat.transparent) {
        // currently Fusion objects come in as double-sided. Once ATF and Fusion fix this, they
        // can come in as single-sided. For PRISM materials that are transparent, make these
        // always be double sided, so they render properly in two passes, back and front displayed.
        // The side for PrismGlazing materials is set from glazing_backface_culling property
        // so don't override it here.
        if (mat.side === THREE.FrontSide && mat.prismType !== "PrismGlazing")
            mat.side = THREE.DoubleSide;

        // Add a flag that notes that two-pass transparency is to be used. This is meant for Fusion in
        // particular, where transparent objects are rendered in two passes, back faces then front faces.
        // This can cause problems with other, arbitrary geometry, such as found in
        // https://jira.autodesk.com/browse/LMV-1121.
        // If we want to extend this two-pass rendering method to all materials, we have to come up
        // with some rules for how to differentiate data here.
        if (mat.side === THREE.DoubleSide && mat.depthTest)
            mat.twoPassTransparency = true;
        //else
        //    mat.twoPassTransparency = false;
    }

    var maps = mat.textureMaps || {};

    //apply various modifications to fit our rendering pipeline
    if (!skipSimplePhongSpecific){

        //Is it a SimplePhong which was converted from a Prism source?
        var isSimpleFromPrism = (mat.proteinType && mat.proteinType.indexOf("Prism") !== -1);

        //This pile of crazy hacks maps the various flavors of materials
        //to the shader parameters that we can handle.

        if (mat.metal) {

            if (!mat.reflectivity) {
                mat.reflectivity = luminance(mat.specular);
            }

            //Special handling for Protein and Prism metals
            if (proteinMaterial)
            {
                //For Prism metals, reflectivity is set to 1 and
                //the magnitude of the specular component acts
                //as reflectivity.
                if (mat.reflectivity === 1)
                    mat.reflectivity = luminance(mat.specular);

                if (mat.color.r === 0 && mat.color.g === 0 && mat.color.b === 0) {
                    //Prism metals have no diffuse at all, but we need a very small
                    //amount of it to look reasonable
                    //mat.color.r = mat.specular.r * 0.1;
                    //mat.color.g = mat.specular.g * 0.1;
                    //mat.color.b = mat.specular.b * 0.1;
                }
                else {
                    //For Protein metals, we get a diffuse that is full powered, so we
                    //scale it down
                    mat.color.r *= 0.1;
                    mat.color.g *= 0.1;
                    mat.color.b *= 0.1;
                }
            }
        }
        else {
            //Non-metal materials

            if (isSimpleFromPrism)
            {
                var isMetallic = false;

                if (mat.proteinType === "PrismLayered")
                {
                    //For layered materials, the Prism->Simple translator
                    //stores something other than reflectivity in the
                    //reflectivity term. We also do special handling
                    //for paint clearcoat, and metallic paint. Longer term,
                    //the good solution is to add things we do support to the Simple
                    //representation, or failing that, support native Prism definitions.
                    mat.clearcoat = true;
                    mat.reflectivity = 0.06;

                    var cats = mat.proteinCategories;
                    if (cats && cats.length && cats[0].indexOf("Metal") != -1)
                    {
                        isMetallic = true;
                    }
                }

                //De-linearize this value in case of Prism, since there it
                //seems to be physical (unlike the color values)
                mat.reflectivity = Math.sqrt(mat.reflectivity);

                if (isMetallic)
                {
                    //metallic paint has specular = diffuse in Prism.
                    mat.specular.copy(mat.color);
                }
                else
                {
                    //Prism non-metals just leave the specular term as 1,
                    //relying on reflectivity alone, but our shader needs
                    //both in different code paths.
                    mat.specular.r = mat.reflectivity;
                    mat.specular.g = mat.reflectivity;
                    mat.specular.b = mat.reflectivity;
                }
            }
            else
            {
                //Get a reasonable reflectivity value if there isn't any
                if (!mat.reflectivity) {
                    if (mat.color.r === 1 && mat.color.g === 1 && mat.color.b === 1 &&
                        mat.specular.r === 1 && mat.specular.g === 1 && mat.specular.b === 1 &&
                        (!maps.map && !maps.specularMap))
                    {
                        //This covers specific cases in DWF where metals get diffuse=specular=1.
                        mat.metal = true;
                        mat.reflectivity = 0.7;

                        mat.color.r *= 0.1;
                        mat.color.g *= 0.1;
                        mat.color.b *= 0.1;
                    } else {

                        //General case
                        //For non-metallic materials, reflectivity
                        //varies very little in the range 0.03-0.06 or so
                        //and is never below 0.02.
                        mat.reflectivity = 0.01 + 0.06 * luminance(mat.specular);

                        //For non-metals, reflectivity is either set
                        //correctly or we estimate it above, and the specular color
                        //just carries the hue
                        //Note: Protein (but not Prism) seems to have consistently high reflectivity
                        //values for its non-metals.
                        mat.specular.r *= mat.reflectivity;
                        mat.specular.g *= mat.reflectivity;
                        mat.specular.b *= mat.reflectivity;
                    }

                } else  if (mat.reflectivity > 0.3) {
                    //If reflectivity is set explicitly to a high value, but metal is not, assume
                    //the material is metallic anyway and set specular=diffuse
                    //This covers specific cases in DWF.

                    mat.metal = true;
                    mat.specular.r = mat.color.r;
                    mat.specular.g = mat.color.g;
                    mat.specular.b = mat.color.b;

                    mat.color.r *= 0.1;
                    mat.color.g *= 0.1;
                    mat.color.b *= 0.1;
                } else {
                    //For non-metals, reflectivity is either set
                    //correctly or we estimate it above, and the specular color
                    //just carries the hue
                    //Note: Protein (but not Prism) seems to have consistently high reflectivity
                    //values for its non-metals.
                    mat.specular.r *= mat.reflectivity;
                    mat.specular.g *= mat.reflectivity;
                    mat.specular.b *= mat.reflectivity;
                }

                //For transparent non-layered materials, the reflectivity uniform is
                //used for scaling the Fresnel reflection at oblique angles
                //This is a non-physical hack to make stuff like ghosting
                //look reasonable, while having glass still reflect at oblique angles
                if (mat.opacity < 1)
                    mat.reflectivity = 1.0;
            }
        }

        //Alpha test for materials with textures that are potentially opacity maps
        if (mat.transparent ||
            ((maps.map?.uri?.toLowerCase().indexOf(".png") !== -1) ||
                                  maps.alphaMap)) {
            mat.alphaTest = 0.01;
        }
    }

    if (maps.normalMap)
    {
        var scale = mat.bumpScale;
        if (scale === undefined || scale >= 1)
            scale = 1;

        mat.normalScale = new THREE.Vector2(scale, scale);
    }
    else
    {
        if (mat.bumpScale === undefined && (maps.map || maps.bumpMap))
            mat.bumpScale = 0.03; //seems like a good subtle default if not given
        else if (mat.bumpScale >= 1) //Protein generic mat sometimes comes with just 1.0 which can't be right...
            mat.bumpScale = 0.03;
    }


    //Determine if we want depth write on for transparent materials
    //This check is done this way because for the ghosting and selection materials
    //we do not want to enable depth write regardless of what we do for the others
    //in order to get the see-through effect.
    if ((!skipSimplePhongSpecific || isPrism) && mat.transparent) {
        if (isPrism) {
            // normally set depth writing off for transparent surfaces
            mat.lmv_depthWriteTransparent = true;
            mat.depthWrite = !!depthWriteTransparent;
        } else {

            // Some models, such as Assembly_Chopper.svf, improperly are set to be transparent, even though the
            // surface opacity is 1.0.
            // Cutout textures (where opacity is also 1.0) should also not be considered transparent,
            // as far as depthWrite goes.
            if (mat.opacity >= 1.0) {
                var hasAlphaTexture = maps.alphaMap;
                // this is either a surface with a cutout texture, or a defective material definition
                if ( !hasAlphaTexture ) {
                    // defective - turn transparency off
                    mat.transparency = false;
                }
                // else cutout detected: leave transparency on, leave depthWrite on
            } else {
                // opacity is less than 1, so this surface is meant to be transparent - turn off depth depthWrite
                mat.lmv_depthWriteTransparent = true;
                mat.depthWrite = !!depthWriteTransparent;
            }
        }
    }

    if ( mat.shininess !== undefined )
    {
        //Blinn to Phong (for blurred environment map sampling)
        mat.shininess *= 0.25;
    }

    //if (mat.opacity < 1.0 || maps.alphaMap)
    //    mat.side = THREE.DoubleSide;

}



//Certain material properties only become available
//once we see a geometry that uses the material. Here,
//we modify the material based on a given geometry that's using it.
function applyGeometryFlagsToMaterial(material, threegeom) {

    if (threegeom.attributes.color) {
        //TODO: Are we likely to get the same
        //material used both with and without vertex colors?
        //If yes, then we need two versions of the material.
        material.vertexColors = THREE.VertexColors;
        material.needsUpdate = true;
    }

    //If we detect a repeating texture in the geometry, we assume
    //it is some kind of material roughness pattern and reuse
    //the texture as a low-perturbation bump map as well.
    if (!material.proteinType && threegeom.attributes.uv && threegeom.attributes.uv.isPattern) {
        var setBumpScale = false;
        if (material.map && !material.bumpMap) {
            material.bumpMap = material.map;
            material.needsUpdate = true;
            setBumpScale = true;
        }
        if (material.textureMaps && material.textureMaps.map && !material.textureMaps.bumpMap) {
            material.textureMaps.bumpMap = material.textureMaps.map;
            material.needsUpdate = true;
            setBumpScale = true;
        }
        if (setBumpScale && material.bumpScale === undefined) 
            material.bumpScale = 0.03; //seems like a good subtle default if not given
    }

}
