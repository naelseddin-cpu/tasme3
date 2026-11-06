// Voice training maths: pitch detection (YIN, de Cheveigné & Kawahara 2002) and the
// scores shown after each try. Pure functions, no DOM: tested in node with synthetic
// tones of known pitch (tests/test-pitch.js).
(function (global) {
  'use strict';

  // YIN on one frame. Returns { hz, clarity } (hz = 0 when unvoiced).
  function yin(buf, sr, minHz, maxHz, threshold) {
    minHz = minHz || 55; maxHz = maxHz || 1000; threshold = threshold || 0.12;
    var tauMin = Math.floor(sr / maxHz), tauMax = Math.min(Math.floor(sr / minHz), Math.floor(buf.length / 2));
    var W = buf.length - tauMax, d = new Float32Array(tauMax + 1);
    for (var tau = 1; tau <= tauMax; tau++) {
      var s = 0;
      for (var i = 0; i < W; i++) { var x = buf[i] - buf[i + tau]; s += x * x; }
      d[tau] = s;
    }
    // cumulative mean normalised difference
    var run = 0, cm = new Float32Array(tauMax + 1); cm[0] = 1;
    for (tau = 1; tau <= tauMax; tau++) { run += d[tau]; cm[tau] = run ? d[tau] * tau / run : 1; }
    var best = -1;
    for (tau = Math.max(2, tauMin); tau < tauMax; tau++) {
      if (cm[tau] < threshold) { while (tau + 1 < tauMax && cm[tau + 1] < cm[tau]) tau++; best = tau; break; }
    }
    if (best < 0) return { hz: 0, clarity: 0 };
    // parabolic interpolation around the dip
    var a = cm[best - 1], b = cm[best], c = cm[best + 1], den = a + c - 2 * b;
    var t = den ? best + (a - c) / (2 * den) : best;
    return { hz: sr / t, clarity: 1 - b };
  }

  function rms(buf) { var s = 0; for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); }
  function hzToMidi(hz) { return 69 + 12 * Math.log(hz / 440) / Math.LN2; }
  function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function cents(hz, ref) { return 1200 * Math.log(hz / ref) / Math.LN2; }
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function noteName(hz) { var m = Math.round(hzToMidi(hz)); return NAMES[(m % 12 + 12) % 12] + (Math.floor(m / 12) - 1); }

  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); var n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; }
  function pct(a, p) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; }

  // frames: [{t (s), hz (0 = silent)}]; target(t) -> hz or 0 (t from the singer's first voiced frame)
  // Returns the four numbers the learner sees.
  function score(frames, target, opts) {
    opts = opts || {};
    var voiced = frames.filter(function (f) { return f.hz > 0; });
    if (voiced.length < 5) return null;
    var t0 = voiced[0].t, errs = [];
    voiced.forEach(function (f) {
      var tg = target ? target(f.t - t0) : 0;
      if (tg > 0) {
        var e = cents(f.hz, tg);
        if (opts.octaveFree) e = ((e % 1200) + 1800) % 1200 - 600; // singing an octave away is fine
        errs.push(Math.abs(e));
      }
    });
    // steadiness: wobble around a local straight line (+-0.2 s least-squares fit), so a
    // glide's slope is not counted as wobble, only the shake around it
    var cs = voiced.map(function (f) { return hzToMidi(f.hz) * 100; }), dev = [];
    for (var i = 0; i < cs.length; i++) {
      var n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (var j = 0; j < cs.length; j++) {
        var dt = voiced[j].t - voiced[i].t; if (dt < -0.2) continue; if (dt > 0.2) break;
        n++; sx += dt; sy += cs[j]; sxx += dt * dt; sxy += dt * cs[j];
      }
      var den = n * sxx - sx * sx, slope = den ? (n * sxy - sx * sy) / den : 0, icp = (sy - slope * sx) / n;
      dev.push(cs[i] - icp);
    }
    if (target) { // with a target, wobble is the shake of the error: intended steps and slopes don't count
      var err = voiced.map(function (f) { var tg = target(f.t - t0); if (!tg) return null; var e = cents(f.hz, tg); return opts.octaveFree ? ((e % 1200) + 1800) % 1200 - 600 : e; });
      if (err.every(function (e) { return e !== null; })) {
        dev = err.map(function (e, i) {
          var w = [];
          for (var j = 0; j < err.length; j++) { var dt = voiced[j].t - voiced[i].t; if (dt >= -0.2 && dt <= 0.2) w.push(err[j]); }
          return e - median(w);
        });
      }
    }
    // jumps over a semitone are transitions (a step, a breath catch), not wobble
    var kept = dev.filter(function (x) { return Math.abs(x) <= 100; }); if (kept.length > dev.length / 2) dev = kept;
    var wobble = Math.sqrt(dev.reduce(function (s, x) { return s + x * x; }, 0) / dev.length);
    // breath: the longest voiced run; gaps under 0.3 s (a consonant, a crackle) don't end it
    var longest = 0, start = voiced[0].t, prev = voiced[0].t;
    voiced.forEach(function (f) {
      if (f.t - prev > 0.3) start = f.t;
      prev = f.t; longest = Math.max(longest, f.t - start);
    });
    var meanErr = errs.length ? errs.reduce(function (s, x) { return s + x; }, 0) / errs.length : null;
    var hzs = voiced.map(function (f) { return f.hz; });
    return {
      pitch: meanErr === null ? null : Math.max(0, Math.round(100 - meanErr / 2)),   // 0 cents -> 100, 200 cents -> 0
      within: errs.length ? Math.round(100 * errs.filter(function (e) { return e <= 50; }).length / errs.length) : null,
      meanCents: meanErr === null ? null : Math.round(meanErr),
      wobble: Math.round(wobble),
      breath: Math.round(longest * 10) / 10,
      low: pct(hzs, 0.1), high: pct(hzs, 0.9), median: median(hzs)
    };
  }

  var api = { yin: yin, rms: rms, hzToMidi: hzToMidi, midiToHz: midiToHz, cents: cents, noteName: noteName, score: score, median: median, pct: pct };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Tasme3Pitch = api;
})(typeof window !== 'undefined' ? window : this);
