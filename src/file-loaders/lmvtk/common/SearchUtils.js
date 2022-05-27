"use strict";

/**
 * Finds the index of a number in a sorted Array or numbers. 
 * 
 * @param sortedArray Array of sorted numbers to search in.
 * @param key number value to find.
 * @returns index of the value in the array, or -1 if not found.  
 */
export function binarySearch(sortedArray, key) {

    let start = 0;
    let end = sortedArray.length - 1;
    let mid;

    while (start <= end)
    {
        mid = ((start + end) / 2) | 0;
        if (key === sortedArray[mid])
            return mid;
        else if (key < sortedArray[mid])
            end = mid - 1;
        else start = mid + 1;
    }
    return -1;
};

