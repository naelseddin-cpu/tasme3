// On-device recitation: the phone listens, not the server (founder decision
// 2026-10-29: the model download is mandatory; without it the reciting feature
// does not run). Exposes window.Tasme3OnDevice:
//   supported()        -> '' if this device can run it, else a reason code
//   isDownloaded()     -> Promise<bool>  (model files already in the browser cache)
//   load(onProgress)   -> Promise        (downloads once, then loads from the cache)
//   transcribe(f32)    -> Promise<{text, ms}>  (16 kHz mono samples)
//   Capture            -> microphone at 16 kHz: start(), stop(), length, slice(a, b)
//   speechRegions(f32) -> [[startSample, endSample], ...] by short-time energy
(function (global) {
  'use strict';
  var cfg = global.TASME3_CONFIG || {};
  var SR = 16000;
  var worker = null, ready = null, seq = 0, pending = {};

  // WebAssembly SIMD probe (smallest module using a v128 op)
  var SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

  function supported() {
    if (!cfg.ON_DEVICE) return 'off';
    if (typeof WebAssembly !== 'object' || !WebAssembly.validate(SIMD_PROBE)) return 'wasm';
    if (!global.Worker || !global.AudioContext && !global.webkitAudioContext) return 'audio';
    if (!global.navigator.mediaDevices || !global.navigator.mediaDevices.getUserMedia) return 'mic';
    if (global.navigator.deviceMemory && global.navigator.deviceMemory < 3) return 'memory';
    if (global.navigator.hardwareConcurrency && global.navigator.hardwareConcurrency < 4) return 'cpu';
    return '';
  }

  var FILES = ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
  var WASM = 'ort-wasm-simd-threaded.asyncify.wasm';
  function modelUrl(f) {
    return cfg.MODEL_HOST ? cfg.MODEL_HOST + cfg.MODEL_ID + '/resolve/main/' + f
      : new URL(cfg.MODEL_BASE + cfg.MODEL_ID + '/' + f, global.location.href).href;
  }
  function wasmUrl() { return cfg.WASM_URL || new URL((cfg.WASM_BASE || cfg.ENGINE_BASE) + WASM, global.location.href).href; }
  // the big files and the cache each lives in (the model where transformers.js looks for it)
  function bigFiles() {
    return FILES.map(function (f) { return { url: modelUrl(f), cache: 'transformers-cache' }; })
      .concat([{ url: wasmUrl(), cache: 'tasme3-engine' }]);
  }
  function isDownloaded() {
    if (!global.caches) return Promise.resolve(false);
    return Promise.all(bigFiles().map(function (b) {
      return global.caches.open(b.cache).then(function (c) { return c.match(b.url); });
    })).then(function (hits) { return hits.every(Boolean); }).catch(function () { return false; });
  }

  // ---- resumable download ----------------------------------------------------
  // Weak mobile connections drop. Each big file is fetched in 4 MB ranges; every
  // finished range is kept in Cache Storage ("tasme3-dl"), so a dropped connection
  // or a reload resumes where it stopped. A failed range retries on its own with
  // backoff (and waits for the network to come back), so the user never has to.
  var CHUNK = 4 * 1024 * 1024, PART = 'tasme3-dl';
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function online() {
    if (global.navigator.onLine !== false) return Promise.resolve();
    return new Promise(function (r) { global.addEventListener('online', function f() { global.removeEventListener('online', f); r(); }); });
  }
  function withRetry(fn) {
    var attempt = 0;
    return (function go() {
      return fn().catch(function (err) {
        attempt++;
        if (attempt > 12) throw err;
        return online().then(function () { return sleep(Math.min(15000, 800 * Math.pow(2, attempt - 1))); }).then(go);
      });
    })();
  }
  function sizeOf(url) { // ranged request for 1 byte: Content-Range gives the full size
    return withRetry(function () {
      return fetch(url, { headers: { Range: 'bytes=0-0' } }).then(function (r) {
        var cr = r.headers.get('Content-Range'), m = cr && cr.match(/\/(\d+)$/);
        if (r.status === 206 && m) return +m[1];
        if (r.ok && r.headers.get('Content-Length')) return +r.headers.get('Content-Length'); // no range support
        throw new Error('size ' + r.status);
      });
    });
  }
  function downloadAll(onProgress) {
    var files = bigFiles(), sizes = [], done = [];
    var report = function () {
      var got = done.reduce(function (a, b) { return a + b; }, 0), all = sizes.reduce(function (a, b) { return a + b; }, 0);
      if (onProgress) onProgress(got, all);
    };
    return Promise.all(files.map(function (b) { return sizeOf(b.url); })).then(function (sz) {
      sizes = sz; done = sz.map(function () { return 0; });
      return global.caches.open(PART);
    }).then(function (parts) {
      var chain = Promise.resolve();
      files.forEach(function (b, fi) {
        chain = chain.then(function () {
          return global.caches.open(b.cache).then(function (target) {
            return target.match(b.url).then(function (have) {
              if (have) { done[fi] = sizes[fi]; report(); return; }
              var n = Math.ceil(sizes[fi] / CHUNK), blobs = new Array(n), next = 0;
              function partKey(i) { return b.url + (b.url.indexOf('?') < 0 ? '?' : '&') + '__part=' + i; }
              function one(i) {
                return parts.match(partKey(i)).then(function (hit) {
                  if (hit) return hit.blob();
                  var a = i * CHUNK, z = Math.min(sizes[fi], a + CHUNK) - 1;
                  return withRetry(function () {
                    return fetch(b.url, { headers: { Range: 'bytes=' + a + '-' + z } }).then(function (r) {
                      if (r.status !== 206 && !(r.ok && n === 1)) throw new Error('range ' + r.status);
                      return r.blob();
                    }).then(function (blob) {
                      if (blob.size !== z - a + 1) throw new Error('short ' + blob.size);
                      return parts.put(partKey(i), new Response(blob)).then(function () { return blob; });
                    });
                  });
                }).then(function (blob) { blobs[i] = blob; done[fi] += blob.size; report(); });
              }
              function worker() { return next < n ? one(next++).then(worker) : null; }
              return Promise.all([worker(), worker(), worker()]).then(function () {   // 3 ranges at a time
                var whole = new Blob(blobs, { type: 'application/octet-stream' });
                return target.put(b.url, new Response(whole, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(whole.size) } }));
              }).then(function () {
                return Promise.all(blobs.map(function (_, i) { return parts.delete(partKey(i)); }));
              });
            });
          });
        });
      });
      return chain;
    });
  }

  function load(onProgress) {
    if (ready) return ready;
    // keep the ~130 MB download even under storage pressure (and on iOS home-screen apps)
    if (global.navigator.storage && global.navigator.storage.persist) global.navigator.storage.persist().catch(function () {});
    var threads = global.crossOriginIsolated ? Math.max(1, Math.min(4, (global.navigator.hardwareConcurrency || 2) - 1)) : 1;
    var started = downloadAll(onProgress).then(function () {
      return global.caches.open('tasme3-engine').then(function (c) { return c.match(wasmUrl()); }).then(function (r) { return r.arrayBuffer(); });
    });
    ready = started.then(function (wasmBinary) { return new Promise(function (resolve, reject) {
      worker = new Worker('asr-worker.js', { type: 'module' });
      var files = {};
      worker.onmessage = function (e) {
        var m = e.data;
        if (m.type === 'progress' && false) { // the big files come from the resumable downloader above
          files[m.file] = [m.loaded || 0, m.total || 0];
          var got = 0, all = 0; Object.keys(files).forEach(function (k) { got += files[k][0]; all += files[k][1]; });
          if (onProgress) onProgress(got, all);
        } else if (m.type === 'ready') resolve();
        else if (m.type === 'result' && pending[m.id]) { pending[m.id].resolve({ text: m.text, ms: m.ms }); delete pending[m.id]; }
        else if (m.type === 'error') {
          if (m.id && pending[m.id]) { pending[m.id].reject(new Error(m.error)); delete pending[m.id]; }
          else { ready = null; reject(new Error(m.error)); }
        }
      };
      worker.onerror = function (e) { ready = null; reject(new Error(e.message || 'worker')); };
      var abs = function (p) { return new URL(p, global.location.href).href; };
      worker.postMessage({ type: 'load', engineBase: abs(cfg.ENGINE_BASE), wasmBase: cfg.WASM_BASE ? abs(cfg.WASM_BASE) : '', wasmBinary: wasmBinary,
        modelHost: cfg.MODEL_HOST || '', modelBase: cfg.MODEL_BASE, modelId: cfg.MODEL_ID, threads: threads }, [wasmBinary]);
    }); }).catch(function (e) { ready = null; throw e; });
    return ready;
  }

  function transcribe(audio) {
    return load().then(function () {
      return new Promise(function (resolve, reject) {
        var id = ++seq; pending[id] = { resolve: resolve, reject: reject };
        worker.postMessage({ type: 'run', id: id, audio: audio });
      });
    });
  }

  // ---- microphone at 16 kHz ------------------------------------------------
  var WORKLET = 'registerProcessor("tap",class extends AudioWorkletProcessor{process(i){var c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}})';

  function Capture() { this.chunks = []; this.length = 0; this.ctx = null; this.stream = null; }
  Capture.prototype.start = function () {
    var self = this, AC = global.AudioContext || global.webkitAudioContext;
    return global.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      self.stream = stream;
      try { self.ctx = new AC({ sampleRate: SR }); } catch (_) { self.ctx = new AC(); }
      var url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      return self.ctx.audioWorklet.addModule(url).then(function () {
        var src = self.ctx.createMediaStreamSource(stream), node = new AudioWorkletNode(self.ctx, 'tap');
        var ratio = self.ctx.sampleRate / SR;
        node.port.onmessage = function (e) { self._push(ratio === 1 ? e.data : resample(e.data, ratio)); };
        src.connect(node);
        self.node = node;
      });
    });
  };
  Capture.prototype._push = function (x) { this.chunks.push(x); this.length += x.length; };
  Capture.prototype.slice = function (a, b) { // samples [a, b) of the take
    b = Math.min(b === undefined ? this.length : b, this.length); a = Math.max(0, a);
    var out = new Float32Array(Math.max(0, b - a)), pos = 0, o = 0;
    for (var i = 0; i < this.chunks.length && pos < b; i++) {
      var c = this.chunks[i], s = Math.max(a - pos, 0), e = Math.min(b - pos, c.length);
      if (e > s) { out.set(c.subarray(s, e), o); o += e - s; }
      pos += c.length;
    }
    return out;
  };
  Capture.prototype.stop = function () {
    try { this.node && this.node.disconnect(); } catch (_) {}
    try { this.stream && this.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
    try { this.ctx && this.ctx.close(); } catch (_) {}
  };

  function resample(x, ratio) { // linear, device rate -> 16 kHz
    var n = Math.floor(x.length / ratio), out = new Float32Array(n);
    for (var i = 0; i < n; i++) { var p = i * ratio, k = Math.floor(p), f = p - k; out[i] = x[k] * (1 - f) + (x[k + 1] || x[k]) * f; }
    return out;
  }

  // Speech regions by short-time energy (20 ms frames), relative to the quiet
  // floor of this window: used to estimate where a recognised word ended.
  function speechRegions(x) {
    var F = 320, n = Math.floor(x.length / F), e = new Float32Array(n);
    for (var i = 0; i < n; i++) { var s = 0; for (var j = i * F; j < (i + 1) * F; j++) s += x[j] * x[j]; e[i] = Math.sqrt(s / F); }
    var sorted = Array.prototype.slice.call(e).sort(function (a, b) { return a - b; });
    var th = Math.max(0.006, (sorted[Math.floor(n * 0.2)] || 0) * 2.5);
    var out = [], st = -1, gap = 0;
    for (i = 0; i < n; i++) {
      if (e[i] > th) { if (st < 0) st = i; gap = 0; }
      else if (st >= 0 && ++gap > 15) { out.push([st * F, (i - gap + 1) * F]); st = -1; gap = 0; }
    }
    if (st >= 0) out.push([st * F, n * F]);
    return out;
  }

  global.Tasme3OnDevice = { supported: supported, isDownloaded: isDownloaded, load: load, transcribe: transcribe,
    Capture: Capture, speechRegions: speechRegions, SAMPLE_RATE: SR };
})(window);
