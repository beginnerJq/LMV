
import { AlertBox } from "./AlertBox";
import { logger } from "../logger/Logger";
import i18n from "i18next";
import { getWebGLHelpLink } from "../envinit";


var ErrorInfoData = {
    // UNKNOWN FAILURE
    1:   { 'img'             : "img-reload",                  // "icons/error_reload_in_viewer.png",
           'globalized-msg'  : "Viewer-UnknownFailure",
           'default-msg'     : "<title> Sorry </title>" +
                               "<message>We seem to have some technical difficulties and couldn't complete your request.</message>" +
                                    "<hint>Try loading the item again. </hint>" +
                                    "<hint>Please verify your Internet connection, and refresh the browser to see if that fixes the problem.</hint>"
    },

    // BAD DATA
    2:   { 'img'             : "img-unsupported",             // "icons/error_unsupported_file_type.png",
           'globalized-msg'  : "Viewer-BadData",
           'default-msg'     : "<title> Sorry </title>" +
                               "<message>The item you are trying to view was not processed completely. </message>" +
                                     "<hint>Try loading the item again.</hint>" +
                                     "<hint>Please upload the file again to see if that fixes the issue.</hint>"
    },

    // NETWORK ERROR
    3:  { 'img'             : "img-reload",                   // "icons/error_reload_in_viewer.png",
          'globalized-msg'  : "Viewer-NetworkError",
          'default-msg'     : "<title> Sorry </title>" +
                              "<message>We seem to have some technical difficulties and couldn't complete your request.</message>" +
                                    "<hint> Try loading the item again.</hint>" +
                                    "<hint> Please verify your Internet connection, and refresh the browser to see if that fixes the problem.</hint>"
    },

    // NETWORK_ACCESS_DENIED
    4: { 'img'             : "img-unlock",                    // "icons/error_unlock_upload.png",
         'globalized-msg'  : "Viewer-AccessDenied",
         'default-msg'     : "<title> No access </title>" +
                             "<message>Sorry. You don’t have the required privileges to access this item.</message>" +
                                    "<hint> Please contact the author</hint>"
    },

    // NETWORK_FILE_NOT_FOUND
    5: { 'img'             : "img-item-not-found",            //"icons/error_item_not_found.png",
         'globalized-msg'  : "Viewer-FileNotFound",
         'default-msg'     : "<title> Sorry </title>" +
                             "<message>We can’t display the item you are looking for. It may not have been processed yet. It may have been moved, deleted, or you may be using a corrupt file or unsupported file format.</message>" +
                                "<hint> Try loading the item again.</hint>" +
                                "<hint> Please upload the file again to see if that fixes the issue.</hint>" +
                                '<hint> <a href="http://help.autodesk.com/view/ADSK360/ENU/?guid=GUID-488804D0-B0B0-4413-8741-4F5EE0FACC4A" target="_blank">See a list of supported formats.</a></hint>'
    },

    // NETWORK_SERVER_ERROR
    6: { 'img'             : "img-reload",                    // "icons/error_reload_in_viewer.png",
         'globalized-msg'  : "Viewer-ServerError",
         'default-msg'     : "<title> Sorry </title>" +
                             "<message>We seem to have some technical difficulties and couldn't complete your request.</message>" +
                                    "<hint> Try loading the item again.</hint>" +
                                    "<hint> Please verify your Internet connection, and refresh the browser to see if that fixes the problem.</hint>"
    },


    // NETWORK_UNHANDLED_RESPONSE_CODE
    7: { 'img'             : "img-reload",                    // "icons/error_reload_in_viewer.png",
         'globalized-msg'  : "Viewer-UnhandledResponseCode",
         'default-msg'     : "<title> Network problem </title>" +
                             "<message>Sorry. We seem to have some technical difficulties and couldn't complete your request.</message>" +
                                "<hint> Try loading the item again.</hint>" +
                                "<hint> Please verify your Internet connection, and refresh the browser to see if that fixes the problem.</hint>"
    },

    // BROWSER_WEBGL_NOT_SUPPORTED
    8: { 'img'             : "img-unsupported",               // "icons/error_unsupported_file_type.png",
         'globalized-msg'  : "Viewer-WebGlNotSupported",
         'default-msg'     : "<title>Sorry</title><message>We can't show this item because this browser doesn't support WebGL.</message><hint>Try Google Chrome, Mozilla Firefox, or another browser that supports WebGL 3D graphics.</hint><hint>For more information, see the <a href=\"WEBGL_HELP\" target=\"_blank\">A360 browser reqirements.</a></hint>"
    },

    // BAD_DATA_NO_VIEWABLE_CONTENT
    9: { 'img'             : "img-item-not-found",            // "icons/error_item_not_found.png",
         'globalized-msg'  : "Viewer-NoViewable",
         'default-msg'     : "<title> No viewable content </title>" +
                             "<message>There’s nothing to display for this item. It may not have been processed or it may not have content we can display.</message>" +
                                    "<hint> Please contact the author.</hint>" +
                                    "<hint> Please upload the file again to see if that fixes the issue.</hint>"
    },

    // BROWSER_WEBGL_DISABLED
    10: { 'img'             : "img-unsupported",              // "icons/error_unsupported_file_type.png",
          'globalized-msg'  : "Viewer-WebGlDisabled",
          'default-msg'     : "<title>Sorry</title><message>We can't show this item because WebGL is disabled on this device.</message><hint> For more information see the <a href=\"WEBGL_HELP\" target=\"_blank\">A360 Help.</a></hint>"
    },

    // BAD_DATA_MODEL_IS_EMPTY
    11: { 'img'             : "img-item-not-found",            // "icons/error_item_not_found.png",
        'globalized-msg'   : "Viewer-ModeIsEmpty",
        'default-msg'      : "<title>Model is empty</title>" + "<message>Model is empty, there is no geometry for the viewer to show.</message>" +
                            "<hint> Please contact the author.</hint>" +
                            "<hint> Please upload the file again to see if that fixes the issue.</hint>"
    },

    // RTC_ERROR
    12: { 'img'             : "img-unsupported",              // "icons/error_unsupported_file_type.png",
          'globalized-msg'  : "Viewer-RTCError",
          'default-msg'     : "<title> Sorry </title>" +
                              "<message>We couldn’t connect to the Collaboration server.</message>" +
                              "<hint> Please verify your Internet connection, and refresh the browser to see if that fixes the problem.</hint>"
    },

    // UNSUPORTED_FILE_EXTENSION
    13: { 'img'             : "img-unsupported",              // "icons/error_unsupported_file_type.png",
          'globalized-msg'  : "Viewer-FileExtNotSupported",
          'default-msg'     : {
              "title"   : "Sorry",
              "message" : "The file extension loaded into the Viewer is not supported",
              "hints"   : [
                    "Try a different file"
              ]
          }
    }, 

    // VIEWER_INTERNAL_ERROR
    // 14: Why is this missing???

    // WEBGL_LOST_CONTEXT
    15: { 'img'             : "img-unsupported",              // "icons/error_unsupported_file_type.png",
          'globalized-msg'  : "Viewer-WebGlContextLost",
          'default-msg'     : {
            "title"   : "WebGL context lost",
            "message" : "Unable to recover from software mode.  Please restart your browser and reload the Viewer",
            "hints"   : [
                  "If you continue to encounter this issue when viewing this model, we recommend switching to a different browser."
            ]
        }
    },
};


