import * as THREE from "three";
import { Animation } from '../Animation';

export function PolylineAnimation(root, data, animator) {
    this.viewer = animator.viewer;
    if (root === null) {
        root = this.createPolyline([]);
    }
    Animation.call(this, root, data, animator);
    this.epsilon = 0.1;
}

PolylineAnimation.prototype = Object.create(Animation.prototype);
PolylineAnimation.prototype.constructor = PolylineAnimation;
PolylineAnimation.prototype.keyTypes = ["points", "vis"];
PolylineAnimation.prototype.defaultKey = {points: [], vis: 1};

PolylineAnimation.prototype.stop = function() {
    Animation.prototype.stop.call(this);
    this.viewer.removeOverlay("polyline", this.root);
    this.root = null;
};

PolylineAnimation.prototype.update = (function() {
    function removePolyline(anim) {
        if (anim.root) {
            anim.viewer.removeOverlay("polyline", anim.root);
            anim.root = null;
        }
    }

    return function(delta) {
        if (this.isPlaying === false) return;

        this.currentTime += delta * this.timeScale;

        this.resetIfLooped();

        // bail out if out of range when playing
        if (this.isPlayingOutOfRange()) return;

        // restore and return if paused before start key
        if (this.isPaused && this.currentTime < this.startKeyTime) {
            removePolyline(this);
            return;
        }

        for (var h = 0, hl = this.hierarchy.length; h < hl; h++) {
            var object = this.hierarchy[h];
            var animationCache = object.animationCache[this.data.name];

            // loop thru keys
            for (var t = 0; t < this.keyTypes.length; t++) {
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

                var prevPoints = prevKey[type];
                var nextPoints = nextKey[type];

                // skip if no key or no change in key values
                if (nextKey.time === prevKey.time || prevPoints === undefined || nextPoints === undefined) continue;

                var scale = (this.currentTime - prevKey.time) / (nextKey.time - prevKey.time);
                if (scale < 0) scale = 0;
                if (scale > 1) scale = 1;

                if (type === "points") {
                    // interpolate start and end points
                    var points = scale < 0.5? prevPoints : nextPoints;
                    this.viewer.removeOverlay("polyline", this.root);
                    this.root = null;
                    var vertices = [];
                    for (var i = 0; i < points.length; i++) {
                        var pt = points[i].slice();
                        if (i === 0) {
                            pt[0] = prevPoints[i][0] + (nextPoints[i][0] - prevPoints[i][0]) * scale;
                            pt[1] = prevPoints[i][1] + (nextPoints[i][1] - prevPoints[i][1]) * scale;
                            pt[2] = prevPoints[i][2] + (nextPoints[i][2] - prevPoints[i][2]) * scale;
                        }
                        else if (i === points.length-1) {
                            var p = prevPoints.length - 1;
                            var n = nextPoints.length - 1;
                            pt[0] = prevPoints[p][0] + (nextPoints[n][0] - prevPoints[p][0]) * scale;
                            pt[1] = prevPoints[p][1] + (nextPoints[n][1] - prevPoints[p][1]) * scale;
                            pt[2] = prevPoints[p][2] + (nextPoints[n][2] - prevPoints[p][2]) * scale;
                        }
                        var newpt = new THREE.Vector3(pt[0], pt[1], pt[2]);
                        vertices.push(newpt);
                    }
                    this.root = this.createPolyline(vertices);
                } else if (type === "vis") {
                    var vis = Math.abs(this.currentTime - nextKey.time) < this.epsilon ? nextPoints : prevPoints;
                    this.root.visible = vis;
                    if (!vis) removePolyline(this);
                }
            }
        }
    };
})();

PolylineAnimation.prototype.createPolyline = function(points) {
    var geometry = new THREE.Geometry();
    for (var i = 0; i < points.length; i++) {
        geometry.vertices.push(points[i]);
    }
    geometry.computeLineDistances();

    var material = new THREE.LineDashedMaterial({color: 0x0, dashSize:1, gapSize:0.5, linewidth:1});
    var line = new THREE.Line(geometry, material, THREE.LineStrip);

    // add polyline to an overlay scene
    if (this.viewer.overlayScenes["polyline"] === undefined) {
        this.viewer.createOverlayScene("polyline");
    }
    this.viewer.addOverlay("polyline", line);

    return line;
};