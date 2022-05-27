
import { ControlGroup } from "./ControlGroup";
import { Button } from "./Button";
import { Control } from "./Control";


/**
 * Group of controls that act like a radio group.
 *
 * I.e., only one button may be active at a time. Only accepts {@link Autodesk.Viewing.UI.Button}.
 * @param {string} id - The id for this control group.
 * @param {object} [options] - An optional dictionary of options.
 * @param {boolean} [options.collapsible=true] - Whether this control group is collapsible.
 * @constructor
 * @augments Autodesk.Viewing.UI.ControlGroup
 * @alias Autodesk.Viewing.UI.RadioButtonGroup
 */
export function RadioButtonGroup(id, options) {
    ControlGroup.call(this, id, options);

    var self = this;

    this._activeButton = null;

    this._handleButtonStateChange = function(event) {
        var states = Button.State;

        if (event.state !== states.ACTIVE) {
            if (event.target === self._activeButton) {
                self._activeButton = null;
                self.dispatchEvent({
                    type: RadioButtonGroup.Event.ACTIVE_BUTTON_CHANGED,
                    button: event.target,
                    isActiveButton: false
                });
            }
            return;
        } else {
            self._activeButton = event.target;
            self.dispatchEvent({
                type: RadioButtonGroup.Event.ACTIVE_BUTTON_CHANGED,
                button: event.target,
                isActiveButton: true
            });
        }

        self._controls.forEach(function(control) {
            if (control !== event.target && control.getState() !== states.DISABLED) {
                control.setState(states.INACTIVE);
            }
        });
    };
}

/**
 * Enum for radio button group event IDs.
 * @readonly
 * @enum {String}
 */
RadioButtonGroup.Event = {
    ACTIVE_BUTTON_CHANGED: 'RadioButtonGroup.ActiveButtonChanged',

    // Inherited from Control
    VISIBILITY_CHANGED: Control.Event.VISIBILITY_CHANGED,
    COLLAPSED_CHANGED: Control.Event.COLLAPSED_CHANGED,

    // Inherited from ControlGroup
    CONTROL_ADDED: ControlGroup.Event.CONTROL_ADDED,
    CONTROL_REMOVED: ControlGroup.Event.CONTROL_REMOVED,
    SIZE_CHANGED: ControlGroup.Event.SIZE_CHANGED
};

/**
 * Event fired when active button for this radio group changes.
 *
 * @event Autodesk.Viewing.UI.RadioButtonGroup#ACTIVE_BUTTON_CHANGED
 * @type {object}
 * @property {Autodesk.Viewing.UI.Button} button - The button whose state is changing.
 * @property {boolean} isActiveButton - Is the event target the currently active button.
 */

RadioButtonGroup.prototype = Object.create(ControlGroup.prototype);
RadioButtonGroup.prototype.constructor = RadioButtonGroup;

/**
 * Adds a control to this radio button group. The control must be a {@link Autodesk.Viewing.UI.Button|button}.
 *
 * @param {Autodesk.Viewing.UI.Button} control - The button to add.
 * @param {object} [options] - An option dictionary of options.
 * @param {object} [options.index] - The index to insert the control at.
 * @returns {boolean} True if the button was successfully added.
 * @fires Autodesk.Viewing.UI.ControlGroup#CONTROL_ADDED
 * @fires Autodesk.Viewing.UI.ControlGroup#SIZE_CHANGED
 *
 * @alias Autodesk.Viewing.UI.RadioButtonGroup#addControl
 */
RadioButtonGroup.prototype.addControl = function(control, options) {
    if (!(control instanceof Button)) {
        return false;
    }

    // Add listeners for radio functionality if we were successful
    if (ControlGroup.prototype.addControl.call(this, control, options)) {
        control.addEventListener(Button.Event.STATE_CHANGED, this._handleButtonStateChange);
        return true;
    }

    return false;
};

/**
 * Removes a control from this control group.
 *
 * @param {string|Autodesk.Viewing.UI.Control} control - The control ID or control instance to remove.
 * @returns {boolean} True if the control was successfully removed.
 * @fires Autodesk.Viewing.UI.ControlGroup#CONTROL_REMOVED
 * @fires Autodesk.Viewing.UI.ControlGroup#SIZE_CHANGED
 *
 * @alias Autodesk.Viewing.UI.RadioButtonGroup#removeControl
 */
RadioButtonGroup.prototype.removeControl = function(control) {

    var thecontrol = (typeof control == "string") ? this.getControl(control) : control;

    // Remove listeners for radio functionality if we were successful
    if (thecontrol !== null && ControlGroup.prototype.removeControl.call(this, thecontrol)) {
        thecontrol.removeEventListener(Button.Event.STATE_CHANGED, this._handleButtonStateChange);
        return true;
    }

    return false;
};

/**
 * Returns the active button in this radio button group.
 *
 * @returns {Autodesk.Viewing.UI.Button} The active button. Null if no button is active.
 *
 * @alias Autodesk.Viewing.UI.RadioButtonGroup#getActiveButton
 */
RadioButtonGroup.prototype.getActiveButton = function() {
    return this._activeButton;
};
