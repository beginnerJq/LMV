
import * as THREE from "three";
import { logger } from "../logger/Logger";

/**
 * @param {number} clientWidth - Client width
 * @param {number} clientHeight - Client height
 * @class
 * @private
 */
export class UnifiedCamera extends THREE.Camera {
    constructor(clientWidth, clientHeight) {
        super();

        this.fov = 45;
        this.near = 0.1;
        this.far = 100000;
        this.aspect = clientWidth / clientHeight;

        this.left = -clientWidth / 2;
        this.right = clientWidth / 2;
        this.top = clientHeight / 2;
        this.bottom = -clientHeight / 2;
        this.clientWidth = clientWidth;
        this.clientHeight = clientHeight;

        this.target = new THREE.Vector3(0, 0, -1);
        this.worldup = new THREE.Vector3(0, 1, 0);
        this.viewInverseEnv = new THREE.Matrix4();
        this.projScreenMatrix = new THREE.Matrix4();

        this.orthographicCamera = new THREE.OrthographicCamera(this.left, this.right, this.top, this.bottom, this.near, this.far);
        this.perspectiveCamera = new THREE.PerspectiveCamera(this.fov, this.aspect, this.near, this.far);

        this.zoom = 1;

        // No effect unless using AR/VR with WebXR. In this case, the flag protects the camera from being modified
        // by the XR environment. E.g. for screen-aligned cameras that should always keep independent on device orientation and position.
        this.disableXr = false;

        // Only used when using dynamic global offsets.
        // Camera position/target are in local viewer coordinates.
        this.globalOffset = new THREE.Vector3();

        this.toPerspective();
    }

    clone(camera) {
        camera = camera || new UnifiedCamera(this.right * 2.0, this.top * 2.0);

                                       
        {
            THREE.Camera.prototype.clone.call( this, camera );
        }
                 
         
                              
         
                  

        camera.position.copy(this.position);
        camera.up.copy(this.up);
        if (this.target)
            camera.target = this.target.clone();
        if (this.worldup)
            camera.worldup = this.worldup.clone();
        if (this.worldUpTransform)
            camera.worldUpTransform = this.worldUpTransform.clone();

        camera.left = this.left;
        camera.right = this.right;
        camera.top = this.top;
        camera.bottom = this.bottom;

        camera.near = this.near;
        camera.far = this.far;
        camera.fov = this.fov;
        camera.aspect = this.aspect;
        camera.zoom = this.zoom;

        camera.clientWidth = this.clientWidth;
        camera.clientHeight = this.clientHeight;

        camera.isPerspective = this.isPerspective;

        camera.globalOffset = this.globalOffset.clone();

        camera.orthoScale = this.orthoScale;

        this.updateProjectionMatrix();

        return camera;
    };

    __computeFovPosition(fov) {
        if (Math.abs(this.fov - fov) <= 0.0001)
            return this.position.clone();

        var eye = this.target.clone().sub(this.position);
        var dir = eye.clone().normalize();
        var oldFOV = THREE.Math.degToRad(this.fov);
        var newFOV = THREE.Math.degToRad(fov);
        var fovScale = Math.tan(oldFOV * 0.5) / Math.tan(newFOV * 0.5);

        //If there is a pivot point, get distance based
        //on the distance to the plane of the pivot point,
        //because the target point is sometimes just a fixed 1 unit distance
        //away from the camera position calculated from the direction vector
        //and makes no sense to use as actual target
        var distance;
        var target;
        if (this.pivot) {
            //Get equation of the plane parallel to the screen, and containing the
            //pivot point
            var plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dir.clone().negate(), this.pivot);
            distance = plane.distanceToPoint(this.position);
            target = dir.clone().multiplyScalar(distance).add(this.position);
        } else {
            distance = eye.length();
            target = this.target;
        }

        distance *= fovScale;
        var offset = dir.multiplyScalar(-distance);

