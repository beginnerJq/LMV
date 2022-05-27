import * as THREE from "three";
import { INTERPOLATION_TYPE } from '../InterpolationType';
import { Animation, interpolateCatmullRom } from '../Animation';


export function MeshAnimation(root, data, animator) {
    Animation.call(this, root, data, animator);
    this.localMatrix = new THREE.Matrix4();
    
    this.root.getAnimTransform();
    this.relativeTransform = (data.custom && data.custom.transform && data.custom.transform === "abs")? false: true;
}

MeshAnimation.prototype = Object.create(Animation.prototype);
MeshAnimation.prototype.constructor = MeshAnimation;
MeshAnimation.prototype.keyTypes = ["pos", "rot", "scl"];
MeshAnimation.prototype.defaultKey = {pos: 0, rot: 0, scl: 0};

MeshAnimation.prototype.update = (function() {
    var points = [];

    var target = new THREE.Vector3();
    var newVector = new THREE.Vector3();
    var newQuat = new THREE.Quaternion();
    var tmpMatrix1 = new THREE.Matrix4();
    var tmpMatrix2 = new THREE.Matrix4();

    return function(delta) {
        if (this.isPlaying === false) return;

        this.currentTime += delta * this.timeScale;

        this.resetIfLooped();

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

                if (nextKey.time <= this.currentTime || prevKey.time >= this.currentTime) {
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
                if (type === "pos") {
                    if (this.interpolationType === INTERPOLATION_TYPE.LINEAR) {
                        newVector.x = prevXYZ[0] + (nextXYZ[0] - prevXYZ[0]) * scale;
                        newVector.y = prevXYZ[1] + (nextXYZ[1] - prevXYZ[1]) * scale;
                        newVector.z = prevXYZ[2] + (nextXYZ[2] - prevXYZ[2]) * scale;
                        object.position.copy(newVector);
                    } else /*if (this.interpolationType === INTERPOLATION_TYPE.CATMULLROM ||
                        this.interpolationType === INTERPOLATION_TYPE.CATMULLROM_FORWARD)*/ {
                        points[0] = this.getPrevKeyWith("pos", h, prevKey.index - 1)["pos"];
                        points[1] = prevXYZ;
                        points[2] = nextXYZ;
                        points[3] = this.getNextKeyWith("pos", h, nextKey.index + 1)["pos"];

                        scale = scale * 0.33 + 0.33;

                        var currentPoint = interpolateCatmullRom(points, scale);
                        newVector.x = currentPoint[0];
                        newVector.y = currentPoint[1];
                        newVector.z = currentPoint[2];
                        object.position.copy(newVector);

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
                } else if (type === "rot") {

                                                   
                    {
                        THREE.Quaternion.slerp(prevXYZ, nextXYZ, newQuat, scale);
                    }
                             
                     
                                                                            
                     
                              
                    object.quaternion.copy(newQuat);
                } else if (type === "scl") {
                    newVector.x = prevXYZ[0] + (nextXYZ[0] - prevXYZ[0]) * scale;
                    newVector.y = prevXYZ[1] + (nextXYZ[1] - prevXYZ[1]) * scale;
                    newVector.z = prevXYZ[2] + (nextXYZ[2] - prevXYZ[2]) * scale;
                    object.scale.copy(newVector);
                }
            }

            // Note that object is expected to be a FragmentPointer here, not THREE.Object3D.

            if (!this.relativeTransform) {
                // Animation matrices in FragmentList are always applied after the world matrix.
                // If we right-multiply the worldMatrix inverse, we revert the original world matrix.

                // get anim matrix
                var animMatrix = tmpMatrix1.compose(object.position, object.quaternion, object.scale);

                // get inverse of world matrix
                var worldInv   = tmpMatrix2;
                object.getOriginalWorldMatrix(worldInv);
                worldInv.invert();

                // compute final anim matrix in a way that we first revert the world matrix,
                // then apply the absolute anim matrix
                var finalAnimMatrix = tmpMatrix1.multiplyMatrices(animMatrix, worldInv);

                // write back to the object
                finalAnimMatrix.decompose(object.position, object.quaternion, object.scale);
            }

            // compose local transform and multiply to original transform
            object.updateAnimTransform();

            // update world matrix so scene bounds can be set correctly
            //object.updateMatrixWorld();
        }
    };
})();