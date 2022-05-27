
require("core-js");
require("regenerator-runtime/runtime");

//Initializes the global Autodesk namespace, required by GUI and  extensions
//Also exports the Autodesk namespace from the node module for new/future code to use.
module.exports.Autodesk = require('./module-prefix').Autodesk;

function _export(m, ns) {
    for (var prop in m) {
        if (Object.prototype.hasOwnProperty.call(m, prop)) {
            //Export directly into the module (e.g. for node.js use, where LMV is used via require instead from global namespace)
            module.exports[prop] = m[prop];

            //Export into the desired viewer namespace
            if (ns)
                module.exports[ns][prop] = m[prop];
        }
    }
}

var _extend = Object.assign || function(target, source) {
    for (var prop in source) {
        if (Object.prototype.hasOwnProperty.call(source, prop)) {
            target[prop] = source[prop];
        }
    }
};


//Add the global exports to expose the libraries to code that's not yet modular.
module.exports.THREE = require('three');


//Create the two target namespaces for the module exports
//This is mostly for backwards API compatibility, telling which
//global namespace to put each export in once included from the web build.
module.exports.av = {};
module.exports.avp = {};
module.exports.avu = {};
module.exports.ave = {};


//We will need to export Hammer to the global namespace because it's used
//by various extensions
//Hammer does not work on Node because it references window and document
if (BUILD_FLAG__BUILD_TYPE !== 'NodeJs') {
  var Hammer = require('../thirdparty/hammer/hammer.js');
  //Also Hammer sets module.exports to itself, which fools our _export function,
  //so we wrap it in an object.
  _export({ Hammer: Hammer }, "av");
}

//TODO_TS: stuff from compat/globas/envinit goes into both namespaces because they
//contain a mix of public and private exports,
//make it cosistent in client code, then remove one of those
_export(require("./compat"), "av");
_export(require("./compat"), "avp");
_export(require("./globals"), "avp");
_export(require("./globals"), "av");

// Analytics
_export(require("./analytics/interface"), "avp");
_export(require("./analytics"), "avp");


_export(require("./envinit"), "avp");
_export(require("./envinit"), "av");


_export(require("./resource-loader"), "avp");
const i18n = require("i18next").default;
i18n.translate = i18n.t.bind(i18n);
i18n.localize = () => {};
_export({i18n}, "av");
_export(require("./globalization/i18init"), "avp");
_export(require("./globalization/langs"), "avp");


_export(require("./logger/Logger"), "avp");

_export(require("./wgs/globals"), "avp");

_export(require("./wgs/render/GroundReflection"), "avp");
_export(require("./wgs/render/GroundShadow"), "avp");
_export(require("./wgs/render/WebGLShader"), "avp");
_export(require("./wgs/render/PhongShader"), "avp");
_export(require("./wgs/render/BasicShader"), "avp");
_export(require("./wgs/render/DecodeEnvMap"), "avp");
_export(require("./wgs/render/ShaderChunks"), "avp");
_export(require("./wgs/render/SAOShader"), "avp");
_export(require("./wgs/render/ShaderPass"), "avp");
_export(require("./wgs/render/CelShader"), "avp");
_export(require("./wgs/render/CopyShader"), "avp");
_export(require("./wgs/render/RenderContextPostProcess"), "avp");
_export(require("./wgs/render/LineStyleDef"), "avp");
_export(require("./wgs/render/HalfFloat"), "avp");
_export(require("./wgs/render/ShaderUtils"), "avp");
_export(require("./wgs/render/WebGLProgram"), "avp");
_export(require("./wgs/render/PrismUtil"), "avp");
_export(require("./wgs/render/ShadowMap"), "avp");
_export(require("./wgs/render/MaterialConverterCommon"), "avp");
_export(require("./wgs/render/MaterialConverter"), "avp");
_export(require("./wgs/render/MaterialManager"), "avp");
_export(require("./wgs/render/RenderContext"), "avp");
_export(require("./wgs/render/WebGLRenderer"), "avp");
_export(require("./wgs/render/GroundFlags"), "avp");

