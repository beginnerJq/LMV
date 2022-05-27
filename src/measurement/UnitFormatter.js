
import i18n from "i18next";
const FORGE_UNITS = require("./units-compact");
import { getUnitEnum } from './DisplayUnits';

/**
 * Model units enum
 * @memberof Autodesk.Viewing.Private
 * @alias Autodesk.Viewing.Private#ModelUnits
 */
export var ModelUnits = {
    METER       : 'm',
    CENTIMETER  : 'cm',
    MILLIMETER  : 'mm',
    FOOT        : 'ft',
    INCH        : 'in',
    POINT       : 'pt'
};

const UnitScales = {
    [ModelUnits.METER]          : 1.0,
    [ModelUnits.CENTIMETER]     : 0.01,
    [ModelUnits.MILLIMETER]     : 0.001,
    [ModelUnits.FOOT]           : 0.3048,
    [ModelUnits.INCH]           : 0.0254,
    [ModelUnits.POINT]          : 0.0254 / 72 //A typographical point is 1/72 of an international inch
};

function getExponentSymbol(exponent) {
    let exponentSymbol = '';
    if (exponent === 2) {
        exponentSymbol = String.fromCharCode(0xb2);
    } else if (exponent === 3) {
        exponentSymbol = String.fromCharCode(0xb3);
    }
    return exponentSymbol;
}

function modf(x) {
    var intPart = (0 <= x) ? Math.floor(x) : Math.ceil(x),
        fracPart = x - intPart;
    return {intPart: intPart, fracPart: fracPart};
}

function formatNumber(x, precision, needMinusSign) {
    var result = '';

    if (needMinusSign && x === 0) {
        result += '-';
    }

    //According to Shawn's request, do not truncate trailing .0's
    //if (modf(x).fracPart === 0) {
    //
    //    // No fractional part.
    //    //
    //    result += x;
    //
    //} else if (0 < precision) {
    if (0 < precision) {

        // Truncate any trailing .0's.
        //
        //var s = x.toFixed(precision);
        //var re = /^\-?([0-9]+)\.0+$/;
        //var m = re.exec(s);
        //if (m !== null) {
        //    result += m[1];
        //} else {
        //    result += s;
        //}

        result += x.toFixed(precision);

    } else {
        result += x.toFixed(0);
    }

    return result;
}

function formatFeet(value, precision, inchesOnly, symbols) {

    // Borrowed from AdCoreUnits PrimeDoublePrimeSymbol2::Format

    var result = '',
        radix = 12.0,
        denominator = 1.0,
        isNegative = (value < 0);

    for (var i = 0; i < precision; ++i) {
        denominator *= 2.0;
    }

    // round to the nearest 1/denominator
    if (value > 0) {
        value += 0.5/denominator;
    } else {
        value -= 0.5/denominator;
    }

    var primeValue, doublePrimeValue;

    if (!inchesOnly) {
        primeValue = modf(value/radix).intPart;
        result += formatNumber(primeValue, 0, isNegative) + symbols.feet + ' ';
        doublePrimeValue = value - (primeValue * radix);
        if (doublePrimeValue < 0) {
            doublePrimeValue = -doublePrimeValue;
        }

    } else {
        doublePrimeValue = value;
    }

    var intPart = modf(doublePrimeValue).intPart;
    var numerator = modf((doublePrimeValue - intPart) * denominator).intPart;

    if (numerator === 0 || intPart !== 0) {
        result += formatNumber(intPart, 0);
    }

    if (numerator !== 0) {
        if (intPart < 0 && numerator < 0) {
            numerator = -numerator;
        }
        while (numerator % 2 === 0) {
            numerator /= 2;
            denominator /= 2;
        }
        if (intPart !== 0) {
            result += '-';
        }
        result += formatNumber(numerator, 0) + '/' + formatNumber(denominator, 0);
    }

    result += symbols.inches;
    return result;
}

function formatMeterAndCentimeter(value, precision, exponent = 1) {
    var sign = '';
    if (value < 0) {
        sign = '-';
        value = Math.abs(value);
    }
    var modfValue = modf(value),
        mValue = modfValue.intPart,
        cmValue = modfValue.fracPart * Math.pow(100.0, exponent);

    const exponentSymbol = getExponentSymbol(exponent);

    let formattedMValue = formatNumber(mValue, 0);
    let formattedCmValue = formatNumber(cmValue, precision);

    if (formattedCmValue.startsWith(Math.pow(100.0, exponent).toString())) {
        formattedMValue = formatNumber(mValue + 1, 0);
        formattedCmValue = formatNumber(0, precision);
    }

    return sign + formattedMValue + ` m${exponentSymbol} ` + formattedCmValue + ` cm${exponentSymbol}`;
}

