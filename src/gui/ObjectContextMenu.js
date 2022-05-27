
import { ContextMenu } from "./ContextMenu";
import { GlobalManagerMixin } from '../application/GlobalManagerMixin';

/**
 * Context Menu object is the base class for the viewer's context menus.
 *
 * @alias Autodesk.Viewing.UI.ObjectContextMenu
 * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer instance.
 * @class
 */
export function ObjectContextMenu(viewer) {
    this.viewer = viewer;
    this.setGlobalManager(viewer.globalManager);
    this.contextMenu = new ContextMenu(viewer);
}

ObjectContextMenu.prototype.constructor = ObjectContextMenu;
GlobalManagerMixin.call(ObjectContextMenu.prototype);

/**
 * Shows the context menu.
 *
 * @param {Event} event - Browser event that requested the context menu.
 */
ObjectContextMenu.prototype.show = function (event) {
    var numSelected = this.viewer.getSelectionCount(),
        visibility = this.viewer.getSelectionVisibility(),
        rect = this.viewer.impl.getCanvasBoundingClientRect(),
        status = {
            event: event,
            numSelected: numSelected,
            hasSelected: (0 < numSelected),
            hasVisible: visibility.hasVisible,
            hasHidden: visibility.hasHidden,
            canvasX: event.clientX - rect.left,
            canvasY: event.clientY - rect.top
        },
        menu = this.buildMenu(event, status);

    this.viewer.runContextMenuCallbacks(menu, status);

    if (menu && 0 < menu.length) {
        this.contextMenu.show(event, menu);
    }
};

/**
 * Hides the context menu.
 *
 * @returns {boolean} True if the context menu was open, false otherwise.
 */
ObjectContextMenu.prototype.hide = function () {
    return this.contextMenu.hide();
};

/**
 * Builds the context menu to be displayed.
 * Override this method to change the context menu.
 *
 * Sample menu item:
 * `{title: 'This is a menu item', target: function () {alert('Menu item clicked');}}`.
 * A submenu can be specified by providing an array of submenu items as the target.
 *
 * @param {Event} event - Browser event that requested the context menu.
 * @param {object} status - Information about nodes.
 * @param {number} status.numSelected - The number of selected objects.
 * @param {boolean} status.hasSelected - True if there is at least one selected object.
 * @param {boolean} status.hasVisible - True if at least one selected object is visible.
 * @param {boolean} status.hasHidden - True if at least one selected object is hidden.
 * @returns {Array} An array of menu items.
 */
ObjectContextMenu.prototype.buildMenu = function () {
    return null;
};
