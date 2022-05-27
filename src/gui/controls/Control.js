
import { EventDispatcher } from "../../application/EventDispatcher";
import { GlobalManagerMixin } from "../../application/GlobalManagerMixin";


/**
 * Base class for UI controls.
 *
 * It is abstract and should not be instantiated directly.
 * @param {string} [id] - The id for this control.
 * @param {object} [options] - Dictionary with options.
 * @param {boolean} [options.collapsible=true] - Whether this control is collapsible.
 * @constructor
 * @abstract
 * @alias Autodesk.Viewing.UI.Control
 */
export function Control(id, options) {
    this._id = id;
    this._isCollapsible = !options || options.collapsible;

    this._toolTipElement = null;

    this._listeners = {};

    this.container = this.getDocument().createElement('div');
    this.container.id = id;
    this.addClass('adsk-control');
}

GlobalManagerMixin.call(Control.prototype);

/**
 * Enum for control event IDs.
 * @readonly
 * @enum {String}
 * @static
 * @alias Autodesk.Viewing.UI.Control.Event
 */
Control.Event = {
    VISIBILITY_CHANGED: 'Control.VisibilityChanged',
    COLLAPSED_CHANGED: 'Control.CollapsedChanged'
};

/**
 * Event fired when the visibility of the control changes.
 *
 * @event Autodesk.Viewing.UI.Control#VISIBILITY_CHANGED
 * @type {object}
 * @property {string} controlId - The ID of the control that fired this event.
 * @property {boolean} isVisible - True if the control is now visible.
 */

/**
 * Event fired when the collapsed state of the control changes.
 *
 * @event Autodesk.Viewing.UI.Control#COLLAPSED_CHANGED
 * @type {object}
 * @property {string} controlId - The ID of the control that fired this event.
 * @property {boolean} isCollapsed - True if the control is now collapsed.
 */

EventDispatcher.prototype.apply(Control.prototype);
Control.prototype.constructor = Control;

/**
 * The HTMLElement representing this control.
 *
 * @type {HTMLElement}
 * @public
 * @alias Autodesk.Viewing.UI.Control.container
 */
Control.prototype.container = null;

/**
 * Gets this control's ID.
 *
 * @returns {string} The control's ID.
 *
 * @alias Autodesk.Viewing.UI.Control#getId
 */
Control.prototype.getId = function() {
    return this._id;
};

/**
 * Sets the visibility of this control.
 *
 * @param {boolean} visible - The visibility value to set.
 * @returns {boolean} True if the control's visibility changed.
 *
 * @fires Autodesk.Viewing.UI.Control#VISIBILITY_CHANGED
 *
 * @alias Autodesk.Viewing.UI.Control#setVisible
 */
Control.prototype.setVisible = function(visible) {
    var isVisible = !this.container.classList.contains('adsk-hidden');

    if (isVisible === visible) {
        return false;
    }

    if (visible) {
        this.container.classList.remove('adsk-hidden');
    } else {
        this.container.classList.add('adsk-hidden');
    }

    var event = {
        type: Control.Event.VISIBILITY_CHANGED,
        target: this,
        controlId: this._id,
        isVisible: visible
    };

    this.dispatchEvent(event);

    return true;
};

/**
 * Gets the visibility of this control.
 * @returns {boolean} True if the this control is visible.
 *
 * @alias Autodesk.Viewing.UI.Control#isVisible
 */
Control.prototype.isVisible = function() {
    return !this.container.classList.contains('adsk-hidden');
};

/**
 * Sets the tooltip text for this control.
 * @param {string} toolTipText - The text for the tooltip.
 * @returns {boolean} True if the tooltip was successfully set.
 *
 * @alias Autodesk.Viewing.UI.Control#setToolTip
 */
