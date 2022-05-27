export function refreshUniformsIBL( uniforms, material) {
    if (uniforms.envMap)
        uniforms.envMap.value = material.envMap;
    if (uniforms.irradianceMap)
        uniforms.irradianceMap.value = material.irradianceMap;
    if (uniforms.envMapExposure)
        uniforms.envMapExposure.value = material.envMapExposure;
    if (uniforms.envRotationSin && uniforms.envRotationCos) {
        uniforms.envRotationSin.value = material.envRotationSin;
        uniforms.envRotationCos.value = material.envRotationCos;
    }
}

export function markUniformsIBLNeedsUpdate ( uniforms, boolean ) {
    if (uniforms.envMap)
        uniforms.envMap.needsUpdate = boolean;
    if (uniforms.irradianceMap)
        uniforms.irradianceMap.needsUpdate = boolean;
    if (uniforms.envMapExposure)
        uniforms.envMapExposure.needsUpdate = boolean;
}

export function refreshUniformsLmvCommon ( uniforms, material ) {
    if (Object.prototype.hasOwnProperty.call(material, 'opacity') && uniforms.opacity) {

        uniforms.opacity.value = material.opacity;

    }

    if (material.color) {

        uniforms.diffuse.value.copy(material.color);

    }

    if ( material.map ) {

        uniforms.map.value = material.map;

    }

    if ( material.lightMap ) {

        uniforms.lightMap.value = material.lightMap;
        uniforms.lightMapIntensity.value = material.lightMapIntensity;

    }

    if ( material.alphaMap ) {

        uniforms.alphaMap.value = material.alphaMap;

    }

    if ( material.alphaTest > 0 ) {

        uniforms.alphaTest.value = material.alphaTest;

    }

    if ( material.specularMap ) {

        uniforms.specularMap.value = material.specularMap;

    }

    if ( material.bumpMap ) {
        uniforms.bumpMap.value = material.bumpMap;
        uniforms.bumpScale.value = material.bumpScale;
    }

    if ( material.normalMap ) {
        uniforms.normalMap.value = material.normalMap;
        uniforms.normalScale.value.copy( material.normalScale );
    }

    // uv repeat and offset setting priorities
    //	1. color map
    //	2. specular map
    //	3. normal map
    //	4. bump map
    //  5. alpha map

    //NOTE: We deviate from Three.js in that we allow
    //separate scales for diffuse/specular, alpha, and bump

    function setTexTransforms(uniforms, texMatrix, texture) {
        var offset = texture.offset;
        var repeat = texture.repeat;

        if (texMatrix) {
            var uMatrix = texMatrix.value;

            if (texture.matrix)
                uMatrix.copy(texture.matrix);
            else
                uMatrix.identity();

            uMatrix.elements[6] += offset.x;
            uMatrix.elements[7] += offset.y;
            uMatrix.elements[0] *= repeat.x;
            uMatrix.elements[3] *= repeat.x;
            uMatrix.elements[1] *= repeat.y;
            uMatrix.elements[4] *= repeat.y;
        }
        else {
          uniforms.offsetRepeat.value.set( offset.x, offset.y, repeat.x, repeat.y );
        }
    }

    if (material.alphaMap) {
        setTexTransforms(uniforms, uniforms.texMatrixAlpha, material.alphaMap);
    }

    var uvScaleMapBump;
    if ( material.normalMap ) {
        uvScaleMapBump = material.normalMap;
    } else if ( material.bumpMap ) {
        uvScaleMapBump = material.bumpMap;
    }
    if ( uvScaleMapBump !== undefined ) {
        setTexTransforms(uniforms, uniforms.texMatrixBump, uvScaleMapBump);
    }

    var uvScaleMap;
    if ( material.map ) {
        uvScaleMap = material.map;
    } else if ( material.specularMap ) {
        uvScaleMap = material.specularMap;
    }
    if ( uvScaleMap !== undefined ) {
        setTexTransforms(uniforms, uniforms.texMatrix, uvScaleMap);
    }

    if (material.envMap) {

        uniforms.envMap.value = material.envMap;

    }

    if (uniforms.irradianceMap) {
        uniforms.irradianceMap.value = material.irradianceMap;
    }

    if ( material.reflectivity && material.envMap) {

        uniforms.reflectivity.value = material.reflectivity;
    }

    if (material.refractionRatio && material.envMap) {

        uniforms.refractionRatio.value = material.refractionRatio;

    }

}
