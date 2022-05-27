
import { LmvVector3 } from '../../../wgs/scene/LmvVector3';
import { LmvBox3 } from '../../../wgs/scene/LmvBox3';
import { LmvMatrix4 } from '../../../wgs/scene/LmvMatrix4';

function getUnitScale(unit) {
    //Why are translators not using standard strings for those?!?!?!?
    switch (unit) {
        case 'meter'      :
        case 'meters'     :
        case 'm'          : return 1.0;
        case 'feet and inches':
        case 'foot'       :
        case 'feet'       :
        case 'ft'         : return 0.3048;
        case 'inch'       :
        case 'inches'     :
        case 'in'         : return 0.0254;
        case 'centimeter' :
        case 'centimeters':
        case 'cm'         : return 0.01;
        case 'millimeter' :
        case 'millimeters':
        case 'mm'         : return 0.001;
        default: return 1.0;
    }
}


function isIdentity(mtx) {
    var e = mtx.elements;
    for (var i=0; i<4; i++) {
        for (var j=0; j<4; j++) {
            if (i === j) {
                if (e[i*4+j] !== 1)
                    return false;
            } else {
                if (e[i*4+j] !== 0)
                    return false;
            }
        }
    }

    return true;
}


export function derivePlacementTransform(svf, loadContext) {

    // We now will apply overall model transforms, following the following logic:
    //    1) placementTransform = options.placementTransform);
    //    2) placementTransform = placementTransform.multiply(scalingTransform);
    //    3) placementTransform = placementTransform.multiply(refPointTransform);
    // This is for aggregation scenarios, where multiple models are loaded into the scene
    // In such scenarios the client will most probably manually override the model units


    //First, take the input placement transform as is (could be null).
    svf.placementTransform = loadContext.placementTransform;

    // If requested in the load options, apply scaling from optional 'from' to 'to' units.
    // If unpecified, then units will be read from the models metadata.
    // * usage overloads
    //      options.appyScaling: { from: 'ft', to: 'm' }
    //      options.appyScaling: 'm'   ( equivalent to { to: 'm' })
    // * this is aimed at multiple 3D model situations where models potentialy have different units, but
    //   one  doesn't up-front know what these units are.It also allows overriding of such units.
    // * Model methods: getUnitString , getUnitScale &  getDisplayUnit will be automatically return corrected values
    //   as long as there are no additional options.placementTransform scalings applied.
    if (loadContext.applyScaling) {

        // default 'from' & 'to'  units are from metadata, or 'm' not present
        var scalingFromUnit = 'm';
        if (svf.metadata["distance unit"]) {
            scalingFromUnit = svf.metadata["distance unit"]["value"];
        }
        svf.scalingUnit = scalingFromUnit;

        if('object' === typeof(loadContext.applyScaling)){
            if(loadContext.applyScaling.from) {
                scalingFromUnit = loadContext.applyScaling.from;
            }
            if(loadContext.applyScaling.to) {
               svf.scalingUnit = loadContext.applyScaling.to;
            }
        } else {
            svf.scalingUnit = loadContext.applyScaling;
        }


        // Work out overall desired scaling factor.
        var scalingFactor = getUnitScale(scalingFromUnit) / getUnitScale(svf.scalingUnit);

        if(1 != scalingFactor) {

            var placementS = new LmvMatrix4(true);

             var scalingTransform = new LmvMatrix4(true);
             scalingTransform.elements[0] = scalingFactor;
             scalingTransform.elements[5]  = scalingFactor;
             scalingTransform.elements[10] = scalingFactor;

            if (loadContext.placementTransform) {
                // There may well already be a placementTransform from previous options/operations.
                placementS.copy(loadContext.placementTransform);

            }

            // Combine (optional) placementTransform with scaling
            if (loadContext.applyPlacementInModelUnits) {
                // Apply placementMatrix first, then scale to viewer world units. In this way,
                // the placementMatrix is handled in the same way as a refPointTransform.
                loadContext.placementTransform = scalingTransform.multiply(placementS);                
            } else {
                // Apply unitScaling first, then placementTransform
                loadContext.placementTransform = placementS.multiply(scalingTransform);
            }
            svf.placementTransform = loadContext.placementTransform;

            // Store scalingFactor, so that we know which unitScaling was applied to this model.
            // Multiplying with this factor converts model file units to viewer world units.
            svf.scalingFactor = scalingFactor;
        }
    }


    var custom_values = svf.metadata["custom values"];

    if (custom_values && custom_values.refPointTransform) {

        svf.refPointTransform = new LmvMatrix4(true);
        var e = svf.refPointTransform.elements;
        var src =  custom_values.refPointTransform;

        e[0] = src[0];
        e[1] = src[1];
        e[2] = src[2];

        e[4] = src[3];
        e[5] = src[4];
        e[6] = src[5];

        e[8] = src[6];
        e[9] = src[7];
        e[10] = src[8];

        e[12] = src[9];
        e[13] = src[10];
        e[14] = src[11];

    } else {
        //Is there an extra offset specified in the georeference?
        //This is important when aggregating Revit models from the same Revit
        //project into the same scene, because Revit SVFs use RVT internal coordinates, which
        //need extra offset to get into the world space.
        var georeference = svf.metadata["georeference"];
        var refPointLMV = georeference && georeference["refPointLMV"];

        var angle = 0;
        if (custom_values && custom_values.hasOwnProperty("angleToTrueNorth")) {
            angle = (Math.PI / 180.0) * custom_values["angleToTrueNorth"];
        }

        if (refPointLMV || angle) {

            var rotation = new LmvMatrix4(true);
            var m = rotation.elements;
            m[0] = m[5] = Math.cos(angle);
            m[1] = -Math.sin(angle);
            m[4] = Math.sin(angle);

            //refPointLMV is given in model local coordinates, hence the negation needed
            //to make the translation go from local to shared coordinates.
            var offset = new LmvMatrix4(true);
            m = offset.elements;
            if (refPointLMV) {
                m[12] = -refPointLMV[0];
                m[13] = -refPointLMV[1];
                m[14] = -refPointLMV[2];
            }

            //Compose the rotation and offset.
            svf.refPointTransform = rotation.multiply(offset);
        }
    }

    //If request in the load options, apply the reference point transform when loading the model
    if (loadContext.applyRefPoint && svf.refPointTransform) {

        var placement = new LmvMatrix4(true);

        //Normally we expect the input placement transform to come in as identity in case
        //we have it specified in the georef here, but, whatever, let's be thorough for once.
        if (loadContext.placementTransform)
            placement.copy(loadContext.placementTransform);

        placement.multiply(svf.refPointTransform);

        svf.placementTransform = loadContext.placementTransform = placement;

    } else if (!loadContext.applyRefPoint && loadContext.placementTransform) {

        //In case we are given a placement transform that overrides the icoming refPointTransform

        svf.placementTransform = new LmvMatrix4(true).copy(loadContext.placementTransform);

    }

    if (svf.placementTransform && isIdentity(svf.placementTransform))
        svf.placementTransform = null;

    return svf.placementTransform;
}

