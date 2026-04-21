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
import subprocess
import tempfile
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
    tts_model: Any = TTSModel.load_model()
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
            if sample_rate != 16000:
                audio_array = await loop.run_in_executor(
                    None,
                    partial(librosa.resample, audio_array, orig_sr=sample_rate, target_sr=16000),
                )

            # Transcribe — NeMo returns objects with .text attribute
            transcriptions: list[Any] = await loop.run_in_executor(None, asr_model.transcribe, [audio_array])
            text: str = transcriptions[0].text if transcriptions else ""

        # Cleanup
        del audio_bytes, audio_array
        gc.collect()

        logger.info("Transcribed audio", extra={"chars": len(text)})
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


# ffmpeg command for WAV → Opus-in-Ogg transcode at 64 kbps VBR.
# Exposed as a module-level constant so tests can reference it and so the args
# are explicit at read time rather than buried inside the subprocess call.
#   -application voip: tunes the encoder psychoacoustic model for speech (not music)
#   -vbr on: variable bitrate — average ~64 kbps, smaller for silence
#   -f ogg pipe:1: write Opus packets into an Ogg container on stdout
_OPUS_ENCODE_ARGS: tuple[str, ...] = (
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    "pipe:0",
    "-c:a",
    "libopus",
    "-b:a",
    "64k",
    "-vbr",
    "on",
    "-application",
    "voip",
    "-f",
    "ogg",
    "pipe:1",
)


async def _encode_opus(wav_bytes: bytes, loop: asyncio.AbstractEventLoop) -> tuple[bytes, str]:
    """Transcode WAV bytes to Opus-in-Ogg via ffmpeg.

    Opus at 64 kbps is roughly 1/10th the size of raw WAV at typical TTS sample
    rates, keeping voice-engine output well under Discord's 8 MiB attachment
    limit for anything up to ~17 minutes of speech.

    On any subprocess failure — missing ffmpeg binary, encode error, empty
    output — returns the original WAV bytes + "audio/wav" so the caller still
    gets playable audio.

    Takes ``loop`` as an explicit parameter rather than calling
    ``asyncio.get_running_loop()`` internally. This matches the ``_load_voice``
    helper pattern in this module — callers already have the loop in scope and
    thread it through for consistency.
    """

    def _run() -> bytes:
        result = subprocess.run(
            _OPUS_ENCODE_ARGS,
            input=wav_bytes,
            capture_output=True,
            check=True,
        )
        return result.stdout

    try:
        opus_bytes = await loop.run_in_executor(None, _run)
    except (subprocess.CalledProcessError, OSError) as exc:
        # OSError catches missing-binary (FileNotFoundError), permission-denied
        # (PermissionError), and other low-level process failures. CalledProcessError
        # is a distinct hierarchy (not an OSError subclass) so it's listed explicitly.
        # All three branches share the same fallback; no differentiation needed here.
        stderr = getattr(exc, "stderr", b"") or b""
        logger.error(
            "ffmpeg Opus transcode failed — falling back to WAV",
            extra={"err": str(exc), "stderr": stderr.decode("utf-8", errors="replace")[:500]},
        )
        return wav_bytes, "audio/wav"

    if len(opus_bytes) == 0:
        logger.error("ffmpeg returned empty Opus output — falling back to WAV")
        return wav_bytes, "audio/wav"

    return opus_bytes, "audio/ogg"


