var WordBank = (function () {
  var wordsByLength = WORDS_BY_LENGTH;
  var themedWordsByLength = CHRISTMAS_WORDS_BY_LENGTH;
  // Per-pick chance of drawing from the seasonal themed list instead of the
  // general one. Tunable. Buckets smaller than THEMED_MIN_BUCKET_SIZE are
  // skipped (e.g. length 2 is just "ho") so one word doesn't dominate a length.
  var THEMED_WORD_CHANCE = 0.5;
  var THEMED_MIN_BUCKET_SIZE = 5;

  function pickBucket(len) {
    var themed = themedWordsByLength[String(len)];
    if (themed && themed.length >= THEMED_MIN_BUCKET_SIZE && Rng.next() < THEMED_WORD_CHANCE) {
      return themed;
    }
    return wordsByLength[String(len)];
  }

  function pickWord(minLen, maxLen, activeWordsSet) {
    var MAX_ATTEMPTS = 10;
    var len, bucket, word;
    for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      len = minLen + Math.floor(Rng.next() * (maxLen - minLen + 1));
      bucket = pickBucket(len);
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
