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
from contextlib import asynccontextmanager
from functools import partial
from collections.abc import Awaitable, Callable
from typing import Any, AsyncIterator

import librosa  # type: ignore[import-untyped] -- no type stubs available
import nemo.collections.asr as nemo_asr  # type: ignore[import-untyped] -- NeMo lacks stubs
import numpy as np
import scipy.io.wavfile  # type: ignore[import-untyped] -- scipy stubs incomplete for io.wavfile
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pocket_tts import TTSModel  # type: ignore[import-untyped] -- no type stubs available

# ---------------------------------------------------------------------------
# Logging — JSON-structured for Railway log aggregation
# ---------------------------------------------------------------------------


class _JsonFormatter(logging.Formatter):
    """Emit one JSON object per log line for Railway/structured log ingestion."""

    # Standard LogRecord attributes to exclude from extra-field merging.
    # Derived from a dummy LogRecord's __dict__ — common pattern in logging libraries.
    # If CPython adds new internal attrs in future versions, they'll be auto-excluded.
    _STANDARD_ATTRS: frozenset[str] = frozenset(
        logging.LogRecord("", 0, "", 0, "", (), None).__dict__
    )

    def format(self, record: logging.LogRecord) -> str:  # noqa: A003 -- overrides Formatter.format
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
    """Configure voice-engine logger with JSON output."""
    handler = logging.StreamHandler()
    handler.setFormatter(_JsonFormatter())
    log = logging.getLogger("voice-engine")
    log.addHandler(handler)
    log.setLevel(getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO))
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
}
_DEFAULT_AUDIO_EXT: str = ".wav"

# Voice cache eviction cap — each cached voice holds model tensors in memory
MAX_VOICE_CACHE_SIZE: int = 100

# Maximum voice ID length — prevents ENAMETOOLONG when used as filename
MAX_VOICE_ID_LENGTH: int = 64


def _is_valid_voice_id(voice_id: str) -> bool:
    """Check voice ID format: 1-64 alphanumeric chars, hyphens, or underscores."""
    return len(voice_id) <= MAX_VOICE_ID_LENGTH and bool(_VOICE_ID_RE.match(voice_id))


