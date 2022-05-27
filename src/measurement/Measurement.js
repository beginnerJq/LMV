
import { SnapResult } from "./SnapResult";
import { MeasurementTypes } from "./MeasurementTypes";
import { getSnapResultPosition, isEqualVectors, EPSILON, computeResult } from "./MeasureCommon";

/**
 * This is a DATA container class.
 * No rendering should be attached to it.
 * @private
 */
export function Measurement(measurementType, id, options) {

    this.measurementType = measurementType;
    this.id = id;
    this.picks = [];
    this.closedArea = false;
    this.isRestored = false;
    this.options = options;

    this.resetMeasureValues();
}

/**
 * Returns a clone of itself.
 */
Measurement.prototype.clone = function() {
    const measurement = new Measurement(this.measurementType, this.id, this.options);
    measurement.closedArea = this.closedArea;
    measurement.isRestored = this.isRestored;
    measurement.picks = this.clonePicks();
    measurement.angle = this.angle;
    measurement.distanceX = this.distanceX;
    measurement.distanceY = this.distanceY;
    measurement.distanceZ = this.distanceZ;
    measurement.distanceXYZ = this.distanceXYZ;
    measurement.arc = this.arc;
    measurement.location = this.location?.clone();
    measurement.result = Object.assign({}, this.result);
    return measurement;
};

Measurement.prototype.resetMeasureValues = function() {

    this.angle = 0;
    this.distanceX = 0;
    this.distanceY = 0;
    this.distanceZ = 0;
    this.distanceXYZ = 0;
    this.arc = 0;
    this.location = null;
    this.result = null;
};

Measurement.prototype.setPick = function(index, value) {
    
    var pick = this.picks[index] = value;
    pick.id = parseInt(index);
    return pick;
};

Measurement.prototype.getPick = function(index) {
    
    var pick = this.picks[index];
    
    if (!pick) {
        pick = this.setPick(index, new SnapResult());
    }

    return pick;
};


Measurement.prototype.clonePicks = function(index) {
    
    var picks = [];
    for (var key in this.picks) {
        if (Object.prototype.hasOwnProperty.call(this.picks, key)) {
            var pick = this.picks[key];
            picks.push(pick.clone());
        }
    }
    return picks;
};


Measurement.prototype.countPicks = function() {
    
    return Object.keys(this.picks).length;
};

Measurement.prototype.getMaxNumberOfPicks = function() {
    
    switch (this.measurementType) {
        case MeasurementTypes.MEASUREMENT_DISTANCE:
        case MeasurementTypes.MEASUREMENT_LOCATION:
        case MeasurementTypes.MEASUREMENT_CALLOUT:
        case MeasurementTypes.MEASUREMENT_ARC:
            return 2;

        case MeasurementTypes.MEASUREMENT_ANGLE:
            return 3;

        case MeasurementTypes.MEASUREMENT_AREA:
            return this.closedArea ? this.countPicks() : Number.MAX_VALUE - 1;
    }
};

Measurement.prototype.hasPick = function(pickNumber) {
    
    return (this.picks[pickNumber] && !this.picks[pickNumber].isEmpty()) || this.isRestored;
};

Measurement.prototype.isComplete = function() {
    var complete = this.countPicks() === this.getMaxNumberOfPicks();

    for (var key in this.picks) {
        if (Object.prototype.hasOwnProperty.call(this.picks, key)) {
            complete = complete && this.hasPick(key);

            if (!complete)
                break;
        }
    }

    return complete;
};

Measurement.prototype.isEmpty = function() {
    var empty = true;

    for (var key in this.picks) {
        if (Object.prototype.hasOwnProperty.call(this.picks, key)) {
            empty = empty && !this.hasPick(key);

            if(!empty)
                break;
        }
    }

    return empty;
};

Measurement.prototype.clearPick = function(pickNumber) {

    if (this.picks[pickNumber]) {
        this.picks[pickNumber].clear();   
    }

    this.resetMeasureValues();
};

Measurement.prototype.clearAllPicks = function() {
    
    for (var key in this.picks) {
        if (Object.prototype.hasOwnProperty.call(this.picks, key)) {
            this.clearPick(key);
        }
    }
};

Measurement.prototype.hasEqualPicks = function(firstPick, secondPick) {
    if (!firstPick || !secondPick)
        return false;

    if (firstPick.geomType === secondPick.geomType) {
        var first = getSnapResultPosition(firstPick);
        var second = getSnapResultPosition(secondPick);
        return isEqualVectors(first, second, EPSILON);
    }

    return false;
};

/**
 * Calculates distance/angle based on the values of the picks
 * and stores it in .result
 */
Measurement.prototype.computeResult = function(picks, viewer) {

    this.resetMeasureValues();

    if (!viewer.model) {
        this.result = null;
        return false;
    }
    
    // Compute and check if there's a result
    var result = this.result = computeResult(picks, this.measurementType, viewer, this.options);
    
    if (result === null) {
        return !this.isComplete();
    }
    
    switch (result.type) {
        case MeasurementTypes.MEASUREMENT_DISTANCE:
            this.distanceXYZ = result.distanceXYZ;
            this.distanceX = result.distanceX;
            this.distanceY = result.distanceY;
            this.distanceZ = result.distanceZ;
            return true;

        case MeasurementTypes.MEASUREMENT_ANGLE:
            this.angle = isNaN(result.angle) ? 0 : result.angle;
            return true;

        case MeasurementTypes.MEASUREMENT_AREA:
            this.area = result.area;
            return true;
            
        case MeasurementTypes.MEASUREMENT_ARC:
            this.arc = result.arc;
            return true;

        case MeasurementTypes.MEASUREMENT_LOCATION:
            this.location = result.location;
            return true;

        case MeasurementTypes.MEASUREMENT_CALLOUT:
            return true;
            
        default:
            return false;
    }
};

Measurement.prototype.getGeometry = function (pickNumber) {
    return {"type": this.picks[pickNumber].geomType, "geometry": this.picks[pickNumber].getGeometry()};
};

// TODO: Move this method elsewhere. This is a data-only class.
Measurement.prototype.attachIndicator = function (viewer, tool, indicatorClass) {
    this.indicator = new indicatorClass(viewer, this, tool);
    this.indicator.init();
};
