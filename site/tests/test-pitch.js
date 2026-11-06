// Voice training: pitch detection and scores on synthetic tones of known pitch.
// node site/tests/test-pitch.js
'use strict';
var P = require('../pitch.js');
var assert = require('assert');
var fails = 0, rows = [];

function tone(hz, sr, n, opts) {
  opts = opts || {}; var b = new Float32Array(n), ph = 0, seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; }
  for (var i = 0; i < n; i++) {
    var f = typeof hz === 'function' ? hz(i / sr) : hz; ph += 2 * Math.PI * f / sr;
    var v = 0, H = opts.harm || [1];
    for (var k = 0; k < H.length; k++) v += H[k] * Math.sin((k + 1) * ph);
    b[i] = 0.3 * v + (opts.noise || 0) * rnd();
  }
  return b;
}
function frames(sig, sr, hop) {
  var out = [], N = 2048;
  for (var s = 0; s + N <= sig.length; s += hop) {
    var w = sig.subarray(s, s + N), r = P.yin(w, sr, 60, 1000);
    out.push({ t: s / sr, hz: P.rms(w) > 0.01 ? r.hz : 0 });
  }
  return out;
}

// 1) single frames: sine and voice-like (rich harmonics, weak fundamental), with noise
var HUM = [0.5, 1, 0.7, 0.4, 0.25, 0.12];
[44100, 48000].forEach(function (sr) {
  [82.4, 110, 146.8, 196, 261.6, 329.6, 440, 587.3].forEach(function (hz) {
    [['sine', {}], ['voice+noise', { harm: HUM, noise: 0.08 }]].forEach(function (k) {
      var r = P.yin(tone(hz, sr, 2048, k[1]), sr, 60, 1000), e = P.cents(r.hz, hz);
      rows.push([sr, hz, k[0], r.hz.toFixed(2), e.toFixed(2)]);
      if (!(Math.abs(e) < 5)) { fails++; console.log('FAIL', sr, hz, k[0], r.hz); }
    });
  });
});
var maxErr = Math.max.apply(null, rows.map(function (r) { return Math.abs(+r[4]); }));
console.log('frames: ' + rows.length + ' tones 82-587 Hz, max error ' + maxErr.toFixed(2) + ' cents');

// 2) silence and white noise are unvoiced
var seed = 3, noise = new Float32Array(2048).map(function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; });
assert.strictEqual(P.yin(noise, 48000).hz, 0, 'noise must be unvoiced');
assert.strictEqual(P.yin(new Float32Array(2048), 48000).hz, 0, 'silence must be unvoiced');

// 3) a steady low note held 6 s: pitch ~100, wobble ~0, breath ~6 s
var sr = 48000, held = frames(tone(110, sr, sr * 6, { harm: HUM, noise: 0.03 }), sr, 1024);
var s1 = P.score(held, function () { return 110; });
console.log('steady 110 Hz 6 s:', JSON.stringify(s1));
assert(s1.pitch >= 98 && s1.wobble <= 3 && s1.breath >= 5.8, 'steady');
assert.strictEqual(P.noteName(s1.median), 'A2');

// 4) the same note with a 5.5 Hz vibrato of +-40 cents: wobble must show it (RMS ~28 cents)
var vib = frames(tone(function (t) { return 110 * Math.pow(2, 40 * Math.sin(2 * Math.PI * 5.5 * t) / 1200); }, sr, sr * 4, { harm: HUM }), sr, 512);
var s2 = P.score(vib, function () { return 110; });
console.log('vibrato +-40c:', JSON.stringify(s2));
assert(s2.wobble >= 18 && s2.wobble <= 40, 'wobble measured');

// 5) a glide down a fifth over 4 s, followed exactly: high pitch score and low wobble
var glide = function (t) { return 165 * Math.pow(2, -7 / 12 * Math.min(1, t / 4)); };
var s3 = P.score(frames(tone(glide, sr, sr * 4, { harm: HUM }), sr, 1024), glide);
console.log('glide 165->110:', JSON.stringify(s3));
assert(s3.pitch >= 95 && s3.wobble <= 8, 'glide tracked');

// 6) singing 1 semitone flat scores ~50, a breath gap of 0.5 s splits the breath run
var flat = P.score(held.map(function (f) { return { t: f.t, hz: f.hz / Math.pow(2, 1 / 12) }; }), function () { return 110; });
assert(flat.pitch >= 45 && flat.pitch <= 55 && flat.within === 0, 'flat by 100 cents');
var gap = P.score(held.filter(function (f) { return f.t < 2 || f.t > 2.5; }), function () { return 110; });
assert(gap.breath < 3.6 && gap.breath > 3.2, 'gap splits breath: ' + gap.breath);
// octave-free: a woman singing the men's target an octave up is on pitch
assert(P.score(held.map(function (f) { return { t: f.t, hz: f.hz * 2 }; }), function () { return 110; }, { octaveFree: true }).pitch >= 98);

// 7) a step pattern followed exactly (with 60 ms lag at each step) is not wobble
var steps = function (t) { return 110 * Math.pow(2, [0, 3, 2, 0][Math.min(3, Math.floor(t / 0.8))] / 12); };
var s4 = P.score(frames(tone(function (t) { return steps(Math.max(0, t - 0.06)); }, sr, sr * 3.2, { harm: HUM }), sr, 1024), steps, { octaveFree: true });
console.log('steps 0,3,2,0:', JSON.stringify(s4));
assert(s4.wobble <= 10 && s4.pitch >= 90, 'steps are not wobble');
// and the vibrato is still caught with a target
assert(P.score(vib, function () { return 110; }).wobble >= 18, 'vibrato with target');

if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('pitch: all ok');
