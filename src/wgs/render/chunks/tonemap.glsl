module.exports = "\nfloat luminance_post(vec3 rgb) {\n    return dot(rgb, vec3(0.299, 0.587, 0.114));\n}\nfloat luminance_pre(vec3 rgb) {\n    return dot(rgb, vec3(0.212671, 0.715160, 0.072169));\n}\nvec3 xyz2rgb(vec3 xyz) {\n    vec3 R = vec3( 3.240479, -1.537150, -0.498535);\n    vec3 G = vec3(-0.969256,  1.875992,  0.041556);\n    vec3 B = vec3( 0.055648, -0.204043,  1.057311);\n    vec3 rgb;\n    rgb.b = dot(xyz, B);\n    rgb.g = dot(xyz, G);\n    rgb.r = dot(xyz, R);\n    return rgb;\n}\nvec3 rgb2xyz(vec3 rgb) {\n    vec3 X = vec3(0.412453, 0.35758, 0.180423);\n    vec3 Y = vec3(0.212671, 0.71516, 0.0721688);\n    vec3 Z = vec3(0.0193338, 0.119194, 0.950227);\n    vec3 xyz;\n    xyz.x = dot(rgb, X);\n    xyz.y = dot(rgb, Y);\n    xyz.z = dot(rgb, Z);\n    return xyz;\n}\nvec3 xyz2xyY(vec3 xyz) {\n    float sum = xyz.x + xyz.y + xyz.z;\n    sum = 1.0 / sum;\n    vec3 xyY;\n    xyY.z = xyz.y;\n    xyY.x = xyz.x * sum;\n    xyY.y = xyz.y * sum;\n    return xyY;\n}\nvec3 xyY2xyz(vec3 xyY) {\n    float x = xyY.x;\n    float y = xyY.y;\n    float Y = xyY.z;\n    vec3 xyz;\n    xyz.y = Y;\n    xyz.x = x * (Y / y);\n    xyz.z = (1.0 - x - y) * (Y / y);\n    return xyz;\n}\nfloat toneMapCanon_T(float x)\n{\n    float xpow = pow(x, 1.60525727);\n    float tmp = ((1.05542877*4.68037409)*xpow) / (4.68037409*xpow + 1.0);\n    return clamp(tmp, 0.0, 1.0);\n}\nconst float Shift = 1.0 / 0.18;\nfloat toneMapCanonFilmic_NoGamma(float x) {\n    x *= Shift;\n    const float A = 0.2;\n    const float B = 0.34;\n    const float C = 0.002;\n    const float D = 1.68;\n    const float E = 0.0005;\n    const float F = 0.252;\n    const float scale = 1.0/0.833837;\n    return (((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F) * scale;\n}\nvec3 toneMapCanonFilmic_WithGamma(vec3 x) {\n    x *= Shift;\n    const float A = 0.27;\n    const float B = 0.29;\n    const float C = 0.052;\n    const float D = 0.2;\n    const float F = 0.18;\n    const float scale = 1.0/0.897105;\n    return (((x*(A*x+C*B))/(x*(A*x+B)+D*F))) * scale;\n}\nvec3 toneMapCanonOGS_WithGamma_WithColorPerserving(vec3 x) {\n    vec3 outColor = x.rgb;\n    outColor = min(outColor, vec3(3.0));\n    float inLum = luminance_pre(outColor);\n    if (inLum > 0.0) {\n        float outLum = toneMapCanon_T(inLum);\n        outColor = outColor * (outLum / inLum);\n        outColor = clamp(outColor, vec3(0.0), vec3(1.0));\n    }\n    float gamma = 1.0/2.2;\n    outColor = pow(outColor, vec3(gamma));\n    return outColor;\n}\n";