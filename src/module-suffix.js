// Map module exports to Autodesk.* namespaces for backwards API compatibility.
// Input is the module returned by require("index.js")
export function initializeLegacyNamespaces(LMV) {
    var av = Autodesk.Viewing;
    var avp = av.Private;
    var avu = av.UI;
    var ave = av.Extensions;

    //Move exports from module into viewer namespaces
    for (let m in LMV.av) {
        av[m] = LMV.av[m];
    }

    for (let m in LMV.avp) {
        avp[m] = LMV.avp[m];
    }

    for (let m in LMV.avu) {
        avu[m] = LMV.avu[m];
    }

    for (let m in LMV.ave) {
        ave[m] = LMV.ave[m];
    }

    //Put those in the global module for compatibility with existing code
    //that does not consistently require("three").
    av.getGlobal().THREE = LMV.THREE;
    av.getGlobal().LMV = LMV;

    //Fix namespaces for functions that are exported from private modules but need to be in the
    //av namespace or from public ones that need to be in the avp namespace.
    //This needs to be cleaned up more comprehensively, because presumably anything exported
    //in the global namespace should be considered public, and anything that is currently in avp
    //should not be exported outside the webpack build.

    avp.isRightClick = av.isRightClick; //Used by Markups extension
    avp.isMiddleClick = av.isMiddleClick;
}
