
// Implemented as a thin-wrapper around methods in Viewer3DImpl to manage scene overlays.

/**
 * Provides a mechanism for adding custom meshes. These meshes are added into their
 * own overlay scenes, which are always rendered after the main scene.
 *
 * @alias Autodesk.Viewing.OverlayManager
 */
export class OverlayManager {

    // not documented
    constructor(impl) {
        this.impl = impl;
    }

    /**
     * @private
     */
    dtor() {
        this.impl = null;
    }

    /**
     * Creates a scene that is always rendered *after* the main scene.
     * It is rendered into a separate buffer when each frame of the main scene is drawn.
     * The buffer is then composited over the main scene.
     * If it is enabled, the overlay scenes use the main scene depth buffer for the depth testing,
     * to allow the overlay to appear in the main scene.
     * 
     * @param {string} name - scene identifier
     * @returns {boolean} - true if the overlay was added or already exists, false otherwise
     *
     * @alias Autodesk.Viewing.OverlayManager#addScene
     */
    addScene(name) {
        if (!name)
            return false;

        if (Object.prototype.hasOwnProperty.call(this.impl.overlayScenes, name))
            return true;
        
        this.impl.createOverlayScene(name);
        return true;
    }

    /**
     * Removes a scene along with all the meshes in it.
     * 
     * @param {string} name - scene identifier
     * @returns {boolean} - true if the overlay was removed or if it doesn't exist
     *
     * @alias Autodesk.Viewing.OverlayManager#removeScene
     */
    removeScene(name) {
        if (!name) 
            return false;

        this.impl.removeOverlayScene(name);
        return true;
    }

    /**
     * Removes all meshes from a scene.
     *
     * @param {string} name - scene identifier
     *
     * @alias Autodesk.Viewing.OverlayManager#clearScene
     */
    clearScene(name) {
        this.impl.clearOverlay(name);
    }

    /**
     * Checks whether a scene already exists
     * 
     * @param {string} name - scene identifier
     * @returns {boolean} - true the scene exists
     *
     * @alias Autodesk.Viewing.OverlayManager#hasScene
     */
    hasScene(name) {
        if (!name) 
            return false;
        return Object.prototype.hasOwnProperty.call(this.impl.overlayScenes, name);
    }

    /**
     * Inserts one or more custom THREE.Mesh into an existing scene.
     * 
     * @param {THREE.Mesh|Array} mesh - A mesh instance or an Array of them.
     * @param {string} sceneName - Name of an existing scene.
     * @returns {boolean} - true if the mesh was added to the scene 
     * 
     * @example
     *      // Create a new mesh
     *      const geometry = new THREE.SphereGeometry(10, 8, 8);
     *      const material = new THREE.MeshBasicMaterial({ color: 0x336699 });
     *      const mesh = new THREE.Mesh(geometry, material);
     *      mesh.position.x = 1.0; mesh.position.y = 2.0; mesh.position.z = 3.0;
     *      // Add scene and mesh
     *      addScene('my_scene');
     *      addMesh([mesh], 'my_scene');
     *
     * @alias Autodesk.Viewing.OverlayManager#addMesh
     */
    addMesh(mesh, sceneName) {
        if (!mesh || !sceneName || !Object.prototype.hasOwnProperty.call(this.impl.overlayScenes, sceneName))
            return false;

        mesh = Array.isArray(mesh) ? mesh : [mesh];
        this.impl.addMultipleOverlays(sceneName, mesh);
        return true;
    }


    /**
     * Removes one or more custom THREE.Mesh from an existing scene.
     * Developers are responsible for disposing the material and geometry after the mesh is removed.
     * 
     * @param {THREE.Mesh|Array} mesh - A mesh instance or an Array of them.
     * @param {string} sceneName - Name of the scene the mesh(es) belong to.
     * @returns {boolean} - true if the mesh (or meshes) was removed.
     *
     * @alias Autodesk.Viewing.OverlayManager#removeMesh
     */
    removeMesh(mesh, sceneName) {
        if (!mesh || !sceneName || !Object.prototype.hasOwnProperty.call(this.impl.overlayScenes, sceneName))
            return false;

        mesh = Array.isArray(mesh) ? mesh : [mesh];
        this.impl.removeMultipleOverlays(sceneName, mesh);
        return true;
    }

    /**
     * Checks whether a mesh is already part of a scene.
     *
     * @param {THREE.Mesh} mesh - The mesh instance.
     * @param {string} sceneName - Name of the scene to check against.
     * @returns {boolean} - true if the mesh belongs to the scene.
     *
     * @alias Autodesk.Viewing.OverlayManager#hasMesh
     */
    hasMesh(mesh, sceneName) {
        var overlay = this.impl.overlayScenes[sceneName];
        if (!overlay)
            return false;

        var children = overlay.scene.children;
        for (let i = 0, len=children.length; i < len; ++i) {
            if (children[i] === mesh)
                return true;
        }
        return false;
    }

}