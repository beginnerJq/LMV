import { isNumericProperty } from '../file-loaders/lmvtk/common/PropdbEnums';

/**
 * The PropertySet class allows for aggregation of properties with the same names and categories.
 * To get an instance of this class use {@link Autodesk.Viewing.Model#getPropertySet}.
 *
 * @example
 *   const dbIds = viewer.getSelection();
 *   // Use the model's getPropertySet to get the PropertySet instance for the specified dbIds
 *   viewer.model.getPropertySet(dbIds).then((propSet) => {
 *      // iterate, aggregate, etc
 *   });
 *
 * @param {Object} result
 * @memberof Autodesk.Viewing
 * @alias Autodesk.Viewing.PropertySet
 * @class
 */
export class PropertySet {
    constructor(result) {
        this.map = result;
    }

    /**
     * This callback is displayed as a global member.
     * @callback forEachCallback
     * @param {string} key - string with a property's name and category separated by '/'
     * @param {Object[]} properties - an array of property objects associated with the key
     */

    /**
     * Iterates over all of the common properties. The callback is invoked on each key in the property map.
     * @param {forEachCallback} callback - Called for each entry in the map
     * @alias Autodesk.Viewing.PropertySet#forEach
     */
    forEach(callback) {
        if (!callback) return;
        for (let key in this.map) {
            if (key === '__selected_dbIds__') {
                continue;
            }
            const properties = this.map[key];
            callback(key, properties);
        }
    }

    /**
     * @typedef {Object} AggregatedResult
     * @property {Number} average - Average of all displayValues
     * @property {Number} count - The number of properties
     * @property {Number} max - The max of all displayValues
     * @property {Number} median - The median of all displayValues
     * @property {Number} min - The min of all displayValues
     * @property {Number[]} mode - An array of possible modes
     * @property {Number} range - The range (max-min) of all of the displayValues
     * @property {Number} sum - The sum of all displayValues
     */

    /**
     * Returns an object containing aggregated values.
     * see {@link Autodesk.Viewing.PropertySet#forEach}
     * @example
     *   propertySet.forEach((key, properties) => {
     *     const aggregation = propertySet.getAggregation(key);
     *   });
     *
     * @param {Object[]|String} properties - either the key in the object or an array of properties
     * @returns {AggregatedResult} - Object with all aggregated values
     * @alias Autodesk.Viewing.PropertySet#getAggregation
     */
    getAggregation(properties) {
        if (!properties) return null;

        if (typeof properties === 'string') {
            properties = this.map[properties];
        }

        if (properties.length === 0) return null;

        // Validate that the property types are numbers.
        const propertyType = properties[0].type;

        // Only process attribute types for Integer, Double and Float.
        if (!isNumericProperty(propertyType)) {
            // Cannot aggregate NaN values
            return null;
        }

        const aggregations = {
            average: 0,
            count: 0,
            max: 0,
            median: 0,
            min: 0,
            mode: [],
            range: 0,
            sum: 0,
        };

        const displayValues = properties.map((prop) => {
            return Number(prop.displayValue);
        });
        displayValues.sort((a, b) => a - b);

        function fixPrecision(value, property) {
            var tokenizedDigits = property.displayValue.toString().split('.');
            if (tokenizedDigits.length === 1) {
                return value;
            }

            const tokenizedValueDigits = value.toString().split('.');
            if (tokenizedValueDigits.length === 1) {
                return value;
            }

            const valueDigits = tokenizedValueDigits[1];
            let propDigits = tokenizedDigits[1];
            if (valueDigits === propDigits) {
                return value;
            }
            propDigits = propDigits.match(/\d+/);
            const precision = (propDigits && propDigits[0] && propDigits[0].length) || property.precision || 0;
            return Number(value.toFixed(precision));
        }

        const freq = {};
        let maxFreq = 0;
        let total = 0;
        displayValues.forEach((value) => {
            total += value;
            if (!Object.prototype.hasOwnProperty.call(freq, value)) {
                freq[value] = 1;
            } else {
                freq[value]++;
            }

            maxFreq = Math.max(maxFreq, freq[value]);

            aggregations.sum += value;
        });
        aggregations.count = displayValues.length;
        aggregations.average = total / aggregations.count;
        aggregations.max = displayValues[aggregations.count - 1];
        aggregations.min = displayValues[0];
        const mid = Math.ceil(aggregations.count / 2);
        aggregations.median =
            aggregations.count % 2 && aggregations.count > 1
                ? (displayValues[mid] + displayValues[mid - 1]) / 2
                : displayValues[mid - 1];

        for (let val in freq) {
            if (freq[val] === maxFreq) {
                aggregations.mode.push(Number(val));
            }
        }

        aggregations.range = aggregations.max - aggregations.min;
        aggregations.sum = fixPrecision(aggregations.sum, properties[0]);
        return aggregations;
    }

