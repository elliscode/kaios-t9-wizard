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

  // Bonus words (the bonusWords powerup) are enemies that move sideways
  // (vx, px/sec) instead of falling, and can never reach the player. Same
  // typable shape as an enemy so InputEngine treats them identically apart
  // from lock-on priority (see tieBreakClosestToPlayer in js/input.js).
  function createBonusWord(opts) {
    return {
      id: opts.id,
      kind: 'bonus',
      word: opts.word,
      code: opts.code,
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      color: opts.color,
      vx: opts.vx
    };
  }

  return {
    createEnemy: createEnemy,
    createBonusWord: createBonusWord
  };
})();