        return target.clone().add(offset);
    };

    toPerspective() {
        // Switches to the Perspective Camera

        if (!this.isPerspective && this.saveFov) {
            this.position.copy(this.__computeFovPosition(this.saveFov));
            this.fov = this.saveFov;
        }

        this.perspectiveCamera.aspect = this.aspect;
        this.perspectiveCamera.near = this.near;
        this.perspectiveCamera.far = this.far;

        this.perspectiveCamera.fov = this.fov / this.zoom;
        this.perspectiveCamera.updateProjectionMatrix();

        this.projectionMatrix = this.perspectiveCamera.projectionMatrix;

                                       
         
                                                                                                
                                                                                                                      
                                                                  
                                                                                                                                
                                                                                          
                                                                                                     
         
                  

        this.isPerspective = true;
    };

    toOrthographic() {
        if (this.isPerspective) {
            this.saveFov = this.fov;
            var newFov = UnifiedCamera.ORTHO_FOV;
            this.position.copy(this.__computeFovPosition(newFov));
            this.fov = newFov;
        }

        this.orthoScale = this.target.clone().sub(this.position).length();

        var halfHeight = this.orthoScale * 0.5;
        var halfWidth = halfHeight * this.aspect;

        this.left = this.orthographicCamera.left = -halfWidth;
        this.right = this.orthographicCamera.right = halfWidth;
        this.top = this.orthographicCamera.top = halfHeight;
        this.bottom = this.orthographicCamera.bottom = -halfHeight;

        this.orthographicCamera.near = this.near;
        this.orthographicCamera.far = this.far;

        this.orthographicCamera.updateProjectionMatrix();

        this.projectionMatrix = this.orthographicCamera.projectionMatrix;

                                       
         
                                                                                                
                                                                                                                      
                                                                  
                                                                                                                                
                                                                                           
                                                                                                     
         
                  

        this.isPerspective = false;
    };

    updateProjectionMatrix() {
        if (this.isPerspective) {
            this.toPerspective();
        } else {
            this.toOrthographic();
        }
    };

    setSize(width, height) {
        this.aspect = width / height;
        this.left = -width / 2;
        this.right = width / 2;
        this.top = height / 2;
        this.bottom = -height / 2;

    };


    setFov(fov) {
        this.fov = fov;
        this.updateProjectionMatrix();
    };

    /*
    * Uses Focal Length (in mm) to estimate and set FOV
    * 35mm (fullframe) camera is used if frame size is not specified;
    * Formula based on http://www.bobatkins.com/photography/technical/field_of_view.html
    */
    setLens(focalLength, frameHeight) {
        if (frameHeight === undefined) frameHeight = 24;

        var fov = 2 * THREE.Math.radToDeg(Math.atan(frameHeight / (focalLength * 2)));

        this.setFov(fov);

        return fov;
    };

    // Fit camera to model bbox
    //  @param {Box3} model bbox
    //  @param {boolean}is2d
    setViewFromBox(bbox, is2d) {
        UnifiedCamera.getViewParamsFromBox(bbox, is2d, this.aspect, this.up, this.fov, this);
        this.updateCameraMatrices();
    };

    // Ensure that all camera matrices are instantly up-to-date. For the default camera, all this happens automatically by the viewer
    // in different parts of setup and rendering.
    //
    // But, when setting up a separate camera yourself and using the matrices for computations, this function is essential to get correct results.
    updateCameraMatrices() {

        // Make sure that camera.rotation is set properly according to pos/target.
        // For the default camera, this usually happens inside tick() function while updating the ToolController.
        this.lookAt(this.target);

        // Make sure that the camera matrices are updated based on latest camera properties.
        // This would happen later in cmdBeginScene() otherwise.
        this.updateProjectionMatrix();
        this.updateMatrixWorld();

                                        
         
                                                                                   
                                                                                                   
                                                                                                      
                                                                                                             
                                                                                                       
                                                                                                          
                                             
                                        
                                                                                              
                    
                                                           
             
            
                  
    };

    // Configure view from given view params (pos, target, up, isPerspective, orthoScale). Missing params will remain unchanged.
    //
    //  @param {Object} viewParams
    //  @param {Vector3} [viewParams.position]
    //  @param {Vector3} [viewParams.target]
    //  @param {Vector3} [viewParams.up]
    //  @param {boolean}   [viewParams.isPerspective]
    //  @param {Vector3} [viewParams.orthoScale]
    setView(viewParams) {

        viewParams.position && this.position.copy(viewParams.position);
        viewParams.target && this.target.copy(viewParams.target);
        viewParams.up && this.up.copy(viewParams.up);
        if (viewParams.isPerspective !== undefined) this.isPerspective = viewParams.isPerspective;
        if (viewParams.orthoScale !== undefined) this.orthoScale = viewParams.orthoScale;

        this.updateCameraMatrices();
    };

    // Computes pixel-per-unit scale at a given distance from the camera,
    // i.e. the projected screen-space length of a line of length 1.0 parallel to the viewplane at distance d.
    pixelsPerUnitAtDistance(dist) {

        // Handle ortho-camera case
        if (!this.isPerspective) {
            // Scale factor only depends on orthoScale, not on distance.
            return this.clientHeight / this.orthoScale;
        }

        // get tan(phi/2) for horizontal aperture angle.
        const tanPhiHalf = Math.tan(THREE.Math.degToRad(0.5 * this.fov));

        // Compute view-frustum height at the given distance in world-space 
        const frustumHeight = 2.0 * dist * tanPhiHalf;

        return this.clientHeight / frustumHeight;
    };

    // Compute pixel-per-unit scale at a given visible point in world-space.
    UnifpixelsPerUnitAtPoint(pos) {
        const dist = this.position.distanceTo(pos);
        return this.pixelsPerUnitAtDistance(dist);
    };

    // Change globalOffset. By default, we update position/target/pivot, so that the global
    // camera position keeps the same.
    //  @param {Vector3} offset
    //  @param {boolean}   [preserveGlobalPosition=true] - If false, we only change the offset vector
    setGlobalOffset(offset, preserveGlobalPosition = true) {

        // Avoid confusing effects when using camera.position as a new offset
        if (offset === this.position || offset === this.target || offset === this.pivot) {
            offset = offset.clone();
        }

        if (preserveGlobalPosition) {
            this.position.add(this.globalOffset).sub(offset);
            this.target.add(this.globalOffset).sub(offset);
            this.pivot?.add(this.globalOffset).sub(offset);
        }

        this.globalOffset.copy(offset);
    };

    // @param {Vector3} [target]
    getGlobalPosition(target = new THREE.Vector3()) {
        return target.copy(this.position).add(this.globalOffset);
    };

    // Returns a ray according to given vector.
    viewportToRay(vpVec, ray) {
        // set two vectors with opposing z values
        vpVec.z = -1.0;
        var end = new THREE.Vector3(vpVec.x, vpVec.y, 1.0);
        vpVec = vpVec.unproject(this);
        end = end.unproject(this);

        // find direction from vector to end
        end.sub(vpVec).normalize();

        if (!ray)
            ray = new THREE.Ray();

        ray.set(!this.isPerspective ? vpVec : this.position, end);

        return ray;
    };

    // Transforms current view by given matrix.
    //  @param {Matrix4} matrix
    transformCurrentView(matrix) {
        UnifiedCamera.transformViewParams(this, matrix);        
    };
}

