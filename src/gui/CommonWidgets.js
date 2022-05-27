
import { EventDispatcher } from "../application/EventDispatcher";
import i18n from "i18next";
import { isTouchDevice, isIE11 } from "../compat";
import { GlobalManagerMixin } from "../application/GlobalManagerMixin";

const Hammer = require('../../thirdparty/hammer/hammer.js');

    /** @constructor */
    export function OptionSlider(caption, min, max, parentTbody, options) {

        var self = this;
        this.tbody = parentTbody;

        var atIndex = options && options.insertAtIndex ? options.insertAtIndex : -1;
        this.hideStepper = options && options.hideStepper;
        var hideCaption = options && options.hideCaption;
        this.sliderRow = this.tbody.insertRow(atIndex);
        this.sliderRow.classList.add("switch-slider-row");

        var _document = this.getDocument();
        var cell = this.sliderRow.insertCell(0);
        this.caption = _document.createElement("div");
        this.caption.setAttribute("data-i18n", caption);
        this.caption.textContent = i18n.t(caption);
        if (hideCaption) this.caption.style.display = "none";
        cell.appendChild(this.caption);

        cell = this.sliderRow.insertCell(1);
        this.sliderElement = _document.createElement("input");
        this.sliderElement.type = "range";
        this.sliderElement.id = caption + "_slider";
        this.sliderElement.min = min;
        this.sliderElement.max = max;
        this.sliderElement.style.width = "85%";
        cell.appendChild(this.sliderElement);

        cell = this.sliderRow.insertCell(2);
        
        this.stepperElement = _document.createElement("input");
        this.stepperElement.type = "number";
        this.stepperElement.id = caption + "_stepper";
        this.stepperElement.min = min;
        this.stepperElement.max = max;
        this.stepperElement.step = 1;
        this.stepperElement.style.width = "64px";
        if(this.hideStepper) this.stepperElement.style.display = "none";
        cell.appendChild(this.stepperElement);

        this.blockEvent = false;

        this.stepperElement.addEventListener("change",
            function (e) {
                if (e.target != self.sliderElement)
                    self.sliderElement.value = self.stepperElement.value;
                self.fireChangeEvent();
            }, false);

        function changeHandler(e) {
            if (e.target != self.stepperElement)
                self.stepperElement.value = self.sliderElement.value;
            self.fireChangeEvent();
        }

        this.sliderElement.addEventListener("change", changeHandler, false);
        this.sliderElement.addEventListener("input", changeHandler, false);
    }

    OptionSlider.prototype.constructor = OptionSlider;
    EventDispatcher.prototype.apply(OptionSlider.prototype);

    OptionSlider.prototype.fireChangeEvent = function () {
        if (!this.blockEvent) {
            this.value = this.sliderElement.value;
            var e = new CustomEvent("change", {
                detail: {
                    target: this,
                    value: this.sliderElement.value
                }
            });
            this.dispatchEvent(e);
        }
    };

    OptionSlider.prototype.setValue = function (v) {
        this.blockEvent = true;
        this.value = v;
        this.sliderElement.value = v;
        this.stepperElement.value = v;
        this.blockEvent = false;
    };

    OptionSlider.prototype.setDisabled = function (v) {
        this.sliderElement.disabled = v;
        this.stepperElement.disabled = v;
        this.caption.disabled = v;
    };

    GlobalManagerMixin.call(OptionSlider.prototype);

