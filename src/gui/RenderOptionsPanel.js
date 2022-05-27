
import { DockingPanel } from "./DockingPanel";
import * as et from "../application/EventTypes";
import { isIE11 } from "../compat";
import { OptionSlider, OptionCheckbox, OptionDropDown } from "./CommonWidgets";
import { LightPresets } from "../application/LightPresets";


/** @constructor */
export function RenderOptionsPanel(viewer) {
    var self = this;
    this.viewer = viewer;
    this.setGlobalManager(viewer.globalManager);
    
    DockingPanel.call(this, viewer.container, 'RenderOptionsPanel', 'Rendering Options');

    let _document = this.getDocument();
    this.table = _document.createElement("table");
    this.table.className = "adsk-lmv-tftable";

    this.tbody = _document.createElement("tbody");
    this.table.appendChild(this.tbody);

    // Create the scroll container.  Adjust the height so the scroll container does not overlap
    // the resize handle.  50px accounts for the titlebar and resize handle.
    //
    this.createScrollContainer({heightAdjustment:70});

    this.scrollContainer.appendChild(this.table);

    this.container.style.width  = "320px";
    this.container.style.top    = "260px";
    this.container.style.left   = "220px"; // just needs an initial value dock overrides value
    this.container.style.height = "460px";
    this.container.dockRight = true;

    this.saoToggle = new OptionCheckbox("AO Enabled", this.tbody, true);
    this.saoToggle.setGlobalManager(this.globalManager);
    this.addEventListener(this.saoToggle, "change", function(e) {
        var enable = self.saoToggle.checked;
        viewer.prefs.set("ambientShadows", enable);
        viewer.setQualityLevel(enable, viewer.impl.renderer().settings.antialias);
    });

    this.saoRadius = new OptionSlider("AO Radius", 0, 200, this.tbody);
    this.saoRadius.setGlobalManager(this.globalManager);
    this.saoRadius.setValue(10);
    this.saoRadius.sliderElement.step = this.saoRadius.stepperElement.step = 0.01;
    this.addEventListener(this.saoRadius, "change", function(e) {
        viewer.impl.renderer().setAOOptions(parseFloat(self.saoRadius.value), parseFloat(self.saoIntensity.value));
        viewer.impl.renderer().composeFinalFrame();
    });

    this.saoIntensity = new OptionSlider("AO Intensity", 0, 3, this.tbody);
    this.saoIntensity.setGlobalManager(this.globalManager);
    this.saoIntensity.setValue(0.4);
    this.saoIntensity.sliderElement.step = this.saoIntensity.stepperElement.step = 0.01;
    this.addEventListener(this.saoIntensity, "change", function(e) {
        viewer.impl.renderer().setAOOptions(parseFloat(self.saoRadius.value), parseFloat(self.saoIntensity.value));
        viewer.impl.renderer().composeFinalFrame();
    });

    this.groundShadowAlpha = new OptionSlider("Shadow Alpha", 0, 2, this.tbody);
    this.groundShadowAlpha.setGlobalManager(this.globalManager);
    this.groundShadowAlpha.setValue(1.0);
    this.groundShadowAlpha.sliderElement.step = this.groundShadowAlpha.stepperElement.step = 0.1;
    this.addEventListener(this.groundShadowAlpha, "change", function(e) {
        viewer.setGroundShadowAlpha(parseFloat(self.groundShadowAlpha.value));
    });

    this.groundShadowColor = new OptionCheckbox("Shadow Color", this.tbody);
    this.groundShadowColor.setGlobalManager(this.globalManager);
    if (!isIE11) {
        this.groundShadowColor.checkElement.value = "#000000"; // avoid warning
        this.groundShadowColor.checkElement.type = "color"; // hack
	}
    this.addEventListener(this.groundShadowColor, "change", function(e) {
        var colStr = self.groundShadowColor.checkElement.value;
        viewer.setGroundShadowColor(
            new THREE.Color(parseInt(colStr.substr(1,7), 16))
        );
    });

    this.groundReflectionAlpha = new OptionSlider("Reflection Alpha", 0, 2, this.tbody);
    this.groundReflectionAlpha.setGlobalManager(this.globalManager);
    this.groundReflectionAlpha.setValue(1.0);
    this.groundReflectionAlpha.sliderElement.step = this.groundReflectionAlpha.stepperElement.step = 0.1;
    this.addEventListener(this.groundReflectionAlpha, "change", function(e) {
        viewer.setGroundReflectionAlpha(parseFloat(self.groundReflectionAlpha.value));
    });

    this.groundReflectionColor = new OptionCheckbox("Reflection Color", this.tbody);
    this.groundReflectionColor.setGlobalManager(this.globalManager);
    if (!isIE11) {
        this.groundReflectionColor.checkElement.value = "#000000"; // avoid warning
        this.groundReflectionColor.checkElement.type = "color"; // hack
	}
    this.addEventListener(this.groundReflectionColor, "change", function(e) {
        var colStr = self.groundReflectionColor.checkElement.value;
        viewer.setGroundReflectionColor(
            new THREE.Color(parseInt(colStr.substr(1,7), 16))
        );
    });

    var env_list = [];
    for (var i=0; i<LightPresets.length; i++) {
        env_list.push(LightPresets[i].name);
    }

    this.envSelect = new OptionDropDown("Environment", this.tbody, env_list, viewer.impl.currentLightPreset());
    this.envSelect.setGlobalManager(this.globalManager);

    this.addEventListener(this.envSelect, "change", function(e) {
        var chosen = self.envSelect.selectedIndex;
        viewer.setLightPreset(chosen);
    });


    var initialTonemapMethod = viewer.impl.renderer().getToneMapMethod();

    this.toneMapMethod = new OptionDropDown("Tonemap Method", this.tbody,
        ["None",
         "Canon-Lum",
         "Canon-RGB"
         ],
        initialTonemapMethod);
    this.toneMapMethod.setGlobalManager(this.globalManager);

    this.addEventListener(this.toneMapMethod, "change", function() {
        // NOTE: Changing between Canon-Lum and Canon-RGB will yield no results
        // TODO: Add mechanism to make a change in those values effective in the material.
        // Best way to test this (for now) is to add an Environment with the desired toneMap value
        var method = self.toneMapMethod.selectedIndex;
        viewer.impl.setTonemapMethod(method);
    });

    this.exposureBias = new OptionSlider("Exposure Bias", -30.0, 30.0, this.tbody);
    this.exposureBias.setGlobalManager(this.globalManager);
    this.exposureBias.setValue(viewer.impl.renderer().getExposureBias());
    this.exposureBias.sliderElement.step = this.exposureBias.stepperElement.step = 0.1;
    this.addEventListener(this.exposureBias, "change", function(e) {
        viewer.impl.setTonemapExposureBias(self.exposureBias.value, self.whiteScale.value);
    });
    this.exposureBias.setDisabled(initialTonemapMethod == 0);

    this.whiteScale = new OptionSlider("Light Intensity", -5.0, 20.0, this.tbody);
    this.whiteScale.setGlobalManager(this.globalManager);
    var intensity = 0.0;
    if (viewer.impl.dir_light1) {
        if (viewer.impl.dir_light1.intensity != 0)
            intensity = Math.log(viewer.impl.dir_light1.intensity)/Math.log(2.0);
        else
            intensity = -1e-20;
    }
    this.whiteScale.setValue(intensity);
    this.whiteScale.sliderElement.step = this.whiteScale.stepperElement.step = 0.1;
    this.addEventListener(this.whiteScale, "change", function(e) {
        viewer.impl.dir_light1.intensity = Math.pow(2.0,self.whiteScale.value);
        viewer.impl.setTonemapExposureBias(self.exposureBias.value, self.whiteScale.value);
    });

    // 10-200mm lens range:
    this.fovAngle = new OptionSlider("FOV-degrees", 6.88, 100, this.tbody);
    this.fovAngle.setGlobalManager(this.globalManager);
    this.fovAngle.setValue(viewer.getFOV());
    this.addEventListener(this.fovAngle, "change", function(e) {
        viewer.setFOV(parseFloat(self.fovAngle.value));
    });

    // progressive update rate
    this.frameRate = new OptionSlider("Frame rate:", 1, 100, this.tbody);
    this.frameRate.setGlobalManager(this.globalManager);
    this.frameRate.setValue(viewer.impl.getFrameRate());
    this.frameRate.sliderElement.step = this.frameRate.stepperElement.step = 1;
    this.addEventListener(this.frameRate, "change", function(e) {
        viewer.impl.setFrameRate(self.frameRate.value);
    });

    this.addEventListener(this.viewer, et.CAMERA_CHANGE_EVENT, function(evt) {
        var myFov = parseFloat(self.fovAngle.value);
        var camFov = viewer.getFOV();

        if (myFov != camFov)
            self.fovAngle.setValue(camFov);
    });

    this.addEventListener(this.viewer, et.RENDER_OPTION_CHANGED_EVENT, function(e) {
        self.syncUI();
    });


    this.addEventListener(this.viewer, et.VIEWER_STATE_RESTORED_EVENT, function (event) {
        self.syncUI();
    });

    this.addVisibilityListener(function (show) {
        show && self.resizeToContent();
    });
}

