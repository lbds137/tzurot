# Chatterbox Turbo TTS Evaluation

Replace Pocket TTS with [Chatterbox Turbo](https://github.com/resemble-ai/chatterbox) in the Python voice-engine for higher quality voice cloning and paralinguistic tag support.

**Status**: Backlogged. Only evaluate after ElevenLabs BYOK (Phase 4) is done and tested.

## Motivation

Chatterbox Turbo offers:

- Higher quality voice cloning (350M LLaMA backbone vs Pocket TTS's 100M)
- Native paralinguistic tags (`[laugh]`, `[cough]`, `[chuckle]`) that overlap with ElevenLabs audio tags
- MIT licensed (same as Pocket TTS)

## Scope

Only `services/voice-engine/` changes — the TypeScript side is fully decoupled via the HTTP API.

| File                                     | Change                                                               |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `services/voice-engine/requirements.txt` | Replace `pocket-tts` with `chatterbox-tts` (or ONNX variant)         |
| `services/voice-engine/server.py`        | Replace Pocket TTS model loading and inference with Chatterbox Turbo |
| `services/voice-engine/Dockerfile`       | May need different system deps, likely larger image                  |

## Key Unknowns (Must Test Before Committing)

### 1. CPU Inference Speed

Someone on Discord reports ~1 min for 1-2 min of audio on their VPS, but hardware specs unknown. Railway's 2 vCPU allocation may be slower. If RTF > 3.0 (slower than 3x real-time), Pocket TTS is better for this use case.

### 2. Memory Footprint

Current voice-engine uses **9GB** (not the 4GB originally estimated). Chatterbox Turbo's 350M params vs Pocket TTS's 100M could push to 11-13GB, increasing Serverless wake time and per-minute Railway costs.

The ONNX Q4 variant reduces the LLM from 2GB to 350MB — likely required to stay reasonable.

### 3. ONNX vs PyTorch

The standard `chatterbox-tts` pip package uses PyTorch and expects CUDA. The ONNX variant (`ResembleAI/chatterbox-turbo-ONNX` on HuggingFace) is the CPU path but has a different API:

**Pocket TTS (current — clean 3-line API):**

```python
from pocket_tts import TTSModel
model = TTSModel.load_model()
state = model.get_state_for_audio_prompt("reference.wav")
audio = model.generate_audio(state, "Hello world")
```

**Chatterbox Turbo PyTorch (GPU-focused — NOT suitable):**

```python
from chatterbox.tts_turbo import ChatterboxTurboTTS
model = ChatterboxTurboTTS.from_pretrained(device="cuda")
wav = model.generate("Hello [laugh] world", audio_prompt_path="reference.wav")
```

**Chatterbox Turbo ONNX (CPU path — use this one):**

```python
# Different API entirely — raw ONNX runtime, no pip package convenience
# See: https://huggingface.co/ResembleAI/chatterbox-turbo-ONNX
# Uses onnxruntime + manual tokenization + manual audio decoding
# Community wrapper: https://github.com/Olzeke51/chatterbox-onnxZ
```

The ONNX path is significantly more code than Pocket TTS's clean 3-line API.

### 4. PerTh Watermark

All Chatterbox output has an imperceptible neural watermark. Technically removable (MIT license, community forks exist) but adds complexity. Evaluate whether this matters for Tzurot.

### 5. Audio Tag Compatibility

Current `_AUDIO_TAG_RE` in `server.py` strips ElevenLabs-style tags. Chatterbox supports its own tags (`[laugh]`, `[cough]`, `[chuckle]`) — these overlap but aren't identical to the ElevenLabs set. The regex would need updating to pass through Chatterbox-compatible tags while stripping unsupported ones.

## Evaluation Path

1. **Local test first** — don't deploy to Railway until local benchmarks pass
2. Install `chatterbox-tts` in a venv, run ONNX inference on CPU, measure RTF and memory
3. If RTF > 3.0 → stop, Pocket TTS is better for this use case
4. If RTF acceptable → swap into `server.py` and test full API surface
5. Deploy to Railway staging, test under Railway's resource constraints
6. Only merge if both quality and latency improve over Pocket TTS

## Resource Usage Context

Actual measured usage (corrects earlier estimates):

| Scenario                          | Monthly memory cost |
| --------------------------------- | ------------------- |
| Always-on (Serverless OFF)        | ~$90/month (9GB)    |
| ~5 hrs/day active (Serverless ON) | ~$19/month          |
| ~2-3 hrs/day active               | ~$8-12/month        |
| Barely used                       | ~$3-5/month         |

The `server.py` comments referencing a "4GB ceiling" (`_INFERENCE_CONCURRENCY` semaphore, `MAX_TTS_TEXT_LENGTH`, etc.) should be updated to reflect the actual 9GB footprint.

Adding Chatterbox alongside Parakeet TDT could push 9GB → 11-13GB. ONNX Q4 variant would help control this.
