import { Control } from "./Control";
import { isTouchDevice } from "../../compat";
import { touchStartToClick } from "../../compat";


/**
 * Button control that can be added to toolbars.
 *
 * @param {string} [id] - The ID for this button. Optional.
 * @param {object} [options] - An optional dictionary of options.
 * @param {boolean} [options.collapsible=true] - Whether this button is collapsible.
 * @constructor
 * @augments Autodesk.Viewing.UI.Control
 * @alias Autodesk.Viewing.UI.Button
 */
export function Button (id, options) {
    Control.call(this, id, options);

    var self = this;

    this._state = Button.State.INACTIVE;

    var _document = this.getDocument();
    this.icon = _document.createElement("div");
    this.icon.classList.add("adsk-button-icon");
    this.container.appendChild(this.icon);

    this.container.addEventListener('click', function(event) {
        if (self.getState() !== Button.State.DISABLED) {
            self.dispatchEvent(Button.Event.CLICK);
            if (self.onClick)
                self.onClick(event); 
        }
        event.stopPropagation();
    });

    // Add rollover only if this is not a touch device.
    if ( !isTouchDevice() ) {
        this.container.addEventListener("mouseover", function(e) {
            self.onMouseOver(e);
        });

        this.container.addEventListener("mouseout", function(e) {
            self.onMouseOut(e);
        });
    } else {
        this.container.addEventListener("touchstart", touchStartToClick);
    }

    this.addClass('adsk-button');
    this.addClass(Button.StateToClassMap[this._state]);
}

/**
 * Enum for button event IDs.
 * @readonly
 * @enum {String}
 */
Button.Event = {
    // Inherited from Control
    VISIBILITY_CHANGED: Control.Event.VISIBILITY_CHANGED,
    COLLAPSED_CHANGED: Control.Event.COLLAPSED_CHANGED,

    STATE_CHANGED: 'Button.StateChanged',
    CLICK: 'click'
};

/**
 * Enum for button states
 * @readonly
 * @enum {Number}
 * @static
 * @alias Autodesk.Viewing.UI.Button.State
 */
Button.State = {
    ACTIVE: 0,
    INACTIVE: 1,
    DISABLED: 2
};

/**
 * @private
 */
Button.StateToClassMap = (function() {
    var state = Button.State;
    var map = {};

    map[state.ACTIVE] = 'active';
    map[state.INACTIVE] = 'inactive';
    map[state.DISABLED] = 'disabled';

    return map;
}());


/**
 * Event fired when state of the button changes.
 *
 * @event Autodesk.Viewing.UI.Button#STATE_CHANGED
 * @type {object}
 * @property {string} buttonId - The ID of the button that fired this event.
 * @property {Autodesk.Viewing.UI.Button.State} state - The new state of the button.
 */

Button.prototype = Object.create(Control.prototype);
Button.prototype.constructor = Button;

/**
 * Sets the state of this button.
 *
 * @param {Autodesk.Viewing.UI.Button.State} state - The state.
 * @returns {boolean} True if the state was set successfully.
 * @fires Autodesk.Viewing.UI.Button#STATE_CHANGED
 *
 * @alias Autodesk.Viewing.UI.Button#setState
 */
Button.prototype.setState = function(state) {
    if (state === this._state) {
        return false;
    }

    this.removeClass(Button.StateToClassMap[this._state]);
    this.addClass(Button.StateToClassMap[state]);
    this._state = state;

    var event = {
        type: Button.Event.STATE_CHANGED,
        state: state
    };

    this.dispatchEvent(event);

    return true;
};

/**
 * Sets the icon for the button.
 *
 * @param {string} iconClass - The CSS class defining the appearance of the button icon (e.g. image background).
 *
 * @alias Autodesk.Viewing.UI.Button#setIcon
 */
Button.prototype.setIcon = function(iconClass) {
    if (this.iconClass)
        this.icon.classList.remove(this.iconClass);
    this.iconClass = iconClass;
    this.icon.classList.add(iconClass);
};


/**
 * Returns the state of this button.
 *
 * @returns {Autodesk.Viewing.UI.Button.State} The state of the button.
 *
 * @alias Autodesk.Viewing.UI.Button#getState
 */
Button.prototype.getState = function() {
    return this._state;
};

/**
 * Override this method to be notified when the user clicks on the button.
 * @param {MouseEvent} event
 *
 * @alias Autodesk.Viewing.UI.Button#onClick
 */
Button.prototype.onClick = function(event) {

};

/**
 * Override this method to be notified when the mouse enters the button.
 * @param {MouseEvent} event
 *
 * @alias Autodesk.Viewing.UI.Button#onMouseOver
 */
Button.prototype.onMouseOver = function(event) {

};

/**
 * Override this method to be notified when the mouse leaves the button.
 * @param {MouseEvent} event
 *
 * @alias Autodesk.Viewing.UI.Button#onMouseOut
 */
Button.prototype.onMouseOut = function(event) {

};
