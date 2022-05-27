/**
 * During refactor of NPR feature out of the render context
 * Created the RenderContextExtension as base interface class for extension developers to consume
 * 
 * And we will integrate the RenderContextExtension into main RenderContext as a valid extension 
 * to allow other developers to implement their own post process rendering effect
 * 
 */
class RenderContextPostProcessExtension {
    constructor(renderContext, viewer) {
        this.viewer = viewer;
        this.renderContext = renderContext;
        this.postProcPass = null;
        this.postProcShaded = false;

        this.setGlobalManager(viewer.globalManager);
    }

    /**
     * lifecycle function
     */
    load() {
    }

    /**
     * lifecycle function
     */
    unload() {
        this.viewer = null;
        this.renderContext = null;
        this.postProcPass = null;
    }

    /**
     * Enable post processing pass
     */
    enable() {
        this.setPostProcShaded(true);

        const _settings = this.renderContext.settings;

        this.renderContext.initPostPipeline(_settings.sao, _settings.antialias);

        // Necessary in order to update MRT flags.
        this.viewer.impl.fireRenderOptionChanged();

        this.viewer.impl.invalidate(true, true, true);
    }

    /**
     * Disable post processing pass
     */
    disable() {
        this.setPostProcShaded(false);

        this.viewer.impl.invalidate(false, false, true);
    }

    shouldRenderAfterOverlays() {
        return false;
    }

    /**
     * Render function
     * @param {WebGLRender} renderer 
     * @param {WebGLRenderTarget} outTarget 
     * @param {WebGLRenderTarget} inTarget 
     * @param {WebGLRenderTarget} overlaysRendered
     */
    render(renderer, outTarget, inTarget, overlaysRendered) {
        const overlaysRenderedVerified = overlaysRendered === undefined || overlaysRendered === this.shouldRenderAfterOverlays();
        const shouldRender = this.isPostProcShaded() && overlaysRenderedVerified;

        if (shouldRender) {
            this.postProcPass.render(renderer, outTarget, inTarget);
            return true;
        }
        
        return false;
    }

    /**
     * Change shader uniform value
     * @param {string} key 
     * @param {any} value 
     * @param {boolean} usingCopy 
     */
    updateUniformValue(key, value, usingCopy) {
        if (!this.postProcPass.uniforms[key]) {
            return;
        }

        if (usingCopy) {
            this.postProcPass.uniforms[key].value.copy(value);
        } else {
            this.postProcPass.uniforms[key].value = value;
        }

        this.viewer.impl.invalidate(false, false, true);
    }

    /**
     * Change shader define value
     * @param {string} key 
     * @param {any} value 
     */
    updateDefineValue(key, value) {
        if (this.postProcPass.material.defines[key] !== value) {
            if (value !== null) {
                this.postProcPass.material.defines[key] = value;    
            } else {
                delete this.postProcPass.material.defines[key];
            }

            this.setMaterialNeedsUpdate();
        }
    }

    /**
     * Get uniform value
     */
    getUniformValue(key) {
        return this.postProcPass.uniforms[key].value;
    }

    /**
     * Get define value
     */
    getDefineValue(key) {
        return this.postProcPass.material.defines[key];
    }

    /**
     * Update RenderPass resolutions
     * @param {int} resX 
     * @param {int} resY 
     */
    changeResolution (resX, resY) {
       this.postProcPass.uniforms["resolution"].value.set(resX, resY);
    }

    /**
     * Call when we need to update the material
     */
    setMaterialNeedsUpdate() {
        this.postProcPass.material.needsUpdate = true;
        this.viewer.impl.invalidate(false, false, true);
    }

    /**
     * return true if the edges on
     * @returns boolean
     */
    postProcessEdgesOn() {
        return false;
    }

    setPostProcShaded(enable) {
        this.postProcShaded = enable;
    }

    // Is post process enabled.
    isPostProcShaded() {
        return this.postProcShaded;
    }

    // Used to determine the order of rendering.
    getOrder() {
        return 0;
    }
}

/**
 * This class is used to work as an RenderContext Post Processing Shading Manager
 * 
 */
class RenderContextPostProcessManager {

    constructor() {
        // RenderContext extensions array.
        this.rcExtensions = [];
    }
    /**
     * Register the real PostProcessExtension instance
     * 
     * @param {RenderContextPostProcessExtension} rcExtension 
     */
    registerPostProcessingExtension(rcExtension) {
        this.rcExtensions.push(rcExtension);

        // Sort according to extension's order. The lower the order value the sooner it will get renderer.
        this.rcExtensions.sort((a, b) => b.getOrder() - a.getOrder());
    }

    /**
     * Remove the PostProcessExtension instance
     */
    removePostProcessingExtension(rcExtension) {
        const index = this.rcExtensions.indexOf(rcExtension);

        if (index !== -1) {
            rcExtension.unload();
            this.rcExtensions.splice(index, 1);
        }
    }

    render(renderer, outTarget, inTarget, tmpTarget, overlaysRendered) {
        for (let i = 0; i < this.rcExtensions.length; i++) {
            const rendered = this.rcExtensions[i].render(renderer, outTarget, inTarget, overlaysRendered);

            // Swap targets in order to accumulate the passes.
            if (rendered) {
                inTarget = outTarget;

                const t = outTarget;
                outTarget = tmpTarget;
                tmpTarget = t;
            }
        }

        return inTarget;
    }

    updateUniformValue(key, value, usingCopy) {
        for (let i = 0; i < this.rcExtensions.length; i++) {
            this.rcExtensions[i].updateUniformValue(key, value, usingCopy);
        }
    }

    changeResolution(resX, resY) {
        for (let i = 0; i < this.rcExtensions.length; i++) {
            this.rcExtensions[i].changeResolution(resX, resY);
        }
    }

    setMaterialNeedsUpdate() {
        for (let i = 0; i < this.rcExtensions.length; i++) {
            this.rcExtensions[i].setMaterialNeedsUpdate();
        }
    }

    postProcessEdgesOn() {
        return this.rcExtensions.some((ext) => ext.postProcessEdgesOn());
    }

    isPostProcShaded() {
        return this.rcExtensions.some(ext => ext.isPostProcShaded());
    }

}

export { RenderContextPostProcessExtension, RenderContextPostProcessManager };