//==========================================================================================================
//==========================================================================================================
//==========================================================================================================

    /** @constructor */
    export function OptionCheckbox(caption, parentTbody, initialState, description, globalManager, options) {
        
        var self = this;
        this.tbody = parentTbody;

        var atIndex = options && options.insertAtIndex ? options.insertAtIndex : -1;
        this.sliderRow = this.tbody.insertRow(atIndex);
        this.sliderRow.classList.add("switch-slider-row");

        var _document = this.getDocument();
        var cell = this.sliderRow.insertCell(0);
        this.caption = _document.createElement("div");
        this.caption.setAttribute("data-i18n", caption);
        this.caption.textContent = i18n.t(caption);

        cell.appendChild(this.caption);

        cell = this.sliderRow.insertCell(1);

        if(description) {
          this.description = _document.createElement("div");
          this.description.setAttribute("data-i18n", description);
          this.description.textContent = i18n.t(description);

          cell.appendChild(this.description);
          cell = this.sliderRow.insertCell(2);
        }

        var label = _document.createElement("label");
        label.classList.add("switch");

        this.checkElement = _document.createElement("input");
        this.checkElement.type = "checkbox";
        this.checkElement.id = caption + "_check";
        this.checkElement.checked = initialState;
        label.appendChild(this.checkElement);

        var div = _document.createElement("div");
        div.classList.add("slider");
        label.appendChild(div);

        cell.appendChild(label);

        this.blockEvent = false;
        this.checked = initialState;

        this.checkElement.addEventListener("change",
            function (e) {
                self.fireChangeEvent();
            }, false);

        if (isTouchDevice()) {
            // Tap on a checkbox is handled by the browser so we don't hav to do anything for it.

            this.sliderRowHammer = new Hammer.Manager(this.sliderRow, {
                recognizers: [[Hammer.Tap]],
                handlePointerEventMouse: false,
                inputClass: isIE11 ? Hammer.PointerEventInput : Hammer.TouchInput
            });
            this.sliderRowHammer.on("tap", function (e) {
                e.preventDefault();
                //e.stopPropagation(); // Doesn't exist for tap events.
                e.target.click();
            });
        }

        this.checkElement.addEventListener("click", function (event) {
            event.stopPropagation();
        }, false);

        // Make the slider row clickable as well so that when
        // clicking on the row, the checkbox is toggled.
        this.sliderRow.addEventListener("click",
            function (e) {
                if (!self.checkElement.disabled) {
                    self.checkElement.checked = !self.checkElement.checked;
                    self.fireChangeEvent();
                }
            }, false);
    }

    OptionCheckbox.prototype.constructor = OptionCheckbox;
    EventDispatcher.prototype.apply(OptionCheckbox.prototype);
    GlobalManagerMixin.call(OptionCheckbox.prototype);

    OptionCheckbox.prototype.fireChangeEvent = function () {
        if (!this.blockEvent) {
            this.checked = this.checkElement.checked;
            var e = new CustomEvent("change", {
                detail: {
                    target: this,
                    value: this.checkElement.checked
                }
            });
            this.dispatchEvent(e);
        }
    };


    OptionCheckbox.prototype.setChecked = function (check) {
        if(this.checkElement.checked != check)
        {
            this.checkElement.checked = check;
            this.fireChangeEvent();
        }
    };

    OptionCheckbox.prototype.setValue = function (v) {
        this.blockEvent = true;
        this.checked = v;
        this.checkElement.checked = v;
        this.blockEvent = false;
    };

    OptionCheckbox.prototype.getValue = function () {
        var v = this.checkElement.checked;
        return v;
    };


    OptionCheckbox.prototype.setDisabled = function (v) {
        this.checkElement.disabled = v;
        this.caption.disabled = v;
    };

    OptionCheckbox.prototype.setVisibility = function (isVisible) {
        if (isVisible)
            this.sliderRow.style.display = "table-row";
        else
            this.sliderRow.style.display = "none";
    };


//==========================================================================================================
//==========================================================================================================
//==========================================================================================================    
    /** @constructor */
    export function OptionLabel(caption, parentTbody, globalManager, options) {


        this.tbody = parentTbody;

        var atIndex = options && options.insertAtIndex ? options.insertAtIndex : -1;
        this.sliderRow = this.tbody.insertRow(atIndex);

        var _document = this.getDocument();
        var cell = this.sliderRow.insertCell(0);
        this.caption = _document.createElement("div");
        this.caption.setAttribute("data-i18n", caption);
        this.caption.textContent = i18n.t(caption);
        cell.appendChild(this.caption);

        cell.colSpan = "3";

        this.blockEvent = false;

        /**
         * Removes the label from DOM.
         */
        this.removeFromParent = function() {
            this.tbody.removeChild(this.sliderRow);
            this.tbody = null;
            this.sliderRow = null;
            this.caption = null;
        };
    }

    GlobalManagerMixin.call(OptionLabel.prototype);

