"use strict";

export function readInstance(pfr, entry, placementTransform, globalOffset) {
    var tse = pfr.seekToEntry(entry);
    if (!tse)
        return null;
    if (tse.version > 2 /*Constants::InstanceVersion*/)
        return null;

    var isVisible = true;
    if ( tse.version > 1 ) {
        // Instances v2+ include a flag byte, the LSB of which denotes visibility
        var flags = pfr.readU8();
        isVisible = (flags & 0x01) != 0;
    }

    return {
        definition: pfr.stream.getUint32(),
        transform: pfr.readTransform(undefined, undefined, undefined, placementTransform, globalOffset),
        instanceNodePath: pfr.readPathID()
    }
}



var NodeType = {
    NT_Inner : 0,
    NT_Geometry : 1,
    NT_Camera : 2,
    NT_Light : 3
};

export function readInstanceTree(pfr, version) {

    var transforms = [];
    var dbIds = [];
    var fragIds = [];
    var childCounts = [];
    var nodeIndex = 0;
    var s = pfr.stream;

    while (s.offset < s.byteLength - 8 - 1) {

        pfr.readTransform(nodeIndex, transforms, nodeIndex * 12, undefined, undefined, undefined);

        // Version 1-4 had optional "shared nodes" that were never used in practice. If found, consume and ignore.
        if (version < 5) {
            var hasSharedNode = s.getUint8();
            if (hasSharedNode) {
                s.getUint32();
            }
        }

        var nodeType = s.getUint8();

        // Version 5 introduced a flags byte and the visibility flag.
        if (version >= 5) {
            var flags = s.getUint8();
            var visible = !!(flags & 1);
        }

        // Version 3 introduced the database ID
        if (version >= 3) {
            dbIds[nodeIndex] = s.getVarints();
        }

        if (nodeIndex) {
            // Not a root, behavior depends on type
            // Leaf, instantiate and add fragment references before returning
            switch (nodeType) {

                case NodeType.NT_Inner:
                    break;
                case NodeType.NT_Geometry: {
                        if (version < 2) {
                            var fragCount = s.getUint16();
                            if (fragCount === 1) {
                                fragIds[nodeIndex] = s.getUint32();
                            } else if (fragCount > 0) {
                                var flist = [];
                                for (var i=0; i<fragCount; i++)
                                    flist.push(s.getUint32());
                                fragIds[nodeIndex] = flist;
                            }
                        } else {
                            var fragCount = s.getVarints();
                            if (fragCount === 1) {
                                fragIds[nodeIndex] = s.getVarints();
                            } else if (fragCount > 0) {
                                var flist = [];
                                for (var i=0; i<fragCount; i++)
                                    flist.push(s.getVarints());
                                fragIds[nodeIndex] = flist;
                            }
                        }
                    }
                    break;
                case NodeType.NT_Camera:
                case NodeType.NT_Light: {
                        var hasInstanceEntryId = s.getUint8();
                        if (hasInstanceEntryId) {
                            s.getUint32();
                        }
                    }
                    break;
                default:
                    debug("Unrecognized instance tree node type.");
                    break;
            }
        }

        var childCount = 0;
        if (nodeType === NodeType.NT_Inner) {
            if (version < 2) {
                childCount = s.getUint16();
            } else {
                childCount = s.getVarints();
            }
        }
        childCounts[nodeIndex] = childCount;

        nodeIndex++;
    }

    var dbIdBuffer = new Uint32Array(dbIds.length);
    dbIdBuffer.set(dbIds);

    var xformBuffer = new Float32Array(transforms.length);
    xformBuffer.set(transforms);

    var childCountsBuffer = new Uint32Array(childCounts.length);
    childCountsBuffer.set(childCounts);

    return { dbIds: dbIdBuffer, fragIds:fragIds, transforms: xformBuffer, childCounts: childCountsBuffer };
}
