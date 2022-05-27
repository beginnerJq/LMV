import { logger  } from '../../logger/Logger';

var VBB_COLOR_OFFSET    = 6,
    VBB_DBID_OFFSET     = 7,
    VBB_FLAGS_OFFSET    = 8,
    VBB_LAYER_VP_OFFSET = 9;

var _toUint32 = new Uint32Array(1);
function toUint32(c) {
    _toUint32[0] = c;
    return _toUint32[0];
}

/**
 * Initializes a writable view into a compacted interleaved vertex buffer array using our custom 2D vertex layout.
 * See src/lmvtk/VertexBufferBuilder.js for more details.
 */
export function VertexBufferWriter(geometry)
{
    this.geometry = geometry;
    this.vb  = geometry.vb.buffer;    
    this.vbi = new Int32Array(this.vb);
    this.vbs = new Uint16Array(this.vb);    

    this.stride = geometry.vbstride;
    this.vcount = this.vbi.length / this.stride;

    this.useCompactBuffers = geometry.unpackXform;
    this.texData = this.useCompactBuffers && geometry.tIdColor?.image?.data && new Uint32Array(geometry.tIdColor.image.data.buffer);

    // only needed for compact vb
    this.texColMap = (() => {
        if (!this.texData) return null; 
        const col2Index = {};
        const seen = new Set();
        for (let i = 0; i < this.vcount; ++i) {
            const index = this.vbs[i*this.stride * 2 + VBB_COLOR_OFFSET];
            if (!seen.has(index)) {
                col2Index[this.texData[index]] = index;
                seen.add(index);
            }
        }
        return col2Index;
    })();

};

VertexBufferWriter.prototype.setColorAt = function(vindex, newColor) {
    if(this.texData) {
        // Add color to compact buffer
        newColor = toUint32(newColor);
        if (!(newColor in this.texColMap)) {
            // Create a new tIdColor buffer with the new color added
            const oldBuffer = this.texData;
            if (oldBuffer.length + 1 > 65536) { 
                logger.warn("setColorAt() cannot add new color as size limit reached");
                return; 
            }

            const newBuffer = new Uint32Array(oldBuffer.length + 1);
            newBuffer.set(oldBuffer, 0);
            newBuffer[oldBuffer.length] = newColor; // add new color to end of the texture
            // Add index of the new color to the map
            this.texColMap[newColor] = oldBuffer.length;
    
            // Replace existing tIdColor
            var tIdColor = new THREE.DataTexture(new Uint8Array(newBuffer.buffer), newBuffer.length, 1,
                THREE.RGBAFormat, THREE.UnsignedByteType, THREE.UVMapping,
                THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.NearestFilter, THREE.NearestFilter, 0);
            tIdColor.generateMipmaps = false;
            tIdColor.flipY = false;
            tIdColor.needsUpdate = true;
            this.geometry.tIdColor.dispose();
            this.geometry.tIdColor = tIdColor;
            this.texData = new Uint32Array(tIdColor.image.data.buffer);
            this.geometry.vIdColorTexSize = new THREE.Vector2(newBuffer.length, 1);
        }
    
        // set the vertex color
        this.vbs[vindex*this.stride * 2 + VBB_COLOR_OFFSET] = this.texColMap[newColor];
    } else {
        this.vbi[vindex*this.stride + VBB_COLOR_OFFSET] = newColor;
    }
};

VertexBufferWriter.prototype.setVertexFlagsAt = function(vindex, flag) {
    if(this.texData) {
        this.vbi[vindex*this.stride + 4] = flag;
    } else {
        this.vbi[vindex*this.stride + VBB_FLAGS_OFFSET] = flag;
    }
};