//==========================================================================================================
//==========================================================================================================
//==========================================================================================================
     
    export function OptionButton(caption, parentTbody, globalManager, options) {


        this.tbody = parentTbody;

        var atIndex = options && options.insertAtIndex ? options.insertAtIndex : -1;
        this.sliderRow = this.tbody.insertRow(atIndex);

        this.sliderRow.insertCell(); // discard first
        var cell = this.sliderRow.insertCell();
        this.sliderRow.insertCell(); // discard third

        var _document = this.getDocument();
        this.caption = _document.createElement("div");
        this.caption.setAttribute("data-i18n", caption);
        this.caption.textContent = i18n.t(caption);
        this.caption.classList.add('adsk-button');
        this.caption.classList.add('table-button');
        cell.appendChild(this.caption);


        /**
         * Removes the button from DOM.
         */
        this.removeFromParent = function() {
            this.tbody.removeChild(this.sliderRow);
            if (this._onClick) {
                this.caption.removeEventListener('click', this._onClick);
                this._onClick = null;
            }
            this.tbody = null;
            this.sliderRow = null;
            this.caption = null;
        };

        /**
         * Registers a click callback.
         * @param {function} onClick - click function callback.
         */
        this.setOnClick = function(onClick) {
            this._onClick = onClick;
            this.caption.addEventListener('click', onClick, false);
        };
    }

    GlobalManagerMixin.call(OptionButton.prototype);

//==========================================================================================================
//==========================================================================================================
//==========================================================================================================

    export function OptionDropDown(caption, parentTbody, items, initialItemIndex, envtab, globalManager, options) {


        var self = this;
        this.tbody = parentTbody;

        var atIndex = options && options.insertAtIndex ? options.insertAtIndex : -1;
        this.sliderRow = this.tbody.insertRow(atIndex);

        var _document = this.getDocument();
        this.dropdownElement = _document.createElement("select");
        this.dropdownElement.id = caption + "_dropdown";
        this.dropdownElement.classList.add("option-drop-down");

        for (var i = 0; i < items.length; i++) {
            var item = _document.createElement("option");
            item.value = i;
            item.setAttribute("data-i18n", items[i]);
            item.textContent = i18n.t(items[i]);
            this.dropdownElement.add(item);
        }

        this.selectedIndex = this.dropdownElement.selectedIndex = initialItemIndex;
        
        var cell = this.sliderRow.insertCell(0);
        this.caption = _document.createElement("div");
        this.caption.setAttribute("data-i18n", caption);
        this.caption.textContent = i18n.t(caption);
        cell.appendChild(this.caption);

        if(envtab) {
                cell.colSpan = "2";

                this.sliderRow = this.tbody.insertRow(atIndex);
                cell = this.sliderRow.insertCell(0);
                cell.appendChild(this.dropdownElement);
                cell.colSpan = "2";
                this.dropdownElement.classList.add('tabcell');
        }
        else {
                cell = this.sliderRow.insertCell(1);
                cell.appendChild(this.dropdownElement);
        }

        cell.style.paddingLeft = (options && options.paddingLeft !== undefined ? options.paddingLeft : 5) + 'px';
        cell.style.paddingRight = (options && options.paddingRight !== undefined ? options.paddingRight : 5) + 'px';
        this.blockEvent = false;

        this.dropdownElement.addEventListener("change",
            function (e) {
                self.fireChangeEvent();
            }, false);
    }

    OptionDropDown.prototype.constructor = OptionDropDown;
    EventDispatcher.prototype.apply(OptionDropDown.prototype);


    OptionDropDown.prototype.setSelectedIndex = function (index) {
        this.blockEvent = true;
        this.selectedIndex = this.dropdownElement.selectedIndex = index;
        this.blockEvent = false;
    };

    OptionDropDown.prototype.setSelectedValue = function (value) {
        this.blockEvent = true;
        this.dropdownElement.selectedValue = value;
        this.selectedIndex = this.dropdownElement.selectedIndex;
        this.blockEvent = false;
    };

    OptionDropDown.prototype.fireChangeEvent = function () {
        if (!this.blockEvent) {
            this.selectedIndex = this.dropdownElement.selectedIndex;
            var e = new CustomEvent("change", {
                detail: {
                    target: this,
                    value: this.selectedIndex
                }
            });
            this.dispatchEvent(e);
        }
    };

    OptionDropDown.prototype.setDisabled = function (v) {
        this.dropdownElement.disabled = v;
        this.caption.disabled = v;
    };

    GlobalManagerMixin.call(OptionDropDown.prototype);

