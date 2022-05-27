
//This file is the first one when creating the bundled build and
//initializes some global namespaces and other global variables.
//Once the code is fully modular, the creation of the global namespace
//can/should be moved to the module-suffix instead.

    function getGlobal() {
        return (typeof window !== "undefined" && window !== null)
                ? window
                : (typeof self !== "undefined" && self !== null)
                    ? self
                    : global;
    }

    /**
     * Create namespace
     * @param {string} s - namespace (e.g. 'Autodesk.Viewing')
     * @return {Object} namespace
     */
    function AutodeskNamespace(s) {
        var ns = getGlobal();

        var parts = s.split('.');
        for (var i = 0; i < parts.length; ++i) {
            ns[parts[i]] = ns[parts[i]] || {};
            ns = ns[parts[i]];
        }

        return ns;
    }

    // Define the most often used ones
    AutodeskNamespace("Autodesk.Viewing.Private");

    AutodeskNamespace("Autodesk.Viewing.Extensions");
    AutodeskNamespace("Autodesk.Extensions"); // Webpack bundled extensions.

    AutodeskNamespace("Autodesk.Viewing.Shaders");

    AutodeskNamespace('Autodesk.Viewing.UI');

    AutodeskNamespace('Autodesk.LMVTK');

    Autodesk.Viewing.getGlobal = getGlobal;
    Autodesk.Viewing.AutodeskNamespace = AutodeskNamespace;
    getGlobal().AutodeskNamespace = AutodeskNamespace;


    //TODO: find a way to get those out of here or at least
    //out of the avp namespace
    /** @define {string} */
    var avp = getGlobal().Autodesk.Viewing.Private;
    avp.LMV_WORKER_URL = BUILD_FLAG__LMV_WORKER_FILE; // See webpack.js

    avp.ENABLE_DEBUG = avp.ENABLE_DEBUG || false;
    getGlobal().ENABLE_DEBUG = avp.ENABLE_DEBUG;
    //avp.DEBUG_SHADERS = avp.DEBUG_SHADERS || false; // will be moved to wgs.js

    //Set to true when we need to load the web worker via XHR and create
    //it as a data blob URL. Needed for IE11+CORS, all other cases
    //can set this to false. If you need to debug the worker, set this to false also.
    avp.ENABLE_INLINE_WORKER = BUILD_FLAG__INLINE_WORKER;

    module.exports.Autodesk = getGlobal().Autodesk;
