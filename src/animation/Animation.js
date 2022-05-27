
import { INTERPOLATION_TYPE } from './InterpolationType';
import { GlobalManagerMixin } from '../../src/application/GlobalManagerMixin';

/**
 * Base class for all Animation types
 * @param {*} root 
 * @param {*} data 
 * @param {*} animator 
 */
export function Animation(root, data, animator) {
    this.root = root;
    this.handler = animator.animationHandler;
    this.data = this.handler.init(data);
    this.hierarchy = this.handler.parse(root);
    this.viewer = animator.viewer;
    this.animator = animator;

    this.currentTime = 0;
    this.timeScale = 1;

    this.isPlaying = false;
    this.isPaused = true;
    this.loop = false;
    this.delta = 0.5;

    this.interpolationType = INTERPOLATION_TYPE.LINEAR;

    this.setStartAndEndKeyTime();
}

GlobalManagerMixin.call(Animation.prototype);

Animation.prototype.setStartAndEndKeyTime = function() {
    if (this.data.hierarchy.length > 0) {
        // root of hierarchy should have key time covering animation
        var keys = this.data.hierarchy[0].keys;
        this.startKeyTime = keys[0].time;
        this.endKeyTime = keys[keys.length-1].time;
    } else {
        this.startKeyTime = this.endKeyTime = 0;
    }
};

Animation.prototype.keyTypes = [];
Animation.prototype.defaultKey = {};

Animation.prototype.play = function(startTime) {
    this.currentTime = startTime !== undefined ? startTime : 0;
    this.isPlaying = true;
    this.isPaused = false;
    this.reset();
    this.handler.play(this);
};

Animation.prototype.pause = function() {
    if (this.isPaused === true) {
        this.handler.play(this);
    } else {
        this.handler.stop(this);
    }
    this.isPaused = !this.isPaused;
};

Animation.prototype.stop = function() {
    this.isPlaying = false;
    this.isPaused  = false;
    this.handler.stop(this);
};

Animation.prototype.goto = function(time) {
    if (!this.isPlaying) this.play();
    if (!this.isPaused) this.pause();
    var delta = time - this.currentTime;
    this.update(delta);
};

Animation.prototype.reset = function() {
    for (var h = 0, hl = this.hierarchy.length; h < hl; h++) {
        var object = this.hierarchy[h];

        if (object.animationCache === undefined) {
            object.animationCache = {};
        }

        if (object.animationCache[this.data.name] === undefined) {
            object.animationCache[this.data.name] = {
                prevKey: this.defaultKey,
                nextKey: this.defaultKey,
                originalMatrix: object.matrix
            };
        }

        // get keys to match our current time
        var animationCache = object.animationCache[this.data.name];
        for (var t = 0; t < this.keyTypes.length; t++) {
            var type = this.keyTypes[t];
            var prevKey = this.data.hierarchy[h].keys[0];
            var nextKey = this.getNextKeyWith(type, h, 1);
            while (nextKey.time < this.currentTime && nextKey.index > prevKey.index) {
                prevKey = nextKey;
                nextKey = this.getNextKeyWith(type, h, nextKey.index + 1);
            }
            animationCache.prevKey[type] = prevKey;
            animationCache.nextKey[type] = nextKey;
        }
    }

    this.setStartAndEndKeyTime();
};

Animation.prototype.getNextKeyWith = function (type, h, key) {
    var keys = this.data.hierarchy[h].keys;
    if (this.interpolationType === INTERPOLATION_TYPE.CATMULLROM ||
        this.interpolationType === INTERPOLATION_TYPE.CATMULLROM_FORWARD) {
        key = key < keys.length - 1 ? key : keys.length - 1;
    } else {
        key = key % keys.length;
    }

    for (; key < keys.length; key++) {
        if (keys[key][type] !== undefined) {
            return keys[key];
        }
    }
    return this.data.hierarchy[h].keys[0];
};

Animation.prototype.getPrevKeyWith = function (type, h, key) {
    var keys = this.data.hierarchy[h].keys;
    if (this.interpolationType === INTERPOLATION_TYPE.CATMULLROM ||
        this.interpolationType === INTERPOLATION_TYPE.CATMULLROM_FORWARD) {
        key = key > 0 ? key : 0;
    } else {
        key = key >= 0 ? key : key + keys.length;
    }

    for (; key >= 0; key--) {
        if (keys[key][type] !== undefined) {
            return keys[key];
        }
    }
    return this.data.hierarchy[h].keys[keys.length - 1];
};

Animation.prototype.isPlayingOutOfRange = function() {
    return (this.isPaused === false && (this.currentTime < this.startKeyTime - this.delta ||
            this.currentTime > this.endKeyTime + this.delta));
};

Animation.prototype.resetIfLooped = function() {
    if (this.loop === true && this.currentTime > this.endKeyTime) {
        this.currentTime %= this.endKeyTime;
        this.reset();
    }
};

// Catmull-Rom spline
export function interpolateCatmullRom(points, scale) {
    function interpolate(p0, p1, p2, p3, t, t2, t3) {
        var v0 = (p2 - p0) * 0.5,
            v1 = (p3 - p1) * 0.5;

        return (2 * (p1 - p2) + v0 + v1) * t3 + (- 3 * (p1 - p2) - 2 * v0 - v1) * t2 + v0 * t + p1;
    }

    var c = [], v3 = [],
    point, intPoint, weight, w2, w3,
    pa, pb, pc, pd;

    point = (points.length - 1) * scale;
    intPoint = Math.floor(point);
    weight = point - intPoint;

    c[0] = intPoint === 0 ? intPoint : intPoint - 1;
    c[1] = intPoint;
    c[2] = intPoint > points.length - 2 ? intPoint : intPoint + 1;
    c[3] = intPoint > points.length - 3 ? intPoint : intPoint + 2;

    pa = points[c[0]];
    pb = points[c[1]];
    pc = points[c[2]];
    pd = points[c[3]];

    w2 = weight * weight;
    w3 = weight * w2;

    v3[0] = interpolate(pa[0], pb[0], pc[0], pd[0], weight, w2, w3);
    v3[1] = interpolate(pa[1], pb[1], pc[1], pd[1], weight, w2, w3);
    v3[2] = interpolate(pa[2], pb[2], pc[2], pd[2], weight, w2, w3);

    return v3;
}