export function ErrorHandler()
{
}

ErrorHandler.prototype.constructor = ErrorHandler;

ErrorHandler.reportError = function( container, errorCode, errorMsg, statusCode, statusText, errorType )
{
    ErrorHandler.currentError  = null;
    ErrorHandler.currentErrors = null;

    // If there is no errorCode, just return (otherwise an empty alert box is being shown)
    if (!errorCode)
        return;
        
    var errorLog = {
        category: "error",
        code: errorCode,
        message: errorMsg,
        httpStatusCode: statusCode,
        httpStatusText: statusText
    };
    logger.track(errorLog, true);

    ErrorHandler.currentError = [container, errorCode, errorMsg, errorType];

    var errorInfo = ErrorInfoData[errorCode];
    if (errorInfo)
    {
        var options = {
            "defaultValue" : ""
        };

        options.defaultValue = errorInfo['default-msg'];
        var imgClass = errorInfo["img"];
        var errorGlobalizedMsg = errorInfo['globalized-msg'];

        var error = this.parseErrorString( errorGlobalizedMsg, options );

        if (errorCode === Autodesk.Viewing.ErrorCodes.BROWSER_WEBGL_DISABLED ||
            errorCode === Autodesk.Viewing.ErrorCodes.BROWSER_WEBGL_NOT_SUPPORTED)
        {
            var helpUrl = getWebGLHelpLink() || "http://www.autodesk.com/a360-browsers";

            for (var i = 0; i < error.hints.length; i++) {
                var index = error.hints[i].indexOf('href="WEBGL_HELP"');
                if (index !== -1) {
                    error.hints[i] = error.hints[i].replace('href="WEBGL_HELP"', 'href="' + helpUrl + '"');
                }
            }
        }

        AlertBox.displayError( container, error.msg, error.header, imgClass, error.hints );
    }
    else
    {
        var imgClass = "img-unsupported"; // "icons/error_unsupported_file_type.png";

        var options = {
            "defaultValue"          : "",
            "interpolationPrefix"   : "{",
            "interpolationSuffix"   : "}"
        };

        this.parseArguments( errorMsg, options );
        var error = this.parseErrorString( errorCode, options );

        if (!error.header)
            error.header = (errorType === "warning") ? i18n.t( "header-warning" ) : "";
        AlertBox.displayError( container, error.msg, error.header, imgClass, error.hints, errorCode );
    }
};

