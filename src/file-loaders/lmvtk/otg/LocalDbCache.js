
import { utf8ArrayToString, blobToJson } from "../common/StringUtils";
import { isNodeJS, isMobileDevice, isSafari, isIE11 } from "../../../compat";

const pako = require('pako');

//All object stores go into this database
const DB_NAME = "otg";

const CONTENT_STORE = "otg-content";
const CONTENT_STORE_LRU = "otg-lru";


export class LocalDbCache {

    constructor(forceDisabled, isInlineWorker) {
        this.db = null;
        this.readTransaction = null;
        this.loaded = false;
        this.opening = false;

        this.dbDisabled = this._isDbDisabled(forceDisabled, isInlineWorker);

        if (!isNodeJS() && this.dbDisabled) {
            console.log("IndexedDb disabled");
        }

        this.storeName = CONTENT_STORE;
        this.storeNameTimestamp = CONTENT_STORE_LRU;
        this.bothStoreNames = [this.storeName, this.storeNameTimestamp];

        this.useCompression = true;
        this.pendingTimestampUpdates = {};
        this.pendingTimestampCount = 0;

        this.pendingStores = [];

        this._pendingCallbacks = [];
    }

    // Disable on Safari until we figure out why performance is terrible.
    // Disable on Node.js because we don't need to cache locally on the server side
    // Disable on Mobile until we decide if we want the performance hit there.
    // Disable IE11 & Edge if worker created from a Blob URL. IndexedDB is not supported in that case.
    _isDbDisabled(forceDisabled, isInlineWorker) {
        return (
            forceDisabled ||
            isNodeJS() ||
            isSafari() ||
            isMobileDevice() ||
            (isIE11 && isInlineWorker) ||
            typeof indexedDB === "undefined"
        );
    }

    notifyPendingCallbacks(error) {
        this._pendingCallbacks.forEach(cb => cb(error, this.db));
        this._pendingCallbacks = [];
    }

    open(cb) {

        if (this.dbDisabled) {
            cb && cb();
            return;
        }

        //Call back immediately if we are already open
        if (this.loaded) {
            cb && cb(null, this.db);
            return;
        }

        //Delay callback if we are still waiting to open.
        if (this.opening) {
            cb && this._pendingCallbacks.push(cb);
            return;
        }

        this.opening = true;

        //Open the IndexedDb database connection
        let request = indexedDB.open(DB_NAME, 1);

        request.onerror = (event) => {
            console.error("Failed to open or create cache database.");
            this.dbDisabled = true;
            this.notifyPendingCallbacks(event);
        };
        request.onsuccess = (event) => {

            this.opening = false;
            this.db = event.target.result;

            this.db.onerror = function (event) {
                console.error("Database error", event);
            };

            this.loaded = true;
            this.notifyPendingCallbacks();

            /*
            this.size((err, data) => {
                console.log(data);
            });
            */
        };

        request.onupgradeneeded = (event) => {

            console.log("Db upgrade", this.storeName);

            // Save the IDBDatabase interface
            let db = event.target.result;

            // Create the database schema
            db.createObjectStore(CONTENT_STORE);
            let os = db.createObjectStore(CONTENT_STORE_LRU);
            os.createIndex(CONTENT_STORE_LRU+"-index", "t", { unique: false });
        };
    }


    deleteOld(callback) {

        if (!this.db) {
            callback();
            return;
        }

        if (this.deleteInProgress)
            return;

        this.deleteInProgress = true;

        let howMany = 200;

        //Avoid deleting stuff that was last used a short while ago, by using a range query
        let upperBoundOpenKeyRange = IDBKeyRange.upperBound(Date.now() - 300 * 1000, true);

        let hashes = [];

        let objectStore = this.db.transaction([this.storeNameTimestamp]/*, "readwrite"*/).objectStore(this.storeNameTimestamp);

        let index = objectStore.index(this.storeNameTimestamp + "-index");

        index.openCursor(upperBoundOpenKeyRange).onsuccess = (event) => {
            let cursor = event.target.result;
            if (cursor && hashes.length < howMany) {
                hashes.push(cursor.primaryKey);
                cursor.continue();
                return;
            }

            if (hashes.length) {

                console.log("Deleting old objects.", hashes.length);

                let transaction = this.db.transaction(this.bothStoreNames, "readwrite");

                transaction.oncomplete = (event) => {
                    this.deleteInProgress = false;
                    console.log("Delete done");
                    callback && callback();
                };

                transaction.onerror = (event) => {
                    this.deleteInProgress = false;
                    console.error("Transaction error.", event);
                };

                transaction.onabort = (event) => {
                    this.deleteInProgress = false;
                    let error = event.target.error; // DOMError
                    console.log("Failed to delete cached objects", error);
                };

                let objectStoreMain = transaction.objectStore(this.storeName);
                let objectStoreTimestamp = transaction.objectStore(this.storeNameTimestamp);

                for (let i=0; i<hashes.length; i++) {
                    objectStoreMain.delete(hashes[i]);
                    objectStoreTimestamp.delete(hashes[i]);
                }

            }
        };



    }


