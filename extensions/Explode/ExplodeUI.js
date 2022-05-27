import { isIOSDevice, isIE11, isAndroidDevice } from "../../src/compat";
import { Button } from "../../src/gui/controls/Button";
import { stringToDOM } from "../../src/globals";
import { EXPLODE_CHANGE_EVENT } from "../../src/application/EventTypes";
import { logger } from "../../src/logger/Logger";

export class ExplodeUI {
    /**
     * Create toolbar button, explode slider and all other UI.
     *
     * @param ext
     */
    constructor(ext) {
        this.ext = ext;
        const viewer = ext.viewer;

        const explodeButton = new Button('toolbar-explodeTool');
        explodeButton.setIcon("adsk-icon-explode");
        explodeButton.setToolTip("Explode model");
        viewer.modelTools.addControl(explodeButton);

        const htmlString = '<div class="docking-panel docking-panel-container-solid-color-b explode-submenu" style="display:none"><input class="explode-slider" type="range" min="0" max="1" step="0.01" value="0"/></div>';

        let explodeSubmenu = stringToDOM(htmlString);

        let parentDom;
        const _document = this.ext.getDocument();
        // range input not draggable on touch devices when nested under button
        parentDom = _document.querySelector("#toolbar-explodeTool").parentNode;
        if (isIOSDevice()) {
            explodeSubmenu.classList.add("ios");
        } else if (isAndroidDevice()) {
            explodeSubmenu.classList.add("android");
        }
        parentDom.appendChild(explodeSubmenu);
        explodeButton.addEventListener(Autodesk.Viewing.UI.Control.Event.VISIBILITY_CHANGED, function(event) {
            if (event.isVisible) {
                explodeSubmenu.style.display = "";
            } else {
                explodeSubmenu.style.display = "none";
            }
        });

        const slider = explodeSubmenu.querySelector(".explode-slider");
        slider.addEventListener(isIE11 ? "change" : "input", function() {
            ext.setScale(slider.value);
        });

        if (isIE11) {
            // In IE11, the input type=range has a weird default layout...
            slider.style['padding-top'] = '0';
            slider.style['padding-bottom'] = '0';
            slider.style['margin-top'] = '10px';
        }

        explodeSubmenu.onclick = function (event) {
            event.stopPropagation();
        };

        // hack to disable tooltip
        var tooltip = explodeButton.container.querySelector(".adsk-control-tooltip");

        explodeButton.onClick = function() {
            
            if (ext.isActive()) {
                ext.deactivate();
            } else {
                ext.activate();
                
                // Track tool change only when interacted by the end user.
                logger.track({category: 'tool_changed', name: 'explode'});
            }
        };

        // Keep references
        this._slider = slider;
        this._explodeButton = explodeButton;
        this._explodeSubmenu = explodeSubmenu;
        this._tooltip = tooltip;

        // backwards compatibility references
        viewer.explodeSlider = slider;
        viewer.explodeSubmenu = explodeSubmenu;

        this._onExplode = this._onExplode.bind(this);
    }

    activate() {
        this._explodeSubmenu.style.display = "";
        this._explodeButton.setState(Button.State.ACTIVE);
        this._tooltip.style.display = "none";
        
        // Sync slider with viewer's explode value
        let lmvExplodeValue = this.ext.getScale();
        this._slider.value = lmvExplodeValue;

        // Update UI only when the event is fired
        this.ext.viewer.addEventListener(EXPLODE_CHANGE_EVENT, this._onExplode);
    }

    deactivate() {
        this._explodeButton.setState(Button.State.INACTIVE);
        this._hideSlider(this);

        // Update UI only when the event is fired
        this.ext.viewer.removeEventListener(EXPLODE_CHANGE_EVENT, this._onExplode);
    }

    destroy() {
        const viewer = this.ext.viewer;

        // early bail out if the UI hasn't actually been initialized.
        if (!this._slider) {
            return;
        }

        if (this._explodeButton) {
            this._explodeButton.removeFromParent();
        }

        // Reset references
        this._slider = null;
        this._explodeButton = null;
        this._explodeSubmenu = null;
        this._tooltip = null;

        // Reset backwards compatibility references
        viewer.explodeSlider = null;
        viewer.explodeSubmenu = null;
    }

    setUIEnabled(enable) {
        if (this._explodeButton) {
            if (enable) {
                // Re-enable button
                this._explodeButton.setState(Autodesk.Viewing.UI.Button.State.INACTIVE);

                if (this._wasActive) {
                    this.ext.activate();
                }
            } else {
                this._wasActive = this.ext.isActive();

                // We don't just use deactivate() because you want to keep the explode scale.
                this._hideSlider(this);

                // Disable button
                this._explodeButton.setState(Autodesk.Viewing.UI.Button.State.DISABLED);
            }
        }
    }

    _hideSlider() {
        this._slider.parentNode.style.display = "none";
        this._tooltip.style.display = "";
    }

    /**
     * @param event
     * @private
     */
     _onExplode(event) {
        this._slider.value = event.scale;
    }
}