_export(require("./wgs/scene/MeshFlags"), "avp");
_export(require("./wgs/scene/RenderFlags"), "avp");
_export(require("./wgs/scene/ResetFlags"), "avp");
_export(require("./wgs/scene/LmvVector3"), "avp");
_export(require("./wgs/scene/LmvMatrix4"), "avp");
_export(require("./wgs/scene/LmvBox3"), "avp");
_export(require("./wgs/scene/VertexEnumerator"), "avp");
_export(require("./wgs/scene/VertexBufferReader"), "avp");
_export(require("./wgs/scene/DeriveTopology"), "avp");
_export(require("./wgs/scene/VBIntersector"), "avp");
_export(require("./wgs/scene/GeometryList"), "avp");
_export(require("./wgs/scene/RenderBatch"), "avp");
_export(require("./wgs/scene/ModelIteratorLinear"), "avp");
_export(require("./wgs/scene/ModelIteratorBVH"), "avp");
_export(require("./wgs/scene/BufferGeometry"), "avp");
_export(require("./wgs/scene/RenderScene"), "avp");
_export(require("./wgs/scene/SortedList"), "avp");
_export(require("./wgs/scene/RenderModel"), "avp");
_export(require("./wgs/scene/FrustumIntersector"), "avp");
_export(require("./wgs/scene/FragmentIterator"), "avp");
_export(require("./wgs/scene/FragmentList"), "avp");
_export(require("./wgs/scene/SelectionMode"), "av");
_export(require("./wgs/scene/InstanceTree"), "avp");
_export(require("./wgs/scene/InstanceTreeStorage"), "avp");
_export(require("./wgs/scene/BVHBuilder"), "avp");
_export(require("./wgs/scene/SceneMath"), "avp");

_export(require("./wgs/scene/leaflet/TileCoords"), "avp");
_export(require("./wgs/scene/leaflet/ModelIteratorTexQuad"), "avp");

//TODO: Do all these need to be exported or just the entry point?
_export(require("./wgs/scene/consolidation/FragmentListConsolidation"), "avp"); // name exported differs
_export(require("./wgs/scene/consolidation/ConsolidationIterator"), "avp");
_export(require("./wgs/scene/consolidation/InstanceBufferBuilder"), "avp");
_export(require("./wgs/scene/consolidation/Consolidation"), "avp");
_export(require("./wgs/scene/consolidation/GeomMergeTask"), "avp");


_export(require("./file-loaders/lmvtk/common/VertexBufferBuilder"), "avp");
_export(require("./file-loaders/lmvtk/otg/OtgGeomCodec"), "avp");
_export(require("./file-loaders/lmvtk/f2d/F2d"), "avp");
_export(require("./file-loaders/lmvtk/common/Propdb.js"), "avp");

//Common networking
_export(require("./file-loaders/net/ErrorCodes"), "av");
_export(require("./file-loaders/net/endpoints"), "av");
_export(require("./file-loaders/net/Xhr"), "avp");

_export(require("../thirdparty/three.js/DDSLoader"), "avp");
_export(require("../thirdparty/three.js/materials/PatchShader"), "avp");

//Application layers
_export(require("./application/FileLoaderManager"), "av");
_export(require("./application/bubble"), "av");
_export(require("./application/EventDispatcher"), "av");
_export(require("./application/Extension"), "av");
_export(require("./application/ExtensionManager"), "av");
_export(require("./application/FileLoader"), "av");
_export(require("./application/EventTypes"), "av");
_export(require("./application/EventUtils"), "av");
_export(require("./application/ScreenModeDelegate"), "av");
_export(require("./application/LightPresets"), "avp");
_export(require("./application/ModelLayers"), "avp");
_export(require("./application/LocalStorage"), "avp");
_export(require("./application/Model"), "av");
_export(require("./application/Document"), "av");
_export(require("./application/Preferences"), "avp");
_export(require("./application/PreferenceNames"), "avp");
_export(require("./application/Profile"), "av");
_export(require("./application/ProfileSettings"), "av");
_export(require("./application/Viewer3D.js"), "av");
_export(require("./application/Viewer3DImpl"), "avp");
_export(require("./application/ViewerState"), "avp");
_export(require("./application/ModelMemoryTracker"), "av");
_export(require("./application/ScreenShot"), "av");
_export(require("./application/Thumbnails"), "av");
_export(require("./application/AggregatedView"), "av");
_export(require("./application/OverlayManager"), "av");
_export(require("./application/CameraLS"), "av");
_export(require("./application/ProfileManager"), "av");
_export(require("./application/DynamicGlobalOffset"), "av");
_export(require("./application/PropertySet"), "av");

