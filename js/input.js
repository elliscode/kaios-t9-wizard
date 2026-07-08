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

  // Save/restore this module's internal state around a headless replay
  // (see Game.replayRun) -- InputEngine is a single shared singleton, so a
  // replay run mutating buffer/lockedEnemyId would otherwise clobber
  // whatever a live, in-progress game session had typed so far.
  function snapshot() {
    return { buffer: buffer, lockedEnemyId: lockedEnemyId };
  }

  function restoreSnapshot(snap) {
    buffer = snap.buffer;
    lockedEnemyId = snap.lockedEnemyId;
  }

  function findById(enemies, id) {
    for (var i = 0; i < enemies.length; i++) {
      if (enemies[i].id === id) return enemies[i];
    }
    return null;
  }

  function tieBreakClosestToPlayer(list) {
    // Powerups always outrank enemies regardless of y: a powerup is
    // time-limited (it flies off-screen and is lost) and should always win
    // an ambiguous shared-prefix match, even over an enemy that's physically
    // closer to the player — the player can always come back for that enemy,
    // but a missed powerup is gone for good. Within the same kind, largest y
    // (closest to the player) wins as before.
    return list.reduce(function (a, b) {
      var aIsPowerup = a.kind === 'powerup';
      var bIsPowerup = b.kind === 'powerup';
      if (aIsPowerup !== bIsPowerup) return aIsPowerup ? a : b;
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
    handleDigit: handleDigit,
    snapshot: snapshot,
    restoreSnapshot: restoreSnapshot
  };
})();
