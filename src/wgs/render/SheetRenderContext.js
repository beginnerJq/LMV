import SheetRenderVert from './shaders/sheet_render_vert.glsl';
import SheetRenderFrag from './shaders/sheet_render_frag.glsl';

// Used for pre-rendering the sheet into a different target, before placing it into the 3D scene.
export default class SheetRenderContext {
    constructor(viewerImpl, renderContext, glRenderer, materialManager) {
        this.viewerImpl = viewerImpl;
        this.renderContext = renderContext;
        this.glRenderer = glRenderer;

        this.materialManager = materialManager;
        this.materialName = '__material_2Don3D__';

        this.tmpVec = new THREE.Vector3();
        this.tmpBox = new THREE.Box3();
    }

    createContext() {
        this.sheetContext = new Autodesk.Viewing.Private.RenderContext();
        this.sheetContext.init(this.glRenderer, this.renderContext.settings.logicalWidth, this.renderContext.settings.logicalHeight, { offscreen: true });

        const config = this.renderContext.getConfig();
        // Disable unneeded things. Set background color to transparent.
        config.antialias = false;
        config.renderEdges = false;
        config.clearAlpha = 0;
        if (config.clearColor) {
            config.clearColor.set(1, 1, 1);
        } else {
            config.clearColorBottom.set(1, 1, 1);
            config.clearColorTop.set(1, 1, 1);
        }
        this.sheetContext.applyConfig(config);

        this.prototypeScene = new THREE.Scene();
    }

    setSize(context = this.renderContext) {
        if (!this.sheetContext) {
            return;
        }

        this.sheetContext.setSize(context.settings.logicalWidth, context.settings.logicalHeight);
        this.updateMaterial();
    }

    // Creates a scene for the plane geometry to sit on
    createScene() {
        this.setSize();

        this.scene = new THREE.Scene();
        // Create unit size mesh. The size will be set by setting the scale
        this.planeGeometry = new THREE.PlaneBufferGeometry(1, 1);

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                sheetMap: { type: 't', value: this.sheetContext.getColorTarget() },
                idMap: { type: 't', value: this.sheetContext.getIDTargets()[0] },
                modelIDv2: { type: 'v3', value: new THREE.Vector3() },
                resolution: { type: 'v2', value: new THREE.Vector2() },
                alphaTest: { type: 'f', value: 0 },
            },
            vertexShader: SheetRenderVert,
            fragmentShader: SheetRenderFrag,
            side: THREE.DoubleSide,
            transparent: true
        });
        this.scene.skipDepthTarget = true;
        
        this.updateMaterial();

        this.materialManager.addMaterialNonHDR(this.materialName, this.material);

        this.mesh = new THREE.Mesh(this.planeGeometry, this.material);
        this.mesh.matrixAutoUpdate = false;
        this.scene.add(this.mesh);
    }

    updateMaterial() {
        if (this.material) {
            const target = this.sheetContext.getColorTarget();
            // Update because in resize the targets will be recreated
            this.material.uniforms.sheetMap.value = target;
            this.material.uniforms.idMap.value = this.sheetContext.getIDTargets()[0];
            this.material.uniforms.resolution.value.set(1 / (target.width || 1), 1 / (target.height || 1));
        }
    }

    // The sheet is rendered onto a separate buffer, without depth testing. This buffer is then used as a texture
    // which is projected onto a plane, that matches the pose and size of the original plane. This way, we can have
    // depth testing for the sheet so it blends correctly with the 3D model, while avoiding artifacts created by
    // rendering the sheet regularly with depth testing on
    // Optional context is e.g. for printing where the context is different
    renderScenePart(originalScene, wantColor, wantSAO, wantID, context = this.renderContext) {
        if (!originalScene.frags || !originalScene.frags.is2d) {
            return;
        }

        if (!this.sheetContext) {
            this.createContext();
        }

        if (!this.scene) {
            this.createScene();
        }

        // For first pass, discard any pixels that have opacity <= 0.9, i.e. draw only opaque ones
        // For second (or if has only one pass), discard only pixels with opacity 0
        this.material.uniforms.alphaTest.value = (!originalScene.needsTwoPasses || originalScene.isSecondPass) ? 0 : 0.9;

        const modelId = originalScene.modelId;
        const model = this.viewerImpl.modelQueue().findModel(modelId);
        
        const boundingBox = this.tmpBox.copy(model.getBoundingBox(true));
        const vpBounds = model.getViewportBounds();
        if (vpBounds) {
            boundingBox.intersect(vpBounds);
        }

        const transform = model.getModelToViewerTransform();
        
        // Encode model id into vector
        this.material.uniforms.modelIDv2.value.set((modelId & 0xFF) / 255,
                                                ((modelId >> 8) & 0xFF) / 255,
                                                ((modelId >> 16) & 0xFF) / 255);

        // If AO has changed, the post pipeline needs to be reinit
        if (context.getAOEnabled() !== this.sheetContext.getAOEnabled()) {
            this.sheetContext.initPostPipeline(context.getAOEnabled(), false);
        }
        wantID = wantID && model.areAllVisible();
        wantSAO = false; // AO doesn't work with the line renderer, and it's not needed anyway, so just disable it
        
        // Render original scene to separate buffer
        // In case of rendering two passes, this stage will be the same for both, so we can skip it for
        // a performance improvement
        const skipIntermediateTarget = this.lastRenderedModel === model && originalScene.isSecondPass;
        if (!skipIntermediateTarget) {
            this.sheetContext.beginScene(this.prototypeScene, this.viewerImpl.camera, this.viewerImpl.noLights, true);
            this.sheetContext.renderScenePart(originalScene, wantColor, wantSAO, wantID, false);
            this.sheetContext.presentBuffer();
        }


        // Update mesh with this scene's model's bounds
        // First set original bounds and location
        // Then apply transform
        const size = boundingBox.getSize(new THREE.Vector3());
        this.mesh.matrix.makeScale(size.x, size.y, 1.0);
        boundingBox.getCenter(this.tmpVec);
        this.mesh.matrix.setPosition(this.tmpVec);
        if (transform) {
            this.mesh.matrix.multiplyMatrices(transform, this.mesh.matrix);
        }
    
        this.mesh.matrixWorld.copy(this.mesh.matrix);
        // Now render mesh with projected texture
        this.scene.modelId = modelId;
        context.renderScenePart(this.scene, wantColor, wantSAO, wantID);

        this.lastRenderedModel = model;
    }

    destroy() {
        if (this.material) {
            this.material.dispose();
            this.materialManager.removeNonHDRMaterial(this.materialName);
            this.material = null;
        }

        if (this.planeGeometry) {
            this.planeGeometry.dispose();
            this.planeGeometry = null;
        }

        if (this.sheetContext) {
            this.sheetContext.cleanup();
            this.context = null;
        }

        this.renderContext = null;
        this.glRenderer = null;

    }
}
