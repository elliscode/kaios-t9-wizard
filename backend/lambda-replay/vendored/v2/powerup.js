var Powerup = (function () {
  function createPowerup(opts) {
    return {
      id: opts.id,
      kind: 'powerup',
      type: opts.type,
      word: opts.word,
      code: opts.code,
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      color: opts.color,
      speed: opts.speed
    };
  }

  return {
    createPowerup: createPowerup
  };
})();
