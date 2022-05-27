/**
 * Wrapper for the WebAssembly API.
 * This class will initialize a WebAssembly module from the supplied wasm `path`.
 *
 * @param {String} path - path to the wasm file.
 * @param {Object} options
 * @param {Number} options.initial - The initial size of the WebAssembly memory. The number should be in WebAssembly pages (each page is 64K).
 * @param {Number} options.maximum - The maximum size that the WebAssembly memory is allowed to grow to.
 * @constructor
 */
export function Wasm(path, options) {
    // Make sure that WebAssembly is supported for the current browser.
    try {
        // Polyfill instantiateStreaming for browsers missing it
        if (!WebAssembly.instantiateStreaming) {
            WebAssembly.instantiateStreaming = async (resp, importObject) => {
                const source = await (await resp).arrayBuffer();
                return await WebAssembly.instantiate(source, importObject);
            };
        }
    } catch (err) {
        throw new Error('WebAssembly is not supported for the current browser.');
    }

    if (!path) {
        throw new Error('Expecting a wasm file path.');
    }

    // Set the default memory to 256 (16MB) WebAssembly pages (each page is 64K).
    let initial = 256;
    let maximum = 256;
    if (options && options.memory) {
        initial = options.memory.initial;
        maximum = options.memory.maximum;
    }

    this._wasmPath = path;

    this._memory = new WebAssembly.Memory({ initial, maximum });
}

Wasm.prototype.constructor = Wasm;

/**
 * Instantiate the WebAssembly instance for the specified wasm file.
 * @returns {Promise} - resolves with the wasm exorted functions
 */
Wasm.prototype.instantiate = function() {
    // Specify an importObject: this provides the environment Web Assembly runs in as well as any other parameters for instantiation.
    const env = {
        abortStackOverflow: (_) => {
            throw new Error('overflow');
        },
        // The table properties configure the function table passed to Web Assembly.
        // This is used when we allow the Web Assembly code call methods in JS. For this part, it can be zero/empty—we as we don't currently use it.
        // The WebAssembly.Table() constructor creates a new Table object of the given size and element type.
        // This is a JavaScript wrapper object — an array-like structure representing a WebAssembly Table, which stores function references.
        // A table created by JavaScript or in WebAssembly code will be accessible and mutable from both JavaScript and WebAssembly.
        table: new WebAssembly.Table({ initial: 0, maximum: 0, element: 'anyfunc' }),
        __table_base: 0,
        memory: this._memory, // Specifies where the heap should begin
        __memory_base: 1024,
        // STACK specifies where the stack should appear.
        // It starts at STACK_MAX and works upwards (i.e., towards zero)—so STACK_MAX starts at total size of our memory, from memory.buffer.byteLength.
        STACKTOP: 0,
        STACK_MAX: this.getBuffer().byteLength
    };
    const importObject = { env };

    return new Promise((resolve, reject) => {
        try {
            WebAssembly.instantiateStreaming(fetch(this._wasmPath), importObject).then((instantiatedModule) => {
                const wasmExports = instantiatedModule.instance.exports;
                this.proxy = wasmExports;
                resolve(wasmExports);
            });
        } catch (error) {
            reject(error);
        }
    });
};

/**
 * Returns the buffer associated with the WebAssembly Memory instance.
 * @returns {ArrayBuffer} - returns the WebAssembly.Memory.buffer
 */
Wasm.prototype.getBuffer = function() {
    return this._memory.buffer;
};
