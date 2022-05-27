import * as THREE from "three";
   
    export const cloneShader = function(shader) {
        let params = {
            vertexShader:   shader.vertexShader,
            fragmentShader: shader.fragmentShader,
        };

        // only add these fields if the shader actually needs them, because keys with undefined values
        // would cause errors in THREE.Material
        if (shader.uniforms)
            params.uniforms = THREE.UniformsUtils.clone( shader.uniforms );
        if (shader.defines)
            params.defines = Object.assign({}, shader.defines);
        if (shader.extensions)
            params.extensions = Object.assign({}, shader.extensions);

        return params;
    };

    /** Create ShaderMaterial instance using a given shader specification
     *
     *   @param {Object} shader - Shader specification E.g., CopyShader. Must provide vertexShader and fragmentShader.
     *                            May provide uniforms, defines, and attributes. See CopyShader for example.
     *   @returns {THREE.ShaderMaterial}
     */
    export let createShaderMaterial = function(shader) {
        var params = cloneShader(shader);
        let material;

                                       
            // Note that these are shared, because they are usually not modified afterwards
            if (shader.attributes) params.attributes = shader.attributes;

            material = new THREE.ShaderMaterial(params);
                 
                                                     
                  
        return material;
    };

    /** Add custom macro to given material. Note that macro modification requires expensive shader recompile.
     *   @param {THREE.Material} material
     *   @param {string}         macroName
     *   @param {string}         [macroValue=""]
     **/
    export let setMacro = function(material, macroName, macroValue) {

        // default to "" (for simple toggles)
        macroValue = macroValue || "";

        // create defines object if needed
        if (!material.defines) {
            material.defines = {};
        }

        // change macro and trigger update if needed
        if (material.defines[macroName]!=macroValue) {
            material.defines[macroName] = macroValue;
            material.needsUpdate = true;
        }
    };

    /** Remove custom macro to given material. Note that macro modification requires expensive shader recompile.
     *   @param {THREE.Material} material
     *   @param {string}         macroName
     **/
    export let removeMacro = function(material, macroName) {

        // skip material update if nothing changed
        if (material.defines || material.defines[macroName]) {

            // Note that we cannot just assign undefined here, because this would
            // produce a "#define <MACRONAME> undefined" string in the shader (see FireFlyWebGlProgram.js)
            // Fortunately, removing macros doesn't happen per-frame, and it requires shader-recompile anyway.
            delete material.defines[macroName];

            material.needsUpdate = true;
        }
    };


export const ShaderUtils = {
    cloneShader,
    createShaderMaterial,
    setMacro,
    removeMacro
};