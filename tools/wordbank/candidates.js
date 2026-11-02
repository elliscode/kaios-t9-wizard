#!/usr/bin/env node
// Step 1: proposes new words for frontend-v3/data/words-data.js.
//
//   node candidates.js                    general list (WORDS_BY_LENGTH)
//   node candidates.js --theme christmas  themed list, from themes/christmas.txt
//
// General: downloads a frequency-ranked English list (OpenSubtitles,
// conversational) into .cache/ and keeps common, correctly spelled,
// family-friendly words that aren't in the game yet. Themed: reads a
// hand-written seed file of phrases instead (see README.md). Either way the
// results go to review/ for a manual review pass before merge.js adds them.
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const wordlist = require('wordlist-english');
const H = require('./hashing.js');
const { loadWordsData, DIGIT_LETTERS, firstDigit, REVIEW_DIR, THEMES } = require('./words-data.js');

const FREQ_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt';
const CACHE_PATH = path.join(__dirname, '.cache', 'en_50k.txt');

// How many new words to propose per length, most frequent first. Lengths
// 2-3 are left alone: almost every common word that short is already in.
const TARGET_ADDS = { 4: 0, 5: 250, 6: 250, 7: 250, 8: 300, 9: 350, 10: 350, 11: 300, 12: 200 };
// Every key gets topped up to at least this many words (existing + new)
// at each length in TARGET_ADDS, when the source has enough.
const MIN_WORDS_PER_KEY = 8;

// Themed lists: each length grows to at least THEMED_MIN_PER_LENGTH words,
// or double its current size if that's more; each key gets topped up to
// THEMED_MIN_WORDS_PER_KEY (words.js only uses a themed key bucket with 3+).
const THEMED_LENGTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12];
const THEMED_MIN_PER_LENGTH = 60;
const THEMED_MIN_WORDS_PER_KEY = 5;

// SCOWL sizes 10-50 are its common-words tiers; 55+ adds rarer words.
const SCOWL_SIZES = [10, 20, 35, 40, 50];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
    }).on('error', reject);
  });
}

