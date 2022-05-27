import { Extension } from "../../src/application/Extension";
import { ExplodeTool } from './ExplodeTool';
import { ExplodeUI } from './ExplodeUI';

var avp = Autodesk.Viewing.Private;

/**
 * Use its `activate()` method to enable the explode UI.
 *
 * The extension id is: `Autodesk.Explode`
 *
 * @param {Viewer3D} viewer - Viewer instance
 * @param {object} options - Configurations for the extension
 * @example 
 * viewer.loadExtension('Autodesk.Explode')
 * @memberof Autodesk.Viewing.Extensions
 * @alias Autodesk.Viewing.Extensions.ExplodeExtension
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @class
 */
export class ExplodeExtension extends Extension{
    constructor(viewer, options) {
        super(viewer, options);
        this.viewer = viewer;
        this.options = options;
        this.name = "explode";
        
        this.tool = null;
        this.explodeUI = null;
    }

    /**
     * Initializes and registers the ExplodeTool.
     * 
     * @memberof Autodesk.Viewing.Extensions.ExplodeExtension
     * @alias Autodesk.Viewing.Extensions.ExplodeExtension#load
     */
    load() {
        this.tool = new ExplodeTool(this.viewer);    
        this.viewer.toolController.registerTool(this.tool, this.setActive.bind(this));
        // No matter whether the UI initializes, the extension always loads.
        return true;
    }

    /**
     * Deactivate the extension, deregister the ExplodeTool, and remove the UI from the toolbar.
     * 
     * @memberof Autodesk.Viewing.Extensions.ExplodeExtension
     * @alias Autodesk.Viewing.Extensions.ExplodeExtension#unload
     */
    unload() {
        this.deactivate();
        
        if (this.explodeUI) {
            this.explodeUI.destroy();
            this.explodeUI = null;
        }

        this.viewer.toolController.deregisterTool(this.tool);
        this.tool = null;

        return true;
    }

    /**
     * Invoked by the viewer when the toolbar UI is available.
     *
     * @param {Autodesk.Viewing.UI.ToolBar} toolbar - toolbar instance.
     *
     * @alias Autodesk.Viewing.Extensions.ExplodeExtension#onToolbarCreated
     */
    onToolbarCreated(toolbar) {
        this.explodeUI = new ExplodeUI(this, toolbar);
    }

    /**
     * Activates the tool and UI.
     * 
     * @memberof Autodesk.Viewing.Extensions.ExplodeExtension
     * @alias Autodesk.Viewing.Extensions.ExplodeExtension#activate
     */
    activate() {
        if (this.isActive())
            return true;

        if (!this.explodeUI)
            return false;
        
        this.explodeUI.activate();

        this.viewer.toolController.activateTool("explode");

        return true;
    }

    /**
     * Hides the explode UI and deactivates the ExplodeTool (resets the explode scale).
     * 
     * @memberof Autodesk.Viewing.Extensions.ExplodeExtension
     * @alias Autodesk.Viewing.Extensions.ExplodeExtension#deactivate
     */
    deactivate() {
        if (!this.isActive())
            return true;

        if (!this.explodeUI)
            return true;
        
        this.explodeUI.deactivate();

        this.viewer.toolController.deactivateTool("explode"); // Resets the UI slider via event handler.
        
        return true;
    }

    /**
     * @returns {boolean} true if the ExplodeTool is active.
     *
     * @memberof Autodesk.Viewing.Extensions.ExplodeExtension
     * @alias Autodesk.Viewing.Extensions.ExplodeExtension#isActive
     */
    isActive() {
        return this.tool.isActive();
    }

    /**
     * @returns {number} Between 0 and 1.
     *
     * @memberof Autodesk.Viewing.Extensions.ExplodeExtension
     * @alias Autodesk.Viewing.Extensions.ExplodeExtension#getScale
     */
    getScale() {
        return this.tool.getScale();
    }

    /**
     * Applies an explode operation.
     *
     * @param {number} value - Between 0 and 1.
     *
     * @memberof Autodesk.Viewing.Extensions.ExplodeExtension
     * @alias Autodesk.Viewing.Extensions.ExplodeExtension#setScale
     */
    setScale(value) {
        return this.tool.setScale(value);
    }

    /**
     * Specifies the algorithm used for exploding models.
     * 
     * @param {string} strategy - Either 'hierarchy' or 'radial'.
     *
     * @memberof Autodesk.Viewing.Extensions.ExplodeExtension
     * @alias Autodesk.Viewing.Extensions.ExplodeExtension#setStrategy
     */
    setStrategy(strategy) {
        if (strategy !== this.getStrategy()) {
            this.viewer.prefs.set(avp.Prefs3D.EXPLODE_STRATEGY, strategy);
        }
    }

    /**
     * Returns an identifier for the algorithm used for exploding models.
     * 
     * @returns {string} 
     *
     * @memberof Autodesk.Viewing.Extensions.ExplodeExtension
     * @alias Autodesk.Viewing.Extensions.ExplodeExtension#getStrategy
     */
    getStrategy() {
        return this.viewer.prefs.get(avp.Prefs3D.EXPLODE_STRATEGY);
    }

    /**
     * Enable / Disable the explode button & slider.
     * Doesn't affect the state of the explode scale itself.
     *
     * @param {boolean} enable - enable / disable the UI.
     * 
     * @memberof Autodesk.Viewing.Extensions.ExplodeExtension
     * @alias Autodesk.Viewing.Extensions.ExplodeExtension#setUIEnabled
     */
    setUIEnabled(enable) {
        this.explodeUI.setUIEnabled(enable);
        if (!enable)
            this.tool.deactivate(false); // Resets the UI slider via event handler.
    }
}
