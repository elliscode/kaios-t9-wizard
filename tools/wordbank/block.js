#!/usr/bin/env node
// Adds to / checks the hashed blocklist and pattern set without the word
// ever being written anywhere in plain text.
//
//   node block.js word [w]      block an exact word
//   node block.js pattern [p]   block every word containing p (length >= 3)
//   node block.js check [w]     is w blocked, and why?
//
// Leave the word off to be prompted with hidden input, so it doesn't land
// in your shell history either.
'use strict';

const readline = require('readline');
const H = require('./hashing.js');

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (!['word', 'pattern', 'check'].includes(command)) {
    console.error('usage: node block.js word|pattern|check [value]');
    process.exit(1);
  }
  const value = (arg || await promptHidden(command + ': ')).trim().toLowerCase();
  if (!/^[a-z]+$/.test(value)) {
    console.error('expected letters a-z only');
    process.exit(1);
  }

  if (command === 'check') {
    const reasons = [];
    if (H.isBlocked(value)) reasons.push('exact blocklist');
    if (H.matchesPattern(value)) reasons.push(H.isAllowlisted(value) ? 'contains a pattern, but allowlisted' : 'contains a blocked pattern');
    console.log(reasons.length ? 'blocked? ' + (H.isAcceptable(value) ? 'no' : 'yes') + ' (' + reasons.join('; ') + ')' : 'not blocked');
    return;
  }

  if (command === 'pattern' && value.length < H.MIN_PATTERN_LEN) {
    console.error('patterns must be at least ' + H.MIN_PATTERN_LEN + ' letters');
    process.exit(1);
  }
  const file = command === 'word' ? H.BLOCKLIST_PATH : H.PATTERNS_PATH;
  const hashes = H.readLines(file);
  const h = H.hash(value);
  if (hashes.includes(h)) {
    console.log('already blocked');
    return;
  }
  H.writeHashes(file, hashes.concat(h));
  console.log('added 1 hash to ' + require('path').basename(file));
}

main();