_export(require('./measurement/UnitFormatter'), "avp");
module.exports.av.ModelUnits = require('./measurement/UnitFormatter').ModelUnits; //backwards compatibility after ModelUnits move to avp.

_export(require('./measurement/UnitParser'), "avp");
_export(require('./measurement/PDFUtils'), "av");
_export(require('./measurement/DisplayUnits'), "avp");

//Icky reconstruction of the MeasureCommon namespace from its interdependent modules.
var mc = module.exports.av.MeasureCommon = {};
_extend(mc, require('./measurement/MeasureCommon'));
mc.MeasurementTypes = require('./measurement/MeasurementTypes').MeasurementTypes;
mc.MeasurementTypesToAnalytics = require('./measurement/MeasurementTypes').MeasurementTypesToAnalytics;
mc.SnapType = require('./measurement/SnapTypes').SnapType;
mc.Events = require('./measurement/MeasureEvents').MeasureEvents;
mc.Measurement = require('./measurement/Measurement').Measurement;
mc.SnapResult = require('./measurement/SnapResult').SnapResult;

// GlobalManager
_export(require('./application/GlobalManager'), "av");
_export(require('./application/GlobalManagerMixin'), "av");

//Animation
_export(require("./animation/Animation"), "avp");
_export(require("./animation/KeyFrameAnimator"), "avp");
_export(require("./animation/type/MeshAnimation"), "avp");

//Tools
_export(require("./tools/Navigation"), "av");
_export(require("./tools/UnifiedCamera"), "av");
_export(require("./tools/Selector"), "avp");
_export(require("./tools/SelectionType"), "av");
_export(require("./tools/VisibilityManager"), "avp");
_export(require("./tools/KeyCode"), "av");
_export(require("./tools/ToolController"), "av");
_export(require("./tools/HotkeyManager"), "av");
_export(require("./tools/DefaultHandler"), "av");
_export(require("./tools/ViewingUtilities"), "av");
_export(require("./tools/GestureHandler"), "av");
_export(require("./tools/ToolInterface"), "av");
_export(require("./tools/OrbitDollyPanTool"), "av");
_export(require("./tools/HotGestureTool"), "av");
_export(require("./tools/FovTool"), "av");
_export(require("./tools/WorldUpTool"), "av");
_export(require("./tools/autocam/Autocam"), "av");
_export(require("./tools/viewtransitions/ViewTransition"), "avp");

// Loaders

_export(require("./file-loaders/main/SvfLoader"), "avp");
_export(require("./file-loaders/main/F2DLoader"), "avp");
_export(require("./file-loaders/main/LeafletLoader"), "avp");
_export(require("./file-loaders/main/PropDbLoader"), "avp");
_export(require("./file-loaders/main/TextureLoader"), "avp");
_export(require("./file-loaders/main/OtgLoader"), "avp");
_export(require("./file-loaders/main/OtgResourceCache"), "avp");
_export(require("./file-loaders/main/Empty2DModelLoader"), "avp");

if (BUILD_FLAG__BUILD_TYPE === 'NodeJs') {
    _export(require("./file-loaders/lmvtk/otg/OtgWebSocket"), "avp");
}

_export(require("./file-loaders/main/WorkerCreator"), "avp");