function formatFeetAndDecimalInches(value, precision, symbols, exponent = 1) {
    var sign = '';
    if (value < 0) {
        sign = '-';
        value = Math.abs(value);
    }
    var modfValue = modf(value),
        ftValue = modfValue.intPart,
        inValue = modfValue.fracPart * Math.pow(12.0, exponent);

    const exponentSymbol = getExponentSymbol(exponent);

    let formattedFtValue = formatNumber(ftValue, 0);
    let formattedInValue = formatNumber(inValue, precision);

    if (formattedInValue.startsWith(Math.pow(12.0, exponent).toString())) {
        formattedFtValue = formatNumber(ftValue + 1, 0);
        formattedInValue = formatNumber(0, precision);
    }

    return sign
        + formattedFtValue + symbols.feet + exponentSymbol + ' '
        + formattedInValue + symbols.inches + exponentSymbol;
}


//Hardcoded Forge units that imply specific symbol formatting
//TODO: Not all of these are supported by the formatting code in LMV,
//so some are commented out.
const customFormattingMap = {
    feetFractionalInches: "ft-and-fractional-in",
    fractionalInches: "fractional-in",
    feet: "feet",
    inches: "inches",
    /*
    metersCentimeters: "meters",
    degreesMinutes: "degrees",
    slopeDegrees: "degrees",
    */
    stationingFeet: "feet",
    /*
    stationingMeters: "meters",
    stationingSurveyFeet: "usSurveyFeet"
     */
};

function forgeUnitToSymbol(units) {

    /**
     * The Forge unit mapping file (units.json and units-compact.json) is generated from the Forge schema files.
     * The script that does that is located here: https://git.autodesk.com/constructwin/dt-schemas
     */

    if (!units || !units.startsWith("autodesk.unit.unit:"))
        return units;

    let schemaName = units.split(":")[1];
    let unitId = schemaName.split("-")[0];
    let unitDef = FORGE_UNITS.unit[unitId];
    if (unitDef) {
        let customFormattingStyle = customFormattingMap[unitId];
        if (customFormattingStyle) {
            return customFormattingStyle;
        }
        //If there is no custom formatting for this unit, use its schema symbol
        if (!unitDef.symbols) {
            console.warn("Unit without symbols.", unitDef);
            return "";
        }
        //If there is a default symbol for this unit, use it
        if (unitDef.defaultSymbol && unitDef.symbols[unitDef.defaultSymbol]) {
            return unitDef.symbols[unitDef.defaultSymbol];
        }
        //There can be multiple symbols, we pick the first one.
        for (let s in unitDef.symbols) {
            return unitDef.symbols[s];
        }
    } else {
        console.warn("Failed to find Forge unit schema for", units);
        return units;
    }

}

function formatWithSymbol(value, symbol) {
    const spacing = symbol.space ? ' ' : '';
    if (symbol.placement === 'Prefix') {
        return symbol.text + spacing + value;
    } else { // Assuming 'Suffix' placement by default
        return value + spacing + symbol.text;
    }
}


/**
 * Formats a value with units
 * @param {number} value
 * @param {string} units - GNU units format or Forge Unit ID (see https://git.autodesk.com/forge/HFDMSchemas/tree/master/schemas/autodesk/unit)
 * @param {number} type - For example: 1=boolean, 2=integer, 3=double, 20=string, 24=Position
 * @param {number} precision - required precision.
 * @param {Object} [options] - An optional dictionary of options.
 * @param {boolean} [options.noMixedArea] - For mixed area units such as 'm-and-cm', fallback to the larger unit.
 * @param {boolean} [options.noMixedVolume] - For mixed volume units such as 'm-and-cm', fallback to the larger unit.
 * @param {boolean} [options.preferLetters] - For inches and feet, use 'in' and 'ft' over ' and " respectively.
 * see https://git.autodesk.com/A360/platform-translation-propertydb/blob/master/propertydb/PropertyDatabase.h
 * @returns {string} formatted value
 */
