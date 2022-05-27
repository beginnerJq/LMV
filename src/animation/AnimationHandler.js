export function AnimationHandler() {
    this.animations = [];
}

AnimationHandler.prototype.init = function(data) {
    // return same data if initialized
    if (data.initialized === true) return data;

    // loop through all keys
    for (var h = 0; h < data.hierarchy.length; h++) {
        for (var k = 0; k < data.hierarchy[h].keys.length; k++) {
            // remove minus times
            if (data.hierarchy[h].keys[k].time < 0 ) {
                 data.hierarchy[h].keys[k].time = 0;
            }

            // create quaternions
            if (data.hierarchy[h].keys[k].rot !== undefined &&
              ! (data.hierarchy[h].keys[k].rot instanceof THREE.Quaternion)) {
                var quat = data.hierarchy[h].keys[k].rot;
                if (!Array.isArray(quat)) {
                    quat = [quat._x, quat._y, quat._z, quat._w];
                }
                data.hierarchy[h].keys[k].rot = new THREE.Quaternion().fromArray(quat);
            }
        }

        // remove all keys with same time
        for (let k = 1; k < data.hierarchy[h].keys.length; k++) {
            if (data.hierarchy[h].keys[k].time === data.hierarchy[h].keys[k - 1].time) {
                data.hierarchy[h].keys.splice(k, 1);
                k--;
            }
        }

        // set index
        for (let k = 0; k < data.hierarchy[h].keys.length; k++) {
            data.hierarchy[h].keys[k].index = k;
        }
    }
    data.initialized = true;
    return data;
};

AnimationHandler.prototype.parse = function(root) {
    function parseRecurseHierarchy(root, hierarchy) {
        hierarchy.push(root);

        // check Object3D.children if not defined
        // do not animate camera's light node
        if (root.children && !(root instanceof THREE.Camera)) {
            for(var c = 0; c < root.children.length; c++)
                parseRecurseHierarchy(root.children[c], hierarchy);
        }
    }
    var hierarchy = [];
    parseRecurseHierarchy(root, hierarchy);
    return hierarchy;
};

AnimationHandler.prototype.play = function(animation) {
    if (this.animations.indexOf(animation) === -1) {
        this.animations.push(animation);
    }
};

AnimationHandler.prototype.stop = function(animation) {
    var index = this.animations.indexOf(animation);
    if (index !== -1) {
        this.animations.splice(index, 1);
    }
};

AnimationHandler.prototype.update = function(deltaTimeMS) {
    for (var i = 0; i < this.animations.length; i++) {
        this.animations[i].update(deltaTimeMS);
    }
};
