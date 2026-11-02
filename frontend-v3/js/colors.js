var Colors = (function () {
  // Season 2 (Christmas): green -> gold -> red as words get longer/harder.
  var ANCHORS = [
    { len: 2, rgb: [144, 238, 144] },  // LightGreen
    { len: 4, rgb: [34, 177, 76] },    // Holly green
    { len: 6, rgb: [218, 165, 32] },   // Goldenrod
    { len: 8, rgb: [230, 92, 40] },    // Ember
    { len: 10, rgb: [214, 40, 40] },   // Christmas red
    { len: 12, rgb: [170, 10, 30] }    // Deep crimson
  ];

  var BOSS_COLORS = {
    1: 'rgb(34, 177, 76)',   // Holly green
    2: 'rgb(218, 165, 32)',  // Goldenrod
    3: 'rgb(230, 92, 40)',   // Ember
    4: 'rgb(214, 40, 40)',   // Christmas red
    5: 'rgb(170, 10, 30)'    // Deep crimson
  };

  function colorForWordLength(len) {
    var clamped = Math.max(2, Math.min(12, len));
    for (var i = 0; i < ANCHORS.length - 1; i++) {
      var lo = ANCHORS[i];
      var hi = ANCHORS[i + 1];
      if (clamped >= lo.len && clamped <= hi.len) {
        var t = (clamped - lo.len) / (hi.len - lo.len);
        var r = Math.round(lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * t);
        var g = Math.round(lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * t);
        var b = Math.round(lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * t);
        return 'rgb(' + r + ',' + g + ',' + b + ')';
      }
    }
    return 'rgb(255,255,255)';
  }

  function bossColorForWorld(world) {
    return BOSS_COLORS[world];
  }

  return {
    colorForWordLength: colorForWordLength,
    bossColorForWorld: bossColorForWorld
  };
})();
