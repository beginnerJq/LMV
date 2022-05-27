
import { Control } from "./Control";
import i18n from "i18next";


/**
 * A text input that invokes a callback when the text changes.
 *
 * @param {string} [id] - The id for this control.
 * @param {object} [options] - An optional dictionary of options.
 * @param {function} [options.filterFunction] - Invoked when the text changes, receives 1 string argument.
 * 
 * @memberof Autodesk.Viewing.UI
 * @alias Autodesk.Viewing.UI.Filterbox
 * @class
 * @constructor
 */
export function Filterbox(id, options) {

    this._id = id;
    this._listeners = {};
    this._options = options || {};
    this._filterFunction = this._options.filterFunction || function() {};

    var _document = this.getDocument();
    this.container = _document.createElement('div');
    this.container.id = id;
    this.addClass('adsk-control');
    this.addClass('adsk-filterbox');
    this.addClass("empty");

    var filterbox = _document.createElement("input");
    filterbox.classList.add("filter-box");
    filterbox.classList.add("docking-panel-delimiter-shadow");
    filterbox.type = "search";

    filterbox.placeholder = i18n.t('Enter filter term');
    filterbox.setAttribute('data-i18n', 'Enter filter term');

    filterbox.incremental = "incremental";
    filterbox.autosave = this.container.id + "filter";
    this.container.appendChild(filterbox);
    this.filterbox = filterbox;
    
    var self = this;

    var clearFilterbox = function() {
        self.filterbox.value = '';
        self.addClass("empty");
    };

    var doFilter = function(text) {
        text = text.trim();

        if (text.length === 0) {
            self.container.classList.add("empty");
        } else {
            self.container.classList.remove("empty");
        }

        self._filterFunction && self._filterFunction(text);
    };

    var filterboxIcon = _document.createElement("div");
    filterboxIcon.className = "filter-box-icon";
    this.container.insertBefore(filterboxIcon, filterbox.nextSibling);

    var filterboxClose = _document.createElement("div");
    filterboxClose.className = "filter-box-close";
    filterboxClose.addEventListener("click", function() {
        clearFilterbox();  
    });
    this.container.appendChild(filterboxClose);

    filterbox.addEventListener("keydown", function(e) {

        var _window = self.getWindow();
        e = e || _window.event;

        // Enter
        if (e.keyCode === 13) {
            self.filterbox.blur();
        }
    });

    filterbox.addEventListener("input", function() {
        doFilter(this.value);
    });

    filterbox.addEventListener("change", function() {
        doFilter(this.value);
    });

    filterbox.addEventListener("focus", function(){
        filterboxIcon.classList.add('focused');
    });

    filterbox.addEventListener("blur", function(){
        filterboxIcon.classList.remove('focused');
    });
}

Filterbox.prototype = Object.create(Control.prototype);
Filterbox.prototype.constructor = Filterbox;
