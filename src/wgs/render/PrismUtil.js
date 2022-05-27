import * as THREE from 'three';

// This method sets up various uniforms for a given map, putting them
// in an array called "uniforms" which are accessed by the name, such
// as "uniforms[surface_albedo_map_texMatrix]".
export function GetPrismMapUniforms(mapName) {
	var mtxName = mapName + "_texMatrix";
	var mapInvt = mapName + "_invert";

	var uniforms = {};
	uniforms[mapName] = { type: "t", value: null };
	uniforms[mtxName] = { type: "m3", value: new THREE.Matrix3() };
	uniforms[mapInvt] = { type: "i", value: 0 };

	return uniforms;
}

export let PrismUtil = {
	GetPrismMapUniforms
};