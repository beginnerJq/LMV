


// Used by WebGLRenderer to make sure that all outdated WebGL resources are refreshed when rendering
// after a webgl lost context event.
export default class LostContextRecovery {

    // Note: By design, a LostContextRecovery is only created if >=1 context-lost events actually happened.
    constructor() {
        this.webglContextId = 1;
    }

    // Called on webgl context restore: Increases the timestamp to ensure that any
    // older WebGL resources are refreshed.
    onContextRestored() {
        this.webglContextId++;
    }

    refreshTargetIfNeeded(target) {

        this.refreshIfNeeded(target);

        // For targets, we must also make sure that the shared
        // depth target does not sneak in outdated webgl data
        const depthTarget = target?.shareDepthFrom;
        this.refreshIfNeeded(depthTarget);
    }

    refreshTargetsIfNeeded(targets) {
        // handle arrays
        if (Array.isArray(targets)) {
            for (var i=0; i<targets.length; i++) {
                this.refreshTargetIfNeeded(targets[i]);
            }
        } else {
            this.refreshTargetIfNeeded(targets);
        }
    }

    // Called by WebGLRenderer for various resources (Mesh, BufferGeometry, Texture, WebGLTargets) 
    refreshIfNeeded(obj) {

        // Most frequent case: Nothing to do
        if (!obj || obj.__webglContextId === this.webglContextId) {
            return false;
        }

        // Since LostContextRecovery is only used if >=1 context-lost already happened, we cannot distinguish
        // whether a resource belongs to a previous renderContext or is completely new. But, for a new one,
        // clearing it has no effect anyway.

        // Clear outdated gl data and make sure it is updated
        this._refreshGlData(obj);

        // Update contextId: This object is now ready to be used with the latest webgl context
        obj.__webglContextId = this.webglContextId;
    }

    _refreshGlData(obj) {
        if (obj instanceof THREE.Mesh)              this._refreshMeshGlData(obj);
        if (obj instanceof THREE.BufferGeometry)    this._refreshBufferGeometryGlData(obj);
        if (obj instanceof THREE.WebGLRenderTarget) this._refreshTargetGlData(obj);
        if (obj instanceof THREE.Texture)           this._refreshTextureGlData(obj);
        if (obj instanceof THREE.Material)          this._refreshMaterialGlData(obj);
    }

    _refreshMeshGlData(mesh) {
        if (mesh.__webglActive)         mesh.__webglActive        = undefined;
        if (mesh.geometry?.__webglInit) mesh.geometry.__webglInit = undefined; 
    }

    _refreshBufferGeometryGlData(geom) {

        if (geom.__webglInit)   { geom.__webglInit   = undefined; geom.needsUpdate = true; }
        if (geom.vbbuffer)      { geom.vbbuffer      = undefined; geom.needsUpdate = true; }
        if (geom.ibbuffer)      { geom.ibbuffer      = undefined; geom.needsUpdate = true; }
        if (geom.iblinesbuffer) { geom.iblinesbuffer = undefined; geom.needsUpdate = true; }
        if (geom.vaos)          { geom.vaos          = undefined; geom.needsUpdate = true; }
    
        for (let key in geom.attributes ) {
            const attrib = geom.attributes[key];
            if (attrib.buffer) {
                attrib.buffer = undefined;
                geom.needsUpdate = true;
            }
        }
    }

    _refreshTargetGlData(target) {
        if (target.__webglFramebuffer)  target.__webglFramebuffer  = null;
        if (target.__webglRenderbuffer) target.__webglRenderbuffer = null;
        if (target.__webglBoundBuffers) target.__webglBoundBuffers = null;
        if (target.__webglTexture)      target.__webglTexture      = null;
    }

    _refreshTextureGlData(tex) {
        if (tex.__webglInit)        { tex.__webglInit        = undefined; tex.needsUpdate = true; }
        if (tex.__webglTexture)     { tex.__webglTexture     = undefined; tex.needsUpdate = true; }
        if (tex.__webglTextureCube) { tex.__webglTextureCube = null;      tex.needsUpdate = true; }
    }

    _refreshMaterialGlData(mat) {

        if (!mat.program && !mat.programs) {
            return;
        }

        mat.program = null;
        mat.programs = [];
        mat.needsUpdate = true;
    }
}

// Called on webglcontext lost: Discard model consolidations on GPU and remember the ids of each such model
export const unconsolidateModels = (viewer) => {
    const unconsolidatedModels = {};

    viewer.getAllModels().forEach(m => {
        if (m.isConsolidated()) {
            m.unconsolidate();
            unconsolidatedModels[m.id] = true;
        }
    });
    return unconsolidatedModels;
};

// Called on webglcontext restore: Recompute consolidation for all models that we unconsolidated before.
export const reconsolidateModels = (viewer, unconsolidatedModels) => {

    // recompute consolidations
    viewer.getAllModels().forEach(m => {
        if (unconsolidatedModels[m.id]) {
            viewer.impl.consolidateModel(m);
        }
    });
};