//==========================================================================================================
//==========================================================================================================
//==========================================================================================================

    /**
     * Creates a footer element to add to this DockingPanel. Footer provides a resize handler.
     * Call this method during initialize() if a standard title bar is desired, and then add it to an existing container.
     * @returns {HTMLElement} The created footer.
     */
    export function ResizeFooter(container, resizeCallback, globalManager) {

        this.resizeCallback = resizeCallback;
        var _document = this.getDocument();
        var footer = _document.createElement('div');
        footer.classList.add('docking-panel-footer');

        var resizer = _document.createElement("div");
        resizer.classList.add("docking-panel-footer-resizer");

        footer.appendChild(resizer);

        var iniUpdate = false;
        var iniPanelSize = container.getBoundingClientRect();
        var iniMousePosition = {x: 0, y: 0};

        var resizeOverlay = _document.createElement('div');
        resizeOverlay.classList.add('adsk-viewing-viewer');
        resizeOverlay.classList.add('docking-panel-resize-overlay');

        var onMouseDown = function(event) {
            iniUpdate = true;
            iniPanelSize = container.getBoundingClientRect();
            var _document = this.getDocument();
            _document.body.appendChild(resizeOverlay);

            this.addDocumentEventListener('touchmove', onMouseMove);
            this.addDocumentEventListener('touchcancel', onMouseUp);
            this.addDocumentEventListener('touchend', onMouseUp);
            this.addDocumentEventListener('mousemove', onMouseMove);
            this.addDocumentEventListener('mouseup', onMouseUp);

            event.preventDefault();
            event.stopPropagation();
        };
        onMouseDown = onMouseDown.bind(this);

        var onMouseUp = function(event) {
            var _document = this.getDocument();
            if (_document.body.contains(resizeOverlay)) {
                _document.body.removeChild(resizeOverlay);

                this.removeDocumentEventListener('touchmove', onMouseMove);
                this.removeDocumentEventListener('touchcancel', onMouseUp);
                this.removeDocumentEventListener('touchend', onMouseUp);
                this.removeDocumentEventListener('mousemove', onMouseMove);
                this.removeDocumentEventListener('mouseup', onMouseUp);

                event.preventDefault();
                event.stopPropagation();
            }
        };
        onMouseUp = onMouseUp.bind(this);

        var onMouseMove = function(event) {
            if (event.type === 'touchmove') {
                event.canvasX = event.touches[0].screenX;
                event.canvasY = event.touches[0].screenY;
            }
            if (iniUpdate) {
                iniUpdate = false;
                iniMousePosition.x = (event.canvasX || event.clientX);
                iniMousePosition.y = (event.canvasY || event.clientY);
            }

            var dx = (event.canvasX || event.clientX) - iniMousePosition.x;
            var dy = (event.canvasY || event.clientY) - iniMousePosition.y;

            var width = parseInt((iniPanelSize.width + dx));
            var height = parseInt((iniPanelSize.height + dy));

            container.style.width =  width + 'px';
            container.style.height = height + 'px';

            this.resizeCallback && this.resizeCallback(width, height);

            event.preventDefault();
            event.stopPropagation();
        };
        onMouseMove = onMouseMove.bind(this);

        resizer.addEventListener('touchstart', onMouseDown);
        resizer.addEventListener('mousedown', onMouseDown);

        container.style.resize = 'none';
        container.appendChild(footer);

        this.footer = footer;
        this.resizer = resizer;
    }

    GlobalManagerMixin.call(ResizeFooter.prototype);

