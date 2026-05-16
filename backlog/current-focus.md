## 🎯 Current Focus

_This week's active work. Max 3 items._

### Active

_None — TTS Engine Upgrade epic functionally complete after Phase 2 (NeuTTS Air) abandon 2026-05-13 (cost win captured via Phase 1 + 3). v3.0.0-beta.122 shipped 2026-05-16 (multi-character tagging + webhook-suffix root-cause fix + chat polish)._

### Most likely next-session pickups

1. **Self-Hosted TTS + BYOK Re-Eval — Step 0 probes** ([future-themes.md](future-themes.md)): hands-on probe (30 min each) of OmniVoice / F5-TTS / CosyVoice using the reusable pattern from the 2026-05-13 NeuTTS Air probe. Plus verify Pocket TTS long-form support — current self-hosted might already cover the 1-4 min reply use case without any new engine.
2. **API Security Hardening** ([future-themes.md](future-themes.md)): rate limiter + helmet/CORS + `/voice-references/:slug` enumeration risk. 3 items in a single security pass.
3. **Voice references trim** ([inbox.md](inbox.md)): 8 personalities silently failing Mistral cloning (refs >30s). Owner-action only — no code work, but worth doing post-deploy to verify the audit tool's prod-side correctness.

### Other in-flight

_None._