//Constant FOV used to make math right for Ortho cameras.
UnifiedCamera.ORTHO_FOV = (2 * Math.atan(0.5)) * 180.0 / Math.PI;

/*
      Set camera params to get a default view for a given model bbox.
    
       @param {Box3}     modelBox
       @param {boolean}    is2d
       @param {number}   aspect         - aspect ratio (= width / height) 
       @param {Vector3}  up             - only for 3D
       @param {float}    fov            - only for 3D
       @param {Object|Camera} [outView] - optional result object
    
       @returns {Object} View object containing { position, target, up, isPerspective, orthoScale }
    */
UnifiedCamera.getViewParamsFromBox = function (bbox, is2d, aspect, up, fov, outView) {

    var view = outView || {};

    var size = bbox.getSize(new THREE.Vector3());
    view.target = bbox.getCenter(new THREE.Vector3());

    // If outView is a Camera, position exists and cannot be replaced
    if (!view.position) view.position = new THREE.Vector3();
    if (!view.up) view.up = new THREE.Vector3();

    if (!is2d) {
        view.isPerspective = true;
        view.fov = fov;
        view.up.copy(up);

        view.position.copy(view.target);
        view.position.z += 1.5 * Math.max(size.x, size.y, size.z);
    }
    else {
        view.isPerspective = false;

        var pageAspect = size.x / size.y;
        var screenAspect = aspect;

        //Fit the page to the screen
        if (screenAspect > pageAspect)
            view.orthoScale = size.y;
        else
            view.orthoScale = size.x / screenAspect;

        //2D case -- up vector is Y
        view.up.set(0, 1, 0);

        view.position.copy(view.target);
        view.position.z += view.orthoScale;

        //This is to avoid freaking out the camera / controller with co-linear up and direction
        view.target.y += 1e-6 * size.y;
    }
    return view;
};

