var Enemy = (function () {
  function createEnemy(opts) {
    return {
      id: opts.id,
      kind: 'enemy',
      word: opts.word,
      code: opts.code,
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      color: opts.color,
      baseSpeed: opts.baseSpeed
    };
  }

  return {
    createEnemy: createEnemy
  };
})();
