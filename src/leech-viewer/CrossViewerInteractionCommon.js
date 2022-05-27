import * as et from "../application/EventTypes";

// Add here common viewer interactions.
// Some basic examples are object selection sync, camera sync and so on...

// Sync selected objects between viewers.
const onSelectionChanged = {
    eventName: et.AGGREGATE_SELECTION_CHANGED_EVENT,
    cb: (sourceViewer, targetViewer, event) => {
        const curModelsSelSet = sourceViewer.getAggregateSelection();

        if (targetViewer.impl.model) {
            if (curModelsSelSet.length > 0) {
                for (let i = 0; i < curModelsSelSet.length; i++) {
                    const curModelSelSet = curModelsSelSet[i];
                    const selectedModel = curModelSelSet.model;
                    const curSelSet = curModelSelSet.selection;

                    for (let j = 0; j < targetViewer.impl.modelQueue().getModels().length; j++) {
                        const modeltargetViewer = targetViewer.impl.modelQueue().getModels()[j];
                        if (modeltargetViewer && modeltargetViewer.getDocumentNode() && selectedModel.getDocumentNode() &&
                            modeltargetViewer.getDocumentNode().originModel === selectedModel.getDocumentNode().originModel) {
                        
                            if (targetViewer.impl.is2d) {
                                targetViewer.select(curSelSet, modeltargetViewer);
                            } else {
                                targetViewer.showAll();
                                targetViewer.select(curSelSet, modeltargetViewer);
                                targetViewer.isolate(curSelSet, modeltargetViewer);
                            }

                            targetViewer.fitToView(curSelSet);
                        } else if (!targetViewer.impl.is2d && modeltargetViewer.visibilityManager) {
                            // hide all objects in the other models
                            modeltargetViewer.visibilityManager.setAllVisibility(false);
                        }
                    }
                }
            } else {
                targetViewer.clearSelection();
                if (!targetViewer.impl.is2d) {
                    targetViewer.showAll();
                }
            }
        }
    }
};

export const CrossViewerInteractionCommon = {
    onSelectionChanged
};