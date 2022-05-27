"use strict";

// http://www.onicos.com/staff/iz/amuse/javascript/expert/utf.txt
/* utf.js - UTF-8 <=> UTF-16 convertion
 *
 * Copyright (C) 1999 Masanao Izumo <iz@onicos.co.jp>
 * Version: 1.0
 * LastModified: Dec 25 1999
 * This library is free.  You can redistribute it and/or modify it.
 */
export function utf8BlobToStr(array, start, length) {
    var out, i, len, c;
    var char2, char3;

    out = '';
    len = length;
    i = 0;
    while(i < len) {
        c = array[start + i++];
        switch(c >> 4)
        {
          case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
            // 0xxxxxxx
            out += String.fromCharCode(c);
            break;
          case 12: case 13:
            // 110x xxxx   10xx xxxx
            char2 = array[start + i++];
            out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
            break;
          case 14:
            // 1110 xxxx  10xx xxxx  10xx xxxx
            char2 = array[start + i++];
            char3 = array[start + i++];
            out += String.fromCharCode(((c & 0x0F) << 12) |
                                       ((char2 & 0x3F) << 6) |
                                       ((char3 & 0x3F) << 0));
            break;
        }
    }

    return out;
}

/**
 * Safe version of utf8BlobToStr(), where Arrays are used to concatenate chars via join().
 * This function exists because string::operator += crashes on Chrome with large inputs.
 */
export function safeUtf8BlobToStr(array, start, length) {
    var out, i, len, c, outArray, count;
    var char2, char3;

    var STR_CVT_LIMIT = 32 * 1024;
    out = '';
    outArray = [];
    len = length;
    count = 0;
    i = 0;
    while(i < len) {
        c = array[start + i++];
        switch(c >> 4)
        {
          case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
            // 0xxxxxxx
            outArray.push(String.fromCharCode(c));
            break;
          case 12: case 13:
            // 110x xxxx   10xx xxxx
            char2 = array[start + i++];
            outArray.push(String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F)));
            break;
          case 14:
            // 1110 xxxx  10xx xxxx  10xx xxxx
            char2 = array[start + i++];
            char3 = array[start + i++];
            outArray.push(String.fromCharCode(((c & 0x0F) << 12) |
                                              ((char2 & 0x3F) << 6) |
                                              ((char3 & 0x3F) << 0)));
            break;
        }
        if (++count >= STR_CVT_LIMIT || i >= len) {
            out += outArray.join("");
            outArray.length = 0;
            count = 0;
        }
    }

    return out;
}


export function utf16to8(str, array, start) {
    var i, len, c;

    var j = start || 0;
    len = str.length;

    if (array) {
        for(i = 0; i < len; i++) {
            c = str.charCodeAt(i);
            if ((c >= 0x0001) && (c <= 0x007F)) {
                array[j++] = c;
            } else if (c > 0x07FF) {
                array[j++] = 0xE0 | ((c >> 12) & 0x0F);
                array[j++] = 0x80 | ((c >>  6) & 0x3F);
                array[j++] = 0x80 | ((c >>  0) & 0x3F);
            } else {
                array[j++] = 0xC0 | ((c >>  6) & 0x1F);
                array[j++] = 0x80 | ((c >>  0) & 0x3F);
            }
        }
    } else {
        //If no output buffer is passed in, estimate the required
        //buffer size and return that.
        for(i = 0; i < len; i++) {
            c = str.charCodeAt(i);
            if ((c >= 0x0001) && (c <= 0x007F)) {
                j++;
            } else if (c > 0x07FF) {
                j+=3;
            } else {
                j+=2;
            }
        }
    }

    return j - (start || 0);
}


var USE_MANUAL_UTF8 = true;
var SAFE_UTF_LENGTH = 1024 * 1024;

export function utf8ArrayToString(array, start, length) {

    if (start === undefined)
        start = 0;
    if (length === undefined)
        length = array.length;

    if (USE_MANUAL_UTF8) {
        if (length > SAFE_UTF_LENGTH) {
            return safeUtf8BlobToStr(array, start, length);
        }
        return utf8BlobToStr(array, start, length);
    } else {
        var encodedString = "";
        for (var i=start, iEnd=start+length; i<iEnd; i++)
            encodedString += String.fromCharCode(array[i]);

        return decodeURIComponent(escape(encodedString));
    }
}

