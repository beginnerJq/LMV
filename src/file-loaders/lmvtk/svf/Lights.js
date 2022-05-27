"use strict";


export function readLightDefinition(pfr, entry) {
    var tse = pfr.seekToEntry(entry);
    if (!tse)
        return null;
    if (tse.version > 1 /*Constants::LightDefinitionVersion*/)
        return null;

    var s = pfr.stream;

    var light = {
        position:   pfr.readVector3f(),
        dir:        pfr.readVector3f(),
        r:          s.getFloat32(),
        g:          s.getFloat32(),
        b:          s.getFloat32(),
        intensity:  s.getFloat32(),
        spotAngle:  s.getFloat32(),
        size:       s.getFloat32(),
        type:       s.getUint8()
    };

    return light;
}
