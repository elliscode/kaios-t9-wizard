// Packs an input log ([{tick, key}, ...]) into a compact binary form for a
// final submission payload (once, on a real win) -- NOT used for the local
// checkpoint save, which keeps storing the plain array (simpler, inspectable,
// and well within localStorage's size budget even unpacked).
//
// Each entry is a 3-bit digit ('2'-'9' -> 0-7) plus a delta-ticks-since-the-
// previous-entry field (12 bits, 0-4095 -- ~135s at the game's 30 ticks/sec,
// comfortably covering realistic gaps between keypresses). A delta larger
// than that chains through the reserved max-value sentinel (4095) into
// another 12-bit field, so an arbitrarily long gap (e.g. a long pause) still
// encodes correctly without a full variable-length-integer scheme.
var BitLog = (function () {
  var DIGIT_BITS = 3;
  var DELTA_BITS = 12;
  var DELTA_MAX = (1 << DELTA_BITS) - 1; // 4095, also the chain sentinel

  function digitToCode(key) {
    return key.charCodeAt(0) - '2'.charCodeAt(0); // '2'-'9' -> 0-7
  }

  function codeToDigit(code) {
    return String.fromCharCode(code + '2'.charCodeAt(0));
  }

  function BitWriter() {
    this.bytes = [];
    this.bitBuffer = 0;
    this.bitCount = 0;
  }
  BitWriter.prototype.push = function (value, numBits) {
    for (var i = numBits - 1; i >= 0; i--) {
      this.bitBuffer = (this.bitBuffer << 1) | ((value >> i) & 1);
      this.bitCount++;
      if (this.bitCount === 8) {
        this.bytes.push(this.bitBuffer);
        this.bitBuffer = 0;
        this.bitCount = 0;
      }
    }
  };
  BitWriter.prototype.toUint8Array = function () {
    if (this.bitCount > 0) {
      this.bytes.push(this.bitBuffer << (8 - this.bitCount));
    }
    return new Uint8Array(this.bytes);
  };

  function BitReader(bytes) {
    this.bytes = bytes;
    this.byteIndex = 0;
    this.bitIndex = 0;
  }
  BitReader.prototype.read = function (numBits) {
    var value = 0;
    for (var i = 0; i < numBits; i++) {
      var byte = this.bytes[this.byteIndex] || 0;
      var bit = (byte >> (7 - this.bitIndex)) & 1;
      value = (value << 1) | bit;
      this.bitIndex++;
      if (this.bitIndex === 8) {
        this.bitIndex = 0;
        this.byteIndex++;
      }
    }
    return value;
  };
  BitReader.prototype.hasMore = function () {
    return this.byteIndex < this.bytes.length;
  };

  function packInputLog(inputLog) {
    var writer = new BitWriter();
    var lastTick = 0;
    inputLog.forEach(function (entry) {
      var delta = entry.tick - lastTick;
      lastTick = entry.tick;
      while (delta >= DELTA_MAX) {
        writer.push(DELTA_MAX, DELTA_BITS); // chain sentinel: "add DELTA_MAX, keep reading"
        delta -= DELTA_MAX;
      }
      writer.push(delta, DELTA_BITS);
      writer.push(digitToCode(entry.key), DIGIT_BITS);
    });
    return writer.toUint8Array();
  }

  function unpackInputLog(bytes, count) {
    var reader = new BitReader(bytes);
    var result = [];
    var tick = 0;
    for (var i = 0; i < count; i++) {
      var delta = reader.read(DELTA_BITS);
      while (delta === DELTA_MAX) {
        tick += delta;
        delta = reader.read(DELTA_BITS);
      }
      tick += delta;
      var code = reader.read(DIGIT_BITS);
      result.push({ tick: tick, key: codeToDigit(code) });
    }
    return result;
  }

  return { packInputLog: packInputLog, unpackInputLog: unpackInputLog };
})();