    /**
     * Returns an object with a key representing the property's displayValue and the value being all of the property names associated with it.
     *
     * see {@link Autodesk.Viewing.PropertySet#forEach}
     * see {@link PropertyResult}
     *
     * @example
     *   propertySet.forEach((name, properties) => {
     *     const commonValues = propertySet.getValue2PropertiesMap(key);
     *   });
     *
     * @param {Object[]|String} properties - either the key in the object or an array of properties
     * @returns {Object} - The key representing a common displayValue and the value representing all of the PropertyResult sharing that displaValue
     * @alias Autodesk.Viewing.PropertySet#getValue2PropertiesMap
     */
    getValue2PropertiesMap(properties) {
        if (!properties) return null;

        if (typeof properties === 'string') {
            properties = this.map[properties];
        }

        if (!properties || properties.length === 0) return null;

        const commonProperties = {};

        properties.forEach((prop) => {
            if (!Object.prototype.hasOwnProperty.call(commonProperties, prop.displayValue)) {
                commonProperties[prop.displayValue] = [];
            }

            commonProperties[prop.displayValue].push(prop.parentName);
        });

        return commonProperties;
    }

    /**
     * Searches all of the keys in the map object and returns all valid keys that either match the displayName or categoryName.
     * @param {String} displayName - the display name
     * @param {String} displayCategory - the category name
     * @returns {String[]} - an array of valid map ids
     * @alias Autodesk.Viewing.PropertySet#getValidIds
     */
    getValidIds(displayName, displayCategory) {
        const keys = Object.keys(this.map);
        const ids = [];

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (displayName) {
                const nameIndex = key.indexOf(displayName);
                if (nameIndex !== -1) {
                    ids.push(key);
                    continue;
                }
            }

            if (displayCategory) {
                const tokenizedKey = key.split('/');
                if (tokenizedKey.length >= 2 && tokenizedKey[0] === displayCategory) {
                    ids.push(key);
                    continue;
                }
            }
        }
        return ids;
    }

    /**
     * Get the dbIds that are associated with the propertySet
     * @returns {number[]} - an array of dbids associated with the PropertySet
     * @alias Autodesk.Viewing.PropertySet#getDbIds
     */
    getDbIds() {
        return this.map['__selected_dbIds__'];
    }

    /**
     * Returns an array of keys that contain visible properties
     * @returns {string[]} - array of keys
     * @alias Autodesk.Viewing.PropertySet#getVisibleKeys
     */
    getVisibleKeys() {
        const keys = [];
        this.forEach((key, props) => {
            if (!props[0].hidden) {
                keys.push(key);
            }
        });
        return keys;
    }

    /**
     * Returns an array of keys that have properties with displayCategories
     * @returns {string[]} - array of keys
     * @alias Autodesk.Viewing.PropertySet#getKeysWithCategories
     */
    getKeysWithCategories() {
        const keys = [];
        this.forEach((key, props) => {
            const isHidden = !!props[0].hidden;
            if (props[0].displayCategory && !isHidden) {
                keys.push(key);
            }
        });
        return keys;
    }

    /**
     * Merges the passed in PropertySet map with the current PropertySet's map.
     * @param {Autodesk.Viewing.PropertySet} propertySet - A PropertySet instance
     * @returns {Autodesk.Viewing.PropertySet} - returns from the passed in propertySet merged
     * @alias Autodesk.Viewing.PropertySet#merge
     */
    merge(propertySet) {
        if (!(propertySet instanceof PropertySet)) {
            return this;
        }

        const map = propertySet.map;

        for (let fromKey in map) {
            const fromProps = map[fromKey];

            if (!Object.prototype.hasOwnProperty.call(this.map, fromKey)) {
                this.map[fromKey] = fromProps;
                continue;
            }

            const toProps = this.map[fromKey];

            if (fromKey === '__selected_dbIds__') {
                this.map[fromKey] = [...toProps, ...fromProps];
                continue;
            }

            for (let i = 0; i < fromProps.length; i++) {
                const fromProp = fromProps[i];
                let isNewProp = true;
                for (let j = 0; j < toProps.length; j++) {
                    const toProp = toProps[j];
                    if (fromProp.displayValue === toProp.displayValue && fromProp.dbId === toProp.dbId) {
                        isNewProp = false;
                        continue;
                    }
                }
                if (isNewProp) {
                    toProps.push(fromProp);
                }
            }
        }

        return this;
    }
}
