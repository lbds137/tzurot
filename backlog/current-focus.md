## 🎯 Current Focus

_This week's active work. Max 3 items._

### Active

1. **Cut release v3.0.0-beta.120** — bundle PR #1003 (`/voice` consolidation), #1004 (preset rename), and #1005 (Mistral STT cutover). Migration already applied to prod, so this release is purely the code deploy + Discord-side surface refresh. Required before users see the new `/voice` namespace.

### Most likely next-session pickups

1. **TTS Engine Upgrade Phase 2** (NeuTTS Air) — last remaining phase of the epic. Self-hosted free-tier engine with voice cloning, alongside Kyutai/Pocket TTS. Plan-mode pending. See [`active-epic.md`](active-epic.md) Phase 2 section.
2. **TTS Phase 3 follow-up sweep** — 5 PR-#1005 review-flagged items in inbox (cache-invalidation wiring, in-band attachment STT path, shared cascade helper, JIT footer timeout, DB CHECK constraints). Could be batched as one PR or absorbed opportunistically during Phase 2 work.

### Other in-flight

_None._
