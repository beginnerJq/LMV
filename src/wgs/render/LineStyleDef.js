import * as THREE from "three";

export let LineStyleDefs = [

{
    id: "SOLID",
    name: "Solid",
    ascii_art: "_______________________________________",
    def: [1]
},

//Line types from acad.lin below. Definitions are kept the same
//as the original except the format is JSON-ified to avoid parsing .LIN

//
//  AutoCAD Linetype Definition file
//  Version 2.0
//  Copyright 1991, 1992, 1993, 1994, 1996 by Autodesk, Inc.
//

//List of line type definitions from ACAD.lin.

//[TS] The units for these items seem to be inches or drawing units with dot
// being represented by 0, i.e. pen width = 0. (see note about ISO patterns below)

{
    id: "BORDER",
    name: "Border",
    ascii_art: "__ __ . __ __ . __ __ . __ __ . __ __ .",
    def: [.5,-.25,.5,-.25,0,-.25]
},
{
    id: "BORDER2",
    name: "Border (.5x)",
    ascii_art: "__ __ . __ __ . __ __ . __ __ . __ __ .",
    def: [.25,-.125,.25,-.125,0,-.125]
},
{
    id: "BORDERX2",
    name: "Border (2x)",
    ascii_art: "____  ____  .  ____  ____  .  ___",
    def: [1.0,-.5,1.0,-.5,0,-.5]
},


{
    id: "CENTER",
    name: "Center",
    ascii_art: "____ _ ____ _ ____ _ ____ _ ____ _ ____",
    def: [1.25,-.25,.25,-.25]
},
{
    id: "CENTER2",
    name: "Center (.5x)",
    ascii_art: "___ _ ___ _ ___ _ ___ _ ___ _ ___",
    def: [.75,-.125,.125,-.125]
},    
{
    id: "CENTERX2",
    name: "Center (2x)",
    ascii_art: "________  __  ________  __  _____",
    def: [2.5,-.5,.5,-.5]
},

{
    id: "DASHDOT",
    name : "Dash dot",
    ascii_art: "__ . __ . __ . __ . __ . __ . __ . __",
    def: [.5,-.25,0,-.25]
},
{
    id: "DASHDOT2",
    name: "Dash dot (.5x)",
    ascii_art : "_._._._._._._._._._._._._._._.",
    def: [.25,-.125,0,-.125]
},
{
    id: "DASHDOTX2",
    name : "Dash dot (2x)",
    ascii_art: "____  .  ____  .  ____  .  ___",
    def: [1.0,-.5,0,-.5]
},

{
    id: "DASHED",
    name: "Dashed",
    ascii_art: "__ __ __ __ __ __ __ __ __ __ __ __ __ _",
    def: [.5,-.25]
},
{
    id: "DASHED2",
    name: "Dashed (.5x)",
    ascii_art: "_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _", 
    def: [.25,-.125]
},
{
    id: "DASHEDX2",
    name: "Dashed (2x)",
    ascii_art: "____  ____  ____  ____  ____  ___",
    def: [1.0,-.5]
},

{
    id: "DIVIDE",
    name: "Divide",
    ascii_art: "____ . . ____ . . ____ . . ____ . . ____",
    def: [.5,-.25,0,-.25,0,-.25]
},
{
    id: "DIVIDE2",
    name: "Divide (.5x)",
    ascii_art: "__..__..__..__..__..__..__..__.._",
    def: [.25,-.125,0,-.125,0,-.125]
},
{
    id: "DIVIDEX2",
    name: "Divide (2x)",
    ascii_art: "________  .  .  ________  .  .  _",
    def: [1.0,-.5,0,-.5,0,-.5]
},

{
    id: "DOT",
    name: "Dot",
    ascii_art: ". . . . . . . . . . . . . . . . . . . . . . . .",
    def: [0,-.25]
},
{
    id: "DOT2",
    name: "Dot (.5x)",
    ascii_art: "........................................",
    def: [0,-.125]
},
{
    id: "DOTX2",
    name: "Dot (2x)",
    ascii_art: ".  .  .  .  .  .  .  .  .  .  .  .  .  .",
    def: [0,-.5]
},

{
    id: "HIDDEN",
    name: "Hidden",
    ascii_art: "__ __ __ __ __ __ __ __ __ __ __ __ __ __",
    def: [.25,-.125]
},
{ 
    id: "HIDDEN2",
    name: "Hidden (.5x)",
    ascii_art: "_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _", 
    def: [.125,-.0625]
},
{
    id: "HIDDENX2",
    name: "Hidden (2x)",
    ascii_art: "____ ____ ____ ____ ____ ____ ____",
    def: [.5,-.25]
},

{
    id: "PHANTOM",
    name: "Phantom",
    ascii_art: "______  __  __  ______  __  __  ______",
    def: [1.25,-.25,.25,-.25,.25,-.25]
},

{ 
    id: "PHANTOM2",
    name: "Phantom (.5x)",
    ascii_art: "___ _ _ ___ _ _ ___ _ _ ___ _ _",
    def: [.625,-.125,.125,-.125,.125,-.125]
},

{
    id: "PHANTOMX2",
    name: "Phantom (2x)",
    ascii_art: "____________    ____    ____   _",
    def: [2.5,-.5,.5,-.5,.5,-.5]
},

//
//  ISO 128 (ISO/DIS 12011) linetypes
//
//  The size of the line segments for each defined ISO line, is
//  defined for an usage with a pen width of 1 mm. To use them with
//  the other ISO predefined pen widths, the line has to be scaled
//  with the appropriate value (e.g. pen width 0,5 mm -> ltscale 0.5).
//

//[TS] Added pen_width and unit properties to make this explicit

{
    id: "ACAD_ISO02W100",
    name: "ISO dash",
    ascii_art: "__ __ __ __ __ __ __ __ __ __ __ __ __",
    def: [12,-3],
    
    pen_width: 1,
    unit: "mm"
},

{
    id: "ACAD_ISO03W100",
    name: "ISO dash space",
    ascii_art: "__    __    __    __    __    __",
    def: [12,-18],

    pen_width: 1,
    unit: "mm"
},

{
    id: "ACAD_ISO04W100",
    name: "ISO long-dash dot",
    ascii_art: "____ . ____ . ____ . ____ . _",
    def: [24,-3,.5,-3],
    
    pen_width: 1,
    unit: "mm"
},

{
    id: "ACAD_ISO05W100",
    name: "ISO long-dash double-dot",
    ascii_art: "____ .. ____ .. ____ .",
    def: [24,-3,.5,-3,.5,-3],

    pen_width: 1,
    unit: "mm"
},

{
    id: "ACAD_ISO06W100",
    name: "ISO long-dash triple-dot",
    ascii_art: "____ ... ____ ... ____",
    def: [24,-3,.5,-3,.5,-3,.5,-3],

    pen_width: 1,
    unit: "mm"
},

{
    id: "ACAD_ISO07W100",
    name: "ISO dot",
    ascii_art: ". . . . . . . . . . . . . . . . . . . .",
    def: [.5,-3],

    pen_width: 1,
    unit: "mm"
},

{
    id: "ACAD_ISO08W100",
    name: "ISO long-dash short-dash",
    ascii_art: "____ __ ____ __ ____ _",
    def: [24,-3,6,-3],
    
    pen_width: 1,
    unit: "mm"
},

{
    id: "ACAD_ISO09W100",
    name: "ISO long-dash double-short-dash",
    ascii_art: "____ __ __ ____",
    def: [24,-3,6,-3,6,-3],

    pen_width: 1,
    unit: "mm"
},
{
    id: "ACAD_ISO10W100",
    name: "ISO dash dot",
    ascii_art: "__ . __ . __ . __ . __ . __ . __ . ",
    def: [12,-3,.5,-3],
    
    pen_width: 1,
    unit: "mm"
},

{
    id: "ACAD_ISO11W100",
    name: "ISO double-dash dot",
    ascii_art: "__ __ . __ __ . __ __ . __ _",
    def: [12,-3,12,-3,.5,-3],
    
    pen_width: 1,
    unit: "mm"
},
{
    id: "ACAD_ISO12W100",
    name: "ISO dash double-dot",
    ascii_art: "__ . . __ . . __ . . __ . .", 
    def: [12,-3,.5,-3,.5,-3],
    
    pen_width: 1,
    unit: "mm"
},
{
    id: "ACAD_ISO13W100",
    name: "ISO double-dash double-dot",
    ascii_art: "__ __ . . __ __ . . _",
    def: [12,-3,12,-3,.5,-3,.5,-3],
    
    pen_width: 1,
    unit: "mm"
},

{
    id: "ACAD_ISO14W100",
    name: "ISO dash triple-dot",
    ascii_art: "__ . . . __ . . . __ . . . _",
    def: [12,-3,.5,-3,.5,-3,.5,-3],
    
    pen_width: 1,
    unit: "mm"
},

{
    id: "ACAD_ISO15W100",
    name: "ISO double-dash triple-dot",
    ascii_art: "__ __ . . . __ __ . .",
    def: [12,-3,12,-3,.5,-3,.5,-3,.5,-3],
    
    pen_width: 1,
    unit: "mm"
},

//  Complex linetypes
//
//  Complex linetypes have been added to this file.
//  These linetypes were defined in LTYPESHP.LIN in
//  Release 13, and are incorporated in ACAD.LIN in
//  Release 14.
//  
//  These linetype definitions use LTYPESHP.SHX.
//

//[TS] These do not work, we can only render linear types.

{
    id: "FENCELINE1",
    name: "Fenceline circle",
    ascii_art: "----0-----0----0-----0----0-----0--",
    def: [.25,-.1,["CIRC1","ltypeshp.shx","x=-.1","s=.1"],-.1,1] //TODO: Does not work
},

{
    id: "FENCELINE2",
    name: "Fenceline square",
    ascii_art: "----[]-----[]----[]-----[]----[]---",
    def: [.25,-.1,["BOX","ltypeshp.shx","x=-.1","s=.1"],-.1,1] //TODO: Does not work
},

{
    id: "TRACKS",
    name: "Tracks",
    ascii_art: "-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-",
    def: [.15,["TRACK1","ltypeshp.shx","s=.25"],.15] //TODO: Does not work
},

{
    id: "BATTING",
    name: "Batting",
    ascii_art: "SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS",
    def: [.0001,-.1,["BAT","ltypeshp.shx","x=-.1","s=.1"],-.2,["BAT","ltypeshp.shx","r=180","x=.1","s=.1"],-.1] //TODO: Does not work
},

{
    id: "HOT_WATER_SUPPLY",
    name: "Hot water supply",
    ascii_art: "---- HW ---- HW ---- HW ----",
    def: [.5,-.2,["HW","STANDARD","S=.1","R=0.0","X=-0.1","Y=-.05"],-.2] //TODO: Does not work
},

{
    id: "GAS_LINE",
    name: "Gas line",
    ascii_art: "----GAS----GAS----GAS----GAS----GAS----GAS--",
    def: [.5,-.2,["GAS","STANDARD","S=.1","R=0.0","X=-0.1","Y=-.05"],-.25] //TODO: Does not work
},


{
    id: "ZIGZAG",
    name: "Zig zag",
    ascii_art: "/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/",
    def: [.0001,-.2,["ZIG","ltypeshp.shx","x=-.2","s=.2"],-.4,["ZIG","ltypeshp.shx","r=180","x=.2","s=.2"],-.2] //TODO: Does not work
}


];

