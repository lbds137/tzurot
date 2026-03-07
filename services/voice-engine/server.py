"""
Tzurot Voice Engine — Self-hosted STT + TTS microservice.

STT: NVIDIA Parakeet TDT 0.6B v3 (punctuation-aware transcription)
TTS: Kyutai Pocket TTS (zero-shot voice cloning on CPU)
"""

import gc
import io
import os
import re
import tempfile
from contextlib import asynccontextmanager

import numpy as np
import scipy.io.wavfile
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Voice ID validation — prevents path traversal (CWE-22) in /v1/voices/register
_VOICE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")

# Regex for stripping ElevenLabs-style audio tags (not supported by Pocket TTS)
_AUDIO_TAG_RE = re.compile(
    r"\[(whisper|shout|shouting|laugh|sad|slow|fast|firm|"
    r"compassionate|maniacal laugh|angry|happy|excited)\]",
    flags=re.IGNORECASE,
)

# TTS text length cap — prevents OOM on CPU inference (Railway 4GB ceiling)
MAX_TTS_TEXT_LENGTH = 2000

# Audio upload size cap (50MB) — prevents OOM from large uploads
MAX_AUDIO_UPLOAD_BYTES = 50 * 1024 * 1024

# Allowed audio extensions for voice registration
_AUDIO_EXTENSIONS = {
    "audio/wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
}
_DEFAULT_AUDIO_EXT = ".wav"

# Voice cache eviction cap — each cached voice holds model tensors in memory
MAX_VOICE_CACHE_SIZE = 100

# ---------------------------------------------------------------------------
# Global model references (populated on startup)
# ---------------------------------------------------------------------------
models = {}
voice_cache = {}


def _cache_voice(voice_id, voice_state):
    """Cache a voice state with LRU eviction when at capacity."""
    voice_cache.pop(voice_id, None)  # Remove first to refresh insertion order
    voice_cache[voice_id] = voice_state
    if len(voice_cache) > MAX_VOICE_CACHE_SIZE:
        oldest = next(iter(voice_cache))
        del voice_cache[oldest]
        print(f"[TTS] Voice cache full ({MAX_VOICE_CACHE_SIZE}), evicted: {oldest}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load models on startup, clean up on shutdown."""
    print("=" * 60)
    print("TZUROT VOICE ENGINE — Starting up")
    print("=" * 60)

    # --- Load STT model ---
    print("[STT] Loading Parakeet TDT 0.6B v3...")
    import nemo.collections.asr as nemo_asr

    asr_model = nemo_asr.models.ASRModel.from_pretrained(
        model_name="nvidia/parakeet-tdt-0.6b-v3"
    )
    asr_model = asr_model.cpu()
    asr_model.eval()
    models["asr"] = asr_model
    print("[STT] Parakeet TDT loaded successfully.")

    # --- Load TTS model ---
    print("[TTS] Loading Kyutai Pocket TTS...")
    from pocket_tts import TTSModel

    tts_model = TTSModel.load_model()
    models["tts"] = tts_model
    print(f"[TTS] Pocket TTS loaded. Sample rate: {tts_model.sample_rate}")

    # --- Pre-load default voices ---
    default_voices = os.environ.get("DEFAULT_VOICES", "alba,bria").split(",")
    for voice_name in default_voices:
        voice_name = voice_name.strip()
        if voice_name:
            print(f"[TTS] Pre-loading voice: {voice_name}")
            voice_cache[voice_name] = tts_model.get_state_for_audio_prompt(
                voice_name
            )

    # --- Pre-load any custom voices from the voices/ directory ---
    voices_dir = os.environ.get("VOICES_DIR", "./voices")
    if os.path.isdir(voices_dir):
        for filename in os.listdir(voices_dir):
            if filename.endswith((".wav", ".mp3", ".flac", ".ogg")):
                voice_id = os.path.splitext(filename)[0]
                filepath = os.path.join(voices_dir, filename)
                print(f"[TTS] Pre-loading custom voice: {voice_id}")
                voice_cache[voice_id] = tts_model.get_state_for_audio_prompt(
                    filepath
                )

    print("=" * 60)
    print(f"VOICE ENGINE READY — {len(voice_cache)} voices loaded")
    print("=" * 60)

    yield

    # Shutdown cleanup
    models.clear()
    voice_cache.clear()
    gc.collect()


app = FastAPI(title="Tzurot Voice Engine", lifespan=lifespan)

# Optional API key authentication — if VOICE_ENGINE_API_KEY is set, all
# endpoints except /health require it via X-API-Key header or Bearer token.
# When unset, endpoints are unauthenticated (rely on Railway private networking).
_API_KEY = os.environ.get("VOICE_ENGINE_API_KEY")


@app.middleware("http")
async def check_api_key(request: Request, call_next):
    if _API_KEY and request.url.path != "/health":
        provided = request.headers.get("x-api-key", "")
        if not provided:
            auth = request.headers.get("authorization", "")
            if auth.startswith("Bearer "):
                provided = auth[7:]
        if provided != _API_KEY:
            return JSONResponse(
                status_code=401, content={"detail": "Invalid or missing API key"}
            )
    return await call_next(request)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {
        "status": "ok",
        "asr_loaded": "asr" in models,
        "tts_loaded": "tts" in models,
        "voices_loaded": list(voice_cache.keys()),
    }


# ---------------------------------------------------------------------------
# STT Endpoint
# ---------------------------------------------------------------------------
@app.post("/v1/transcribe")
async def transcribe(file: UploadFile = File(...)):
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

        audio_array, sample_rate = sf.read(io.BytesIO(audio_bytes))

        # Convert to mono if stereo
        if len(audio_array.shape) > 1:
            audio_array = np.mean(audio_array, axis=1)

        # Resample to 16kHz if needed
        if sample_rate != 16000:
            import librosa

            audio_array = librosa.resample(
                audio_array.astype(np.float32),
                orig_sr=sample_rate,
                target_sr=16000,
            )

        # Ensure float32
        audio_array = audio_array.astype(np.float32)

        # Transcribe — NeMo returns objects with .text attribute
        transcriptions = asr_model.transcribe([audio_array])
        text = transcriptions[0].text if transcriptions else ""

        # Cleanup
        del audio_bytes, audio_array
        gc.collect()

        return {"text": text}

    except HTTPException:
        raise
    except Exception as e:
        print(f"[STT] Transcription error: {e}")
        gc.collect()
        raise HTTPException(status_code=500, detail="Transcription failed")


# OpenAI Whisper API-compatible endpoint for drop-in replacement
@app.post("/v1/audio/transcriptions")
async def transcribe_openai_compat(
    file: UploadFile = File(...),
    model: str = Form("parakeet-tdt-0.6b-v3"),  # TODO(phase2): Route to different backends based on model param
):
    """OpenAI Whisper API-compatible endpoint."""
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
):
    """
    Generate speech from text using Pocket TTS.

    Args:
        text: The text to synthesize
        voice_id: Preset voice name or custom voice identifier
        reference_audio: Optional WAV file for zero-shot voice cloning

    Returns: audio/wav
    """
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

        if not clean_text:
            raise HTTPException(status_code=400, detail="No text to synthesize")

        # Get or create voice state
        if reference_audio:
            # Zero-shot cloning from uploaded audio
            audio_bytes = await reference_audio.read()
            if len(audio_bytes) > MAX_AUDIO_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=413, detail="Reference audio file too large"
                )
            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as tmp:
                tmp.write(audio_bytes)
                tmp_path = tmp.name

            try:
                voice_state = tts_model.get_state_for_audio_prompt(tmp_path)
                _cache_voice(voice_id, voice_state)
            finally:
                os.unlink(tmp_path)
            del audio_bytes

        elif voice_id in voice_cache:
            # Move to end for LRU eviction order
            voice_state = voice_cache.pop(voice_id)
            voice_cache[voice_id] = voice_state

        else:
            # Try loading as a preset name or HF path
            try:
                voice_state = tts_model.get_state_for_audio_prompt(voice_id)
                _cache_voice(voice_id, voice_state)
            except Exception:
                # Fall back to default
                voice_state = voice_cache.get("alba")
                if not voice_state:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Voice '{voice_id}' not found",
                    )

        # Generate audio
        audio_tensor = tts_model.generate_audio(voice_state, clean_text)
        audio_np = audio_tensor.numpy()

        # Convert to WAV bytes
        wav_buffer = io.BytesIO()
        scipy.io.wavfile.write(wav_buffer, tts_model.sample_rate, audio_np)
        wav_buffer.seek(0)
        wav_bytes = wav_buffer.read()

        # Cleanup
        del audio_tensor, audio_np
        gc.collect()

        return Response(content=wav_bytes, media_type="audio/wav")

    except HTTPException:
        raise
    except Exception as e:
        print(f"[TTS] Speech generation error: {e}")
        gc.collect()
        raise HTTPException(status_code=500, detail="Speech generation failed")


