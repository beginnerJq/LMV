
    import { Extension } from "../../src/application/Extension";
    import { ViewerSettingTab } from "../../src/gui/ViewerSettingsPanel";


    /**
     * Use its `activate()` method to open the Settings UI.
     *
     * The extension id is: `Autodesk.ViewerSettings`
     *
     * @param {Viewer3D} viewer - Viewer instance
     * @param {object} options - Configurations for the extension
     * @example 
     * viewer.loadExtension('Autodesk.ViewerSettings')
     * @memberof Autodesk.Viewing.Extensions
     * @alias Autodesk.Viewing.Extensions.ViewerSettingsExtension
     * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
     * @class
     */
    export function ViewerSettingsExtension


    (viewer, options) {
        Extension.call(this, viewer, options);
        this.viewer = viewer;
        this.options = options;
        this.name = "viewersettings";
    }
    ViewerSettingsExtension.prototype = Object.create(Extension.prototype);
    ViewerSettingsExtension.prototype.constructor = ViewerSettingsExtension;

    var proto = ViewerSettingsExtension.prototype;

    /**
     * Opens the Settings UI.
     * 
     * @memberof Autodesk.Viewing.Extensions.ViewerSettingsExtension
     * @alias Autodesk.Viewing.Extensions.ViewerSettingsExtension#activate
     */
    proto.activate = function() {
        if(!this.activeStatus) {
            this.viewer.showViewer3dOptions(true);
            var panel = this.viewer.getSettingsPanel(true);
            panel.selectTab(ViewerSettingTab.Performance);
            this.activeStatus = true;
        }
        return true;
    };

    /**
     * Closes the Settings UI.
     * 
     * @memberof Autodesk.Viewing.Extensions.ViewerSettingsExtension
     * @alias Autodesk.Viewing.Extensions.ViewerSettingsExtension#deactivate
     */
    proto.deactivate = function() {
        if(this.activeStatus) {
            this.viewer.showViewer3dOptions(false);
            this.activeStatus = false;
        }
        return true;
    };
