
import { EventDispatcher } from "../../application/EventDispatcher";
import * as se from "./SearchEvents";
import { ResizeFooter } from "../CommonWidgets";
import { GlobalManagerMixin } from "../../application/GlobalManagerMixin";
import { logger } from "../../logger/Logger";


    var ITEM_HEIGHT = 50;           // pixels
    var FOOTER_HEIGHT = 20;         // pixels
    var ELEMENT_POOL_LENGHT = 150;  // count
    var SCROLL_SAFE_PADDING = 100;  // pixels

    /**
     * @param {HTMLElement} parent HTMLElement where the search result will be inserted
     * @param {boolean} excludeRoot Flag indicating whether to exclude the root in the search
     * @param {GuiViewer3D|HTMLElement} container Viewer container element
     */
    export function SearchResults(parent, excludeRoot, viewerContainer) {
        let container = viewerContainer;
        this.excludeRoot = excludeRoot;
        if (container instanceof Autodesk.Viewing.GuiViewer3D ||
            container instanceof Autodesk.Viewing.Viewer3D) {
            // TODO: Deprecated
            logger.warn('Deprecated use of Viewer as parameter. Provide container instead');
            container = viewerContainer.container;    
        }
        this.results = [];
        this.resultCount = 0;
        this.selectedIndex = -1;

        let _document = this.getDocument();
        this.container = _document.createElement('div');
        this.container.classList.add('docking-panel');
        this.container.classList.add('adsk-search-results');

        this.container.results = _document.createElement('div');
        this.container.results.classList.add('docking-panel-scroll');
        this.container.results.classList.add('docking-panel-container-solid-color-b');
        this.container.results.addEventListener('scroll', _onScroll.bind(this));
        this.container.appendChild(this.container.results);
        parent.insertBefore(this.container, parent.firstChild);

        this.scrollingContainer = _document.createElement('div');
        this.scrollingContainer.classList.add('adsk-search-results-scrolling-panel');
        this.scrollingContainer.addEventListener('click', _onClickResult.bind(this));  
        this.container.results.appendChild(this.scrollingContainer);
    
        this.footer = new ResizeFooter(this.container, function() {
            var bounds = this.container.getBoundingClientRect();
            var viewerBounds = container.getBoundingClientRect();

            if (viewerBounds.right < bounds.right) {
                this.container.style.width = (viewerBounds.right - bounds.left) + 'px';
            }

            if (viewerBounds.bottom < bounds.bottom) {
                this.container.style.height = (viewerBounds.bottom - bounds.top) + 'px';
            }
        }.bind(this));
        this.footer.setGlobalManager(this.globalManager);

        this.divNoResults = createNoResultsDiv(_document);
        this.scrollingContainer.appendChild(this.divNoResults);

        this.scrollY = 0;
        this.dirty = false;
        this.nextFrameId = 0;
        this.it = createIterator();

        // Creates element pools.
        this.elementsPool = [];
        this.elementsUsed = 0;
        for (var i = 0; i < ELEMENT_POOL_LENGHT; ++i) {
            this.elementsPool[i] = createPoolElement(_document);
        }

        this.setVisible(false);
    }

    SearchResults.prototype.constructor = SearchResults;
    EventDispatcher.prototype.apply(SearchResults.prototype );
    GlobalManagerMixin.call(SearchResults.prototype);
    
    SearchResults.prototype.setPosition = function(left, top) {
        this.container.style.left = left + 'px';
        this.container.style.top = top + 'px';
    };

    SearchResults.prototype.setMinWidth = function(minWidth) {
        this.container.style.width = minWidth + 'px';
    };

    SearchResults.prototype.setMaxWidth = function(maxHeight) {
        this.container.style.maxHeight = maxHeight + 'px';
    };

    SearchResults.prototype.setVisible = function(visible) {
        this.container.style.display = visible ? '' : 'none';
    };
    
    SearchResults.prototype.setResults = function(searchString, results) {
        this.searchString = searchString;
        this.results = results;
        this.resultCount = getResultCount(results);
        this.selectedIndex = this.resultCount == 0 ? -1 : 0;
        this.container.style.height = (this.resultCount * ITEM_HEIGHT + FOOTER_HEIGHT) + 'px';
        this.container.results.scrollTop = 0;
        this.scrollY = 0;

        if (this.resultCount === 0) {
            this.container.classList.add('no-content');
        } else {
            this.container.classList.remove('no-content');
        }

        redraw(this);
    };

    SearchResults.prototype.getSelection = function() {
        var element = this.scrollingContainer.querySelector('.selected');
        if(!element){
            return null;
        }

        var parts = this._getNodeAndModelIds(element);
        if(!parts) {
            return null;
        }

        return parts;
    };

    SearchResults.prototype.isRootExcluded = function() {
        if (this.results && this.results.length > 1) {
            return false;
        }
        return this.modelCount > 1 ? false : this.excludeRoot;
    };

    SearchResults.prototype.uninitialize = function() {
        this.setVisible(false);
        this.container = null;

        if (this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }

        cancelAnimationFrame(this.nextFrameId);
        this.clearListeners(); // from EventDispatcher
    };

    SearchResults.prototype.setDisplayNoResults = function(display) {
        this.divNoResults.style.display = display ? '' : 'none';
    };

    SearchResults.prototype.selectNext = function() {
        if (this.resultCount !== 0) {
            this.selectedIndex = Math.min(this.resultCount - 1, this.selectedIndex + 1);
            scrollToSelection(this.container.results, this.selectedIndex);
            redraw(this);
        }
    };

    SearchResults.prototype.selectPrevious = function() {
        if (this.resultCount !== 0) {
            this.selectedIndex = Math.max(0, this.selectedIndex - 1);
            scrollToSelection(this.container.results, this.selectedIndex);
            redraw(this);
        }
    };

    /**
     * @private
     * @param {*} div
     * @returns {undefined|{nodeId:Number, modelId:Number}} 
     */
    SearchResults.prototype._getNodeAndModelIds = function(div) {
        while(!div.hasAttribute('lmv-nodeId')) {
            div = div.parentNode;
            if (!div || div === this.scrollingContainer) {
                return undefined;
            }
        }
        var dbId = parseInt(div.getAttribute('lmv-nodeId'));
        var mdId = parseInt(div.getAttribute('lmv-modelId'));
        return { nodeId: dbId, modelId: mdId };
    };


    /**
     * Binded to SearchResults instance.
     * @private
     */
    function _onClickResult(event) {
        var div = event.target;
        var parts = this._getNodeAndModelIds(div);
        
        if(!parts) {
            return;
        }

        this.fireEvent({type: se.ON_SEARCH_SELECTED, id: parts.nodeId, modelId: parts.modelId});
        event.preventDefault();
    }

    /**
     * Binded to SearchResults instance.
     * @private
     */
    function _onScroll() {
        // Avoid re-building the tree unless we have scrolled far enough.
        var scrollY = this.container.results.scrollTop;
        if (Math.abs(this.scrollY - scrollY) >= SCROLL_SAFE_PADDING) {
            this.scrollY = scrollY;
            redraw(this);
        }
    }

    function redraw(panel, immediate) {
        // If the panel is not dirty, marked as dirty and schedule an update during next frame.
        if (panel.dirty && !immediate) {
            return;
        }
    
        if (immediate) {
            renderNow(panel);
        } else {
            panel.dirty = true;
    
            // All update requests are executed as one during next frame.
            panel.nextFrameId = requestAnimationFrame(function() {
                renderNow(panel);
            });
        }
    }

    function renderNow(panel) {
        panel.dirty = false;
        clearElements(panel);

        if (panel.resultCount === 0) {
            panel.setDisplayNoResults(true);
            return;
        }

        panel.setDisplayNoResults(false);
        createVisibleElements(panel);
    }

    function clearElements(panel) {
        
        var elementsUsed = panel.elementsUsed;
        var elementsPool = panel.elementsPool;
    
        // Return used elements to the elements pool.
        for (var i = 0; i < elementsUsed; ++i) {    
            var element = elementsPool[i];
            cleanPoolElement(element);
        }

        panel.elementsUsed = 0;
    }

    function createVisibleElements(panel) {
        var container = panel.container.results;
        var currY = 0;
        
        var CONTAINER_HEIGHT = container.clientHeight;
        var currScroll = panel.scrollY;
        var it = panel.it.init(panel.results);

        // skip rows above the scrolling area
        var skipY = Math.max(0, panel.scrollY - SCROLL_SAFE_PADDING);
        var skipCount = Math.floor(skipY / ITEM_HEIGHT) | 0;
        var itemIndex = 0;
        currY = skipCount * ITEM_HEIGHT;
        while (skipCount) {
            skipCount--;
            itemIndex++;
            it.next();
        }  
        var paddingElement = panel.elementsPool[panel.elementsUsed++];
        paddingElement.style.height = currY + 'px';
        panel.scrollingContainer.appendChild(paddingElement);
        
        // Start rendering items until we don't have any more vertical space.
        var adding = true;
        while (adding) {

            // Advance the iterator
            it.next();
            if (it.done()) {
                adding = false;
                break;
            }

            // Any more room vertically?
            if (currY > currScroll + CONTAINER_HEIGHT + SCROLL_SAFE_PADDING) {
                adding = false;
                break;
            }

            // Any more DIVs in the pool?
            if (panel.elementsUsed === panel.elementsPool.length) {
                adding = false;
                break;
            }

            var id = it.id();
            var delegate = it.delegate();
            var elemHeight = ITEM_HEIGHT;
            var elemTop = currY;
            var elemBtm = elemTop + elemHeight;

            var element = panel.elementsPool[panel.elementsUsed++];
            populateResultEntry(id, delegate, element, panel, itemIndex === panel.selectedIndex);

            panel.scrollingContainer.appendChild(element);

            // move height counter
            currY = elemBtm;
            itemIndex++;
        }

        // account for non-rendered elements at the bottom
        var totalY = panel.resultCount * ITEM_HEIGHT;
        panel.scrollingContainer.style.height = totalY + 'px';
    }

    /**
     * @param {Array} results 
     * @returns {Number} The amount of search results across all loaded models.
     * @private
     */
    function getResultCount(results) {
        var count = 0;
        for (var m=0; m<results.length; ++m) {
            var modelResults = results[m];
            count += modelResults.ids.length;
        }
        return count;
    }

    /**
     * Returns an iterator specialized for search results, which consists of an Array containing
     * objects with { delegate:TreeDelegate, ids: Array<Number> } 
     * 
     * Must invoke init() before usage.
     * 
     * @private
     */
    function createIterator() {

        var iterator = {
            init: function(results){
                this.isDone = false;
                this.results = results; // doesn't mutate it.
                this.indexRs = 0;       // Index into `results`
                this.indexId = -1;      // Index into `ids`
                return this;
            },
            done: function(){
                return this.isDone;
            },
            next: function() {
                if (this.isDone) {
                    return this;
                }
                this.indexId++;
                while (this.results.length !== this.indexRs && this.indexId === this.results[this.indexRs].ids.length) {
                    this.indexId = 0;
                    this.indexRs++;
                }
                this.isDone = (this.indexRs === this.results.length);
                return this;
            },
            id: function() {
                return this.results[this.indexRs].ids[this.indexId];
            },
            delegate: function() {
                return this.results[this.indexRs].delegate;
            }
        };

        return iterator;
    }

    function populateResultEntry(id, delegate, element, panel, selected) {
        // Set the height, always.
        element.classList.add('search-result');

        // Add / Remove selection class.
        if (selected) {
            element.classList.add('selected');
        } else {
            element.classList.remove('selected');
        }

        // Attributes
        element.setAttribute("lmv-nodeId", id);
        element.setAttribute('lmv-modelId', delegate.model.id);
        element.style.height = ITEM_HEIGHT + 'px';

        // Get the label
        var nodeName = delegate.instanceTree.getNodeName(id);

        // Find the matching substring
        var searchString = panel.searchString;
        var index = nodeName.toLowerCase().indexOf(searchString.toLowerCase());

        var prefixStr = nodeName.substr(0, index);
        var matchStr = nodeName.substr(index, searchString.length);
        var sufixStr = nodeName.substr(index + searchString.length);

        element.domPrefix.innerText = prefixStr;
        element.domMatch.innerText = matchStr;
        element.domSufix.innerText = sufixStr;

        // Populate path
        var route = getParentLabels(id, delegate, panel);
        element.domPath.innerText = route.join(' > ');
    }
    
    function getParentLabels(id, delegate, panel) {
        var res = [];
        var rootId = delegate.getRootId();
        var excludeRoot = panel.isRootExcluded();
        var instanceTree = delegate.instanceTree;
        var parentId = id;
        var done = false;
        while (parentId && !done) {
            if (parentId === rootId) {
                // Include root and nothing else.
                // The root might be a doubleRoot, thus we need an explicit stop.
                done = true;
                if (excludeRoot) {
                    break; // avoid including the root in this case.
                }
            }
            var label = instanceTree.getNodeName(parentId);
            res.unshift(label); // add to front
            parentId = instanceTree.getNodeParentId(parentId);
        }
        return res;
    }

    /**
     * @private
     */
    function createPoolElement(_document) {

        var element = _document.createElement('div');
        var innerElem = _document.createElement('div');

        var prefix = _document.createElement('span');
        var match = _document.createElement('span');
        var sufix = _document.createElement('span');
        var path = _document.createElement('span');

        innerElem.classList.add('search-result-container');
        match.classList.add('search-match');
        path.classList.add('search-path');

        innerElem.appendChild(prefix);
        innerElem.appendChild(match);
        innerElem.appendChild(sufix);
        innerElem.appendChild(path);
        element.appendChild(innerElem);
        
        // Keep easy to access pointers
        element.domPrefix = prefix;
        element.domMatch = match;
        element.domSufix = sufix;
        element.domPath = path;
        element.domContainer = innerElem;

        return element;
    }

    /**
     * @private
     */
    function cleanPoolElement(element) {
        element.setAttribute('lmv-nodeId', '');
        element.setAttribute('lmv-modelId', '');
        element.domPrefix.innerText = '';
        element.domMatch.innerText = '';
        element.domSufix.innerText = '';
        element.domPath.innerText = '';
        element.style.height = '0';
    }

    /**
     * @private
     */
    function createNoResultsDiv(_document) {
        
        var divNoResults = _document.createElement('div');
        var divTitle = _document.createElement('div');
        var divMessage = _document.createElement('div');

        // container
        divNoResults.classList.add('no-results-container');
        divNoResults.style.display = 'none';
        
        // title
        var textTitle = 'No Results';
        divTitle.setAttribute('data-i18n', textTitle);
        divTitle.textContent = Autodesk.Viewing.i18n.translate(textTitle);
        divTitle.classList.add('no-results-title');

        // message
        var textMessage = 'Try another term';
        divMessage.setAttribute('data-i18n', textMessage);
        divMessage.textContent = Autodesk.Viewing.i18n.translate(textMessage);
        divMessage.classList.add('no-results-description');
        
        divNoResults.appendChild(divTitle);
        divNoResults.appendChild(divMessage);

        // Keep easy to access pointers
        divNoResults.domTitle = divTitle;
        divNoResults.domMessage = divMessage;

        return divNoResults;
    }

    /**
     * @private
     */
    function scrollToSelection(results, selectedIndex) {
        if((results.scrollTop + results.clientHeight) < (selectedIndex + 1) * ITEM_HEIGHT) {
            results.scrollTop += (selectedIndex + 1) * ITEM_HEIGHT - (results.scrollTop + results.clientHeight) ;
        }
        if (results.scrollTop / ITEM_HEIGHT > selectedIndex) {
            results.scrollTop = selectedIndex * ITEM_HEIGHT;
        }
    }
