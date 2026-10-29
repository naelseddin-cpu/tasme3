"""Speech-to-text behind a small interface.

Privacy: audio is NEVER written to a permanent location. WhisperASR reads
the uploaded bytes into memory (or, if faster-whisper needs a real file
handle to hand to ffmpeg for container decoding, a NamedTemporaryFile that
is deleted immediately in a `finally` block before this function returns).
Nothing here persists a clip, logs its bytes, or keeps a copy after the
transcription call returns.

System dependency: ffmpeg must be installed and on PATH. faster-whisper
(via its bundled decoder / PyAV) shells out to ffmpeg's decoding machinery
to accept containers like webm/mp4/ogg, not just raw wav/pcm. See
server/RUNBOOK.md.
"""

from __future__ import annotations

import os
import sys
import tempfile
from typing import Optional, Protocol

# Founder decision: default ASR model is the Quran-fine-tuned Whisper
# checkpoint, not generic whisper. Fully overridable via WHISPER_MODEL —
# any faster-whisper-compatible model id/size, OR a local CTranslate2
# model directory path (see the conversion step in RUNBOOK.md).
DEFAULT_WHISPER_MODEL = "tarteel-ai/whisper-base-ar-quran"


class ModelFormatError(RuntimeError):
    """Raised (and caught) when the configured WHISPER_MODEL loaded but is
    not in CTranslate2 format — the one-time conversion step in
    server/RUNBOOK.md ("Quran-tuned model conversion") must be run first."""


class ASR(Protocol):
    """Interface every transcriber implements."""

    def is_ready(self) -> bool:
        ...

    def transcribe(self, audio_bytes: bytes) -> str:
        ...

    def transcribe_window(self, audio_bytes: bytes, start: float, max_seconds: float):
        """Transcribe only the audio from `start` seconds (at most the last
        `max_seconds`). Returns (text, [(word, start_sec, end_sec), ...]) with
        times measured from the beginning of the whole take."""
        ...


class FakeASR:
    """Test double: returns a preset transcript regardless of audio input.
    Used by every automated test in this repo, since the real Whisper model
    cannot be downloaded inside the sandbox (HuggingFace is proxy-blocked)."""

    def __init__(self, preset_text: str = "") -> None:
        self.preset_text = preset_text
        self.last_audio_len: Optional[int] = None

    def is_ready(self) -> bool:
        return True

    def transcribe(self, audio_bytes: bytes) -> str:
        # Record only the length, for tests that want to assert bytes were
        # actually handed to the transcriber, without holding onto content.
        self.last_audio_len = len(audio_bytes)
        return self.preset_text

    def transcribe_window(self, audio_bytes: bytes, start: float, max_seconds: float):
        # Synthetic timings: half a second per word from `start`.
        self.last_audio_len = len(audio_bytes)
        self.last_window_start = start
        words = self.preset_text.split()
        return self.preset_text, [(w, start + 0.5 * i, start + 0.5 * (i + 1)) for i, w in enumerate(words)]

    def set_preset(self, text: str) -> None:
        self.preset_text = text


