    var fbuf = new Float32Array(1);
    var ibuf = new Uint32Array(fbuf.buffer);
    var tmp = new Uint16Array(1);
    var hp = new Uint16Array(1);

    export let FloatToHalf = function(f) {

        fbuf[0] = f;
        var x = ibuf[0];
        var i=0;

        if( (x & 0x7FFFFFFF) === 0 ) {  // Signed zero
            hp[i++] = (x >> 16);  // Return the signed zero
        } else { // Not zero
            var xs = x & 0x80000000;  // Pick off sign bit
            var xe = x & 0x7F800000;  // Pick off exponent bits
            var xm = x & 0x007FFFFF;  // Pick off mantissa bits
            if( xe === 0 ) {  // Denormal will underflow, return a signed zero
                hp[i++] = (xs >> 16);
            } else if( xe == 0x7F800000 ) {  // Inf or NaN (all the exponent bits are set)
                if( xm === 0 ) { // If mantissa is zero ...
                    hp[i++] = ((xs >> 16) | 0x7C00); // Signed Inf
                } else {
                    hp[i++] = 0xFE00; // NaN, only 1st mantissa bit set
                }
            } else { // Normalized number
                var hm, he;
                var hs = (xs >> 16); // Sign bit
                var hes = (0|(xe >> 23)) - 127 + 15; // Exponent unbias the single, then bias the halfp
                if( hes >= 0x1F ) {  // Overflow
                    hp[i++] = ((xs >> 16) | 0x7C00); // Signed Inf
                } else if( hes <= 0 ) {  // Underflow
                    if( (14 - hes) > 24 ) {  // Mantissa shifted all the way off & no rounding possibility
                        hm = 0;  // Set mantissa to zero
                    } else {
                        xm |= 0x00800000;  // Add the hidden leading bit
                        hm = (xm >> (14 - hes)); // Mantissa
                        tmp[0] = hm; hm = tmp[0];

                        if( (xm >> (13 - hes)) & 0x00000001 ) // Check for rounding
                            hm += 1; // Round, might overflow into exp bit, but this is OK
                    }
                    hp[i++] = (hs | hm); // Combine sign bit and mantissa bits, biased exponent is zero
                } else {
                    he = (hes << 10); // Exponent
                    tmp[0] = he; he = tmp[0];

                    hm = (xm >> 13); // Mantissa
                    tmp[0] = hm; hm = tmp[0];

                    if( xm & 0x00001000 ) // Check for rounding
                        hp[i++] = (hs | he | hm) + 1; // Round, might overflow to inf, this is OK
                    else
                        hp[i++] = (hs | he | hm);  // No rounding
                }
            }
        }

        return hp[0];
    };


    export let HalfToFloat = function(source)
    {
        var target;

        var h = source & 0xFFFF;
        if( (h & 0x7FFF) === 0 ) {  // Signed zero
            target = h << 16;  // Return the signed zero
        } else { // Not zero
            var hs = h & 0x8000;  // Pick off sign bit
            var he = h & 0x7C00;  // Pick off exponent bits
            var hm = h & 0x03FF;  // Pick off mantissa bits
            if( he === 0 ) {  // Denormal will convert to normalized
                var e = -1; // The following loop figures out how much extra to adjust the exponent
                do {
                    e++;
                    hm <<= 1;
                } while( (hm & 0x0400) === 0 ); // Shift until leading bit overflows into exponent bit
                var xs = (hs) << 16; // Sign bit
                var xes = ((he << 16) >> 26) - 15 + 127 - e; // Exponent unbias the halfp, then bias the single
                var xe = (xes << 23); // Exponent
                var xm = ((hm & 0x03FF)) << 13; // Mantissa
                target = (xs | xe | xm); // Combine sign bit, exponent bits, and mantissa bits
            } else if( he == 0x7C00 ) {  // Inf or NaN (all the exponent bits are set)
                if( hm === 0 ) { // If mantissa is zero ...
                    target = ((hs) << 16) | (0x7F800000); // Signed Inf
                } else {
                    target = 0xFFC00000; // NaN, only 1st mantissa bit set
                }
            } else { // Normalized number
                xs = (hs) << 16; // Sign bit
                xes = ((he << 16) >> 26) - 15 + 127; // Exponent unbias the halfp, then bias the single
                xe = (xes << 23); // Exponent
                xm = (hm) << 13; // Mantissa
                target = (xs | xe | xm); // Combine sign bit, exponent bits, and mantissa bits
            }
        }

        ibuf[0] = target;
        return fbuf[0];
    };

    export let HALF_INT_MAX = 58 * 1024 - 2;

    export let IntToHalf = function(i) {

        if (i > HALF_INT_MAX - 1 || i < 0) {
            console.log("out of range");
            return FloatToHalf(NaN);
        }

        if (i === 0)
            return 0;

        var negate = false;
        if (i > HALF_INT_MAX / 2 - 1) {
            negate = true;
            i -= HALF_INT_MAX / 2 - 1;
        }

        var bucket = Math.abs((i / 1024)) | 0;
        var base = Math.pow(2, bucket - 13);

        var mapped = base + (i - bucket * 1024) * base / 1024;

        if (negate)
            mapped = -mapped;

        return FloatToHalf(mapped);
    };

    export let HalfToInt = function(half) {

        if ( half === 0)
            return 0;

        var f = HalfToFloat(half);

        var negate = false;
        if (f < 0) {
            negate = true;
            f = -f;
        }

        var bucket = 0 | Math.floor((Math.log(f) / Math.log(2)));
        var base = Math.pow(2, bucket);

        var decoded = (f - base) / base * 1024 + (bucket + 13) * 1024;

        if (negate)
            decoded += HALF_INT_MAX / 2 - 1;

        return decoded;
    };

    export let HalfTest = function() {

        var tests = [-1/255, -0.17, -75, -1789, -0.005];

        for (var i=0; i<tests.length; i++) {

            console.log("input", tests[i], "encoded", FloatToHalf(tests[i]), "decoded", HalfToFloat(FloatToHalf(tests[i])));

        }

        for (let i=0; i<HALF_INT_MAX; i++) {
            var roundtrip = HalfToInt(IntToHalf(i));
            if (roundtrip !== i) {
                console.log("Roundtrip failed for", i, roundtrip);
            }
        }

    };
