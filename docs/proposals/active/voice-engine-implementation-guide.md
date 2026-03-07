# Tzurot Voice Engine Implementation Guide

## Status

| Phase   | Scope                                         | Status      |
| ------- | --------------------------------------------- | ----------- |
| Phase 1 | Python service + voice reference blob storage | COMPLETE    |
| Phase 2 | Python hardening + ai-worker STT integration  | COMPLETE    |
| Phase 3 | Bot-client TTS commands + Discord audio       | Not started |

### Phase 1 Checklist

- [x] Python voice-engine service (`services/voice-engine/`)
- [x] Database migration (`prisma/migrations/20260306230115_add_voice_reference_data/`)
- [x] Voice reference constants (`packages/common-types/src/constants/media.ts`)
- [x] Voice reference processor (`services/api-gateway/src/utils/voiceReferenceProcessor.ts`)
- [x] Voice reference serving route (`services/api-gateway/src/routes/public/voiceReferences.ts`)
- [x] Personality CRUD wiring (create, update, formatters, Zod schemas)

### Phase 1 Implementation Notes

- Voice reference audio stored as database blobs (like `avatarData`), 10MB cap, preserves original MIME type
- No optimization step (unlike avatars) — audio stored as-is
- Voice reference route at `GET /voice-references/:slug` (no filesystem cache, infrequent access)
- `hasVoiceReference` boolean added to `PersonalityFullSchema` response
- `voiceReferenceData` field added to `PersonalityCreateSchema` and `PersonalityUpdateSchema`
- `processMediaUploads()` helper extracted in update handler to keep complexity under lint threshold

### Phase 2 Checklist

- [x] Deferred Phase 1 nits: proxy pattern comment in `formatters.ts`, slug removed from 404 error in `voiceReferences.ts`
- [x] Python tooling: `pyproject.toml` (ruff, mypy, pytest), `requirements-dev.txt`
- [x] Type hints: Full `mypy --strict` compatible annotations in `server.py`
- [x] Structured logging: All `print()` replaced with stdlib `logging` + `_JsonFormatter`
- [x] pytest suite: `tests/conftest.py`, `test_health.py`, `test_transcribe.py`, `test_tts.py`, `test_voices.py`
- [x] Python standards: Added to `.claude/rules/02-code-standards.md`
- [x] Config: `VOICE_ENGINE_URL` + `VOICE_ENGINE_API_KEY` added to `envSchema` in common-types
- [x] VoiceEngineClient: HTTP client with `transcribe()`, `isHealthy()`, lazy singleton
- [x] AudioProcessor wiring: voice-engine as primary STT with Whisper fallback
- [ ] Docker build + local smoke test (`podman build`, `curl /health`)
- [ ] Railway deployment: Create service, set env vars, verify

### Phase 2 Implementation Notes

- **VoiceEngineClient** uses native `POST /v1/transcribe` endpoint (not OpenAI-compatible) for richer metadata
- Client is a lazy singleton created from config on first access via `getVoiceEngineClient()`
- Returns `null` when `VOICE_ENGINE_URL` is not configured — dev environments work unchanged
- AudioProcessor orchestration: Redis cache → voice-engine → Whisper fallback
- Extracted `fetchAudioBuffer()`, `transcribeWithVoiceEngine()`, `transcribeWithWhisper()` helpers
- Python test suite uses `httpx.ASGITransport` for in-process FastAPI testing (no real server)
- NeMo/Pocket TTS models mocked via `unittest.mock.patch` on the `models` global dict
- Structured logging uses `_JsonFormatter` for Railway log aggregation compatibility

### Phase 3 Entry Points

- **Bot-client TTS integration** — `POST /v1/tts` for generating speech, sending as Discord audio attachment
- **TTS filesystem cache + BullMQ cleanup job** — 1-hour TTL for generated audio files
- **Voice registration slash commands** — `/voice register`, `/voice list`, `/voice remove`
- **ElevenLabs premium tier** — BYOK for higher-quality voices

### Python Standards Lessons Learned (from Phase 1 PR Review)

These patterns were caught during PR review of `server.py` and codified in `.claude/rules/02-code-standards.md` (Python Standards section) during Phase 2:

| Pattern                           | Problem                                                                                                                                  | Standard                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **`except HTTPException: raise`** | Generic `except Exception` swallows FastAPI's HTTPException (e.g., 413 becomes 500). Always re-raise HTTPException before the catch-all. | Every `try/except Exception` in a FastAPI endpoint MUST have `except HTTPException: raise` first.             |
| **Temp file cleanup**             | `tempfile.NamedTemporaryFile(delete=False)` leaks files if processing fails.                                                             | Always wrap in `try/finally` with `os.unlink()`.                                                              |
| **Persistent file cleanup**       | Files saved to disk before model processing may be orphaned on failure.                                                                  | Use `try/except` with `os.unlink()` when writing files that are only valid if subsequent processing succeeds. |
| **Input size limits**             | Unbounded uploads cause OOM on Railway's 4GB ceiling.                                                                                    | All upload endpoints MUST check `len(bytes) > MAX_*_BYTES` before processing.                                 |
| **Text length caps**              | Long TTS text causes CPU OOM during inference.                                                                                           | Cap text input length before passing to model.                                                                |
| **Path traversal (CWE-22)**       | User-supplied IDs used in file paths enable directory traversal.                                                                         | Validate IDs with `^[a-zA-Z0-9_-]+$` regex before any filesystem operations.                                  |
| **MIME-to-extension mapping**     | Hardcoding `.wav` loses the original format, potentially confusing format-aware models.                                                  | Use a MIME→extension dict with a safe default.                                                                |
| **Dependency pinning**            | Unpinned major versions allow breaking changes.                                                                                          | Pin upper bounds on all deps: `>=X.Y.Z,<(X+1).0.0`.                                                           |
| **Constants placement**           | Constants defined after the functions that use them are harder to find.                                                                  | All module-level constants at the top, after imports.                                                         |

**Tooling to enforce these**: ruff catches some (unused imports, complexity), but most are domain-specific patterns enforced through code review. Standards codified in `.claude/rules/02-code-standards.md` (Python Standards section).

