"""
Tzurot Voice Engine — Self-hosted STT + TTS microservice.

STT: NVIDIA Parakeet TDT 0.6B v3 (punctuation-aware transcription)
TTS: Kyutai Pocket TTS (zero-shot voice cloning on CPU)
"""

from __future__ import annotations

import asyncio
import gc
import io
import json
import logging
import os
import re
import secrets
import tempfile
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress
from functools import partial
from typing import Any

import librosa
import nemo.collections.asr as nemo_asr
import numpy as np
import scipy.io.wavfile
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pocket_tts import TTSModel

# ---------------------------------------------------------------------------
# Logging — JSON-structured for Railway log aggregation
# ---------------------------------------------------------------------------


class _JsonFormatter(logging.Formatter):
    """Emit one JSON object per log line for Railway/structured log ingestion."""

    # Standard LogRecord attributes to exclude from extra-field merging.
    # Derived from a dummy LogRecord's __dict__ — common pattern in logging libraries.
    # If CPython adds new internal attrs in future versions, they'll be auto-excluded.
    _STANDARD_ATTRS: frozenset[str] = frozenset(logging.LogRecord("", 0, "", 0, "", (), None).__dict__)

    def format(self, record: logging.LogRecord) -> str:
        # Intentionally does NOT call super().format() — that would set record.message
        # as a side effect, which would then leak into the extra-field merge below.
        log_entry: dict[str, Any] = {
            "level": record.levelname,
            "msg": record.getMessage(),
            "logger": record.name,
        }
        if record.exc_info and record.exc_info[0] is not None:
            log_entry["exc"] = self.formatException(record.exc_info)
        # Dynamically merge any extra={} fields not in the standard LogRecord
        for key, val in record.__dict__.items():
            if key not in self._STANDARD_ATTRS and not key.startswith("_"):
                log_entry[key] = val
        return json.dumps(log_entry)


def _setup_logging() -> logging.Logger:
    """Configure voice-engine logger with JSON output.

    Also attaches a JSON formatter to the root logger at WARNING level so
    third-party libraries (NeMo, uvicorn) emit structured JSON on Railway.
    """
    handler = logging.StreamHandler()
    handler.setFormatter(_JsonFormatter())
    log = logging.getLogger("voice-engine")
    log.addHandler(handler)
    log.setLevel(getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO))
    log.propagate = False  # prevent double-logging to root

    # Root logger: third-party WARNING+ gets JSON formatting
    root_handler = logging.StreamHandler()
    root_handler.setFormatter(_JsonFormatter())
    root_handler.setLevel(logging.WARNING)
    logging.getLogger().addHandler(root_handler)

    return log


logger = _setup_logging()


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Voice ID validation — prevents path traversal (CWE-22) in /v1/voices/register
# \Z is strict end-of-string ($ allows a trailing \n in Python)
_VOICE_ID_RE: re.Pattern[str] = re.compile(r"^[a-zA-Z0-9_-]+\Z")

# Regex for stripping ElevenLabs-style audio tags (not supported by Pocket TTS)
_AUDIO_TAG_RE: re.Pattern[str] = re.compile(
    r"\[(whisper|shout|shouting|laugh|sad|slow|fast|firm|"
    r"compassionate|maniacal laugh|angry|happy|excited)\]",
    flags=re.IGNORECASE,
)

# TTS text length cap — prevents OOM on CPU inference (Railway 4GB ceiling)
MAX_TTS_TEXT_LENGTH: int = 2000

# Audio upload size cap (50MB) — prevents OOM from large uploads.
# Note: api-gateway caps stored voice references at 10MB (VOICE_REFERENCE_LIMITS);
# this higher limit allows direct uploads to the voice engine for testing/registration.
MAX_AUDIO_UPLOAD_BYTES: int = 50 * 1024 * 1024

# STT long-audio chunking — Parakeet TDT runs on CPU and a single long pass scales
# poorly (a 6-min message took ~213s in prod, exceeding the ai-worker's per-attempt
# STT timeout), and one large array risks OOM on the 4GB ceiling. Audio longer than
# the threshold is split into overlapping windows, each transcribed in its own NeMo
# call, and the per-window texts are stitched with overlap de-duplication.
STT_SAMPLE_RATE: int = 16000
# Only chunk above this duration; at/below it the exact single-pass path is preserved.
STT_CHUNK_THRESHOLD_SEC: float = 120.0
# Window length per chunk. Conservative default — tune from real dev-usage timing.
STT_CHUNK_WINDOW_SEC: float = 60.0
# Overlap between adjacent windows so a word straddling a cut lands whole in at least
# one window; the duplicated words are removed when stitching (see _merge_overlap).
STT_CHUNK_OVERLAP_SEC: float = 2.0
# Hard ceiling — reject (413) before any inference. ~12-min cap chosen with the user;
# beyond this a synchronous wait is impractical (see async-transcription backlog item).
MAX_AUDIO_DURATION_SEC: float = 12 * 60.0  # 720s
# Max words compared on each side of a seam when de-duplicating window overlap.
# 2s overlap at typical speech rates is well under this; the cap bounds the scan.
STT_OVERLAP_DEDUP_MAX_WORDS: int = 12

