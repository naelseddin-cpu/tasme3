// First-run tour ("how it works", 3 steps), shown once and reachable from the home
// screen («كيف يعمل؟»). Step 2 animates the REAL printed page (official KFGQPC render,
// pages/page-003.webp + its word boxes): the words are veiled, the gold box walks, and
// each word is unveiled in turn, exactly as during a recitation. No text is generated.
(function (global) {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var step = 0, N = 3, anim = null, A = null;

  function demo() {
    var cv = $('obCanvas'); if (!cv) return;
    Promise.all([
      fetch('pages/page-003.json').then(function (r) { return r.json(); }),
      new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = 'pages/page-003.webp'; })
    ]).then(function (v) {
      var data = v[0], img = v[1];
      var lines = [], ys = {};
      data.tokens.forEach(function (t) { var k = t.y.toFixed(3); (ys[k] = ys[k] || []).push(t); });
      Object.keys(ys).sort().slice(0, 2).forEach(function (k) { lines.push(ys[k]); });
      var toks = lines[0].concat(lines[1]);
      var y0 = Math.min.apply(null, toks.map(function (t) { return t.y; })) - 0.004;
      var y1 = Math.max.apply(null, toks.map(function (t) { return t.y + t.h; })) + 0.004;
      var dpr = Math.min(2, global.devicePixelRatio || 1), W = cv.clientWidth, H = Math.round(W * (y1 - y0) * img.naturalHeight / img.naturalWidth);
      cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
      var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
      var words = toks.filter(function (t) { return !t.e; }), shown = 0;
      function frame() {
        ctx.drawImage(img, 0, y0 * img.naturalHeight, img.naturalWidth, (y1 - y0) * img.naturalHeight, 0, 0, W, H);
        var px = 0.004 * W, sy = H / (y1 - y0);
        toks.forEach(function (t) {
          var wi = words.indexOf(t), owner = t.e ? words.indexOf(toks[toks.indexOf(t) - 1]) : wi;
          if (owner >= 0 && owner < shown) return;               // already recited
          ctx.fillStyle = data.veil || '#fffdf5';
          ctx.fillRect(t.x * W - px, (t.y - y0) * sy - px, t.w * W + 2 * px, t.h * sy + 2 * px);
        });
        if (shown < words.length) {
          var w = words[shown]; ctx.strokeStyle = '#c9a43c'; ctx.lineWidth = 2;
          ctx.strokeRect(w.x * W - px, (w.y - y0) * sy - px, w.w * W + 2 * px, w.h * sy + 2 * px);
        }
      }
      clearInterval(anim); frame();
      anim = setInterval(function () { shown = shown >= words.length + 2 ? 0 : shown + 1; frame(); }, 650);
    }).catch(function () {});
  }

  function render() {
    for (var i = 0; i < N; i++) { $('obStep' + i).hidden = i !== step; $('obDot' + i).className = 'obdot' + (i === step ? ' on' : ''); }
    $('obNext').textContent = A.t(step === N - 1 ? 'ob.start' : 'ob.next');
    $('obBack').style.visibility = step ? 'visible' : 'hidden';
    if (step === 1) demo(); else clearInterval(anim);
  }
  function close() {
    clearInterval(anim); $('onboard').hidden = true;
    var st = A.state(); st.settings.onboarded = true; A.save();
  }
  function open() { step = 0; $('onboard').hidden = false; render(); }

  document.addEventListener('tasme3:ready', function () {
    A = global.Tasme3App;
    $('obNext').onclick = function () { if (step < N - 1) { step++; render(); } else close(); };
    $('obBack').onclick = function () { if (step) { step--; render(); } };
    $('obSkip').onclick = close;
    $('hHow').onclick = open;
    global.Tasme3Onboarding = { open: open };
    if (!A.state().settings.onboarded) open();
  });
})(window);
