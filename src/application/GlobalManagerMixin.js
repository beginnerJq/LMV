import { GlobalManager } from './GlobalManager';
const globalManager = new GlobalManager();

function GlobalManagerMixin() {
	this.globalManager = globalManager;

	this.setGlobalManager = function(globalManager) {
		this.globalManager = globalManager;
		this.onSetGlobalManager(this.globalManager);
	};

	/**
	 * Classes can override this method to pass the instance to other objects
	 * See DockingPanel.js for an example
	 * @param {GlobalManager} globalManager GlobalManager instance
	 */
	// eslint-disable-next-line no-unused-vars
	this.onSetGlobalManager = function(globalManager) {
		// To be overridden
	};

	this.getWindow = function() {
		return this.globalManager.getWindow();
	};

	this.getDocument = function() {
		return this.globalManager.getDocument();
	};

	this.setWindow = function(newWindow) {
		return this.globalManager.setWindow(newWindow);
	};
	
	this.addWindowEventListener = function(type, listener, ...options) {
		this.globalManager.addWindowEventListener(type, listener, ...options);
	};
	
	this.removeWindowEventListener = function(type, listener, ...options) {
		this.globalManager.removeWindowEventListener(type, listener, ...options);
	};
	
	this.addDocumentEventListener = function(type, listener, ...options) {
		this.globalManager.addDocumentEventListener(type, listener, ...options);
	};
	
	this.removeDocumentEventListener = function(type, listener, ...options) {
		this.globalManager.removeDocumentEventListener(type, listener, ...options);
	};
	
}

Autodesk.Viewing.GlobalManager = GlobalManager;
Autodesk.Viewing.GlobalManagerMixin = GlobalManagerMixin;

export { GlobalManagerMixin };
