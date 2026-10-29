// On-device recitation recognition (module Web Worker). Runs the Quran Whisper
// model (tarteel-ai/whisper-base-ar-quran, 8-bit ONNX browser build) with
// transformers.js + ONNX Runtime Web, off the page's main thread.
//
// Messages in:  {type:'load', engineBase, modelBase, modelId, threads}
//               {type:'run', id, audio: Float32Array (16 kHz mono)}
// Messages out: {type:'progress', file, loaded, total} | {type:'ready'} |
//               {type:'result', id, text, ms} | {type:'error', error}
//
// The encoder was exported to accept windows shorter than Whisper's fixed 30 s
// (positions sliced to the window length), so a few seconds of recitation cost
// a few seconds of compute: ~3x faster, identical accuracy on the benchmark.
let proc = null, model = null;

function frames(n) { // mel frames for n samples: 5 s steps, at least 10 s
  return Math.min(3000, Math.max(1000, Math.ceil((n / 16000 + 1) / 5) * 500));
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      const T = await import(m.engineBase + 'transformers.min.js');
      T.env.allowLocalModels = true; T.env.allowRemoteModels = false;
      T.env.localModelPath = m.modelBase; T.env.useBrowserCache = true;
      T.env.backends.onnx.wasm.wasmPaths = m.engineBase;
      T.env.backends.onnx.wasm.numThreads = m.threads;
      const progress_callback = (p) => {
        if (p.status === 'progress') self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
      };
      proc = await T.AutoProcessor.from_pretrained(m.modelId, { progress_callback });
      model = await T.WhisperForConditionalGeneration.from_pretrained(m.modelId, { dtype: 'q8', device: 'wasm', progress_callback });
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'run') {
      const t = performance.now();
      const x = m.audio;
      const { input_features } = await proc(x);
      const f = frames(x.length);
      const feats = f < 3000 ? input_features.slice(null, null, [0, f]) : input_features;
      // output capped from the seconds of audio, so a hallucination cannot run on
      const ids = await model.generate({ inputs: feats, language: 'ar', task: 'transcribe',
        max_new_tokens: Math.min(220, Math.round(12 * x.length / 16000) + 16) });
      const text = proc.batch_decode(ids, { skip_special_tokens: true })[0] || '';
      self.postMessage({ type: 'result', id: m.id, text: text.trim(), ms: performance.now() - t });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, error: String(err && err.message || err) });
  }
};
