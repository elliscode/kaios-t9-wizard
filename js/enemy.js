var Enemy = (function () {
  function createEnemy(opts) {
    return {
      id: opts.id,
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
    createEnemy: createEnemy
  };
})();
