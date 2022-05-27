
import { Extension } from "../../src/application/Extension";


    /**
     * Use its `activate()` method to animate the camera back to its
     * default, home view. The extension doesn't provide any UI.
     *
     * The extension id is: `Autodesk.GoHome`
     *
     * @param {Viewer3D} viewer - Viewer instance
     * @param {object} options - Configurations for the extension
     * @example 
     * viewer.loadExtension('Autodesk.GoHome')
     * @memberof Autodesk.Viewing.Extensions
     * @alias Autodesk.Viewing.Extensions.GoHomeExtension
     * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
     * @class
     */
    export function GoHomeExtension(viewer, options) {
        Extension.call(this, viewer, options);
        this.viewer = viewer;
        this.options = options;
        this.name = "gohome";
    }
    GoHomeExtension.prototype = Object.create(Extension.prototype);
    GoHomeExtension.prototype.constructor = GoHomeExtension;

    var proto = GoHomeExtension.prototype;

    /**
     * Animates the camera back to its home location.
     * 
     * @memberof Autodesk.Viewing.Extensions.GoHomeExtension
     * @alias Autodesk.Viewing.Extensions.GoHomeExtension#activate
     */
    proto.activate = function() {
        this.viewer.navigation.setRequestHomeView(true);
        return true;
    };

     /**
      * It doesn't do anything.
      * 
      * @memberof Autodesk.Viewing.Extensions.GoHomeExtension
      * @alias Autodesk.Viewing.Extensions.GoHomeExtension#activate
      */
    proto.deactivate = function() {
        return false;
    };