export function formatValueWithUnits(value, units, type, precision, options) {

    var result;

    if (precision === null || precision === undefined) {
        precision = 3;
    }

    options = options || {};
    const feetAndInchesSymbols = options.preferLetters ? { feet: ' ft', inches: ' in' } : { feet: '\'', inches: '"'};

    //Is it a Forge unit?
    units = forgeUnitToSymbol(units);

    // TODO(go) - 20150504: Ideally this would be handled better: according to the git file at the top property types can be 0,1,2,3,10,11,20,21,22,23,24
    // TODO(go) - 20150504: The code below only handle Boolean (1) Integer (2) and double (3). Not sure how well the property types are assigned so using
    // TODO(go) - 20150504: try catch for now.
    try {

        if (type === 1) { // Boolean
            result = i18n.t(value ? 'Yes' : 'No');

        } else if (type === 24) { // Position
            var position = value.split(' ');
            result = [];

            for(var i = 0; i < position.length; ++i) {
                result.push(formatValueWithUnits(parseFloat(position[i]), units, 3, precision));
            }

            result = result.join(', ');

        } else if ((type === 2 || type === 3) && isNaN(value)) {
            result = 'NaN';

        } else if (units === 'ft-and-fractional-in') {
            result = formatFeet(value * 12.0, precision, false, feetAndInchesSymbols);

        } else if (units === 'ft-and-fractional-in^2') {
            result = options.noMixedArea
                ? formatNumber(value, precision) + ' ft' + getExponentSymbol(2)
                : formatFeet(value * 12.0, precision, false, feetAndInchesSymbols) + ' ' + getExponentSymbol(2);

        } else if (units === 'ft-and-fractional-in^3') {
            result = options.noMixedVolume
                ? formatNumber(value, precision) + ' ft' + getExponentSymbol(3)
                : formatFeet(value * 12.0, precision, false, feetAndInchesSymbols) + ' ' + getExponentSymbol(3);

        } else if (units === 'ft-and-decimal-in') {
            result = formatFeetAndDecimalInches(value, precision, feetAndInchesSymbols);

        } else if (units === 'ft-and-decimal-in^2') {
            result = options.noMixedArea
                ? formatNumber(value, precision) + ' ft' + getExponentSymbol(2)
                : formatFeetAndDecimalInches(value, precision, feetAndInchesSymbols, 2);

        } else if (units === 'ft-and-decimal-in^3') {
            result = options.noMixedVolume
                ? formatNumber(value, precision) + ' ft' + getExponentSymbol(3)
                : formatFeetAndDecimalInches(value, precision, feetAndInchesSymbols, 3);

        } else if (units === 'decimal-in' || units === 'in' || units === 'inch' || units === 'inches') {
            result = formatNumber(value, precision) + feetAndInchesSymbols.inches;

        } else if (units === 'decimal-in^2' || units === 'in^2' || units === 'inch^2') {
            result = formatNumber(value, precision) + ' in' + getExponentSymbol(2);

        } else if (units === 'decimal-in^3' || units === 'in^3' || units === 'inch^3') {
            result = formatNumber(value, precision) + ' in' + getExponentSymbol(3);

        } else if (units === 'decimal-in-sq' || units === 'fractional-in-sq') {
            result = formatNumber(value, precision) + ' sq. in';

        } else if (units === 'decimal-ft' || units === 'ft' || units === 'feet' || units === 'foot') {
            result = formatNumber(value, precision) + feetAndInchesSymbols.feet;

        } else if (units === 'decimal-ft^2' || units === 'ft^2' || units === 'feet^2' || units === 'foot^2') {
            result = formatNumber(value, precision) + ' ft' + getExponentSymbol(2);

        } else if (units === 'decimal-ft^3' || units === 'ft^3' || units === 'feet^3' || units === 'foot^3') {
            result = formatNumber(value, precision) + ' ft' + getExponentSymbol(3);

        } else if (units === 'decimal-ft-sq' || units === 'ft-and-fractional-in-sq' || units === 'ft-and-decimal-in-sq') {
            // Not mixing feet and inches in area measurements for this unit set, instead just show square feet.
            result = formatNumber(value, precision) + ' sq. ft';

        } else if (units === 'fractional-in') {
            result = formatFeet(value, precision, true, feetAndInchesSymbols);

        } else if (units === 'fractional-in^2') {
            result = formatFeet(value, precision, true, feetAndInchesSymbols) + getExponentSymbol(2);

        } else if (units === 'fractional-in^3') {
            result = formatFeet(value, precision, true, feetAndInchesSymbols) + getExponentSymbol(3);

        } else if (units === 'm-and-cm') {
            result = formatMeterAndCentimeter(value, precision);

        } else if (units === 'm-and-cm^2') {
            result = options.noMixedArea
                ? formatNumber(value, precision) + ' m' + getExponentSymbol(2)
                : formatMeterAndCentimeter(value, precision, 2);

        } else if (units === 'm-and-cm^3') {
            result = options.noMixedVolume
                ? formatNumber(value, precision) + ' m' + getExponentSymbol(3)
                : formatMeterAndCentimeter(value, precision, 3);

        } else if (units && units.text) {
            const formattedValue = type === 3 ? formatNumber(value, precision) : value;
            result = formatWithSymbol(formattedValue, units);

        } else if (type === 3 && units) { // Double, with units
            units = units.replace("^2", getExponentSymbol(2));
            units = units.replace("^3", getExponentSymbol(3));
            result = formatNumber(value, precision) + ' ' + units;

        } else if (units) {
            result = value + ' ' + units;

        } else if (type === 3) { // Double, no units
            result = formatNumber(value, precision);

        } else {
            result = value;
        }

    } catch (e) {

        if (units) {
            result = value + ' ' + units;
        } else {
            result = value;
        }
    }

    return result;
}

