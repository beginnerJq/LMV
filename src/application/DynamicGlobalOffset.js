const avp = Autodesk.Viewing.Private;

let _tmpMatrix1 = null;
let _tmpMatrix2 = null;
let _tmpMatrix3 = null;

export class DynamicGlobalOffset {

    constructor(viewer) {
        this.viewer = viewer;

        // If true, globalOffset is updated automatically
        this.enabled = false;
    
        // Bind handler to make it usable as event listener
        this.onCameraChanged = this.onCameraChanged.bind(this);

        // Reset globalOffset as soon as camera position is >= 10 000 units from origin.
        let maxDist = 10000;
        this.maxDistSq = maxDist * maxDist;

        this.setActive(true);
    }

    setActive(enabled) {
        if (enabled == this.enabled) {
            return;
        }
        this.enabled = enabled;

        // Add/remove listener for camera changes
        if (enabled) {
            this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChanged);
        } else {
            this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChanged);
        }
    }

    // Recompute model matrix so that the model is shifted from its placement at load time
    // to the given new placement.
    static updateModelMatrix(model, newPlacement, newOffset) {

        // Use 64-bit precision during computation
        // tmp matrices
        _tmpMatrix1 = _tmpMatrix1 || new avp.LmvMatrix4(true);
        _tmpMatrix2 = _tmpMatrix2 || new avp.LmvMatrix4(true);
        _tmpMatrix3 = _tmpMatrix3 || new avp.LmvMatrix4(true);
        
        // If modelMatrix is set to identity, only the load-time transforms are applied to the model, i.e.
        //  1. load-time placement is applied:    model.myData.placementTransform is applied
        //  2. load-time globaloffset is applied: model.myData.globalOffset is subtracted

        // Our goal is to undo the steps above and apply the new placementTransform and new globalOffset instead.
        // Therefore, the model transform must combine the following 4 steps:
        //  1. undo load-time globalOffset
        //  2. undo load-time placement
        //  3. apply new placement
        //  4. apply new globalOffset

        // Get inverse of placementWithOffset at loadTime. This matrix applies steps 1. and 2.
        // placementWithOffset may be null
        const ptoLoadInv = model.myData.placementWithOffset ? _tmpMatrix1.copy(model.myData.placementWithOffset).invert() : _tmpMatrix1.identity();

        // Get placementWithOffset based on new placement/offset. This matrix applies steps 3. and 4.
        const ptoNew = newPlacement ? _tmpMatrix2.copy(newPlacement) : _tmpMatrix2.identity();
        if (newOffset) {
            ptoNew.elements[12] -= newOffset.x;
            ptoNew.elements[13] -= newOffset.y;
            ptoNew.elements[14] -= newOffset.z;
        }
        // Apply ptoLoadTimeInv first, then ptoNew
        const modelMatrix = _tmpMatrix3.multiplyMatrices(ptoNew, ptoLoadInv);
        model.setModelTransform(modelMatrix);
    }

    // Checks if the camera is too far from the origin. If so, it resets the globalOffset, so
    // that the camera is at the origin in viewer coordinates.
    //  @param {Viewer3D} viewer
    //  @param {boolean}    force  - always reset globalOffset, even if the camera position is close to the viewer-coords origin
    onCameraChanged() {

        // GlobalOffset is only defined for 3d models
        if (this.viewer.impl.is2d) {
            return;
        }

        // Ignore camera-change events that we trigger ourselves
        if (this.blockEvents) {
            return;
        }

        // If we are orbiting, defer update until drag is over. This avoids the need to care about changing
        // offsets in the middle of a drag-interaction. Note for some ugly ortho start-cameras, the model
        // may look close but is actually far way, so that it may happen that the offset changes several times
        // while actually orbiting around an object that just seems 10m away.
        const orbit = this.viewer.toolController.getTool('orbit');
        if (orbit?.isDragging) {
            return;
        }

        if (this.viewer.impl.camera.position.lengthSq() < this.maxDistSq) {
            return;
        }

        // avoid recursive calls
        this.blockEvents = true;

        // Use camera position in world-coords as globalOffset
        const camPosGlobal = this.viewer.impl.camera.getGlobalPosition();
        this.resetGlobalOffset(camPosGlobal);

        this.blockEvents = false;
    }

    /**
     * Reset global offset of all models. Only used for 3d.
     */
    resetGlobalOffset(newOffset) {

        // apply new offset to all visible models 
        this.viewer.getVisibleModels().forEach(model => {
            model.setGlobalOffset(newOffset);
            this.viewer.impl.onModelTransformChanged(model);
        });

        // Due to the modified global offset, all models have been shifted.
        // So, we must apply the same shift to the camera.
        this.viewer.impl.camera.setGlobalOffset(newOffset);
        this.viewer.impl.syncCamera();

        // notify autocam
        this.viewer.autocam && this.viewer.autocam.onGlobalOffsetChanged(newOffset);

        // Make sure that positions in autocam are reset to new viewer coordinate system (e.g. autocam.center).
        this.viewer.autocam.sync(this.viewer.impl.camera);
    }
}