## CRITICAL WARNINGS — Read Before Implementing

1. **Do NOT reference any Gemini-generated code for Pocket TTS.** Prior research chats produced fabricated API names like `from kyutai import PocketTTS`, `PocketTTS.from_pretrained()`, and `from moshi.tts import TTSGenerator`. These do not exist. The correct library is `pocket_tts` with `TTSModel.load_model()` — see Part 2 for the real API.

2. **Do NOT confuse Kyutai Pocket TTS with Kyutai Moshi.** Moshi is a separate speech-to-speech conversational model. Pocket TTS is the text-to-speech model with voice cloning. They share an organization but are completely different products with different APIs.

3. **Do NOT reference SenseVoice or FunASR for STT.** Earlier research suggested SenseVoice (Alibaba) for STT. We are using NVIDIA Parakeet TDT instead — it has better punctuation handling which is the primary requirement.

4. **Do NOT use Kokoro for TTS.** Kokoro (82M) was considered but rejected because it has zero voice cloning capability. It only supports preset voices. We need actual zero-shot cloning.

5. **There is no OpenAI dependency anywhere in this stack.** Do not add OpenAI API calls as a fallback. The self-hosted tier uses Parakeet TDT + Pocket TTS. The premium tier uses ElevenLabs for both STT and TTS.

6. **`nemo_toolkit[asr]` is a large package (~1.2 GB+).** The final Docker image is approximately **4-6 GB** due to PyTorch (CPU), NeMo, and Pocket TTS. First build takes 10-20 minutes; subsequent builds are faster with Docker layer caching. If image size becomes problematic, consider a multi-stage Docker build that separates dependency installation from application code.

7. **Pocket TTS is English-only.** It cannot synthesize speech in other languages. This is acceptable for Tzurot's current requirements.

8. **Parakeet TDT v3 supports 25 European languages** with automatic language detection. No configuration needed — it will transcribe whatever language the user speaks. However, since Pocket TTS only speaks English, the practical pipeline is English-centric.

9. **`espeak-ng` may be a required system dependency** for Pocket TTS (used for phonemization). Not confirmed in the official README, but included defensively in the Dockerfile via `apt-get install espeak-ng`.

10. **Railway has no GPU.** All inference runs on CPU. Both models selected for this guide are specifically optimized for CPU inference. Do not attempt to use CUDA or GPU-dependent models.

11. **Voice state caching is critical for Pocket TTS performance.** `TTSModel.load_model()` and `get_state_for_audio_prompt()` are slow operations. The model and all voice states must be loaded once at startup and cached in memory. Never reload them per-request.

12. **Memory management matters.** Both models together consume ~3-4 GB RAM. Delete intermediate tensors and call `gc.collect()` after each request to prevent memory creep. The server.py implementation in this guide already handles this.

13. **The ElevenLabs model IDs have non-obvious naming.** The STT model is `scribe_v1` (not `scribe_v2` — the "v2" refers to the product version, the API model ID is `scribe_v1`). The TTS model is `eleven_v3`.

14. **Pocket TTS expects file paths, not byte streams,** for reference audio in `get_state_for_audio_prompt()`. When accepting uploaded audio, write to a temp file first, create the voice state, then delete the temp file. The server.py in this guide handles this pattern.

15. **Enable Railway Serverless mode on voice-engine from day one.** This is critical for cost control. Without it, the voice-engine runs 24/7 and costs ~$38-40/month in memory alone. With Serverless enabled, it sleeps after 10 minutes of no outbound traffic and costs $3-8/month for typical early-stage usage. The tradeoff is a 30-60 second cold start on the first voice request after idle. See Part 6 for full details.

16. **Do NOT poll the voice-engine health endpoint from ai-worker.** Any periodic health check or keepalive ping over the private network counts as outbound traffic from voice-engine's perspective and will prevent Railway from putting it to sleep. Only call voice-engine when an actual voice request comes in. The ai-worker should handle connection failures gracefully (the service may be asleep) and retry after a delay.

---

## Project Context

Tzurot is an AI chatbot platform with 90+ character cards. It is a pnpm monorepo deployed on Railway with services in `services/` (including `ai-worker`, `bot-client`, `api-gateway`). The existing services are TypeScript/Node.js.

The new `voice-engine` service is Python/FastAPI and lives alongside the existing TypeScript services as `services/voice-engine/`. It is built and deployed independently via its own Dockerfile. pnpm will ignore it (no `package.json`). Railway deploys it by pointing a new service at the `services/voice-engine/` root directory.

The `ai-worker` service communicates with `voice-engine` over Railway's internal private network via HTTP.

---

## Architecture Overview

Tzurot needs a two-tier voice system for both Speech-to-Text (STT) and Text-to-Speech (TTS):

| Tier                   | STT                  | TTS               |
| ---------------------- | -------------------- | ----------------- |
| **Free (self-hosted)** | Parakeet TDT 0.6B v3 | Kyutai Pocket TTS |
| **Premium (BYOK)**     | ElevenLabs Scribe v2 | ElevenLabs v3     |

Users who bring their own ElevenLabs API key get premium quality for both STT and TTS through a single provider. Free-tier users get self-hosted models running on Railway CPU.

### Deployment Topology

The self-hosted voice models run as a **Python microservice** (`voice-engine`) alongside the existing TypeScript services. This service communicates with `ai-worker` over Railway's private network. **It runs in Serverless mode** — Railway sleeps the container after 10 minutes of inactivity and wakes it on the next incoming request. This reduces costs from ~$40/month to $3-8/month for typical usage, at the cost of a 30-60 second cold start after idle periods.