export let createLinePatternTextureData = function(w, h) {
    var pw = w+3;
    var ph = h;

    var pot = 1;
    while (pot < pw)
        pot *= 2;
    pw = pot;

    pot = 1;
    while (pot < ph)
        pot *= 2;
    ph = pot;

    var tex = new Uint8Array(pw * ph);

    var lineStyleTex = new THREE.DataTexture(tex, pw, ph,
        THREE.LuminanceFormat,
        THREE.UnsignedByteType,
        THREE.UVMapping,
        THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping,
        THREE.NearestFilter, THREE.NearestFilter, 0);

    lineStyleTex.generateMipmaps = false;
    lineStyleTex.flipY = false;
    lineStyleTex.needsUpdate = true;
                                   
     
                                              
     
              

    return {
        tex,
        pw,
        ph,
        lineStyleTex
    };
};


export let createLinePatternTextureFromDefs = function(defs) {

    var h = defs.length;
    var w=0;

    for (var i=0; i<h; i++) {
        var ls = defs[i];

        if (ls.def.length > w)
            w = ls.def.length;
    }

    let {tex, pw, lineStyleTex} = createLinePatternTextureData(w, h);

    for (var j=0; j<h; j++) {
        let ls = defs[j];
        createLinePatternForDef(ls, tex, j, pw);
    }

    return lineStyleTex;
};

