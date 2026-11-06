// Voice training (owner, 11-06: "Quran recite, search in Quran, and training your voice,
// just the voice"). Trains the voice only, not tajweed: a deep, steady tone, long breath
// and smooth glides. Listen to a target (a hum generated here, never a reciter's voice),
// repeat it into the mic, follow the live pitch line, get four numbers, and watch progress.
// Pitch: YIN (pitch.js). Everything runs on the phone; nothing is uploaded.
// Test hook: ?fake=follow (a synthetic singer follows each target) or ?fake=110.
(function () {
  'use strict';
  var P = window.Tasme3Pitch, $ = function (id) { return document.getElementById(id); };
  var Q = new URLSearchParams(location.search), FAKE = Q.get('fake');

  // ---------- language ----------
  var lang = Q.get('lang');
  if (!lang) try { var s0 = JSON.parse(localStorage.getItem('tasme3_v1') || '{}').settings || {}; lang = s0.langChosen && s0.lang === 'en' ? 'en' : 'ar'; } catch (_) { lang = 'ar'; }
  var T = {
    ar: {
      title: 'تدريب الصوت', sub: 'للصوت وحده لا للتجويد: صوت عميق ثابت، ونَفَس طويل، وانتقال ناعم بين الطبقات.',
      voiceType: 'طبقة صوتك', voiceLow: 'رجالية (منخفضة)', voiceHigh: 'نسائية أو صبي (مرتفعة)',
      base: 'نغمتك الأساسية: {n}', baseFound: 'من اختبار المدى: أخفض نغمة مريحة {lo} وأعلاها {hi}',
      progress: 'تقدّمك', noProgress: 'ابدأ تمرينًا وسيظهر تقدّمك هنا يومًا بعد يوم.',
      progText: 'أطول نَفَس {b} ث · أخفض نغمة {lo} · متوسط دقة الطبقة {p}',
      note: 'النغمة المرجعية صوت همهمة يولَّد على جهازك، لا صوت قارئ. لا يُرفع صوتك إلى أي مكان.',
      'range.t': 'اكتشف مداك', 'range.s': 'أخفض وأعلى نغمة مريحة لك',
      'range.h': 'انزل بصوتك ببطء إلى أخفض نغمة مريحة واثبت عليها، ثم اصعد إلى أعلى نغمة مريحة. لا تُجهد حلقك.',
      'low.t': 'النغمة المنخفضة الطويلة', 'low.s': 'عمق وثبات',
      'low.h': 'استمع إلى النغمة، ثم أعدها بصوت هادئ «آآآ» وأبقها ثابتة كخط مستقيم.',
      'glide.t': 'الانزلاق', 'glide.s': 'نزول وصعود ناعم',
      'glide.h': 'استمع، ثم انزل بصوتك ببطء مع الخط الذهبي واصعد معه، بلا قفزات.',
      'breath.t': 'النَّفَس الطويل', 'breath.s': 'هدفك اليوم {g} ثانية',
      'breath.h': 'خذ نفسًا عميقًا من البطن، ثم أمسك النغمة بهدوء أطول ما تستطيع دون إجهاد. يتوقف العدّ حين تسكت.',
      'call.t': 'النداء والترديد', 'call.s': 'جمل قصيرة في الطبقة المنخفضة',
      'call.h': 'استمع إلى الجملة القصيرة، ثم رددها كما سمعتها.',
      listen: 'استمع…', yourTurn: 'دورك الآن', waiting: 'ابدأ بالصوت…', goLow: 'انزل إلى أخفض نغمة مريحة', goHigh: 'اصعد إلى أعلى نغمة مريحة',
      up: '▲ أعلى قليلًا', down: '▼ أخفض قليلًا', hold: '● ثابت، أحسنت', quiet: 'لا أسمعك… ارفع صوتك قليلًا',
      start: 'ابدأ', again: 'مرة أخرى', stop: 'توقّف', back: 'رجوع', sec: 'ث',
      sPitch: 'دقة الطبقة من 100', sWobble: 'الاهتزاز (سنت، الأقل أفضل)', sBreath: 'أطول نَفَس (ثانية)', sLow: 'أخفض نغمة مريحة',
      tipSteady: 'ثبات ممتاز.', tipWobble: 'الصوت يهتز: ادعمه من البطن واجعل الهواء يخرج بانتظام.',
      tipSharp: 'صوتك أعلى من الهدف في الغالب: استرخِ وانزل قليلًا.', tipFlat: 'صوتك أخفض من الهدف في الغالب: ارفعه قليلًا.',
      tipBreath: 'رقم قياسي جديد للنَّفَس: {b} ثانية!', tipNone: 'لم أسمع صوتًا كافيًا. اقترب من الميكروفون وحاول مرة أخرى.',
      micTitle: 'نحتاج الميكروفون', micWhy: 'ليسمع التطبيق نغمتك ويرسم طبقة صوتك. الصوت يبقى على جهازك ولا يُسجَّل.',
      micOk: 'اسمح بالميكروفون', micBlocked: 'الميكروفون محجوب. افتح إعدادات الموقع في المتصفح (رمز القفل بجانب العنوان) واسمح بالميكروفون، ثم أعد تحميل الصفحة.',
      noSupport: 'هذا المتصفح لا يدعم الميكروفون. جرّب Chrome أو Safari الحديث.'
    },
    en: {
      title: 'Voice training', sub: 'The voice only, not tajweed: a deep steady tone, long breath, smooth glides.',
      voiceType: 'Your voice', voiceLow: 'Men (low)', voiceHigh: 'Women or boy (high)',
      base: 'Your base note: {n}', baseFound: 'From the range test: lowest comfortable {lo}, highest {hi}',
      progress: 'Your progress', noProgress: 'Do an exercise and your progress shows here day by day.',
      progText: 'Longest breath {b} s · lowest note {lo} · average pitch accuracy {p}',
      note: 'The reference is a hum made on your phone, not a reciter\'s voice. Your voice is never uploaded.',
      'range.t': 'Find your range', 'range.s': 'Your lowest and highest comfortable notes',
      'range.h': 'Slide slowly down to your lowest comfortable note and hold it, then up to your highest comfortable note. Don\'t strain.',
      'low.t': 'Long low note', 'low.s': 'Depth and steadiness',
      'low.h': 'Listen to the note, then sing it back on a calm "aaa" and keep it as straight as a line.',
      'glide.t': 'Glides', 'glide.s': 'Smooth down and up',
      'glide.h': 'Listen, then slide your voice slowly down with the gold line and back up, without jumps.',
      'breath.t': 'Long breath', 'breath.s': 'Today\'s goal: {g} seconds',
      'breath.h': 'Breathe deep from the belly, then hold the note calmly as long as you can without straining. The count stops when you stop.',
      'call.t': 'Call and repeat', 'call.s': 'Short phrases in the low range',
      'call.h': 'Listen to the short phrase, then repeat it as you heard it.',
      listen: 'Listen…', yourTurn: 'Your turn', waiting: 'Start singing…', goLow: 'Go down to your lowest comfortable note', goHigh: 'Go up to your highest comfortable note',
      up: '▲ A little higher', down: '▼ A little lower', hold: '● Steady, well done', quiet: 'I can\'t hear you… a little louder',
      start: 'Start', again: 'Again', stop: 'Stop', back: 'Back', sec: 's',
      sPitch: 'Pitch accuracy /100', sWobble: 'Wobble (cents, lower is better)', sBreath: 'Longest breath (s)', sLow: 'Lowest comfortable note',
      tipSteady: 'Very steady.', tipWobble: 'The note wobbles: support it from the belly and let the air out evenly.',
      tipSharp: 'You are mostly above the target: relax and come down a little.', tipFlat: 'You are mostly below the target: lift it a little.',
      tipBreath: 'New breath record: {b} seconds!', tipNone: 'Not enough voice heard. Come closer to the mic and try again.',
      micTitle: 'We need the microphone', micWhy: 'So the app can hear your note and draw your pitch. Sound stays on your phone and is not recorded.',
      micOk: 'Allow the microphone', micBlocked: 'The microphone is blocked. Open the site settings in your browser (the lock by the address), allow the microphone, then reload.',
      noSupport: 'This browser has no microphone support. Try a recent Chrome or Safari.'
    }
  };
  function t(k, v) { var s = (T[lang][k] || T.ar[k] || k); return v ? s.replace(/\{(\w+)\}/g, function (_, n) { return v[n]; }) : s; }
  function applyLang() {
    document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t('title');
    [].forEach.call(document.querySelectorAll('[data-t]'), function (el) { el.textContent = t(el.getAttribute('data-t')); });
    $('langBtn').textContent = lang === 'ar' ? 'English' : 'العربية';
    $('toHifz').textContent = lang === 'ar' ? '‹ تسميع' : '‹ Memorization';
    renderMenu();
  }

  // ---------- saved data (this phone) ----------
  var KEY = 'tasme3_voice_v1';
  var D = (function () { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } })();
  D.voice = D.voice || 'low'; D.hist = D.hist || []; D.breathBest = D.breathBest || 0;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (_) {} }
  function base() { return D.low ? D.low * Math.pow(2, 3 / 12) : (D.voice === 'low' ? 130.8 : 261.6); } // 3 semitones above the lowest comfortable note
  function semis(n) { return base() * Math.pow(2, n / 12); }
  function noteLabel(hz) { return hz ? P.noteName(hz) + ' · ' + Math.round(hz) + ' Hz' : '—'; }

  // ---------- exercises: a target contour (hz at t seconds) ----------
  var PATTERNS = [[0, 2, 0], [0, 3, 2, 0], [0, -2, 0], [0, 2, 3, 2, 0], [0, 5, 3, 0], [0, -2, -3, -2, 0]];
  var EX = {
    range: { n: 1, parts: [{ cue: 'goLow', dur: 7 }, { cue: 'goHigh', dur: 7 }] },
    low: { n: 2, dur: 8, listen: 3, target: function () { return semis(0); } },
    glide: { n: 3, dur: 8, listen: 8, target: function (s) { return semis(s < 4 ? 7 - 7 * s / 4 : 7 * (s - 4) / 4); } },
    breath: { n: 4, dur: 90, listen: 2, open: true, target: function () { return semis(0); } },
    call: { n: 5, listen: 0, target: null }
  };
  function callPattern() { var p = PATTERNS[(D.callRound || 0) % PATTERNS.length]; return { dur: p.length * 0.8, f: function (s) { return semis(p[Math.min(p.length - 1, Math.floor(s / 0.8))]); } }; }

  // ---------- audio ----------
  var ctx = null, an = null, buf = null, stream = null, fakeOsc = null, fakeGain = null;
  function ensureCtx() { if (!ctx) { var C = window.AudioContext || window.webkitAudioContext; ctx = new C(); } if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  function hum(freqAt, dur) { // the reference: a soft generated hum (harmonics + gentle envelope)
    var c = ensureCtx(), o = c.createOscillator(), g = c.createGain(), now = c.currentTime + 0.05;
    o.setPeriodicWave(c.createPeriodicWave(new Float32Array([0, 1, 0.55, 0.3, 0.16, 0.08]), new Float32Array(6)));
    for (var s = 0; s <= dur; s += 0.05) o.frequency.setValueAtTime(freqAt(s), now + s);
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.25, now + 0.15);
    g.gain.setValueAtTime(0.25, now + dur - 0.2); g.gain.linearRampToValueAtTime(0, now + dur);
    o.connect(g); g.connect(c.destination); o.start(now); o.stop(now + dur + 0.05);
    return new Promise(function (res) { setTimeout(res, dur * 1000 + 150); });
  }
  function micStart() {
    var c = ensureCtx();
    an = c.createAnalyser(); an.fftSize = 2048; buf = new Float32Array(an.fftSize);
    if (FAKE) { // test singer: an oscillator instead of the microphone
      fakeOsc = c.createOscillator(); var g = fakeGain = c.createGain(); g.gain.value = 0.3;
      fakeOsc.setPeriodicWave(c.createPeriodicWave(new Float32Array([0, 0.6, 1, 0.6, 0.3, 0.15]), new Float32Array(6)));
      fakeOsc.frequency.value = +FAKE || 110; fakeOsc.connect(g); g.connect(an); fakeOsc.start();
      return Promise.resolve();
    }
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(function (s) {
      stream = s; c.createMediaStreamSource(s).connect(an); D.micOk = true; save();
    });
  }
  function micStop() {
    if (stream) stream.getTracks().forEach(function (x) { x.stop(); }); stream = null;
    if (fakeOsc) { try { fakeOsc.stop(); } catch (_) {} fakeOsc = null; }
  }
  function readPitch() {
    an.getFloatTimeDomainData(buf);
    var lvl = P.rms(buf), r = lvl > 0.008 ? P.yin(buf, ctx.sampleRate, 60, 1000, 0.15) : { hz: 0 };
    return { hz: r.hz, lvl: lvl };
  }

  // ---------- the chart ----------
  var chart = { lo: 40, hi: 60, target: null, pts: [], dur: 8 };
  function setRange(lo, hi) { chart.lo = lo; chart.hi = hi; }
  function draw(now) {
    var cv = $('vChart'), dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    var X = function (s) { return 8 + (W - 16) * s / chart.dur; }, Y = function (hz) { return H - 8 - (H - 16) * (P.hzToMidi(hz) - chart.lo) / (chart.hi - chart.lo); };
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1; g.fillStyle = 'rgba(255,255,255,.35)'; g.font = '10px system-ui';
    for (var m = Math.ceil(chart.lo); m <= chart.hi; m++) if (m % 12 === 0 || m % 12 === 7) { var y = Y(P.midiToHz(m)); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.fillText(P.noteName(P.midiToHz(m)), 2, y - 2); }
    if (chart.target) {
      g.strokeStyle = 'rgba(212,185,106,.85)'; g.lineWidth = 7; g.lineCap = 'round'; g.globalAlpha = 0.45; g.beginPath();
      for (var s = 0; s <= chart.dur; s += 0.05) { var f = chart.target(s); if (f) s ? g.lineTo(X(s), Y(f)) : g.moveTo(X(s), Y(f)); }
      g.stroke(); g.globalAlpha = 1;
    }
    g.strokeStyle = '#ffffff'; g.lineWidth = 2.5; g.beginPath(); var on = false;
    chart.pts.forEach(function (p) { if (!p.hz) { on = false; return; } var x = X(p.s), y = Y(p.hz); on ? g.lineTo(x, y) : g.moveTo(x, y); on = true; });
    g.stroke();
    if (now != null) { g.strokeStyle = 'rgba(212,185,106,.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(now), 0); g.lineTo(X(now), H); g.stroke(); }
  }
  function fold(hz, tg) { if (!tg || !hz) return hz; while (hz / tg > Math.SQRT2) hz /= 2; while (tg / hz > Math.SQRT2) hz *= 2; return hz; } // same note, other octave

  // ---------- running one exercise ----------
  var cur = null, running = false, stopFlag = false;
  function cue(text, cls) { var c = $('vCue'); c.textContent = text; c.className = 'vcue' + (cls ? ' ' + cls : ''); }

  function record(opts) { // opts: {target, dur, open, cueText}; resolves with frames [{t, hz}]
    return new Promise(function (resolve) {
      var frames = [], t0 = null, start = performance.now(), lastVoice = 0, quietSince = start;
      chart.pts = []; chart.target = opts.target; chart.dur = opts.open ? Math.max(12, opts.goal || 12) : opts.dur + 0.5;
      cue(opts.cueText || t('waiting'), 'listen');
      var iv = setInterval(function () {
        var now = performance.now(), el = (now - start) / 1000, r = readPitch();
        if (FAKE === 'follow') fakeOsc.frequency.value = opts.target ? opts.target(t0 === null ? 0 : el - t0 + 0.03) * (1 + 0.004 * Math.sin(el * 30)) : (opts.cueText === t('goHigh') ? 160 + el * 6 : 110 - el * 3);
        if (FAKE && Q.get('fakeBreath') && t0 !== null) fakeGain.gain.value = el - t0 > +Q.get('fakeBreath') ? 0 : 0.3;
        $('vLevel').style.width = Math.min(100, Math.max(0, (20 * Math.log10(r.lvl + 1e-6) + 60) * 100 / 54)) + '%';
        if (r.hz && t0 === null) t0 = el;
        var s = t0 === null ? 0 : el - t0;
        frames.push({ t: el, hz: r.hz });
        var tg = opts.target && t0 !== null ? opts.target(s) : 0, hz = fold(r.hz, tg);
        if (t0 !== null) chart.pts.push({ s: s, hz: r.hz ? hz : 0 });
        if (opts.open && s > chart.dur - 1) chart.dur = s + 6;
        $('vNote').textContent = r.hz ? noteLabel(r.hz) : '—';
        $('vTimer').textContent = t0 === null ? '' : s.toFixed(1) + ' ' + t('sec');
        if (r.hz) { lastVoice = now; quietSince = now; }
        if (t0 !== null) {
          if (!r.hz && now - lastVoice > 400) cue(t('quiet'));
          else if (tg && r.hz) { var e = P.cents(hz, tg); e > 35 ? cue(t('down'), 'down') : e < -35 ? cue(t('up'), 'up') : cue(t('hold'), 'hold'); }
          else if (r.hz && opts.cueText) cue(opts.cueText, 'listen');
        }
        draw(t0 === null ? null : s);
        var done = stopFlag
          || (t0 === null && el > 8)                                   // nobody sang
          || (!opts.open && t0 !== null && s > opts.dur + 0.4)
          || (opts.open && t0 !== null && now - lastVoice > 1200)      // breath: stops when the voice stops
          || el > 100;
        if (done) { clearInterval(iv); resolve(frames); }
      }, 30);
    });
  }

  function signedMean(frames, target) {
    var v = frames.filter(function (f) { return f.hz; }); if (!v.length || !target) return 0;
    var t0 = v[0].t, e = v.map(function (f) { var tg = target(f.t - t0); return tg ? P.cents(fold(f.hz, tg), tg) : 0; });
    return e.reduce(function (a, b) { return a + b; }, 0) / e.length;
  }

  function showScores(sc, extraTip) {
    $('vScores').hidden = false;
    $('sPitch').textContent = sc && sc.pitch != null ? sc.pitch : '—';
    $('sWobble').textContent = sc ? '±' + sc.wobble : '—';
    $('sBreath').textContent = sc ? sc.breath.toFixed(1) : '—';
    $('sLow').textContent = sc && sc.low ? P.noteName(sc.low) : '—';
    $('vTip').textContent = extraTip || '';
  }

  function run() {
    if (running) { stopFlag = true; return; }
    running = true; stopFlag = false; $('vScores').hidden = true; $('vTip').textContent = '';
    $('vGo').textContent = t('stop'); $('vBack').disabled = true;
    var ex = EX[cur], tgt = ex.target, dur = ex.dur, b = base();
    if (cur === 'call') { var cp = callPattern(); tgt = cp.f; dur = cp.dur; }
    setRange(P.hzToMidi(b) - 9, P.hzToMidi(b) + 11);
    if (cur === 'range') setRange(P.hzToMidi(b) - 15, P.hzToMidi(b) + 17);
    var go = micStart().then(function () {
      if (cur === 'range') {
        var lowF;
        return record({ dur: 7, cueText: t('goLow') }).then(function (f1) {
          lowF = f1; if (stopFlag) return [f1, []];
          return record({ dur: 7, cueText: t('goHigh') }).then(function (f2) { return [lowF, f2]; });
        }).then(function (fs) {
          var a = P.score(fs[0], null), c = P.score(fs[1], null);
          var res = { pitch: null, wobble: a ? a.wobble : 0, breath: Math.max(a ? a.breath : 0, c ? c.breath : 0), low: a ? a.low : 0 };
          if (a) { D.low = a.low; D.high = c ? c.high : D.high; }
          return { sc: a ? res : null, tip: a ? t('baseFound', { lo: noteLabel(D.low), hi: noteLabel(D.high) }) : t('tipNone') };
        });
      }
      var listenDur = cur === 'call' ? dur : ex.listen;
      chart.target = tgt; chart.dur = dur + 0.5; chart.pts = []; draw(null);
      cue(t('listen'), 'listen');
      return hum(tgt, listenDur).then(function () {
        if (stopFlag) return { sc: null };
        return record({ target: tgt, dur: dur, open: ex.open, goal: breathGoal(), cueText: t('yourTurn') }).then(function (fr) {
          var sc = P.score(fr, tgt, { octaveFree: true });
          if (!sc) return { sc: null, tip: t('tipNone') };
          var tip = sc.wobble > 25 ? t('tipWobble') : t('tipSteady'), sm = signedMean(fr, tgt);
          if (sm > 40) tip += ' ' + t('tipSharp'); else if (sm < -40) tip += ' ' + t('tipFlat');
          if (cur === 'breath' && sc.breath > D.breathBest) { D.breathBest = sc.breath; tip = t('tipBreath', { b: sc.breath.toFixed(1) }) + ' ' + tip; }
          if (cur === 'call') D.callRound = (D.callRound || 0) + 1;
          return { sc: sc, tip: tip };
        });
      });
    });
    go.then(function (r) {
      micStop(); running = false; $('vGo').textContent = t('again'); $('vBack').disabled = false;
      cue(''); showScores(r.sc, r.tip);
      if (r.sc) {
        D.hist.push({ d: new Date().toISOString().slice(0, 10), ex: cur, pitch: r.sc.pitch, wobble: r.sc.wobble, breath: r.sc.breath, low: Math.round(r.sc.low * 10) / 10 });
        if (D.hist.length > 2000) D.hist = D.hist.slice(-2000);
        save();
      }
      window.__voiceLast = r.sc; // read by the end-to-end test
    }).catch(function (e) {
      micStop(); running = false; $('vGo').textContent = t('start'); $('vBack').disabled = false; cue('');
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) gate('blocked');
      else if (e && e.name === 'NotFoundError') gate('none');
      else { $('vTip').textContent = String(e && e.message || e); }
    });
  }
  function breathGoal() { return Math.max(8, Math.ceil(D.breathBest + 2)); }

  // ---------- microphone explanation (before the browser asks) ----------
  function gate(kind) {
    $('vGate').hidden = false;
    $('vGateText').textContent = kind === 'blocked' ? t('micBlocked') : kind === 'none' ? t('noSupport') : t('micWhy');
    $('vGateOk').hidden = kind !== 'prime';
  }
  $('vGateOk').onclick = function () { $('vGate').hidden = true; ensureCtx(); run(); };
  $('vGateNo').onclick = function () { $('vGate').hidden = true; };

  // ---------- screens ----------
  function openEx(id) {
    cur = id; $('vMenu').hidden = true; $('vEx').hidden = false; scrollTo(0, 0);
    $('exTitle').textContent = t(id + '.t'); $('exHow').textContent = t(id + '.h');
    $('vScores').hidden = true; $('vTip').textContent = ''; $('vGo').textContent = t('start'); cue('');
    var b = base(); setRange(P.hzToMidi(b) - 9, P.hzToMidi(b) + 11);
    chart.pts = []; chart.target = EX[id].target || (id === 'call' ? callPattern().f : null); chart.dur = id === 'call' ? callPattern().dur + 0.5 : (EX[id].open ? 12 : (EX[id].dur || 7) + 0.5);
    requestAnimationFrame(function () { draw(null); });
  }
  $('vGo').onclick = function () {
    if (running) { stopFlag = true; return; }
    ensureCtx(); // created inside the tap (iOS)
    if (!FAKE && !navigator.mediaDevices) return gate('none');
    if (!FAKE && !D.micOk) return gate('prime');
    run();
  };
  $('vBack').onclick = function () { $('vEx').hidden = true; $('vMenu').hidden = false; renderMenu(); };
  $('langBtn').onclick = function () { lang = lang === 'ar' ? 'en' : 'ar'; applyLang(); if (cur && !$('vEx').hidden) openEx(cur); };
  $('vLowV').onclick = function () { D.voice = 'low'; delete D.low; save(); renderMenu(); };
  $('vHighV').onclick = function () { D.voice = 'high'; delete D.low; save(); renderMenu(); };

  function renderMenu() {
    $('vLowV').className = D.voice === 'low' ? 'on' : ''; $('vHighV').className = D.voice === 'high' ? 'on' : '';
    $('vBaseText').textContent = D.low ? t('baseFound', { lo: noteLabel(D.low), hi: noteLabel(D.high) }) : t('base', { n: noteLabel(base()) });
    var list = $('vList'); list.innerHTML = '';
    Object.keys(EX).forEach(function (id) {
      var b = document.createElement('button'); b.className = 'vex';
      var last = D.hist.filter(function (h) { return h.ex === id; }).slice(-1)[0];
      b.innerHTML = '<span class="n"></span><span><b></b><small></small></span><span class="last"></span>';
      b.querySelector('.n').textContent = EX[id].n;
      b.querySelector('b').textContent = t(id + '.t');
      b.querySelector('small').textContent = t(id + '.s', { g: breathGoal() });
      if (last) b.querySelector('.last').textContent = id === 'breath' ? last.breath + ' ' + t('sec') : id === 'range' ? P.noteName(last.low) : (last.pitch != null ? last.pitch + '/100' : '');
      b.onclick = function () { openEx(id); };
      list.appendChild(b);
    });
    drawProgress();
  }

  function drawProgress() {
    var days = {}, cv = $('vProg');
    D.hist.forEach(function (h) {
      var d = days[h.d] = days[h.d] || { breath: 0, low: 0, p: [], };
      d.breath = Math.max(d.breath, h.breath || 0); if (h.pitch != null) d.p.push(h.pitch);
      if (h.low && (!d.low || h.low < d.low)) d.low = h.low;
    });
    var keys = Object.keys(days).sort().slice(-30);
    if (!keys.length) { cv.hidden = true; $('vProgText').textContent = t('noProgress'); return; }
    cv.hidden = false;
    var dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth || 320, H = cv.clientHeight || 150;
    cv.width = W * dpr; cv.height = H * dpr; var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var X = function (i) { return keys.length === 1 ? W / 2 : 14 + (W - 28) * i / (keys.length - 1); };
    function line(vals, max, color, label) {
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 2.5; g.beginPath();
      vals.forEach(function (v, i) { var y = H - 20 - (H - 40) * Math.min(1, v / max); i ? g.lineTo(X(i), y) : g.moveTo(X(i), y); });
      g.stroke(); vals.forEach(function (v, i) { g.beginPath(); g.arc(X(i), H - 20 - (H - 40) * Math.min(1, v / max), 3, 0, 7); g.fill(); });
      g.font = '11px system-ui'; g.fillText(label, 6, label === 'breath' ? 12 : 26);
    }
    var br = keys.map(function (k) { return days[k].breath; }), pp = keys.map(function (k) { var p = days[k].p; return p.length ? p.reduce(function (a, b) { return a + b; }, 0) / p.length : 0; });
    line(br, Math.max(20, Math.max.apply(null, br) * 1.15), '#d4b96a', lang === 'ar' ? 'النَّفَس' : 'breath');
    line(pp, 100, 'rgba(255,255,255,.8)', lang === 'ar' ? 'الدقة' : 'pitch');
    g.fillStyle = 'rgba(255,255,255,.5)'; g.font = '10px system-ui';
    g.fillText(keys[0].slice(5), 4, H - 4); if (keys.length > 1) g.fillText(keys[keys.length - 1].slice(5), W - 30, H - 4);
    var lows = D.hist.map(function (h) { return h.low; }).filter(Boolean), pAll = D.hist.map(function (h) { return h.pitch; }).filter(function (x) { return x != null; });
    $('vProgText').textContent = t('progText', { b: D.breathBest.toFixed(1), lo: lows.length ? P.noteName(Math.min.apply(null, lows)) : '—', p: pAll.length ? Math.round(pAll.reduce(function (a, b) { return a + b; }, 0) / pAll.length) : '—' });
  }

  applyLang();
  window.Tasme3Voice = { open: openEx, run: function () { ensureCtx(); run(); }, data: D };
})();