//==========================================================================================================
//==========================================================================================================
//==========================================================================================================

    export function OptionRow(caption, parentTbody, description, globalManager, options) {

        this.tbody = parentTbody;

        var atIndex = options && options.insertAtIndex ? options.insertAtIndex : -1;
        this.sliderRow = this.tbody.insertRow(atIndex);
        this.sliderRow.classList.add("switch-slider-row");
        // this.sliderRow.classList.add("switch-slider-row");

        var _document = this.getDocument();
        var cell = this.sliderRow.insertCell(0);
        this.caption = _document.createElement("div");
        this.caption.setAttribute("data-i18n", caption);
        this.caption.textContent = i18n.t(caption);

        cell.appendChild(this.caption);

        cell = this.sliderRow.insertCell(1);

        if(description) {
            this.description = _document.createElement("div");
            this.description.setAttribute("data-i18n", description);
            this.description.textContent = i18n.t(description);

            cell.appendChild(this.description);
            cell = this.sliderRow.insertCell(2);
        }
    }

    GlobalManagerMixin.call(OptionRow.prototype);


//==========================================================================================================
//==========================================================================================================
//==========================================================================================================

    export class SimpleList {

        constructor(parentDiv, renderListItemFn, onClick) {
            
            this._parentDiv = parentDiv;
            this._renderRowFn = renderListItemFn;
            this._onClickFn = onClick;
            this._onRowClick = this._onRowClick.bind(this);

            const _document = this.getDocument();
            const container = _document.createElement('div');
            container.classList.add('settings-container');

            this._parentDiv.appendChild(container);
            this._myContainer = container;
            this._myContainer.addEventListener("click", this._onRowClick, { capture: true });

            const envRow = _document.createElement('div');
            envRow.classList.add('settings-table');
            this._rowsContainer = envRow;
            container.appendChild(envRow);
        }

        setData(items, selectionIndex) {
            this._removeAllRows();
            this._items = items;
            for (let i = 0; i < items.length; ++i) {
                this._addRow(i);
            }
            this._updateSelection(selectionIndex);
        }

        // Removes from DOM.
        removeFromParent() {
            this._myContainer.removeEventListener("click", this._onRowClick, { capture: true });
            this._removeAllRows();
            this._parentDiv.removeChild(this._myContainer);
            this._parentDiv = null;
            this._myContainer = null;
            this._rowsContainer = null;
            this._onClickFn = null;
            this._items = null;
        }

        // @private
        _addRow(index) {

            const item = this._items[index];
            const _document = this.getDocument();
            const cell = _document.createElement("div");

            this._renderRowFn(cell, item, { domDocument: _document });

            cell.setAttribute('data-index', index);
            this._rowsContainer.appendChild(cell);
        }

        // @private
        _removeAllRows() {
            var rows = this._rowsContainer.children;
            while (rows.length) {
                this._rowsContainer.removeChild(rows[0]);
            }
        }

        // @private
        _updateSelection(index) {
            const cells = this._rowsContainer.children;
            for(let i =0; i < cells.length; i++) {
                const cell = cells[i];
                if(i === index) {
                    cell.classList.add("border-select");
                } else {
                    cell.classList.remove("border-select");
                }
            }
        }

        /**
         * Click handler, routes call to method provided.
         * @private
         */
        _onRowClick(event) {
            var domElem = event.target;
            var attrValue;

            // find the actual row element by traversing up
            while (domElem !== this._myContainer) {
                attrValue = domElem.getAttribute('data-index');
                if (attrValue) {
                    break;
                }
                domElem = domElem.parentNode;
            }
            if (attrValue) {
                var index = parseInt(attrValue);
                this._onClickFn(index);
            }
        }

    }

    GlobalManagerMixin.call(SimpleList.prototype);