```
┌─────────────────────────────────────────────────┐
│ Railway Project                                  │
│                                                  │
│  ┌──────────────┐    ┌───────────────────────┐  │
│  │  bot-client   │───▶│     ai-worker          │  │
│  │  (Discord)    │    │  (TypeScript)          │  │
│  └──────────────┘    │                         │  │
│                       │  Routes to either:      │  │
│                       │  • voice-engine (free)  │  │
│                       │  • ElevenLabs API (BYOK)│  │
│                       └──────────┬──────────────┘  │
│                                  │ (on-demand only, │
│                                  │  no polling!)    │
│                       ┌──────────▼──────────────┐  │
│                       │    voice-engine          │  │
│                       │    (Python/FastAPI)      │  │
│                       │    [SERVERLESS MODE]     │  │
│                       │                         │  │
│                       │  POST /v1/transcribe    │  │
│                       │  POST /v1/tts           │  │
│                       │  GET  /health           │  │
│                       └─────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Part 1: Self-Hosted STT — Parakeet TDT 0.6B v3 (Reference — Phase 1)

### Why This Model

- **Native punctuation and capitalization** — trained into the model, not post-processing. This directly solves the Whisper "wall of text" problem.
- **6.05% WER** — beats Whisper Large v3 at less than half the parameters
- **30x faster than real-time on CPU** via ONNX INT8 quantization
- **~2 GB RAM** footprint
- **25 European languages** with auto-detection (v3 multilingual upgrade)
- **License:** CC-BY-4.0

### Model Details

- **Model ID:** `nvidia/parakeet-tdt-0.6b-v3`
- **HuggingFace:** https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
- **Architecture:** FastConformer encoder + Token-and-Duration Transducer (TDT) decoder
- **Format:** Use ONNX INT8 quantized version for CPU deployment

### Installation

```bash
pip install nemo_toolkit[asr] onnxruntime
```

Or for the ONNX-optimized version:

```bash
pip install huggingface_hub onnxruntime numpy soundfile
```

### Key Constraint

Parakeet TDT processes audio in chunks. For audio longer than ~4-5 minutes, you must chunk the input. For typical Discord voice messages (under 2 minutes), this is not an issue.

### Python Implementation

```python
import nemo.collections.asr as nemo_asr
import soundfile as sf
import io
import numpy as np

# Load model once at startup
# This downloads ~1.2GB on first run
asr_model = nemo_asr.models.ASRModel.from_pretrained(
    model_name="nvidia/parakeet-tdt-0.6b-v3"
)

# For CPU inference, ensure model is on CPU
asr_model = asr_model.cpu()
asr_model.eval()


async def transcribe_audio(audio_bytes: bytes) -> str:
    """
    Transcribe audio bytes to text with native punctuation.
    Accepts WAV, FLAC, or OGG input.
    Returns properly punctuated, capitalized text.
    """
    # Convert bytes to numpy array
    audio_array, sample_rate = sf.read(io.BytesIO(audio_bytes))

    # Parakeet expects 16kHz mono
    if sample_rate != 16000:
        import librosa
        audio_array = librosa.resample(
            audio_array, orig_sr=sample_rate, target_sr=16000
        )

    # If stereo, convert to mono
    if len(audio_array.shape) > 1:
        audio_array = np.mean(audio_array, axis=1)

    # Transcribe - returns list of strings
    transcriptions = asr_model.transcribe([audio_array])

    # transcriptions is a list; first element is our result
    return transcriptions[0] if transcriptions else ""
```

### Alternative: Pre-built Docker Image

There is a community Docker image with an OpenAI-compatible API wrapper:

- **Image:** `groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai`
- **GitHub:** https://github.com/groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai

This provides a drop-in replacement for OpenAI's `/v1/audio/transcriptions` endpoint. If the existing codebase already calls OpenAI's Whisper API, using this image means minimal code changes — just swap the base URL.

```python
# If using the Docker image, the API is OpenAI-compatible:
import httpx

async def transcribe_via_api(audio_bytes: bytes, filename: str = "audio.wav") -> str:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{VOICE_ENGINE_URL}/v1/audio/transcriptions",
            files={"file": (filename, audio_bytes, "audio/wav")},
            data={"model": "parakeet-tdt-0.6b-v3"},
            timeout=30.0
        )
        return response.json()["text"]
```

---

## Part 2: Self-Hosted TTS — Kyutai Pocket TTS (Reference — Phase 1)

### Why This Model

- **True zero-shot voice cloning** from a 5-10 second audio sample
- **100M parameters** — extremely lightweight
- **Real-Time Factor ~0.17 on CPU** (generates 6x faster than real-time)
- **~1.5-2 GB RAM** footprint
- **Voice similarity scores** that beat F5-TTS and match models 10-20x its size
- **228 donated voices** available on HuggingFace as presets
- **License:** MIT

### Model Details

- **Library:** `pocket-tts` (PyPI package)
- **GitHub:** https://github.com/kyutai-labs/pocket-tts
- **HuggingFace model:** `kyutai/pocket-tts`
- **HuggingFace voices:** `kyutai/tts-voices` (228 CC0 voices)
- **Requires:** Python 3.10-3.14, PyTorch 2.5+ (CPU version is fine)

### Installation

```bash
pip install pocket-tts
# PyTorch CPU-only to save ~2GB image size:
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
```

Or via uv (recommended by Kyutai, handles deps automatically):

```bash
uv pip install pocket-tts
```

### CRITICAL: Correct API Usage

**Do NOT use the patterns from any Gemini-generated code.** There is no `from kyutai import PocketTTS` or `PocketTTS.from_pretrained()`. The actual API is:

```python
from pocket_tts import TTSModel
import scipy.io.wavfile

# Load model once at startup (~1.2GB download on first run)
tts_model = TTSModel.load_model()

# Create a voice state from a reference audio file (voice cloning)
voice_state = tts_model.get_state_for_audio_prompt("./reference_voice.wav")

# Or use a preset voice name
voice_state = tts_model.get_state_for_audio_prompt("alba")

# Or load from HuggingFace voice collection
voice_state = tts_model.get_state_for_audio_prompt(
    "hf://kyutai/tts-voices/expresso/ex01-ex02_default_001_channel2_198s.wav"
)

# Generate audio
audio = tts_model.generate_audio(voice_state, "Hello world, this is a test.")

