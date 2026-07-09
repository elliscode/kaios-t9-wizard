// Owns the real <input> element used for display-name entry (see index.html)
// -- a native text input rather than a hand-built T9 multi-tap screen, since
// KaiOS already handles physical-keypad text entry well on its own. game.js
// stays DOM-agnostic everywhere else except through this one seam.
var NameEntry = (function () {
  var input = document.getElementById('name-entry-input');
  var active = false;
  var onSubmit = null;

  function show(submitCallback) {
    active = true;
    onSubmit = submitCallback;
    input.value = '';
    input.style.display = 'block';
    input.focus();
  }

  function hide() {
    active = false;
    onSubmit = null;
    input.style.display = 'none';
    input.blur();
  }

  function isActive() {
    return active;
  }

  input.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !active) return;
    e.preventDefault();
    var name = input.value.trim();
    if (name && onSubmit) onSubmit(name);
  });

  return { show: show, hide: hide, isActive: isActive };
})();
