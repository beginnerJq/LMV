"use strict";

export function readCameraDefinition(pfr, inst) {
    var entry = inst.definition;
    var tse = pfr.seekToEntry(entry);
    if (!tse)
        return null;
    if (tse.version > 2 /*Constants::CameraDefinitionVersion*/)
        return null;

    var s = pfr.stream;
    var cam = {
        isPerspective : !s.getUint8(), /* 0 = perspective, 1 = ortho */
        position : pfr.readVector3f(),
        target: pfr.readVector3f(),
        up: pfr.readVector3f(),
        aspect: s.getFloat32(),
        fov: s.getFloat32()*(180/Math.PI)
    };
    if (tse.version < 2) {
        // Skip the clip planes for old files.
        s.getFloat32();
        s.getFloat32();
    }

    cam.orthoScale = s.getFloat32();

    return cam;
}
