module.exports = "#include <shadowmap_decl_common>\nvarying float depth;\n#ifdef USE_SURFACE_CUTOUT_MAP\n#include <float3_average>\n#if defined( USE_SURFACE_CUTOUT_MAP )\n    uniform sampler2D surface_cutout_map;\n    uniform mat3 surface_cutout_map_texMatrix;\n    uniform bool surface_cutout_map_invert;\n#endif\nvarying vec2 vUv;\n#else\n#ifdef USE_MAP\nvarying vec2 vUv;\nuniform sampler2D map;\n#endif\n#ifdef USE_ALPHAMAP\nvarying vec2 vUvAlpha;\nuniform sampler2D alphaMap;\n#endif\n#endif\nuniform float shadowMinOpacity;\nvoid applyCutoutMaps() {\n    float opacity = 1.0;\n#ifdef USE_SURFACE_CUTOUT_MAP\n    #if defined( USE_SURFACE_CUTOUT_MAP )\n        vec2 uv_surface_cutout_map = (surface_cutout_map_texMatrix * vec3(uv, 1.0)).xy;\n        SURFACE_CUTOUT_CLAMP_TEST;\n        vec3 opacity_v3 = texture2D(surface_cutout_map, uv_surface_cutout_map).xyz;\n        if(surface_cutout_map_invert) opacity_v3 = vec3(1.0) - opacity_v3;\n        opacity = average(opacity_v3);\n    #else\n        opacity = surface_cutout;\n    #endif\n#else\n#ifdef USE_MAP\n    opacity *= GET_MAP(vUv).a;\n#endif\n#ifdef USE_ALPHAMAP\n    opacity *= GET_ALPHAMAP(vUvAlpha).r;\n#endif\n#endif\n#if defined(USE_SURFACE_CUTOUT_MAP) || defined(USE_MAP) || defined(USE_ALPHAMAP)\n    if (opacity < shadowMinOpacity) discard;\n#endif\n}\nvoid main() {\n    float normalizedLinearDepth = (depth - shadowMapRangeMin) / shadowMapRangeSize;\n    float val = exp(shadowESMConstant * normalizedLinearDepth);\n#ifdef USE_HARD_SHADOWS\n    val = normalizedLinearDepth;\n#endif\n    applyCutoutMaps();\n    gl_FragColor = vec4(val, 0, 0, 1);\n}\n";