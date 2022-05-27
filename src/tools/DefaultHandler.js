import * as THREE from "three";
import { isMobileDevice } from "../compat";

//
// This object handles the default click behaviour, some of which is controlled
// via the "setClickBehavior" configuration.
//
export function DefaultHandler( viewerImpl, navapi, utilities )
{
    this.clickConfig = null;

    this.getNames = function()
    {
        return [ "default" ];
    };

    this.getName = function()
    {
        return this.getNames()[0];
    };

    this.setClickBehavior = function(config)
    {
        this.clickConfig = config;
    };

    this.getClickBehavior = function()
    {
        return this.clickConfig;
    };

    this.activate = function(name) {};
    this.deactivate = function(name) {};

    this.handleAction = function(actionArray, rayData)
    {
        for (var i=0; i < actionArray.length; ++i) {
            switch(actionArray[i]) {
            case "selectOnly":
                if (viewerImpl.selector) {
                    if (rayData) {
                        viewerImpl.selector.setSelection([rayData.dbId], rayData.model);
                    }
                }
                break;
            case "deselectAll":
                if (viewerImpl.selector) {
                   viewerImpl.selector.setSelection([]);
                }
                break;
            case "selectToggle":
                if (viewerImpl.selector) {
                    if (rayData) {
                        viewerImpl.selector.toggleSelection(rayData.dbId, rayData.model);
                    }
                }
                break;
            case "isolate":
                if (rayData) {
                    viewerImpl.isolate(rayData.dbId);
                }
                break;
            case "showAll":
                viewerImpl.showAll();
                break;
            case "setCOI":
                if (rayData && rayData.intersectPoint) {
                    utilities.setPivotPoint( rayData.intersectPoint, true, true );
                    utilities.pivotActive(true, true);
                }
                break;
            case "hide":
                if (rayData) {
                    viewerImpl.hide(rayData.dbId);
                }
                break;
			case "show":
                if (rayData) {
                    viewerImpl.show(rayData.dbId);
                }
                break;
			case "toggleVisibility":
                if (rayData) {
                    viewerImpl.toggleVisibility(rayData.dbId);
                }
                break;
            case "focus":
                // As a side effect of focus we also select
                if (viewerImpl.selector) {
                    if (rayData) {
                        viewerImpl.selector.setSelection([rayData.dbId], rayData.model);
                    } else {
                        viewerImpl.selector.setSelection([]);
                    }
                    utilities.fitToView();
                }
                break;
            }
        }
    };

    this.handleSingleClick = function( event, button )
    {

        // This condition handles iOS problem where on each input tap, 2 events dispatched
        // singleClick and singleTap. This condition skips any mouse related events for iOS devices
        if (isMobileDevice()) {
            return false;
        }

        var control = event.ctrlKey || event.metaKey;
        var shift   = event.shiftKey;
        var alt     = event.altKey;

        if (button === 0) {
            var vpVec = viewerImpl.clientToViewport(event.canvasX, event.canvasY);
            var result = viewerImpl.hitTestViewport(vpVec, false);
            var key = "click";

            if (control) key += "Ctrl";
            if (shift)   key += "Shift";
            if (alt)     key += "Alt";

            var objectKey = result ? "onObject" : "offObject";

            if (this.clickConfig && this.clickConfig[key] && this.clickConfig[key][objectKey]) {
                this.handleAction(this.clickConfig[key][objectKey], result);
                return true;
            }
        }
        else if (button === 1 && shift && !alt && !control) {
            var vpVec = viewerImpl.clientToViewport(event.canvasX, event.canvasY);
            var result = viewerImpl.hitTestViewport(vpVec, false);
            if( result && result.intersectPoint )
            {
                utilities.setPivotPoint( result.intersectPoint, true, true );
                utilities.pivotActive(true, true);
                return true;
            }
        }
        return false;
    };

    this.handleDoubleClick = function( event, button )
    {
        if( viewerImpl.selector && button === 0 )
        {
            var vpVec = viewerImpl.clientToViewport(event.canvasX, event.canvasY);
            var result = viewerImpl.hitTestViewport(vpVec, false);
            if (result) {
                viewerImpl.selector.setSelection([result.dbId], result.model);
            }
            else {
                viewerImpl.selector.clearSelection();
            }
            utilities.fitToView();
            return true;
        }
        if( button === 1 )
        {
            navapi.fitBounds(false, utilities.getBoundingBox(true));
            navapi.setPivotSetFlag(false);
            return true;
        }
        return false;
    };

    this.handleSingleTap = function( event )
    {
        event.clientX = event.pointers[0].clientX;
        event.clientY = event.pointers[0].clientY;
        viewerImpl.api.triggerSingleTapCallback(event);

        if( event.hasOwnProperty("pointers") && event.pointers.length === 2 )
        {
            navapi.setRequestHomeView(true);
            return true;
        }
        if( viewerImpl.selector && !viewerImpl.selector.selectionDisabled)
        {
            var vpVec = viewerImpl.clientToViewport(event.canvasX, event.canvasY);
            var result = viewerImpl.hitTestViewport(vpVec, false);

            if (result) {
                viewerImpl.selector.setSelection([result.dbId], result.model);
				viewerImpl.api.triggerSelectionChanged([result.dbId]);
            }
            else {
                viewerImpl.selector.clearSelection();
                viewerImpl.api.triggerSelectionChanged(null);
            }
            return true;
        }
        return false;
    };

    this.handleDoubleTap = function( event )
    {
        event.clientX = event.pointers[0].clientX;
        event.clientY = event.pointers[0].clientY;
        viewerImpl.api.triggerDoubleTapCallback(event);

        var result = this.handleSingleTap(event, 0);
        utilities.fitToView();
        return result;
    };

    this.handlePressHold = function( event )
    {
        if( event.type === "press" )
        {
            event.clientX = event.pointers[0].clientX;
            event.clientY = event.pointers[0].clientY;

            return viewerImpl.api.triggerContextMenu(event);
        }
        return false;
    }

    this.handleGesture = function( event )
    {
        if( event.type.includes("swipe") )
        {
            event.clientX = event.pointers[0].clientX;
            event.clientY = event.pointers[0].clientY;

            return viewerImpl.api.triggerSwipeCallback(event);
        }
        return false;
    }
}
