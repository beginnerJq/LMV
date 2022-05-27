
export function HotGestureTool( viewerApi )
{
    var _names = ["hottouch"];

    var _modifierState = { SHIFT: 0, ALT: 0, CONTROL: 0 };
    var _setMode = null;
    var _saveMode = null;
    var _fovActive = false;
    var _rollActive = false;
    var _startEvent = null;

    var _keys = {
              SHIFT: 16,
            CONTROL: 17,
                ALT: 18,
             ESCAPE: 27,
           LCOMMAND: 91,
           RCOMMAND: 93,
         COMMANDMOZ: 224
    };

    var ORBIT   = "orbit";
    var ROLL    = "worldup";
    var FOV     = "fov";

    this.active = false;

    this.getNames = function()
    {
        return _names;
    };

    this.getName = function()
    {
        return _names[0];
    };

    this.activate = function(name)
    {
        this.active = true;
    };

    this.deactivate = function(name)
    {
        this.active = false;
    };

    this.isActive = function() {
        return this.active;
    };
    
    this.__checkStart = function()
    {
        // Since the start event triggers the tool change we re-send the
        // start event so that the new tool can trigger from it.
        if( _startEvent )
        {
            this.controller.distributeEvent("handleGesture", _startEvent);
            _startEvent = null;
        }
    };

    this.update = function()
    {
        if( this.controller.getIsLocked() )
            return false;

        var got = viewerApi.getActiveNavigationTool();
        var wantRoll = (_fovActive === false && _rollActive === true);
        var wantFov  = (_fovActive === true && _rollActive === false);

        if( wantRoll || wantFov )
        {
            var want = wantRoll ? ROLL : FOV;

            if( got === want )
                return false;

            if( got === _setMode )  // We set it we can change it
            {
                viewerApi.setActiveNavigationTool(want);
                _setMode = want;
                this.__checkStart();
                return false;
            }
            _saveMode = got;
            viewerApi.setActiveNavigationTool(want);
            _setMode = want;
            this.__checkStart();
        }
        else if( _setMode )
        {
            viewerApi.setActiveNavigationTool(_saveMode);
            _setMode = null;
            _saveMode = null;
        }
        return false;
    };

    this.resetKeys = function()
    {
        // Clear modifier states:
        _modifierState.SHIFT = 0;
        _modifierState.CONTROL = 0;
        _modifierState.ALT = 0;
    };

    this.updateModifierState = function( event )
    {
        _modifierState.CONTROL = event.ctrlKey  ? 1 : 0;
        _modifierState.SHIFT   = event.shiftKey ? 1 : 0;
        _modifierState.ALT     = event.altKey   ? 1 : 0;
    };

    this.handleGesture = function( event )
    {
        if( event === _startEvent )
            return false;

        switch( event.type )
        {
            case "drag3start":
                if (viewerApi.navigation.isActionEnabled('fov')) {
                    _startEvent = event;
                    _fovActive = true;
                }
                break;

            case "drag3move":
                break;

            case "drag3end":
                _fovActive = false;
                break;

            case "rotatestart":
                if (viewerApi.navigation.isActionEnabled('roll')) {
                    _startEvent = event;
                    _rollActive = true;
                }
                break;

            case "rotatemove":
                break;

            case "rotateend":
                _rollActive = false;
                break;
        }
        return false
    };

    this.handleKeyDown = function( event, keyCode )
    {
        this.updateModifierState(event);

        switch( keyCode )
        {
            // Do we need to consume these events?
            case _keys.SHIFT:   _modifierState.SHIFT = 1;   break;
            case _keys.CONTROL: _modifierState.CONTROL = 1; break;
            case _keys.ALT:     _modifierState.ALT = 1;     break;
        }
        return false;
    };

    this.handleKeyUp = function( event, keyCode )
    {
        this.updateModifierState(event);

        switch( keyCode )
        {
            // Do we need to consume these events?
            case _keys.SHIFT:   _modifierState.SHIFT = 0;   break;
            case _keys.CONTROL: _modifierState.CONTROL = 0; break;
            case _keys.ALT:     _modifierState.ALT = 0;     break;
        }
        return false;
    };

    this.handleButtonDown = function( event, button )
    {
        this.updateModifierState(event);
        return false;
    };

    this.handleButtonUp = function( event, button )
    {
        this.updateModifierState(event);
        return false;
    };

    this.handleMouseMove = function( event )
    {
        this.updateModifierState(event);
        return false;
    };

    this.handleBlur = function(event)
    {
        // Reset things when we lose focus...
        this.resetKeys();
        return false;
    };
}
