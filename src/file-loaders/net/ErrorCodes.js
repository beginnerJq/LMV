
/**
 * Error code constants
 * These constants will be used in {@link Callbacks#onGenericError} functions.
 *
 * @namespace Autodesk.Viewing.ErrorCodes
 */
export const ErrorCodes = {
    /** 
     * An unknown failure has occurred. 
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes
     * @type {number}
     */
    UNKNOWN_FAILURE : 1,

    /** 
     * Bad data (corrupted or malformed) was encountered. 
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes
     * @type {number}
     */
    BAD_DATA : 2,

    /** 
     * A network failure was encountered. 
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes
     * @type {number}
     */
    NETWORK_FAILURE : 3,

    /** 
     * Access was denied to a network resource (HTTP 403)
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes
     * @type {number}
     */
    NETWORK_ACCESS_DENIED : 4,

    /** 
     * A network resource could not be found (HTTP 404)
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes
     * @type {number}
     */
    NETWORK_FILE_NOT_FOUND : 5,

    /** 
     * A server error was returned when accessing a network resource (HTTP 5xx)
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes
     * @type {number}
     */
    NETWORK_SERVER_ERROR : 6,

    /** 
     * An unhandled response code was returned when accessing a network resource (HTTP 'everything else')
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes
     * @type {number}
     */
    NETWORK_UNHANDLED_RESPONSE_CODE : 7,

    /** 
     * Browser error = webGL is not supported by the current browser
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes
     * @type {number}
     */
    BROWSER_WEBGL_NOT_SUPPORTED : 8,

    /** 
     * There is nothing viewable in the fetched document 
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes
     * @type {number}
     */
    BAD_DATA_NO_VIEWABLE_CONTENT : 9,

    /** 
     * Browser error = webGL is supported, but not enabled 
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes
     * @type {number}
     */
    BROWSER_WEBGL_DISABLED : 10,

    /**
     * There is no geometry in loaded model
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes
     * @type {number}
     */
    BAD_DATA_MODEL_IS_EMPTY : 11,

    /** 
     * Collaboration server error
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes
     * @type {number}
     */
    RTC_ERROR : 12,

    /** 
     * The extension of the loaded file is not supported 
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes
     * @type {number}
     */
    UNSUPORTED_FILE_EXTENSION : 13,

    /** 
     * Viewer error: wrong or forbidden usage of the viewer
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes
     * @type {number}
     */
    VIEWER_INTERNAL_ERROR : 14,

    /** 
     * WebGL error while loading a model, typically due to IE11 limitations
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes 
     * @type {number}
     */
    WEBGL_LOST_CONTEXT: 15,

    /** 
     * Viewer error because loading a resource was canceled
     *
     * @constant
     * @memberof Autodesk.Viewing.ErrorCodes 
     * @type {number}
     */
    LOAD_CANCELED: 16,
};

/**
 * Formatted error message
 * @param {number} errorCode - Error code
 * @returns {string} - Error message
 * @alias Autodesk.Viewing.errorCodeString
 * @private
 */
export function errorCodeString(errorCode) {
    return "ErrorCode:" + errorCode + ".";
}

/**
 * Get ErrorCodes enum from http status code
 * @param {number} networkStatus - HTTP status code
 * @returns {number} - Autodesk.Viewing.ErrorCodes enum
 * @alias Autodesk.Viewing.getErrorCode
 * @private
 */
export function getErrorCode( networkStatus )
{
    if ( (networkStatus === 403) || ( networkStatus === 401) )
    {
        return ErrorCodes.NETWORK_ACCESS_DENIED;
    }
    else if (networkStatus === 404 )
    {
        return ErrorCodes.NETWORK_FILE_NOT_FOUND;
    }
    else if (networkStatus >= 500 )
    {
        return ErrorCodes.NETWORK_SERVER_ERROR;
    }

    return ErrorCodes.NETWORK_UNHANDLED_RESPONSE_CODE;
}
