#!/usr/bin/env node
// Step 3: adds the reviewed words in review/ to
// frontend-v3/data/words-data.js.
//
//   node merge.js                      general list, frontend only
//   node merge.js --theme christmas    themed list instead
//   node merge.js ... --vendor 2       also copy the result over vendored/v2
//
// Only use --vendor for a version that hasn't been released yet: a released
// version's words-data.js must never change, or its runs stop verifying
// (every word picked shifts). v1 is refused outright.
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('./hashing.js');
const { WORDS_DATA_PATH, VENDORED_DIR, REVIEW_DIR, THEMES, loadWordsData } = require('./words-data.js');

const FROZEN_VERSIONS = ['1'];

function parseArgs() {
  const args = process.argv.slice(2);
  const v = args.indexOf('--vendor');
  const vendor = v === -1 ? null : String(args[v + 1] || '').replace(/^v/, '');
  if (v !== -1 && !/^\d+$/.test(vendor)) throw new Error('--vendor needs a version number, e.g. --vendor 2');
  if (vendor && FROZEN_VERSIONS.includes(vendor)) throw new Error('v' + vendor + ' is released and frozen -- refusing to change its word list');
  const t = args.indexOf('--theme');
  const theme = t === -1 ? null : args[t + 1];
  if (t !== -1 && !THEMES[theme]) throw new Error('unknown theme "' + theme + '" -- known: ' + Object.keys(THEMES).join(', '));
  return { vendor, theme };
}

function readReviewFiles(prefix) {
  if (!fs.existsSync(REVIEW_DIR)) throw new Error('no review/ folder -- run candidates.js first');
  const byLength = {};
  const re = new RegExp('^' + prefix + 'len-(\\d+)\\.txt$');
  for (const name of fs.readdirSync(REVIEW_DIR)) {
    const m = name.match(re);
    if (!m) continue;
    byLength[Number(m[1])] = H.readLines(path.join(REVIEW_DIR, name)).map((w) => w.toLowerCase());
  }
  if (!Object.keys(byLength).length) throw new Error('no review/' + prefix + 'len-NN.txt files -- run candidates.js' + (prefix ? ' --theme ' + prefix.slice(0, -1) : '') + ' first');
  return byLength;
}

// Rewrites only the `"N":[...]` lines inside `var <varName> = {...};`,
// leaving every other list and comment untouched.
function replaceBucketLines(src, varName, buckets) {
  const start = src.indexOf('var ' + varName + ' = {');
  const end = src.indexOf('\n};', start);
  if (start === -1 || end === -1) throw new Error('could not find ' + varName + ' in ' + WORDS_DATA_PATH);
  const written = new Set();
  const block = src.slice(start, end).replace(/^\t"(\d+)":\[.*\](,?)$/gm, (line, len, comma) => {
    written.add(len);
    return '\t"' + len + '":' + JSON.stringify(buckets[len]) + comma;
  });
  const missing = Object.keys(buckets).filter((len) => !written.has(len));
  if (missing.length) throw new Error(varName + ' has no line for length ' + missing.join(', ') + ' -- add an empty "N":[] line first');
  return src.slice(0, start) + block + src.slice(end);
}

function main() {
  const { vendor, theme } = parseArgs();
  const { general, themed } = loadWordsData();
  const varName = theme ? THEMES[theme].varName : 'WORDS_BY_LENGTH';
  const target = theme ? themed : general;
  // Same rule as candidates.js: a themed word may also be a general word.
  const existing = new Set();
  for (const byLen of theme ? [themed] : [general, themed]) Object.values(byLen).forEach((ws) => ws.forEach((w) => existing.add(w)));

  const additions = readReviewFiles(theme ? theme + '-' : '');
  const problems = [];
  const seen = new Set();
  for (const len of Object.keys(additions)) {
    if (!target[len]) problems.push('no ' + varName + ' bucket for length ' + len);
    for (const w of additions[len]) {
      if (!/^[a-z]+$/.test(w)) problems.push('len-' + len + ': "' + w + '" is not a-z only');
      else if (w.length !== Number(len)) problems.push('len-' + len + ': "' + w + '" has ' + w.length + ' letters');
      else if (existing.has(w) || seen.has(w)) problems.push('len-' + len + ': "' + w + '" is a duplicate');
      else if (!H.isAcceptable(w)) problems.push('len-' + len + ': a word is blocked (run block.js check on each to find it)');
      seen.add(w);
    }
  }
  if (problems.length) throw new Error('nothing written:\n  ' + [...new Set(problems)].join('\n  '));

  let added = 0;
  for (const len of Object.keys(additions)) {
    target[len] = target[len].concat(additions[len]).sort();
    added += additions[len].length;
  }
  fs.writeFileSync(WORDS_DATA_PATH, replaceBucketLines(fs.readFileSync(WORDS_DATA_PATH, 'utf8'), varName, target));
  console.log('added ' + added + ' words to ' + varName + ' in ' + path.relative(process.cwd(), WORDS_DATA_PATH));

  if (vendor) {
    const dest = path.join(VENDORED_DIR, 'v' + vendor, 'words-data.js');
    if (!fs.existsSync(dest)) throw new Error('no ' + dest + ' -- cut that version first');
    fs.copyFileSync(WORDS_DATA_PATH, dest);
    console.log('copied to ' + path.relative(process.cwd(), dest));
  }

  // Merged words would show up as duplicates on a re-run, and flagged.txt
  // is the one place blocked words sit in plain text -- clear it all out.
  fs.rmSync(REVIEW_DIR, { recursive: true, force: true });
  console.log('removed review/');
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