# OpenAI-compatible TTS endpoint
@app.post("/v1/audio/speech")
async def tts_openai_compat(
    input: str = Form(...),
    model: str = Form("pocket-tts"),  # TODO(phase2): Route to different backends based on model param
    voice: str = Form("alba"),
):
    """OpenAI-inspired TTS endpoint (uses Form fields, not JSON body).

    Not a true drop-in for the official OpenAI SDK — use /v1/tts for
    the native interface.
    """
    return await text_to_speech(text=input, voice_id=voice)


# ---------------------------------------------------------------------------
# Voice Management
# ---------------------------------------------------------------------------
@app.get("/v1/voices")
def list_voices():
    """List all available voices."""
    return {
        "voices": [
            {"id": vid, "type": "cached"} for vid in voice_cache.keys()
        ]
    }


@app.post("/v1/voices/register")
async def register_voice(
    voice_id: str = Form(...),
    audio: UploadFile = File(...),
):
    """
    Register a new voice from a reference audio file.
    The voice state is cached in memory for subsequent TTS requests.
    For persistent storage, save the audio file to the voices/ directory.
    """
    if not _VOICE_ID_RE.match(voice_id):
        raise HTTPException(
            status_code=400,
            detail="voice_id must contain only alphanumeric characters, hyphens, or underscores",
        )

    tts_model = models.get("tts")
    if not tts_model:
        raise HTTPException(status_code=503, detail="TTS model not loaded")

    try:
        audio_bytes = await audio.read()
        if len(audio_bytes) > MAX_AUDIO_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Audio file too large")

        # Save to voices directory for persistence across restarts
        voices_dir = os.environ.get("VOICES_DIR", "./voices")
        os.makedirs(voices_dir, exist_ok=True)
        ext = _AUDIO_EXTENSIONS.get(audio.content_type, _DEFAULT_AUDIO_EXT)
        voice_path = os.path.join(voices_dir, f"{voice_id}{ext}")

        with open(voice_path, "wb") as f:
            f.write(audio_bytes)

        # Create and cache voice state — clean up file on model failure
        try:
            voice_state = tts_model.get_state_for_audio_prompt(voice_path)
            _cache_voice(voice_id, voice_state)
        except Exception:
            os.unlink(voice_path)
            raise

        del audio_bytes
        gc.collect()

        return {"status": "ok", "voice_id": voice_id}

    except HTTPException:
        raise
    except Exception as e:
        print(f"[TTS] Voice registration error: {e}")
        gc.collect()
        raise HTTPException(status_code=500, detail="Voice registration failed")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
