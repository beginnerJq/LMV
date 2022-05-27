
import { isIE11, inFullscreen } from "../compat";
import { logger } from "../logger/Logger";
import * as et from "../application/EventTypes";
import { KeyCode } from "./KeyCode";
import { GlobalManagerMixin } from '../application/GlobalManagerMixin';


/**
 * Core interface to add and remove canvas interactions to the viewer.
 *
 * This class is created internally by the Viewer api and is available via the "toolController" property
 * of the Viewer3D api object. Client implementations should not normally instantiate this class directly.
 *
 * @param {object} viewerImpl - The viewer implementation object.
 * @param {object} viewerApi - The viewer api object.
 * @param {object} autocam - The Autocam interface object.
 * @param {object} utilities - The ViewingUtilities object.
 * @param {object} defaultHandler - The default event handling tool.
 * @class
 * @alias Autodesk.Viewing.ToolController
 */
export function ToolController( viewerImpl, viewerApi, autocam, utilities, defaultHandler )
{

    this.setGlobalManager(viewerApi.globalManager);
    this.domElement = viewerApi.canvasWrap;
    this.selector = viewerImpl.selector;
    this.autocam = autocam;
    this.lastClickX = -1;
    this.lastClickY = -1;
    this.scrollInputEnabled = true;
    this.keyMapCmd = true;

    // By default, any handled event is stopped from further propagation,
    // so the client UI will not receive it anymore. This can prevent unexpected double
    // event handling. However, it may also cause problems, e.g., it makes it impossible for alloy
    // to detect outside clicks for closing open dropdown menus (FLUENT-5378). That's why we make it optional.
    this.propagateInputEventTypes = [];

    var isMac = (navigator.userAgent.search("Mac OS") !== -1);
    var isFirefox = (navigator.userAgent.search("Firefox") !== -1);
    var isChrome = (navigator.userAgent.search("Chrome") !== -1);
    var isSafari = (navigator.userAgent.search("Safari") !== -1 && !isChrome); // Chrome has both Safari and Chrome in the string

    var kMouseLeft = 0;
    var kMouseRight = 2;

    var kClickThreshold = 2;        // Pixels
    var kDoubleClickDelayThreshold = 500; // ms

    var _tools = {};
    var _toolModality = {};
    var _toolStateChangedCbs = {};
    var _toolStack = [];
    var _lock = false;
    var _downX = -1;
    var _downY = -1;

    var _firefoxLMBfix = false;
    var _currentCursor = null;
    var _mouseEnabled = false;

    // Save click parameters when clicking with right mouse button
    // and "Left handed mouse setup" is enabled so that we can
    // simulate a double-click with the right mouse button.
    //
    var _checkMouseDoubleClick = {};

    var _this = this;

    this.__registerToolByName = function(tool, toolName)
    {
        _tools[toolName] = tool;
    };

    /**
     * This method registers an event handling tool with the controller.
     * This makes the tool available for activation and deactivation.
     * Tools are registered under one or more names which must be provided via their "getNames" method.
     * The tools "getNames" method must return an array of one or more names.
     * Typically a tool will only have one name but if it wishes to operate in different modes it can use
     * different names to activate the modes. Registered tools have the properties named
     * "utilities" and "controller" added to them which refer to the ViewingUtilities object and this controller
     * respectively. Tools may not use the name "default" which is reserved.
     *
     *  @param {object} tool - The tool to be registered.
     * @param {Function} onStateChanged - callback to be called when disabling the tool through the modality map
     */
    this.registerTool = function(tool, onStateChanged)
    {
        var names = tool.getNames();

        if( !names || names.length === 0 )
        {
            logger.warn("Cannot register tool with no name.");
            return false;
        }
        var registered = false;
        for( var i = 0; i < names.length; ++i )
        {
            if( names[i] !== "default" )
            {
                this.__registerToolByName(tool, names[i]);
                const defualtStateChangedCb = (enable) => {
                    const name = tool.getName();
                    if (enable) {
                        this.activateTool(name);
                    } else {
                        this.deactivateTool(name);
                    }
                };
                _toolStateChangedCbs[names[i]] = onStateChanged && onStateChanged instanceof Function ? onStateChanged : defualtStateChangedCb;
                registered = true;
            }
        }

        tool.utilities = utilities;
        tool.controller = this;
        if (tool.register) tool.register();

        return registered;
    };

    /**
     * This method deregisters an event handling tool with the controller afterwhich it will no longer
     * be available for activation and deactivation. All names that the tool is registered under
     * will be deregistered. If any tool is active at the time of deregistration will first be deactivated
     * and it's "deactivate" method will be called.
     *
     *  @param {object} tool - The tool to be deregistered.
     */
    this.deregisterTool = function(tool)
    {
        this.deactivateTool(tool.getName());

        var names = tool.getNames();

        if( !names || names.length === 0 )
        {
            return false;
        }
        for( var i = names.length; --i >= 0; )
            this.__deregisterToolName(names[i]);

        if (tool.deregister) tool.deregister();
        tool.utilities = null;
        tool.controller = null;
        return true;
    };

    this.__deregisterToolName = function(name)
    {
        /**
         * @param name
         * @private
         */
        function cleanStack(name)
        {
            for( var i = _toolStack.length;  --i >= 0;  )
                if( _toolStack[i].activeName === name )
                {
                    _tools[name].deactivate(name);
                    _toolStack.splice(i, 1);
                }
        }
        if( name in _tools )
        {
            cleanStack(name);
            delete _tools[name];
        }
    };

    /**
     * This method returns the tool registered under the given name.
     *
     * @param {string} name - The tool name to look up.
     * @returns {object} The tool registered under the given name or undefined if not found.
     */
    this.getTool = function(name)
    {
        return _tools[name];
    };

    /**
     * This method returns the name of the topmost tool on the tool stack.
     * If no tools are active the name of the default tool is returned (which is "default").
     *
     * @returns {string} The tool name to look up.
     */
    this.getActiveToolName = function()
    {
        var l = _toolStack.length;
        return (l > 0) ? _toolStack[l-1].activeName : "default";
    };

    /**
     * This method returns the name of the topmost tool on the tool stack.
     * If no tools are active the name of the default tool is returned (which is "default").
     *
     * @returns {string} The tool name to look up.
     */
    this.getActiveTool = function()
    {
        var l = _toolStack.length;
        return (l > 0) ? _toolStack[l-1] : _tools["default"];
    };

    /**
     * Return the current tool stack.
     *
     * @returns {Array} - list of tools in the tool stack
     */
    this.getActiveTools = function() {
        return _toolStack.slice();
    };


    this.isToolActivated = function(toolName)
    {
        for (var i = 0; i < _toolStack.length; i++) {

            if (_toolStack[i].activeName === toolName) {
                return true;
            }
        }
        return false;
    };

    this.setToolActiveName = function(toolName)
    {
        var tool = _tools[toolName];
        if (tool) {
            tool.activeName = toolName;
        }
    };

    /**
     * @param {object} tool - Tool to obtain priority
     */
    function getPriority(tool)
    {
        return ((tool.getPriority instanceof Function) && tool.getPriority()) || 0;
    }

    /**
     * Sorts the toolStack according to the tools' priority.
     * Useful when a tool's priority gets changed after activation.
     */
    this.rearrangeByPriorities = function() {
        _toolStack.sort(function (a, b) {
            return getPriority(a) - getPriority(b);
        });
    };

    /**
     * Disables or enables tools in the tool's modality map
     *
     * @param {string} toolName - Name of the tool
     */
    this.activateToolModality = function (toolName) {
        const modalityMap = this.getToolModality(toolName);
        for (let name in modalityMap) {
            const enable = modalityMap[name];
            const stateChangedCb = _toolStateChangedCbs[name];
            const isActive = this.isToolActivated(name);
            if (enable !== isActive && stateChangedCb) {
                stateChangedCb(enable, name);
            }
        }
    };

    /**
     * Activates the tool registered under the given name. Activation implies pushing the tool
     * on a stack of "active" tools, each of which (starting from the top of the stack) is given
     * the opportunity to handle incoming events. Tools may "consume" events by returning true
     * from their event handling methods, or they may allow events to be passed down to the next tool
     * on the stack by returning false from the handling methods.
     * Upon activation the tools "activate" method is called with the name under which it has been activated.
     * Activation is not allowed while the controller is in a "locked" state (see the methods "setIsLocked"
     * and "getIsLocked"). Tools must be registered prior to activation (see the methods "registerTool"
     * and "deregisterTool").
     * Each tool has its own priority property (default 0), such that a tool with higher priority will get events first.
     *
     * @param {string} toolName - The name of the tool to be activated.
     * @returns {boolean} True if activation was successful.
     */
    this.activateTool = function(toolName)
    {
        if( _lock )
            return false;

        var tool = _tools[toolName];

        this.activateToolModality(toolName);

        if( tool )
        {
            if (tool.count === undefined)
                tool.count = 0;

            var interceptor = null;
            if (_toolStack.length && _toolStack[_toolStack.length - 1].activeName === "intercept") {
                interceptor = _toolStack.pop();
            }

            var indexToPush = 0;

            for (var i = 0; i < _toolStack.length; i++) {

                if (_toolStack[i] === tool) {
                    tool.count++;
                }

                if (getPriority(_toolStack[i]) <= getPriority(tool)) {
                    indexToPush = i + 1;
                }
            }

            tool.activeName = toolName;

            // If the tool belongs to a same instance in tool stack, then don't push it into stack.
            if (tool.count === 0) {
                tool.count++;
                _toolStack.splice(indexToPush, 0, tool);
            }


            tool.activate(toolName, viewerApi);
            if (interceptor) {
                _toolStack.push(interceptor);
            }

            viewerApi.dispatchEvent(
                {
                    type: et.TOOL_CHANGE_EVENT,
                    toolName: toolName,
                    tool: tool,
                    active: true
                });
            return true;
        }
        logger.warn("activateTool not found: " + toolName);
        return false;
    };

    /**
     * The first tool found on the active stack with the given name is removed and its "deactivate" method
     * is called. Once deactivated the tool will no longer receive events via its handler methods.
     * Deactivation is not allowed while the controller is in a "locked" state (see the methods "setIsLocked"
     * and "getIsLocked").
     *
     * @param {string} toolName - The name of the tool to be deactivated.
     * @returns {boolean} True if deactivation was successful.
     */
    this.deactivateTool = function(toolName)
    {
        if( _lock )
            return false;

        for( var i = _toolStack.length;  --i >= 0;  )
        {
            if( _toolStack[i].activeName === toolName )
            {
                const tool = _tools[toolName];
                if (tool.count === 1)
                    _toolStack.splice(i, 1);

                tool.count--;

                tool.deactivate(toolName);

                viewerApi.dispatchEvent(
                    {
                        type: et.TOOL_CHANGE_EVENT,
                        toolName: toolName,
                        tool: tool,
                        active: false
                    });
                return true;
            }
        }
        logger.warn("deactivateTool not found: " + toolName);
        return false;
    };

    /**
     * Obtain a list of all the currently registered tool names.
     *
     * @returns {Array} List of all registered tool names.
     */
    this.getToolNames = function()
    {
        return Object.keys(_tools);
    };

    /**
     * Set the tool which will be requested to handle events if no other active tool handles them.
     *
     * @param {object} tool - The tool to be registered as the default.
     */
    this.setDefaultTool = function(tool)
    {
        var current = this.getDefaultTool();
        if( tool && tool !== current )
        {
            this.__registerToolByName(tool, "default");
            if( current )
                current.deactivate("default");
            tool.activate("default");
            return true;
        }
        return false;
    };

    /**
     * Get the tool which handle events if no other active tool handles them.
     *
     * @returns {object} The tool to be registered as the default.
     */
    this.getDefaultTool = function()
    {
        return _tools["default"];
    };

    this.setDefaultTool(defaultHandler);

    /**
     * Set the controller into a locked or unlocked state. While locked, tool activation and deactivation
     * is not allowed. Locking the controller is sometimes necessary to force an interaction to remain
     * active until it is fully completed.
     *
     * @param {boolean} state - The state of the controller lock.
     * @returns {boolean} The previous state of the lock (this may be used to restore the lock
     * to it's previous state).
     */
    this.setIsLocked = function(state)
    {
        var prev = _lock;
        _lock = !!state;
        return prev;
    };

    /**
     * Get the current state of the controller lock.
     *
     * @returns {boolean} The state of the lock.
     */
    this.getIsLocked = function()
    {
        return _lock;
    };

    this.__checkCursor = function()
    {
        var cursor = null;
        for( var n = _toolStack.length;  --n >= 0;  )
        {
            var tool = _toolStack[n];
            if( tool.getCursor )
            {
                cursor = tool.getCursor();
                if( cursor )
                    break;
            }
        }
        if( !cursor )
            cursor = "auto";

        if( _currentCursor != cursor )
        {
            viewerApi.canvas.style.cursor = cursor;
            _currentCursor = cursor;
        }
    };

    this.update = function(highResTimestamp)
    {
        this.__checkCursor();

        var refresh = false;

        if( utilities && utilities.update() )
            refresh = true;

        for( var n = _toolStack.length;  --n >= 0;  )
        {
            var tool = _toolStack[n];
            if( tool.update && tool.update(highResTimestamp) )
                refresh = true;
        }
        if( viewerApi.navigation.getCamera().dirty )
        {
            viewerApi.navigation.updateCamera();
            refresh = true;
            this.cameraUpdated = true;
        } else {
            this.cameraUpdated = false;
        }

        //Delay reporting stationary
        if( refresh )
        {
            viewerApi.navigation.updateCamera();
            this.moveDelay = Date.now() + 150;   // Milliseconds
        }
        else if( this.moveDelay !== 0 )
        {
            var delta = this.moveDelay - Date.now();
            if( delta > 0 )
                refresh = true;
            else
                this.moveDelay = 0;
        }
        return refresh;
    };


    // ------------------------
    // Event handler callbacks:
    // These can use "this".

    this.__clientToCanvasCoords = function (event, normalized, screen)
    {
        var rect = viewerImpl.getCanvasBoundingClientRect();
        var width  = rect.width;
        var height = rect.height;

        // Canvas coordinates: relative to the canvas element.
        // 0 = top left, +ve right and down.
        //
        var canvasX = event.clientX - rect.left;
        var canvasY = event.clientY - rect.top;
        event.canvasX = canvasX;
        event.canvasY = canvasY;

        // Normalized coordinates: [-1, +1].
        // 0 = center, +ve = right and up.
        //
        event.normalizedX = (canvasX / width) * 2.0 - 1.0;
        event.normalizedY = ((height - canvasY) / height) * 2.0 - 1.0;

        // Vector: [0, 1].
        // 0 = top left, +ve right and down.
        //
        if (normalized)
            normalized.set(canvasX / width, canvasY / height, 0.0);

        if (screen)
            screen.set(canvasX, canvasY);
    };

    this.__invokeStack = function( method, arg1, arg2 )
    {
        for( var n = _toolStack.length;  --n >= 0;  )
        {
            var tool = _toolStack[n];

            if(tool && tool[method] && tool[method](arg1, arg2))
            {
                //logger.log(method + " consumed by " + tool.getName() + " = " + arg1.type);
                return true;
            }
        }
        var last = this.getDefaultTool();
        if( last[method] && last[method](arg1, arg2) )
        {
            //logger.log(method + " consumed by " + last.getName() + " = " + arg1.type);
            return true;
        }
        return false;
    };

    this.distributeEvent = function(methodName, arg1, arg2)
    {
        return this.__invokeStack(methodName, arg1, arg2);
    };

    this.handleResize = function()
    {
        viewerApi.navigation.setScreenViewport( viewerApi.container.getBoundingClientRect() );

        // Call handleResize on all tools in case they need it:
        for( var n = _toolStack.length;  --n >= 0;  )
        {
            var tool = _toolStack[n];

            if( tool.handleResize )
                tool.handleResize();
        }
    };

    this.handleSingleClick = function( event )
    {
        var button = this.applyButtonMappings( event );
        this.lastClickX = event.clientX;
        this.lastClickY = event.clientY;

        if( this.__invokeStack("handleSingleClick", event, button) )
        {
            this.__onEventHandled(event);
        }
    };

    this.handleDoubleClick = function( event )
    {
        var button = this.applyButtonMappings( event );

        if( this.__invokeStack("handleDoubleClick", event, button) )
        {
            this.__onEventHandled(event);
        }
    };

    this.handleSingleTap = function( event )
    {
        this.lastClickX = event.canvasX;
        this.lastClickY = event.canvasY;

        if( this.__invokeStack("handleSingleTap", event) )
        {
            this.__onEventHandled(event);
        }
    };

    this.handleDoubleTap = function( event )
    {
        this.lastClickX = event.canvasX;
        this.lastClickY = event.canvasY;

        if( this.__invokeStack("handleDoubleTap", event) )
        {
            this.__onEventHandled(event);
        }
    };

    this.handleWheelInput = function(delta, event)
    {
        if( this.__invokeStack("handleWheelInput", delta, event) )
        {
            this.__onEventHandled(event);
        }
    };

    this.applyButtonMappings = function( event )
    {
        var button = event.button;

        // Check for Firefox spoof: Control+LMB converted to RMB.
        // The "buttons" property in Firefox will include 1 for LMB and 2 for RMB.
        if( "buttons" in event )
        {
            // This method sometimes gets called more than once with
            // the same event:
            if( event.firefoxSpoof )
            {
                button = kMouseLeft;
            }
            // For button down the 1 bit will be on indicating LMB.
            // For button up it's off so check the flag to see if we
            // switched the down event.
            else if( _firefoxLMBfix && !(event.buttons & 1) ) // Button up?
            {
                event.firefoxSpoof = true;
                _firefoxLMBfix = false;
                button = kMouseLeft;
            }
            else if( (button === kMouseRight) && (event.buttons & 1) )
            {
                button = kMouseLeft;    // Convert back to reality.
                event.firefoxSpoof = _firefoxLMBfix = true;
            }
        }
        if( viewerApi.navigation.getUseLeftHandedInput() )
        {
            button = (button === kMouseLeft)  ? kMouseRight :
                     (button === kMouseRight) ? kMouseLeft  : button;
        }
        return button;
    };

    this.applyKeyMappings = function( event )
    {
        switch( event.keyCode )
        {
            case KeyCode.EQUALSMOZ:   return KeyCode.EQUALS;

            case KeyCode.DASHMOZNEW:
            case KeyCode.DASHMOZ:     return KeyCode.DASH;
        }
        return event.keyCode;
    };

    this.handleKeyDown = function( event )
    {
        let keyCode;

        if(this.keyMapCmd && isMac && (event.code == "MetaLeft" || event.code == "MetaRight")){
            this.handleCmdKeyEvent(event, 'keydown');
            return;
        }
        else {
            keyCode = this.applyKeyMappings( event );
        }

        if( keyCode && this.__invokeStack("handleKeyDown", event, keyCode))
        {
            this.__onEventHandled(event);
        }
    };

    this.handleKeyUp = function( event )
    {
        let keyCode;

        if(this.keyMapCmd && isMac && (event.code == "MetaLeft" || event.code == "MetaRight")){
            this.handleCmdKeyEvent(event, 'keyup');
            return;
        }
        else {
            keyCode = this.applyKeyMappings( event );
        }

        if( keyCode && this.__invokeStack("handleKeyUp", event, keyCode))
        {
            this.__onEventHandled(event);
        }
    };

    /**
     * Catches a CMD event and generate a Control one instead.
     * @param {object} cmdEvent - Event generated by CMD key
     * @param {string} eventType - Event type
     */
    this.handleCmdKeyEvent = function(cmdEvent, eventType) {
        this.__onEventHandled(cmdEvent);

        var ev = new KeyboardEvent(eventType, {
            "key": "Control", //optional and defaulting to "", of type DOMString, that sets the value of KeyboardEvent.key.
            "code": cmdEvent.code == "MetaLeft" ? "ControlLeft" : "ControlRight", //optional and defaulting to "", of type DOMString, that sets the value of KeyboardEvent.codevent.
            "location": cmdEvent.location, //optional and defaulting to 0, of type unsigned long, that sets the value of KeyboardEvent.location.
            "ctrlKey": true, //optional and defaulting to false, of type Boolean, that sets the value of KeyboardEvent.ctrlKey.
            "metaKey": false, //optional and defaulting to false, of type Boolean, that sets the value of KeyboardEvent.metaKey.
            "repeat": cmdEvent.repeat, //optional and defaulting to false, of type Boolean, that sets the value of KeyboardEvent.repeat.
            "isComposing": cmdEvent.isComposing, //optional and defaulting to false, of type Boolean, that sets the value of KeyboardEvent.isComposing.
            "charCode": 0, //optional and defaulting to 0, of type unsigned long, that sets the value of the deprecated KeyboardEvent.charCodevent.
            "keyCode": 17, //optional and defaulting to 0, of type unsigned long, that sets the value of the deprecated KeyboardEvent.keyCode.
            "which": 17, //optional and defaulting to 0, of type unsigned long, that sets the value of the deprecated KeyboardEvent.which.
        });

        window.dispatchEvent(ev);
    };

    this.handleButtonDown = function( event, button )
    {
        if( this.__invokeStack("handleButtonDown", event, button) )
        {
            this.__onEventHandled(event);
        }
    };

    this.handleButtonUp = function( event, button )
    {
        if( this.__invokeStack("handleButtonUp", event, button) )
        {
            this.__onEventHandled(event);
        }
    };

    this.handleMouseMove = function( event )
    {
        if( this.__invokeStack("handleMouseMove", event) )
        {
            this.__onEventHandled(event);
        }
    };

    this.handleBlur = function( event )
    {
        if( this.__invokeStack("handleBlur", event) )
        {
            this.__onEventHandled(event);
        }
    };

    // ====================================================
    // Event handlers: (only use "_this" in these methods):

    this.keydown = function( event )
    {
        if (ToolController._lastTouchedElement && !_this.domElement.contains(ToolController._lastTouchedElement)) {
            return;
        }
        var _document = _this.getDocument();
        if (_document.activeElement instanceof HTMLInputElement ||
            _document.activeElement instanceof HTMLTextAreaElement ||
            _document.activeElement instanceof HTMLSelectElement) {
            return;
        }

        // Support for HTML5 editable divs
        if (_document.activeElement) {
            var divIsEditable = _document.activeElement.getAttribute('contenteditable');
            if (divIsEditable ===  'true' || divIsEditable === '') {
                // TODO: Proper handle of value 'inherit'
                return;
            }
        }

        _this.handleKeyDown(event);
    };

    this.keyup = function( event )
    {
        _this.handleKeyUp(event);
    };

    /**
     * @param {object} button - button
     * @param {object} event - event
     * @returns {boolean} - should check for double-click event?
     */
    function shouldCheckDoubleClick(button, event) {
        return (viewerApi.navigation.getUseLeftHandedInput() && button === 0) || (isFirefox && button === 1) ||
            (isMac && !isSafari && button === 0 && event.ctrlKey);
    }

    this.mousedown = function( event )
    {
        var _document = _this.getDocument();
        // Don't do blur in full screen (IE issue)
        if (!(isIE11 && inFullscreen(_document))) {
            _document.activeElement && _document.activeElement.blur && _document.activeElement.blur();
        }

        _this.__clientToCanvasCoords(event);

        var buttonDown = _this.applyButtonMappings( event );
        _this.handleButtonDown( event, buttonDown );

        _downX = event.canvasX;
        _downY = event.canvasY;

        if( shouldCheckDoubleClick(buttonDown, event) )
        {
            var cmdc = _checkMouseDoubleClick;

            var delayOK = ((cmdc.time !== undefined) &&
                ((event.timeStamp - cmdc.time) < kDoubleClickDelayThreshold));

            var positionOK = ((cmdc.x !== undefined && cmdc.y !== undefined) &&
                (Math.abs(cmdc.x - event.canvasX) <= kClickThreshold) &&
                (Math.abs(cmdc.y - event.canvasY) <= kClickThreshold));

            if (!delayOK || !positionOK || (cmdc.clickCount && 2 <= cmdc.clickCount)) {
                cmdc.clickCount = 0;
            }

            if (!cmdc.clickCount) {
                cmdc.clickCount = 1;
                cmdc.x = event.canvasX;
                cmdc.y = event.canvasY;
                cmdc.time = event.timeStamp;

            } else if (cmdc.clickCount === 1) {
                cmdc.clickCount = 2;
            }
        }

        /**
         * @param {object} event - Event to handle
         */
        function handleUp(event)
        {
            var buttonUp = _this.applyButtonMappings( event );
            if( buttonUp === buttonDown )
            {
                _this.removeDocumentEventListener( 'mouseup', handleUp );
                _this.mouseup(event);
            }
        }

        _this.addDocumentEventListener( 'mouseup', handleUp, false );

        _this.registerWindowMouseMove();
    };

    this.mousemove = function( event )
    {
        _this.__clientToCanvasCoords(event);

        var deltaX = _downX - event.canvasX;
        var deltaY = _downY - event.canvasY;
        if( Math.abs(deltaX) > kClickThreshold || Math.abs(deltaY) > kClickThreshold )
        {
            _downX = -1;
            _downY = -1;
        }
        _this.handleMouseMove(event);
    };

    this.mouseup = function( event )
    {
        _this.__clientToCanvasCoords(event);

        var buttonUp = _this.applyButtonMappings( event );
        _this.handleButtonUp( event, buttonUp );

        var deltaX = _downX - event.canvasX;
        var deltaY = _downY - event.canvasY;

        _downX = -1;
        _downY = -1;

        if( Math.abs(deltaX) <= kClickThreshold && Math.abs(deltaY) <= kClickThreshold )
            _this.handleSingleClick( event );

        if( shouldCheckDoubleClick(buttonUp, event) )
        {
            var cmdc = _checkMouseDoubleClick;
            if (cmdc.clickCount === 2) {
                _this.handleDoubleClick(event);

                cmdc.clickCount = 0;
                cmdc.x = undefined;
                cmdc.y = undefined;
                cmdc.time = undefined;
            }
        }

        _this.unregisterWindowMouseMove();
    };

    this.doubleclick = function( event )
    {
         _this.__clientToCanvasCoords(event);

        _downX = event.canvasX;
        _downY = event.canvasY;

        _this.handleDoubleClick( event );
    };

    this.mousewheel = function( event )
    {
        if (!_this.scrollInputEnabled) {
            return;
        }

        // A mousewheel event also contains coordinates of the mouse position, so we make them available as canvas coords too.
       _this.__clientToCanvasCoords(event);

        var delta = 0;

        if ( event.wheelDelta ) { // WebKit / Opera / Explorer 9
            delta = event.wheelDelta / 40;
        }
        else if ( event.detail ) { // Firefox
            delta = - event.detail;
        }
        else if (event.deltaY) { // Firefox / Explorer + event target is SVG.
            var factor = isFirefox ? 1 : 40;
            delta = - event.deltaY / factor;
        }

        _this.handleWheelInput( delta, event );
    };

    this.blur = function(event)
    {
        _this.handleBlur(event);
    };

    // ??? this.domElement.addEventListener( 'contextmenu', function ( event ) { event.preventDefault(); }, false );

    this.mouseover = function(e)
    {
        ToolController._lastTouchedElement = e.target;
        // ??? if (ToolController._lastTouchedElement != viewerImpl.canvas) _this.autoMove(-1, false)
    };

    // to maintain drag continuity outside the canvas element
    // move mousemove/over listeners from canvas to window
    this.registerWindowMouseMove = function() {
        _this.addWindowEventListener( 'mousemove', _this.mousemove );
        _this.addWindowEventListener( 'mouseover', _this.mouseover );
        _this.domElement.removeEventListener( 'mousemove', _this.mousemove );
        _this.domElement.removeEventListener( 'mouseover', _this.mouseover );
    };

    this.unregisterWindowMouseMove = function() {
        _this.removeWindowEventListener( 'mousemove', _this.mousemove );
        _this.removeWindowEventListener( 'mouseover', _this.mouseover );
        _this.domElement.addEventListener( 'mousemove', _this.mousemove );
        _this.domElement.addEventListener( 'mouseover', _this.mouseover );
    };

    this.enableMouseButtons = function(state)
    {
        if( state && !_mouseEnabled )
        {
            this.domElement.addEventListener( 'mousedown', this.mousedown );
            this.domElement.addEventListener( 'dblclick',  this.doubleclick );
            this.domElement.addEventListener( 'mousemove', this.mousemove );
            this.domElement.addEventListener( 'mouseover', this.mouseover );
        }
        else if( !state && _mouseEnabled )
        {
            this.domElement.removeEventListener( 'mousedown', this.mousedown );
            this.domElement.removeEventListener( 'dblclick',  this.doubleclick );
            this.domElement.removeEventListener( 'mousemove', this.mousemove );
            this.domElement.removeEventListener( 'mouseover', this.mouseover );
        }
        var returnValue = _mouseEnabled;
        _mouseEnabled = state;

        return returnValue;
    };

    // If we want to continue listening to mouse movements outside of the window
    // we need to tie our event listener to the window

    this.domElement.addEventListener( 'mousewheel',     this.mousewheel, false );
    this.domElement.addEventListener( 'DOMMouseScroll', this.mousewheel, false ); // firefox

    //** this.domElement.addEventListener( 'touchstart', function( event ) { _this.touchstart( event )}, false );
    //** this.domElement.addEventListener( 'touchmove', function( event ) { _this.touchmove( event )}, false );

    _this.addWindowEventListener( 'keydown', this.keydown, false );
    _this.addWindowEventListener( 'keyup',   this.keyup,   false );
    _this.addWindowEventListener( 'blur', this.blur, false );

    this.uninitialize = function () {
        // remove them all just to be sure, doesn't hurt
        this.domElement.removeEventListener('mousemove', this.mousemove);
        this.domElement.removeEventListener('mouseover', this.mouseover);
        this.removeWindowEventListener( 'mousemove', this.mousemove );
        this.removeWindowEventListener('mouseover', this.mouseover);

        this.removeWindowEventListener('keydown', this.keydown);
        this.removeWindowEventListener('keyup', this.keyup);
        this.removeWindowEventListener('blur', this.blur);

        this.domElement = null;
        this.selector = null;
        this.autocam = null;

        _lock = false; // Critical to unlock before deactivating all tools, so we'll be able actually deactivate them.

        // Deactivate all active tools
        while( _toolStack.length > 0 )
            this.deactivateTool(_toolStack[_toolStack.length - 1].activeName);
        _tools = null;
        _toolStack = null;
        _this = null;
        utilities = null;
        viewerApi = null;
        viewerImpl = null;
        ToolController._lastTouchedElement = null;
    };

    // Compatibility methods. TODO: eliminate these
    this.set2DMode = function() {};
    this.setAutocam = function() {};
    this.syncCamera = function() {};

    // TODO: implement this in navapi - then set autocam home from navapi values
    this.recordHomeView = function()
    {
        var camera = viewerApi.navigation.getCamera();
        autocam.sync( camera );
        autocam.setHomeViewFrom( camera );
    };

    /**
     * Whether mouse scroll wheel (and/or two-finger vertical swipe) will trigger a camera zoom operation.
     *
     * @param {boolean} isEnabled
     */
    this.setMouseWheelInputEnabled = function(isEnabled) {
        this.scrollInputEnabled = isEnabled;
    };

    /**
     * Set the modality map for each tool. This function will clear any existing modality map.
     * The map object consists of a key which represents the tool name and a value which is an object that represents which tools to enable and disable.
     * To get the tool names @see {@link Autodesk.Viewing.ToolController#getToolNames}
     *
     * @example
     * // When enabling the measure tool the explode, bimwalk and section tools will be disabled.
     * // When enabling the section tool the pan tool will be disabled.
     * toolController.setModalityMap({
     *     measure: { explode: false, bimwalk: false, section: false },
     *     section: { pan: false }
     * });
     * @param {object} map - Object describing each tool's modality with other tools.
     */
    this.setModalityMap = function (map) {
        // Clear the existing modality map
        _toolModality = {};
        for (let name in map) {
            this.setToolModality(name, map[name]);
        }
    };

    /**
     * Get the modality map.
     *
     * @returns {object} - returns a copy of the tool modality.
     */
    this.getModalityMap = function () {
        return Object.assign({}, _toolModality);
    };

    /**
     * Get a specific tool's modality map.
     *
     * @param {string} name - tool name
     * @returns {object} - an object describing the tool's modality map.
     */
    this.getToolModality = function (name) {
        return _toolModality[name];
    };

    /**
     *
     * @param {string} name - Tool name that is associated with the modality map.
     * @param {object} map - Object containing the name of the tool as the key and a boolean that describes if the tool can be enabled or disabled.
     */
    this.setToolModality = function (name, map) {
        if (!name) {
            logger.warn('Cannot add tool modality. Missing tool name.');
            return;
        }

        if (!map) {
            logger.warn('Cannot add tool modality. Missing tool map.');
            return;
        }

        _toolModality[name] = map;
    };

    // Called if an input event was handled by a tool. In this case, we stop any further event processing (unless disabled by the client).
    this.__onEventHandled = function(event) {
        if (!this.propagateInputEventTypes.includes(event.type)) {
            event.preventDefault();
            event.stopPropagation();
        }
    };
}

// Private static variable to store which viewer basically should process keyboard events
Object.defineProperty(ToolController, '_lastTouchedElement', { value: null, writable: true });

GlobalManagerMixin.call(ToolController.prototype);
