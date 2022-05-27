
import { ObjectAssign, getGlobal } from "../compat";

export let DefaultLightPreset = 1; // "Sharp Highlights"
export let DefaultLightPreset2d = 0;   // "Simple Grey"
export let DefaultToneMapMethod = 1;

    export let BackgroundPresets = {
        "Fusion Grey":      [230, 230, 230, 150, 150, 150],
        "Sky Blue":         [226, 244, 255, 156, 172, 180],
        "Snow":             [181, 186, 199, 181, 186, 199],
        "Midnight":         [ 41,  76, 120,   1,   2,   3],
        "White":            [255, 255, 255, 255, 255, 255],
        "AutoCADModel":     [ 30,  40,  48,  30,  40,  48],
        "Dark Grey":        [ 51,  51,  51,  51,  51,  51],
        "Dark Sky":         [ 51,  51,  51,  51,  51,  51],
        "Infinity Pool":    [255, 255, 255, 255, 255, 255],
        "Tranquility":      [  0,  84, 166,   0,  84, 166],
        "Grey Room":        [129, 129, 129, 129, 129, 129],
        "Photo Booth":      [237, 237, 237, 237, 237, 237],
        "RaaS SBS":         [  1,   1,   1,  90,  90,  90],
        "Plaza":            [ 79, 102, 130,  79, 102, 130],
        "Field":            [202, 226, 252, 202, 201, 190],
        "Boardwalk":        [216, 230, 248, 230, 228, 220],

        //This will get modified when the user changes the background
        //using the color picker.
        "Custom":           [230, 230, 230, 150, 150, 150]
    };

    var bg = BackgroundPresets;

    export let LightPresets = [
        //Notes: tonemap = which tone map method to use. Any tonemap method other than zero will cause colors to be linearized before use.
        //              0 = None, 1 = Prism Cannon-Lum (color preserving), 2 = OGC Cannon RGB (non-color preserving)
        //       exposure = exponential bias to use as pre-tonemap multiplier for all rendered colors, including background
        //       lightMultiplier = linear scale of direct light intensity (diffuse only, not ambient)
        //       bgColorGradient = which background color preset to use as default for the environment map
        //       illuminance     = cosine-weighted integral of the upper-hemisphere (i.e., actual lux)

        //Image-based lighting from RaaS. Initial exposure is empirically obtained.
        //These do not normally require any extra lights, because they have the lights fully baked into
        //the environment maps.

        //Simple ***non-HDR*** environment.
        {
            name: "Simple Grey",    // localized in viewer-environments.loc.json
            path:null,
            tonemap:0,
            E_bias:0,
            directLightColor: [1.0, 0.84, 0.67],
            ambientColor:     [0.8*0.25, 0.9*0.25,  1.0*0.25],
            lightMultiplier: 1.0,
            bgColorGradient: bg["Fusion Grey"],
            darkerFade: false,
            rotation: 0.0
        },

        //Fusion Environments which require extra lights

        // The E_bias value for the Fusion render-space environments is setup such that
        // the default values match the preset values of brightness (in lux) and EV.
        // The EV value from Fusion follows the Canon standard for luminance and middle-gray
        // https://en.wikipedia.org/wiki/Exposure_value#EV_as_a_measure_of_luminance_and_illuminance [September 2015]
        //
        // Rationale (using the canon tonemap as a guide, based on documentation by Adam Arbree):
        // 1. BaseExposure (B) in the canon tonemap is the negative log2 luminance of the
        //    white point (W) so B = -log2(W)
        // 2. To match the target illuminance from Fusion, the environment needs
        //    to be scaled by the ratio between the target and its actual illuminance, thus
        //    S = target_illuminance / actual_illuminance
        // 3. Then by the definition of middle grey W = L / (0.18*S) where L is the middle grey
        //    luminance and 0.18 is the standard reflection of middle grey.
        // 4. As per the Wikipedia entry, we have L = 2^(EV-3)
        // 5. Putting this all together we have
        //      B = -log2( 2^(EV-3) / (0.18*S))
        //        = log2(0.18) + log2(S) – (EV – 3)
        //        = (3+log2(0.18)) – EV + log2(S)
        //        = 0.526069 – EV + log2(S)

        {
            name: "Sharp Highlights",    // localized in viewer-environments.loc.json
            path:"SharpHighlights",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            // illuminance currently is not used elsewhere in LMV, its effect is folded into E_bias.
            //illuminance: 1000.0,
            E_bias:-9.0, // EV 9.526, 1000.0 lux (target)
            directLightColor: [0.5,0.5,0.5],
            ambientColor: [0.25/8,0.25/8,0.25/8],
            lightMultiplier: 0.0,
            lightDirection: [0.5, -0.2, -0.06],
            bgColorGradient: bg["Photo Booth"],
            darkerFade: true,
            rotation: 0.0
        },

        {
            name: "Dark Sky",     // "Dark Sky", localized in viewer-environments.loc.json
            path:"DarkSky",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            E_bias:-1,
            directLightColor: [1,1,1],
            ambientColor: [0.25/8,0.25/8,0.25/8], //0.25 with gain of 0.125
            lightMultiplier: 1.0,
            lightDirection: [0.1, -0.55, -1.0],
            bgColorGradient: bg["Dark Sky"],
            darkerFade: false,
            rotation: 0.0
        },

        {
            name: "Grey Room",    // "Grey Room", localized in viewer-environments.loc.json
            path:"GreyRoom",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            E_bias:-1,
            directLightColor: [1,1,1],
            ambientColor: [0.25/8,0.25/8,0.25/8],
            lightMultiplier: 0.5,
            lightDirection: [0.1, -0.55, -1.0],
            bgColorGradient: bg["Grey Room"],
            darkerFade: true,
            rotation: 0.0
        },

        {
            name: "Photo Booth",     // "Photo Booth", localized in viewer-environments.loc.json
            path:"PhotoBooth",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            E_bias:0,
            directLightColor: [1,1,1],
            ambientColor: [0.25/8,0.25/8,0.25/8],
            lightMultiplier: 0.5,
            lightDirection: [0.1, -0.55, -1.0],
            bgColorGradient: bg["Photo Booth"],
            darkerFade: true,
            rotation: 0.0
        },

        {
            name: "Tranquility",     // "Tranquility", localized in viewer-environments.loc.json
            path:"TranquilityBlue",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            E_bias:-1,
            directLightColor: [1,1,1],
            ambientColor: [0.25/8,0.25/8,0.25/8],
            lightMultiplier: 0.5,
            lightDirection: [0.1, -0.55, -1.0],
            bgColorGradient: bg["Tranquility"],
            darkerFade: false,
            rotation: 0.0
        },

        {
            name: "Infinity Pool",     // "Infinity Pool", localized in viewer-environments.loc.json
            path: "InfinityPool",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            E_bias:-1,
            directLightColor: [1.0, 0.84, 0.67],
            ambientColor: [0.25/8,0.25/8,0.25/8],
            lightMultiplier: 0.5,
            lightDirection: [0.1, -0.55, -1.0],
            bgColorGradient: bg["Infinity Pool"],
            darkerFade: false,
            rotation: 0.0
        },

        // Non fusion environments

        //White background, no HDR -- for cases like SIM360 models
        {
            name: "Simple White",     //"Simple White", localized in viewer-environments.loc.json
            path:null,
            tonemap:0,
            E_bias:0,
            directLightColor: [1,1,1],
            ambientColor: [0.25, 0.25, 0.25],
            lightMultiplier: 1.0,
            bgColorGradient: bg["White"],
            saoRadius: 0.06,
            saoIntensity: 0.15,
            darkerFade: true,
            rotation: 0.0
        },
/*
        {
            name: "Simple Black",
            path:null,
            tonemap:0,
            E_bias:0,
            directLightColor: [1.0, 0.84, 0.67],
            ambientColor:     [0.8, 0.9,  1.0],
            lightMultiplier: 1.0,
            bgColorGradient: bg["AutoCADModel"],
            darkerFade: false
        },
  */
        //RaaS environments
        {
            name: "Riverbank",     // "Riverbank", localized in viewer-environments.loc.json
            path:"riverbank",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            E_bias:-5.7,
            directLightColor: [1,1,1],
            lightMultiplier: 0.0,
            bgColorGradient: bg["Sky Blue"],
            darkerFade: false,
            rotation: 0.0
        },

        {
            name: "Contrast",     // "Contrast", localized in viewer-environments.loc.json
            path:"IDViz",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            E_bias:0,
            directLightColor: [1,1,1],
            lightMultiplier: 0.0,
            bgColorGradient: bg["Midnight"],
            darkerFade: false,
            rotation: 0.0
        },

        {
            name: "Rim Highlights",     //  localized in viewer-environments.loc.json
            path:"RimHighlights",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            //illuminance: 1000.0,
            E_bias:-9.0, // EV 9.526, 1000.0 lux (target)
            directLightColor: [0.5,0.5,0.5],
            ambientColor: [0.25/8,0.25/8,0.25/8],
            lightMultiplier: 0.0,
            lightDirection: [0.35, -0.35, -0.5],
            bgColorGradient: bg["Photo Booth"],
            darkerFade: true,
            rotation: 0.0
        },
        {
            name: "Cool Light",     // "Cool Light", localized in viewer-environments.loc.json
            path:"CoolLight",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            //illuminance: 1000.0,
            E_bias:-9.0, // EV 9.526, 1000.0 lux (target)
            directLightColor: [1,1,1],
            ambientColor: [0.25/8,0.25/8,0.25/8],
            lightMultiplier: 0.0,
            lightDirection: [-0.0, -0.15, -0.5],
            bgColorGradient: bg["Fusion Grey"],
            darkerFade: true,
            rotation: 0.0
        },

        {
            name: "Warm Light",     // "Warm Light", localized in viewer-environments.loc.json
            path:"WarmLight",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            //illuminance: 1000.0,
            E_bias:-9.0, // EV 9.526, 1000.0 lux (target)
            directLightColor: [1,1,1],
            ambientColor: [0.25/8,0.25/8,0.25/8],
            lightMultiplier: 0.0,
            lightDirection: [-0.0, -0.15, -0.5],
            bgColorGradient: bg["Fusion Grey"],
            darkerFade: true,
            rotation: 0.0
        },

        {
            name: "Soft Light",     // "Soft Light", localized in viewer-environments.loc.json
            path:"SoftLight",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            //illuminance: 1000.0,
            E_bias:-9.0, // EV 9.526, 1000.0 lux (target)
            directLightColor: [1,1,1],
            ambientColor: [0.25/8,0.25/8,0.25/8],
            lightMultiplier: 0.0,
            lightDirection: [-0.5, -0.5, 0.0],
            bgColorGradient: bg["Fusion Grey"],
            darkerFade: true,
            rotation: 0.0
        },

        {
            name: "Grid Light",     // "Grid Light", localized in viewer-environments.loc.json
            path:"GridLight",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            //illuminance: 1000.0,
            E_bias:-9.0, // EV 9.526, 1000.0 lux (target)
            directLightColor: [1,1,1],
            ambientColor: [0.25/8,0.25/8,0.25/8],
            lightMultiplier: 0.0,
            lightDirection: [-0.5, -0.6, 0.0],
            bgColorGradient: bg["Fusion Grey"],
            darkerFade: true,
            rotation: 0.0
        },

        {
            name: "Plaza",             //  "Plaza", localized in viewer-environments.loc.json
            path:"Plaza",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            //illuminance: 24157.736,
            E_bias: -14.0, // FIXME: EV 14.526, 50000.0 lux in the GUI, yet it does not seem to use illuminance
            directLightColor: [0.9, 0.9, 1],
            ambientColor: [0.25/8,0.25/8,0.25/8],
            lightMultiplier: 0.0, //8000.0, Turned off -- until we support world space light positioning.
            lightDirection: [-0.2, -0.18, 0.72],
            bgColorGradient: bg["Plaza"],
            darkerFade: false,
            rotation: 0.0
        },

        {
            name: "Snow Field",            //  "Snow Field", localized in viewer-environments.loc.json
            path:"SnowField",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            //illuminance: 4302.7773,
            E_bias: -10.461343,  // EV 14.526, 50000.0 lux (target)
            directLightColor: [1,1,1],
            ambientColor: [0.25/8,0.25/8,0.25/8],
            lightMultiplier: 0.0, //800.0, Turned off -- until we support world space light positioning.
            lightDirection: [0.0, -1.0, 0.0],
            bgColorGradient: bg["Snow"],
            darkerFade: false,
            rotation: 0.0
        },
        {
            name: "Field",            //  "Field", localized in viewer-environments.loc.json
            path:"field",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            E_bias:-2.9,
            directLightColor: [1,1,1],
            lightMultiplier: 0.0,
            bgColorGradient: bg["Field"],
            useIrradianceAsBackground: true,
            darkerFade: true,
            rotation: 0.0
        },
        {
            name: "Boardwalk",           //  "Boardwalk", localized in viewer-environments.loc.json
            path:"boardwalk",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            E_bias:-7.0,
            directLightColor: [1,1,1],
            lightMultiplier: 0.0,
            bgColorGradient: bg["Boardwalk"],
            useIrradianceAsBackground: true,
            darkerFade: false,
            rotation: 0.0
        },
        //3ds Max non-HDR Flat Shading preset.
        //This allows us to configure SimplePhong to render just the texture.
        {
            name: "Flat Shading",    // localized in viewer-environments.loc.json
            path:null,
            tonemap:0,
            E_bias:0,
            directLightColor: [0.0, 0.0, 0.0],
            ambientColor:     [0.0, 0.0, 0.0],
            lightMultiplier: 0.0,
            bgColorGradient: bg["Fusion Grey"],
            darkerFade: false,
            rotation: 0.0
        },
    ];

    let DebugEnvironments = [

        //Environments added for Fluent
        {
            name: "Harbor",
            path:"Harbor",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            E_bias:1.9,
            directLightColor: [1,1,1],
            lightMultiplier: 0.0,
            bgColorGradient: bg["Sky Blue"],
            useIrradianceAsBackground: true,
            saoIntensity: 0.5,
            darkerFade: false,
            rotation: 0.0
        },

        {
            name: "Night",
            path:"Night",
            type:"logluv",
            tonemap:1,
            E_bias:4.0,
            directLightColor: [1,1,1],
            lightMultiplier: 0.0,
            bgColorGradient: bg["Midnight"],
            useIrradianceAsBackground: false,
            darkerFade: false,
            rotation: 0.0
        },

        {
            name: "Parking",
            path:"Parking",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            E_bias:2.8,
            directLightColor: [1,1,1],
            lightMultiplier: 0.0,
            bgColorGradient: bg["Sky Blue"],
            useIrradianceAsBackground: false,
            saoIntensity: 0.5,
            darkerFade: false,
            rotation: 0.0
        },

        {
            name: "River Road",
            path:"RiverRoad",
            type:"logluv",
            tonemap:DefaultToneMapMethod,
            E_bias:0.0,
            directLightColor: [1,1,1],
            lightMultiplier: 0.0,
            bgColorGradient: bg["Fusion Grey"],
            useIrradianceAsBackground: false,
            saoIntensity: 0.7,
            darkerFade: false,
            rotation: 0.0
        },


             //More RaaS ones
            {
                name: "Crossroads",         //  "Crossroads", localized in viewer-environments.loc.json
                path:"crossroads",
                type:"logluv",
                tonemap:DefaultToneMapMethod,
                E_bias:-5.5,
                directLightColor: [1,1,1],
                lightMultiplier: 0.0,
                bgColorGradient: bg["Sky Blue"],
                useIrradianceAsBackground: true,
                darkerFade: true,
                rotation: 0.0
            },
            {
                name: "Seaport",            //  "Seaport", localized in viewer-environments.loc.json
                path:"seaport",
                type:"logluv",
                tonemap:DefaultToneMapMethod,
                E_bias:-6.5,
                directLightColor: [1,1,1],
                lightMultiplier: 0.0,
                bgColorGradient: bg["Sky Blue"],
                useIrradianceAsBackground: true,
                darkerFade: false,
                rotation: 0.0
            },

            {
                name: "Glacier",            //  "Glacier", localized in viewer-environments.loc.json
                path:"glacier",
                type:"logluv",
                tonemap:DefaultToneMapMethod,
                E_bias:0,
                directLightColor: [1,1,1],
                lightMultiplier: 0.0,
                bgColorGradient: bg["Midnight"],
                darkerFade: false,
                rotation: 0.0
            },
            {
                name: "RaaS Test Env",      // localized in viewer-environments.loc.json
                path:"Reflection",
                type:"logluv",
                tonemap:2,
                E_bias:-1.5,
                directLightColor: [1,1,1],
                lightMultiplier: 0.0,
                bgColorGradient: bg["RaaS SBS"],
                darkerFade: false,
                rotation: 0.0
            },


            //From Fluent
            {
                name: "City Night",
                path:"CityNight",
                type:"logluv",
                tonemap:DefaultToneMapMethod,
                E_bias:1.6,
                directLightColor: [1,1,1],
                lightMultiplier: 0.2,
                bgColorGradient: bg["Midnight"],
                useIrradianceAsBackground: false,
                darkerFade: false,
                rotation: 0.0
            },
    ];

    if (getGlobal().ENABLE_DEBUG) {
        Array.prototype.push.apply(LightPresets, DebugEnvironments);
    }

    /**
     * Copies properties from a Preset (src) into a user provided preset (env)
     * Ideally, this function is used with ModelSettingsEnvironment
     * @private
     */
    export function copyLightPreset(src, env) {
        ObjectAssign(env, src);
        env.name = src.name + " (copy)";
    }


