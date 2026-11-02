var Boss = (function () {
  function createBoss(opts) {
    return {
      id: opts.id,
      world: opts.world,
      health: opts.health,
      maxHealth: opts.maxHealth,
      sentence: opts.sentence || null,
      code: opts.code || '',
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      color: opts.color,
      speed: opts.speed
    };
  }

  return {
    createBoss: createBoss
  };
})();