ErrorHandler.reportErrors = function( container, errors )
{
    ErrorHandler.currentError  = null;
    ErrorHandler.currentErrors = null;

    if (!errors)
        return;

    ErrorHandler.currentErrors = [container, errors];

    var options = {
        "defaultValue"          : "",
        "interpolationPrefix"   : "{",
        "interpolationSuffix"   : "}"
    };

    var formattedErrors = [];
    for (var i=0; i<errors.length; i++) {
        if (!errors[i].code)
            continue;

        this.parseArguments( errors[i].message, options );

        var error = this.parseErrorString( errors[i].code, options );
        if (!error.header)
            error.header = (errors[0].type === "warning") ? i18n.t( "header-warning", {"defaultValue" : "Warning"} ) : "";

        formattedErrors.push( error );
    
        var errorLog = {
            category: "error",
            code: errors[i].code,
            message: errors[i].message
        };
        logger.track(errorLog, true);
    }

    if (!formattedErrors.length)
        return;

    // Default image.
    var imgClass = "img-unsupported"; // "icons/error_unsupported_file_type.png";

    AlertBox.displayErrors( container, imgClass, formattedErrors );
};

ErrorHandler.parseArguments = function( errorMsg, options )
{
    if (!errorMsg)
        return;

    // Add arguments
    if (typeof(errorMsg) === "string" ) {
        options.defaultValue = errorMsg;
    }
    else {
        // If there is an array, then there are arguments in the string.
        // Add them to the options (arguments are named: 0, 1, 2, ...
        options.defaultValue = errorMsg[0];
        for (var i=1; i<errorMsg.length; i++) {
            var arg = i-1;
            var argName = arg.toString();
            options[argName] = errorMsg[i];
        }
    }
};

ErrorHandler.parseErrorString = function( errorCode, options )
{
    var error = {
        "msg"     : null,
        "msgList" : null,
        "header"  : null,
        "hints"   : null
    };

    if (!errorCode)
        return error;

    // Support for "new" format that doesn't embed HTML tags into the localization strings.
    if (typeof options.defaultValue === 'object') {
        var obj = options.defaultValue;
        error.header = obj.title;
        error.msg = obj.message;
        error.hints = obj.hints.concat();
        return error;
    }

    // Translate the message.
    var msg = i18n.t( errorCode, options );
    if (!msg)
        return error;

    // Split into header, message and hints. The messages may have the following format
    //   <title>header</title>text of the error message. <hint> hint-1 <hint> hint-2 ... <hint> hint-n
    //
    
    // Get the header
    if (msg.indexOf("<title>") != -1) {
        var parts = msg.split("<title>")[1].split("</title>");
        error.header = parts[0];
        msg = parts[1];
    }

    // Extract the message last.
    if (msg && msg.indexOf("<message>") != -1) {
        var parts = msg.split("<message>")[1].split("</message>");
        error.msg = parts[0];
        msg = parts[1];
    }
    else  {
        error.msg = msg;
    }

    // Extract the hints next.
    if (msg && msg.indexOf("<hint>") != -1) {
        // There are hints.
        error.hints = [];
        var hints = msg.split("<hint>");
        for (var h=0; h<hints.length; h++) {
            var hint = hints[h].split("</hint")[0];
            error.hints.push(hint);
        }
    }

    return error;
};

ErrorHandler.localize = function()
{
    if (AlertBox.instances.length > 0) {
        AlertBox.dismiss();

        if (ErrorHandler.currentError) {
            var container = ErrorHandler.currentError.shift();
            var error = ErrorHandler.currentError;
            ErrorHandler.reportError(container, error[0], error[1], error[2]);
        } else {
            var container = ErrorHandler.currentErrors.shift();
            var errors = ErrorHandler.currentErrors[0];
            ErrorHandler.reportErrors(container, errors);
        }
    }
};

// Dismiss a previously shown error message box
ErrorHandler.dismissError = function(errorCode) {
    return AlertBox.dismissByTag(errorCode);
};