export let createLinePatternTexture = function() {
    return createLinePatternTextureFromDefs(LineStyleDefs);
};

export let createLinePatternForDef = function(ls, tex, j, pw, dpi = 96) {
    var off = j * pw;

    //NOTE: The pattern scaling here just makes
    //the definitions in the texture consistent throughout in units of logical pixels (96 pixels per inch).
    //It does not apply scaling based on pen width or LTSCALE which should be done in shader.
    //Because we use a Byte texture, the maximum dash length at 96 dpi is about 2.5 inches, which
    //is enough for the patterns we have today. This can be easily fixed by changing to e.g. rgba8

    var unitScale = (ls.unit && ls.unit == "mm") ? 1.0 / 25.4 : 1.0;
    var penWidth = ls.pen_width || 0;

    var segs = ls.def;
    var patLen = 0;
    for (var i=0; i<segs.length; i++) {

        var len = Math.abs(segs[i]);

        var isDot = (len <= penWidth * 0.5);
        //Is it a dot? (the ISO patterns define dot as segment with half a pen width)
        if (isDot)
            len = 0;

        var ilen = 0 | (len * dpi * unitScale);

        patLen += ilen;

        //dot handling, set to 1 logical pixel in texture, since we need the 0 to indicate pattern end
        //the shader will interpret 1 as dot.
        tex[off+i+2] = ilen ? ilen : 1;
    }

    //Two bytes to store total pattern length in the first two bytes of the texture row
    tex[off] = patLen % 256;
    tex[off+1] = patLen / 256;

    //null terminate the pattern def in the texture so we know when to stop in the shader
    tex[off+segs.length+2] = 0;
};