
import { ObjectContextMenu } from "./ObjectContextMenu";
import { logger } from "../logger/Logger";


/**
 * Constructs a ViewerObjectContextMenu object.
 * @param {Viewer} viewer
 * @constructor
 */
export function ViewerObjectContextMenu(viewer) {
    ObjectContextMenu.call(this, viewer);
}

ViewerObjectContextMenu.prototype = Object.create(ObjectContextMenu.prototype);
ViewerObjectContextMenu.prototype.constructor = ViewerObjectContextMenu;

/**
 * Builds the context menu to be displayed.
 * @override
 * @param {Event} event - Browser event that requested the context menu
 * @param {Object} status - Information about nodes: numSelected, hasSelected, hasVisible, hasHidden.
 * @returns {?Array} An array of menu items.
 */
ViewerObjectContextMenu.prototype.buildMenu = function (event, status) {

    // Context menu varies depending on whether we show 2D or 3D models. If we have neither 2d nor 3d, just don't create it.
    if (!this.viewer.model) {
        return;
    }

    var that = this,
        menu = [],
        nav = this.viewer.navigation,
        is2d = this.viewer.model.is2d();
        const analytics = Autodesk.Viewing.Private.analytics;

    // the title strings here are added to the viewer.loc.json for localization
    if (status.hasSelected) {
        menu.push({
            title: "Isolate",
            target: function () {  
                var selection = that.viewer.getAggregateSelection();
                that.viewer.clearSelection();
                that.viewer.impl.visibilityManager.aggregateIsolate(selection);
                logger.track({name: 'isolate_count', aggregate: 'count'});
                analytics.track('viewer.object.visibility', {
                    action: 'Isolate',
                });             
            }
        });
        if (status.hasVisible) {
            menu.push({
                title: "Hide Selected",
                target: function () {
                    const selected = that.viewer.impl.selector.getAggregateSelection();
                    that.viewer.clearSelection();
                    that.viewer.impl.visibilityManager.aggregateHide(selected);
                    analytics.track('viewer.object.visibility', {
                        action: 'Hide Selected',
                    });     
                }
            });
        }
        if (status.hasHidden) {
            menu.push({
                title: "Show Selected",
                target: function () {
                    // This is such a weird use case. Users can't select hidden nodes.
                    // For this to work, selection must have been done through code.
                    var selected = that.viewer.getSelection();
                    that.viewer.clearSelection();
                    that.viewer.show(selected);
                    analytics.track('viewer.object.visibility', {
                        action: 'Show Selected',
                    });  
                }
            });
        }
    }

    if (is2d) {
        menu.push({
            title: "Show All Layers",
            target: function () {
                that.viewer.setLayerVisible(null, true);
                analytics.track('viewer.object.visibility', {
                    action: 'Show All Layers',
                }); 
            }
        });
    }

    menu.push({
        title: "Show All Objects",
        target: function () {
            that.viewer.showAll();
            logger.track({ name: 'showall', aggregate: 'count' });
            analytics.track('viewer.object.visibility', {
                action: 'Show All Objects',
            }); 
        }
    });


    // Fit-to-view only work with selections from one model.
    var aggregateSelection = that.viewer.getAggregateSelection();
    if (!is2d && aggregateSelection.length === 1 && nav.isActionEnabled('gotoview')) {
        menu.push({
            title: "Focus",
            target: function () {
                aggregateSelection = that.viewer.getAggregateSelection(); // Get the aggregate selection again
                if (aggregateSelection.length > 0){
                    var singleRes = aggregateSelection[0];
                    that.viewer.fitToView(singleRes.selection, singleRes.model);
                } else if (aggregateSelection.length === 0) {
                    that.viewer.fitToView(); // Fit to whole model, the first one loaded.
                }
                logger.track({ name: 'fittoview', aggregate: 'count' });
            }
        });
    }

    // Pivot point
    if (!is2d) {
        var rect = this.viewer.impl.getCanvasBoundingClientRect();
        var canvasX = event.clientX - rect.left;
        var canvasY = event.clientY - rect.top;
        var res = this.viewer.clientToWorld(canvasX, canvasY, false);
        if (res) {
            menu.push({
                title: "Pivot",
                target: () => {
                    this.viewer.navigation.setPivotPoint(res.point);
                }
            });
        }
    }

    if (status.hasSelected) {
        menu.push({
            title: "Clear Selection",
            target: function () {
                that.viewer.clearSelection();
                logger.track({ name: 'clearselection', aggregate: 'count' });
            }
        });
    }

    return menu;
};