# audio is a 1D torch tensor containing PCM data
scipy.io.wavfile.write("output.wav", tts_model.sample_rate, audio.numpy())
```

### Key API Notes

- `TTSModel.load_model()` and `get_state_for_audio_prompt()` are **slow operations**. Cache the model and voice states in memory.
- You can maintain **multiple voice states simultaneously** for different characters.
- Voice states can be created from: local `.wav` files, preset voice names (like `"alba"`), or HuggingFace URLs.
- The model handles English only.
- Generated audio is a 1D torch tensor of PCM float samples at `tts_model.sample_rate` (24000 Hz).

### Python Implementation for FastAPI

```python
from pocket_tts import TTSModel
import scipy.io.wavfile
import io
import gc
import numpy as np

# Load model once at startup
print("Loading Kyutai Pocket TTS...")
tts_model = TTSModel.load_model()
print(f"Pocket TTS loaded. Sample rate: {tts_model.sample_rate}")

# Cache for voice states (keyed by voice identifier)
voice_state_cache: dict[str, object] = {}

# Pre-load some default preset voices
DEFAULT_VOICES = ["alba", "bria"]  # Add more as needed
for voice_name in DEFAULT_VOICES:
    print(f"Pre-loading voice: {voice_name}")
    voice_state_cache[voice_name] = tts_model.get_state_for_audio_prompt(voice_name)


def get_or_create_voice_state(voice_id: str, audio_path: str | None = None):
    """Get cached voice state or create from audio file."""
    if voice_id in voice_state_cache:
        return voice_state_cache[voice_id]

    if audio_path:
        state = tts_model.get_state_for_audio_prompt(audio_path)
        voice_state_cache[voice_id] = state
        return state

    # Fallback to default
    return voice_state_cache.get("alba")


async def generate_speech(
    text: str,
    voice_id: str = "alba",
    reference_audio_bytes: bytes | None = None,
) -> bytes:
    """
    Generate speech audio from text.

    Args:
        text: The text to speak
        voice_id: Identifier for the voice (preset name or custom ID)
        reference_audio_bytes: Optional WAV bytes for zero-shot cloning

    Returns:
        WAV file bytes
    """
    try:
        # If reference audio provided, create a new voice state
        if reference_audio_bytes:
            # Write to temp file (pocket_tts expects a file path)
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                f.write(reference_audio_bytes)
                temp_path = f.name

            voice_state = tts_model.get_state_for_audio_prompt(temp_path)
            voice_state_cache[voice_id] = voice_state

            import os
            os.unlink(temp_path)
        else:
            voice_state = get_or_create_voice_state(voice_id)

        # Generate audio
        audio_tensor = tts_model.generate_audio(voice_state, text)

        # Convert to WAV bytes
        audio_np = audio_tensor.numpy()
        wav_buffer = io.BytesIO()
        scipy.io.wavfile.write(wav_buffer, tts_model.sample_rate, audio_np)
        wav_buffer.seek(0)
        wav_bytes = wav_buffer.read()

        # Cleanup
        del audio_tensor, audio_np
        gc.collect()

        return wav_bytes

    except Exception as e:
        gc.collect()
        raise e
```

### Community OpenAI-Compatible Server

There is also `pocket-tts-server` by @ai-joe-git that wraps Pocket TTS in an OpenAI-compatible API:

- **GitHub:** Search for `ai-joe-git/pocket-tts-server`
- Provides `/v1/audio/speech` endpoint compatible with OpenAI's TTS API format
- Supports voice cloning via reference audio upload

This could be used as an alternative to writing a custom FastAPI wrapper, but verify it's maintained and stable before depending on it.

---

## Part 3: Premium Tier — ElevenLabs (BYOK) (Phase 2+)

Users who provide their own ElevenLabs API key get access to both STT and TTS through ElevenLabs' API. This completely eliminates any OpenAI dependency.

### ElevenLabs STT: Scribe v2

**Endpoint:** `POST https://api.elevenlabs.io/v1/speech-to-text`

```typescript
interface ScribeRequest {
  model_id: 'scribe_v1'; // This is the correct model ID for Scribe v2
  file: File; // Audio file (multipart form upload)
  tag_audio_events?: boolean; // Detect [laughter], [sigh], etc.
  language_code?: string; // Optional language hint
}
```

**Implementation (TypeScript):**

```typescript
import FormData from 'form-data';

async function transcribeWithElevenLabs(
  audioBuffer: Buffer,
  apiKey: string,
  filename: string = 'audio.ogg'
): Promise<{ text: string; audioEvents?: string[] }> {
  const formData = new FormData();
  formData.append('file', audioBuffer, { filename });
  formData.append('model_id', 'scribe_v1');
  formData.append('tag_audio_events', 'true');

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      ...formData.getHeaders(),
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs Scribe error: ${response.status}`);
  }

  const result = await response.json();
  return {
    text: result.text,
    audioEvents: result.audio_events,
  };
}
```

**Key advantages over Whisper:**

- Native punctuation and formatting (no "wall of text" problem)
- `tag_audio_events=true` detects non-speech sounds like `[laughter]`, `[sigh]`, `[music]` — these can be passed to the LLM so the character reacts to the user's emotional state
- Built-in endpointing (knows when user has stopped talking vs. pausing)

### ElevenLabs TTS: v3 with Audio Tags

**Endpoint:** `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`

```typescript
interface ElevenLabsTTSRequest {
  text: string; // Text with optional audio tags
  model_id: 'eleven_v3'; // Use v3 for audio tag support
  voice_settings?: {
    stability: number; // 0.0-1.0
    similarity_boost: number; // 0.0-1.0
    style: number; // 0.0-1.0
    use_speaker_boost: boolean;
  };
  output_format?: string; // "mp3_44100_128" for high quality
}
```

**Implementation (TypeScript):**

```typescript
async function generateSpeechWithElevenLabs(
  text: string,
  voiceId: string,
  apiKey: string
): Promise<Buffer> {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_v3',
      output_format: 'mp3_44100_128',
    }),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS error: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
