
export function allocateUintArray(size, maxInt) {
    if (maxInt <= 255) {
        return new Uint8Array(size);
    } else if (maxInt <= 65535) {
        return new Uint16Array(size);
    }

    return new Uint32Array(size);
}

export function reallocateUintArrayMaybe(arr, val) {

    if (val <= 255)
        return arr;

    if (val <= 65535 && arr instanceof Uint8Array) {
        let ret = new Uint16Array(arr.length);
        ret.set(arr);
        return ret;
    }

    if (!arr instanceof Uint32Array) {
        let ret = new Uint32Array(arr.length);
        ret.set(arr);
        return ret;
    }

    return arr;
}