# ---------------------------------------------------------------------------
# Global model references (populated on startup)
# ---------------------------------------------------------------------------
# Any: NeMo ASRModel and PocketTTS TTSModel lack type stubs
models: dict[str, Any] = {}
voice_cache: dict[str, Any] = {}

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
        logger.info("Voice cache full, evicted oldest entry", extra={
            "voice_id": oldest, "voice_count": MAX_VOICE_CACHE_SIZE,
        })


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Load models on startup, clean up on shutdown."""
    logger.info("Tzurot Voice Engine starting up")

    # --- Load STT model ---
    logger.info("Loading Parakeet TDT 0.6B v3")
    asr_model = nemo_asr.models.ASRModel.from_pretrained(
        model_name="nvidia/parakeet-tdt-0.6b-v3"
    )
    asr_model = asr_model.cpu()
    asr_model.eval()
    models["asr"] = asr_model
    logger.info("Parakeet TDT loaded successfully")

    # --- Load TTS model ---
    logger.info("Loading Kyutai Pocket TTS")
    tts_model: Any = TTSModel.load_model()
    models["tts"] = tts_model
    logger.info("Pocket TTS loaded", extra={"sample_rate": tts_model.sample_rate})

    # --- Pre-load default voices ---
    default_voices = os.environ.get("DEFAULT_VOICES", "alba,bria").split(",")
    for voice_name in default_voices:
        voice_name = voice_name.strip()
        if not voice_name:
            continue
        if not _is_valid_voice_id(voice_name):
            logger.warning("Skipping invalid preset voice name", extra={"voice_id": voice_name})
            continue
        try:
            _cache_voice(
                voice_name,
                tts_model.get_state_for_audio_prompt(voice_name),
            )
            logger.info("Pre-loaded voice", extra={"voice_id": voice_name})
        except Exception:
            logger.warning("Failed to pre-load voice", exc_info=True, extra={"voice_id": voice_name})

    # --- Pre-load any custom voices from the voices/ directory ---
    voices_dir = os.environ.get("VOICES_DIR", "./voices")
    if os.path.isdir(voices_dir):
        for filename in os.listdir(voices_dir):
            if filename.endswith((".wav", ".mp3", ".flac", ".ogg")):
                voice_id = os.path.splitext(filename)[0]
                if not _is_valid_voice_id(voice_id):
                    logger.warning("Skipping voice file with invalid ID", extra={"filename": filename})
                    continue
                filepath = os.path.join(voices_dir, filename)
                try:
                    _cache_voice(
                        voice_id,
                        tts_model.get_state_for_audio_prompt(filepath),
                    )
                    logger.info("Pre-loaded custom voice", extra={"voice_id": voice_id})
                except Exception:
                    logger.warning("Failed to pre-load custom voice", exc_info=True, extra={"voice_id": voice_id})

    logger.info("Voice Engine ready", extra={"voices_loaded": len(voice_cache)})

    yield

    # Shutdown cleanup
    models.clear()
    voice_cache.clear()
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
async def check_api_key(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    if _API_KEY is not None and request.url.path != "/health":
        provided = request.headers.get("x-api-key", "")
        if not provided:
            auth = request.headers.get("authorization", "")
            if auth.startswith("Bearer "):
                provided = auth[7:]
        if not provided or not secrets.compare_digest(provided, _API_KEY):
            return JSONResponse(
                status_code=401, content={"detail": "Invalid or missing API key"}
            )
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
            transcriptions: list[Any] = await loop.run_in_executor(
                None, asr_model.transcribe, [audio_array]
            )
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
        raise HTTPException(status_code=500, detail="Transcription failed")


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

    Returns: audio/wav
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
                    raise HTTPException(
                        status_code=413, detail="Reference audio file too large"
                    )
                if (
                    reference_audio.content_type
                    and reference_audio.content_type not in _AUDIO_EXTENSIONS
                ):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unsupported audio type: {reference_audio.content_type}. "
                        f"Allowed: {', '.join(sorted(_AUDIO_EXTENSIONS))}",
                    )
                ext = _AUDIO_EXTENSIONS.get(
                    reference_audio.content_type, _DEFAULT_AUDIO_EXT
                )
                with tempfile.NamedTemporaryFile(
                    suffix=ext, delete=False
                ) as tmp:
                    ref_tmp_path = tmp.name
                    tmp.write(ref_audio_bytes)
                del ref_audio_bytes

            # Semaphore caps concurrency to prevent OOM on Railway 4GB ceiling.
            async with _inference_semaphore:
                # Get or create voice state
                if ref_tmp_path is not None:
                    # Zero-shot cloning from uploaded audio
                    voice_state: Any = await loop.run_in_executor(
                        None, tts_model.get_state_for_audio_prompt, ref_tmp_path
                    )
                    _cache_voice(voice_id, voice_state)

                elif voice_id in voice_cache:
                    # Refresh LRU position via _cache_voice (pop-and-reinsert)
                    voice_state = voice_cache[voice_id]
                    _cache_voice(voice_id, voice_state)

                else:
                    # Try loading as a preset name or HF path
                    try:
                        voice_state = await loop.run_in_executor(
                            None, tts_model.get_state_for_audio_prompt, voice_id
                        )
                        _cache_voice(voice_id, voice_state)
                    except Exception:
                        logger.warning("Voice not found", extra={"voice_id": voice_id})
                        raise HTTPException(
                            status_code=404,
                            detail=f"Voice '{voice_id}' not found",
                        )

                # Generate audio
                audio_tensor: Any = await loop.run_in_executor(
                    None, tts_model.generate_audio, voice_state, clean_text
                )
        finally:
            # Clean up temp file regardless of semaphore/model errors
            if ref_tmp_path is not None and os.path.exists(ref_tmp_path):
                os.unlink(ref_tmp_path)
        audio_np: np.ndarray[Any, np.dtype[np.int16]] = np.clip(
            audio_tensor.numpy() * 32767, -32768, 32767
        ).astype(np.int16)

        # Convert to WAV bytes
        wav_buffer = io.BytesIO()
        scipy.io.wavfile.write(wav_buffer, tts_model.sample_rate, audio_np)
        wav_buffer.seek(0)
        wav_bytes: bytes = wav_buffer.read()

        # Cleanup
        del audio_tensor, audio_np
        gc.collect()

        logger.info("Generated TTS audio", extra={"voice_id": voice_id, "chars": len(clean_text)})
        return Response(content=wav_bytes, media_type="audio/wav")

    except HTTPException:
        raise
    except Exception:
        logger.error("Speech generation failed", exc_info=True, extra={"voice_id": voice_id})
        gc.collect()
        raise HTTPException(status_code=500, detail="Speech generation failed")


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
    return await text_to_speech(text=input, voice_id=voice)


# ---------------------------------------------------------------------------
# Voice Management
# ---------------------------------------------------------------------------
@app.get("/v1/voices")
def list_voices() -> dict[str, list[dict[str, str]]]:
    """List all available voices."""
    return {
        "voices": [
            {"id": voice_id, "type": "cached"} for voice_id in voice_cache
        ]
    }


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

        # Save to voices directory for persistence across restarts.
        # SINGLE_REPLICA_ONLY: This writes to local disk, so registered voices
        # are only visible to the replica that handled the request. Multi-replica
        # deployments need shared storage (e.g., Railway volume or S3) in Phase 2.
        voices_dir = os.environ.get("VOICES_DIR", "./voices")
        os.makedirs(voices_dir, exist_ok=True)
        ext = _AUDIO_EXTENSIONS.get(audio.content_type, _DEFAULT_AUDIO_EXT)
        voice_path = os.path.join(voices_dir, f"{voice_id}{ext}")

        # Clean up stale files from prior registrations with different MIME types
        # (e.g., re-registering "alice" as MP3 after it was WAV leaves alice.wav).
        # FileNotFoundError guard prevents race when two concurrent registrations
        # for the same voice_id both try to unlink the same stale file.
        for existing in os.listdir(voices_dir):
            if os.path.splitext(existing)[0] == voice_id:
                existing_path = os.path.join(voices_dir, existing)
                if existing_path != voice_path:
                    try:
                        os.unlink(existing_path)
                    except FileNotFoundError:
                        pass

        # Write and process — clean up on any failure (disk full, model error).
        # File write is offloaded to executor to avoid blocking the event loop
        # for large uploads (up to MAX_AUDIO_UPLOAD_BYTES = 50MB).
        loop = asyncio.get_running_loop()

        def _write_file(path: str, data: bytes) -> None:
            with open(path, "wb") as f:
                f.write(data)

        try:
            await loop.run_in_executor(None, _write_file, voice_path, audio_bytes)
            async with _inference_semaphore:
                voice_state: Any = await loop.run_in_executor(
                    None, tts_model.get_state_for_audio_prompt, voice_path
                )
            _cache_voice(voice_id, voice_state)
        except Exception:
            if os.path.exists(voice_path):
                os.unlink(voice_path)
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
        raise HTTPException(status_code=500, detail="Voice registration failed")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
