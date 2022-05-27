
import { Extension } from "../../src/application/Extension";


    /**
     * Use its `activate()` method to enter fullscreen mode.
     * It performs the same action as the toolbar's fullscreen button.
     *
     * The extension id is: `Autodesk.FullScreen`
     *
     * @param {Viewer3D} viewer - Viewer instance
     * @param {object} options - Configurations for the extension
     * @example 
     * viewer.loadExtension('Autodesk.FullScreen')
     * @memberof Autodesk.Viewing.Extensions
     * @alias Autodesk.Viewing.Extensions.FullScreenExtension
     * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
     * @class
     */
    export function FullScreenExtension(viewer, options) {
        Extension.call(this, viewer, options);
        this.viewer = viewer;
        this.options = options;
        this.name = "fullscreen";
    }
    FullScreenExtension.prototype = Object.create(Extension.prototype);
    FullScreenExtension.prototype.constructor = FullScreenExtension;

    var proto = FullScreenExtension.prototype;

    /**
     * Enters fullscreen mode.
     * 
     * @memberof Autodesk.Viewing.Extensions.FullScreenExtension
     * @alias Autodesk.Viewing.Extensions.FullScreenExtension#activate
     */
    proto.activate = function() {
        if(!this.activeStatus) {
            this.viewer.nextScreenMode();
            this.activeStatus = true;
        }
        return true;
    };

    /**
     * Exits fullscreen mode.
     * 
     * @memberof Autodesk.Viewing.Extensions.FullScreenExtension
     * @alias Autodesk.Viewing.Extensions.FullScreenExtension#deactivate
     */
    proto.deactivate = function() {
        if(this.activeStatus) {
            this.viewer.escapeScreenMode();
            this.activeStatus = false;
        }
        return true;
    };

