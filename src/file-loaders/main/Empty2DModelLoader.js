// Empty2DModelLoader - Loader for an empty 2D scene.
export class Empty2DModelLoader {
    constructor(viewer3DImpl) {
        this.viewer3DImpl = viewer3DImpl;
    }

    loadFile(url, options = {}, onDone, onWorkerStart) {
        const width = options.width || 100;
        const height = options.height || 100;

        onWorkerStart && onWorkerStart();

        this.svf = {
            is2d: true,
            viewports: [],
            layersMap: { "0": 0 },
            layerCount: 1,
            bbox: new THREE.Box3(new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(width, height, 0)),
            fragments: {
                length: 1,
                fragId2dbId: [0],
                dbId2fragId: {},
                transforms: new Float32Array(12),
                boxes: [0, 0 , 0, width, height, 0]
            },
            loadOptions: {
                bubbleNode: new Autodesk.Viewing.BubbleNode({
                    urn: 'Dummy_urn',
                    guid: 'Dummy_guid'
                })
            },
            metadata: {
                page_dimensions: {
                    page_width: width,
                    page_height: height,
                    logical_width: width,
                    logical_height: height,
                    logical_offset_x: 0,
                    logical_offset_y: 0,
                    page_units: "inch"
                }
            },
            strings: [],
            stringDbIds: [],
            loadDone: true
        };

        const model = new Autodesk.Viewing.Model(this.svf);

        model.initialize();
        model.loader = this;
        this.model = model;
        onDone(null, model);
        this.viewer3DImpl.api.dispatchEvent({ type: Autodesk.Viewing.MODEL_ROOT_LOADED_EVENT, svf:this.svf, model:model });
        this.viewer3DImpl.onLoadComplete(model);
    }

    dtor() {}
    is2d() { return true; }
    is3d() { return false; }
}