# Allowed audio extensions for voice registration
_AUDIO_EXTENSIONS: dict[str, str] = {
    "audio/wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/m4a": ".m4a",
}
_DEFAULT_AUDIO_EXT: str = ".wav"

# Voice cache eviction cap — each cached voice holds model tensors in memory
MAX_VOICE_CACHE_SIZE: int = 100

# Maximum voice ID length — prevents ENAMETOOLONG when used as filename
MAX_VOICE_ID_LENGTH: int = 64


def _is_valid_voice_id(voice_id: str) -> bool:
    """Check voice ID format: 1-64 alphanumeric chars, hyphens, or underscores."""
    return len(voice_id) <= MAX_VOICE_ID_LENGTH and bool(_VOICE_ID_RE.match(voice_id))


def _safe_voice_path(voices_dir: str, filename: str) -> str:
    """Construct a path within voices_dir with containment verification.

    Defense-in-depth against path traversal (CWE-22). The voice_id regex
    already prevents dangerous characters, but this check satisfies static
    analysis tools (CodeQL py/path-injection) and guards against future
    changes to the validation logic.
    """
    candidate = os.path.join(voices_dir, filename)
    real_dir = os.path.realpath(voices_dir)
    real_candidate = os.path.realpath(candidate)
    if not real_candidate.startswith(real_dir + os.sep):
        raise ValueError(f"Path escapes voices directory: {filename}")
    return candidate


# ---------------------------------------------------------------------------
# Global model references (populated on startup)
# ---------------------------------------------------------------------------
# Any: NeMo ASRModel and PocketTTS TTSModel lack type stubs
models: dict[str, Any] = {}
voice_cache: dict[str, Any] = {}

# Per-voice locks — prevents duplicate computation when concurrent TTS requests
# hit a cache miss for the same voice. Without this, both requests would redundantly
# call get_state_for_audio_prompt (~2.5s each), wasting a semaphore slot.
# Grows without bound but bounded by total voice count (~60-100 in practice).
# Entries are cheap (asyncio.Lock is ~100 bytes) and cleared on shutdown.
_voice_locks: dict[str, asyncio.Lock] = {}

# Audio file extensions recognized when scanning the voices/ directory for lazy loading.
_VOICE_FILE_EXTENSIONS: tuple[str, ...] = (".wav", ".mp3", ".flac", ".ogg")

# Concurrency cap for model inference — prevents OOM on Railway's 4GB ceiling.
# Two concurrent Parakeet TDT passes on 1-min WAV ≈ 480MB audio + 1.2GB model.
try:
    _INFERENCE_CONCURRENCY: int = int(os.environ.get("INFERENCE_CONCURRENCY", "2"))
    if _INFERENCE_CONCURRENCY < 1:
        logger.warning("INFERENCE_CONCURRENCY must be >= 1 — defaulting to 2")
        _INFERENCE_CONCURRENCY = 2
except ValueError:
    logger.warning("Invalid INFERENCE_CONCURRENCY value — defaulting to 2")
    _INFERENCE_CONCURRENCY = 2
_inference_semaphore: asyncio.Semaphore = asyncio.Semaphore(_INFERENCE_CONCURRENCY)

# Serializes calls into Parakeet TDT's `.transcribe()`. NeMo's RNNT models share
# `freeze()`/`unfreeze()` state across concurrent invocations on a single model
# instance — when two transcribes interleave, the second one's `_transcribe_on_end`
# cleanup raises `ValueError: Cannot unfreeze partially without first freezing the
# module with freeze()` because the first call already unfroze it. Audio decoding
# and resampling stay outside this lock so they overlap freely; only the NeMo
# call itself is serialized. Throughput cost is minimal — Parakeet is CPU-bound
# and `_inference_semaphore` already caps total concurrent flights.
_asr_inference_lock: asyncio.Lock = asyncio.Lock()


def _cache_voice(voice_id: str, voice_state: Any) -> None:
    """Cache a voice state with LRU eviction when at capacity."""
    voice_cache.pop(voice_id, None)  # Remove first to refresh insertion order
    voice_cache[voice_id] = voice_state
    if len(voice_cache) > MAX_VOICE_CACHE_SIZE:
        oldest = next(iter(voice_cache))
        del voice_cache[oldest]
        logger.warning(
            "Voice cache full, evicted oldest entry",
            extra={
                "voice_id": oldest,
                "voice_count": MAX_VOICE_CACHE_SIZE,
            },
        )


