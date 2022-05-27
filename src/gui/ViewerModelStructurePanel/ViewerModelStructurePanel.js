import { ModelStructurePanel } from "../ModelStructurePanel";
import * as se from "../controls/SearchEvents";
import * as et from "../../application/EventTypes";
import { Searchbox } from "../controls/Searchbox";
import { logger } from "../../logger/Logger";
import { ViewerPanelMixin } from "../ViewerPanelMixin";
import { generateDefaultViewerHandlerOptions } from './helper';

/**
 * Options object for Model Structure panel
 * @typedef {Object} ViewerModelStructurePanelOptions
 * @property {string} [defaultTitle=Model] - Title shown on the panel's header
 * @property {boolean} [excludeRoot=true] - Flag indicating whether the root should be included in the hierarchy
 * @property {string} [startCollapsed=false] - Flag indicating whether the tree nodes should be extended when
 * initializing
 * @property {Array<number>} [scrollEaseCurve=[0,0,.29,1]] - bezier curve points
 * @property {number} [scrollEaseSpeed=0.003] - Time taken to interpolate between initial and final position of the
 * scrollbar
 * @property {boolean} [addFooter=true] - Flag indicating whether to show the footer and the resize or not
 * @property {Object} [docStructureConfig] - Handler mapping between UI events and business logic
 * @property {boolean} [hideSearch=false] - Flag indicating whether to show or hide search filter
 * @property {number} [heightAdjustment=104|70] - Height of the search filter.
 *  Default value depends on whether hideSearch is true
 * @property {string} [maxHeight] - Default value is the container maxHeight minus the margin
 * @property {function} [onSearchSelected] - Callback when a filtered element is selected
 * @property {function} [onUnInitialize] - Callback when model browser is uninitialized
 * @property {function} [onVisibilityIconClick] - Callback when clicking on visibility icon
 * @property {function} [onIsolate] - Callback when clicking on tree node
 * @property {function} [onToggleMultipleOverlayedSelection] - Callback when clicking on multiple tree node using shift key
 * @property {function} [onToggleOverlayedSelection] - Callback when clicking on tree node using shift key
 * @property {function} [onSelectOnly] - Callback when selecting an element on a tree node
 * @property {function} [onDeselectAll] - Callback when deselecting all elements
 * @property {function} [onSelectToggle] - Callback when toggling selection on a tree node
 * @property {function} [onShowAll] - Callback when showing all elements
 * @property {function} [onFocus] - Callback when focusing on an tree node
 * @property {function} [onHide] - Callback when hiding a tree node
 * @property {function} [onShow] - Callback when showing a tree node
 * @property {function} [onToggleVisibility] - Callback when toggling visibility on a tree node
 * @property {function} [getAggregateIsolation] - Function to get the isolated elements on the aggregated view
 * @property {function} [getAggregateHiddenNodes] - Function to get the hidden elements on the aggregated view
 * @property {function} [getAggregateSelection] - Function to get the selected elements on the aggregated view
 * @property {GlobalManager} globalManager - Viewer global manager
 * @property {HTMLElement} container - Viewer html container
 * @property {function} removeEventListener - Event dispatcher function for removing listeners
 * @property {function} addEventListener - Event dispatcher function for adding listeners
 */

