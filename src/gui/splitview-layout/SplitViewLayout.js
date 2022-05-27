import SplitViewVerticalHandler from './SplitViewVerticalHandler';
import SplitViewHorizontalHandler from './SplitViewHorizontalHandler';
import './SplitViewLayout.scss';

export class SplitViewLayout {
    constructor(splitType) {
        this._splitType = splitType || SplitViewLayout.SplitType.Vertical;

        this.onResizeHandlerMove = this.onResizeHandlerMove.bind(this);
    }

    createSplitViewLayout(targetContainer, first, second) {
        this.targetContainer = targetContainer;

        // Create split container
        this.splitViewContainer = document.createElement('div');
        this.splitViewContainer.classList.add('split-view-container');

        // replace target div with the split container
        this.targetContainer.parentNode.replaceChild(this.splitViewContainer, this.targetContainer);

        // Wrap first viewer
        this.firstViewerContainer = this.wrapViewerContainer(first);

        // Add resize handler
        if (this._splitType === SplitViewLayout.SplitType.Vertical) {
            this._resizeHandler = new SplitViewVerticalHandler(this.splitViewContainer, this.onResizeHandlerMove);
        } else if (this._splitType === SplitViewLayout.SplitType.Horizontal) {
            this._resizeHandler = new SplitViewHorizontalHandler(this.splitViewContainer, this.onResizeHandlerMove);
        } else {
            console.error("unknown splitType");
            return;
        }

        if (this._resizeHandler) {
            this.splitViewContainer.appendChild(this._resizeHandler.resizeHandlerElement);
        }

        // Wrap second viewer
        this.secondViewerContainer = this.wrapViewerContainer(second);

        this.onResizeHandlerMove(50);
    }

    wrapViewerContainer(elementToWrap) {
        const container = document.createElement('div');
        container.className = 'split-view-viewer-container';

        if (elementToWrap) {
            container.appendChild(elementToWrap);
        }

        this.splitViewContainer.appendChild(container);
        return container;
    }

    restoreMainViewer() {
        if (this._resizeHandler) {
            this._resizeHandler.terminate();
            this._resizeHandler = null;
        }

        if (this.splitViewContainer) {
            // restore original target to its place
            this.splitViewContainer.parentNode.replaceChild(this.targetContainer, this.splitViewContainer);
            this.splitViewContainer = null;
            this.targetContainer = null;
            this.firstViewerContainer = null;
            this.secondViewerContainer = null;
        }
    }

    onResizeHandlerMove(targetWidthPercentage) {
        if (this._resizeHandler) {
            this._resizeHandler.setPosition(targetWidthPercentage);
        }

        if (this._splitType === SplitViewLayout.SplitType.Vertical) {
            this.firstViewerContainer.style.width = `${targetWidthPercentage}%`;
            this.secondViewerContainer.style.width = `${100 - targetWidthPercentage}%`;
            this.secondViewerContainer.style.left = `${targetWidthPercentage}%`;
        } else if (this._splitType === SplitViewLayout.SplitType.Horizontal) {
            this.firstViewerContainer.style.height = `${targetWidthPercentage}%`;
            this.secondViewerContainer.style.height = `${100 - targetWidthPercentage}%`;
            this.secondViewerContainer.style.top = `${targetWidthPercentage}%`;
        }
    }
}

SplitViewLayout.SplitType = { Vertical: 'vertical', Horizontal: 'horizontal' };
