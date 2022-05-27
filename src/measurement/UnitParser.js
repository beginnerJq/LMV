  export var UnitParser = {};

  // Based on https://github.com/dobriai/footinch/blob/master/lib/parse.js
  function _parse(strIn, base, bigUnitSigns, smallUnitsSigns) {
    if (!strIn) {
      return NaN;
    }
    
    strIn = strIn.toString();

    var str = strIn.trim();
    if (str.length == 0) {
      return NaN;
    }

    var lm;
    var bigUnits = bigUnitSigns.join('| *');
    var smallUnits = smallUnitsSigns.join('| *');

    // Try +-: 1/2", 11/16"; trailing space OK, but nothing else
    // Note: Trailing " is mandatory!
    {
      lm = str.match(new RegExp('^([+-]?\\d+)(?: *)/(?: *)(\\d+)(?: *)(?:' + smallUnits + ') *$'));
      if (lm) {
        return (parseFloat(lm[1]) / parseFloat(lm[2])) / base;
      }
    }

    // Try +-: 1/2', 11/16; trailing space OK, but nothing else
    {
      lm = str.match(new RegExp('^([+-]?\\d+)(?: *)/(?: *)(\\d+)(?: *)(?:' + bigUnits + ')? *$'));
      if (lm) {
        return (parseFloat(lm[1]) / parseFloat(lm[2]));
      }
    }

    // Try +-: 5, 1.2e7, .1e+2, 3e-1, 3.e1
    var firstFloat = NaN;
    {
      lm = str.match(/^[+-]? *(?:\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?/i);
      if (!lm) {
        return NaN;
      }
      firstFloat = parseFloat(lm[0].replace(/ */g, ''));  // Clear spaces on the way
      str = str.slice(lm[0].length);   // Don't trim just yet!
    }

    str = str.replace('-', ' ');

    if (str.length == 0 || isNaN(firstFloat)) {
      return firstFloat;
    }

    var sgn = Math.sign(firstFloat);
    if (sgn === 0) {
      sgn = 1;
    }

    // If inches, then end of story
    if (str.match(new RegExp('^(?: *)(?:' + smallUnits +') *$' ,'i'))) {
      return firstFloat / base;
    }

    {

      lm = str.match(new RegExp('^ +(\\d+)(?: *)/(?: *)(\\d+)(?: *)(?:' + smallUnits + ') *$','i'));
      if (lm) {
        // If original input was: 7 11/16"
        return (firstFloat + sgn * parseFloat(lm[1]) / parseFloat(lm[2])) / base;
      }
    }

    {
      lm = str.match(new RegExp('^(?: *)(?:' + bigUnits + '|-| +-?) *','i'));   // Order matters here!
      if (!lm) {
        return NaN;
      }
      str = str.slice(lm[0].length).trim();
      if (str.length == 0) {
        if (lm[0].match(/-/)) {
          return NaN; // Trailing dash - e.g. strIn was: 7-
        }
        return firstFloat;
      }
    }

    // Now we can only have left: 2, 2.3, 7/8, 2 7/8, with an optional " at the end
    {
      lm = str.match(new RegExp('^(\\d+(?:\\.\\d*)?)(?: *)(?:' + smallUnits + ')? *$'));
      if (lm) {
        return firstFloat + sgn * parseFloat(lm[1]) / base ;
      }

      lm = str.match(new RegExp('^(\\d+)(?: *)/(?: *)(\\d+)(?: *)(?:' + smallUnits + ')? *$'));
      if (lm) {
        return firstFloat + sgn * (parseFloat(lm[1]) / parseFloat(lm[2])) / base ;
      }

      lm = str.match(new RegExp('^(\\d+) +(\\d+)(?: *)/(?: *)(\\d+)(?: *)(?:' + smallUnits + ')? *$'));
      if (lm) {
        return firstFloat + sgn * (parseFloat(lm[1]) + parseFloat(lm[2]) / parseFloat(lm[3])) / base ;
      }
    }

    return NaN;
  }

  /**
   * Parses a string of fractional feet or decimal feet to a decimal feet number
   * @param {string} input - input string of the number
   * @returns {number} parsed value represented as a number
   */
  UnitParser.parseFeet = function (input) {
    return _parse(input, 12.0, ['ft', 'feet', '\'', '`', '‘', '’'], ['in', 'inch', '\\"', '\'\'', '``', '‘‘', '’’']);
  };


  UnitParser.parseMeter = function (input) {
    return _parse(input, 100.0, ['m', 'meter'], ['cm', 'centimeter']);
  };

  /**
   * Parses a string of fractional or decimal number into a decimal number.
   * Valid input examples: 1, 1.2e3, -2, 2cm, 4", 4.1', 1 2/3, 1 2 3/4, 1 2-3/4, 1ft 2-3/4in, 1' 2-3/4"
   * 
   * @param {string} input - input string of the number.
   * @param {string} inputUnits - the type of the units of the number.
   * @returns {number} parsed value represented as a decimal number.
   */
  UnitParser.parseNumber = function (input, inputUnits) {
    switch (inputUnits) {
      case 'ft':
      case 'decimal-ft':
      case 'ft-and-fractional-in':
      case 'ft-and-decimal-in':
      case 'decimal-in':
      case 'fractional-in':
        return UnitParser.parseFeet(input);

      case '':
      case 'm':
      case 'cm':
      case 'mm':
      case 'm-and-cm':
      default:
        return UnitParser.parseMeter(input);
    }
  };

  UnitParser.parsePositiveNumber = function (input, inputUnits) {
    var parsedNumber = UnitParser.parseNumber(input, inputUnits);
    return parsedNumber >= 0 ? parsedNumber : NaN;
  };

