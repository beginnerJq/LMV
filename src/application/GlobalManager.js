const av = Autodesk.Viewing;

/**
 * Class that provides the window and document for each viewer instance.
 *
 * @private
 */
class GlobalManager {

  constructor() {
    this._window = { inner: null, registeredEventListeners: new Map() };
    this._document = { inner: null, registeredEventListeners: new Map() };
  
    // initialize
    this._window.inner = av.getGlobal(); // start of with global window
    this._document.inner = this._window.inner.document;
  
    // Event listener wrappers
    this.addWindowEventListener = addEventListener.bind(this._window);
    this.removeWindowEventListener = removeEventListener.bind(this._window);
    this.addDocumentEventListener = addEventListener.bind(this._document);
    this.removeDocumentEventListener = removeEventListener.bind(this._document);
  }

  /**
   * Get the current window
   */
  getWindow() {
    return this._window.inner;
  }

  /**
   * Get the current document
   */
  getDocument() {
    return this._document.inner;
  }

  /** 
   * Set the new window
   * 
   * @param {object} - new window
   */
  setWindow(obj) {
    if (!obj || obj === this._window.inner) {
      return;
    }
  
    // Re-register event listeners in the new global context
    for (let [type, listeners] of this._window.registeredEventListeners.entries()) {
      for (let [listener, options] of listeners.entries()) {
        obj.addEventListener(type, listener, ...options);
        this._window.inner.removeEventListener(type, listener, ...options);
      }
    }
    for (let [type, listeners] of this._document.registeredEventListeners.entries()) {
      for (let [listener, options] of listeners.entries()) {
        obj.document.addEventListener(type, listener, ...options);
        this._document.inner.removeEventListener(type, listener, ...options);
      }
    }
  
    this._window.inner = obj;
    this._document.inner = obj.document;
  }

}

/**
 * Returns if a window was created using window.open()
 * @param {*} cWindow 
 * @private
 */
function isChild(cWindow) {
  return !!cWindow.opener;
}

/**
 * Helper method that saves the registered event handlers
 * and calls the same method on the inner object
 * @private
 */
function addEventListener(type, listener, ...options) {
  if (!isChild(this.inner)) {
    if (this.registeredEventListeners.has(type)) {
      this.registeredEventListeners.get(type).set(listener, options);
    } else {
      this.registeredEventListeners.set(type, new Map([[listener, options]]));
    }
  }
  this.inner.addEventListener(type, listener, ...options);
}

/**
 * Helper method that removes the registered event handlers
 * and calls the same method on the inner object
 * @private
 */
function removeEventListener(type, listener, ...options) {
  if (!isChild(this.inner)) {
    if (this.registeredEventListeners.has(type)) {
      if (this.registeredEventListeners.get(type).has(listener)) {
        this.registeredEventListeners.get(type).delete(listener);
      }
    }
  }
  this.inner.removeEventListener(type, listener, ...options);
}

export { GlobalManager };
