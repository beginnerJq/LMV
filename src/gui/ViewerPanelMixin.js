
export function ViewerPanelMixin()
{
    /**
     * Returns the parent's container bounding rectangle.
     *
     * @returns {ClientRect} - bounding rectangle of the parent.
     */
    this.getContainerBoundingRect = function () {
        var bounds = this.parentContainer.getBoundingClientRect();

        var toolbarBounds = {
            height: 0,
            width:  0,
            left:   0,
            bottom: 0,
            right:  0,
            top:    0
        };

        var _document = this.getDocument();
        var toolbar = _document.getElementsByClassName("toolbar-menu");
        if (toolbar && toolbar.length>0) {
            toolbarBounds = toolbar[0].getBoundingClientRect();
        }

        // TODO: This assumes that toolbar is horizontal and at the bottom.
        // Once the toolbar can be positioned somewhere else (top, right, left)
        // this code will need to be expanded to return the right bounds for each case.
        return {
            height: bounds.height - toolbarBounds.height,
            width:  bounds.width,
            left:   bounds.left,
            bottom: bounds.bottom - toolbarBounds.height,
            right:  bounds.right,
            top:    bounds.top
        };
    };
}