/**
 * @private
 * Converts a unit string from model metadata to standard format. The unit string can vary based on source product
 * and this function normalizes it.
 * @memberof Autodesk.Viewing.Private
 * @alias Autodesk.Viewing.Private#fixUnitString
 */
export function fixUnitString(unit) {
    unit = unit?.toLowerCase();
    //Why are translators not using standard strings for those?!?!?!?
    switch (unit) {
        case 'meter'      :
        case 'meters'     :
        case 'm'          :
            return ModelUnits.METER;
        case 'foot'       :
        case 'feet'       :
        case 'ft'         :
            return ModelUnits.FOOT;
        case 'feet and inches':
        case 'inch'       :
        case 'inches'     :
        case 'in'         :
            return ModelUnits.INCH;
        case 'centimeter' :
        case 'centimeters':
        case 'cm'         :
            return ModelUnits.CENTIMETER;
        case 'millimeter' :
        case 'millimeters':
        case 'mm'         :
            return ModelUnits.MILLIMETER;
        case 'point'       :
        case 'points'     :
        case 'pt'         :
            return ModelUnits.POINT;
        default:
            return unit;
    }
}

/**
 * Returns an object that contains the standard unit string (unitString) and the scale value (unitScale).
 * @param {string} unit - Unit name from the metadata
 * @returns {object} this object contains the standardized unit string (unitString) and a unit scaling value (unitScale)
 *
 * @memberof Autodesk.Viewing.Private
 * @alias Autodesk.Viewing.Private#getUnitData
 */
export function getUnitData(unit)
{
    let unitString = fixUnitString(unit);
    return {
        unitString: unitString,
        unitScale: UnitScales[unitString] || 1.0
    };
}

/**
 * Convert distance from unit to unit.
 * @param {string} fromUnits - GNU units format - units to convert from
 * @param {string} toUnits - GNU units format - units to convert to
 * @param {number} calibrationFactor - Calibration Factor of the model
 * @param {number} d - distance to convert
 * @param {string} type - default for distance, "square" for area
 * @param {string} dpi - Used to convert points units. default is 72 DPI.
 * @memberof Autodesk.Viewing.Private
 * @alias Autodesk.Viewing.Private#convertUnits*
 * @returns {number} - distance after conversion.
 */
export function convertUnits(fromUnits, toUnits, calibrationFactor, d, type, dpi) {

    fromUnits = fixUnitString(fromUnits);
    toUnits = fixUnitString(toUnits);

    calibrationFactor = calibrationFactor ? calibrationFactor : 1;
    dpi = dpi || 72;

    if (fromUnits === toUnits && calibrationFactor === 1)
        return d;

    const M = ModelUnits;
    const U = UnitScales;

    var toFactor = 1;
    switch (toUnits) {
        case M.MILLIMETER: toFactor = 1/U[M.MILLIMETER]; break;
        case M.CENTIMETER: toFactor = 1/U[M.CENTIMETER]; break;
        case M.METER : toFactor = 1; break;
        case M.INCH: toFactor = 1/U[M.INCH]; break;
        case M.FOOT: toFactor = 1/U[M.FOOT]; break;
        case "ft-and-fractional-in": toFactor = 1/U[M.FOOT]; break;
        case "ft-and-decimal-in": toFactor = 1/U[M.FOOT]; break;
        case "decimal-in": toFactor = 1/U[M.INCH]; break;
        case "decimal-ft": toFactor = 1/U[M.FOOT]; break;
        case "fractional-in": toFactor = 1/U[M.INCH]; break;
        case "m-and-cm": toFactor = 1; break;
        case M.POINT: toFactor = 1/U[M.INCH] * dpi; break;
    }

    var fromFactor = 1;
    switch (fromUnits) {
        case M.MILLIMETER: fromFactor = U[M.MILLIMETER]; break;
        case M.CENTIMETER: fromFactor = U[M.CENTIMETER]; break;
        case M.METER : fromFactor = U[M.METER]; break;
        case M.INCH: fromFactor = U[M.INCH]; break;
        case M.FOOT: fromFactor = U[M.FOOT]; break;
        case "ft-and-fractional-in": fromFactor = U[M.FOOT]; break;
        case "ft-and-decimal-in": fromFactor = U[M.FOOT]; break;
        case "decimal-in": fromFactor = U[M.INCH]; break;
        case "decimal-ft": fromFactor = U[M.FOOT]; break;
        case "fractional-in": fromFactor = U[M.INCH]; break;
        case "m-and-cm": fromFactor = 1; break;
        case M.POINT: fromFactor = U[M.INCH] / dpi; break;
    }

    if (type === "square") {
        return d ? (d * Math.pow(toFactor * fromFactor * calibrationFactor, 2)) : 0;
    } else if (type === "cube") {
        return d ? (d * Math.pow(toFactor * fromFactor * calibrationFactor, 3)) : 0;
    }
    return d ? (d * toFactor * fromFactor * calibrationFactor) : 0;
}

