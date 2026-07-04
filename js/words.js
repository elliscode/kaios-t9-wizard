var WordBank = (function () {
  var wordsByLength = WORDS_BY_LENGTH;

  function pickWord(minLen, maxLen, activeWordsSet) {
    var MAX_ATTEMPTS = 10;
    var len, bucket, word;
    for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      len = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
      bucket = wordsByLength[String(len)];
      if (!bucket || bucket.length === 0) continue;
      word = bucket[Math.floor(Math.random() * bucket.length)];
      if (!activeWordsSet || !activeWordsSet.has(word)) return word;
    }
    // Fallback after MAX_ATTEMPTS: accept a duplicate rather than loop forever.
    len = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
    bucket = wordsByLength[String(len)];
    return bucket[Math.floor(Math.random() * bucket.length)];
  }

  return {
    pickWord: pickWord
  };
})();