_export(require("./application/ProgressState"), "av");

_export(require("./mobile/MobileCallbacks"), "av");

if (BUILD_FLAG__WASM_SUPPORT) {
    _export(require("./file-loaders/main/WorkerCreatorWasm"), "avp");
    _export(require("./wasm/Wasm.js"), "avp");
}

if (BUILD_FLAG__WANT_GUI) {
  // Bundle CSS files into a single one.
  require('./index-css');
  //TODO: probably not all of these need to be explicitly exported now
  _export(require("./gui/LoadingSpinner"), "avu");
  _export(require("./gui/Tree"), "avu");
  _export(require("./gui/TreeDelegate"), "avu");
  _export(require("./gui/TreeOnDemand"), "avu");
  _export(require("./gui/CommonWidgets"), "avp");
  _export(require("./gui/DataTable"), "avu");
  _export(require("./gui/DockingPanel.js"), "avu");
  _export(require("./gui/ContextMenu"), "avp");
  _export(require("./gui/browser/browser"), "avp");
  _export(require("./gui/AlertBox"), "avp");
  _export(require("./gui/ErrorHandler"), "avp");
  _export(require("./gui/ModelStructurePanel"), "avu");
  _export(require("./gui/PropertyPanel"), "avu");
  _export(require("./gui/ObjectContextMenu"), "avu");
  _export(require("./gui/ProgressBar"), "avp"); //TODO: remove from export
  _export(require("./gui/ViewerPanelMixin"), "ave"); //TODO: mode to avu namespace
  _export(require("./gui/controls/Control"), "avu");
  _export(require("./gui/controls/ControlGroup"), "avu");
  _export(require("./gui/controls/Button"), "avu");
  _export(require("./gui/controls/RadioButtonGroup"), "avu");
  _export(require("./gui/controls/ComboButton"), "avu");
  _export(require("./gui/toolbar/ToolBar"), "avu");
  _export(require("./gui/HudMessage"), "avp");
  _export(require("./gui/SettingsPanel"), "avu");
  _export(require("./gui/controls/Filterbox"), "avu");
  _export(require("./gui/controls/Searchbox"), "avu");
  _export(require("./gui/RenderOptionsPanel"), "avp");
  _export(require("./gui/ViewerModelStructurePanel"), "ave"); //TODO: mode to avu namespace
  _export(require("./gui/ViewerPropertyPanel"), "ave"); //TODO: mode to avu namespace
  _export(require("./gui/ViewerSettingsPanel"), "ave"); //TODO: mode to avu namespace
  _export(require("./gui/ViewerObjectContextMenu"), "ave"); //TODO: mode to avu namespace
  _export(require("./gui/GuiViewerToolbarConst"), "av");
  _export(require("./gui/GuiViewer3D"), "av");
  _export(require("./gui/splitview-layout/SplitViewLayout"), "avu");

  // Include built in extensions  
  _export(require("../extensions/builtinExtensions"), "av");
}

// Multi-Viewer
_export(require("./leech-viewer/MultiViewerFactory"), "av");
_export(require("./leech-viewer/LeechViewer"), "av");
_export(require("./leech-viewer/CrossViewerInteractionCommon"), "av");


// Register extensions bundled into their own JS files
_export(require("../extensions/registerExternalExtensions"), "avp");

// Search
_export(require("./search/SearchManager"), "av");

require("./module-suffix").initializeLegacyNamespaces(module.exports);

// MaterialConverterPrism needs to be bundled for nodejs build
// for DiffTool unit tests that load an svf
if (BUILD_FLAG__BUILD_TYPE === 'NodeJs') {
    // MaterialConverterPrism uses av.xxx, which is only available after the call to initializeLegacyNamespaces above
    const MaterialConverterPrism = require("../extensions/MaterialConverterPrism/MaterialConverterPrism");
    _export({ MaterialConverterPrism }, "av");
    Autodesk.Viewing['MaterialConverterPrism'] = MaterialConverterPrism;
}
