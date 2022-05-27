import * as THREE from "three";
import { FloatToHalf } from "./HalfFloat";
import { logger } from "../../logger/Logger";


export function CreateCubeMapFromColors(ctop, cbot) {
    var r1 = ctop.x * 255, g1 = ctop.y * 255, b1 = ctop.z * 255,
        r2 = cbot.x * 255, g2 = cbot.y * 255, b2 = cbot.z * 255;

    var pixelsTop = new Uint8Array(16);
    var pixelsBot = new Uint8Array(16);
    var pixelsSide = new Uint8Array(16);

    for (var i=0; i<4; i++) {
        pixelsTop[i*4] = r1;
        pixelsTop[i*4+1] = g1;
        pixelsTop[i*4+2] = b1;
        pixelsTop[i*4+3] = 255;

        pixelsBot[i*4] = r2;
        pixelsBot[i*4+1] = g2;
        pixelsBot[i*4+2] = b2;
        pixelsBot[i*4+3] = 255;

        // was this, which is wild: if (0 | (i / 2)) {
        if ( i > 1 ) {
            // color sides 2 and 3 with the first color
            pixelsSide[i*4] = r1;
            pixelsSide[i*4+1] = g1;
            pixelsSide[i*4+2] = b1;
            pixelsSide[i*4+3] = 255;
        }
        else {
            // color sides 0 and 1 with the second color
            pixelsSide[i*4] = r2;
            pixelsSide[i*4+1] = g2;
            pixelsSide[i*4+2] = b2;
            pixelsSide[i*4+3] = 255;
        }
    }

    var x_neg = new THREE.DataTexture( pixelsSide, 2, 2, THREE.RGBAFormat );
    var x_pos = new THREE.DataTexture( pixelsSide, 2, 2, THREE.RGBAFormat );
    var y_neg = new THREE.DataTexture( pixelsBot, 2, 2, THREE.RGBAFormat );
    var y_pos = new THREE.DataTexture( pixelsTop, 2, 2, THREE.RGBAFormat );
    var z_neg = new THREE.DataTexture( pixelsSide, 2, 2, THREE.RGBAFormat );
    var z_pos = new THREE.DataTexture( pixelsSide, 2, 2, THREE.RGBAFormat );

    var texture = new THREE.Texture(null, THREE.CubeReflectionMapping,
                                    THREE.RepeatWrapping, THREE.RepeatWrapping,
                                    THREE.LinearFilter, THREE.LinearFilter,
                                    //THREE.NearestFilter, THREE.NearestFilter,
                                    THREE.RGBAFormat);
    texture.image = [x_pos, x_neg, y_pos, y_neg, z_pos, z_neg];
    texture.needsUpdate = true;

    return texture;
}


var M = [6.0014, -2.7008, -1.7996, -1.3320,  3.1029, -5.7721, 0.3008, -1.0882,  5.6268];

function LogLuvDecode(dst, src) {

    var Le = src[2] * 255.0 + src[3];
    var Xp_Y_XYZp_y = Math.pow(2.0, (Le - 127.0) / 2.0);
    var Xp_Y_XYZp_z = Xp_Y_XYZp_y / (src[1]);
    var Xp_Y_XYZp_x = (src[0]) * Xp_Y_XYZp_z;

    var r = M[0] * Xp_Y_XYZp_x + M[3] * Xp_Y_XYZp_y + M[6] * Xp_Y_XYZp_z;
    var g = M[1] * Xp_Y_XYZp_x + M[4] * Xp_Y_XYZp_y + M[7] * Xp_Y_XYZp_z;
    var b = M[2] * Xp_Y_XYZp_x + M[5] * Xp_Y_XYZp_y + M[8] * Xp_Y_XYZp_z;

    if (r < 0) r = 0;
    if (g < 0) g = 0;
    if (b < 0) b = 0;

    dst[0] = r;
    dst[1] = g;
    dst[2] = b;
}

