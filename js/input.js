var InputEngine = (function () {
  var buffer = '';
  var lockedEnemyId = null;

  function getBuffer() {
    return buffer;
  }

  function getLockedEnemyId() {
    return lockedEnemyId;
  }

  function reset() {
    buffer = '';
    lockedEnemyId = null;
  }

  function findById(enemies, id) {
    for (var i = 0; i < enemies.length; i++) {
      if (enemies[i].id === id) return enemies[i];
    }
    return null;
  }

  function tieBreakClosestToPlayer(list) {
    // Enemies always outrank powerups regardless of y: enemies fall toward
    // the player (larger y = more urgent), while powerups rise away from the
    // player (larger y = just spawned, least urgent) — the same "largest y"
    // comparison means opposite things for the two kinds, so an urgent
    // enemy must never lose a lock to a freshly-spawned powerup sharing the
    // same digit prefix. Within the same kind, largest y wins as before.
    return list.reduce(function (a, b) {
      var aIsEnemy = a.kind !== 'powerup';
      var bIsEnemy = b.kind !== 'powerup';
      if (aIsEnemy !== bIsEnemy) return aIsEnemy ? a : b;
      return b.y > a.y ? b : a;
    });
  }

  // Returns one of:
  //   { type: 'kill', enemyId }
  //   { type: 'locked', enemyId }
  //   { type: 'progress' }
  //   { type: 'wrong' }  -- locked, but digit doesn't match; ignored, no penalty
  //   { type: 'miss' }   -- unlocked, digit matches no enemy; ignored
  function handleDigit(digit, enemies) {
    if (lockedEnemyId !== null) {
      var locked = findById(enemies, lockedEnemyId);
      var newBuffer = buffer + digit;

      // Once locked, the target cannot change or be abandoned. A wrong digit
      // is simply ignored — no effect on the buffer, lives, or the lock —
      // the player must keep entering the locked word's remaining digits.
      if (!locked || locked.code.indexOf(newBuffer) !== 0) {
        return { type: 'wrong' };
      }

      buffer = newBuffer;
      if (buffer === locked.code) {
        buffer = '';
        lockedEnemyId = null;
        return { type: 'kill', enemyId: locked.id };
      }
      return { type: 'progress' };
    }

    // Not yet locked: the digit picks a fresh target. If multiple enemies'
    // codes start with it, lock onto whichever is closest to the player.
    var candidates = enemies.filter(function (e) { return e.code.indexOf(digit) === 0; });
    if (candidates.length === 0) {
      return { type: 'miss' };
    }

    var target = candidates.length === 1 ? candidates[0] : tieBreakClosestToPlayer(candidates);
    buffer = digit;
    lockedEnemyId = target.id;

    if (buffer === target.code) {
      buffer = '';
      lockedEnemyId = null;
      return { type: 'kill', enemyId: target.id };
    }
    return { type: 'locked', enemyId: target.id };
  }

  return {
    getBuffer: getBuffer,
    getLockedEnemyId: getLockedEnemyId,
    reset: reset,
    handleDigit: handleDigit
  };
})();
