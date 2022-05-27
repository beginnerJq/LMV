
import { theExtensionManager } from "../src/application/ExtensionManager";
import { externalExtensions, getExtensionEntryKey } from './externalExtensions';


const ext = BUILD_FLAG__MINIFIED_BUILD ? 'min.js' : 'js';

// Register them all
externalExtensions.forEach((ee)=>{
    
    let key = getExtensionEntryKey(ee);
    let filePath = `extensions/${key}/${key}.${ext}`;
    let dependencies = ee.dependencies;
    ee.ids.forEach((id)=>{
        theExtensionManager.registerExternalExtension(id, filePath, dependencies);
    });
});


if (BUILD_FLAG__DIFF_TOOL) {
	// Not available in externalExtensions.js
	theExtensionManager.registerExternalExtension('Autodesk.DiffTool', `extensions/DiffTool/DiffTool.${ext}`);
}
