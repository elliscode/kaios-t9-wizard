#!/usr/bin/env node
// Captures real Season 2 screenshots of the current frontend-v3 build for the
// landing page (landing/images/season2-*.png). Local-only, like tools/replayer
// -- and borrows that tool's Playwright install rather than adding a second one.
//
//   (cd tools/replayer && npm install)   # once, if node_modules is missing
//   node tools/screenshots/capture-season2.js [minutes]   (default 10)
//
// Honest captures only: it loads the game over file:// (which plays fully
// offline, see README.md's "Running it") and screenshots what the game itself
// draws. A small bot plays along so the shots show real lock-ons and kills
// instead of an untouched screen filling up: it watches which words spawn by
// wrapping the Enemy/Powerup/Boss data factories (read-only -- every object
// is passed through untouched) and types their T9 codes as keydown events on
// document, the exact path a real keypress takes through main.js. No game
// state is ever written.
'use strict';

const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'replayer', 'node_modules', 'playwright'));

const REPO_ROOT = path.join(__dirname, '..', '..');
const GAME_URL = 'file://' + path.join(REPO_ROOT, 'frontend-v3', 'index.html');
const OUT_DIR = path.join(REPO_ROOT, 'landing', 'images');
// A real KaiOS app's playable area: 240x294 (the store screenshots in
// frontend-v3/assets/ are 240x320 only because they include the 26px status
// bar). Canvas height drives where the player sits, hence collision timing,
// so capturing at 320 would show runs no phone could actually produce.
const VIEWPORT = { width: 240, height: 294 };
const RUN_MINUTES = Number(process.argv[2]) || 10;
const SHOT_EVERY_S = 15;
const KEY_INTERVAL_MS = 160; // ~6 keys/sec -- a quick but plausible T9 typist
// Enemies are left alone until they've fallen this far down the screen (unless
// the screen is getting crowded), so shots show a busy playfield rather than
// every word being sniped the instant it spawns.
const ENGAGE_AT_FRACTION = 0.45;
const CROWDED_ENEMY_COUNT = 6;

// Runs inside the page. Plays by typing the T9 code of whatever's most
// urgent: powerups first (they win ambiguous lock-ons anyway, see README's
// "Targeting"), then the boss sentence, then the enemy closest to the player.
function startBot(cfg) {
  var keyIntervalMs = cfg.keyIntervalMs;
  var engageY = window.innerHeight * cfg.engageAtFraction;
  var tracked = [];
  var boss = null;
  function track(factory, fn) {
    var original = factory[fn];
    factory[fn] = function (opts) {
      var entity = original(opts);
      if (entity.kind) tracked.push({ entity: entity, lastY: entity.y, stalledMs: 0 });
      else boss = entity;
      return entity;
    };
  }
  track(Enemy, 'createEnemy');
  track(Powerup, 'createPowerup');
  track(Boss, 'createBoss');

  var target = null; // { code, index, ref }
  function press(key) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
  }

  setInterval(function () {
    // An entity the game has removed (killed, escaped, collected, wiped)
    // simply stops moving -- that's the only signal needed to forget it.
    tracked = tracked.filter(function (t) {
      if (t.entity.y === t.lastY) t.stalledMs += keyIntervalMs; else t.stalledMs = 0;
      t.lastY = t.entity.y;
      return t.stalledMs < 400;
    });

    if (target && target.boss && boss && boss.code !== target.code) target = null; // new sentence
    if (target && !target.boss && tracked.indexOf(target.ref) === -1) target = null;
    if (!target) {
      var powerups = tracked.filter(function (t) { return t.entity.kind === 'powerup' && t.entity.y > 0; });
      var enemies = tracked.filter(function (t) { return t.entity.kind === 'enemy' && t.entity.y > 0; })
        .sort(function (a, b) { return b.entity.y - a.entity.y; });
      if (enemies.length < cfg.crowdedEnemyCount) {
        enemies = enemies.filter(function (t) { return t.entity.y > engageY; });
      }
      var pick = powerups[0] || enemies[0];
      if (pick) target = { code: pick.entity.code, index: 0, ref: pick };
      else if (boss && boss.health > 0 && boss.code) target = { code: boss.code, index: 0, boss: true };
    }
    if (!target) return;
    press(target.code[target.index]);
    target.index++;
    if (target.index >= target.code.length) {
      if (!target.boss) tracked.splice(tracked.indexOf(target.ref), 1);
      target = null;
    }
  }, keyIntervalMs);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(GAME_URL);
  // Never resume an old saved run -- every capture starts from the menu.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(1000);

  await page.screenshot({ path: path.join(OUT_DIR, 'season2-menu.png') });
  console.log('saved season2-menu.png');

  await page.evaluate(startBot, {
    keyIntervalMs: KEY_INTERVAL_MS,
    engageAtFraction: ENGAGE_AT_FRACTION,
    crowdedEnemyCount: CROWDED_ENEMY_COUNT,
  });
  await page.keyboard.press('1');

  const shots = Math.floor((RUN_MINUTES * 60) / SHOT_EVERY_S);
  for (let i = 1; i <= shots; i++) {
    await page.waitForTimeout(SHOT_EVERY_S * 1000);
    const name = 'season2-play-' + String(i).padStart(3, '0') + '.png';
    await page.screenshot({ path: path.join(OUT_DIR, name) });
    console.log('saved ' + name);
  }

  await browser.close();
})();