function RGBMEncode(dst, src, expScale) {

    var r = Math.sqrt(src[0]*expScale)*0.0625; // 1/16 = 0.0625
    var g = Math.sqrt(src[1]*expScale)*0.0625;
    var b = Math.sqrt(src[2]*expScale)*0.0625;

    var maxL = Math.max( Math.max(r, g), Math.max(b, 1e-6));
    if (maxL > 1.0)
        maxL = 1.0;

    var w = Math.ceil( maxL * 255.0 ) / 255.0;

    if (r > 1.0)
        r = 1.0;
    if (g > 1.0)
        g = 1.0;
    if (b > 1.0)
        b = 1.0;

    dst[3] = w;
    var a = 1.0 / w;

    dst[0] = r * a;
    dst[1] = g * a;
    dst[2] = b * a;
}

function RGB16Encode(dst, src, expScale) {

    var r = Math.sqrt(src[0]*expScale);
    var g = Math.sqrt(src[1]*expScale);
    var b = Math.sqrt(src[2]*expScale);

    //That's pretty unlikely to happen...
    var MAX_HALF = 65504;
    if (r > MAX_HALF)
        r = MAX_HALF;
    if (g > MAX_HALF)
        g = MAX_HALF;
    if (b > MAX_HALF)
        b = MAX_HALF;

    dst[0] = r;
    dst[1] = g;
    dst[2] = b;

}


var tmpSrc = new Float32Array(4);
var tmpDst = new Float32Array(4);

//Converts incoming environment cube maps to image format suitable for use by the shader.
export function DecodeEnvMap(map, exposure, useHalfFloat, callback) {

    if (!map.LogLuv) {
        logger.warn("Environment map expected to be in LogLuv format.");
        return;
    }

    var scale = Math.pow(2.0, exposure);

    // if `map.image` is an array, use it as it is, otherwise create an array with single item (`map.image`) in it
    var images = Array.isArray(map.image) ? map.image : [map.image];

    for (var i=0; i<images.length; i++) {

        var image = images[i];

        for (var j=0; j<image.mipmaps.length; j++) {

            var mipmap = image.mipmaps[j];

            var src = mipmap.data;

            var dst;
            if (useHalfFloat) {
                //var dst = new Float32Array(src.length / 4 * 3);
                dst = new Uint16Array(src.length / 4 * 3);
                mipmap.data = dst;
            }
            else
                dst = src.buffer;

            var m=0;

            for (var k=0; k<src.length; k+=4) {

                tmpSrc[0] = src[k] / 255.0;
                tmpSrc[1] = src[k+1] / 255.0;
                tmpSrc[2] = src[k+2] / 255.0;
                tmpSrc[3] = src[k+3] / 255.0;

                LogLuvDecode(tmpDst, tmpSrc);

                if (useHalfFloat) {
                    //Use sqrt to gamma-compress the data to help the texture filtering
                    //hardware.
                    RGB16Encode(tmpSrc, tmpDst, scale);
                    dst[m++] = FloatToHalf(tmpSrc[0]);
                    dst[m++] = FloatToHalf(tmpSrc[1]);
                    dst[m++] = FloatToHalf(tmpSrc[2]);
                } else {
                    //Temporary: decode incoming LogLUV environments and convert them
                    //to RGBM format for use by the shader. Eventually we will use half-float format
                    //instead, but that has to be better tested.
                    RGBMEncode(tmpSrc, tmpDst, scale);

                    src[k] = Math.round(tmpSrc[0] * 255.0);
                    src[k+1] = Math.round(tmpSrc[1] * 255.0);
                    src[k+2] = Math.round(tmpSrc[2] * 255.0);
                    src[k+3] = Math.round(tmpSrc[3] * 255.0);
                }
            }

        }

    }

    map.LogLuv = false;

    if (useHalfFloat) {
        map.type = THREE.HalfFloatType;
        map.format = THREE.RGBFormat;
        map.RGBM = false;
        map.GammaEncoded = true;
    }
    else
        map.RGBM = true;

    if (callback)
        callback(map);
}
