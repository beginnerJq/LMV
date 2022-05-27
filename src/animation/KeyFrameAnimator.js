
import { AnimationHandler } from './AnimationHandler'
import { MeshAnimation } from './type/MeshAnimation'
import { CameraAnimation } from './type/CameraAnimation'
import { VisibilityAnimation } from './type/VisibilityAnimation'
import { AnnotationAnimation } from './type/AnnotationAnimation'
import { PolylineAnimation } from "./type/PolylineAnimation";
import { GlobalManagerMixin } from '../application/GlobalManagerMixin';

/**
 *  This is the keyframe animator class that performs keyframe animation
 *
 *  @constructor
 *  @alias Autodesk.Viewing.Private.KeyFrameAnimator
 *  @param {Viewer3DImpl} viewer The viewer
 *  @param {number} duration The duration of the animation in seconds
 * *@param {GlobalManager} GlobalManager instance from the viewer
 */
export function KeyFrameAnimator(viewer, duration) {
    this.animations = [];
    this.viewer = viewer;
    this.setGlobalManager(viewer.globalManager);
    this.keys = [];
    this.isPlaying = false;
    this.isPaused = true;
    this.updateFlag = 0;
    this.duration = duration;
    this.currentTime = 0;
    this.onPlayCallback = null;
    this.animationHandler = new AnimationHandler();
    this.areCameraAnimationsPaused = false;
    this.UPDATE_SCENE = 1;
    this.UPDATE_CAMERA = 2;
    this.followCam = true;
    this._speedMod = 1.0;
    this._loops = false;
};

GlobalManagerMixin.call(KeyFrameAnimator.prototype);

/**
 * Destructor. Releasing references to other objects.
 */
KeyFrameAnimator.prototype.destroy = function() {
    this.stop();
    this.viewer = null;
    this.keys = null;
    this.animations = null;
    this.isPlaying = false;
    this.isPaused = false;
    this.animationHandler = null;
};

/**
 * Add an animation to the keyframe animator
 *
 * @param {object} animation The animation object to add
 */
KeyFrameAnimator.prototype.add = function(animation) {
    // return if animation has no hierarchy data or less than two keys
    if (!animation.hierarchy || animation.hierarchy.length < 1 || !animation.hierarchy[0].keys ||
        animation.hierarchy[0].keys.length < 2)
        return;

    var anim = null;
    var that = this;
    if (animation.type === "camera") {
        anim = new CameraAnimation(that.viewer.camera, animation, that);
        that.animations.push(anim);
    }
    else if (animation.type === "annotation") {
        anim = new AnnotationAnimation(null, animation, that);
        that.animations.push(anim);
    }
    else if (animation.type === "polyline") {
        anim = new PolylineAnimation(null, animation, that);
        that.animations.push(anim);
    }
    else if (animation.type === "mesh") {
    
        that.viewer.model.getData().instanceTree.enumNodeFragments(animation.id, function(fragId) {

            var mesh = that.viewer.getFragmentProxy(that.viewer.model, fragId);
            if (mesh) {
                // meshes of the node will share same data
                anim = new MeshAnimation(mesh, animation, that);                
                that.animations.push(anim);
            }
        
        }, true);
    
    } else if (animation.type === "visibility") {
        anim = new VisibilityAnimation(animation, animation.id, that);
        that.animations.push(anim);
    }

    that.animations.forEach(anim => anim.setGlobalManager(this.globalManager));


    // sort and remove duplicates
    function sortAndRemoveDuplicateKeys(keys) {
        function removeDuplicates(a,b,c) {
            b=a.length;while(c=--b)while(c--)a[b]!==a[c]||a.splice(c,1);
        }

        // sort keys
        keys.sort(function(a, b) {return a-b});

        // remove duplicates
        removeDuplicates(keys);
    }

    if (anim) {
        // add keys
        for (var h = 0, hl = animation.hierarchy.length; h < hl; h ++) {
            var keys = animation.hierarchy[h].keys;
            for (var i = 0; i < keys.length; i++) {
                // add user defined (non extra) keys
                if (keys[i].xk === undefined)
                    that.keys.push(keys[i].time);
            }
        }
        sortAndRemoveDuplicateKeys(that.keys);
    }

    this.updateFlag |= this.UPDATE_SCENE;
};

/**
 * Update all animations in the keyframe animator
 *
 * @param {number} time The time in second to advance
 * @return {number} 0 for no update, 1 for scene, 2 for camera, 3 for both
 */
KeyFrameAnimator.prototype.update = function(time) {
    time = time * this._speedMod;
    this.animationHandler.update(time);
    var update = this.updateFlag;
    if (this.isPlaying && !this.isPaused) {
        this.currentTime += time;
        this.currentTime = Math.min(this.currentTime, this.duration);
        if (this.onPlayCallback) {
            // send playback percentage
            this.onPlayCallback(this.duration > 0? this.currentTime / this.duration * 100 : 0);    
        }
        if (this.currentTime >= this.duration) {
            if (this._loops) {
                this.play(0, this.onPlayCallback);
            } else {
                this.pause();
            }
        }
        update |= this.UPDATE_SCENE;
    }
    this.updateFlag = 0;
    return update;
};

