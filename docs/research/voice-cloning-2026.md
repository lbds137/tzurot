# Open-Source Voice Cloning Research

> **Date**: 2026-01-24
> **Source**: Gemini consultation (2026-01-22)
> **Status**: Active - implementation deferred (Later roadmap)

## TL;DR

Zero-shot voice cloning is now possible on CPU. **TTS**: Kyutai Pocket TTS (100M params, ~1GB RAM idle, 2-4GB active). **STT**: SenseVoice (emotion detection + punctuation, replaces Whisper). Both run in a Python microservice at `services/voice-engine/`. Two-tier model: free users get open-source, premium users BYOK ElevenLabs.

## Architecture

```
services/voice-engine/          # Python FastAPI service
├── Dockerfile
├── requirements.txt
├── server.py
└── .dockerignore

Endpoints:
  POST /v1/clone          # TTS - text + reference audio → cloned voice
  POST /v1/transcribe     # STT - audio → text with emotion tags
  GET  /health
```

**Integration**: TypeScript services call via HTTP (internal Railway network).

## TTS: Kyutai Pocket TTS

**Why**: First model to achieve all three: Quality + Speed + CPU-only.

| Aspect       | Details                                                |
| ------------ | ------------------------------------------------------ |
| Model Size   | 100M parameters                                        |
| RAM (Idle)   | ~1.1 GB                                                |
| RAM (Active) | 2-4 GB (has memory leak, needs explicit gc.collect())  |
| Latency      | 2-4 seconds for 10-second audio on Railway CPU         |
| Quality      | 90% timbre accuracy, less "theatrical" than ElevenLabs |

**Hyperparameters**:

- `cfg_guidance`: 1.5-3.0 (controls voice vs text adherence)

**Known Issues**:

- Memory leak in reference implementation - must call `gc.collect()` after each request
- Railway recommendation: 4GB RAM allocation

## STT: SenseVoice (Alibaba)

**Why**: Emotion detection + proper punctuation (fixes Whisper's "wall of text" problem).

| Aspect   | Details                                              |
| -------- | ---------------------------------------------------- | --- | --- | ----- | --------------- |
| Model    | `iic/SenseVoiceSmall` (~500MB)                       |
| Output   | `<                                                   | en  | ><  | HAPPY | > Hello world.` |
| Features | Language detection, ITN (inverse text normalization) |

**Emotion Tags**: `HAPPY`, `SAD`, `ANGRY`, `NEUTRAL`

**For Tzurot**: Feed emotion metadata to LLM so personalities can react to user mood.

## Railway Deployment

```yaml
# Service config
Root Directory: services/voice-engine
Resources: 4GB RAM, 2 vCPU
Port: 8000
```

**Connection**:

```bash
# ai-worker environment variable
VOICE_ENGINE_URL=http://${{ voice-engine.RAILWAY_PRIVATE_DOMAIN }}:8000
```

## Requirements

```txt
fastapi==0.109.0
uvicorn[standard]==0.27.0
python-multipart==0.0.6
--extra-index-url https://download.pytorch.org/whl/cpu
torch==2.2.0
torchaudio==2.2.0
funasr==1.0.0
modelscope
moshi-b  # or kyutai depending on package name
scipy
soundfile
numpy
```

## Alternatives Considered

| Model      | Quality  | Speed    | CPU    | Cloning              | Verdict                 |
| ---------- | -------- | -------- | ------ | -------------------- | ----------------------- |
| Kokoro-82M | ⭐⭐⭐   | ⭐⭐⭐⭐ | ✅     | ❌ Voice mixing only | Use for non-cloning TTS |
| F5-TTS     | ⭐⭐⭐⭐ | ⭐⭐⭐   | ❌ GPU | ✅                   | Too heavy for Railway   |
| XTTS v2    | ⭐⭐⭐   | ⭐⭐     | ✅     | ✅                   | Older, less accurate    |

## Actionable Items

See BACKLOG.md "Voice Synthesis (Open Source)" in Future Themes section:

- [ ] Python microservice: `services/voice-engine/`
- [ ] TTS: Kyutai Pocket TTS
- [ ] STT: SenseVoice
