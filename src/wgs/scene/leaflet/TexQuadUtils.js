import * as THREE from "three";

// Simple helper to describe uv offset and scale
export function UVTransform() {
    this.offsetX = 0.0;
    this.offsetY = 0.0;
    this.scaleX  = 1.0;
    this.scaleY  = 1.0;
}

UVTransform.prototype.toVec4 = function() {
    return new THREE.Vector4(this.offsetX, this.offsetY, this.scaleX, this.scaleY);
};

UVTransform.prototype.copyTo = function(otherUV) {
    otherUV.offsetX = this.offsetX;
    otherUV.offsetY = this.offsetY;
    otherUV.scaleX = this.scaleX;
    otherUV.scaleY = this.scaleY;
};

export function GeometryManager() {
    // reused geometry for on-the-fly generated fallback tiles, which require individual uv-coords
    // It would be better to share _quadGeom for these as well. But this is would require a solution
    // first how we can use the same texture with different uvTransforms in a single frame.
    var _reusedGeoms = [];  // {THREE.BufferGeometry}
    // index to the first elem in _reusedGeoms that has not been used for the current frame yet.
    var _nextFreeGeom = 0;

    const _uvTransformIdentity = new UVTransform();

    /** Updates the uv-coords for a given quad geometry.
     *   @param {THREE.BufferGeometry} geom
     *   @param {UVTransform}    [uvTransform] - default: identity
     */
    function setUVCoords(geom, uvTransform) {

        var tf = uvTransform ? uvTransform : _uvTransformIdentity;

        const uvs = [
            tf.offsetX            , tf.offsetY,
            tf.offsetX + tf.scaleX, tf.offsetY,
            tf.offsetX + tf.scaleX, tf.offsetY + tf.scaleY,
            tf.offsetX            , tf.offsetY + tf.scaleY
        ];

        const uvAttr = geom.getAttribute('uv');
        if (!uvAttr) {
            // LMV-6119 (Threejs Update): THREE.Geometry has been deprecated and in its place we use BufferGeometry.
            // The UV coordinates are now stored as the geometry's attributes.
            // This will set the uv attribute for the buffer geometery.
            geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
            return;
        }

        // We need to update the existing BufferAttribute
        // Calling geom.setAttribute('uv' , ... ) does not work.
        // Thus we need to loop over the new uvs and update the existing BufferAttribute
        for (let i = 0; i < uvs.length; i += 2) {
            const uvIdx = i / 2;
            uvAttr.setXY(uvIdx, uvs[i], uvs[i + 1]);
        }

        // This flag is required. Without it the leaflet images will flicker
        uvAttr.needsUpdate = true;
    }

    /**
     * Returns a reusable geometry and recomputes its uv coords based on given scale and offset.
     *  @param   {UVTransform}    [uvOffsetX]
     *  @returns {THREE.BufferGeometry} A geometry from _reusedGeoms
     */
    this.acquireQuadGeom = function(uvTransform) {

        // get next reusable mesh and increase counter
        var geom = _reusedGeoms[_nextFreeGeom];

        // if not available yet, create it
        if (!geom) {
            geom = this.createQuadGeom(uvTransform);

            // keep it for reuse in later frames
            _reusedGeoms[_nextFreeGeom] = geom;
        } else {
            // reuse old geom and just update uv
            setUVCoords(geom, uvTransform);
        }

        // inc counter so that this geom is not used again in this frame
        _nextFreeGeom++;
        return geom;
    };

    /**
     *  @param {UVTransform} [uvTransform]
     *  @returns {THREE.BufferGeometry}
     */
    this.createQuadGeom = function(uvTransform) {

        // vertices
        var geom = new THREE.BufferGeometry();

        const vertices = [
            0.0, 0.0, 0.0,
            1.0, 0.0, 0.0,
            1.0, 1.0, 0.0,
            0.0, 1.0, 0.0
        ];

        geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));

        geom.setIndex([
            0, 1, 2,
            0, 2, 3
        ]);

        geom.computeVertexNormals();
        setUVCoords(geom, uvTransform);

        return geom;
    };

    this.reset = function() {
        _nextFreeGeom = 0;
    };

    this.dispose = function() {
        for (var i = 0; i < _reusedGeoms.length; i++) {
            var geom = _reusedGeoms[i];
            if (geom) {
                geom.dispose();
                geom.needsUpdate = true;
            }
        }

        _reusedGeoms = [];
    }
}