/**
 * Play all animations
 *
 * @param {number} startTime The time in second to start
 */
KeyFrameAnimator.prototype.play = function(startTime, onPlayCallback) {
    this.onPlayCallback = onPlayCallback;

    // auto-rewind and play if reached the end
    if (this.currentTime >= this.duration) {
        this.goto(0);
    }

    if (this.isPlaying) {
        this.pause();
        return;
    }

    for (var i = 0; i < this.animations.length; i++) {
        var animation = this.animations[i];
        animation.play(startTime);
    }

    this.isPlaying = true;
    this.isPaused = false;
};

/**
 * Whether a playing animation updates the camera position.
 * 
 * @param {boolean} followCam - true to allow animation to update camera position (default behavior).
 */
KeyFrameAnimator.prototype.setFollowCamera = function(followCam) {
    this.followCam = followCam;
    for (var i = 0; i < this.animations.length; i++) {
        var animation = this.animations[i];
        animation.setFollowCamera && animation.setFollowCamera(followCam);
    }
};

/**
 * @returns {boolean} Whether animations will update the camera's position (true) or not (false).
 */
KeyFrameAnimator.prototype.isFollowingCamera = function() {
    return this.followCam;
};

/**
 * Changes the speed at which the animation is played. Use value 1 to run the 
 * animation at default speed, use value 2 to run it at double the speed, 
 * use value 0.5 to run it at half the speed.
 * 
 * @param {number} value - A multiplier for the animation's elapsed time.
 */
KeyFrameAnimator.prototype.setSpeedModifier = function(value) {
    this._speedMod = value;
};

/**
 * @returns {number} The playback speed multiplier.
 */
KeyFrameAnimator.prototype.getSpeedModifier = function() {
    return this._speedMod;
};

/**
 * Sets whether the animation rewinds and plays as soon as the animation
 * finishes playing.
 * 
 * @param {boolean} loop - true to have the animation loop continuously.
 */
KeyFrameAnimator.prototype.setLooping = function(loop) {
    this._loops = loop;
};

/**
 * @returns {boolean} Whether the animation will loop continuously.
 */
KeyFrameAnimator.prototype.isLooping = function() {
    return this._loops;
};

/**
 * Pause all animations
 *
 */
KeyFrameAnimator.prototype.pause = function() {
    for (var i = 0; i < this.animations.length; i++) {
        var animation = this.animations[i];
        // pause sync with same state
        if (animation.isPaused === this.isPaused) {
            animation.pause();
        }
    }

    this.isPaused = !this.isPaused;
    this.areCameraAnimationsPaused = this.isPaused;
};

/**
 * Pause camera animations
 *
 */
KeyFrameAnimator.prototype.pauseCameraAnimations = function() {
    for (var i = 0; i < this.animations.length; i++) {
        var animation = this.animations[i];
        if (animation instanceof CameraAnimation) {
            animation.pause();
        }
    }

    this.areCameraAnimationsPaused = !this.areCameraAnimationsPaused;
};

/**
 * Stop all animations
 *
 */
KeyFrameAnimator.prototype.stop = function() {
    for (var i = 0; i < this.animations.length; i++) {
        var animation = this.animations[i];
        animation.stop();
    }

    this.isPlaying = false;
    this.isPaused  = false;
};

/**
 * Goto specific time in the animation
 *
 * @param {number} time The specific time in second
 */
KeyFrameAnimator.prototype.goto = function(time) {
    if (time === undefined) return;
    for (var i = 0; i < this.animations.length; i++) {
        var animation = this.animations[i];
        animation.goto(time);
    }

    this.isPlaying = false;
    this.isPaused  = true;
    this.currentTime = time;
    this.updateFlag |= this.UPDATE_SCENE;
};

/**
 * Step forward to next key
 *
 */
KeyFrameAnimator.prototype.next = function() {
    // find next key time
    function findNextKey(time, keys) {
        var key = -1;
        for (var t = 0; t < keys.length; t++) {
            if (keys[t] > time) {
                key = keys[t];
                break;
            }
        }
        return (key < 0? keys[keys.length-1] : key);
    }
    var time = findNextKey(this.currentTime, this.keys);
    this.goto(time);
};

/**
 * Step backward to previous key
 *
 */
KeyFrameAnimator.prototype.prev = function() {
    // find previous key time
    function findPrevKey(time, keys) {
        var key = -1;
        for (var t = keys.length-1; t > -1; t--) {
            if (keys[t] < time) {
                key = keys[t];
                break;
            }
        }
        return (key < 0? keys[0] : key);
    }
    var time = findPrevKey(this.currentTime, this.keys);
    this.goto(time);
};

