var Colors = (function () {
  var ANCHORS = [
    { len: 2, rgb: [211, 211, 211] },  // LightGray
    { len: 4, rgb: [50, 205, 50] },    // LimeGreen
    { len: 6, rgb: [255, 215, 0] },    // Gold
    { len: 8, rgb: [255, 140, 0] },    // DarkOrange
    { len: 10, rgb: [220, 20, 60] },   // Crimson
    { len: 12, rgb: [255, 20, 147] }   // DeepPink
  ];

  var BOSS_COLORS = {
    1: 'rgb(50, 205, 50)',   // LimeGreen
    2: 'rgb(255, 215, 0)',   // Gold
    3: 'rgb(255, 140, 0)',   // DarkOrange
    4: 'rgb(220, 20, 60)',   // Crimson
    5: 'rgb(255, 20, 147)'   // DeepPink
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
