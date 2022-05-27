/*eslint no-unused-vars: ["error", { "args": "none" }]*/

/**
 * Base class for new interaction tools.
 *
 * Can also be used simply as a template for creating a new tool.
 *
 * @class
 * @see Autodesk.Viewing.ToolController
 * @alias Autodesk.Viewing.ToolInterface
 */
export function ToolInterface()
{
    this.names = [ "unnamed" ];

    /**
     * This method should return an array containing the names of all tools implemented by this class.
     * Often this would be a single name but it is possible to support multiple interactions with a single tool.
     * When this tool is registered with the ToolController each name gets registered as an available tool.
     *
     * @returns {Array} Array of strings. Should not be empty.
     */
    this.getNames = function() {
        return this.names;
    };

    /**
     * This is an optional convenience method to obtain the first name of this tool.
     *
     * @returns {string} The tools default name.
     */
    this.getName = function() {
        return this.names[0];
    };

    /**
     * This method should return the priority of the tool inside the tool stack.
     * A tool with higher priority will get events first.
     *
     * @returns {number} The tool's priority.
     */
    this.getPriority = function() {
        return 0;
    };

    /**
     * This method is called by {@link Autodesk.Viewing.ToolController#registerTool}.
     * Use this for initialization.
     */
    this.register = function() {
    };

    /**
     * This method is called by {@link Autodesk.Viewing.ToolController#deregisterTool}.
     * Use this to clean up your tool.
     */
    this.deregister = function() {
    };

    /**
     * The activate method is called by the ToolController when it adds this tool to the list of those
     * to receive event handling calls. Once activated, a tool's "handle*" methods may be called
     * if no other higher priority tool handles the given event. Each active tool's "update" method also gets
     * called once during each redraw loop.
     *
     * @param {string} name - The name under which the tool has been activated.
     * @param {Autodesk.Viewing.Viewer3D} viewerApi - Viewer instance.
     */
    this.activate = function(name, viewerApi) {
    };

    /**
     * The deactivate method is called by the ToolController when it removes this tool from the list of those
     * to receive event handling calls. Once deactivated, a tool's "handle*" methods and "update" method
     * will no longer be called.
     *
     * @param {string} name - The name under which the tool has been deactivated.
     */
    this.deactivate = function(name) {
    };

    /**
     * The update method is called by the ToolController once per frame and provides each tool
     * with the oportunity to make modifications to the scene or the view.
     *
     * @param {number} highResTimestamp - The process timestamp passed to requestAnimationFrame by the web browser.
     * @returns {boolean} A state value indicating whether the tool has modified the view or the scene
     * and a full refresh is required.
     */
    this.update = function(highResTimestamp) {
        return false;
    };

    /**
     * This method is called when a single mouse button click occurs.
     *
     * @param {MouseEvent} event - The event object that triggered this call.
     * @param {number} button - The button number that was clicked (0, 1, 2 for Left, Middle, Right respectively).
     * Note that the button parameter value may be different that the button value indicated in the event
     * object due to button re-mapping preferences that may be applied. This value should be respected
     * over the value in the event object.
     * @returns {boolean} True if this tool wishes to consume the event and false to continue to pass
     * the event to lower priority active tools.
     */
    this.handleSingleClick = function( event, button ) {
        return false;
    };

    /**
     * This method is called when a double mouse button click occurs.
     *
     * @param {MouseEvent} event - The event object that triggered this call.
     * @param {number} button - The button number that was clicked (0, 1, 2 for Left, Middle, Right respectively).
     * Note that the button parameter value may be different that the button value indicated in the event
     * object due to button re-mapping preferences that may be applied. This value should be respected
     * over the value in the event object.
     * @returns {boolean} True if this tool wishes to consume the event and false to continue to pass the event
     * to lower priority active tools.
     */
    this.handleDoubleClick = function( event, button ) {
        return false;
    };

    /**
     * This method is called when a single tap on a touch device occurs.
     *
     * @param {Event} event - The triggering event. For tap events the canvasX, canvasY properties contain
     * the canvas relative device coordinates of the tap and the normalizedX, normalizedY properties contain
     * the tap coordinates in the normalized [-1, 1] range. The event.pointers array will contain
     * either one or two touch events depending on whether the tap used one or two fingers.
     * @returns {boolean} True if this tool wishes to consume the event and false to continue to pass the event
     * to lower priority active tools.
     */
    this.handleSingleTap = function( event ) {
        return false;
    };

    /**
     * This method is called when a double tap on a touch device occurs.
     *
     * @param {Event} event - The triggering event. For tap events the canvasX, canvasY properties contain
     * the canvas relative device coordinates of the tap and the normalizedX, normalizedY properties contain
     * the tap coordinates in the normalized [-1, 1] range. The event.pointers array will contain
     * either one or two touch events depending on whether the tap used one or two fingers.
     * @returns {boolean} True if this tool wishes to consume the event and false to continue to pass the event
     * to lower priority active tools.
     */
    this.handleDoubleTap = function( event ) {
        return false;
    };

    /**
     * This method is called when a keyboard button is depressed.
     *
     * @param {KeyboardEvent} event - The event object that triggered this call.
     * @param {number} keyCode - The numerical key code identifying the key that was depressed.
     * Note that the keyCode parameter value may be different that the value indicated in the event object
     * due to key re-mapping preferences that may be applied. This value should be respected
     * over the value in the event object.
     * @returns {boolean} True if this tool wishes to consume the event and false to continue to pass the event
     * to lower priority active tools.
     */
    this.handleKeyDown = function( event, keyCode ) {
        return false;
    };

    /**
     * This method is called when a keyboard button is released.
     *
     * @param {KeyboardEvent} event - The event object that triggered this call.
     * @param {number} keyCode - The numerical key code identifying the key that was released.
     * Note that the keyCode parameter value may be different that the value indicated in the event object
     * due to key re-mapping preferences that may be applied. This value should be respected
     * over the value in the event object.
     * @returns {boolean} True if this tool wishes to consume the event and false to continue to pass the event
     * to lower priority active tools.
     */
    this.handleKeyUp = function( event, keyCode ) {
        return false;
    };

    /**
     * This method is called when a mouse wheel event occurs.
     *
     * @param {number} delta - A numerical value indicating the amount of wheel motion applied.
     * Note that this value may be modified from the orignal event values so as to provide consistent results
     * across browser families.
     * @returns {boolean} True if this tool wishes to consume the event and false to continue to pass the event
     * to lower priority active tools.
     */
    this.handleWheelInput = function(delta) {
        return false;
    };

    /**
     * This method is called when a mouse button is depressed.
     *
     * @param {MouseEvent} event - The event object that triggered this call.
     * @param {number} button - The button number that was depressed (0, 1, 2 for Left, Middle, Right respectively).
     * Note that the button parameter value may be different that the button value indicated in the event object
     * due to button re-mapping preferences that may be applied. This value should be respected
     * over the value in the event object.
     * @returns {boolean} True if this tool wishes to consume the event and false to continue to pass the event
     * to lower priority active tools.
     */
    this.handleButtonDown = function(event, button) {
        return false;
    };

    /**
     * This method is called when a mouse button is released.
     *
     * @param {MouseEvent} event - The event object that triggered this call.
     * @param {number} button - The button number that was released (0, 1, 2 for Left, Middle, Right respectively).
     * Note that the button parameter value may be different that the button value indicated in the event object
     * due to button re-mapping preferences that may be applied. This value should be respected
     * over the value in the event object.
     * @returns {boolean} True if this tool wishes to consume the event and false to continue to pass the event
     * to lower priority active tools.
     */
    this.handleButtonUp = function(event, button) {
        return false;
    };

    /**
     * This method is called when a mouse motion event occurs.
     *
     * @param {MouseEvent} event - The event object that triggered this call.
     * @returns {boolean} True if this tool wishes to consume the event and false to continue to pass the event
     * to lower priority active tools.
     */
    this.handleMouseMove = function(event) {
        return false;
    };

    /**
     * This method is called when a touch gesture event occurs.
     *
     * @param {Event} event - The event object that triggered this call. The event.type attribute will indicate
     * the gesture event type. This will be one of: dragstart, dragmove, dragend, panstart, panmove, panend,
     * pinchstart, pinchmove, pinchend, rotatestart, rotatemove, rotateend, drag3start, drag3move, drag3end.
     * The event.canvas[XY] attributes will contain the coresponding touch position.
     * The event.scale and event.rotation attributes contain pinch scaling and two finger rotation quantities
     * respectively. The deltaX and deltaY attributes will contain drag offsets.
     * @returns {boolean} True if this tool wishes to consume the event and false to continue to pass the event
     * to lower priority active tools.
     */
    this.handleGesture = function(event) {
        return false;
    };

    /**
     * This method is called when the canvas area loses focus.
     *
     * @param {FocusEvent} event - The event object that triggered this call.
     * @returns {boolean} True if this tool wishes to consume the event and false to continue to pass the event
     * to lower priority active tools.
     */
    this.handleBlur = function(event) {
        return false;
    };

    /**
     * This method is called on every active tool whenever the screen area changes.
     * The new canvas area can be obtained from the Navigation interface via the getScreenViewport method.
     *
     * @see Autodesk.Viewing.Navigation
     */
    this.handleResize = function() {
    };
}
