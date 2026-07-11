// Owns the real <input> element used for display-name entry (see index.html)
// -- a native text input rather than a hand-built T9 multi-tap screen, since
// KaiOS already handles physical-keypad text entry well on its own. game.js
// stays DOM-agnostic everywhere else except through this one seam.
var NameEntry = (function () {
  var input = document.getElementById('name-entry-input');
  var active = false;
  var onSubmit = null;
  var STORAGE_KEY = 't9wizard.lastName';

  function show(submitCallback) {
    active = true;
    onSubmit = submitCallback;
    // Prefill with whatever name was last submitted (see the 'Enter' handler
    // below) -- a repeat player shouldn't have to re-type their name every
    // run. Wrapped defensively like every other localStorage use in this
    // codebase (SaveGame) -- never allowed to break name entry.
    var savedName = '';
    try {
      savedName = window.localStorage.getItem(STORAGE_KEY) || '';
    } catch (e) {}
    input.value = savedName;
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
    if (name) {
      try {
        window.localStorage.setItem(STORAGE_KEY, name);
      } catch (e) {}
    }
    if (name && onSubmit) onSubmit(name);
  });

  return { show: show, hide: hide, isActive: isActive };
})();
