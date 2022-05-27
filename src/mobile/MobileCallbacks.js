import { getGlobal } from '../compat';

const _window = getGlobal();
/**
 * Mobile callbacks wrapper, consolidating all calls to iOS and Android platforms
 */

export function MobileCallbacks () {
    this.ios = _window.webkit;
    this.android = _window.JSINTERFACE;

    this.iosSend = function (commandName, args){
        return _window.webkit.messageHandlers.callbackHandler.postMessage({'command': commandName, 'data': args});
    };

    this.androidSend = _window.JSINTERFACE;
}

var proto = MobileCallbacks.prototype;

proto.animationReady = function () {
    if (this.ios)
        this.iosSend('animationReady');
    else if (this.android)
        this.androidSend.animationReady();
};

proto.onSelectionChanged = function (dbId) {
    if (this.ios)
        this.iosSend('selectionChanged', dbId);
    else if (this.android)
        this.androidSend.onSelectionChanged(dbId);
};

proto.onLongTap = function (clientX, clientY) {
    if (this.ios)
        this.iosSend('onLongTap', [clientX, clientY]);
    else if (this.android)
        this.androidSend.onLongTap(clientX, clientY);
};

proto.onSingleTap = function (clientX, clientY) {
    if (this.ios)
        this.iosSend('onSingleTap', [clientX, clientY]);
    else if (this.android)
        this.androidSend.onSingleTap(clientX, clientY);
};

proto.onDoubleTap = function (clientX, clientY) {
    if (this.ios)
        this.iosSend('onDoubleTap', [clientX, clientY]);
    else if (this.android)
        this.androidSend.onDoubleTap(clientX, clientY);
};

proto.setRTCSession = function (id){
    if (this.ios)
        this.iosSend('setRTCSession', {'id':id});
    else if (this.android)
        this.androidSend.setRTCSessionID(id);
};

proto.putProperties = function (name, value){
    if (this.ios)
        this.iosSend('putProperties', {'name':name, 'value':value});
    else if (this.android)
        this.androidSend.putProperties(name, value);
};

proto.onPropertyRetrievedSuccess = function (){
    if (this.ios)
        this.iosSend('onPropertyRetrievedSuccess');
    else if (this.android)
        this.androidSend.onPropertyRetrievedSuccess();
};

proto.onPropertyRetrievedFailOrEmptyProperties = function (){
    if (this.ios)
        this.iosSend('onPropertyRetrievedFailOrEmptyProperties');
    else if (this.android)
        this.androidSend.onPropertyRetrievedFailOrEmptyProperties();
};

proto.resetAnimationStatus = function (){
    if (this.ios)
        this.iosSend('resetAnimationStatus');
    else if (this.android)
        this.androidSend.resetAnimationStatus();
};

proto.setPauseUI = function (){
    if (this.ios)
        this.iosSend('setPauseUI');
    else if (this.android)
        this.androidSend.setToPaused();
};

proto.getDeviceAvailableMemory = function () {
    // Returns a JSON in the format of:
    // {"platform": "Android", "device": "hammerhead", "model": "Nexus 5", "os": "6.0", "totalmem": 1945100288, "availbytes": 907812864}
    if (this.ios)
        return this.iosSend('getDeviceAvailableMemory');
    else if (this.android)
        return this.androidSend.getDeviceAvailableMemory();
};

proto.onDeviceMemoryInsufficient = function () {
    if (this.ios)
        return this.iosSend('onDeviceMemoryInsufficient');
    else if (this.android)
        return this.androidSend.onDeviceMemoryInsufficient();
};

proto.updateAnimationTime = function (time){
    if (this.ios)
        this.iosSend('updateAnimationTime', time);
    else if (this.android)
        this.androidSend.updateAnimationTime(time);
};


proto.setLoadingProgress = function (state, progress){
    if (this.ios)
        this.iosSend('setLoadingProgress', {'state':state, 'progress':progress});
    else if (this.android)
        this.androidSend.setLoadingProgress(state, progress);
};

proto.objectTreeCreated = function (){
    if (this.ios)
        this.iosSend('objectTreeCreated');
    else if (this.android)
        this.androidSend.objectTreeCreated();
};

proto.geometryLoaded = function (){
    if (this.ios)
        this.iosSend('geometryLoaded');
    else if (this.android)
        this.androidSend.geometryLoaded();
};

proto.putSheets = function (geomName, geomGuid){
    if (this.ios)
        this.iosSend('putSheets', [geomName, geomGuid]);
    else if (this.android)
        this.androidSend.putSheets(geomName, geomGuid);
};

proto.putAllSheets = function (sheets) {
    if (this.ios)
        this.iosSend('putAllSheets', sheets);
    else if (this.android)
        this.androidSend.putAllSheets(sheets);
};

proto.hideLoadingView = function (){
    if (this.android)
        this.androidSend.hideLoadingView();
};

proto.instanceTree = function (treeJson){
    if(this.ios)
        this.iosSend('instanceTree', treeJson);
    else if (this.android)
        this.androidSend.instanceTree(treeJson);
};

proto.loadSheetFailed = function (){
    if(this.ios)
        this.iosSend('loadSheetFailed');
    else if(this.android)
        this.androidSend.loadSheetFailed();
};

proto.sheetSelected = function (sheet) {
    if(this.ios)
        this.iosSend('sheetSelected', sheet);
    else if (this.android)
        this.androidSend.sheetSelected(sheet);
};

if (typeof window !== "undefined")
    _window.MobileCallbacks = MobileCallbacks; // Backwards compatibility. Consider removing.

