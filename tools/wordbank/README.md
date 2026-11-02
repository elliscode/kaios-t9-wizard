# T9 Wizard word bank tool (local-only)

Grows the general word list in `frontend-v3/data/words-data.js`
(`WORDS_BY_LENGTH`) with common, correctly spelled, family-friendly words,
through a manual review step. The Christmas list (`CHRISTMAS_WORDS_BY_LENGTH`)
is never touched.

## Usage

```sh
cd tools/wordbank
npm install
node candidates.js       # 1. propose words -> review/len-NN.txt
                         # 2. review: delete any line you don't want
node merge.js --vendor 2 # 3. add them to the game (+ vendored/v2)
```

1. **`candidates.js`** downloads a frequency-ranked English list
   (hermitdave/FrequencyWords `en_50k.txt`, built from OpenSubtitles) into
   `.cache/`. It keeps words that are `[a-z]`, aren't in the game yet, are in
   SCOWL's common-words tiers (sizes 10-50, American spelling), aren't proper
   names, and pass the blocklist. It takes the most frequent ones up to
   `TARGET_ADDS` per length, then tops up every first key to
   `MIN_WORDS_PER_KEY`. Output goes to `review/len-NN.txt`, grouped by first
   key, with a before/after table in `review/summary.txt`. Words held back by
   the sensitive-topic screen go to `review/flagged.txt`.
2. **Review.** Delete any line you don't want. To keep a word from ever being
   proposed again, block it (below). To rescue a false positive from
   `flagged.txt`, add it to `allowlist.txt` and re-run `candidates.js`.
3. **`merge.js`** checks every word again (letters only, right length, no
   duplicates, not blocked), adds them to `WORDS_BY_LENGTH` in sorted order
   and deletes `review/`. `--vendor N` also copies the file over
   `backend/lambda-replay/vendored/vN/words-data.js`. **Only use that for a
   version that hasn't been released yet**: changing a released version's
   words changes which word every random draw picks, so its runs stop
   verifying. v1 is refused.

After merging into a vendored version, redeploy the replay Lambda and the app
together, and clear that version's leaderboard.

## Themed lists

```sh
node candidates.js --theme christmas        # -> review/christmas-len-NN.txt
node merge.js --theme christmas --vendor 2
```

There's no frequency list for seasonal words, so a themed list grows from a
hand-written seed file, `themes/<theme>.txt`: one phrase per line, written
with spaces ("yule log") and run together in the game ("yulelog"). Every
part must be in the same SCOWL dictionary as above, except below a
`# names` line, which is for proper names and coined words ("kris
kringle", "candlelit"). Phrases are taken in file order, so put the most
recognizable first. Each length 4-12 grows to at least 60 words or double
its current size, whichever is more, and every key is topped up to 5
(`THEMED_*` in `candidates.js`). Phrases dropped before review (too long,
misspelled part, already in the list) are listed with the reason in
`review/<theme>-rejected.txt`.

A themed word may also be in the general list, so duplicates are only
checked within the themed list. A new theme needs an entry in `THEMES` in
`words-data.js` (its `var` name and seed file).

## Blocklist (hashed)

No offensive word is ever stored here in plain text. `blocklist.sha256`
(exact words) and `patterns.sha256` (any word containing the pattern) hold
`sha256("t9wizard-wordbank:" + word)` hex digests, sorted. `hashing.js`
checks a word by hashing it, and every substring of 3+ letters, against
them. `allowlist.txt` is plain text: harmless words that happen to contain a
pattern ("therapist").

```sh
node block.js word      # block an exact word (prompts with hidden input)
node block.js pattern   # block every word containing it (3+ letters)
node block.js check     # is a word blocked, and why?
```

Leave the word off the command line, as above, so it doesn't land in your
shell history; `node block.js word <w>` also works.

`review/flagged.txt` does list held-back words in plain text, but `review/`
is gitignored and `merge.js` deletes it.
