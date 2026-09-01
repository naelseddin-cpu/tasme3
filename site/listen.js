// "Listen" reference-audio feature — everyayah.com per-ayah files, per
// docs/AUDIO-SOURCES.md. One reused <audio> element; streams exactly the ONE
// ayah currently in view, only when the user taps Listen — never prefetches.
// Fallback chain per the doc's §2 recommendation (self-hosting isn't set up
// yet, so the chain starts at everyayah.com), low-bitrate primary with a
// higher-bitrate fallback on error:
//   murattal   -> Husary_64kbps -> Husary_128kbps (default Murattal set)
//   muallim    -> Husary_Muallim_128kbps -> Husary_64kbps (beginner-oriented
//                 "teaching mushaf" set — Husary only, unchanged)
//   minshawi   -> Minshawy_Murattal_128kbps (al-Minshawi, Murattal — everyayah
//                 lists no lower-bitrate variant for this reciter/style, so
//                 there is only one link in the chain; standard folder name,
//                 not live-verified — outbound network to everyayah.com is
//                 blocked by this sandbox's egress policy, same as documented
//                 in docs/AUDIO-SOURCES.md §0)
//   abdulbasit -> Abdul_Basit_Murattal_64kbps -> Abdul_Basit_Murattal_192kbps
//                 (Abdul Basit Abdul Samad, Murattal; standard folder names,
//                 not live-verified for the same reason)
//   alafasy    -> Alafasy_64kbps -> Alafasy_128kbps (Mishary Alafasy;
//                 standard folder names, not live-verified for the same
//                 reason)
// quran.com/QuranCDN (the doc's Fallback #2) is intentionally NOT wired in:
// the doc marks its reciter ID as [UNVERIFIED] and explicitly says not to
// hardcode an unconfirmed ID — everyayah's per-reciter bitrates already give
// one on-failure retry where a lower tier exists, matching the "retries once
// against the next source" spec line.
(function (global) {
  'use strict';

  var BASE = 'https://everyayah.com/data/';
  var CHAINS = {
    murattal: ['Husary_64kbps', 'Husary_128kbps'],
    muallim: ['Husary_Muallim_128kbps', 'Husary_64kbps'],
    minshawi: ['Minshawy_Murattal_128kbps'],
    abdulbasit: ['Abdul_Basit_Murattal_64kbps', 'Abdul_Basit_Murattal_192kbps'],
    alafasy: ['Alafasy_64kbps', 'Alafasy_128kbps']
  };
  var RECITER_KEYS = Object.keys(CHAINS);

  function pad3(n) { return String(n).padStart(3, '0'); }
  function ayahFile(surah, ayah) { return pad3(surah) + pad3(ayah) + '.mp3'; }
  function urlFor(dir, surah, ayah) { return BASE + dir + '/' + ayahFile(surah, ayah); }

  function Listener() {
    this._audio = new Audio();
    this._audio.preload = 'none';
    this._chainIdx = 0;
    this._chain = [];
    this._surah = null;
    this._ayah = null;
    this._onStateChange = null; // (state: 'playing'|'paused'|'error') => void
    var self = this;
    this._audio.addEventListener('error', function () { self._tryNext(); });
    this._audio.addEventListener('ended', function () {
      if (self._audio.loop) return; // native loop already restarts
      if (self._onStateChange) self._onStateChange('paused');
    });
    this._audio.addEventListener('playing', function () {
      if (self._onStateChange) self._onStateChange('playing');
    });
  }

  Listener.prototype.onStateChange = function (cb) { this._onStateChange = cb; };

  Listener.prototype._tryNext = function () {
    this._chainIdx += 1;
    if (this._chainIdx >= this._chain.length) {
      if (this._onStateChange) this._onStateChange('error');
      return;
    }
    var dir = this._chain[this._chainIdx];
    this._audio.src = urlFor(dir, this._surah, this._ayah);
    this._audio.play().catch(function () { /* handled by 'error' listener too */ });
  };

  // reciterSet: 'murattal' | 'muallim'. On-demand only — call this exactly
  // once per user tap, never speculatively.
  Listener.prototype.play = function (surah, ayah, reciterSet) {
    this._surah = surah;
    this._ayah = ayah;
    this._chain = CHAINS[reciterSet] || CHAINS.murattal;
    this._chainIdx = 0;
    this._audio.loop = !!this._repeat;
    this._audio.src = urlFor(this._chain[0], surah, ayah);
    var self = this;
    this._audio.play().catch(function () { self._tryNext(); });
  };

  Listener.prototype.pause = function () {
    try { this._audio.pause(); } catch (_) {}
  };

  Listener.prototype.stop = function () {
    try { this._audio.pause(); this._audio.currentTime = 0; } catch (_) {}
  };

  Listener.prototype.isPlaying = function () { return !this._audio.paused; };

  Listener.prototype.setRepeat = function (on) {
    this._repeat = !!on;
    this._audio.loop = this._repeat;
  };

  // Exposed for tests/debugging: the exact URL the next play() attempt with
  // this reciter set would use first, without touching the network.
  Listener.prototype.previewUrl = function (surah, ayah, reciterSet) {
    var chain = CHAINS[reciterSet] || CHAINS.murattal;
    return urlFor(chain[0], surah, ayah);
  };

  global.Tasme3Listen = {
    Listener: Listener,
    ayahFile: ayahFile,
    urlFor: urlFor,
    CHAINS: CHAINS,
    RECITER_KEYS: RECITER_KEYS
  };
})(window);