/**
 * Count the number of digits after the floating point of a given number.
 * If the numer is a fraction, count the power of 2 of the denominator.
 * @param {string | number} number.
 * @returns {number} - number of digits after the floating point of the given number.
 */

export function calculatePrecision(number) {

    if (!number)
        return 0;

    var digits = number.toString().split(".")[1];

    // Try fractional number
    if (!digits) {
        var denominatorStrRaw = number.toString().split("/")[1];
        var denominatorNumberStr = denominatorStrRaw && denominatorStrRaw.match(/\d+/);
        if (denominatorNumberStr) {
            var denominator = parseFloat(denominatorNumberStr);
            if (denominator && !isNaN(denominator)) {
                return Math.floor(Math.log2(denominator));
            }
        }

        return 0;
    }
    digits = digits.match(/\d+/);
    return (digits && digits[0] && digits[0].length) || 0;
}


/**
 * Convert from source to target units
 * Only source units of type distance, area and volume will be converted. 
 * For any other type, the source value is returned without conversion
 * @param {number} value
 * @param {number} valueType - For example: 1=boolean, 2=integer, 3=double, 20=string, 24=Position
 * @param {string} sourceUnits
 * @param {string} targetUnits
 */
export function convertToDisplayUnits(value, valueType, sourceUnits, targetUnits) {
    if (!sourceUnits || !targetUnits) {
        return { displayValue: value, displayUnits: sourceUnits };
    }

    let baseUnits = sourceUnits;
    let displayUnits = targetUnits;

    // transform forge units
    const forgeUnits = forgeUnitToSymbol(baseUnits);
	if (typeof forgeUnits === 'object' && 'text' in forgeUnits) {
        baseUnits = forgeUnits.text;
    }

    if (baseUnits) {
        // take care of area and volume
        baseUnits = baseUnits.replace(/²$/, '^2').replace(/³$/, '^3');
    }

    // Area or volume?
    let distanceType;
    if (/\^2$/.test(baseUnits)) {
	    baseUnits = baseUnits.replace('^2', '');
	    displayUnits += '^2';
	    distanceType = "square";
    } else if (/\^3$/.test(baseUnits)) {
	    baseUnits = baseUnits.replace('^3', '');
	    displayUnits += '^3';
	    distanceType = "cube";
    }

    // Skip conversion if source unit is not a supported display unit
    // for e.g., mass and density
    baseUnits = getUnitEnum(baseUnits);
    if (baseUnits === null) {
        return { displayValue: value, displayUnits: sourceUnits };
    }

    // Only convert numerical values
    if (valueType === 2 /*integer*/ || valueType === 3 /*double*/) {
        const displayValue = convertUnits(baseUnits, targetUnits, 1, value, distanceType, null);
        return { displayValue: displayValue, displayUnits: displayUnits };
    } else if (valueType === 24 /*position*/) {
        const position = value
          .split(' ')
          .map(v => convertUnits(baseUnits, targetUnits, 1, v, distanceType, null))
          .join(' ');

        return { displayValue: position, displayUnits: displayUnits };
    }


    return { displayValue: value, displayUnits: sourceUnits };
}

// Simplifies combined unit strings to just the main unit alone. 
// Example: "ft-and-fractional-in" => "ft"
export function getMainUnit(unit) {
    switch(unit) {
        case 'decimal-ft':
        case 'ft-and-fractional-in':
        case 'ft-and-decimal-in':
            return 'ft';

        case 'decimal-in':
        case 'fractional-in':
            return 'in';
        
        case 'm-and-cm':
            return 'm';
    }
    return unit;
}
