
var externalExtensions = [

    // First is the path to extension's entry point,
    // Second (and all others) are the extension IDs.
    {
        src: './extensions/Wireframes/Wireframes.js',
        ids: ['Autodesk.Viewing.Wireframes'],
    },
    {
        src: './extensions/ZoomWindow/ZoomWindow.js',
        ids: ['Autodesk.Viewing.ZoomWindow'],
    },
    {
        src: './extensions/AEC/LibraryExports.js',
        ids: [
            'Autodesk.AEC.LevelsExtension',
            'Autodesk.AEC.HyperlinkExtension',
            'Autodesk.AEC.DropMeExtension',
            'Autodesk.AEC.CanvasBookmarkExtension',
            'Autodesk.AEC.Minimap3DExtension',
            'Autodesk.AEC.LocationsExtension',
            'Autodesk.AEC.Hypermodeling',
            'Autodesk.AEC.ViewportsExtension',
            'Autodesk.AEC.DisciplinesExtension',
        ],
    },
    {
        src: './extensions/Pushpins/PushPinExtension.js',
        ids: ['Autodesk.BIM360.Extension.PushPin'],
    },
    {
        src: './extensions/Hyperlink/Hyperlink.js',
        ids: ['Autodesk.Hyperlink'],
    },
    {
        src: './extensions/Debug/Debug.js',
        ids: ['Autodesk.Debug'],
    },
    {
        src: './extensions/BimWalk/BimWalk.js',
        ids: ['Autodesk.BimWalk'],
    },
    {
        src: './extensions/Section/Section.js',
        ids: ['Autodesk.Section'],
    },
    {
        src: './extensions/CompGeom/index.js',
        ids: ['Autodesk.CompGeom'],
    },
    {
        src: './extensions/Snapping/index.js',
        ids: ['Autodesk.Snapping'],
    },
    {
        src: './extensions/Beeline/Beeline.js',
        ids: ['Autodesk.Beeline'],
    },
    {
        src: './extensions/FirstPerson/FirstPerson.js',
        ids: ['Autodesk.FirstPerson'],
    },
    {
        src: './extensions/webVR/webVR.js',
        ids: ['Autodesk.Viewing.WebVR'],
    },
    {
        src: './extensions/WebXR/index.js',
        ids: [
            'Autodesk.WebXR.Core',
            'Autodesk.WebXR.VR',
            'Autodesk.WebXR.AR'
        ],
    },
    {
        src: './extensions/CAM360/CAM360.js',
        ids: ['Autodesk.CAM360'],
    },
    {
        src: './extensions/Collaboration/Collaboration.js',
        ids: ['Autodesk.Viewing.Collaboration'],
    },
    {
        src: './extensions/FusionSim/FusionSim.js',
        ids: ['Autodesk.Fusion360.Simulation'],
    },
    {
        src: './extensions/OMV/OMV.js',
        ids: ['Autodesk.OMV'],
    },
    {
        src: './extensions/SplitScreen/SplitScreen.js',
        ids: ['Autodesk.SplitScreen'],
    },
    {
        src: './extensions/CrossFadeEffects/CrossFadeEffects.js',
        ids: ['Autodesk.CrossFadeEffects'],
    },
    {
        src: './extensions/Edit2D/Edit2D.js',
        ids: ['Autodesk.Edit2D']
    },
    {
        src: './extensions/Edit3D/Edit3D.js',
        ids: ['Autodesk.Edit3D']
    },
    {
        src: './extensions/VisualClusters/VisualClusters.js',
        ids: ['Autodesk.VisualClusters']
    },
    {
        src: './extensions/Moldflow/Moldflow.js',
        ids: ['Autodesk.Moldflow'],
    },
    {
        src: './extensions/PixelCompare/PixelCompare.js',
        ids: ['Autodesk.Viewing.PixelCompare'],
    },
    {
        src: './extensions/ScalarisSimulation/ScalarisSimulation.js',
        ids: ['Autodesk.Viewing.ScalarisSimulation'],
    },
    {
        src: './extensions/Measure/Measure.js',
        ids: ['Autodesk.Measure'],
    },
    {
        src: './extensions/Markup/Markup.js',
        ids: [
            'Autodesk.Viewing.MarkupsCore',
            'Autodesk.Viewing.MarkupsGui'
        ],
    },
    {
        src: './extensions/PDF/index.js',
        ids: ['Autodesk.PDF'],
    },
    {
        src: './extensions/ReCap/index.js',
        ids: ['Autodesk.ReCap'],
    },
    {
        src: './extensions/Scalaris/index.js',
        ids: ['Autodesk.Scalaris'],
    },
    {
        src: './extensions/DocumentBrowser/index.js',
        ids: ['Autodesk.DocumentBrowser'],
    },
    {
        src: './extensions/Geolocation/index.js',
        ids: ['Autodesk.Geolocation'],
    },
    {
        src: './extensions/Fusion360/AnimationExtension.js',
        ids: ['Autodesk.Fusion360.Animation'],
    },
    {
        src: './extensions/NPR/index.js',
        ids: ['Autodesk.NPR'],
    },
        {
        src: './extensions/DOF/DOFExtension.js',
        ids: ['Autodesk.DOF'],
    },
    {
        src: './extensions/MSDF/index.js',
        ids: ['Autodesk.MSDF'],
    },
    {
        src: './extensions/MemoryLimited/MemoryLimited.js',
        ids: ['Autodesk.MemoryLimited'],
    },
    {
        src: './extensions/ViewCubeUi/ViewCubeUi.js',
        ids: ['Autodesk.ViewCubeUi']
    },
    {
        src: './extensions/MemoryLimitedDebug/MemoryManager.js',
        ids: ['Autodesk.Viewing.MemoryLimitedDebug'],
    },
    {
        src: './extensions/BimMarkups/BimMarkups.js',
        ids: ['Autodesk.BIM360.Markups'],
    },
    {
        src: './extensions/Minimap2D/Minimap2D.js',
        ids: ['Autodesk.BIM360.Minimap'],
    },
    {
        src: './extensions/GestureDocumentNavigation/GestureDocumentNavigation.js',
        ids: ['Autodesk.BIM360.GestureDocumentNavigation'],
    },
    {
        src: './extensions/RollCamera/RollCamera.js',
        ids: ['Autodesk.BIM360.RollCamera'],
    },
    {
        src: './extensions/LayerManager/LayerManager.js',
        ids: ['Autodesk.LayerManager']
    },
    {
        src: './extensions/SceneBuilder/sceneBuilder.js',
        ids: ['Autodesk.Viewing.SceneBuilder']
    },
    {
        src: './extensions/Popout/index.js',
        ids: ['Autodesk.Viewing.Popout']
    },
    {
        src: './extensions/ProfileUi/index.js',
        ids: ['Autodesk.ProfileUi'],
    },
    {
        src: './extensions/PropertySearch/PropertySearch.js',
        ids: ['Autodesk.PropertySearch'],
    },
    {
        src: './extensions/StandardSurface/index.js',
        ids: ['Autodesk.StandardSurface'],
    },
    {
        src: './extensions/MaterialConverterPrism/index.js',
        ids: ['Autodesk.Viewing.MaterialConverterPrism'],
    },
    {
        src: './extensions/DWF/index.js',
        ids: ['Autodesk.DWF'],
    },
    {
        src: './extensions/ModelsPanel/index.js',
        ids: ['Autodesk.ModelsPanel']
    },
    {
        src: './extensions/ModelAlignment/index.js',
        ids: ['Autodesk.ModelAlignment', 'Autodesk.SheetAlignment'],
        dependencies: ['Autodesk.Edit3D']
    },
    {
        src: './extensions/ModelAlignmentService/ModelAlignmentService.js',
        ids: ['Autodesk.ModelAlignmentService']
    },
    {
        src: './extensions/MixpanelProvider/index.js',
        ids: ['Autodesk.Viewing.MixpanelExtension']
    },
    {
        src: './extensions/Crop/Crop.js',
        ids: ['Autodesk.Crop'],
    },
    {
        src: './extensions/DataVisualization/index.js',
        ids: ['Autodesk.DataVisualization'],
    },
    {
        src: './extensions/ExtensionsPanel/index.js',
        ids: ['Autodesk.ExtensionsPanel'],
    },
    {
        src: './extensions/StringExtractor/StringExtractor.js',
        ids: ['Autodesk.StringExtractor'],
    },
    {
        src: './extensions/ModelSheetTransition/ModelSheetTransition.js',
        ids: ['Autodesk.ModelSheetTransition'],
    },
    {
        src: './extensions/BoxSelection/BoxSelectionExtension.js',
        ids: ['Autodesk.BoxSelection']
    },
    {
        src: './extensions/glTF/index.js',
        ids: ['Autodesk.glTF']
    },
    {
        src: './extensions/PropertyQuery/index.js',
        ids: ['Autodesk.PropertyQuery']
    },
    {
        src: './extensions/VaultPrintUI/index.js',
        ids: ['Autodesk.Vault.Print']
    },
    {
        src: './extensions/VaultMarkupsUI/index.js',
        ids: ['Autodesk.Vault.Markups'],
        dependencies: ['Autodesk.BIM360.Markups']
    },
    {
        src: './extensions/ThreeJSOverlays/index.js',
        ids: ['Autodesk.ThreeJSOverlays']
    },
    {
        src: './extensions/DataExchange/DataExchange.js',
        ids: ['Autodesk.DataExchange']
    },
    {
        src: './extensions/Multipage/Multipage.js',
        ids: ['Autodesk.Multipage']
    },
    {
        src: './extensions/DynamicDimensions/DynamicDimensions.js',
        ids: ['Autodesk.DynamicDimensions']
    },
    {
        src: './extensions/Filter/index.js',
        ids: ['Autodesk.Filter'],
        buildConfig: './extensions/Filter/webpack.config.js'
    },
];

function getExtensionEntryKey(ee) {
    // Given ee.src == './extensions/Something/file.js'
    // then key == 'Something'
    let key = ee.src.split('/')[2];
    return key;
}

module.exports = {
	externalExtensions,
	getExtensionEntryKey
};