    flush(cb) {

        if (!this.pendingStores.length) {
            cb && cb();
            return;
        }

        if (!this.writeTransaction) {

            let transaction = this.db.transaction(this.bothStoreNames, "readwrite");

            if (cb) {
                transaction.oncomplete = (event) => {
                    //console.log("Transaction complete");
                    cb();
                };
            }

            transaction.onerror = (event) => {
                console.error("Transaction error.", event);
                cb && cb(event.target.error);
            };

            transaction.onabort = (event) => {
                let error = event.target.error; // DOMError
                if (error.name === 'QuotaExceededError') {
                    //console.log("Quota exceeded");
                    this.deleteOld(() => {});

                }
                cb && cb(event.target.error);
            };

            this.writeTransaction = transaction;
        }

        for (var i=0; i<this.pendingStores.length; i+=2) {

            var hash = this.pendingStores[i];
            var data = this.pendingStores[i+1];

            if (data instanceof Uint8Array && this.useCompression) {
                if (data[0] === 31 && data[1] === 139) {
                    //already compressed
                } else {
                    //let before = data.length;
                    try {
                        data = pako.gzip(data);
                    } catch (e) {
                        console.error("Compression failed.");
                    }
                    //let after = data.length;
                    //console.log(before/after, "x");
                }
            }

            let objectStore = this.writeTransaction.objectStore(this.storeName);

            let storeBlob = objectStore.put(data, hash);

            storeBlob.onerror = (event) => {
                console.error("Object store error.", event);
            };

            let timestampStore = this.writeTransaction.objectStore(this.storeNameTimestamp);
            timestampStore.put({t:Date.now()}, hash);

        }

        this.pendingStores = [];

        //TODO: reuse this transaction for longer
        this.writeTransaction = null;
    }


    store(hash, data, cb) {

        if (!this.db) {
            cb && cb();
            return;
        }

        this.pendingStores.push(hash);
        this.pendingStores.push(data);

        if (this.pendingStores.length < 200) {
            cb && cb();
            return;
        }

        this.flush(cb);
    }


    flushTimestamps(cb) {

        let transaction = this.db.transaction([this.storeNameTimestamp], "readwrite");

        if (cb) {
            transaction.oncomplete = (event) => {
                //console.log("Transaction complete");
                cb();
            };
        }

        transaction.onerror = (event) => {
            console.error("Transaction error.", event);
            cb && cb(event.target.error);
        };

        transaction.onabort = (event) => {
            let error = event.target.error; // DOMError
            if (error.name === 'QuotaExceededError') {
                console.log("Quota exceeded");
                this.deleteOld(() => {});
            }
            cb && cb(event.target.error);
        };


        let timestampStore = transaction.objectStore(this.storeNameTimestamp);

        for (let hash in this.pendingTimestampUpdates) {
            timestampStore.put({t: this.pendingTimestampUpdates[hash]}, hash);
        }

        this.pendingTimestampUpdates = {};
        this.pendingTimestampCount = 0;
    }

    _createReadTransaction() {
        //We try to keep the read transaction alive by reusing it
        //for all new requests. If they come fast enough, the transaction
        //will stay alive. If it completes, we will create a new one.
        let transaction = this.readTransaction = this.db.transaction(this.storeName);

        transaction.oncomplete = (event) => {
            this.readTransaction = null;
        };
        transaction.onerror = (event) => {
            console.error("Transaction error.", event);
            this.readTransaction = null;
        };
        transaction.onabort = (event) => {
            console.warn("Transaction abort", event);
            this.readTransaction = null;
        };
    }

    get(hash, cb) {

        if (this.opening) {
            console.error("Tried to get IndexedDb resource while database was still opening");
            cb(-1, null);
            return;
        }

        if (!this.db) {
            cb(-1, null);
            return;
        }

        //We try to reuse the same read transaction for as long as it will let us
        if (!this.readTransaction) {
            this._createReadTransaction();
        }

        let req;
        //This can fail if the transaction has gone inactive
        try {
            req = this.readTransaction.objectStore(this.storeName).get(hash);
        } catch (e) {
            this._createReadTransaction();
            req = this.readTransaction.objectStore(this.storeName).get(hash);
        }

        req.onsuccess = (event) => {

            //Somehow we sometimes end up getting null for an existing key
            //so we force reload
            if (!event.target.result) {
                cb(-1, null);
                return;
            }


            let data = event.target.result;

            if (data[0] === 31 && data[1] === 139) {
                try {
                    data = pako.ungzip(data);
                } catch(e) {
                    console.error("Failed to decompress.", e);
                    cb(e, null);
                    return;
                }
            }

            cb(null, data);

            //Remember the new timestamp for this hash, but don't update
            //it in the mru table immediately, to avoid slowing down model load
            //with a write transaction.
            this.pendingTimestampUpdates[hash] = Date.now();
            this.pendingTimestampCount++;
        };

        req.onerror = (event) => {
            cb(event.target.errorCode);
        };

    }


    updatePendingTimestamps() {

        if (!this.db)
            return;

        this.flush((err) => {
            //console.log("Updating all timestamps");

            if (err) {
                return;
            }

            this.flushTimestamps();

        });

    }

    size(callback) {
        if (!this.db) {
            callback();
            return;
        }

        let size = 0;
        let items = 0;

        let transaction = this.db.transaction([this.storeName])
            .objectStore(this.storeName)
            .openCursor();

        transaction.onsuccess = (event) => {
            let cursor = event.target.result;
            if (cursor) {
                let storedObject = cursor.value;
                size += storedObject.length;
                items++;
                cursor.continue();
            }
            else {
                callback(null, {size: size, items: items});
            }
        };

        transaction.onerror = function (err) {
            callback(err);
        };
    }

}