def _find_voice_on_disk(voice_id: str) -> str | None:
    """Find a registered voice file in the voices/ directory.

    Returns the full file path if found, None otherwise.
    Used for lazy loading: voices registered via /v1/voices/register are
    persisted to disk but only loaded into memory on first TTS request.
    """
    voices_dir = os.environ.get("VOICES_DIR", "./voices")
    if not os.path.isdir(voices_dir):
        return None
    for filename in os.listdir(voices_dir):
        name, ext = os.path.splitext(filename)
        if name == voice_id and ext in _VOICE_FILE_EXTENSIONS:
            return os.path.join(voices_dir, filename)
    return None


async def _load_voice(voice_id: str, tts_model: Any, loop: asyncio.AbstractEventLoop) -> Any:
    """Load a voice state from disk or preset, caching the result.

    Resolution order:
    1. voices/ directory (registered custom voices persisted to disk)
    2. Pocket TTS preset name or HuggingFace path
    3. HTTPException 404 if nothing found

    Caller must hold the per-voice lock (_voice_locks[voice_id]) to prevent
    duplicate computation from concurrent requests.
    """
    # Try loading from voices/ directory first (registered custom voices).
    # os.listdir() inside _find_voice_on_disk is blocking I/O — offload to
    # executor to avoid stalling the event loop.
    disk_path = await loop.run_in_executor(None, _find_voice_on_disk, voice_id)
    if disk_path is not None:
        # No error handling here — if the file exists but is corrupted,
        # the resulting 500 is the correct signal (server-side data error,
        # not a missing-voice user error). Re-registering the voice fixes it.
        voice_state: Any = await loop.run_in_executor(None, tts_model.get_state_for_audio_prompt, disk_path)
        _cache_voice(voice_id, voice_state)
        logger.info("Lazy-loaded voice from disk", extra={"voice_id": voice_id})
        return voice_state

    # Fallback: try as a Pocket TTS preset name or HuggingFace path.
    # Pocket TTS raises OSError (including FileNotFoundError) for unknown preset
    # names, ValueError for invalid formats. Any other exception (OOM, model
    # crash) propagates as 500 via the outer handler.
    try:
        voice_state = await loop.run_in_executor(None, tts_model.get_state_for_audio_prompt, voice_id)
        _cache_voice(voice_id, voice_state)
        return voice_state
    except (ValueError, OSError) as exc:
        logger.warning(
            "Voice not found",
            exc_info=True,
            extra={"voice_id": voice_id},
        )
        raise HTTPException(
            status_code=404,
            detail=f"Voice '{voice_id}' not found",
        ) from exc


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Load models on startup, clean up on shutdown."""
    logger.info("Tzurot Voice Engine starting up")

    # --- Load STT model ---
    logger.info("Loading Parakeet TDT 0.6B v3")
    asr_model = nemo_asr.models.ASRModel.from_pretrained(model_name="nvidia/parakeet-tdt-0.6b-v3")
    asr_model = asr_model.cpu()
    asr_model.eval()
    models["asr"] = asr_model
    logger.info("Parakeet TDT loaded successfully")

    # --- Load TTS model ---
    logger.info("Loading Kyutai Pocket TTS")
    # Explicit "english" alias (= english_2026-04) — the default in pocket-tts 2.1+
    # but pinned here so a future package version that changes the default doesn't
    # silently shift our voice quality.
    tts_model: Any = TTSModel.load_model(language="english")
    models["tts"] = tts_model
    logger.info("Pocket TTS loaded", extra={"sample_rate": tts_model.sample_rate})

    # Voices are loaded lazily on first TTS request — no pre-loading.
    # This keeps startup fast (~25s for models only) which is critical for
    # Railway Serverless where containers sleep after 10 min idle.
    # Custom voices persist in the voices/ directory and are loaded into
    # voice_cache on demand when a TTS request references them.
    if os.environ.get("DEFAULT_VOICES"):
        logger.warning(
            "DEFAULT_VOICES is set but no longer used — remove it from your environment. "
            "Voices load automatically on first TTS request."
        )

    logger.info("Voice Engine ready", extra={"mode": "lazy"})

    yield

    # Shutdown cleanup
    models.clear()
    voice_cache.clear()
    _voice_locks.clear()
    gc.collect()
    logger.info("Voice Engine shut down")


app = FastAPI(title="Tzurot Voice Engine", lifespan=lifespan)

# Optional API key authentication — if VOICE_ENGINE_API_KEY is set, all
# endpoints except /health require it via X-API-Key header or Bearer token.
# When unset, endpoints are unauthenticated (rely on Railway private networking).
_API_KEY: str | None = os.environ.get("VOICE_ENGINE_API_KEY")
if _API_KEY is not None and not _API_KEY.strip():
    raise RuntimeError(
        "VOICE_ENGINE_API_KEY is set but empty/whitespace — all requests would get 401. "
        "Set a non-empty key or unset the variable entirely."
    )


@app.middleware("http")
async def check_api_key(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    if _API_KEY is not None and request.url.path != "/health":
        provided = request.headers.get("x-api-key", "")
        if not provided:
            auth = request.headers.get("authorization", "")
            if auth.startswith("Bearer "):
                provided = auth[7:]
        if not provided or not secrets.compare_digest(provided, _API_KEY):
            return JSONResponse(status_code=401, content={"detail": "Invalid or missing API key"})
    return await call_next(request)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "asr_loaded": "asr" in models,
        "tts_loaded": "tts" in models,
        "voices_loaded": len(voice_cache),
    }


# ---------------------------------------------------------------------------
# STT long-audio chunking helpers
# ---------------------------------------------------------------------------
def _chunk_audio_array(
    audio_array: np.ndarray[Any, np.dtype[np.floating[Any]]],
    sample_rate: int,
    window_sec: float,
    overlap_sec: float,
) -> list[np.ndarray[Any, np.dtype[np.floating[Any]]]]:
    """Split a 1-D audio array into overlapping windows.

    Windows are numpy VIEWS (no copy), so this is memory-cheap; the overlap means a
    word straddling a cut still appears whole in at least one window. Always returns
    >= 1 window. `step` is clamped to >= 1 so a misconfigured overlap >= window can't
    spin forever.
    """
    window_samples = max(1, int(window_sec * sample_rate))
    overlap_samples = max(0, int(overlap_sec * sample_rate))
    step = max(1, window_samples - overlap_samples)
    total = len(audio_array)
    chunks: list[np.ndarray[Any, np.dtype[np.floating[Any]]]] = []
    start = 0
    while start < total:
        end = min(start + window_samples, total)
        chunks.append(audio_array[start:end])
        if end >= total:
            break
        start += step
    return chunks


async def _transcribe_chunks(
    asr_model: Any,
    chunks: list[np.ndarray[Any, np.dtype[np.floating[Any]]]],
    loop: asyncio.AbstractEventLoop,
) -> tuple[list[str], list[float]]:
    """Transcribe each window in its OWN NeMo call, serialized per-call by
    `_asr_inference_lock`.

    The lock is acquired PER WINDOW, not across the whole batch: NeMo's
    freeze/unfreeze state is per-model (see the lock's definition), so each
    `.transcribe()` call must be exclusive — but holding the lock for the entire
    multi-minute batch would block every other request's transcription. Per-window
    acquisition keeps each call exclusive while letting other requests interleave
    between this one's windows.

    Returns the per-window texts plus per-window PURE inference seconds — the timer
    is taken INSIDE the lock so concurrent requests' lock-wait time doesn't pollute
    the per-window number used to tune the window size. (Total request wall time,
    which does include scheduling, is logged separately as `inference_sec`.)
    """
    texts: list[str] = []
    per_chunk_sec: list[float] = []
    for chunk in chunks:
        async with _asr_inference_lock:
            started = time.monotonic()
            results: list[Any] = await loop.run_in_executor(None, asr_model.transcribe, [chunk])
            per_chunk_sec.append(time.monotonic() - started)
        texts.append(results[0].text if results else "")
        # chunks are numpy VIEWS into the still-alive audio_array, so there's nothing
        # per-window to free by deleting the loop var; gc.collect() forces collection
        # of NeMo's per-window cyclic intermediates between windows to bound peak RSS.
        gc.collect()
    return texts, per_chunk_sec


def _normalize_token(token: str) -> str:
    """Lowercase + strip non-word chars, for overlap COMPARISON only. The original
    casing and punctuation are preserved in the stitched output."""
    return re.sub(r"[^\w]", "", token).lower()


def _merge_overlap(left: str, right: str, max_words: int = STT_OVERLAP_DEDUP_MAX_WORDS) -> str:
    """Append `right` to `left`, dropping the longest run of leading `right` words
    that duplicates the trailing `left` words (windows overlap by design).

    Comparison is case/punctuation-insensitive; surviving words keep their original
    form. Scans at most `max_words` on each side. No match (e.g. overlap fell in
    silence) → a plain space-join.
    """
    left_words = left.split()
    right_words = right.split()
    if not left_words:
        return right
    if not right_words:
        return left
    left_norm = [_normalize_token(w) for w in left_words]
    right_norm = [_normalize_token(w) for w in right_words]
    overlap = 0
    max_k = min(max_words, len(left_words), len(right_words))
    for k in range(max_k, 0, -1):
        if left_norm[-k:] == right_norm[:k]:
            overlap = k
            break
    surviving = right_words[overlap:]
    if not surviving:
        return left
    return f"{left} {' '.join(surviving)}"


def _join_chunk_texts(texts: list[str]) -> str:
    """Stitch per-window transcripts into one string, de-duplicating overlap seams.
    Empty/silent windows contribute nothing."""
    result = ""
    for text in texts:
        stripped = text.strip()
        if not stripped:
            continue
        result = stripped if not result else _merge_overlap(result, stripped)
    return result


def _realtime_factor(inference_sec: float, audio_sec: float) -> float:
    """Inference seconds per second of audio (lower = faster than realtime). 0.0 for
    empty audio. Logged so the window size + caller STT timeout are tunable from prod."""
    return round(inference_sec / audio_sec, 3) if audio_sec > 0 else 0.0


async def _run_asr(
    asr_model: Any,
    audio_array: np.ndarray[Any, np.dtype[np.floating[Any]]],
    audio_sec: float,
    loop: asyncio.AbstractEventLoop,
) -> str:
    """Transcribe a decoded/resampled array: a single pass for short audio, the
    chunked path for long. Emits structured timing (audio_sec / inference_sec /
    realtime factor, plus per-window timing when chunked) for prod-log tuning.

    Caller holds `_inference_semaphore`; this acquires `_asr_inference_lock`
    per NeMo call (directly for the single pass, inside `_transcribe_chunks` for
    the chunked path).
    """
    started = time.monotonic()

    if audio_sec <= STT_CHUNK_THRESHOLD_SEC:
        # NeMo returns objects with a .text attribute; the lock serializes callers
        # because NeMo's freeze/unfreeze state is per-model (see the lock's docstring).
        async with _asr_inference_lock:
            transcriptions: list[Any] = await loop.run_in_executor(None, asr_model.transcribe, [audio_array])
        text = transcriptions[0].text if transcriptions else ""
        inference_sec = time.monotonic() - started
        logger.info(
            "Transcribed audio",
            extra={
                "chars": len(text),
                "audio_sec": round(audio_sec, 1),
                "inference_sec": round(inference_sec, 1),
                "rtf": _realtime_factor(inference_sec, audio_sec),
                "chunked": False,
            },
        )
        return text

    chunks = _chunk_audio_array(audio_array, STT_SAMPLE_RATE, STT_CHUNK_WINDOW_SEC, STT_CHUNK_OVERLAP_SEC)
    texts, per_chunk_sec = await _transcribe_chunks(asr_model, chunks, loop)
    text = _join_chunk_texts(texts)
    inference_sec = time.monotonic() - started
    logger.info(
        "Transcribed audio (chunked)",
        extra={
            "chars": len(text),
            "chunks": len(chunks),
            "audio_sec": round(audio_sec, 1),
            "inference_sec": round(inference_sec, 1),
            "rtf": _realtime_factor(inference_sec, audio_sec),
            "window_sec": STT_CHUNK_WINDOW_SEC,
            "overlap_sec": STT_CHUNK_OVERLAP_SEC,
            "per_chunk_sec": [round(s, 1) for s in per_chunk_sec],
            "chunked": True,
        },
    )
    return text


# ---------------------------------------------------------------------------
# STT Endpoint
# ---------------------------------------------------------------------------
@app.post("/v1/transcribe")
async def transcribe(file: UploadFile = File(...)) -> dict[str, str]:
    """
    Transcribe audio to text with native punctuation and capitalization.

    Accepts: WAV, FLAC, OGG, MP3
    Returns: { "text": "Properly punctuated transcription." }
    """
    asr_model = models.get("asr")
    if not asr_model:
        raise HTTPException(status_code=503, detail="STT model not loaded")

    try:
        audio_bytes = await file.read()
        if len(audio_bytes) > MAX_AUDIO_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Audio file too large")

        # Run CPU-bound audio decoding + inference off the event loop so
        # /health and concurrent requests aren't blocked during processing.
        # Semaphore caps concurrency to prevent OOM on Railway 4GB ceiling.
        loop = asyncio.get_running_loop()
        async with _inference_semaphore:
            # librosa handles MP3, OGG, FLAC, WAV (soundfile can't decode MP3)
            audio_array: np.ndarray[Any, np.dtype[np.floating[Any]]]
            sample_rate: int
            audio_array, sample_rate = await loop.run_in_executor(
                None, partial(librosa.load, io.BytesIO(audio_bytes), sr=None, mono=True)
            )

            # Resample to 16kHz if needed (librosa already returns float32 mono)
            if sample_rate != STT_SAMPLE_RATE:
                audio_array = await loop.run_in_executor(
                    None,
                    partial(librosa.resample, audio_array, orig_sr=sample_rate, target_sr=STT_SAMPLE_RATE),
                )

            audio_sec = len(audio_array) / STT_SAMPLE_RATE
            # Hard ceiling — reject before any inference. A too-long synchronous
            # transcription would blow the caller's STT timeout anyway; failing fast
            # with a specific message lets the caller surface "too long" to the user.
            # Note the cap fires AFTER librosa decode, so the decoded array is already
            # resident (~46 MB for the 12-min cap: 720s x 16kHz x float32) when we
            # reject — bounded by MAX_AUDIO_UPLOAD_BYTES on the compressed upload and
            # well within the 4 GB ceiling, so a pre-decode duration check isn't worth
            # the format-specific header parsing it would require.
            if audio_sec > MAX_AUDIO_DURATION_SEC:
                raise HTTPException(
                    status_code=413,
                    detail=f"Audio too long ({audio_sec:.0f}s). Maximum is {MAX_AUDIO_DURATION_SEC:.0f}s.",
                )

            # Single pass for short audio; chunked (memory-bounded, instrumented) for long.
            text = await _run_asr(asr_model, audio_array, audio_sec, loop)

        # Cleanup
        del audio_bytes, audio_array
        gc.collect()

        return {"text": text}

    except HTTPException:
        raise
    except Exception:
        logger.error("Transcription failed", exc_info=True)
        gc.collect()
        raise HTTPException(status_code=500, detail="Transcription failed") from None


# OpenAI Whisper API-compatible endpoint for drop-in replacement
@app.post("/v1/audio/transcriptions")
async def transcribe_openai_compat(
    file: UploadFile = File(...),
    model: str = Form("parakeet-tdt-0.6b-v3"),
) -> dict[str, str]:
    """OpenAI Whisper API-compatible endpoint.

    Note: ``model`` is accepted for API compatibility but currently ignored.
    All requests use Parakeet TDT.
    """
    _ = model  # accepted for API compat; can't rename to _model (FastAPI derives form field name)
    result = await transcribe(file)
    return result


# ---------------------------------------------------------------------------
# TTS Endpoints
# ---------------------------------------------------------------------------


@app.post("/v1/tts")
async def text_to_speech(
    text: str = Form(...),
    voice_id: str = Form("alba"),
    reference_audio: UploadFile | None = File(None),
) -> Response:
    """
    Generate speech from text using Pocket TTS.

    Args:
        text: The text to synthesize
        voice_id: Preset voice name or custom voice identifier
        reference_audio: Optional WAV file for zero-shot voice cloning

    Returns: audio/wav (raw PCM in WAV container, sample rate matches the TTS
        model's native rate). The Opus encoding is performed downstream in
        ai-worker's audioNormalizer (single ffmpeg pass: loudnorm + libopus +
        ogg muxer). Voice-engine is purely a synthesis service.
    """
    if not _is_valid_voice_id(voice_id):
        raise HTTPException(
            status_code=400,
            detail="voice_id must be 1-64 alphanumeric characters, hyphens, or underscores",
        )

    tts_model = models.get("tts")
    if not tts_model:
        raise HTTPException(status_code=503, detail="TTS model not loaded")

    try:
        # Strip `\r` once: (a) measure visible-character count so callers that
        # correctly send CRLF (per multipart/form-data spec) aren't penalized
        # vs callers that send bare `\n`, and (b) feed the same `\r`-free text
        # into PocketTTS synthesis so we don't forward stray `\r` chars into
        # the model. The TS chunker normalizes to CRLF so wire-size matches
        # JS `.length`; this strip restores parity on the receiving side.
        normalized_text = text.replace("\r", "")
        if len(normalized_text) > MAX_TTS_TEXT_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Text too long ({len(normalized_text)} chars). Maximum: {MAX_TTS_TEXT_LENGTH}",
            )

        # Strip ElevenLabs-style audio tags (not supported by Pocket TTS)
        clean_text = _AUDIO_TAG_RE.sub("", normalized_text).strip()
        if clean_text != normalized_text.strip():
            logger.info("Stripped audio tags from TTS text", extra={"voice_id": voice_id})

        if not clean_text:
            raise HTTPException(status_code=400, detail="No text to synthesize")

        # Read reference audio before acquiring semaphore (I/O, not model work)
        loop = asyncio.get_running_loop()
        ref_tmp_path: str | None = None
        try:
            if reference_audio:
                ref_audio_bytes = await reference_audio.read()
                if len(ref_audio_bytes) > MAX_AUDIO_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Reference audio file too large")
                if reference_audio.content_type and reference_audio.content_type not in _AUDIO_EXTENSIONS:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unsupported audio type: {reference_audio.content_type}. "
                        f"Allowed: {', '.join(sorted(_AUDIO_EXTENSIONS))}",
                    )
                ext = _AUDIO_EXTENSIONS.get(reference_audio.content_type or "", _DEFAULT_AUDIO_EXT)
                with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                    ref_tmp_path = tmp.name
                    tmp.write(ref_audio_bytes)
                del ref_audio_bytes

            # --- Phase 1: Resolve voice state (outside semaphore) ---
            # Voice resolution uses per-voice locks to prevent duplicate
            # computation. Keeping this outside the inference semaphore
            # avoids wasting a concurrency slot while waiting on a lock.
            voice_state: Any
            if ref_tmp_path is not None:
                # Zero-shot cloning — voice_state set in Phase 2 (inside
                # semaphore) because uploaded reference audio can be large.
                pass
            elif voice_id in voice_cache:
                # Refresh LRU position via _cache_voice (pop-and-reinsert)
                voice_state = voice_cache[voice_id]
                _cache_voice(voice_id, voice_state)
            else:
                # Cache miss — acquire per-voice lock to prevent duplicate
                # computation when concurrent requests hit the same voice.
                # Lock dict growth is bounded: only authenticated ai-worker
                # calls reach here (VOICE_ENGINE_API_KEY + Railway private
                # networking), and voice_id is format-validated by
                # _is_valid_voice_id. Practical max = registered voice count.
                lock = _voice_locks.setdefault(voice_id, asyncio.Lock())
                async with lock:
                    # Double-check: another request may have loaded it while
                    # we waited for the lock. No LRU refresh needed — the
                    # concurrent request just cached it, so it's already newest.
                    if voice_id in voice_cache:
                        voice_state = voice_cache[voice_id]
                    else:
                        voice_state = await _load_voice(voice_id, tts_model, loop)

            # --- Phase 2: Model inference (semaphore) ---
            # Semaphore caps concurrency to prevent OOM on Railway 4GB ceiling.
            async with _inference_semaphore:
                if ref_tmp_path is not None:
                    voice_state = await loop.run_in_executor(None, tts_model.get_state_for_audio_prompt, ref_tmp_path)
                    _cache_voice(voice_id, voice_state)

                # Generate audio
                audio_tensor: Any = await loop.run_in_executor(None, tts_model.generate_audio, voice_state, clean_text)
        finally:
            # Clean up temp file regardless of semaphore/model errors
            if ref_tmp_path is not None and os.path.exists(ref_tmp_path):
                os.unlink(ref_tmp_path)
        audio_np: np.ndarray[Any, np.dtype[np.int16]] = np.clip(audio_tensor.numpy() * 32767, -32768, 32767).astype(
            np.int16
        )

        # Convert to WAV bytes (Pocket TTS emits int16 PCM samples; scipy wraps them in a WAV container)
        wav_buffer = io.BytesIO()
        scipy.io.wavfile.write(wav_buffer, tts_model.sample_rate, audio_np)
        wav_buffer.seek(0)
        wav_bytes: bytes = wav_buffer.read()

        # Cleanup
        del audio_tensor, audio_np
        gc.collect()

        logger.info(
            "Generated TTS audio",
            extra={
                "voice_id": voice_id,
                "chars": len(clean_text),
                "wav_bytes": len(wav_bytes),
            },
        )
        return Response(content=wav_bytes, media_type="audio/wav")

    except HTTPException:
        raise
    except Exception:
        logger.error("Speech generation failed", exc_info=True, extra={"voice_id": voice_id})
        gc.collect()
        raise HTTPException(status_code=500, detail="Speech generation failed") from None


# OpenAI-inspired TTS endpoint (Form fields, NOT JSON — not a true drop-in)
@app.post("/v1/audio/speech")
async def tts_openai_compat(
    input: str = Form(...),
    model: str = Form("pocket-tts"),
    voice: str = Form("alba"),
) -> Response:
    """OpenAI-inspired TTS endpoint (uses Form fields, not JSON body).

    Not a true drop-in for the official OpenAI SDK — use /v1/tts for
    the native interface. ``model`` is accepted for API compatibility
    but currently ignored; all requests use Pocket TTS.
    """
    _ = model  # accepted for API compat; can't rename to _model (FastAPI derives form field name)
    return await text_to_speech(text=input, voice_id=voice, reference_audio=None)


# ---------------------------------------------------------------------------
# Voice Management
# ---------------------------------------------------------------------------
@app.get("/v1/voices")
def list_voices() -> dict[str, list[dict[str, str]]]:
    """List all available voices."""
    return {"voices": [{"id": voice_id, "type": "cached"} for voice_id in voice_cache]}


@app.post("/v1/voices/register")
async def register_voice(
    voice_id: str = Form(...),
    audio: UploadFile = File(...),
) -> dict[str, str]:
    """
    Register a new voice from a reference audio file.
    The voice state is cached in memory for subsequent TTS requests.
    For persistent storage, save the audio file to the voices/ directory.
    """
    if not _is_valid_voice_id(voice_id):
        raise HTTPException(
            status_code=400,
            detail="voice_id must be 1-64 alphanumeric characters, hyphens, or underscores",
        )

    tts_model = models.get("tts")
    if not tts_model:
        raise HTTPException(status_code=503, detail="TTS model not loaded")

    try:
        audio_bytes = await audio.read()
        if len(audio_bytes) > MAX_AUDIO_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Audio file too large")

        # Validate MIME type — same check as /v1/tts reference_audio path
        if audio.content_type and audio.content_type not in _AUDIO_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported audio type: {audio.content_type}. Allowed: {', '.join(sorted(_AUDIO_EXTENSIONS))}",
            )

        # Save to voices directory for persistence across restarts.
        # SINGLE_REPLICA_ONLY: This writes to local disk, so registered voices
        # are only visible to the replica that handled the request. Multi-replica
        # deployments need shared storage (e.g., Railway volume or S3) in Phase 2.
        voices_dir = os.environ.get("VOICES_DIR", "./voices")
        os.makedirs(voices_dir, exist_ok=True)
        ext = _AUDIO_EXTENSIONS.get(audio.content_type or "", _DEFAULT_AUDIO_EXT)
        voice_path = _safe_voice_path(voices_dir, f"{voice_id}{ext}")

        # Clean up stale files from prior registrations with different MIME types
        # (e.g., re-registering "alice" as MP3 after it was WAV leaves alice.wav).
        # FileNotFoundError guard prevents race when two concurrent registrations
        # for the same voice_id both try to unlink the same stale file.
        for existing in os.listdir(voices_dir):
            if os.path.splitext(existing)[0] == voice_id:
                existing_path = os.path.join(voices_dir, existing)
                if existing_path != voice_path:
                    with suppress(FileNotFoundError):
                        os.unlink(existing_path)

        # Write and process — clean up on any failure (disk full, model error).
        # File write is offloaded to executor to avoid blocking the event loop
        # for large uploads (up to MAX_AUDIO_UPLOAD_BYTES = 50MB).
        # Atomic write (temp + rename) prevents corrupted reads if a TTS request
        # tries to lazy-load this voice file mid-write.
        loop = asyncio.get_running_loop()

        def _write_file_atomic(final_path: str, data: bytes) -> None:
            dir_name = os.path.dirname(final_path)
            fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
                os.rename(tmp_path, final_path)
            except BaseException:
                with suppress(OSError):
                    os.unlink(tmp_path)
                raise

        try:
            await loop.run_in_executor(None, _write_file_atomic, voice_path, audio_bytes)
            async with _inference_semaphore:
                voice_state: Any = await loop.run_in_executor(None, tts_model.get_state_for_audio_prompt, voice_path)
            _cache_voice(voice_id, voice_state)
        except Exception:
            # Inline containment check for cleanup (CodeQL py/path-injection #63/#64).
            # voice_path was already validated by _safe_voice_path at line 580, but
            # CodeQL can't trace custom sanitizer functions — it only recognizes the
            # realpath + startswith pattern when inlined in the same scope.
            real_dir = os.path.realpath(voices_dir)
            real_path = os.path.realpath(voice_path)
            if real_path.startswith(real_dir + os.sep) and os.path.exists(real_path):
                os.unlink(real_path)
            raise

        del audio_bytes
        gc.collect()

        logger.info("Voice registered successfully", extra={"voice_id": voice_id})
        return {"status": "ok", "voice_id": voice_id}

    except HTTPException:
        raise
    except Exception:
        logger.error("Voice registration failed", exc_info=True, extra={"voice_id": voice_id})
        gc.collect()
        raise HTTPException(status_code=500, detail="Voice registration failed") from None


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    # Bind to :: (IPv6 wildcard) so Railway private networking (IPv6) works.
    # Dual-stack sockets also accept IPv4, so localhost/healthcheck still work.
    uvicorn.run(app, host="::", port=port)
