var WordBank = (function () {
  var wordsByLength = WORDS_BY_LENGTH;
  var themedWordsByLength = CHRISTMAS_WORDS_BY_LENGTH;
  // Per-pick chance of drawing from the seasonal themed list instead of the
  // general one. Tunable. Buckets smaller than THEMED_MIN_BUCKET_SIZE are
  // skipped (e.g. length 2 is just "ho") so one word doesn't dominate a length.
  var THEMED_WORD_CHANCE = 0.5;
  var THEMED_MIN_BUCKET_SIZE = 5;
  // Screen-aware first-key picks (see pickWordForDigits). A key is only
  // eligible at a length if it has at least MIN_DIGIT_BUCKET_SIZE general
  // words there (e.g. no 12-letter word starts with 9), and the themed list
  // is only used for a key/length with at least THEMED_MIN_DIGIT_BUCKET_SIZE
  // themed words -- otherwise one word would dominate. Tunable.
  var MIN_DIGIT_BUCKET_SIZE = 5;
  var THEMED_MIN_DIGIT_BUCKET_SIZE = 3;
  // Fixed iteration order, so every Rng.next() draw below is identical on
  // the client and the replay engine.
  var DIGITS = ['2', '3', '4', '5', '6', '7', '8', '9'];

  // { len: { digit: [words] } }, built once from static data (no Rng use).
  function indexByFirstDigit(byLength) {
    var index = {};
    Object.keys(byLength).forEach(function (len) {
      var byDigit = {};
      DIGITS.forEach(function (d) { byDigit[d] = []; });
      byLength[len].forEach(function (word) {
        var digit = T9.LETTER_TO_DIGIT[word.charAt(0).toLowerCase()];
        if (digit) byDigit[digit].push(word);
      });
      index[len] = byDigit;
    });
    return index;
  }
  var wordsByLengthAndDigit = indexByFirstDigit(wordsByLength);
  var themedWordsByLengthAndDigit = indexByFirstDigit(themedWordsByLength);

  function pickBucket(len) {
    var themed = themedWordsByLength[String(len)];
    if (themed && themed.length >= THEMED_MIN_BUCKET_SIZE && Rng.next() < THEMED_WORD_CHANCE) {
      return themed;
    }
    return wordsByLength[String(len)];
  }

  // Picks which first key the next word at `len` starts with: among keys
  // with enough words at that length, the ones the fewest on-screen words
  // already start with, then weighted by how many words each has (so common
  // keys like 2/7 stay common and rare ones like 5/9 don't over-repeat).
  // Returns null if no key qualifies.
  function pickDigit(len, onScreenDigitCounts) {
    var byDigit = wordsByLengthAndDigit[String(len)];
    if (!byDigit) return null;
    var fewest = Infinity;
    var candidates = [];
    DIGITS.forEach(function (d) {
      if (byDigit[d].length < MIN_DIGIT_BUCKET_SIZE) return;
      var count = onScreenDigitCounts[d] || 0;
      if (count < fewest) {
        fewest = count;
        candidates = [d];
      } else if (count === fewest) {
        candidates.push(d);
      }
    });
    if (candidates.length === 0) return null;
    var total = 0;
    candidates.forEach(function (d) { total += byDigit[d].length; });
    var roll = Rng.next() * total;
    for (var i = 0; i < candidates.length; i++) {
      roll -= byDigit[candidates[i]].length;
      if (roll < 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  // Same shape as pickBucket, narrowed to words starting with `digit`.
  function pickDigitBucket(len, digit) {
    var themed = themedWordsByLengthAndDigit[String(len)];
    if (themed && themed[digit].length >= THEMED_MIN_DIGIT_BUCKET_SIZE && Rng.next() < THEMED_WORD_CHANCE) {
      return themed[digit];
    }
    return wordsByLengthAndDigit[String(len)][digit];
  }

  function pickBucketFor(len, onScreenDigitCounts) {
    if (!onScreenDigitCounts) return pickBucket(len);
    var digit = pickDigit(len, onScreenDigitCounts);
    return digit ? pickDigitBucket(len, digit) : pickBucket(len);
  }

  // onScreenDigitCounts (optional): { digit: how many on-screen words start
  // with it }. When given, the word's first key is steered away from keys
  // already on screen (see pickDigit), so fewer words share a first key.
  function pickWord(minLen, maxLen, activeWordsSet, onScreenDigitCounts) {
    var MAX_ATTEMPTS = 10;
    var len, bucket, word;
    for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      len = minLen + Math.floor(Rng.next() * (maxLen - minLen + 1));
      bucket = pickBucketFor(len, onScreenDigitCounts);
      if (!bucket || bucket.length === 0) continue;
      word = bucket[Math.floor(Rng.next() * bucket.length)];
      if (!activeWordsSet || !activeWordsSet.has(word)) return word;
    }
    // Fallback after MAX_ATTEMPTS: accept a duplicate rather than loop forever.
    len = minLen + Math.floor(Rng.next() * (maxLen - minLen + 1));
    bucket = wordsByLength[String(len)];
    return bucket[Math.floor(Rng.next() * bucket.length)];
  }

  return {
    pickWord: pickWord
  };
})();