Control.prototype.setToolTip = function(toolTipText) {
    if (this._toolTipElement && this._toolTipElement.getAttribute("tooltipText") === toolTipText) {
        return false;
    }

    if (!this._toolTipElement) {
        this._toolTipElement = this.getDocument().createElement('div');
        this._toolTipElement.id = this._id + '-tooltip';
        this._toolTipElement.classList.add('adsk-control-tooltip');
        this.container.appendChild(this._toolTipElement);
    }

    this._toolTipElement.setAttribute("data-i18n", toolTipText);
    this._toolTipElement.setAttribute("tooltipText", toolTipText);
    this._toolTipElement.textContent = Autodesk.Viewing.i18n.translate(toolTipText, { defaultValue: toolTipText });

    return true;
};

/**
 * Returns the tooltip text for this control.
 * @returns {string} The tooltip text. Null if it's not set.
 *
 * @alias Autodesk.Viewing.UI.Control#getToolTip
 */
Control.prototype.getToolTip = function() {
    return this._toolTipElement && this._toolTipElement.getAttribute("tooltipText");
};

/**
 * Sets the collapsed state of this control.
 * @param {boolean} collapsed - The collapsed value to set.
 * @returns {boolean} True if the control's collapsed state changes.
 * @fires Autodesk.Viewing.UI.Control#COLLAPSED_CHANGED
 *
 * @alias Autodesk.Viewing.UI.Control#setCollapsed
 */
Control.prototype.setCollapsed = function(collapsed) {
    if (!this._isCollapsible || this.isCollapsed() === collapsed) {
        return false;
    }

    if (collapsed) {
        this.container.classList.add('collapsed');
    } else {
        this.container.classList.remove('collapsed');
    }

    var event = {
        type: Control.Event.COLLAPSED_CHANGED,
        isCollapsed: collapsed
    };

    this.dispatchEvent(event);

    return true;
};

/**
 * Gets the collapsed state of this control.
 * @returns {boolean} True if this control is collapsed.
 *
 * @alias Autodesk.Viewing.UI.Control#isCollapsed
 */
Control.prototype.isCollapsed = function() {
    return !!this.container.classList.contains('collapsed');
};

/**
 * Returns whether or not this control is collapsible.
 * @returns {boolean} True if this control can be collapsed.
 *
 * @alias Autodesk.Viewing.UI.Control#isCollapsible
 */
Control.prototype.isCollapsible = function() {
    return this._isCollapsible;
};

/**
 * Adds a CSS class to this control.
 * @param {string} cssClass - The name of the CSS class.
 *
 * @alias Autodesk.Viewing.UI.Control#addClass
 *
 */
Control.prototype.addClass = function(cssClass) {
    this.container.classList.add(cssClass);
};

/**
 * Removes a CSS class from this control.
 * @param {string} cssClass - The name of the CSS class.
 *
 * @alias Autodesk.Viewing.UI.Control#removeClass
 */
Control.prototype.removeClass = function(cssClass) {

    this.container.classList.remove(cssClass);

};
    
/**
 * Returns the position of this control relative to the canvas.
 * @returns {object} The `top` and `left` values of the toolbar.
 *
 * @alias Autodesk.Viewing.UI.Control#getPosition
 */
Control.prototype.getPosition = function() {
    var clientRect = this.container.getBoundingClientRect();

    return {top: clientRect.top, left: clientRect.left};
};

/**
 * Returns the dimensions of this control.
 * @returns {object} The `width` and `height` of the toolbar.
 *
 * @alias Autodesk.Viewing.UI.Control#getDimensions
 */
Control.prototype.getDimensions = function() {
    var clientRect = this.container.getBoundingClientRect();

    return {width: clientRect.width, height: clientRect.height};
};

/**
 * Sets the CSS `display` style value.
 *
 * @param {string} value - CSS display value
 *
 * @alias Autodesk.Viewing.UI.Control#setDisplay
 */
Control.prototype.setDisplay = function(value) {
    this.container.style.display = value;
};

/**
 * Removes current control from its parent container.
 * @returns {boolean} True if the control was successfully removed.
 *
 * @alias Autodesk.Viewing.UI.Control#removeFromParent
 */
Control.prototype.removeFromParent = function() {
    // Make sure the current control is assigned to a parent first.
    if (!this.parent) {
        return false;
    }

    return this.parent.removeControl(this);
};