class WhisperASR:
    """faster-whisper wrapper. The model is loaded lazily on first use (not
    at import time / process start) so the service can boot, answer
    /healthz, and run entirely off FakeASR even when the model file is
    unreachable (e.g. HuggingFace blocked by the sandbox/VPS firewall)."""

    def __init__(
        self,
        model_size: Optional[str] = None,
        compute_type: Optional[str] = None,
        language: str = "ar",
        vad_filter: bool = True,
    ) -> None:
        self.model_size = model_size or os.environ.get(
            "WHISPER_MODEL", DEFAULT_WHISPER_MODEL
        )
        # Optional GPU tuning; unset = previous behaviour (int8, device "auto").
        # e.g. WHISPER_DEVICE=cuda WHISPER_DEVICE_INDEX=1 WHISPER_COMPUTE_TYPE=float16
        # (newer cards such as RTX 50xx reject int8 cuBLAS, so use float16 there).
        self.compute_type = compute_type or os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
        self.device = os.environ.get("WHISPER_DEVICE", "auto")
        self.device_index = int(os.environ.get("WHISPER_DEVICE_INDEX", "0"))
        # Decoding: unset = faster-whisper defaults (beam 5, conditioned on the
        # previous window). server/bench/asr_bench.py found greedy (1) without
        # conditioning both faster and more accurate for the Quran turbo model.
        self.beam_size = int(os.environ.get("WHISPER_BEAM_SIZE", "5"))
        self.condition_on_previous_text = os.environ.get("WHISPER_CONDITION_ON_PREVIOUS", "1") != "0"
        self.language = language
        self.vad_filter = vad_filter
        self._model = None
        self._load_failed = False
        self.load_error: Optional[str] = None

    def is_ready(self) -> bool:
        return self._model is not None

    def _ensure_model(self):
        if self._model is not None or self._load_failed:
            return self._model
        try:
            from faster_whisper import WhisperModel  # imported lazily too

            self._model = WhisperModel(
                self.model_size, device=self.device, device_index=self.device_index,
                compute_type=self.compute_type
            )
        except Exception as exc:  # noqa: BLE001 - deliberately broad, see below
            # Two distinct failure modes land here and are both non-fatal to
            # the service (guard model load lazily; /evaluate degrades to an
            # empty transcript rather than crashing):
            #   1. Network blocked (HuggingFace unreachable from the
            #      sandbox/VPS) — the common case while developing.
            #   2. The model id IS reachable but is a plain transformers
            #      checkpoint (e.g. tarteel-ai/whisper-base-ar-quran as
            #      published), not CTranslate2 format that faster-whisper
            #      requires. ctranslate2's loader raises a RuntimeError
            #      whose message names the missing CT2 files/format in
            #      that case.
            message = str(exc)
            looks_like_format_issue = any(
                needle in message.lower()
                for needle in (
                    "ctranslate2",
                    "model.bin",
                    "not a valid",
                    "config.json",
                )
            ) and "getaddrinfo" not in message.lower() and "connection" not in message.lower()
            if looks_like_format_issue:
                wrapped = ModelFormatError(
                    f"WHISPER_MODEL={self.model_size!r} does not look like a "
                    "CTranslate2 model. faster-whisper requires CT2 format; "
                    "tarteel-ai/whisper-base-ar-quran on HuggingFace is a "
                    "transformers checkpoint and needs a one-time conversion. "
                    "See server/RUNBOOK.md -> 'Quran-tuned model conversion' "
                    f"for the exact command. Original error: {message}"
                )
                self.load_error = str(wrapped)
                print(f"[asr] {self.load_error}", file=sys.stderr)
            else:
                self.load_error = message
                print(
                    f"[asr] model load failed for {self.model_size!r} "
                    f"(likely network-blocked in this environment): {message}",
                    file=sys.stderr,
                )
            # Model download/load failed. Leave self._model as None;
            # callers must check is_ready()/handle the resulting empty
            # transcript rather than crash the request.
            self._load_failed = True
            self._model = None
        return self._model

    def transcribe(self, audio_bytes: bytes) -> str:
        model = self._ensure_model()
        if model is None:
            return ""

        # faster-whisper needs a real file path so its internal decoder
        # (PyAV/ffmpeg) can sniff and demux the container. We write to a
        # temp file solely for the duration of this call and delete it
        # immediately afterward — audio is never retained.
        tmp = tempfile.NamedTemporaryFile(suffix=".audio", delete=False)
        try:
            tmp.write(audio_bytes)
            tmp.flush()
            tmp.close()
            segments, _info = model.transcribe(
                tmp.name,
                language=self.language,
                vad_filter=self.vad_filter,
                beam_size=self.beam_size,
                condition_on_previous_text=self.condition_on_previous_text,
            )
            return "".join(seg.text for seg in segments).strip()
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

    def transcribe_window(self, audio_bytes: bytes, start: float, max_seconds: float):
        """Live listening: decode the whole take in memory (no temp file), keep
        only the audio from `start` (minus a small lead-in, at most the last
        `max_seconds`) and return its text plus per-word end times measured
        from the beginning of the take, so the client can anchor the next window."""
        model = self._ensure_model()
        if model is None:
            return "", []
        import io
        from faster_whisper.audio import decode_audio

        sr = 16000
        try:
            audio = decode_audio(io.BytesIO(audio_bytes), sampling_rate=sr)
        except Exception:
            # some containers need a real path for format sniffing (see transcribe());
            # same short-lived temp file, deleted at once
            tmp = tempfile.NamedTemporaryFile(suffix=".audio", delete=False)
            try:
                tmp.write(audio_bytes); tmp.close()
                audio = decode_audio(tmp.name, sampling_rate=sr)
            except Exception:  # a take cut mid-frame can fail; the next piece fixes it
                return "", []
            finally:
                try:
                    os.unlink(tmp.name)
                except OSError:
                    pass
        first = int(max(0.0, start - 0.3) * sr)
        first = max(first, len(audio) - int(max_seconds * sr))
        window = audio[first:]
        if len(window) < int(0.3 * sr):
            return "", []
        offset = first / sr
        segments, _info = model.transcribe(
            window,
            language=self.language,
            vad_filter=self.vad_filter,
            beam_size=self.beam_size,
            condition_on_previous_text=self.condition_on_previous_text,
        )
        # Word timestamps are NOT requested: with them the Quran turbo model
        # decodes the trailing silence and hallucinates subtitle credits
        # ("ترجمة نانسي قنقر", "اشتركوا في القناة"), ~40x slower -- and that
        # fine-tune predicts no segment timestamps either (start == end).
        # Instead the recognized words are spread over the SPEECH the voice-
        # activity detector finds in the window (reciters pause between
        # phrases), by letter count: an estimate that main._pointer_time
        # anchors on with an early bias.
        toks = [t for seg in segments for t in seg.text.split()]
        from faster_whisper.vad import VadOptions, get_speech_timestamps

        try:
            speech = [(c["start"] / sr, c["end"] / sr) for c in get_speech_timestamps(window, VadOptions())]
        except Exception:
            speech = []
        if not speech:
            speech = [(0.0, len(window) / sr)]
        span = sum(e - b for b, e in speech) or 1e-6
        total = sum(len(t) for t in toks) or 1
        words, done = [], 0
        for t in toks:
            done += len(t)
            at = span * done / total  # seconds of speech up to the end of this word
            for b, e in speech:
                if at <= e - b:
                    end = b + at
                    break
                at -= e - b
            else:
                end = speech[-1][1]
            words.append((t, offset + end - (len(t) / total) * span, offset + end))
        return " ".join(w[0] for w in words), words
