import { GlobalManagerMixin } from '../application/GlobalManagerMixin';

export class LightPresetThumbnails {

    constructor(width, height) {
        this._width = width || 60;
        this._height = height || 60;
    }

    /**
     * Generates a thumbnail from a preset.
     * 
     * @param {*} lightPreset - Object describing a lightPreset (such as 'Simple Grey' or 'Sharp Highlights').
     * @returns {Promise} Resolves with a string URL containing the image. Can be assigned to <image>.src
     */
    createThumbnail(preset, calback) {

        return new Promise((resolve) => {
    
            var _document = this.getDocument();
            var _canvas = _document.createElement('canvas');
            _canvas.width = this._width;
            _canvas.height = this._height;
    
            var ctx = _canvas.getContext('2d');

            // Create a linear gradient (top to bottom)
            var gradient = ctx.createLinearGradient(0,0, 0, _canvas.height);
            var pcg = preset.bgColorGradient; // Array with 6 elements
            var colorTop = getHexColor(pcg[0], pcg[1], pcg[2]);
            var colorBtm = getHexColor(pcg[3], pcg[4], pcg[5]);
            gradient.addColorStop(0, colorTop);
            gradient.addColorStop(1, colorBtm);
            ctx.fillStyle = gradient;
            ctx.fillRect(0,0,_canvas.width, _canvas.height);
        
            _canvas.toBlob(function(blob){
                var url = URL.createObjectURL( blob );
                resolve(url);
            });
        });
    }
}

GlobalManagerMixin.call( LightPresetThumbnails.prototype );


/**
 * @param {number} r - Range 0..255
 * @param {number} g - Range 0..255
 * @param {number} b - Range 0..255
 * @returns {string} - Such as "#FF0000" for red (255,0,0)
 */
function getHexColor(r,g,b) {
    r = parseInt(r);
    g = parseInt(g);
    b = parseInt(b);
    return '#' + decToHex(r) + decToHex(g) + decToHex(b);
}

/**
 * @param {number} dec - Accepts values betwen [0..255]
 * @returns {string} - with length 2
 */
function decToHex(dec) {
    if (dec === 0)
        return '00';
    var ret = '';
    var val = dec > 255 ? 255 : dec;
    while (val !== 0) {
        var rem = val % 16;
        val = (val / 16) | 0;
        ret = _MAPPING[ rem.toString() ] + ret;
    }
    return ret.length > 1 ? ret : ('0'+ret);
}

const _MAPPING = {
     '0': '0',
     '1': '1',
     '2': '2',
     '3': '3',
     '4': '4',
     '5': '5',
     '6': '6',
     '7': '7',
     '8': '8',
     '9': '9',
    '10': 'A',
    '11': 'B',
    '12': 'C',
    '13': 'D',
    '14': 'E',
    '15': 'F',
};