```

**v3 Audio Tags — the killer feature for Tzurot:**

ElevenLabs v3 supports inline "stage directions" that control how the voice performs:

```
[whisper] I am the depths of the ocean... [shouting] HEED ME!
[compassionate] Do not tremble, child. [firm] Failure is but a stepping stone.
[maniacal laugh] Did you really think you could escape?
[sad] I remember when things were different.
[slow] Listen... very... carefully.
```

**Integration with LLM prompting:** Add this to the character's system prompt so the LLM can "direct" the voice:

```
You can control the tone of your voice using tags like [whisper], [sad],
[shout], [slow], [laugh], [compassionate], [firm]. Use these tags inline
in your speech to enhance your presence and emotional range. These tags
will be interpreted by the voice engine.
```

When the character has an ElevenLabs voice configured, these tags get passed through to the TTS engine. When using Pocket TTS (free tier), strip the tags before synthesis since Pocket TTS doesn't support them.

### Voice Cloning Setup

ElevenLabs voice cloning uses a persistent "Voice" object:

1. **Instant Voice Clone (IVC):** Upload 1-5 short audio samples → get a `voice_id`
2. **Use that `voice_id`** with `model_id: "eleven_v3"` for all subsequent TTS calls
3. The voice and model are separate — old samples work with the new v3 engine

The `voice_id` should be stored per-character in Tzurot's database alongside the character configuration.

---

## Part 4: The Python Voice Engine Service (Phase 1)

### Folder Structure

```
services/voice-engine/
├── Dockerfile
├── requirements.txt
├── server.py
├── .dockerignore
└── voices/           # Directory for cached reference audio files
    └── .gitkeep
```

### requirements.txt

```
# Web framework
fastapi==0.115.0
uvicorn[standard]==0.34.0
python-multipart==0.0.18

# Audio processing
soundfile==0.12.1
scipy==1.14.0
librosa==0.10.2
numpy>=1.26,<2.0

# STT: Parakeet TDT
nemo_toolkit[asr]>=2.1.0

# TTS: Pocket TTS
pocket-tts>=1.1.0

# PyTorch CPU-only (saves ~2GB vs full CUDA build)
--extra-index-url https://download.pytorch.org/whl/cpu
torch>=2.5.0
torchaudio>=2.5.0
```

### server.py

```python
"""
Tzurot Voice Engine — Self-hosted STT + TTS microservice.

STT: NVIDIA Parakeet TDT 0.6B v3 (punctuation-aware transcription)
TTS: Kyutai Pocket TTS (zero-shot voice cloning on CPU)
"""

import gc
import io
import os
import tempfile
from contextlib import asynccontextmanager

import numpy as np
import scipy.io.wavfile
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

# ---------------------------------------------------------------------------
# Global model references (populated on startup)
# ---------------------------------------------------------------------------
models = {}
voice_cache = {}


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

        # Transcribe
        transcriptions = asr_model.transcribe([audio_array])
        text = transcriptions[0].text if transcriptions else ""

        # Cleanup
        del audio_bytes, audio_array
        gc.collect()

        return {"text": text}

    except Exception as e:
        gc.collect()
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")