// Copy viewParams struct that can be used for setView().
UnifiedCamera.copyViewParams = function(src, dst) {

    dst = dst || {};

    dst.position = (dst.position || new THREE.Vector3()).copy(src.position);
    dst.target = (dst.target || new THREE.Vector3()).copy(src.target);
    dst.up = (dst.up || new THREE.Vector3()).copy(src.up);

    dst.aspect = src.aspect;
    dst.fov = src.fov;
    dst.isPerspective = src.isPerspective;
    dst.orthoScale = src.orthoScale;

    return dst;
};

// Apply Matrix4 to viewParams struct.
//  @param {Object}  params - Params to be modified. See setView() for details.
//  @param {Matrix4} matrix
UnifiedCamera.transformViewParams = function(params, matrix) {
    params.position.applyMatrix4(matrix);
    params.target.applyMatrix4(matrix);
    params.pivot?.applyMatrix4(matrix);
    params.up.transformDirection(matrix);
};

//Camera is expected to have the properties of a THREE.Camera.
UnifiedCamera.adjustOrthoCamera = function(camera, sceneBox) {

    if (!camera.isPerspective) {
        var size = sceneBox.getSize(new THREE.Vector3());

        var at = camera.target.clone().sub(camera.position);
        var targetDistance = at.length();
        // isEmpty is needed to be consistent with new threejs version where getSize is 0 if computed in an empty box
        if (targetDistance > 1000 * size.length() && !sceneBox.isEmpty()) {

            //Sometimes (Revit) the camera target is unspecified/infinite
            //for ortho. So we pick target and distance such that
            //initial view and orbit is about right by using a target point that is a similar
            //distance away as camera->bbox center, but is in the
            //direction of the at vector (which is not necessarily looking at the center)
            var dist = camera.position.distanceTo(sceneBox.getCenter(new THREE.Vector3()));
            camera.target.copy(camera.position).add(at.normalize().multiplyScalar(dist));
        }
        else {
            //UnifiedCamera does not actually look at the orthoScale property. It bases
            //the ortho projection on value derived from the position-target distance and an
            //assumed field of view. For a well defined ortho view, we expect that
            //the eye-target distance and ortho scale are equal. Some extractors have historically
            //defined only one of these in a sane way (e.g. the other code path in this if condition).

            if (Math.abs(targetDistance - camera.orthoScale) / targetDistance > 1e-5) {

                logger.warn("Ortho scale does not match eye-target distance. One of them is likely wrong, but which one?");

                //This checks for ortho camera views defined in Revit bubbles. Unlike the same view in the SVF,
                //the one in the bubble sets orthoHeight and FOV to trivial values that make no sense, while
                //target distance is correct.
                var isLikelyRevitView = (camera.fov === 0 && camera.orthoScale === 1);

                //Assume ortho scale is correct if we are not in the Revit situation above
                var orthoScaleIsCorrect = !isLikelyRevitView;
                if (orthoScaleIsCorrect) {
                    //This line applies orthoScale (assumed correct) to target distance (incorrect)
                    camera.position.copy(camera.target).add(at.normalize().multiplyScalar(-camera.orthoScale));
                } else {
                    //do nothing, target distance is correct and will be used by UnifiedCamera
                }
            }
        }
    }
};

UnifiedCamera.prototype.isUnifiedCamera = true;