export function calculatePlacementWithOffset(svf, pt) {
    var go = svf.globalOffset;
    if (go.x || go.y || go.z) {
        if (!pt) {
            pt = new LmvMatrix4(true);
            pt.makeTranslation(-go.x, -go.y, -go.z);
        } else {
            var pt2 = new LmvMatrix4(true);
            pt2.copy(pt);
            pt = pt2;
            pt.elements[12] -= go.x;
            pt.elements[13] -= go.y;
            pt.elements[14] -= go.z;
        }

        svf.placementWithOffset = pt;
    } else {
        svf.placementWithOffset = pt;
    }
}

export function initPlacement(svf, loadContext) {

    if (!svf.metadata)
        return;

    //Retrieve world bounding box
    var bbox = svf.metadata["world bounding box"];
    var min = new LmvVector3(bbox.minXYZ[0], bbox.minXYZ[1], bbox.minXYZ[2]);
    var max = new LmvVector3(bbox.maxXYZ[0], bbox.maxXYZ[1], bbox.maxXYZ[2]);
    svf.bbox = new LmvBox3(min, max);
    svf.modelSpaceBBox = svf.bbox.clone();

    var pt = derivePlacementTransform(svf, loadContext);
    if (pt && !svf.bbox.isEmpty()) {
        svf.bbox.applyMatrix4(pt);
    }

    //Global offset is used to avoid floating point precision issues for models
    //located enormous distances from the origin. The default is to move the model to the origin
    //but it can be overridden in case of model aggregation scenarios, where multiple
    //models are loaded into the scene and a common offset is needed for all.
    if (loadContext.globalOffset) {
        // Apply user-defined globalOffset
        svf.globalOffset = loadContext.globalOffset;
    } else {
        // Choose global offset automatically at the center of the placmenent transformed model. 
        svf.globalOffset = svf.bbox.getCenter(new LmvVector3());
    }

    calculatePlacementWithOffset(svf, pt);

    // The model boundingBox must finally be in viewer-coords, just like everything else. I.e. with subtracted offset.
    // Therefore, we have to subtract the globaloffset from bbox as well.
    if (!svf.bbox.isEmpty()) {
        svf.bbox.min.sub(svf.globalOffset);
        svf.bbox.max.sub(svf.globalOffset);
    }

    if (svf.metadata.hasOwnProperty("double sided geometry")
        && svf.metadata["double sided geometry"]["value"]) //TODO: do we want to check the global flag or drop that and rely on material only?
    {
        svf.doubleSided = true;
    }

}

