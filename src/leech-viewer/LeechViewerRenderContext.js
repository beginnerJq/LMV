import { RenderContext } from "../wgs/render/RenderContext";

// LeechViewerRenderContext uses a shared webglRenderer in order to render.
// Instead of rendering directly into the canvas, render into webglRenderer's shared canvas (renderer.domElement),
// and then copy it into a 2D canvas.

export default function LeechViewerRenderContext(canvas) {
    Autodesk.Viewing.Private.RenderContext.call(this);

    this.originalInit = this.init.bind(this);
    this.init = function (glrenderer, width, height, options = {}) {
        this.canvas = canvas;
        this.ctx2D = this.canvas.getContext('2d');

        // offscreen has to be set to true in order that setSize won't cause the renderer's canvas to scale on each frame.
        const initOptions = Object.assign({}, options, { offscreen: true });

        this.originalInit(glrenderer, width, height, initOptions);
    
        this.glrenderer = glrenderer;
    
        const pixelRatio = this.glrenderer.getPixelRatio();
    
        this.setSize(width / pixelRatio, height / pixelRatio);
    };

    this.renderToCanvas = function () {
        // Init wasn't called yet.
        if (!this.ctx2D) {
            return;
        }

        // Don't render on main canvas if the target was offscreen.
        if (this.getOffscreenTarget()) {
            return;
        }

        // Skip if canvas has zero-size. Otherwise, Safari crashes in drawImage
        // with "IndexSizeError: The index is not in the allowed range.".
        if (this.widthWithPixelRatio == 0 || this.heightWithPixelRatio == 0) {
            return;
        }

        // consider using 'webgl' context in order to copy the output:
        // https://webglfundamentals.org/webgl/lessons/webgl-2d-drawimage.html

        // Clean canvas (needed in case the background is transparent)
        this.ctx2D.clearRect(0, 0, this.widthWithPixelRatio, this.heightWithPixelRatio);

        // Copy pixels from renderer's canvas to the viewer's 2D canvas.
        this.ctx2D.drawImage(
                this.glrenderer.domElement,
                0, this.glrenderer.domElement.height - this.heightWithPixelRatio,   // Copy only pixels that relevant to the current context.
                                                                                    // Renderer canvas might be bigger this the current viewer canvas.
                this.widthWithPixelRatio, this.heightWithPixelRatio,
                0, 0,
                this.widthWithPixelRatio, this.heightWithPixelRatio
            );
    };
    
    this.originalSetSize = this.setSize.bind(this);
    this.setSize = function(width, height, force, suppress) {
        if (!suppress) {
            const pixelRatio = this.glrenderer.getPixelRatio();

            this.width = width;
            this.height = height;
            this.widthWithPixelRatio = width * pixelRatio;
            this.heightWithPixelRatio = height * pixelRatio;

            this.canvas.width = this.widthWithPixelRatio;
            this.canvas.height = this.heightWithPixelRatio;
            this.canvas.style.width = `${this.width}px`;
            this.canvas.style.height = `${this.height}px`;
        }
    
        this.prepareViewport(force, suppress);
        this.restoreViewport();
    };

    this.prepareViewport = function(force, suppress) {
        this.glrenderer.pushViewport();

        // Change glrenderer canvas size only if it needs to be larger.
        // The heuristic is - expand the renderer's canvas dimensions according to the largest viewer's canvas dimensions.
        const pixelRatio = this.glrenderer.getPixelRatio();
        const rendererCanvasWidth = this.glrenderer.domElement.width / pixelRatio;
        const rendererCanvasHeight = this.glrenderer.domElement.height / pixelRatio;

        if (rendererCanvasWidth < this.width || rendererCanvasHeight < this.height) {            
            this.glrenderer.setSize(Math.max(this.width, rendererCanvasWidth), Math.max(this.height, rendererCanvasHeight));
        }

        this.originalSetSize(this.width, this.height, force, suppress);        
    };

    this.restoreViewport = function() {
        this.glrenderer.popViewport();
    };
}

LeechViewerRenderContext.prototype = Object.create(RenderContext.prototype);
LeechViewerRenderContext.prototype.constructor = LeechViewerRenderContext;