// "word count" per line, already sorted most frequent first.
function loadFrequencyRanked() {
  return fs.readFileSync(CACHE_PATH, 'utf8').split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function loadSpellingSet() {
  const set = new Set();
  for (const size of SCOWL_SIZES) {
    for (const key of ['english/' + size, 'english/american/' + size]) {
      (wordlist[key] || []).forEach((w) => set.add(w));
    }
  }
  return set;
}

function loadProperNames() {
  try {
    return new Set(fs.readFileSync('/usr/share/dict/propernames', 'utf8').split('\n').map((w) => w.trim().toLowerCase()));
  } catch (e) {
    return new Set();
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--theme');
  if (i === -1) return { theme: null };
  const theme = args[i + 1];
  if (!THEMES[theme]) throw new Error('unknown theme "' + theme + '" -- known: ' + Object.keys(THEMES).join(', '));
  return { theme };
}

// General mode: eligible words per length, most frequent first.
async function generalPool(existing) {
  if (!fs.existsSync(CACHE_PATH)) {
    console.log('downloading ' + FREQ_URL);
    await download(FREQ_URL, CACHE_PATH);
  }
  const spelling = loadSpellingSet();
  const properNames = loadProperNames();
  const pool = {};
  const flagged = [];
  const seen = new Set();
  for (const word of loadFrequencyRanked()) {
    const len = word.length;
    if (!(len in TARGET_ADDS) || seen.has(word)) continue;
    seen.add(word);
    if (!/^[a-z]+$/.test(word) || existing.has(word) || !spelling.has(word) || properNames.has(word)) continue;
    if (H.isBlocked(word)) continue;
    if (H.matchesPattern(word) && !H.isAllowlisted(word)) {
      flagged.push(word);
      continue;
    }
    (pool[len] = pool[len] || []).push(word);
  }
  return { pool, flagged, rejected: [] };
}

// Themed mode: phrases from themes/<theme>.txt, in file order. Every part of
// a phrase must be spelled correctly, except below a "# names" line, where
// proper names and coined words skip the spelling check.
function themedPool(theme, existing) {
  const spelling = loadSpellingSet();
  const pool = {};
  const flagged = [];
  const rejected = [];
  const seen = new Set();
  let names = false;
  for (const raw of fs.readFileSync(THEMES[theme].seedPath, 'utf8').split('\n')) {
    const line = raw.trim().toLowerCase();
    if (/^#\s*names\b/.test(line)) names = true;
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const word = parts.join('');
    const reject = (why) => rejected.push(line + '  -- ' + why);
    if (!/^[a-z]+$/.test(word)) reject('not a-z only');
    else if (word.length < 2 || word.length > 12) reject(word.length + ' letters');
    else if (seen.has(word)) reject('repeated in seed file');
    else if (existing.has(word)) reject('already in the list');
    else if (!names && parts.some((p) => !spelling.has(p))) reject('not in dictionary: ' + parts.filter((p) => !spelling.has(p)).join(' '));
    else if (H.isBlocked(word)) reject('blocked');
    else if (H.matchesPattern(word) && !H.isAllowlisted(word)) flagged.push(word);
    else (pool[word.length] = pool[word.length] || []).push(word);
    seen.add(word);
  }
  return { pool, flagged, rejected };
}

// Takes each length's first `targets[len]` candidates, tops up every key to
// `minPerKey`, and writes review/<prefix>len-NN.txt plus a summary.
function writeReview({ prefix, varName, current, pool, targets, minPerKey, flagged, rejected }) {
  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  const summary = [];
  const header = 'len  ' + Object.keys(DIGIT_LETTERS).map((d) => (d + ' ' + DIGIT_LETTERS[d]).padStart(9)).join('') + '      total';
  summary.push('Words per first key: existing -> existing + proposed', header);

  for (const len of Object.keys(targets).map(Number)) {
    const candidates = pool[len] || [];
    const picked = new Set(candidates.slice(0, targets[len]));
    const countFor = (d) => (current[len] || []).filter((w) => firstDigit(w) === d).length
      + [...picked].filter((w) => firstDigit(w) === d).length;
    for (const d of Object.keys(DIGIT_LETTERS)) {
      let need = minPerKey - countFor(d);
      for (const w of candidates) {
        if (need <= 0) break;
        if (!picked.has(w) && firstDigit(w) === d) {
          picked.add(w);
          need--;
        }
      }
    }

    const lines = ['# ' + len + '-letter words proposed for ' + varName + '. Delete any line you',
      '# don\'t want, then run merge.js. Lines starting with # are ignored.'];
    for (const d of Object.keys(DIGIT_LETTERS)) {
      const words = [...picked].filter((w) => firstDigit(w) === d).sort();
      lines.push('', '# key ' + d + ' (' + DIGIT_LETTERS[d] + ')', ...words);
    }
    fs.writeFileSync(path.join(REVIEW_DIR, prefix + 'len-' + String(len).padStart(2, '0') + '.txt'), lines.join('\n') + '\n');

    const before = (current[len] || []).length;
    summary.push(String(len).padStart(3) + '  ' + Object.keys(DIGIT_LETTERS).map((d) => {
      const had = (current[len] || []).filter((w) => firstDigit(w) === d).length;
      return (had + '->' + countFor(d)).padStart(9);
    }).join('') + '  ' + (before + '->' + (before + picked.size)).padStart(11));
  }

  fs.writeFileSync(path.join(REVIEW_DIR, prefix + 'flagged.txt'),
    ['# Words held back by the sensitive-topic screen. To rescue a false',
      '# positive, add it to allowlist.txt and re-run candidates.js.', '', ...flagged.sort()].join('\n') + '\n');
  if (rejected.length) {
    fs.writeFileSync(path.join(REVIEW_DIR, prefix + 'rejected.txt'),
      ['# Seed phrases dropped before review, and why.', '', ...rejected].join('\n') + '\n');
  }
  fs.writeFileSync(path.join(REVIEW_DIR, prefix + 'summary.txt'), summary.join('\n') + '\n');
  console.log(summary.join('\n'));
  console.log('\n' + flagged.length + ' words held back in review/' + prefix + 'flagged.txt');
  if (rejected.length) console.log(rejected.length + ' seed phrases dropped, see review/' + prefix + 'rejected.txt');
}

async function main() {
  const { theme } = parseArgs();
  const { general, themed } = loadWordsData();

  if (!theme) {
    const existing = new Set();
    for (const byLen of [general, themed]) Object.values(byLen).forEach((ws) => ws.forEach((w) => existing.add(w)));
    const { pool, flagged, rejected } = await generalPool(existing);
    writeReview({ prefix: '', varName: 'WORDS_BY_LENGTH', current: general, pool, targets: TARGET_ADDS,
      minPerKey: MIN_WORDS_PER_KEY, flagged, rejected });
    return;
  }

  // Overlap with the general list is fine (and already common), so only
  // the themed list itself counts as existing.
  const current = themed;
  const existing = new Set([].concat(...Object.values(current)));
  const { pool, flagged, rejected } = themedPool(theme, existing);
  const targets = {};
  for (const len of THEMED_LENGTHS) {
    const have = (current[len] || []).length;
    targets[len] = Math.max(THEMED_MIN_PER_LENGTH, have * 2) - have;
  }
  writeReview({ prefix: theme + '-', varName: THEMES[theme].varName, current, pool, targets,
    minPerKey: THEMED_MIN_WORDS_PER_KEY, flagged, rejected });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
