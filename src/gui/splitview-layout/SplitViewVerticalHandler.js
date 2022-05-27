import SplitViewResizeHandler from './SplitViewResizeHandler';

export default class SplitViewVerticalHandler extends SplitViewResizeHandler {

    initResizeHandlerElement() {
        super.initResizeHandlerElement();

        this.resizeHandlerElement.classList.add('vertical');
        this.handlerSplitLine.classList.add('vertical');

        this.resizeHandlerElement.style.width = `${this.margin}px`;
    }

    getTargetWidthPercentage(e, rect) {
        const adjustedMousePos = e.pageX - rect.left;
        const targetWidthPercentage = (adjustedMousePos / rect.width) * 100;

        return targetWidthPercentage;
    }

    setPosition(percentage) {
        this.resizeHandlerElement.style.left = `calc(${percentage}% - ${this.margin / 2}px)`;
    }
}
