/**
 * Numeric values and their meanings associated to {@link PropertyResult|PropertyResult.type}.
 *
 * @readonly
 * @alias AttributeType
 * @default
 */
export var AttributeType =
{
    //Numeric types
    Unknown :       0,
    Boolean :       1,
    Integer :       2,
    Double :        3,
    Float:          4,

    //Special types
    BLOB :          10,
    DbKey:          11, /* represents a link to another object in the database, using database internal ID */

    //String types 
    String:         20,
    LocalizableString: 21,
    DateTime:       22,    /* ISO 8601 date */
    GeoLocation :   23,    /* LatLonHeight - ISO6709 Annex H string, e.g: "+27.5916+086.5640+8850/" for Mount Everest */
    Position :      24     /* "x y z w" space separated string representing vector with 2,3 or 4 elements*/

    //TODO: Do we need explicit logical types for any others?
};

//Bitmask values for boolean attribute options
export var AttributeFlags =
{
    afHidden    : 1 << 0, /* Attribute will not be displayed in default GUI property views. */
    afDontIndex : 1 << 1, /* Attribute will not be indexed by the search service. */
    afDirectStorage : 1 << 2,  /* Attribute is not worth de-duplicating (e.g. vertex data or dbId reference) */
    afReadOnly : 1 << 3 /* Attribute is read-only (used when writing back to the design model, in e.g. Revit) */
};

//Used by property diff
export var RVT_DIM_PROPS = [
    "Perimeter",
    "Volume",
    "Area",
    "Length",
    "Width",
    "Height"
];

/**
 * Determines if the property types is numeric
 * @param {AttributeType} propertyType 
 * @returns {boolean}
 */
 export const isNumericProperty = (propertyType) => {
    return [AttributeType.Integer, AttributeType.Double, AttributeType.Float].includes(propertyType);
};