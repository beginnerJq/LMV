const inputMap = {
    down: {
        pointer: 'pointerdown',
        mouse: 'mousedown',
        touch: 'touchstart'
    },
    up: {
        pointer: 'pointerup',
        mouse: 'mouseup',
        touch: 'touchend'
    },
    move: {
        pointer: 'pointermove',
        mouse: 'mousemove',
        touch: 'touchmove'
    }
};

function _getInputEvents(type) {
    if (Autodesk.Viewing.isIE11) {
        return [inputMap[type].pointer];
    }

    const events = [];
    if (!Autodesk.Viewing.isMobileDevice()) {
        events.push(inputMap[type].mouse);
    }

    if (Autodesk.Viewing.isTouchDevice()) {
        events.push(inputMap[type].touch);
    }

    return events;
}

function addRemoveInputEvents(elem, type, cb, isRemoving = false) {
    const action = (isRemoving ? 'remove' : 'add') + 'EventListener';
    const events = _getInputEvents(type);
    for (const event of events) {
        elem[action](event, cb);
    }
}

export default class SplitViewResizeHandler {
    constructor(container, onMoveCB) {
        this.container = container;
        this.isDragging = false;
        this.resizeHandlerElement = null;
        this.onMoveCB = onMoveCB;
        this.panelSizeThreshold = 20;
        this.margin = 16;
        this.initResizeHandlerElement();
    }

    onDown(e) {
        this.isDragging = true;
        e.preventDefault();
    }

    onUp(e) {
        this.isDragging = false;
    }

    onMove(e) {
        if (this.isDragging) {
            if (e.type === 'touchmove') {
                e.pageX = e.touches[0].pageX;
                e.pageY = e.touches[0].pageY;
            }

            const rect = this.container.getBoundingClientRect();

            const targetWidthPercentage = this.getTargetWidthPercentage(e, rect);

            if (this.panelSizeThreshold < targetWidthPercentage && targetWidthPercentage < (100 - this.panelSizeThreshold)) {
                this.onMoveCB(targetWidthPercentage);
            }
        }
    }

    getTargetWidthPercentage(e, rect) {
        // Override
    }

    initResizeHandlerElement() {
        this.resizeHandlerElement = document.createElement('div');
        this.handlerSplitLine = document.createElement('div');
        this.resizeHandlerElement.appendChild(this.handlerSplitLine);

        addRemoveInputEvents(this.resizeHandlerElement, 'down', this.onDown.bind(this));

        this.onUpBinded = this.onUp.bind(this);
        this.onMoveBinded = this.onMove.bind(this);

        addRemoveInputEvents(document, 'move', this.onMoveBinded);
        addRemoveInputEvents(document, 'up', this.onUpBinded);

        this.resizeHandlerElement.className = 'resize-handler';
        this.handlerSplitLine.className = 'resize-handler-center-mark';
    }

    setPosition(percentage) {
        // Override
    }

    terminate() {
        this.resizeHandlerElement.parentNode.removeChild(this.resizeHandlerElement);
        this.resizeHandlerElement = null;
        addRemoveInputEvents(document, 'up', this.onUpBinded, true);
        addRemoveInputEvents(document, 'move', this.onMoveBinded, true);
    }
}
