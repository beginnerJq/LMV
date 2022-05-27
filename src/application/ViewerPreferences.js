
import { Prefs, Prefs2D, Prefs3D } from './PreferenceNames';
import { Preferences } from './Preferences';
/**
 * Viewer preferences.
 * 
 * extends Autodesk.Viewing.Private.Preferences
 *
 * @constructor
 * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer instance.
 * @param {object} options - Contains configuration parameters used to do initializations.
 * @param {boolean} [options.localStorage] - Whether values get stored and loaded back
 * from localStorage. Defaults to `true`.
 * @param {string} [options.prefix] - A string to prefix preference names in web storage.
 * Defaults to `'Autodesk.Viewing.ViewerPreferences.'`.
 * @alias Autodesk.Viewing.Private.ViewerPreferences
 */
export class ViewerPreferences extends Preferences {

  constructor(viewer, opts) {
    super(viewer, opts);
    const handlers = {
      [Prefs3D.VIEW_CUBE]: function onToggleViewCubeVisibility(value) {
        viewer.getExtension("Autodesk.ViewCubeUi", function (ext) {
          ext.displayViewCube(value);
        });
      },
      [Prefs3D.ALWAYS_USE_PIVOT]: viewer.setUsePivotAlways.bind(viewer),
      [Prefs3D.ORBIT_PAST_WORLD_POLES]: viewer.setOrbitPastWorldPoles.bind(viewer),
      [Prefs3D.ZOOM_TOWARDS_PIVOT]: viewer.setZoomTowardsPivot.bind(viewer),
      [Prefs.REVERSE_MOUSE_ZOOM_DIR]: viewer.setReverseZoomDirection.bind(viewer),
      [Prefs.LEFT_HANDED_MOUSE_SETUP]: viewer.setUseLeftHandedInput.bind(viewer),
      [Prefs3D.CLICK_TO_SET_COI]: viewer.setClickToSetCOI.bind(viewer),
      [Prefs.ZOOM_DRAG_SPEED]: function(value) {
        const dolly = viewer.toolController.getTool('dolly');
        dolly?.setDollyDragScale?.(value);
      },
      [Prefs.ZOOM_SCROLL_SPEED]: (value) => {
        const dolly = viewer.toolController.getTool('dolly');
        dolly?.setDollyScrollScale?.(value);
      },
      [Prefs3D.ANTIALIASING]: (checked) => viewer.setQualityLevel(this.get('ambientShadows'), checked),
      [Prefs3D.AMBIENT_SHADOWS]: (checked) => viewer.setQualityLevel(checked, viewer.prefs.get('antialiasing')),
      [Prefs3D.GROUND_SHADOW]: viewer.setGroundShadow.bind(viewer),
      [Prefs3D.GROUND_REFLECTION]: viewer.setGroundReflection.bind(viewer),
      [Prefs2D.SWAP_BLACK_AND_WHITE]: viewer.setSwapBlackAndWhite.bind(viewer),
      [Prefs3D.OPTIMIZE_NAVIGATION]: viewer.setOptimizeNavigation.bind(viewer),
      [Prefs.PROGRESSIVE_RENDERING]: viewer.setProgressiveRendering.bind(viewer),
      [Prefs.GHOSTING]: viewer.setGhosting.bind(viewer),
      [Prefs3D.LINE_RENDERING]: (checked) => viewer.hideLines(!checked),
      [Prefs.POINT_RENDERING]: (checked) => viewer.hidePoints(!checked),
      [Prefs3D.EDGE_RENDERING]: viewer.setDisplayEdges.bind(viewer),
      [Prefs3D.ENV_MAP_BACKGROUND]: viewer.setEnvMapBackground.bind(viewer),
      [Prefs3D.LIGHT_PRESET]: viewer.setLightPreset.bind(viewer),
    };

    Object.keys(handlers).forEach((prefName) => {
      this.addListeners(prefName, handlers[prefName]);
    });
  }
}
