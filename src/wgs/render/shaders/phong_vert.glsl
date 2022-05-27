module.exports = "varying vec3 vViewPosition;\n#ifndef FLAT_SHADED\nvarying vec3 vNormal;\n#endif\n#if defined( USE_MAP ) || defined( USE_SPECULARMAP )\nvarying vec2 vUv;\nuniform mat3 texMatrix;\n#endif\n#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP )\nvarying vec2 vUvBump;\nuniform mat3 texMatrixBump;\n#endif\n#if defined( USE_ALPHAMAP )\nvarying vec2 vUvAlpha;\nuniform mat3 texMatrixAlpha;\n#endif\n#if defined( USE_ENVMAP )\n#if ! defined( USE_BUMPMAP ) && ! defined( USE_NORMALMAP )\nuniform float refractionRatio;\n#endif\n#endif\n#if MAX_SPOT_LIGHTS > 0 || NUM_CUTPLANES > 0\nvarying vec3 vWorldPosition;\n#endif\n#ifdef USE_COLOR\nvarying vec3 vColor;\n#endif\n#ifdef MRT_NORMALS\nvarying float depth;\n#endif\n#include <pack_normals>\n#include <instancing_decl_vert>\n#include <id_decl_vert>\n#include <wide_lines_decl>\n#include <shadowmap_decl_vert>\nvoid main() {\n#if defined( USE_MAP ) || defined( USE_SPECULARMAP )\n    vUv = (texMatrix * vec3(uv, 1.0)).xy;\n#endif\n#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP )\n    vUvBump = (texMatrixBump * vec3(uv, 1.0)).xy;\n#endif\n#if defined( USE_ALPHAMAP )\n    vUvAlpha = (texMatrixAlpha * vec3(uv, 1.0)).xy;\n#endif\n#ifdef USE_COLOR\n#ifdef GAMMA_INPUT\n    vColor = color * color;\n#else\n    vColor = color;\n#endif\n#endif\n#ifdef UNPACK_NORMALS\n    vec3 objectNormal = decodeNormal(normal);\n#else\n    vec3 objectNormal = normal;\n#endif\n#ifdef FLIP_SIDED\n    objectNormal = -objectNormal;\n#endif\n    objectNormal = getInstanceNormal(objectNormal);\n    vec3 instPos = getInstancePos(position);\n    vec3 transformedNormal = normalMatrix * objectNormal;\n#ifndef FLAT_SHADED\n    vNormal = normalize( transformedNormal );\n#endif\n    vec4 mvPosition = modelViewMatrix * vec4( instPos, 1.0 );\n    gl_Position = projectionMatrix * mvPosition;\n#include <wide_lines_vert>\n    vViewPosition = -mvPosition.xyz;\n#if MAX_SPOT_LIGHTS > 0 || NUM_CUTPLANES > 0\n    vec4 worldPosition = modelMatrix * vec4( instPos, 1.0 );\n    vWorldPosition = worldPosition.xyz;\n#endif\n#ifdef MRT_NORMALS\n    depth = mvPosition.z;\n#endif\n#include <shadowmap_vert>\n#include <id_vert>\n}\n";