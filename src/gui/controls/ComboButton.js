
import { Button } from "./Button";
import { RadioButtonGroup } from "./RadioButtonGroup";
import { stringToDOM } from "../../globals";


    /**
     * ComboButton with submenu that can be added to toolbars.
     *
     * @param {string} [id] - The id for this comboButton. Optional.
     * @param {object} [options] - An optional dictionary of options.
     * @constructor
     * @augments Autodesk.Viewing.UI.Button
     * @alias Autodesk.Viewing.UI.ComboButton
     */
    export function ComboButton(id, options) {
        Button.call(this, id, options);

        this.arrowButton = new Button(id + 'arrow');
        this.arrowButton.addClass('adsk-button-arrow');
        this.arrowButton.removeClass('adsk-button');

        this.subMenu = new RadioButtonGroup(id + 'SubMenu');
        this.subMenu.addClass('toolbar-vertical-group');
        this.subMenu.setVisible(false);

        this.container.insertBefore(this.subMenu.container, this.container.firstChild);
        this.container.insertBefore(this.arrowButton.container, this.container.firstChild);

        var scope = this;
        this.arrowButton.onClick = function() {
            scope.subMenu.setVisible(!scope.subMenu.isVisible());
        };

        this.toggleFlyoutVisible = function() {
            scope.subMenu.setVisible(!scope.subMenu.isVisible());
        };

        this.onClick = function() {
            scope.subMenu.setVisible(!scope.subMenu.isVisible());
        };

        this.subMenuActiveButtonChangedHandler = function(event) {
            if (event.isActiveButton) {
                scope.setIcon(event.target.getActiveButton().iconClass);
                scope.setToolTip(event.target.getActiveButton().getToolTip());
                scope.setState(Button.State.ACTIVE);
                scope.onClick = event.button.onClick;
            }
            else {
                scope.setState(Button.State.INACTIVE);
            }
        };

        this.subMenu.addEventListener(RadioButtonGroup.Event.ACTIVE_BUTTON_CHANGED, this.subMenuActiveButtonChangedHandler);

        // put up an invisible div to catch click-off close submenu
        var clickOff = stringToDOM('<div class="clickoff" style="position:fixed; top:0; left:0; width:100vw; height:100vh;"></div>');
        this.subMenu.container.insertBefore(clickOff, this.subMenu.container.firstChild);
        clickOff.addEventListener("click", function(e) {
            scope.subMenu.setVisible(false);
            e.stopPropagation();
        });

    }

    ComboButton.prototype = Object.create(Button.prototype);
    ComboButton.prototype.constructor = ComboButton;


    /**
     * Adds a new control to the combo fly-out.
     *
     * @param {Autodesk.Viewing.UI.Button} button
     *
     * @alias Autodesk.Viewing.UI.ComboButton#addControl
     */
    ComboButton.prototype.addControl = function(button) {
    
        this.subMenu.addControl(button);
        button.addEventListener(Button.Event.CLICK, this.toggleFlyoutVisible);
    };

    /**
     * Removes a control from the combo fly-out.
     *
     * @param {Autodesk.Viewing.UI.Button} button
     *
     * @alias Autodesk.Viewing.UI.ComboButton#removeControl
     */
    ComboButton.prototype.removeControl = function(button) {

        button.removeEventListener(Button.Event.CLICK, this.toggleFlyoutVisible);
    };

    /**
     * Sets the state of this combo button.
     *
     * @param {Autodesk.Viewing.UI.Button.State} state - The state.
     *
     * @alias Autodesk.Viewing.UI.ComboButton#setState
     */
    ComboButton.prototype.setState = function(state) {

        //Overloaded to inactivate children when the parent is inactivated
        if (state === Button.State.INACTIVE) {
            var ab = this.subMenu.getActiveButton();
            if (ab) {
                ab.setState(Button.State.INACTIVE);
            }
        }

        //Also call super
        Button.prototype.setState.call(this, state);
    };

    /**
     * Copies tooltip (if any), icon and click handler into an internal attribute.
     * Can be restored through {@link #restoreDefault}.
     *
     * @alias Autodesk.Viewing.UI.ComboButton#saveAsDefault
     */
    ComboButton.prototype.saveAsDefault = function() {
        this.defaultState = {};
        // Save tooltip
        if (this._toolTipElement && this._toolTipElement.getAttribute("tooltipText")) {
            this.defaultState.tooltip = this._toolTipElement.getAttribute("tooltipText");
        }
        // Save icon
        this.defaultState.icon = this.iconClass;
        // Save click handler
        this.defaultState.onClick = this.onClick;
    };

    /**
     * Restores visual settings previously stored through {@link #saveAsDefault}.
     *
     * @alias Autodesk.Viewing.UI.ComboButton#restoreDefault
     */
    ComboButton.prototype.restoreDefault = function() {
        if (!this.defaultState) return;
        if (this.defaultState.tooltip) {
            this.setToolTip(this.defaultState.tooltip);
        }
        if (this.defaultState.icon) {
            this.setIcon(this.defaultState.icon);
        }
        this.onClick = this.defaultState.onClick; // No check on this one.
        this.setState(Button.State.INACTIVE);
    };

