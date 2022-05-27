import { Animation } from '../Animation';

export function VisibilityAnimation(data, nodeId, animator) {
    Animation.call(this, {}, data, animator);

    this.fragPointers = [];
    let fragPointer;
    // Cache these so we don't iterate each frame
    this.nodeChildren = []; 
    this.nodeFragments = [];

    const instanceTree = this.viewer.model.getData().instanceTree;
    instanceTree.enumNodeChildren(nodeId, (dbId) => { 
        this.nodeChildren.push(dbId);
    }, true);
    instanceTree.enumNodeFragments(data.id, (fragId) => {
        this.nodeFragments.push(fragId);
        fragPointer =  this.viewer.getFragmentProxy(this.viewer.model, fragId);
        if (fragPointer) {
            this.fragPointers.push(fragPointer);
            //Need to clone the material as it can be shared between many objects
            //and we need to modify it for this object specifically
            fragPointer.setMaterial(this.viewer.matman().cloneMaterial(fragPointer.getMaterial(), this.viewer.model));
        }
    }, true);

    
    this.nodeId = nodeId;
    this.epsilon = 0.1;
}

VisibilityAnimation.prototype = Object.create(Animation.prototype);
VisibilityAnimation.prototype.constructor = VisibilityAnimation;
VisibilityAnimation.prototype.keyTypes = ["vis", "opa"];
VisibilityAnimation.prototype.defaultKey = {viz: 1, opa: 1};

VisibilityAnimation.prototype.getPrevAndNextKeys = function (objHeirarcy, keyType) {
    let prevKey = this.data.hierarchy[objHeirarcy].keys[0];
    let nextKey = this.getNextKeyWith(keyType, objHeirarcy, 1);

    while (nextKey.time < this.currentTime && nextKey.index > prevKey.index) {
        prevKey = nextKey;
        nextKey = this.getNextKeyWith(keyType, objHeirarcy, nextKey.index + 1);
    }

    return {
        prevKey,
        nextKey
    };
};

VisibilityAnimation.prototype.update = (function() {
    return function(delta) {
        if (this.isPlaying === false) return;

        this.currentTime += delta * this.timeScale;

        this.resetIfLooped();

        // bail out if out of range when playing
        if (this.isPlayingOutOfRange()) return;

        for (var h = 0, hl = this.hierarchy.length; h < hl; h++) {
            var object = this.hierarchy[h];
            var animationCache = object.animationCache[this.data.name];

            var prevVisKey = animationCache.prevKey['vis'];
            var nextVisKey = animationCache.prevKey['vis'];

            var prevOpaKey = animationCache.prevKey['opa'];
            var nextOpaKey = animationCache.prevKey['opa'];

            if (nextVisKey.time <= this.currentTime || prevVisKey.time >= this.currentTime) {
                const {prevKey, nextKey} = this.getPrevAndNextKeys(h, 'vis');
                prevVisKey = prevKey;
                nextVisKey = nextKey;
                animationCache.prevKey['vis'] = prevVisKey;
                animationCache.nextKey['vis'] = nextVisKey;
            }

            if (nextOpaKey.time <= this.currentTime || prevOpaKey.time >= this.currentTime) {
                const {prevKey, nextKey} = this.getPrevAndNextKeys(h, 'opa');
                prevOpaKey = prevKey;
                nextOpaKey = nextKey;
                animationCache.prevKey['opa'] = prevOpaKey;
                animationCache.nextKey['opa'] = nextOpaKey;
            }

            // Visibility

            let prevValue = prevVisKey['vis'];
            let nextValue = nextVisKey['vis'];

            if (prevValue !== undefined && nextValue !== undefined && prevVisKey.time !== nextVisKey.time) {
                const isNextKey = Math.abs(this.currentTime - nextVisKey.time) < this.epsilon;
                const vis = isNextKey ? nextValue : prevValue;
                this.viewer.visibilityManager.setNodeOff(this.nodeId, !vis, this.viewer.model, this.nodeChildren, this.nodeFragments);
            }

            // Opacity
            
            prevValue = prevOpaKey['opa'];
            nextValue = nextOpaKey['opa'];

            // Handle undefined opacity
            // Initially opacity is default value of 1, but when scrubbing, the value might have changed
            if (prevValue === undefined && prevVisKey['vis'] === 1) {
                // Restore opacity to default value only if the object was visible initially
                prevValue = 1;
            }
            
            if (prevValue !== undefined && nextValue !== undefined && prevOpaKey.time !== nextOpaKey.time) {
                let scale = (this.currentTime - prevOpaKey.time) / (nextOpaKey.time - prevOpaKey.time);
                if (scale < 0) scale = 0;
                if (scale > 1) scale = 1;
                const opacity = prevValue + (nextValue - prevValue) * scale;
                
                for (let fp = 0; fp < this.fragPointers.length; ++fp) {
                    const material = this.fragPointers[fp].getMaterial();
                    material.transparent = (opacity !== 1);
                    material.opacity = opacity;
                }

                if (opacity > 0) {
                    this.viewer.visibilityManager.setNodeOff(this.nodeId, false, this.viewer.model, this.nodeChildren, this.nodeFragments);
                }
            }
        }
    };
})();
