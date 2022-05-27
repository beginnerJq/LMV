"use strict";

import { getGlobal } from "../compat";
import HttpApi from 'i18next-http-backend';
import { Lang } from "./langs";

export var extendLocalization = function (locales) {
    if (locales !== null && typeof locales === "object") {
        Object.keys(locales).forEach(function(language) {
            Autodesk.Viewing.i18n.addResourceBundle(
                language,
                "allstrings",
                locales[language],
                true,
                true
            );
        });
        return true;
    }
    return false;
};

export var setLanguage = function (language, callback) {
    getGlobal().LOCALIZATION_REL_PATH = "res/locales/" + language + "/";
    return Autodesk.Viewing.i18n.changeLanguage(language)
    .then(() => Autodesk.Viewing.i18n.reloadResources())
    .then(() => {
        if (callback) {
            callback();
        }
    });
};


/**
 * Initialize language for localization. The corresponding string files will get downloaded.
 */
export var initializeLocalization = function (options) {
    const global = getGlobal();
    const _window = global;
    const _document = _window && _window.document;
    Autodesk.Viewing.i18n.localize = function(domElement) {
        // Parse data
        function parse( data ) {
            return [null, data];
        }

        var rootNode = domElement || _document;
        Array.prototype.forEach.call (rootNode.querySelectorAll ('[data-i18n]'), function (element){
            var dataToTranslate = element.getAttribute('data-i18n');
            var parsed  = parse( dataToTranslate );
            var attributeName  = parsed[0];
            var stringToTrans  = parsed[1];

            var translatedString = Autodesk.Viewing.i18n.translate(stringToTrans);
            if (translatedString)
            {
                if (attributeName) {
                    element.setAttribute( attributeName, translatedString );
                }
                else {
                    // Attribute Name is always null.
                    // If the element has a placeholder, it's an edit box, no need to translate the textContent.
                    if (element.placeholder) {
                        element.placeholder = translatedString;
                    } else {
                        element.textContent = translatedString;
                    }
                }
            }
            else
            {
                if (attributeName) {
                    element.setAttribute( attributeName, stringToTrans );
                }
                else {
                    element.textContent = stringToTrans;
                }
            }
        });
    };
    var language = (options && options.language) || navigator.language;
    var lang = Lang.getSupported(language);

    Autodesk.Viewing.i18n.use(HttpApi).init({
        lng: language,
        backend: {
            loadPath: Autodesk.Viewing.Private.getResourceUrl('res/locales/%(lng)/%(ns).json'),
        },
        ns: 'allstrings',
        defaultNS: 'allstrings',
        fallbackLng: "en",
        debug: false,
        useCookie: false,
        interpolation: {
            prefix: "%(",
            suffix: ")",
            escapeValue: false
        }
    });
    setLanguage(lang);
};

