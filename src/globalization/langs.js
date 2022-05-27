"use strict";

function LangCtor() {

    // Adding a new language:
    //   1. Add it to `this.names`, The symbol name should match the folder name in res/locales/{name}
    //   2. Update file `ContinuousLocalization.yml`

    this.names = [
        { symbol: 'en', label: 'English' },
        { symbol: 'zh-Hans', label: 'Chinese Simplified' },
        { symbol: 'zh-Hant', label: 'Chinese Traditional' },
        { symbol: 'zh-HK', label: 'Hong Kong Traditional' },
        { symbol: 'ja', label: 'Japanese' },
        { symbol: 'cs', label: 'Czech' },
        { symbol: 'ko', label: 'Korean' },
        { symbol: 'pl', label: 'Polish' },
        { symbol: 'ru', label: 'Russian' },
        { symbol: 'fr', label: 'French' },
        { symbol: 'fr-CA', label: 'Canadian French' },
        { symbol: 'de', label: 'German' },
        { symbol: 'it', label: 'Italian' },
        { symbol: 'nl', label: 'Dutch' },
        { symbol: 'es', label: 'Spanish' },
        { symbol: 'pt-BR', label: 'Portuguese Brazil' },
        { symbol: 'tr', label: 'Turkish' },
        { symbol: 'sv', label: 'Swedish' },
        { symbol: 'da', label: 'Danish' },
        { symbol: 'no', label: 'Norwegian' },
        { symbol: 'en-GB', label: 'British English'}
    ];

    this.isSupported = function(isoCode) {
        for (var i=0; i<this.names.length; ++i) {
            if (this.names[i].symbol === isoCode)
                return true;
        }
        return false;
    };

    this.getSupported = function(language) {

        // use iso scheme (ab/ab-XY/ab-Xyz)
        const tags = language.split('-');
        language = tags[0].toLowerCase();
        if (tags.length > 1) {
            let region = tags[1].toUpperCase();
            if (region.length > 2) {
                // E.g. 'zh-Hans'
                region = region[0] + region.substring(1).toLowerCase();
            }
            language += '-' + region;
        }

        // check supported language tags and subtags
        if (!this.isSupported(language)) {
            if (language.indexOf("zh-CN") > -1) language = "zh-Hans";
            else if (language.indexOf("zh-TW") > -1) language = "zh-Hant";
            else if (tags.length > 1 && this.isSupported(tags[0].toLowerCase())) language = tags[0];
            else language = "en";
        }

        return language;
    };

    this.getLanguages = function() {
        return this.names.slice();
    };

}

let Lang = new LangCtor();

module.exports = { Lang };
