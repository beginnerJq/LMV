
import { theExtensionManager } from "../src/application/ExtensionManager";

import { PropertiesManagerExtension } from "./PropertiesManager/PropertiesManager";
import { ViewerSettingsExtension } from "./ViewerSettings/ViewerSettings";
import { ModelStructureExtension } from "./ModelStructure/ModelStructure";
import { NavToolsExtension } from "./DefaultTools/NavTools";
import { ExplodeExtension } from "./Explode/Explode";
import { FullScreenExtension } from "./FullScreen/FullScreen";
import { GoHomeExtension } from "./GoHome/GoHome";
import { FusionOrbitExtension } from "./FusionOrbit/FusionOrbit";


theExtensionManager.registerExtension('Autodesk.PropertiesManager', PropertiesManagerExtension);
theExtensionManager.registerExtension('Autodesk.ViewerSettings', ViewerSettingsExtension);
theExtensionManager.registerExtension('Autodesk.ModelStructure', ModelStructureExtension);
theExtensionManager.registerExtension('Autodesk.DefaultTools.NavTools', NavToolsExtension);
theExtensionManager.registerExtension('Autodesk.Explode', ExplodeExtension);
theExtensionManager.registerExtension('Autodesk.FullScreen', FullScreenExtension);
theExtensionManager.registerExtension('Autodesk.GoHome', GoHomeExtension);
theExtensionManager.registerExtension('Autodesk.Viewing.FusionOrbit', FusionOrbitExtension);
