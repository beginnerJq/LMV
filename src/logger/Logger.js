
import { isTouchDevice, getGlobal } from "../compat";
import { isOffline, getEnv } from "../file-loaders/net/endpoints";
import { analytics } from '../analytics';

const global = getGlobal();
const _window = global;

/**
 * Logging levels. Higher number means more verbose logs,
 * for example, with level 3, `info`, `warn`, or `error`
 * logs will show up in the console but `debug` and `log` won't.
 *
 * Semantics of specific levels:
 *  - debug: low-level debugging logs
 *  - log: common, higher-level debugging logs
 *  - info: helpful runtime information (even for stag/prod environments)
 *  - warn: potentially problematic situations; handled exceptions
 *  - error: definitely problematic situations; unhandled exceptions
 * @readonly
 * @enum {number}
 */
export const LogLevels = {
    DEBUG : 5,
    LOG : 4,
    INFO : 3,
    WARNING : 2,
    ERROR : 1,
    NONE : 0
};


/**
 * Logger class. 
 * Depending on options.logLevel setting in initilize function, corresponding functions would be activated.
 */
export function Logger() {
    this.runtimeStats = {};
    this.level = -1;
    this.setLevel(LogLevels.ERROR);
    this._reportError = this._reportError.bind(this);
}

/**
 * Initialize Logger object with options. 
 * 
 * @param {object}   [options] - Options object to configure the Logger.
 * @param {function} [options.eventCallback] - An optional callback used for processing the log entry with properties like "category", "timestamp", etc. 
                                               It can be used as for analytics tracking by filtering and listening to specific category users are interested. 
                                               The expected argument is the user supplied entry object instrumented with "timestamp" and "sessionId" properties. 
 * @param {string}   [options.sessionId] - An optional id for each browser session. Default gets generated based on current time stamp if not specified. 
 * @param {number}   [options.logLevel] - An optional level to define the log level. Default is LogLevels.ERROR if not specified.
 *
 */

Logger.prototype.initialize = function(options) {

    if (options.eventCallback)
        this.callback = options.eventCallback;

    this.sessionId = options.sessionId;
    if (!this.sessionId) {
        var now = Date.now() + "";
        this.sessionId = parseFloat(((Math.random() * 10000) | 0) + "" + now.substring(4));
    }

    // Initialize log level is passed in
    if (typeof options.logLevel === 'number') {
        this.setLevel(options.logLevel);
    }

    this.environmentInfo = {
        touch: isTouchDevice(),
        env: getEnv(),
        referer: getReferer(),
        version: global.LMV_VIEWER_VERSION,
        build_type: global.LMV_BUILD_TYPE
    };

    //Kick off with a viewer start event
    var startEvent = {
        category: "viewer_start",
        touch: this.environmentInfo.touch,
        env: this.environmentInfo.env,
        referer: this.environmentInfo.referer,
        version: this.environmentInfo.version,
        build_type: this.environmentInfo.build_type
    };
    this.track(startEvent);

    var _this = this;
    this.interval = setInterval(function() {
        _this.reportRuntimeStats();
    }, 60000);
};

/**
 * Stop the runtime stats reporting every min.
 */
Logger.prototype.shutdown = function() {
    clearInterval(this.interval);
    this.interval = undefined;
};


/**
 * Track the user inputted entry by appending additional info "timestamp", "sessionId"
 * @param {object} [entry] - User object to define the track object, 
        e.g. {
            category : "load_document",
            urn: "xyz"
        }   
 */
Logger.prototype.track = function (entry) {

    this.updateRuntimeStats(entry);

    if (isOffline() || !this.sessionId) {
        return;
    } 

    if (this.callback) {

        entry.timestamp = Date.now();
        entry.sessionId = this.sessionId;

        this.callback(entry);
    }

    if (entry?.category === 'error') {
        trackError('viewer.error.tracked', entry);
    }
};

Logger.prototype.updateRuntimeStats = function(entry) {
    if (Object.prototype.hasOwnProperty.call(entry, 'aggregate')) {
        switch (entry.aggregate) {
            case 'count':
                if (this.runtimeStats[entry.name] > 0) {
                    this.runtimeStats[entry.name]++;
                } else {
                    this.runtimeStats[entry.name] = 1;
                }
                this.runtimeStats._nonempty = true;
                break;
            case 'last':
                this.runtimeStats[entry.name] = entry.value;
                this.runtimeStats._nonempty = true;
                break;
            default:
                this.warn('unknown log aggregate type');
        }
    }
};

Logger.prototype.reportRuntimeStats = function() {
    if (this.runtimeStats._nonempty) {
        delete this.runtimeStats._nonempty;

        this.runtimeStats.category = 'misc_stats';
        this.track(this.runtimeStats);
        this.runtimeStats = {};
    }
};

Logger.prototype.setLevel = function(level) {
    if (this.level === level)
        return;

    this.level = level;

    // Bind to console
    this.debug = level >= LogLevels.DEBUG   ? console.log  : consoleNothing;
    this.log   = level >= LogLevels.LOG     ? console.log  : consoleNothing;
    this.info  = level >= LogLevels.INFO    ? console.info : consoleNothing;
    this.warn  = level >= LogLevels.WARNING ? console.warn : consoleNothing;
    this.error = level >= LogLevels.ERROR   ? this._reportError : consoleNothing;
};


/**
 * Reports an error to the browser console and to the logger's callback.
 * Invoked by developers when method `logger.error()` is used. 
 * Forwards the arguments directly into `console.error()`. 
 * @private
 */
Logger.prototype._reportError = function() {
    console.error.apply(console, arguments);

    const msg = Array.prototype.slice.call(arguments).join(' ');
    if (this.callback) {
        this.callback({ category: 'error', message: msg });
    }

    trackError('viewer.error.logged', msg);
};

function trackError(name, content){
    let value;
    if (typeof content === 'string') {
        value = {
            message: content
        };
    } else if (typeof content === 'object') {
        value = content;
    }
    analytics.track(name, value);
}

/**
 * @private
 */
function getReferer(){
    // Wrapping href retrieval due to Fortify complains
    if (typeof window !== 'undefined') {
        return encodeURI(_window.location.href);
    }
    return '';
}



/**
 * Swallows log/debug/info/warn/error calls when the logLevel disallows it.
 * @private
 */
function consoleNothing() {

}


export let logger = new Logger();

export function setLogger(l) {
    logger = l;
}
