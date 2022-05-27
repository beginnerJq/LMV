import * as et from "../../application/EventTypes";

/**
 * Generates handler logic when using a Viewer instance
 * @param {Autodesk.Viewing.GuiViewer3D} viewer 
 * @returns {ViewerModelStructurePanelOptions} Object defining default implementation for default Viewer handler
 */
export const generateDefaultViewerHandlerOptions = (viewer) => {
  return {
    onSearchSelected: function (event) {
      var dbId = event.id;
      var model = viewer.impl.findModel(event.modelId);
      viewer.isolate(dbId, model);
    },
    onVisibilityIconClick: function (dbId, model) {
      viewer.toggleVisibility(dbId, model);
    },
    onCreateUI: function (context) {
      if (viewer.resizePanels) {
        viewer.resizePanels({ dockingPanels: [context] });
      }

      // Show context menu on right click over the panel.
      context.scrollContainer.addEventListener('contextmenu', function (event) {
        viewer.contextMenu.show(event);
      }.bind(context));
    },
    onIsolate: function (dbId, model) {
      viewer.isolate(dbId, model);
      viewer.fitToView([dbId], model, false);

      // fire show properties event
      if (model) {
        var event = {
          type: et.SHOW_PROPERTIES_EVENT,
          dbId: dbId,
          model: model
        };
        viewer.dispatchEvent(event);
      }
    },
    onToggleMultipleOverlayedSelection: function (selection) {

      viewer.impl.selector.setAggregateSelection(selection.map(s => ({
        model: viewer.impl.findModel(parseInt(s.modelId)),
        ids: s.ids
      })));

      var aggregatedSelection = viewer.getAggregateSelection();
      viewer.fitToView(aggregatedSelection);
    },
    onToggleOverlayedSelection: function (dbId, model, isSelected) {
      if (isSelected) {
        viewer.select([], undefined, model);
      } else {
        viewer.select(dbId, model);
        viewer.fitToView([dbId], model, false);
      }
    },
    onTreeNodeRightClick: function (event) {
      viewer.contextMenu.show(event);
    },
    onSelectOnly: function (dbId, model) {
      viewer.select(dbId, model);
    },
    onDeselectAll: function () {
      viewer.clearSelection();
    },
    onSelectToggle: function (dbId, model) {
      viewer.toggleSelect(dbId, model);
    },
    onShowAll: function () {
      viewer.showAll();
    },
    onFocus: function () {
      viewer.fitToView();
    },
    onHide: function (dbId, model) {
      viewer.hide(dbId, model);
    },
    onShow: function (dbId, model) {
      viewer.show(dbId, model);
    },
    onToggleVisibility: function (dbId, model) {
      viewer.toggleVisibility(dbId, model);
    },
    getAggregateIsolation: viewer.getAggregateIsolation.bind(viewer),
    getAggregateHiddenNodes: viewer.getAggregateHiddenNodes.bind(viewer),
    getAggregateSelection: viewer.getAggregateSelection.bind(viewer),
    globalManager: viewer.globalManager,
    container: viewer.container,
    removeEventListener: viewer.removeEventListener.bind(viewer),
    addEventListener: viewer.addEventListener.bind(viewer)
  };
};
