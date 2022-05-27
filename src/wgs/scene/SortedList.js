/**
 * Maintains a sorted list of objects or values. 
 * If objects are used, less must be a function(a,b) that 
 * defines an order on all objects. 
 * 
 * It is valid to add multiple object that are equal wrt. to less operator.
 *
 * @constructor
 */
export function SortedList(less) {

    // use custom or default less operator    
    var _less = less ? less : function(a,b) { return a < b; };
    
    // all inserted objects, not sorted
    var _values = [];

    // array of indices into values, sorted by less operator
    var _orderIndices = [];

    // Returns an index to the first element in this.orderIndices that points to
    // an object o that is greater or equal than the given value, i.e. !less(o, value)
    // If no such object is found, it returns the range end index.
    function binarySearch(
        value,      // object to search for
        rangeBegin, // int: define range in this.orderIndices. highEnd is exclusive
        rangeEnd    // 
    ) {
        // use full array by default
        if (!rangeBegin) rangeBegin = 0;
        if (!rangeEnd)   rangeEnd   = _orderIndices.length;

        // handle empty range
        if (rangeBegin>=rangeEnd) {
            return rangeEnd;
        }

        // simple case: range contains just a single value
        if (rangeEnd === rangeBegin+1) {
            
            // get only elem in this range
            var elem = _values[_orderIndices[rangeBegin]]; 
            
            if (_less(elem, value)) {
                // object is still smaller. 
                return rangeEnd;
            } else {
                return rangeBegin;
            }
        }
                    
        // split range in the middle
        var mid = parseInt(rangeBegin + (rangeEnd - rangeBegin) / 2);

        // Note: mid-1 is always valid, because the rangeLength is always >2 when reaching this

        // get last value of lower half-range
        var lowerRangeMax = _values[_orderIndices[mid-1]];
        
        if (_less(value, lowerRangeMax)) {
            // max of lower range is already greater => result index must be in the lower half
            return binarySearch(value, rangeBegin, mid);
        } else if (_less(lowerRangeMax, value)) {
            // evenl lower-range max is still smaller => mid object must be in the upper range
            return binarySearch(value, mid, rangeEnd);
        } else {
            // last object in the lower range is identical with value
            return mid-1;
        }
    }

    this.add = function(val) {

        // find index into this.orderIndices that points to the last
        // object with identical or lower value.
        var index = binarySearch(val);
        
        if (index==_orderIndices.length) {
            // value is not in the list yet and is larger than all values so far
            // => append order index 
            _values.push(val);
            _orderIndices.push(_values.length - 1);
            return;
        }
      
        // append new object and insert sort index at the right position
        _values.push(val);
        _orderIndices.splice(index, 0, _values.length - 1);
    };

    this.size = function() { return _orderIndices.length; };

    // enables to traverse by ascending order using indices 0,...,size()-1
    this.get = function(index) { 
        return _values[_orderIndices[index]]; 
    };

    // removes the element at the given index in 0,...,size()-1.
    // Note that the index of an object may vary when inserting others,
    // because the indices are defined via the sorting order.
    // E.g., removeAt(0) removes the smallest value.
    this.removeAt = function(i) {
        var index = _orderIndices[i];

        // remove value at index. Note that the indexing of this.values
        // must not be changed, because our sort-indices would become invalid.
        _values[index] = undefined;

        // remove order index 
        _orderIndices.splice(i, 1);
    };

    // returns a string that enumerates all values.
    // (only works for numeric values)
    this.toString = function() {
        var string = "";
        for (var i=0,iEnd=this.size(); i<iEnd; ++i) {
            string += this.get(i);
            if (i<iEnd-1) string += ", ";
        }       
        return string; 
    };
}
