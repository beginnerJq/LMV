
import { Control } from "./Control";
import * as se from "./SearchEvents";
import { logger } from "../../logger/Logger";
import { SearchResults } from "./SearchResults";
import i18n from "i18next";
const debounce = require("lodash/debounce");


/**
 * Base class for UI controls.
 *
 * It is abstract and should not be instantiated directly.
 * @param {string} [id] - The id for this control. Optional.
 * @param {GuiViewer3D|HTMLElement} container Viewer container element
 * @param {object} [options] - An optional dictionary of options.
 * @abstract
 * @memberof Autodesk.Viewing.UI
 * @private
 */
export function Searchbox(id, container, options) {

    this._id = id;
    this._listeners = {};
    this._options = options || {};
    this._searchFunction = this._options.searchFunction || function() {};

    var _document = this.getDocument();
    this.container = _document.createElement('div');
    this.container.id = id;
    this.addClass('adsk-control');
    this.addClass('adsk-searchbox');
    this.addClass("empty");

    var searchbox = _document.createElement("input");
    searchbox.classList.add("search-box");
    searchbox.classList.add("docking-panel-delimiter-shadow");
    searchbox.type = "search";
    searchbox.results = [];

    searchbox.placeholder = i18n.t("Search");
    searchbox.setAttribute("data-i18n", "Search");

    searchbox.incremental = "incremental";
    searchbox.autosave = this.container.id + "search_autosave";
    this.container.insertBefore(searchbox, this.scrollContainer);
    this.searchbox = searchbox;

    var clearSearchBox = function() {
        self.searchbox.value = '';
        self.addClass("empty");
    };

    var closeSearchResults = function() {
        self.searchbox.classList.remove('searching');
        self.searchResults.setVisible(false);
    };

    var searchboxIcon = _document.createElement("div");
    searchboxIcon.className = "search-box-icon";
    this.container.insertBefore(searchboxIcon, searchbox.nextSibling);

    var searchboxClose = _document.createElement("div");
    searchboxClose.className = "search-box-close";
    searchboxClose.addEventListener("click", function() {
        clearSearchBox();
        closeSearchResults();   
    });
    this.container.appendChild(searchboxClose);

    this.searchResults = new SearchResults(this.container, options.excludeRoot, container);
    this.searchResults.addEventListener(se.ON_SEARCH_SELECTED, function(event){
        clearSearchBox();
        closeSearchResults();
        self.fireEvent(event);
    });

    var self = this;
    //ADP
    var trackAdpFirstSearch = true;

    

    searchbox.addEventListener("keydown", function(e) {

        var _window = self.getWindow();
        e = e || _window.event;

        // Arrow down.
        if (e.keyCode === 38) {
            self.searchResults.selectPrevious();
            e.preventDefault();
        }

        // Arrow down.
        if (e.keyCode === 40) {
            self.searchResults.selectNext();
            e.preventDefault();
        }

        // Enter
        if (e.keyCode === 13) {
            var selection = self.searchResults.getSelection();
            if(!selection) {
                return false;
            }

            clearSearchBox();
            closeSearchResults();

            self.fireEvent({type: Searchbox.Events.ON_SEARCH_SELECTED, id: selection.nodeId, modelId: selection.modelId});
            e.preventDefault();
        }
    });

    function doSearch() {

        var searchString = searchbox.value.trim();
        if (searchString.length === 0) {
            closeSearchResults();
            return;
        }
        
        if (trackAdpFirstSearch) {
            logger.track({category:'search_node', name: 'model_browser_tool'});
            trackAdpFirstSearch = false;
        }

        // The search is actually a filter that displays results for node-names that contain the search string.
        searchbox.classList.add('searching');

        var resultIds = self._searchFunction(searchString);
        self.searchResults.setResults(searchString, resultIds);
        self.searchResults.setVisible(true);
    }

    var TIMEOUT = 800;

    var checkAndSearch = debounce(() => {
        // Close the serach result panel, if opened.
        if (searchbox.value.length === 0) {
            self.container.classList.add("empty");
            closeSearchResults();
            return;
        }

        self.container.classList.remove("empty");

        // prevent search while typing text that is too short.
        if (searchbox.value.length < 3) {
            return;
        }

        doSearch();
    }, TIMEOUT);

    searchbox.addEventListener("input", function(/* event */) { // delayed: as typing
        checkAndSearch();
    });

    searchbox.addEventListener("change", function(event) { // immediate: press enter
        var _document = self.getDocument();
        if (event.target === _document.activeElement) {
            checkAndSearch();
        } else {
            // focus lost, don't search.
            return;
        }
    });

    searchbox.addEventListener("focus", function(){
        searchboxIcon.classList.add('focused');
    });

    searchbox.addEventListener("blur", function(){
        searchboxIcon.classList.remove('focused');
    });
}

Searchbox.prototype = Object.create(Control.prototype);
Searchbox.prototype.constructor = Searchbox;

//TODO: Remove this once ViewerModelStructurePanel is modularized
// Events fired
Searchbox.Events = {
    ON_SEARCH_SELECTED: se.ON_SEARCH_SELECTED
};
