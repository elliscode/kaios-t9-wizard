// Shared helpers for reading/writing frontend-v3/data/words-data.js.
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const WORDS_DATA_PATH = path.join(REPO_ROOT, 'frontend-v3', 'data', 'words-data.js');
const VENDORED_DIR = path.join(REPO_ROOT, 'backend', 'lambda-replay', 'vendored');
const REVIEW_DIR = path.join(__dirname, 'review');

// Themed lists: --theme <name> on candidates.js / merge.js.
const THEMES = {
  christmas: { varName: 'CHRISTMAS_WORDS_BY_LENGTH', seedPath: path.join(__dirname, 'themes', 'christmas.txt') },
};

const DIGIT_LETTERS = { 2: 'abc', 3: 'def', 4: 'ghi', 5: 'jkl', 6: 'mno', 7: 'pqrs', 8: 'tuv', 9: 'wxyz' };
const LETTER_TO_DIGIT = {};
Object.keys(DIGIT_LETTERS).forEach((d) => DIGIT_LETTERS[d].split('').forEach((c) => { LETTER_TO_DIGIT[c] = d; }));

function firstDigit(word) {
  return LETTER_TO_DIGIT[word.charAt(0)];
}

// The file is plain `var X = {...};` globals, same as the browser loads it.
function loadWordsData(file) {
  const g = {};
  new Function('g', fs.readFileSync(file || WORDS_DATA_PATH, 'utf8').replace(/^var /gm, 'g.'))(g);
  return { general: g.WORDS_BY_LENGTH, themed: g.CHRISTMAS_WORDS_BY_LENGTH };
}

module.exports = { REPO_ROOT, WORDS_DATA_PATH, VENDORED_DIR, REVIEW_DIR, THEMES, DIGIT_LETTERS, firstDigit, loadWordsData };
