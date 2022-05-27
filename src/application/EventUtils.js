import { getGlobal } from "../compat";


let _useLeftHandedInput = false;
let __firefoxLMBfix = false;


/** 
 * Contains static utility functions for DOM and viewer events.
 *
 * @memberof Autodesk.Viewing
 * @alias Autodesk.Viewing.EventUtils
 */
export class EventUtils {
	/**
	 * @param {DOMEvent} event - A browser-triggered event
	 * @returns {boolean} true when the event matches a secondary-button click.
	 *
	 * @alias Autodesk.Viewing.EventUtils#isRightClick
	 */
	static isRightClick(event) {
	    const _window = getWindowFromEvent(event);
	    if (!(event instanceof _window.MouseEvent))
	        return false;

	    let button = event.button;

	    // Check for Firefox spoof: Control+LMB converted to RMB.
	    // The "buttons" property in Firefox will include 1 for LMB and 2 for RMB.
	    if ("buttons" in event) {
	        // For button down the 1 bit will be on indicating LMB.
	        // For button up it's off so check the flag to see if we
	        // switched the down event.
	        if (__firefoxLMBfix && !(event.buttons & 1)) { // Button up?
	            __firefoxLMBfix = false;
	            button = 0;
	        } else if (button === 2 && (event.buttons & 1)) {
	            button = 0;    // Convert back to reality.
	            __firefoxLMBfix = true;
	        }
	    }

	    const rightButton = _useLeftHandedInput ? 0 : 2;

	    return button === rightButton;
	}

	/**
	 * @param {DOMEvent} event - A browser-triggered event
	 * @returns {boolean} true when the event matches a middle-button mouse click.
	 *
	 * @alias Autodesk.Viewing.EventUtils#isMiddleClick
	 */
	static isMiddleClick(event) {
	    const _window = getWindowFromEvent(event);
	    if (!(event instanceof _window.MouseEvent))
	        return false;

	    return event.button === 1;
	}

	/**
	 * Internally used function to set UX for left-handed users.
	 * @param {boolean} value - true to switch left and right buttons.
	 *
	 * @alias Autodesk.Viewing.EventUtils#setUseLeftHandedInput
	 *
	 * @private
	 */
	static setUseLeftHandedInput(value) {
		_useLeftHandedInput = value;
	}

	/**
	 * If there's no camera transition, return immediately.
	 * Otherwise, resolve when the camera transition is finished.
	 * @param {Autodesk.Viewing.Viewer3D} viewer
	 * @alias Autodesk.Viewing.EventUtils#waitUntilTransitionEnded
	 */
	static async waitUntilTransitionEnded(viewer) {
		if (!viewer.navigation.getRequestTransition() && !viewer.navigation.getTransitionActive()) {
			return;
		}

		return new Promise(resolve => {
			setTimeout(() => {
				// Try again in case there is a requestTransition, but CAMERA_TRANSITION_COMPLETED didn't get fired.
				// It can happen in case there is a requestTransition to the same camera position exactly.
				if (!viewer.navigation.getRequestTransition() && !viewer.navigation.getTransitionActive()) {
					resolve();
				} else {
					viewer.addEventListener(Autodesk.Viewing.CAMERA_TRANSITION_COMPLETED, resolve, { once: true });
				}
			});
		});
	}

	/**
	 * If geometry has been loaded, return immediately.
	 * Otherwise, resolve when the geometry loaded event is fired.
	 * @param {Autodesk.Viewing.Viewer3D} viewer
	 * @param [Autodesk.Viewing.Model] model - Default is viewer.model, if not provided
	 * @alias Autodesk.Viewing.EventUtils#waitUntilGeometryLoaded
	 */
	static async waitUntilGeometryLoaded(viewer, model = viewer.model) {
		if (model && model.isLoadDone()) {
			return;
		}

		return new Promise(resolve => {
			const cb = (e) => {
				// In the case where we set this wait very early (before a model is even loaded),
				// the default model will be null, so in that case just resolve
				if (!model || model === e.model) {
					resolve();
					viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, cb);
				}
			};
			viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, cb);
		});
	}

    /**
	 * If model has been already added, return immediately.
	 * Otherwise, resolve when the model is added.
	 * @param {Autodesk.Viewing.Viewer3D} viewer
	 * @param [Autodesk.Viewing.Model] model - Default is viewer.model, if not provided
	 * @alias Autodesk.Viewing.EventUtils#waitUntilModelAdded
	 */
	static async waitUntilModelAdded(viewer, model = viewer.model) {
		if (model) {
			return;
		}

		return new Promise(resolve => {
			const cb = (e) => {
				// In the case where we set this wait very early (before a model is even loaded),
				// the default model will be null, so in that case just resolve
				if (!model || model === e.model) {
					resolve();
					viewer.removeEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, cb);
				}
			};
			viewer.addEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, cb);
		});
	}
}


/**
 * @private
 */
function getWindowFromEvent(event) {
    const _document = event.target && event.target.ownerDocument;
    if (_document) {
        return _document.defaultView || _document.parentWindow;
    }
    return getGlobal();
}


// Backwards compatibility - TODO: Remove in v8.0.0
Autodesk.Viewing.isRightClick = EventUtils.isRightClick;
Autodesk.Viewing.isMiddleClick = EventUtils.isMiddleClick;

