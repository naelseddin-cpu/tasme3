// MediaRecorder wrapper for the server-ASR recitation flow (tap to start /
// tap to stop). Fixes audit M1/M2/M3:
//   M1 — mic stream is ALWAYS released (all tracks stopped) on stop, error,
//        or page-switch; never leaked.
//   M2 — every recording gets a monotonically increasing request token; a
//        response for a stale token (superseded by a newer recording before
//        the previous one's network round-trip finished) is dropped by the
//        caller, never misapplied.
//   M3 — no AudioContext is created here at all (MediaRecorder records the
//        raw stream directly), so there is nothing to leak on decode
//        failure; kept deliberately simple.
// Busy-guard: only one recording may be in flight at a time; a second tap
// while busy (recording OR awaiting the server response) is a no-op.
(function (global) {
  'use strict';

  // Preference order: smallest/most broadly supported first where practical,
  // Safari's mp4/aac fallback last.
  var MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/mp4;codecs=mp4a.40.2',
    '' // let the browser choose if isTypeSupported rejects everything (rare)
  ];

  function pickMimeType() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
      return ''; // MediaRecorder may still work without explicit mimeType
    }
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      var m = MIME_CANDIDATES[i];
      if (m === '' || MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  function Recorder() {
    this._stream = null;
    this._mr = null;
    this._chunks = [];
    this._state = 'idle'; // idle | recording | busy (awaiting caller's async work)
    this._token = 0;
  }

  Recorder.prototype.isBusy = function () { return this._state !== 'idle'; };
  Recorder.prototype.isRecording = function () { return this._state === 'recording'; };

  Recorder.prototype._release = function () {
    if (this._stream) {
      try { this._stream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (_) {}
      this._stream = null;
    }
    this._mr = null;
    this._chunks = [];
  };

  // Returns a new token for this recording session; the caller stores it and
  // compares it against Recorder.currentToken() when a slow async response
  // (server /evaluate) comes back, dropping it if stale.
  Recorder.prototype.currentToken = function () { return this._token; };

  // onDone(blob, mimeType, token) is called once recording stops with data.
  // onError(reason) covers permission denial, unsupported format, and
  // MediaRecorder.onerror.
  Recorder.prototype.start = function (onDone, onError) {
    if (this.isBusy()) return; // busy-guard: ignore a second tap in flight
    var self = this;
    self._state = 'busy'; // busy from the first tap until getUserMedia resolves
    var mimeType = pickMimeType();
    if (typeof MediaRecorder === 'undefined') {
      self._state = 'idle';
      onError('unsupported');
      return;
    }
    if (!global.navigator || !global.navigator.mediaDevices || !global.navigator.mediaDevices.getUserMedia) {
      self._state = 'idle';
      onError('unsupported');
      return;
    }
    global.navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (self._state !== 'busy') { // start() was raced by a stop()/reset before permission resolved
        stream.getTracks().forEach(function (tr) { tr.stop(); });
        return;
      }
      self._stream = stream;
      self._chunks = [];
      self._token += 1;
      var token = self._token;
      var opts = mimeType ? { mimeType: mimeType } : {};
      var mr;
      try {
        mr = new MediaRecorder(stream, opts);
      } catch (e) {
        self._release();
        self._state = 'idle';
        onError('format');
        return;
      }
      self._mr = mr;
      mr.ondataavailable = function (ev) {
        if (ev.data && ev.data.size > 0) self._chunks.push(ev.data);
      };
      mr.onerror = function () {
        self._release();
        self._state = 'idle';
        onError('generic');
      };
      mr.onstop = function () {
        var blob = new Blob(self._chunks, { type: mr.mimeType || mimeType || 'audio/webm' });
        var mt = mr.mimeType || mimeType || 'audio/webm';
        self._release();
        self._state = 'idle';
        onDone(blob, mt, token);
      };
      try {
        mr.start();
        self._state = 'recording';
      } catch (e) {
        self._release();
        self._state = 'idle';
        onError('generic');
      }
    }).catch(function () {
      self._state = 'idle';
      onError('mic');
    });
  };

  // Stops the active recording; onDone fires from mr.onstop. Safe to call
  // when not recording (no-op).
  Recorder.prototype.stop = function () {
    if (this._state !== 'recording' || !this._mr) return;
    try { this._mr.stop(); } catch (_) { this._release(); this._state = 'idle'; }
  };

  // Hard-stop for page-switch / teardown: drops any in-progress recording
  // without invoking callbacks and always releases the mic (audit M1).
  Recorder.prototype.abort = function () {
    if (this._mr) {
      try { this._mr.onstop = null; this._mr.onerror = null; this._mr.stop(); } catch (_) {}
    }
    this._release();
    this._state = 'idle';
  };

  // Marks the current token as consumed without starting a new recording —
  // used after a network response is applied, so a subsequent stray event
  // can't double-apply it.
  Recorder.prototype.bumpToken = function () { this._token += 1; return this._token; };

  global.Tasme3Recorder = Recorder;
})(window);
