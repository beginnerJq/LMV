
import * as THREE from "three";

// Helper functions to parse ugly Protein JSON
export function parseMaterialColor(props, name, unused) {
    if (!props || !props["colors"])
        return new THREE.Color(1, 0, 0); //error -- return red

    var cobj = props["colors"][name];
    if (!cobj)
        return new THREE.Color(0, 0, 0); //ok -- color is not defined
        //which in the C++ LMVTK is equal to DEFAULT_COLOR, which is black

    var vals = cobj["values"];
    if (!vals || !vals.length)
        return new THREE.Color(1, 0, 0); //error

    var rgb = vals[0];
    return new THREE.Color(rgb["r"], rgb["g"], rgb["b"]);
}

export function parseMaterialScalar(props, name, undefVal) {
    if (!props || !props["scalars"])
        return undefVal;

    var vobj = props["scalars"][name];
    if (!vobj)
        return undefVal;

    return vobj["values"][0];
}

export function parseMaterialBoolean(props, name, undefVal) {
    if (!props || !props["booleans"])
        return undefVal;

    var b = props["booleans"][name];
    return b === undefined ? undefVal : b;
}

export function parseMaterialGeneric(props, category, name, undefVal) {
    if (!props || !props[category])
        return undefVal;

    var vobj = props[category][name];
    if (!vobj)
        return undefVal;

    return vobj["values"][0];
}

export function SRGBToLinearFloat(component) {
    var result = component;

    if (result <= 0.04045)
        result /= 12.92;
    else
        result = Math.pow((result + 0.055) / 1.055, 2.4);

    return result;
}

export function SRGBToLinear(color) {
    var r, g, b;

    r = SRGBToLinearFloat(color.r);
    g = SRGBToLinearFloat(color.g);
    b = SRGBToLinearFloat(color.b);

    return new THREE.Color(r, g, b);
}

export function Get2DSimpleMapTransform(texProps) {
    var uscale = parseMaterialScalar(texProps, "texture_UScale", 1);
    var vscale = parseMaterialScalar(texProps, "texture_VScale", 1);
    var uoffset = parseMaterialScalar(texProps, "texture_UOffset", 0);
    var voffset = parseMaterialScalar(texProps, "texture_VOffset", 0);
    var wangle = parseMaterialScalar(texProps, "texture_WAngle", 0);

    return { elements:[
        Math.cos(wangle) * uscale, Math.sin(wangle) * vscale, 0,
       -Math.sin(wangle) * uscale, Math.cos(wangle) * vscale, 0,
        uoffset, voffset, 1
    ]};
}

export let MaterialConverterCommon = {
    parseMaterialColor,
    parseMaterialScalar,
    parseMaterialBoolean,
    parseMaterialGeneric,
    SRGBToLinearFloat,
    SRGBToLinear,
    Get2DSimpleMapTransform
};