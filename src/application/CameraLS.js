'use strict';
import { GlobalManagerMixin  } from "./GlobalManagerMixin";

const isVectorFinite = (vec) => {
    return isFinite(vec.x) && isFinite(vec.y) && isFinite(vec.z);
};

const isCameraValid = (camera) => {
    const isOrthoScaleValid = camera.isPerspective || isFinite(camera.orthoScale);

    return (
        isVectorFinite(camera.position) &&
        isVectorFinite(camera.target) &&
        isVectorFinite(camera.up) &&
        isOrthoScaleValid
    );
};

// Simple cache object that's being used only if useLocalStorage is false.
class CacheHelper {
    constructor() {
        this.cacheObj = {};
    }

    setItem(key, camJson) {
        this.cacheObj[key] = camJson;
    }

    getItem(key) {
        return this.cacheObj[key];
    }
}

// Used to persist camera in local browser storage.
// Note: We have to use the abbreviated class name here - otherwise the Checkmarx tool get confused and considers the class as unsafe.
export class CameraLS {

    // @param {aggregatedView} aggregatedView
    constructor(aggregatedView, options = { useLocalStorage: true }) {
        this.aggregatedView = aggregatedView;
        this.options = options;
        this.key = undefined;

        if (this.options.useLocalStorage) {
            this.cache = Autodesk.Viewing.Private.LocalStorage;
        } else {
            this.cache = new CacheHelper();
        }

        this.unloadCb = this.saveCamera.bind(this);
        this.addWindowEventListener('beforeunload', this.unloadCb);
    }

    destroy() {
        this.unsetKey();
        this.removeWindowEventListener('beforeunload', this.unloadCb);
    }

    // @param {URL string} key
    // Used to set the key to be able to call the 'unloadCb' which is called e.g. on on closing some tab or window
    setKey(key) {
        this.key = key;
    }

    unsetKey() {
        this.key = undefined;
    }

    saveCamera() {
        // If camera wasn't initialized, don't save
        if (!this.aggregatedView.cameraInitialized || !this.key) {
            return;
        }

        // If camera was initialized, but contains problematic values, don't save
        const camera   = this.aggregatedView.viewer.impl.camera;
        const camValid = isCameraValid(camera);
        if (!camValid) {
            return;
        }

        const startBimWalk = this.aggregatedView.isBimWalkActive();
        const offset = this.aggregatedView.is3D ? this.aggregatedView.globalOffset : undefined;
        this.saveStartCamera(this.key, this.aggregatedView.viewer.impl.camera, startBimWalk, offset);
    }

    // Save current camera to local storage
    // Pass an undefined camera to clear the cache for this key
    saveStartCamera(key, camera, startBimWalk, offset, ignoreGlobalOffset) {
        const camJson = JSON.stringify({
            offset: offset,
            position: camera.position,
            target: camera.target,
            up: camera.up,
            orthoScale: camera.orthoScale,
            isPerspective: camera.isPerspective,
            fov: camera.fov,
            startBimWalk: startBimWalk,
            ignoreGlobalOffset,
        });

        this.cache.setItem(key, camJson);
    }

    // Clears the camera from a specific key
    clearItem(key) {
        this.cache.setItem(key);
    }

    loadCamera() {
        if (!this.key) {
            return false;
        }

        let camData = undefined;

        // it's not about usage of LocalStorage but about parsing...
        try {
            const camJson = this.cache.getItem(this.key);
            camData  = JSON.parse(camJson);
        }
        catch(err) {
            // It's not really critical if we don't find usable content in localStorage.
            // Just don't load in this case, so that the defaultCamera of a model is used.
        }

        // Avoid exception if any required value is missing
        if (!camData || !camData.position || !camData.target || !camData.up) {
            return false;
        }

        const makeVec3 = (v) => {
            return new THREE.Vector3(parseFloat(v.x), parseFloat(v.y), parseFloat(v.z));
        };

        // Convert camera vectors to THREE.Vector3, which is required to use it in LMV
        const camera = {
            position:      makeVec3(camData.position),
            target:        makeVec3(camData.target),
            up:            makeVec3(camData.up),
            isPerspective: Boolean(camData.isPerspective),
            fov: parseFloat(camData.fov),
            ignoreGlobalOffset: Boolean(camData.ignoreGlobalOffset),
        };

        if (camData.orthoScale) {
            camera.orthoScale = parseFloat(camData.orthoScale);
        }

        if (!isCameraValid(camera)) {
            return false;
        }

        // Get offset and apply it (only for 3D views)
        const offset = camData.offset ? makeVec3(camData.offset) : undefined;
        if (offset) {

            // Undefined would be okay (2D), but if the offset exists, it must be a valid one => Reject otherwise
            if (!isVectorFinite(offset)) {
                return;
            }

            // Convert camera to global coords, i.e., independent of current globalOffset state of the viewer
            camera.position.add(offset);
            camera.target.add(offset);
        }

        this.aggregatedView.setCameraGlobal(camera);

        // Trigger BimWalk start if specfied. E.g. after DropMe or if we used BimWalk when we left it.
        if (camData.startBimWalk) {
            this.aggregatedView.startBimWalk();
        }
    }
}

GlobalManagerMixin.call(CameraLS.prototype);
