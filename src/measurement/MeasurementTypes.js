
//TODO_TS: Rename this to singular
export var MeasurementTypes = {
    MEASUREMENT_DISTANCE:  1, // Measurement from point to point, not matter what geometry it is.
    MEASUREMENT_ANGLE: 2,
    MEASUREMENT_AREA: 3,
    CALIBRATION: 4,
    MEASUREMENT_CALLOUT: 5,
    MEASUREMENT_LOCATION: 6,
    MEASUREMENT_ARC: 7
};

export var MeasurementTypesToAnalytics = {
    [MeasurementTypes.MEASUREMENT_DISTANCE]: 'Distance',
    [MeasurementTypes.MEASUREMENT_ANGLE]: 'Angle',
    [MeasurementTypes.MEASUREMENT_AREA]: 'Area',
    [MeasurementTypes.CALIBRATION]: 'Calibration',
    [MeasurementTypes.MEASUREMENT_CALLOUT]: 'Callout',
    [MeasurementTypes.MEASUREMENT_LOCATION]: 'Location',
    [MeasurementTypes.MEASUREMENT_ARC]: 'Arc',
};
