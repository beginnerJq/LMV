
export let EventDispatcher = function() {
};


EventDispatcher.prototype = {

    constructor: EventDispatcher,


    apply: function(object) {
        object.addEventListener = EventDispatcher.prototype.addEventListener;
        object.hasEventListener = EventDispatcher.prototype.hasEventListener;
        object.removeEventListener = EventDispatcher.prototype.removeEventListener;
        object.clearListeners = EventDispatcher.prototype.clearListeners;
        object.fireEvent = EventDispatcher.prototype.fireEvent;
        object.dispatchEvent = EventDispatcher.prototype.fireEvent;
        object.debugEvents = EventDispatcher.prototype.debugEvents;
    },

    /**
     * Adds an event listener.
     * 
     * @param {string} type - Event type identifier.
     * @param {function} listener - Callback function, receives an event parameter.
     * @param {object} [options] - Options object with characteristics about the event listener.
     * @param {boolean}[options.once] - When true, the event listener will only get invoked once. Defaults to false. 
     * @param {number} [options.priority] - Priority of the event-listener. The higher the priority - the sooner the listener will be called.
     */
    addEventListener : function(type, listener, options)
    {
        if (!type) return;
        if ( this.listeners === undefined ) this.listeners = {};

        if (typeof this.listeners[type] == "undefined"){
            this.listeners[type] = [];
        }

        var priority = (options && options.priority) || 0;
        var indexToPush = this.listeners[type].length;

        for (var i = this.listeners[type].length - 1; i >= 0; i--) {
            if (priority > this.listeners[type][i].priority) {
                indexToPush--;
            } else {
                break;
            }
        }

        this.listeners[type].splice(indexToPush, 0, {
            callbackFn: listener,
            once: options ? !!options.once : false,
            priority
        });
    },

    /**
     * Returns true if the specified listener already exists, false otherwise.
     * 
     * @param {string} type - Event type identifier.
     * @param {function} listener - Callback function to check if it will be already registered.
     */
    hasEventListener : function (type, listener) {

        if (!type) return false;
        if (this.listeners === undefined) return false;
        
        var typeListeners = this.listeners[type];
        if (!typeListeners || typeListeners.length === 0) 
            return false;

        for (var i=0, len=typeListeners.length; i<len; ++i) {
            if (typeListeners[i].callbackFn === listener)
                return true;
        }

        return false;
    },


    /**
     * Removes an event listener. 
     * If the event listener is not registered then nothing happens.
     * 
     * @param {string} type - Event type identifier.
     * @param {function} listener - Callback function to remove.
     */
    removeEventListener : function(type, listener)
    {
        if (!type) return;
        if ( this.listeners === undefined ) {
            this.listeners = {};
            return;
        }

        var typeListeners = this.listeners[type];
        if (!typeListeners) return;

        for (var i=0, len=typeListeners.length; i<len; ++i){
            if (typeListeners[i].callbackFn === listener){
                typeListeners.splice(i, 1);
                break;
            }
        }
    },

    /**
     * Remove all listeners registered for all event types.
     */
    clearListeners: function() 
    {
        this.listeners = undefined;
    },

    /**
     * Invokes all listeners registered to the event's type.
     * 
     * @param {(string | object)} event - Either a string type identifier or an object which 
     * will get passed along to each listener. The event object must contain a ``type`` attribute.
     */
    dispatchEvent : function(event)
    {
        if ( this.listeners === undefined ) {
            this.listeners = {};
            return;
        }

        if (typeof event == "string"){
            event = { type: event };
        }

        if (!event.target){
            try {
                event.target = this;
            // eslint-disable-next-line no-empty
            } catch (e) {}
        }

        if (!event.type){
            throw new Error("event type unknown.");
        }

        if (this._doDebug) {
            console.log('Event: ' + event.type);
        }

        if (!Array.isArray(this.listeners[event.type]))
            return;

        var typeListeners = this.listeners[event.type].slice(); // shallow copy
        var oneShots = [];

        for (var i=0, len=typeListeners.length; i<len; ++i){
            typeListeners[i].callbackFn.call(this, event);
            if (typeListeners[i].once) {
                oneShots.push(typeListeners[i].callbackFn);
            }
        }

        for (var j=0; j<oneShots.length; ++j) {
            this.removeEventListener(event.type, oneShots[j]);
        }
    },

    /**
     * 
     */
    debugEvents: function(enable) {
        this._doDebug = enable;
    }

};

// Legacy event routine needs to be deprecated.
EventDispatcher.prototype.fireEvent = EventDispatcher.prototype.dispatchEvent;

//TODO_TS: Have to export to the global namespace in order for class inheritance
//for non-modular objects to work.
if (typeof Autodesk !== "undefined") {
    Autodesk.Viewing.EventDispatcher = EventDispatcher;
}