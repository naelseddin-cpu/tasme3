// Visual feedback for every action (founder: "the design must confirm when the user
// presses something, and tell them what is happening when it takes time").
//  - Press: iOS only applies :active styles when a touch listener exists; style.css
//    gives every button a pressed look (scale + glow).
//  - Busy: any foreground request that takes more than 300 ms shows a moving gold bar
//    at the top. Background traffic (engine download ranges, sync, logs, live
//    listening) is excluded; those have their own progress UI.
//  - Tasme3Feedback.busy(label) / done() / toast(text) for slow work that is not a fetch.
(function (global) {
  'use strict';
  document.addEventListener('touchstart', function () {}, { passive: true });

  var bar = document.createElement('div'); bar.className = 'busybar'; bar.hidden = true;
  bar.innerHTML = '<span></span>';
  var label = document.createElement('div'); label.className = 'busylabel'; label.hidden = true;
  var toastEl = document.createElement('div'); toastEl.className = 'fbtoast'; toastEl.hidden = true; toastEl.setAttribute('role', 'status');
  function mount() { document.body.appendChild(bar); document.body.appendChild(label); document.body.appendChild(toastEl); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  var active = 0, showTimer = null, labels = [];
  function start(text) {
    active++; if (text) labels.push(text);
    if (!showTimer && bar.hidden) showTimer = setTimeout(function () {
      showTimer = null; if (!active) return;
      bar.hidden = false;
      if (labels.length) { label.textContent = labels[labels.length - 1]; label.hidden = false; }
    }, 300);
  }
  function stop(text) {
    active = Math.max(0, active - 1);
    if (text) { var i = labels.lastIndexOf(text); if (i >= 0) labels.splice(i, 1); }
    if (!active) { clearTimeout(showTimer); showTimer = null; bar.hidden = true; label.hidden = true; labels = []; }
    else if (labels.length) label.textContent = labels[labels.length - 1];
  }

  var BACKGROUND = /cdn\.hf\.co|huggingface\.co|\/api\/clientlog|\/hifz-api\/(progress|stream|evaluate)|\/hifz\/(models|engine)\//;
  var origFetch = global.fetch && global.fetch.bind(global);
  if (origFetch) global.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var bg = BACKGROUND.test(url) || (init && init.method === 'HEAD') || (init && init.headers && init.headers.Range);
    if (bg) return origFetch(input, init);
    start();
    return origFetch(input, init).then(function (r) { stop(); return r; }, function (e) { stop(); throw e; });
  };

  var toastTimer = null;
  function toast(text, kind) {
    toastEl.textContent = text; toastEl.className = 'fbtoast' + (kind ? ' ' + kind : ''); toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  global.Tasme3Feedback = { busy: start, done: stop, toast: toast };
})(window);
