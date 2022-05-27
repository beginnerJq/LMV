/**
 * Sets obj[funName] = fun, only if (typeof obj === 'object' || typeof obj === 'function') && !obj.hasOwnProperty(funName).
 * 
 * @param {any} obj The object on which to define the function.
 * @param {string} funName The name of the function being defined.
 * @param {Function} fun The function definition.
 */
export const defineFunctionIfMissing = (obj, funName, fun) => {
    if ((typeof obj === 'object' || typeof obj === 'function') && !Object.prototype.hasOwnProperty.call(obj, funName)) {
        obj[funName] = fun;
    }
};

/**
 * Calls Object.defineProperty(obj, prop, descriptor), only if typeof obj === 'object'.
 * 
 * This is especially useful if obj can be null or undefined.
 * 
 * @param {any} obj The object on which to define the property.
 * @param {PropertyKey} prop The name or Symbol of the property to be defined or modified.
 * @param {PropertyDescriptor} descriptor The descriptor for the property being defined or modified.
 */
export const definePropertySafe = (obj, prop, descriptor) => {
    if (typeof obj === 'object') {
        Object.defineProperty(obj, prop, descriptor);
    }
};