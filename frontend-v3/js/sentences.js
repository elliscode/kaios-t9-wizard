var SentenceBank = (function () {
  var sentencesByTier = SENTENCES_BY_TIER;

  function pickSentence(tier, activeSentencesSet) {
    var bucket = sentencesByTier[String(tier)];
    var MAX_ATTEMPTS = 10;
    var sentence;
    for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      sentence = bucket[Math.floor(Rng.next() * bucket.length)];
      if (!activeSentencesSet || !activeSentencesSet.has(sentence)) return sentence;
    }
    // Fallback after MAX_ATTEMPTS: accept a repeat rather than loop forever.
    return sentence;
  }

  return {
    pickSentence: pickSentence
  };
})();
