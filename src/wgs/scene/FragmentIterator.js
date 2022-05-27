
// Object used to iterator all fragments in all dbids in all models in a scene
// _timeSlice is the time in milliseconds before the iterator will allow itself
// to be interrupted. _sliceDelay is the time in milliseconds the iterator delays
// before starting a new time slice. The default values are 15 and 0 respectively.
// I did some experiments and it seemed like these values worked pretty well.
// _sliceDelay doesn't seem to matter very much, but making _timeSlice much
// larger will cause highlights to look jerky.
function FragmentIterator(options = {}) {

    let _capTimer = 0;      // Timer used to delay time slices
    let _callback;          // Callback for each fragment
    let _onDone;            // callback called on done
    let _models;            // Array of models in the scene
    let _curModel;          // Current model
    const _dbIds = [];        // Database ids for the current model
    const _fragIds = [];      // Fragment ids for the current database id
    let _instanceTree;       // Instance tree for current model
    let _m;                 // Current index in _models
    let _d;                 // Current index in _dbIds
    let _f;                 // Current index in _fragIds

    // Default value for _timeSlize and _sliceDelay
    const _timeSlice =  options.timeSlice || 15;
    const _sliceDelay = options.sliceDelay || 0;
    const _delay = options.delay ?? -1;

    // Start the iterator
    // models is the array of models to iterate
    // delay is a delay to start the iteration. < 0 starts without any delay
    // callback is the callback for each fragment:
    //   callback(fragId, dbId, model, lastFrag)
    // lastFrag is a boolean that is true when fragId is the last fragment for dbId.
    this.start = function (models, callback, onDone) {
        if (!Array.isArray(models)) {
            models = [models];
        }

        reset(models);

        _callback = callback;
        _onDone = onDone;

        if (callback) {
            if (_delay >= 0)
                _capTimer = setTimeout(() => doIteration(), _delay);
            else
                doIteration();
        }
    };

    this.stop = function () {
        reset(null);
    }

    // Reset the iterator, this is so we can clear the manager at the end.
    function reset(models) {
        if (_capTimer)
            clearTimeout(_capTimer);
        _capTimer = 0;
        _models = models;
        _dbIds.length = 0;
        _fragIds.length = 0;
        _instanceTree = null;
        _m = -1;
        _d = 0;
        _f = 0;
    }

    // Do a single time slice
    function doIteration() {
        _capTimer = 0;
        const endTime = performance.now() + _timeSlice;
        while (performance.now() < endTime) {
            // If we are done, then return
            if (!next()) {
                // Clear everything when we are done
                reset(null);
                _onDone?.();
                return;
            }

            // Call the call back function
            _callback(_fragIds[_f], _dbIds[_d], _curModel, _f + 1 >= _fragIds.length, !_models || _m >= _models.length);
        }

        // Schedule the next time slice
        _capTimer = setTimeout(() => doIteration(), _sliceDelay);
    }

    // Advance to the next model in _models
    function nextModel() {
        // Continue processing the next model in _models
        if (_models && _m < _models.length) {
            // Go to next model
            while (++_m < _models.length) {
                _instanceTree = _models[_m].getInstanceTree();
                // Only process the model, if it has a fragment map

                _dbIds.length = 0;

                if (_instanceTree) {
                    // Get the list of dbIds.
                    _instanceTree.enumNodeChildren(_models[_m].getRootId(), function(dbId) {
                        _dbIds.push(dbId);
                    }, true);
                    // Only process the model if we got some ids
                } else {
                    const fragList = _models[_m].getFragmentList();
                    
                    if (fragList?.fragments?.dbId2fragId) {
                        _dbIds.push(...Object.keys(fragList.fragments.dbId2fragId).map(i => parseInt(i)));
                    }
                    
                }

                if (_dbIds.length > 0) {
                    // Set the current model and newly loaded dbIds
                    _curModel = _models[_m];
                    return _curModel;
                }
            }
        }

        // Done clear the current model and new loaded dbIds
        _curModel = null;

        // End of the models
        return false;
    }

    function isNodeVisible(dbId) {
        if (_instanceTree) {
            return !_instanceTree.isNodeHidden(dbId) && !_instanceTree.isNodeOff(dbId);
        } else {
            const fragList = _models[_m].getFragmentList();
            return !fragList.dbIdIsGhosted[dbId];
        }
    }

    // Advance to the next database id
    function nextDbId() {
        // At the end, return false
        if (_d >= _dbIds.length)
            return false;

        // Go to next database id
        while (++_d < _dbIds.length) {
            const dbId = _dbIds[_d];
            // Only process dbIds that are not hidden and not off
            if (options.includeHidden || isNodeVisible(dbId)) {
                //All fragments that belong to the same node make part of the
                //same object so we have to accumulate all their intersections into one list
                _fragIds.length = 0;

                if (_instanceTree) {
                    _instanceTree.enumNodeFragments(dbId, function(fragId) {
                        _fragIds.push(fragId);
                    }, false);
                } else {
                    const fragList = _models[_m].getFragmentList();
                    
                    if (fragList) {
                        let frags = fragList.fragments.dbId2fragId[dbId];
                        
                        if (!Array.isArray(frags)) {
                            frags = [frags];
                        }

                        _fragIds.push(...frags);
                    }
                }
                
                // Only process the database id if there are some fragments
                if (_fragIds.length > 0)
                    return true;
            }
        }

        // end of the database ids
        return false;
    }

    // Advance to the next fragment
    function next() {
        // If we are not a the end of the fragment list, then process it
        if (++_f < _fragIds.length)
            return true;

        // Start the fragment list at the beginning
        _f = 0;
        for ( ; ; ) {
            // If we have more database ids, then process them
            if (nextDbId())
                return true;
            // If we don't have another model, then we are done
            if (!nextModel())
                return false;
            // restart the database ids for the new model
            _d = -1;
        }
    }
}

export { FragmentIterator };