RenderOptionsPanel.prototype = Object.create(DockingPanel.prototype);
RenderOptionsPanel.prototype.constructor = RenderOptionsPanel;

/**
 * Returns the width and height to be used when resizing the panel to the content.
 *
 * @returns {{height: number, width: number}}
 */
RenderOptionsPanel.prototype.getContentSize = function () {
    return {height: this.table.clientHeight + 75, width: this.table.clientWidth};
};

RenderOptionsPanel.prototype.syncUI = function() {
    var impl = this.viewer.impl;

    var intensity = 0.0;
    if (impl.dir_light1) {
        if (impl.dir_light1.intensity != 0)
            intensity = Math.log(impl.dir_light1.intensity)/Math.log(2.0);
        else
            intensity = -1e-20;
    }
    this.whiteScale.setValue(intensity);

    this.exposureBias.setValue(impl.renderer().getExposureBias());

    var method = impl.renderer().getToneMapMethod();
    this.toneMapMethod.setSelectedIndex(method);
    this.envSelect.setSelectedIndex(impl.currentLightPreset());

    this.exposureBias.setDisabled(method == 0);
    this.saoToggle.setValue(impl.renderer().getAOEnabled());
    this.saoRadius.setDisabled(!impl.renderer().getAOEnabled());
    this.saoIntensity.setDisabled(!impl.renderer().getAOEnabled());

    this.saoRadius.setValue(impl.renderer().getAORadius());
    this.saoIntensity.setValue(impl.renderer().getAOIntensity());

    // NOTE_NOP: no sync value because no get methods, not necessary to implement
    this.groundShadowAlpha.setDisabled(!this.viewer.prefs.get("groundShadow"));
    this.groundShadowColor.setDisabled(!this.viewer.prefs.get("groundShadow"));
    this.groundReflectionAlpha.setDisabled(!this.viewer.prefs.get("groundReflection"));
    this.groundReflectionColor.setDisabled(!this.viewer.prefs.get("groundReflection"));

    this.fovAngle.setValue(this.viewer.getFOV());
};

RenderOptionsPanel.prototype.uninitialize = function () {
    DockingPanel.prototype.uninitialize.call(this);

    this.table = null;
    this.tbody = null;
    this.saoToggle = null;
    this.saoRadius = null;
    this.saoIntensity = null;
    this.groundShadowAlpha = null;
    this.envSelect = null;
    this.toneMapMethod = null;
    this.exposureBias = null;
    this.whiteScale = null;
    this.fovAngle = null;
    this.viewer = null;
};