# Also provide an OpenAI-compatible endpoint for drop-in replacement
@app.post("/v1/audio/transcriptions")
async def transcribe_openai_compat(
    file: UploadFile = File(...),
    model: str = Form("parakeet-tdt-0.6b-v3"),
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
        # Strip any ElevenLabs-style audio tags that might be in the text
        # (these are only supported by ElevenLabs v3, not Pocket TTS)
        import re

        clean_text = re.sub(
            r"\[(whisper|shout|shouting|laugh|sad|slow|fast|firm|"
            r"compassionate|maniacal laugh|angry|happy|excited)\]",
            "",
            text,
            flags=re.IGNORECASE,
        )
        clean_text = clean_text.strip()

        if not clean_text:
            raise HTTPException(status_code=400, detail="No text to synthesize")

        # Get or create voice state
        if reference_audio:
            # Zero-shot cloning from uploaded audio
            audio_bytes = await reference_audio.read()
            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as tmp:
                tmp.write(audio_bytes)
                tmp_path = tmp.name

            voice_state = tts_model.get_state_for_audio_prompt(tmp_path)
            voice_cache[voice_id] = voice_state  # Cache for future use
            os.unlink(tmp_path)
            del audio_bytes

        elif voice_id in voice_cache:
            voice_state = voice_cache[voice_id]

        else:
            # Try loading as a preset name or HF path
            try:
                voice_state = tts_model.get_state_for_audio_prompt(voice_id)
                voice_cache[voice_id] = voice_state
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
        gc.collect()
        raise HTTPException(
            status_code=500, detail=f"Speech generation failed: {e}"
        )


# OpenAI-compatible TTS endpoint
@app.post("/v1/audio/speech")
async def tts_openai_compat(
    input: str = Form(...),
    model: str = Form("pocket-tts"),
    voice: str = Form("alba"),
):
    """OpenAI TTS API-compatible endpoint."""
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
    tts_model = models.get("tts")
    if not tts_model:
        raise HTTPException(status_code=503, detail="TTS model not loaded")

    try:
        audio_bytes = await audio.read()

        # Save to voices directory for persistence across restarts
        voices_dir = os.environ.get("VOICES_DIR", "./voices")
        os.makedirs(voices_dir, exist_ok=True)
        voice_path = os.path.join(voices_dir, f"{voice_id}.wav")

        with open(voice_path, "wb") as f:
            f.write(audio_bytes)

        # Create and cache voice state
        voice_state = tts_model.get_state_for_audio_prompt(voice_path)
        voice_cache[voice_id] = voice_state

        del audio_bytes
        gc.collect()

        return {"status": "ok", "voice_id": voice_id}

    except Exception as e:
        gc.collect()
        raise HTTPException(
            status_code=500, detail=f"Voice registration failed: {e}"
        )


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
```

### Dockerfile

**Note:** This image will be ~5-8 GB due to PyTorch, NeMo, and model weights. First build takes 10-15 minutes. Use Docker layer caching aggressively — the `requirements.txt` COPY and `pip install` steps should be before the `COPY server.py` step so application code changes don't trigger a full rebuild.

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# System dependencies for audio processing
# curl is needed for the HEALTHCHECK command
RUN apt-get update && apt-get install -y \
    libsndfile1 \
    ffmpeg \
    espeak-ng \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only PyTorch first (saves ~2GB vs CUDA version)
RUN pip install --no-cache-dir \
    torch torchaudio \
    --index-url https://download.pytorch.org/whl/cpu

# Install remaining Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY server.py .

# Create voices directory
RUN mkdir -p /app/voices

# Default port (Railway will set PORT env var)
ENV PORT=8000
EXPOSE ${PORT}

# Health check — the 120s start-period accommodates model loading on cold boot.
# This is especially important with Railway Serverless mode, where the container
# starts from scratch each time it wakes from sleep.
HEALTHCHECK --interval=30s --timeout=30s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["python", "server.py"]
```

### .dockerignore

```
__pycache__
*.pyc
.git
.env
*.md
```

---

## Part 5: Integration with ai-worker (TypeScript) (Phase 2)

### VoiceService Interface

Create a service that routes to either the self-hosted engine or ElevenLabs based on user configuration.

```typescript
// services/ai-worker/src/services/voice/VoiceService.ts

export interface TranscriptionResult {
  text: string;
  audioEvents?: string[]; // ElevenLabs Scribe only: [laughter], [sigh], etc.
}

export interface VoiceConfig {
  elevenlabsApiKey?: string; // If present, use ElevenLabs (premium tier)
  elevenlabsVoiceId?: string; // ElevenLabs voice ID for TTS
  pocketTtsVoiceId?: string; // Pocket TTS voice ID for free tier
}

export class VoiceService {
  private engineUrl: string;

  // IMPORTANT: voice-engine runs in Railway Serverless mode.
  // It may be asleep when we call it. Railway holds TCP connections
  // while the container boots (30-60 seconds), so we need long timeouts.
  // Do NOT add periodic health checks or keepalive pings — they prevent sleeping.
  private static readonly COLD_START_TIMEOUT_MS = 90_000; // 90 seconds for cold boot
  private static readonly WARM_TIMEOUT_MS = 30_000; // 30 seconds when already running
  private static readonly RETRY_ATTEMPTS = 2;

  constructor() {
    // Internal Railway URL for the Python voice-engine service
    this.engineUrl = process.env.VOICE_ENGINE_URL || 'http://voice-engine.railway.internal:8000';
  }

  /**
   * Make a request to voice-engine with cold-start-aware timeout/retry.
   * Railway Serverless holds TCP connections during container boot, so the
   * first request after idle will take 30-60 seconds. We use a generous
   * timeout on first attempt, then retry once if it fails.
   */
  private async fetchEngine(
    path: string,
    init: RequestInit,
    attempt: number = 1
  ): Promise<Response> {
    const timeout =
      attempt === 1 ? VoiceService.COLD_START_TIMEOUT_MS : VoiceService.WARM_TIMEOUT_MS;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.engineUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (attempt < VoiceService.RETRY_ATTEMPTS) {
        // Service might have been mid-wake. Wait briefly and retry.
        await new Promise(r => setTimeout(r, 5_000));
        return this.fetchEngine(path, init, attempt + 1);
      }
      throw new Error(
        `voice-engine unreachable after ${VoiceService.RETRY_ATTEMPTS} attempts ` +
          `(is Serverless mode waking up?): ${error}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // ----- STT -----

  async transcribe(
    audioBuffer: Buffer,
    config: VoiceConfig,
    filename: string = 'audio.ogg'
  ): Promise<TranscriptionResult> {
    if (config.elevenlabsApiKey) {
      return this.transcribeWithElevenLabs(audioBuffer, config.elevenlabsApiKey, filename);
    }
    return this.transcribeWithParakeet(audioBuffer, filename);
  }

  private async transcribeWithParakeet(
    audioBuffer: Buffer,
    filename: string
  ): Promise<TranscriptionResult> {
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer]), filename);

    const response = await this.fetchEngine('/v1/transcribe', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Parakeet STT error: ${response.status}`);
    }

    const result = await response.json();
    return { text: result.text };
  }

  private async transcribeWithElevenLabs(
    audioBuffer: Buffer,
    apiKey: string,
    filename: string
  ): Promise<TranscriptionResult> {
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer]), filename);
    formData.append('model_id', 'scribe_v1');
    formData.append('tag_audio_events', 'true');

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs Scribe error: ${response.status}`);
    }

    const result = await response.json();
    return {
      text: result.text,
      audioEvents: result.audio_events,
    };
  }

  // ----- TTS -----

  async generateSpeech(text: string, config: VoiceConfig): Promise<Buffer> {
    if (config.elevenlabsApiKey && config.elevenlabsVoiceId) {
      return this.generateWithElevenLabs(text, config.elevenlabsVoiceId, config.elevenlabsApiKey);
    }
    return this.generateWithPocketTTS(text, config.pocketTtsVoiceId || 'alba');
  }

  private async generateWithPocketTTS(text: string, voiceId: string): Promise<Buffer> {
    const formData = new FormData();
    formData.append('text', text);
    formData.append('voice_id', voiceId);

    const response = await this.fetchEngine('/v1/tts', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Pocket TTS error: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async generateWithElevenLabs(
    text: string,
    voiceId: string,
    apiKey: string
  ): Promise<Buffer> {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text, // Audio tags like [whisper] pass through to v3
        model_id: 'eleven_v3',
        output_format: 'mp3_44100_128',
      }),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs TTS error: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // ----- Voice Registration -----

  async registerVoice(
    voiceId: string,
    audioBuffer: Buffer,
    filename: string = 'reference.wav'
  ): Promise<void> {
    const formData = new FormData();
    formData.append('voice_id', voiceId);
    formData.append('audio', new Blob([audioBuffer]), filename);

    const response = await this.fetchEngine('/v1/voices/register', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Voice registration error: ${response.status}`);
    }
  }
}
```

---

## Part 6: Railway Deployment (Phase 2)

### Adding the voice-engine Service

1. **Push the `services/voice-engine/` folder** to your repo.

2. **In Railway UI:**
   - New Service → GitHub Repo → select `tzurot`
   - **Settings → Root Directory:** `services/voice-engine`
   - Railway will detect the Dockerfile and build from it.

3. **Environment variables for voice-engine:**

   ```
   PORT=8000
   DEFAULT_VOICES=alba,bria
   VOICES_DIR=/app/voices
   ```

4. **Environment variables for ai-worker:**

   ```
   VOICE_ENGINE_URL=http://${{voice-engine.RAILWAY_PRIVATE_DOMAIN}}:8000
   ```

   (Use Railway's variable references to get the internal DNS name.)

5. **Resource configuration for voice-engine:**
   - **RAM:** 4 GB minimum (both models loaded simultaneously)
   - **CPU:** 2 vCPU recommended

### CRITICAL: Enable Railway Serverless Mode

This is the single most important cost optimization for voice-engine. Without it, the service runs 24/7 and memory alone costs ~$38-40/month. With it, the service sleeps when idle and you only pay for actual usage.

**How to enable:**

1. Open your project → voice-engine service → **Settings → Deploy → Serverless**
2. Toggle **"Enable Serverless"** on
3. Redeploy (Railway requires a redeploy after toggling this setting)

**How it works:**

- Railway monitors outbound traffic from your container using cAdvisor metrics
- After ~10 minutes with zero outbound traffic, Railway stops the container
- When the next request arrives (from ai-worker over the private network), Railway starts the container and holds the TCP connection open
- Once the container passes its health check, Railway forwards the queued request — no dropped connections
- While sleeping, the container incurs **zero compute charges** (no CPU, no memory billing). You only pay for storage (image + volumes)

**What prevents sleeping (critical gotchas):**

- Active database connections (connection poolers send keepalive packets)
- Framework telemetry (Next.js, etc. — not relevant for a FastAPI app)
- Periodic outbound HTTP calls (health checks TO other services, polling, etc.)
- Any request to external services or other Railway services

The voice-engine is ideal for Serverless because it's a pure request/response service with no outbound connections when idle. It doesn't connect to databases, doesn't phone home, doesn't poll anything. It just sits there waiting for requests.

**IMPORTANT: Do not poll voice-engine from ai-worker.** Any periodic health check, keepalive, or readiness probe from ai-worker to voice-engine over the private network counts as inbound traffic that wakes the service, and the health check response counts as outbound traffic that resets the 10-minute sleep timer. Only call voice-engine when an actual voice request comes in.

**Cold start expectations:**

When voice-engine wakes from sleep, it goes through the full startup sequence:

1. Container starts (~2-5 seconds)
2. Python process initializes FastAPI (~1-2 seconds)
3. Parakeet TDT model loads into memory (~10-20 seconds for ~1.2 GB)
4. Pocket TTS model loads into memory (~10-15 seconds for ~1.2 GB)
5. Default voice states are pre-cached (~5-10 seconds)

**Total cold start: 30-60 seconds.** Railway holds the incoming request during this entire period and delivers it once the health check passes.

The ai-worker TypeScript code must handle this gracefully — see Part 5 for timeout and retry configuration. The frontend/Discord should show a "warming up voice..." status to the user during cold boot.

### Estimated Railway Costs

Based on actual per-unit rates from a February 2026 Railway Pro invoice ($0.00000023148/MB/min for memory):

**voice-engine costs by usage pattern:**

| Scenario                        | Active hours/day | Monthly memory cost | Monthly total (w/ CPU) |
| ------------------------------- | ---------------- | ------------------- | ---------------------- |
| Always-on (Serverless OFF)      | 24               | ~$40                | ~$42                   |
| Heavy use                       | 8                | ~$13                | ~$15                   |
| Moderate use                    | 4-5              | ~$7-8               | ~$9-10                 |
| Light use (typical early-stage) | 2-3              | ~$3-5               | ~$5-6                  |
| Barely used                     | <1               | ~$1-2               | ~$2-3                  |

**Projected total monthly Railway bill (existing services + voice-engine):**

| Scenario                        | Existing usage | voice-engine | Pro plan | Credit | You pay  |
| ------------------------------- | -------------- | ------------ | -------- | ------ | -------- |
| Without voice (current)         | ~$25           | —            | $20      | -$20   | **~$25** |
| Voice, Serverless ON, light use | ~$25           | ~$5          | $20      | -$20   | **~$30** |
| Voice, Serverless ON, moderate  | ~$25           | ~$10         | $20      | -$20   | **~$35** |
| Voice, Serverless OFF (24/7)    | ~$25           | ~$42         | $20      | -$20   | **~$67** |

**Recommendation:** Enable Serverless from day one. Switch to always-on only if voice becomes a core high-traffic feature where the 30-60 second cold start is unacceptable.

### Persistent Voice Storage

Railway containers have ephemeral filesystems. For voice files to persist across deploys:

**Option A: Railway Volumes** (simplest)

- Attach a volume to `/app/voices` in the voice-engine service
- Voice files survive restarts and deploys
- Cost: $0.15/GB/month (negligible for voice reference files)
- **Note:** When Serverless mode sleeps the container, volumes remain attached and preserved. They are available immediately when the container wakes.

**Option B: External Storage (S3/R2)**

- Store reference audio in Cloudflare R2 or AWS S3
- Download to local cache on startup
- More complex but better for backup/portability
- **Note:** Adds to cold start time when waking from sleep (must re-download voices)

---

## Part 7: Integration Notes for LLM Prompting (Phase 3)

### Audio Tags in System Prompts

When a character is configured with ElevenLabs v3, add this to the character's LLM system prompt:

```
You can control the delivery of your speech using inline tags:
[whisper], [shout], [laugh], [sad], [slow], [fast], [firm],
[compassionate], [angry], [excited]

Use these naturally within your speech to convey emotion.
Example: "[compassionate] Do not fear, child. [firm] But you must act now."
```

When using Pocket TTS (free tier), these tags are automatically stripped by the voice engine before synthesis. The LLM doesn't need to know which tier is active — it can always include tags, and they'll either be rendered (ElevenLabs) or stripped (Pocket TTS).

### Passing Audio Events to the LLM

When ElevenLabs Scribe detects audio events (`[laughter]`, `[sigh]`), prepend them to the user's message before sending to the LLM:

```
[User audio context: laughter detected]
User: That was hilarious!
```

This gives the character context about the user's emotional state, enabling more natural responses.

---

## Summary: Complete API Surface

### voice-engine (Python, self-hosted)

| Endpoint                   | Method | Purpose                        |
| -------------------------- | ------ | ------------------------------ |
| `/health`                  | GET    | Health check with model status |
| `/v1/transcribe`           | POST   | STT via Parakeet TDT           |
| `/v1/audio/transcriptions` | POST   | OpenAI-compatible STT endpoint |
| `/v1/tts`                  | POST   | TTS via Pocket TTS             |
| `/v1/audio/speech`         | POST   | OpenAI-compatible TTS endpoint |
| `/v1/voices`               | GET    | List loaded voices             |
| `/v1/voices/register`      | POST   | Register new voice from audio  |

### ElevenLabs (premium, external)

| Endpoint                             | Purpose                    |
| ------------------------------------ | -------------------------- |
| `POST /v1/speech-to-text`            | STT via Scribe v2          |
| `POST /v1/text-to-speech/{voice_id}` | TTS via v3 with audio tags |

### Routing Logic

```
User has ElevenLabs API key?
  ├── YES → Use ElevenLabs for both STT and TTS
  └── NO  → Use voice-engine for both STT and TTS
```

No OpenAI dependency anywhere in the stack.

---

## Part 8: Testing & Validation (Phase 1 — smoke tests; Phase 2 — integration tests)

### Local Development Without Railway

The voice-engine can be developed and tested locally:

```bash
cd services/voice-engine

# Create a virtualenv
python3.11 -m venv .venv
source .venv/bin/activate

# Install CPU-only PyTorch first
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# Install remaining deps
pip install -r requirements.txt

# Run the server
python server.py
```

First run will download both models (~2.5 GB total). Subsequent starts use cached weights.

### Smoke Tests

After the server is running, verify both pipelines:

```bash
# Health check
curl http://localhost:8000/health

# STT test (provide any WAV/OGG file)
curl -X POST http://localhost:8000/v1/transcribe \
  -F "file=@test_audio.wav"

# TTS test with preset voice
curl -X POST http://localhost:8000/v1/tts \
  -F "text=Hello, this is a test of the Tzurot voice engine." \
  -F "voice_id=alba" \
  --output test_output.wav

# TTS test with voice cloning
curl -X POST http://localhost:8000/v1/tts \
  -F "text=I am speaking in a cloned voice." \
  -F "voice_id=custom_test" \
  -F "reference_audio=@reference_sample.wav" \
  --output cloned_output.wav

# List loaded voices
curl http://localhost:8000/v1/voices
```

### What to Verify

- STT output has proper punctuation and capitalization (the whole point of choosing Parakeet over Whisper)
- TTS with preset voice returns audible WAV
- TTS with reference audio produces speech resembling the reference voice
- Audio tags like `[whisper]` and `[shout]` are stripped cleanly from TTS input (check the output doesn't contain spoken tag names)
- Memory usage stays stable after multiple requests (watch for leaks)
- Voice registration endpoint persists voices to the `voices/` directory

### Docker Build Test

```bash
cd services/voice-engine
docker build -t tzurot-voice-engine .

# First build will be slow (~10-15 min) due to PyTorch and NeMo downloads
# Subsequent builds use Docker layer cache

docker run -p 8000:8000 -e PORT=8000 tzurot-voice-engine
```

---

## Part 9: Known Limitations & Future Considerations

### Current Limitations

- **Pocket TTS is English-only.** If multilingual TTS is needed in the future, NeuTTS Air (748M params, Apache 2.0, GGUF quantized, ~400-600 MB RAM) is the best CPU-compatible alternative with voice cloning. It also supports instant cloning from 3s samples.
- **Pocket TTS has no expressive/emotional control.** Unlike ElevenLabs v3 audio tags, Pocket TTS reads text in a neutral style matching the reference voice's affect. It cannot whisper, shout, or modulate emotion on demand.
- **Audio length limits for STT.** Parakeet TDT works best on audio under ~5 minutes. For longer audio, implement chunking with overlap. Typical Discord voice messages are well under this limit.
- **No streaming TTS.** The current implementation generates the full audio before returning. For long text, this means the user waits. ElevenLabs supports streaming; Pocket TTS does not have a streaming API yet.
- **Voice state persistence is filesystem-based.** If Railway's volume is lost, registered voices need to be re-uploaded. Consider backing up the `voices/` directory to S3/R2 for durability.
- **Cold start time with Serverless mode.** Loading both models takes 30-60 seconds. When voice-engine wakes from Railway Serverless sleep, the first voice request will experience this full delay. The Dockerfile HEALTHCHECK has a 120-second `start-period` to accommodate this. Railway holds incoming TCP connections during boot and delivers them once the health check passes — no dropped requests, just latency. The TypeScript VoiceService uses a 90-second timeout on first attempt to handle this gracefully.
- **Railway Serverless sleep timer is fixed at ~10 minutes.** You cannot configure a shorter or longer idle period. If voice-engine handles a request, it stays awake for at least 10 minutes after the last response (subsequent requests during this window are fast). Plan UX accordingly — batch voice interactions when possible.
- **Private network traffic wakes sleeping services.** Any request from ai-worker to voice-engine over Railway's private network will wake the service. This is the intended trigger mechanism, but it means you must avoid periodic polling, health checks, or keepalive pings from ai-worker to voice-engine.

### Potential Future Upgrades

- **NeuTTS Air** as a drop-in replacement for Pocket TTS if multilingual or better quality is needed. Uses GGUF quantization via llama.cpp — very different architecture but same basic API pattern.
- **Chatterbox Turbo** (350M, MIT, by Resemble AI) if GPU becomes available. Supports paralinguistic tags (`[laugh]`, `[cough]`), beats ElevenLabs in blind tests at 63.75% preference rate. English-only but has a multilingual variant for 23 languages.
- **Qwen3-TTS** (0.6-1.7B, Apache 2.0, by Alibaba) for highest-quality open-source cloning. Requires GPU or very beefy CPU (3-5x slower than real-time on high-end CPU). 3-second voice cloning.
- **Streaming TTS** if Pocket TTS adds streaming support or if switching to a model that supports it.
