
import { ControlGroup } from "../controls/ControlGroup";
import { Control } from "../controls/Control";


/**
 * Core class representing a toolbar UI.
 *
 * It consists of {@link Autodesk.Viewing.UI.ControlGroup} that group controls by functionality.
 *
 * @alias Autodesk.Viewing.UI.ToolBar
 * @param {string} id - The id for this toolbar.
 * @param {object} [options] - An optional dictionary of options.
 * @param {boolean} [options.collapsible=true] - Whether this toolbar is collapsible.
 * @param {boolean} [options.alignVertically=false] - Whether this toolbar should be vertically positioned on the right side.
 * @class
 * @augments Autodesk.Viewing.UI.ControlGroup
 * @memberof Autodesk.Viewing.UI
 */
export function ToolBar(id, options) {
    ControlGroup.call(this, id, options);

    this.removeClass('adsk-control-group');
    this.addClass('adsk-toolbar');

    if (options && options.alignVertically) {
        this.addClass('adsk-toolbar-vertical');
    }
}

/**
 * Enum for toolbar event IDs.
 *
 * @readonly
 * @enum {string}
 */
ToolBar.Event = {
    // Inherited from Control
    VISIBILITY_CHANGED: Control.Event.VISIBILITY_CHANGED,
    COLLAPSED_CHANGED: Control.Event.COLLAPSED_CHANGED,

    // Inherited from ControlGroup
    CONTROL_ADDED: ControlGroup.Event.CONTROL_ADDED,
    CONTROL_REMOVED: ControlGroup.Event.CONTROL_REMOVED,
    SIZE_CHANGED: ControlGroup.Event.SIZE_CHANGED
};

ToolBar.prototype = Object.create(ControlGroup.prototype);
ToolBar.prototype.constructor = ToolBar;

