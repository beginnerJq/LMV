import { analytics } from '../analytics';
const av = Autodesk.Viewing;

/**
 * Overrides the existing Extension's functions to fire events
 * @param {Autodesk.Viewing.Extension} extension - viewer extension instance
 * @returns {Autodesk.Viewing.Extension} - viewer extension
 * @private
 */
export function ExtensionEventsMixin(extension) {
    /**
     * @param {String} funcName - name of the Extension's function
     * @param {Function} preCB - called before the extension's function is executed
     * @param {Function} postCB - called after the extension's function is executed
     */
    function intercept(funcName, preCB, postCB) {
        const oldFunc = extension[funcName];
        if (!oldFunc) {
            // Output a warning mentioning that the expected function is not available.
            // Typically this means that the extension was not inherited from av.Extension.
            console.warn(funcName, ' not implemented in ', extension);
            return;
        }
        extension[funcName] = function () {
            if (preCB) preCB.call(extension, ...arguments);
            const ret = oldFunc.call(extension, ...arguments);
            if (postCB) postCB.call(extension, ...arguments);
            return ret;
        };
    }

    // Fire the EXTENSION_PRE_LOADED_EVENT before the extension is loaded
    intercept('load', function () {
        this.viewer.dispatchEvent({ type: av.EXTENSION_PRE_LOADED_EVENT, extensionId: this.id });
    });

    // Fire the EXTENSION_PRE_UNLOADED_EVENT before the extension is unloaded
    intercept('unload', function () {
        this.viewer.dispatchEvent({ type: av.EXTENSION_PRE_UNLOADED_EVENT, extensionId: this.id });
    });

    // Fire the EXTENSION_PRE_ACTIVATED_EVENT before the extension is activated and the EXTENSION_ACTIVATED_EVENT after the extension is activated
    intercept(
        'activate',
        function (mode) {
            this.viewer.dispatchEvent({ type: av.EXTENSION_PRE_ACTIVATED_EVENT, extensionId: this.id, mode: mode });
        },
        function (mode) {
            this.viewer.dispatchEvent({ type: av.EXTENSION_ACTIVATED_EVENT, extensionId: this.id, mode: mode });
            analytics.track('viewer.extension.activate', { extensionId: this.id, mode });
        }
    );

    // Fire the EXTENSION_PRE_DEACTIVATED_EVENT before the extension is activated and the EXTENSION_DEACTIVATED_EVENT after the extension is activated
    intercept(
        'deactivate',
        function () {
            this.viewer.dispatchEvent({ type: av.EXTENSION_PRE_DEACTIVATED_EVENT, extensionId: this.id });
        },
        function () {
            this.viewer.dispatchEvent({ type: av.EXTENSION_DEACTIVATED_EVENT, extensionId: this.id });
            analytics.track('viewer.extension.deactivate', { extensionId: this.id });
        }
    );

    return extension;
}
