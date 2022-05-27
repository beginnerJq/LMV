import * as THREE from "three";
import { INTERPOLATION_TYPE } from '../InterpolationType';
import { Animation, interpolateCatmullRom } from '../Animation';

export function CameraAnimation(root, data, animator) {
    Animation.call(this, root, data, animator);
    this.followCam = true;
}

CameraAnimation.prototype = Object.create(Animation.prototype);
CameraAnimation.prototype.constructor = CameraAnimation;
CameraAnimation.prototype.keyTypes = ["pos", "up", "target", "fov", "perspective"];
CameraAnimation.prototype.defaultKey = {pos: 0, up: 0, target: 0, fov: 0, perspective:0};

CameraAnimation.prototype.setFollowCamera = function(followCam) {
    this.followCam = followCam;
};

CameraAnimation.prototype.update = (function() {
    var points = [];
    
    var target = new THREE.Vector3();
    var newVector = new THREE.Vector3();

    return function(delta) {
        if (this.isPlaying === false) return;

        this.currentTime += delta * this.timeScale;

        this.resetIfLooped();

        // Abort if the camera is not meant to be updated.
        if (!this.followCam)
            return;

        // bail out if out of range when playing
        if (this.isPlayingOutOfRange()) return;

        for (var h = 0, hl = this.hierarchy.length; h < hl; h++) {
            var object = this.hierarchy[h];
            var animationCache = object.animationCache[this.data.name];

            // loop through keys
            for (var t = 0; t < this.keyTypes.length; t ++) {
                var type = this.keyTypes[t];
                var prevKey = animationCache.prevKey[type];
                var nextKey = animationCache.nextKey[type];

                if (nextKey.time <= this.currentTime  || prevKey.time >= this.currentTime) {
                    prevKey = this.data.hierarchy[h].keys[0];
                    nextKey = this.getNextKeyWith(type, h, 1);

                    while (nextKey.time < this.currentTime && nextKey.index > prevKey.index) {
                        prevKey = nextKey;
                        nextKey = this.getNextKeyWith(type, h, nextKey.index + 1);
                    }
                    animationCache.prevKey[type] = prevKey;
                    animationCache.nextKey[type] = nextKey;
                }

                var prevXYZ = prevKey[type];
                var nextXYZ = nextKey[type];

                // skip if no key or no change in key values
                if (nextKey.time === prevKey.time || prevXYZ === undefined || nextXYZ === undefined) continue;

                var scale = (this.currentTime - prevKey.time) / (nextKey.time - prevKey.time);
                if (scale < 0) scale = 0;
                if (scale > 1) scale = 1;

                // interpolate
                var vector;
                if (type === "pos") {
                    vector = object.position;
                } else if (type === "up") {
                    vector = object.up;
                } else if (type === "target") {
                    vector = object.target;
                } else if (type === "fov") {
                    object.setFov(prevXYZ + (nextXYZ - prevXYZ) * scale);
                    continue;
                } else if (type === "perspective") {
                    var mode = scale > 0.5 ? nextXYZ : prevXYZ;
                    if (mode)
                        object.toPerspective();
                    else
                        object.toOrthographic();
                    continue;
                }

                if (this.interpolationType === INTERPOLATION_TYPE.LINEAR) {
                    newVector.x = prevXYZ[0] + (nextXYZ[0] - prevXYZ[0]) * scale;
                    newVector.y = prevXYZ[1] + (nextXYZ[1] - prevXYZ[1]) * scale;
                    newVector.z = prevXYZ[2] + (nextXYZ[2] - prevXYZ[2]) * scale;
                    vector.copy(newVector);
                } else /*if (this.interpolationType === INTERPOLATION_TYPE.CATMULLROM ||
                    this.interpolationType === INTERPOLATION_TYPE.CATMULLROM_FORWARD)*/ {
                    points[0] = this.getPrevKeyWith(type, h, prevKey.index - 1)[type];
                    points[1] = prevXYZ;
                    points[2] = nextXYZ;
                    points[3] = this.getNextKeyWith(type, h, nextKey.index + 1)[type];

                    scale = scale * 0.33 + 0.33;

                    var currentPoint = interpolateCatmullRom(points, scale);
                    newVector.x = currentPoint[0];
                    newVector.y = currentPoint[1];
                    newVector.z = currentPoint[2];
                    vector.copy(newVector);

                    if (this.interpolationType === INTERPOLATION_TYPE.CATMULLROM_FORWARD) {
                        var forwardPoint = interpolateCatmullRom(points, scale * 1.01);

                        target.set(forwardPoint[0], forwardPoint[1], forwardPoint[2]);
                        target.sub(vector);
                        target.y = 0;
                        target.normalize();

                        var angle = Math.atan2(target.x, target.z);
                        object.rotation.set(0, angle, 0);
                    }
                }
            }
            object.matrixAutoUpdate = true;
            object.matrixWorldNeedsUpdate = true;
        }
        object.lookAt(object.target);
        this.animator.updateFlag |= this.animator.UPDATE_CAMERA;
    };
})();