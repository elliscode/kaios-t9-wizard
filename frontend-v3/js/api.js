// Thin fetch wrapper around the deployed backend. Every request is a CORS
// "simple request" (GET/POST, no custom headers, body -- if any -- sent as
// a plain string) so the browser never issues an OPTIONS preflight; the
// deployed API Lambda's parse_body() already sniffs a raw string body by
// content (starts with '{') rather than trusting Content-Type, so this
// works without any backend changes.
//
// None of these functions ever throw or reject -- every failure (network
// error, timeout, non-2xx response) resolves to the same { ok, status, body }
// shape, so every call site in game.js only ever needs a single .then().
var Api = (function () {
  var BASE_URL = 'https://f3uonygr5f.execute-api.us-east-1.amazonaws.com/prod/api/v1';
  var TIMEOUT_MS = 8000;

  function request(path, options) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
    return fetch(BASE_URL + path, {
      method: options.method,
      body: options.body, // plain JSON string, no Content-Type header -- see file header
      signal: controller ? controller.signal : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        return { ok: res.ok, status: res.status, body: json };
      });
    }).catch(function () {
      return { ok: false, status: 0, body: null, networkError: true };
    }).then(function (result) {
      if (timer) clearTimeout(timer);
      return result;
    });
  }

  function start() {
    return request('/start', { method: 'POST' });
  }

  function submit(payload) {
    return request('/submit', { method: 'POST', body: JSON.stringify(payload) });
  }

  function leaderboard() {
    return request('/leaderboard', { method: 'GET' });
  }

  return { start: start, submit: submit, leaderboard: leaderboard };
})();