const avp = Autodesk.Viewing.Private;

    var kDefaultDocStructureConfig = {
        "click": {
            "onObject": ["isolate"]
        },
        "clickShift": {
            "onObject": ["toggleMultipleOverlayedSelection"]
        },
        "clickCtrl": {
            "onObject": ["toggleVisibility"]
        }
    };

    /**
     * 
     * @param {GuiViewer3D|ViewerModelStructurePanelOptions} viewer 
     * @param {String} title
     * @param {ViewerModelStructurePanelOptions} [options] 
     */
    export function ViewerModelStructurePanel(viewer, userTitle, ops) {
        let options = { ...ops } || {};
        let title = userTitle;

        if (viewer instanceof Autodesk.Viewing.GuiViewer3D ||
            viewer instanceof Autodesk.Viewing.Viewer3D) {
            // TODO: Deprecated
            logger.warn('Deprecated use of Viewer as parameter. Use options callbacks instead');
            options = {
                ...options,
                ...generateDefaultViewerHandlerOptions(viewer)
            };
        } else {
            options = {...viewer};
        }
        

        this.visible = false;
        this._trackNodeClick = true; // ADP


        options.defaultTitle = "Model";
        options.excludeRoot = options.excludeRoot !== undefined ? options.excludeRoot : true;
        options.startCollapsed = options.startCollapsed !== undefined ? options.startCollapsed : false;
        options.scrollEaseCurve = options.scrollEaseCurve || [0, 0, .29, 1];
        options.scrollEaseSpeed = options.scrollEaseSpeed !== undefined ? options.scrollEaseSpeed : 0.003; // 0 disables interpolation.
        options.addFooter = options.addFooter !== undefined ? options.addFooter : true;

        this.clickConfig = (options && options.docStructureConfig) ? options.docStructureConfig : kDefaultDocStructureConfig;
        this.isMac = (navigator.userAgent.search("Mac OS") !== -1);

        if (options.hideSearch) {
            options.heightAdjustment = 70;
            ModelStructurePanel.call(this, options.container, options.container.id + 'ViewerModelStructurePanel', title, options);
            this.scrollContainer.classList.add('no-search');
        } else {
            options.heightAdjustment = 104; //bigger than default because of search bar
            ModelStructurePanel.call(this, options.container, options.container.id + 'ViewerModelStructurePanel', title, options);

            this.searchbox = new Searchbox(options.container.id + 'ViewerModelStructurePanel' + '-Searchbox', options.container, { excludeRoot: options.excludeRoot, searchFunction: filterIds.bind(this) });
            this.searchbox.setGlobalManager(this.globalManager);
            if (options.onSearchSelected) {
                this.searchbox.addEventListener(se.ON_SEARCH_SELECTED, options.onSearchSelected);
            }
            this.container.appendChild(this.searchbox.container);
        }
        this.setGlobalManager(options.globalManager);


        this._ignoreScroll = false;

        this.selectedNodes = {};

        this.onViewerSelect = this.onViewerSelect.bind(this);
        this.onViewerIsolate = this.onViewerIsolate.bind(this);
        this.onViewerHide = this.onViewerHide.bind(this);
        this.onViewerShow = this.onViewerShow.bind(this);
    }

    ViewerModelStructurePanel.prototype = Object.create(ModelStructurePanel.prototype);
    ViewerModelStructurePanel.prototype.constructor = ViewerModelStructurePanel;
    ViewerPanelMixin.call(ViewerModelStructurePanel.prototype);

    /**
     * Invoked when the panel is getting destroyed.
     */
    ViewerModelStructurePanel.prototype.uninitialize = function () {
        this.options.removeEventListener?.(et.AGGREGATE_SELECTION_CHANGED_EVENT, this.onViewerSelect);
        this.options.removeEventListener?.(et.AGGREGATE_ISOLATION_CHANGED_EVENT, this.onViewerIsolate);
        this.options.removeEventListener?.(et.HIDE_EVENT, this.onViewerHide);
        this.options.removeEventListener?.(et.SHOW_EVENT, this.onViewerShow);

        if (this.searchResults) {
            this.searchResults.uninitialize();
            this.searchResults = null;
        }
        ModelStructurePanel.prototype.uninitialize.call(this);
    };

    ViewerModelStructurePanel.prototype.resizeToContent = function () {

        var treeNodesContainer = this.scrollContainer;
        var rootContainer = this.tree ? this.tree.getRootContainer() : null;

        if (!treeNodesContainer || !rootContainer) {
            return;
        }

        var size = 'calc(100% + ' + treeNodesContainer.scrollLeft + 'px)';
        rootContainer.style.width = size;
    };

    ViewerModelStructurePanel.prototype.createUI = function () {

        if (this.uiCreated) {
            return;
        }

        ModelStructurePanel.prototype.createUI.call(this);

        // Get container of the tree nodes, also, set its scrollbar to the left.
        var treeNodesContainer = this.scrollContainer;
        treeNodesContainer.classList.remove('left');

        // This method will resize panel according to content each frame, we could implement this in clever and more complicated way
        // but with the risk to not contemplating all the cases resizing is needed.
        var onResize = function () {
            if (this.visible) {
                this.resizeToContent();
            }
            requestAnimationFrame(onResize);
        }.bind(this);
        onResize();

        this.options.onCreateUI?.(this);

        // Set position and height.
        var options = this.options;
        var margin = 10;
        var marginMult = 3; // top and bottom
        var maxHeight = options.maxHeight ? options.maxHeight :
            'calc(' + this.container.style.maxHeight + ' - ' + (margin * marginMult) + 'px)';

        this.container.style.top = margin + 'px';
        this.container.style.left = margin + 'px';

        this.container.style.height = maxHeight;
        this.container.style.maxHeight = maxHeight;

        // When selection changes in the viewer, the tree reflects the selection.
        this.options.addEventListener?.(et.AGGREGATE_SELECTION_CHANGED_EVENT, this.onViewerSelect);
        this.options.addEventListener?.(et.AGGREGATE_ISOLATION_CHANGED_EVENT, this.onViewerIsolate);
        this.options.addEventListener?.(et.HIDE_EVENT, this.onViewerHide);
        this.options.addEventListener?.(et.SHOW_EVENT, this.onViewerShow);
    };

    /**
     * Viewer Event handler
     * @private
     */
    ViewerModelStructurePanel.prototype.onViewerSelect = function (event) {
        this.setSelection(event.selections);
        if (!this._ignoreScroll) {
            this.scrollToSelection(event.selections);
        }
        this._ignoreScroll = false;
    };

    /**
     * Viewer Event handler
     * @private
     */
    ViewerModelStructurePanel.prototype.onViewerIsolate = function (event) {
        this.setIsolation(event.isolation);
    };

    /**
     * Viewer Event handler
     * @private
     */
    ViewerModelStructurePanel.prototype.onViewerHide = function (event) {
        this.setHidden(event.nodeIdArray.slice(), event.model, true);
    };

    /**
     * Viewer Event handler
     * @private
     */
    ViewerModelStructurePanel.prototype.onViewerShow = function (event) {
        this.setHidden(event.nodeIdArray.slice(), event.model, false);
    };



    ViewerModelStructurePanel.prototype.setVisible = function (show) {

        ModelStructurePanel.prototype.setVisible.call(this, show);

        if (this.visible === show) {
            return;
        }

        this.visible = show;

        if (this.visible) {
            this.sync();
        }
    };

    ViewerModelStructurePanel.prototype.sync = function () {

        var isolation = this.options.getAggregateIsolation?.() || [];
        var hidden = this.options.getAggregateHiddenNodes?.() || [];
        var selection = this.options.getAggregateSelection?.() || [];

        this.setIsolation(isolation);

        if (isolation.length === 0) {
            for (var i = 0; i < hidden.length; ++i) {
                var model = hidden[i].model;
                var ids = hidden[i].ids;
                this.setHidden(ids, model, true);
            }
        }

        this.setSelection(selection);
        this.scrollToSelection(selection);
    };

    ViewerModelStructurePanel.prototype.removeTreeUI = function (model) {

        delete this.selectedNodes[model.id];
        ModelStructurePanel.prototype.removeTreeUI.call(this, model);
    };

    ViewerModelStructurePanel.prototype.setHidden = function (nodes, model, hidden) {

        var tree = this.tree;
        var delegate = tree.getDelegate(model.id);

        var action = hidden ?
            function (node) {
                tree.addClass(delegate, node, 'dim', false);
                tree.removeClass(delegate, node, 'visible', false);
                return true;
            } :
            function (node) {
                tree.removeClass(delegate, node, 'dim', false);
                tree.addClass(delegate, node, 'visible', false);
                return true;
            };

        for (var i = 0; i < nodes.length; ++i) {
            tree.iterate(delegate, nodes[i], action);
        }
    };

    ViewerModelStructurePanel.prototype.setIsolation = function (isolation) {

        // Special case, nothing isolated when array is empty
        var tree = this.tree;
        if (isolation.length === 0) {
            tree.forEachDelegate(function (delegate) {

                var model = delegate.model;
                var instanceTree = delegate.instanceTree;

                if (!instanceTree)
                    return;

                var rootId = instanceTree.getRootId();

                tree.iterate(delegate, rootId, function (node) {
                    tree.removeClass(delegate, node, 'dim', false);
                    tree.removeClass(delegate, node, 'visible', false);
                    return true;
                });
                this.setHidden([rootId], model, false);
            }.bind(this));

            return;
        }

        // append missing models into the isolation array
        var fullyHidden = [];
        if (isolation.length) {
            this.tree.forEachDelegate(function (delegate) {
                var idx = -1;
                for (var j = 0; j < isolation.length; j++) {
                    if (isolation[j].model === delegate.model) {
                        idx = j;
                        break;
                    }
                }
                if (idx === -1) {
                    fullyHidden.push(delegate);
                }
            }.bind(this));
        }


        // Process isolation
        for (let i = 0; i < isolation.length; ++i) {

            const model = isolation[i].model;
            const instanceTree = model.getData().instanceTree;
            if (!instanceTree) {
                continue;
            }
            const rootId = instanceTree.getRootId();

            const delegate = tree.getDelegate(model.id);

            tree.iterate(delegate, rootId, function (node) {
                tree.removeClass(delegate, node, 'dim', false);
                tree.removeClass(delegate, node, 'visible', false);
                return true;
            });

            var nodes = isolation[i].ids;
            if (nodes.length === 0)
                continue;

            // If the root is isolated, we don't want to dim anything.
            //
            if (nodes.length === 1 && nodes[0] === rootId) {
                return;
            }

            this.setHidden([rootId], model, true);
            this.setHidden(nodes, model, false);
        }

        // Hide the rest of the models
        for (let i = 0; i < fullyHidden.length; ++i) {

            const delegate = fullyHidden[i];
            const model = delegate.model;
            const instanceTree = delegate.instanceTree;
            if (!instanceTree) {
                continue;
            }
            const rootId = instanceTree.getRootId();

            tree.iterate(delegate, rootId, function (node) {
                tree.removeClass(delegate, node, 'dim', false);
                tree.removeClass(delegate, node, 'visible', false);
                return true;
            });

            this.setHidden([rootId], model, true);
        }
    };

    /**
     * Displays the given nodes as selected in this panel.
     *
     * @param {Array} nodes - An array of Autodesk.Viewing.Model nodes to display as selected
     */
    ViewerModelStructurePanel.prototype.setSelection = function (aggregatedSelection) {
        var i, k, parent, model, nodes, delegate, instanceTree;
        var tree = this.tree;

        // Un-mark the ancestors.
        for (var modelId in this.selectedNodes) {
            nodes = this.selectedNodes[modelId];
            delegate = tree.getDelegate(modelId);
            if (!delegate)
                continue;

            instanceTree = delegate.instanceTree;
            if (!instanceTree)
                continue;

            for (k = 0; k < nodes.length; ++k) {
                parent = instanceTree.getNodeParentId(nodes[i]);
                while (parent) {
                    tree.removeClass(delegate, parent, 'ancestor-selected');
                    parent = instanceTree.getNodeParentId(parent);
                }
            }

            tree.clearSelection(delegate);
        }

        // Mark the ancestors of the newly selected nodes.
        //
        this.selectedNodes = {};
        for (i = 0; i < aggregatedSelection.length; ++i) {
            model = aggregatedSelection[i].model;
            nodes = aggregatedSelection[i].dbIdArray || aggregatedSelection[i].selection;

            delegate = tree.getDelegate(model.id);
            if (!delegate)
                continue;

            instanceTree = delegate.instanceTree;
            if (!instanceTree)
                continue;

            for (k = 0; k < nodes.length; ++k) {
                parent = instanceTree.getNodeParentId(nodes[i]);
                while (parent) {
                    tree.addClass(delegate, parent, 'ancestor-selected');
                    parent = instanceTree.getNodeParentId(parent);
                }
            }

            // Mark the newly selected nodes.
            //
            tree.setSelection(delegate, nodes);

            // Bookkeeping
            this.selectedNodes[model.id] = nodes.concat();
        }
    };



    ViewerModelStructurePanel.prototype.scrollToSelection = function (aggregatedSelection) {

        // Grab first selection...
        var first = aggregatedSelection[0];
        if (!first)
            return;

        var model = first.model;
        var nodes = first.dbIdArray || first.selection;

        var scrollY = this.tree.scrollTo(nodes[0], model);

        var currScroll = this.scrollContainer.scrollTop;
        this.scrollContainer.scrollTop = scrollY;
        var endScroll = this.scrollContainer.scrollTop; // scrollTop will get modified due to height constraints.
        this.scrollContainer.scrollTop = currScroll;

        if (this.options.scrollEaseSpeed > 0) {
            this.animateScroll(currScroll, endScroll, function (posY) {
                this.tree.setScroll(posY);
            }.bind(this));
        } else {
            this.scrollContainer.scrollTop = endScroll;
            this.tree.setScroll(endScroll);
        }
    };

    /**
     * Invoked by our specialized delegate.
     */
    ViewerModelStructurePanel.prototype.onEyeIcon = function (dbId, model) {

        this.options.onVisibilityIconClick?.(dbId, model);
        avp.analytics.track('viewer.model_browser', {
            from: 'Panel',
            action: 'Toggle Visibility',
        });
    };

    /**
     * Overrides method in base class
     */
    ViewerModelStructurePanel.prototype.onTreeNodeClick = function (tree, node, model, event) {
        if (this._trackNodeClick) {
            logger.track({ category: 'node_selected', name: 'model_browser_tool' });
            this._trackNodeClick = false;
        }

        if (this.isMac && event.ctrlKey) {
            return;
        }

        var key = "click";
        if (this.ctrlDown(event)) {
            key += "Ctrl";
        }
        if (event.shiftKey) {
            key += "Shift";
        }
        if (event.altKey) {
            key += "Alt";
        }

        var actions = ['toggleOverlayedSelection'];
        var clickConfig = this.clickConfig[key];
        if (clickConfig) {
            actions = clickConfig["onObject"];
        }

        avp.analytics.track('viewer.model_browser', {
            from: 'Panel',
            action: 'Select',
        });
        this.handleAction(actions, node, model);
    };

    /**
     * Overrides method in base class
     */
    ViewerModelStructurePanel.prototype.onTreeNodeRightClick = function (tree, node, model, event) {
        // Sometimes CTRL + LMB maps to a right click on a mac. Redirect it.
        if (this.isMac && event.ctrlKey && event.button === 0) {
            if (this.clickConfig && this.clickConfig["clickCtrl"]) {
                this.handleAction(this.clickConfig["clickCtrl"]["onObject"], node, model);
            }
            return null;
        }
        if (this.options.onTreeNodeRightClick) {
            this.options.onTreeNodeRightClick(event);
        }
    };

    /**
     * @private
     */
    ViewerModelStructurePanel.prototype.handleAction = function (actionArray, dbId, model) {

        for (var action in actionArray) {
            switch (actionArray[action]) {
                case "toggleOverlayedSelection":
                    this.toggleOverlayedSelection(dbId, model);
                    break;
                case "toggleMultipleOverlayedSelection":
                    this.toggleMultipleOverlayedSelection(dbId, model);
                    break;
                case "selectOnly":
                    if (this.options.onSelectOnly) {
                        this.options.onSelectOnly(dbId, model);
                    }
                    break;
                case "deselectAll":
                    this.options.onDeselectAll?.(dbId, model);
                    break;
                case "selectToggle":
                    this.options.onSelectToggle?.(dbId, model);
                    break;
                case "isolate":
                    this.options.onIsolate?.(dbId, model);
                    break;
                case "showAll":
                    this.options.onShowAll?.(dbId, model);
                    break;
                case "focus":
                    this.options.onFocus?.(dbId, model);
                    break;
                case "hide":
                    this.options.onHide?.(dbId, model);
                    break;
                case "show":
                    this.options.onShow?.(dbId, model);
                    break;
                case "toggleVisibility":
                    this.options.onToggleVisibility?.(dbId, model);
                    break;
            }
        }
    };


    /**
     * Click handler.
     */
    ViewerModelStructurePanel.prototype.toggleOverlayedSelection = function (dbId, model) {

        var modelSelection = this.selectedNodes[model.id];
        var index = modelSelection ? modelSelection.indexOf(dbId) : -1;
        this._ignoreScroll = true;
        this.options.onToggleOverlayedSelection?.(dbId, model, index !== -1);
    };


    /**
     * Shift Click handlers
     */
    ViewerModelStructurePanel.prototype.toggleMultipleOverlayedSelection = function (dbId, model) {
        var modelSelection = this.selectedNodes[model.id];
        var index = modelSelection ? modelSelection.indexOf(dbId) : -1;
        if (index === -1) {
            if (!modelSelection) {
                modelSelection = this.selectedNodes[model.id] = [];
            }
            modelSelection.push(dbId);
        } else {
            modelSelection.splice(index, 1);
        }

        if (this.options.onToggleMultipleOverlayedSelection) {
            var selection = [];
            for (var modelId in this.selectedNodes) {
                if (Object.prototype.hasOwnProperty.call(this.selectedNodes, modelId)) {
                    var ids = this.selectedNodes[modelId];
                    selection.push({
                        modelId,
                        ids: ids
                    });
                }
            }
            this.options.onToggleMultipleOverlayedSelection(selection);
        }

        this._ignoreScroll = true;

    };

    /**
     * @private
     */
    ViewerModelStructurePanel.prototype.ctrlDown = function (event) {
        return (this.isMac && event.metaKey) || (!this.isMac && event.ctrlKey);
    };

    /**
     * 
     * @param {*} text 
     * 
     * @returns Array with objects containing { delegate:Delegate, ids:Array }
     */
    function filterIds(text) {

        var tree = this.tree;
        var searchTerm = text.toLowerCase();
        var result = [];

        tree.forEachDelegate(function (delegate) {
            var rootId = delegate.getRootId();
            var ids = [];
            tree.iterate(delegate, rootId, function (id) {
                var idName = delegate.instanceTree && delegate.instanceTree.getNodeName(id);
                if (idName && idName.toLowerCase().indexOf(searchTerm) !== -1) {
                    ids.push(id);
                }
                return true;
            });

            result.push({ ids: ids, delegate: delegate });
        });

        avp.analytics.track('viewer.model_browser', {
            from: 'Panel',
            action: 'Search',
        });

        return result;
    }