export function blobToJson(blob) {

    var decodedString = utf8ArrayToString(blob, 0, blob.length);

    const regex = /\u000e/gi;
    // LMV-6005 Some blobs contained a Shift Out unicode character that could not be parsed by JSON.parse
    // This caused the property data base to not load.
    decodedString = decodedString.replace(regex, '');

    return JSON.parse(decodedString);
}

//parses a piece of json from a given blob (representing an array of json values)
//up to the next comma+newline combo (i.e. array delimiter).
export function subBlobToJson(blob, startIndex) {
    if (startIndex === undefined) {
        return '';
    }

    var i = startIndex;

    while (i<blob.length-1) {
        var c = blob[i];
        if (c == 44 && (blob[i+1] == 10 || blob[i+1] == 13)) //comma followed by newline?
            break;
        if (c == 10 || c == 13) //detect newline or line feed
            break;
        i++;
    }

    var decodedString = utf8ArrayToString(blob, startIndex, i-startIndex);
    try {
        return JSON.parse(decodedString);
    } catch (e) {
        console.error("Error parsing property blob to JSON : " + decodedString);
        return decodedString;
    }
}

export function subBlobToJsonInt(blob, startIndex) {
    var val = 0;
    var i = startIndex;

    //Check for integers that were serialized as strings.
    //This should not happen, ever, but hey, it does.
    if (blob[i] == 34)
        i++;

    while (i<blob.length-1) {
        var c = blob[i];
        if (c == 44 && (blob[i+1] == 10 || blob[i+1] == 13))
            break;
        if (c == 10 || c == 13 || c == 34)
            break;
        if (c >= 48 && c <= 57)
            val = val * 10 + (c - 48);

        i++;
    }

    return val;
}

//Simple integer array parse -- expects the array in property database
//format, where the array is packed with possibly newline separator,
//but no other white space. Does not do extensive error checking
export function parseIntArray(blob, wantSentinel) {

    //find out how many items we have
    var count = 0;
    for (var i= 0, iEnd=blob.length; i<iEnd; i++)
        if (blob[i] == 44) //44 = ','
            count++;

    count++; //last item has no comma after it

    var items = new Uint32Array(count + (wantSentinel ? 1 : 0));

    i=0;
    var end = blob.length;

    while (blob[i] != 91 && i<end) //91 = '['
        i++;

    if (i == blob.length)
        return null;

    i++;

    var seenDigit = false;
    count = 0;
    var curInt = 0;
    while (i<end) {
        var c = blob[i];
        if (c >= 48 && c <= 57) { //digit
            curInt = 10 * curInt + (c - 48);
            seenDigit = true;
        }
        else if (c == 44 || c == 93) { //',' or ']'
            if (seenDigit) {
                items[count++] = curInt;
                seenDigit = false;
                curInt = 0;
            }
        } else {
            seenDigit = false; //most likely a newline (the only other thing we have in our arrays
            curInt = 0;
        }
        i++;
    }

    return items;
}

//Scans an array of json values (strings, integers, doubles) and finds the
//offset of each value in the array, so that we can later pick off that
//specific value, without parsing the whole (potentially huge) json array up front.
//This expects the input blob to be in the form serialized by the property database
//C++ component -- one value per line. A more sophisticated parser would be needed
//in case the format changes and this assumption is not true anymore.
export function findValueOffsets(blob) {

    //first, count how many items we have
    var count = 0;
    var end = blob.length-1;

    for (var i= 0; i<end; i++) {
        if ( blob[i] == 44 && (blob[i+1] == 10 || blob[i+1] == 13)) // ',' + newline is the item delimiter
            count++;
    }

    if (!count)
        return null;

    count++; //one for the last item

    var items = new Uint32Array(count);

    i=0;
    count = 0;

    //find opening [
    while (blob[i] != 91 && i<end) //91 = '['
        i++;

    i++;

    items[count++] = i;
    var seenEol = false;
    while (i<end) {
        if (blob[i] == 10 || blob[i] == 13)
            seenEol = true;
        else if (seenEol) {
            seenEol = false;
            items[count++] = i;
        }

        i++;
    }

    return items;
}
