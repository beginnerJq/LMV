var TO_HEX = new Array(256);
for (var i=0; i<256; i++) {
    var s = i.toString(16);
    if (s.length === 1)
        s = "0" + s;
    TO_HEX[i] = s;
}

//Most common case is for SHA1 hashes, which are 20 bytes
var tmpArr20 = new Array(20);

function getHexString(buffer, offset, length) {
    var res = (length === 20) ? tmpArr20 : [];

    for (var i=0; i<length; i++) {
        var b = buffer[offset+i];
        var s = TO_HEX[b];
        res[i] = s;
    }

    return res.join("");
}

var tmpArr10 = new Array(10);

//Converts the input byte array into a string of half the length
//by packing two bytes into each string character (JS strings are two bytes per char)
function getHexStringPacked(buffer, offset, length) {
    var res = (length === 20) ? tmpArr10 : [];

    for (var i=0; i<length; i+=2) {
        var b0 = buffer[offset+i];
        var b1 = buffer[offset+i+1];
        res[i/2] = b1 << 8 | b0;
    }

    return String.fromCharCode.apply(null, res);
}

//Converts from UCS16 packed string (two bytes per character) to
//regular ASCII string of 4x the length
function unpackHexString(s) {
    var res = (s.length === 10) ? tmpArr20 : [];

    for (var i=0; i<s.length; i++) {
        var bytes = s.charCodeAt(i);
        res[2*i] = TO_HEX[bytes & 0xff];
        res[2*i+1] = TO_HEX[(bytes >> 8) & 0xff];
    }

    return res.join("");
}


function hexToDec(code) {
    //0-9
    if (code >= 48 && code <= 57) {
        return code - 48;
    }
    //A-F
    if (code >= 65 && code <= 70) {
        return code - 55;
    }
    //a-f
    if (code >= 97 && code <= 102) {
        return code - 87;
    }

    return 0;
}

//Convert string in hex format, e.g. "3498572abc" to binary
function hexToBin(str, buf, offset) {

    // Go directly from packed to bin
    if (str.length === 10) {
        unpackToBin(str, buf, offset);
        return;
    }

    let j = offset;
    for (let i=0; i<s.length; i+=2) {
        let d1 = hexToDec(s.charCodeAt(i));
        let d2 = hexToDec(s.charCodeAt(i+1));
        buf[j++] = (d1 << 4) | d2;
    }
}

function unpackToBin(s, buf, offset) {
    let j = offset;
    for (var i=0; i<s.length; i++) {
        var bytes = s.charCodeAt(i);
        let h1 = TO_HEX[bytes & 0xff]; // char 1
        let h2 = TO_HEX[(bytes >> 8) & 0xff]; // char 2

        let d1 = hexToDec(h1.charCodeAt(0));
        let d2 = hexToDec(h1.charCodeAt(1));
        buf[j++] = (d1 << 4) | d2;

        d1 = hexToDec(h2.charCodeAt(0));
        d2 = hexToDec(h2.charCodeAt(1));
        buf[j++] = (d1 << 4) | d2;
    }
}

module.exports = {
    //getHexString,
    getHexStringPacked,
    unpackHexString,
    hexToBin
};
