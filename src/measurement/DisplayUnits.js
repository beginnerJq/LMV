import i18n from "i18next";

// Display units for the user to choose from
const DisplayUnits =  [
	{ name: 'File units', type: '' },
	{ name: 'Millimeters', type: 'mm', matches: ['millimeter', 'millimeters'] },
	{ name: 'Centimeters', type: 'cm', matches: ['centimeter', 'centimeters'] },
	{ name: 'Meters', type: 'm' },
	{ name: 'Inches', type: 'in', matches: ['inch', 'inches'] },
	{ name: 'Feet', type: 'ft', matches: ['foot'] },
	{ name: 'Feet and fractional inches', type: 'ft-and-fractional-in' },
	{ name: 'Feet and decimal inches', type: 'ft-and-decimal-in' },
	{ name: 'Decimal inches', type: 'decimal-in' },
	{ name: 'Decimal feet', type: 'decimal-ft' },
	{ name: 'Fractional inches', type: 'fractional-in' },
	{ name: 'Meters and centimeters', type: 'm-and-cm' },
	{ name: 'Points', type: 'pt', matches: ['point', 'points'] },
];

const Precision = [
  { name: 'File precision', value: '' },
  { name: '0 (1)', value: 0 },
  { name: '0.1 (1/2)', value: 1 },
  { name: '0.01 (1/4)', value: 2 },
  { name: '0.001 (1/8)', value: 3 },
  { name: '0.0001 (1/16)', value: 4 },
	{ name: '0.00001 (1/32)', value: 5 },
	{ name: '0.000001 (1/64)', value: 6 }
];

export const displayUnits = DisplayUnits.map(x => x.name);
export const displayUnitsEnum = DisplayUnits.map(x => x.type);

export const displayUnitsPrecision = Precision.map(x => x.name);
export const displayUnitsPrecisionEnum = Precision.map(x => x.value);


// Include translated names in the match
// This is to support variations such as mm, millimeters or millimeter, or their translated counterparts
DisplayUnits.forEach((unitDef) => {
	if (unitDef.matches) {
		const traslated = unitDef.matches.map(x => i18n.t(x));
		unitDef.matches = unitDef.matches.concat(traslated);
	}
});

const displayUnitsSet = new Set(displayUnitsEnum);

export function getUnitEnum(unit) {
	unit = unit && unit.toLocaleLowerCase();
	if (displayUnitsSet.has(unit)) {
		return unit;
	}

	// find a good enum match for the unit
	for (let i in DisplayUnits) {		
		const unitDef = DisplayUnits[i];
		const matches = unitDef.matches;
		if (matches && matches.indexOf(unit) > -1) {
			return unitDef.type;
		}
	}

	return null;
}