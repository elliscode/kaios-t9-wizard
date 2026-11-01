// Hashed blocklist + sensitive-topic patterns, so no offensive word ever
// appears in plain text in this repo or its history. Both files hold one
// sha256("t9wizard-wordbank:" + lowercase word) hex digest per line, sorted.
// The fixed prefix means the hashes can't be looked up against a
// precomputed table of plain SHA-256 hashes.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PREFIX = 't9wizard-wordbank:';
const BLOCKLIST_PATH = path.join(__dirname, 'blocklist.sha256');
const PATTERNS_PATH = path.join(__dirname, 'patterns.sha256');
const ALLOWLIST_PATH = path.join(__dirname, 'allowlist.txt');
const MIN_PATTERN_LEN = 3;

function hash(word) {
  return crypto.createHash('sha256').update(PREFIX + word.toLowerCase()).digest('hex');
}

// Hash files and allowlist.txt share a format: one entry per line, '#'
// comments and blank lines ignored.
function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function writeHashes(file, hashes) {
  fs.writeFileSync(file, [...new Set(hashes)].sort().join('\n') + '\n');
}

const blocked = new Set(readLines(BLOCKLIST_PATH));
const patterns = new Set(readLines(PATTERNS_PATH));
const allowed = new Set(readLines(ALLOWLIST_PATH).map((w) => w.toLowerCase()));

function isBlocked(word) {
  return blocked.has(hash(word));
}

function isAllowlisted(word) {
  return allowed.has(word.toLowerCase());
}

// True if any substring of length >= MIN_PATTERN_LEN hashes to a pattern --
// at most 66 hashes for a 12-letter word. Ignores the allowlist; callers
// decide whether an allowlisted match still counts.
function matchesPattern(word) {
  const w = word.toLowerCase();
  for (let len = MIN_PATTERN_LEN; len <= w.length; len++) {
    for (let i = 0; i + len <= w.length; i++) {
      if (patterns.has(hash(w.slice(i, i + len)))) return true;
    }
  }
  return false;
}

// The one check every added word must pass.
function isAcceptable(word) {
  if (isBlocked(word)) return false;
  return !matchesPattern(word) || isAllowlisted(word);
}

module.exports = {
  hash, readLines, writeHashes,
  isBlocked, isAllowlisted, matchesPattern, isAcceptable,
  BLOCKLIST_PATH, PATTERNS_PATH, ALLOWLIST_PATH, MIN_PATTERN_LEN,
};
