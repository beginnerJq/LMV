import SplitViewResizeHandler from './SplitViewResizeHandler';

export default class SplitViewHorizontalHandler extends SplitViewResizeHandler {

    initResizeHandlerElement() {
        super.initResizeHandlerElement();

        this.resizeHandlerElement.classList.add('horizontal');
        this.handlerSplitLine.classList.add('horizontal');

        this.resizeHandlerElement.style.height = `${this.margin}px`;
    }

    getTargetWidthPercentage(e, rect) {
        const adjustedMousePos = e.pageY - rect.top;
        const targetWidthPercentage = (adjustedMousePos / rect.height) * 100;

        return targetWidthPercentage;
    }

    setPosition(percentage) {
        this.resizeHandlerElement.style.top = `calc(${percentage}% - ${this.margin / 2}px)`;
    }
}