@app.post("/v1/tts")
async def text_to_speech(
    text: str = Form(...),
    voice_id: str = Form("alba"),
    reference_audio: UploadFile | None = File(None),
    audio_format: str = Form("opus", alias="format"),
) -> Response:
    """
    Generate speech from text using Pocket TTS.

    Args:
        text: The text to synthesize
        voice_id: Preset voice name or custom voice identifier
        reference_audio: Optional WAV file for zero-shot voice cloning
        audio_format: Output container — "opus" (default, audio/ogg) or "wav" (audio/wav).
            Callers that need to extract raw PCM (e.g., for multi-chunk concatenation)
            should request "wav"; general-purpose callers should use the Opus default
            since it's ~10x smaller and keeps output under Discord's 8 MiB attachment limit.

    Returns: audio/ogg (Opus) by default, or audio/wav if format="wav"
    """
    if audio_format not in ("opus", "wav"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format: {audio_format}. Allowed: 'opus' (default), 'wav'.",
        )
    if not _is_valid_voice_id(voice_id):
        raise HTTPException(
            status_code=400,
            detail="voice_id must be 1-64 alphanumeric characters, hyphens, or underscores",
        )

    tts_model = models.get("tts")
    if not tts_model:
        raise HTTPException(status_code=503, detail="TTS model not loaded")

    try:
        if len(text) > MAX_TTS_TEXT_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Text too long ({len(text)} chars). Maximum: {MAX_TTS_TEXT_LENGTH}",
            )

        # Strip ElevenLabs-style audio tags (not supported by Pocket TTS)
        clean_text = _AUDIO_TAG_RE.sub("", text).strip()
        if clean_text != text.strip():
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

        # Transcode to Opus-in-Ogg by default — ~10x smaller than raw WAV, keeps output
        # under Discord's 8 MiB attachment limit for anything under ~17 min of speech.
        # Callers that need raw PCM (e.g., multi-chunk concatenation in ttsSynthesizer.ts)
        # pass format="wav" to skip the transcode. On ffmpeg failure we defensively fall
        # back to WAV so the caller still gets usable audio.
        if audio_format == "wav":
            audio_bytes, media_type = wav_bytes, "audio/wav"
        else:
            audio_bytes, media_type = await _encode_opus(wav_bytes, loop)

        logger.info(
            "Generated TTS audio",
            extra={
                "voice_id": voice_id,
                "chars": len(clean_text),
                "wav_bytes": len(wav_bytes),
                "out_bytes": len(audio_bytes),
                "media_type": media_type,
            },
        )
        return Response(content=audio_bytes, media_type=media_type)

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
    # Pass audio_format explicitly — when text_to_speech is invoked as a Python function
    # (not via FastAPI routing), Form() defaults aren't resolved and the Form object
    # would fail the format validation below.
    return await text_to_speech(text=input, voice_id=voice, reference_audio=None, audio_format="opus")


# ---------------------------------------------------------------------------
# Audio Transcode
# ---------------------------------------------------------------------------
@app.post("/v1/audio/transcode")
async def transcode_wav_to_opus(file: UploadFile = File(...)) -> Response:
    """Transcode WAV audio to Opus-in-Ogg (64 kbps VBR, speech-tuned).

    Intended for the multi-chunk TTS path in ai-worker: chunks are synthesized
    as WAV (so raw PCM can be concatenated), then the combined WAV is posted
    here for a single Opus encode. Keeps encoding config (bitrate, VBR, voip
    profile) centralized with _encode_opus so single-chunk and multi-chunk
    produce byte-identical Opus output.

    Accepts: audio/wav bodies up to MAX_AUDIO_UPLOAD_BYTES (50 MB — well above
    the ~15 MB that ~5 min of 22.05 kHz 16-bit mono PCM produces).

    Returns: audio/ogg (Opus) on success; falls back to audio/wav (the original
    input) if ffmpeg is unavailable or fails — matches the /v1/tts fallback so
    callers see one consistent contract.
    """
    audio_bytes = await file.read()
    if len(audio_bytes) > MAX_AUDIO_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Audio file too large")
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty audio body")

    try:
        loop = asyncio.get_running_loop()
        opus_bytes, media_type = await _encode_opus(audio_bytes, loop)
        logger.info(
            "Transcoded audio",
            extra={
                "in_bytes": len(audio_bytes),
                "out_bytes": len(opus_bytes),
                "media_type": media_type,
            },
        )
        return Response(content=opus_bytes, media_type=media_type)
    except HTTPException:
        raise
    except Exception:
        logger.error("Transcode failed", exc_info=True)
        raise HTTPException(status_code=500, detail="Transcode failed") from None


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
