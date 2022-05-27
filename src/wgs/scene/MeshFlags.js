export let MeshFlags = {
        // FragmentList flags
        //visibility/highlight bitmask flags

        //Byte 0

        //NOTE: This is confusing and it should be fixed, but when the MESH_VISIBLE bit is off, the mesh
        //will draw in ghosted mode. To completely skip drawing a mesh, set the HIDE flag.
        MESH_VISIBLE:         1,
        MESH_HIGHLIGHTED:     2,
        MESH_HIDE:            4,
        MESH_ISLINE:          8,
        MESH_MOVED:        0x10, // indicates if an animation matrix is set
        MESH_RENDERFLAG:   0x20,
        MESH_NOTLOADED:    0x40, // the mesh has not yet loaded or has been unloaded
        MESH_ISPOINT:      0x80, // indicates that the mesh is vertex-only

        //Byte 1
        //TODO: Two bits are enough to hold ISLINE, ISWIDELINE and ISPOINT, we don't need to waste three,
        //but there is no point to optimizing this as long as the required flags go over one byte.
        MESH_ISWIDELINE:  0x100, // indicates that the mesh is wide line
        MESH_TRAVERSED:   0x200, // only used for paging: drawn fragments are tagged and then skipped by forEach() until the flag is being reset (e.g. on scene/camera changes)
        MESH_DRAWN:       0x400, // only used for paging: drawn fragments are tagged. At the end of all render passes flag is copied to MESH_TRAVERSED.
        // The Memory Limited Extension uses the high order three bits of this byte
    };

