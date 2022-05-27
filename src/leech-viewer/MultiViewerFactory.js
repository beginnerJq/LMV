import { createLeechViewer } from './LeechViewer';
import { MaterialManager } from "../wgs/render/MaterialManager";

// MultiViewerFactory - encapsulates the creation leech viewer.
export class MultiViewerFactory {
    constructor() {
        const glrenderer = Autodesk.Viewing.Private.createRenderer(undefined, { alpha: true });
        const materialManager = new MaterialManager(glrenderer);

        // Map of all the models that are already loaded some viewer.
        // Each item contains the model instance, and a counter of how many viewer's are using it.
        const loadedModels = {};
        
        this.sharedResources = {
            glrenderer,
            materialManager,
            loadedModels
        };
    }

    createViewer(container, config, ViewerClass = Autodesk.Viewing.Viewer3D) {
        return createLeechViewer(container, config, this.sharedResources, ViewerClass);
    }

    destroy() {
        this.sharedResources = null;
    }
}
