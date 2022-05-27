
export var MeasureEvents = {
    MEASUREMENT_CHANGED_EVENT: 'measurement-changed',
    /**
     * Fired when all picks from a measurement have been set.
     *
     * @event Autodesk.MeasureEvents#MEASUREMENT_COMPLETED_EVENT
     * @property {object} data - Event object
     * @property {number} data.type - Measurement type
     * @property {number} data.id - Measurement id
     */
    MEASUREMENT_COMPLETED_EVENT: 'measurement-completed',
    UNITS_CALIBRATION_STARTS_EVENT: 'units_calibration_starts_event',
    FINISHED_CALIBRATION_FOR_DIMENSION_EVENT: 'finished_calibration_for_dimension_event',
    CALIBRATION_REQUIRED_EVENT: 'calibration-required',
    OPEN_CALIBRATION_PANEL_EVENT: 'open-calibration-panel',
    CLOSE_CALIBRATION_PANEL_EVENT: 'close-calibration-panel',
    CLEAR_CALIBRATION_SIZE_EVENT: 'clear-calibration-size',
    FINISHED_CALIBRATION: 'finished-calibration',
    DISPLAY_UNITS_CHANGED: 'display-units-changed',
    PRECISION_CHANGED: 'precision-changed', 
    MEASUREMENT_MODE_ENTER: 'measure-mode-enter',
    MEASUREMENT_MODE_LEAVE: 'measure-mode-leave',
    DELETE_MEASUREMENT: 'delete-measurement',
};