function applyOffset(a, offset) {
    a[0] -= offset.x;
    a[1] -= offset.y;
    a[2] -= offset.z;
}


export function transformAnimations(svf) {

    if (!svf.animations)
        return;

    // apply global offset to animations
    var animations = svf.animations["animations"];
    if (animations) {
        var globalOffset = svf.globalOffset;
        var t = new LmvMatrix4().makeTranslation(globalOffset.x, globalOffset.y, globalOffset.z);
        var tinv = new LmvMatrix4().makeTranslation(-globalOffset.x, -globalOffset.y, -globalOffset.z);
        var r = new LmvMatrix4();
        var m = new LmvMatrix4();
        for (var a = 0; a < animations.length; a++) {
            var anim = animations[a];
            if (anim.hierarchy) {
                for (var h = 0; h < anim.hierarchy.length; h++) {
                    var keys = anim.hierarchy[h].keys;
                    if (keys) {
                        for (var k = 0; k < keys.length; k++) {
                            var pos = keys[k].pos;
                            if (pos) {
                                var offset = globalOffset;
                                var rot = keys[k].rot;
                                if (rot) {
                                    r.makeRotationFromQuaternion({x:rot[0], y:rot[1], z:rot[2], w:rot[3]});
                                    m.multiplyMatrices(t, r).multiply(tinv);
                                    offset = {x: m.elements[12], y: m.elements[13], z: m.elements[14]};
                                }
                                applyOffset(pos, offset);
                            }
                            var target = keys[k].target;
                            if (target) {
                                applyOffset(target, globalOffset);
                            }
                            var points = keys[k].points;
                            if (points) {
                                for (var p = 0; p < points.length; p++) {
                                    applyOffset(points[p], globalOffset);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// Apply transform (if any) to given camera data with { position, target, up, orthoScale }
export function transformCameraData(cam, transform) {

    if (!transform) {
        return;
    }

    transform.transformPoint(cam.position);
    transform.transformPoint(cam.target);
    transform.transformDirection(cam.up);

    // If the placement includes scaling (either by unit scaling or manually included 
    // in the placement transform), orthoScale values need to be scaled as well.
    //
    // Note: We don't support non-uniform scaling well. However, home-views cannot be recovered
    //       anyway if the model is distorted with non-uniform transforms.
    if (isFinite(cam.orthoScale)) {
        const scale = transform.getMaxScaleOnAxis();
        cam.orthoScale *= scale;
    }
}
