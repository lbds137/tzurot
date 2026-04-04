# Current

> **Session**: 2026-04-04
> **Version**: v3.0.0-beta.91

---

## Session Goal

_Post-surgery return session — dependency updates, bug triage, bundled bugfix PR._

## Active Task

PR #756 awaiting CI and merge. Once merged, cut beta.92 release.

---

## Completed This Session

- Merged 6 Dependabot PRs: CI action bumps (#737, #745, #752), security fix (#744 fast-xml-parser), dev deps (#754, 21 updates), prod deps (#755, 14 updates)
- Closed 4 superseded per-package dep PRs (#746-749)
- Triaged 13+ user bug reports from Discord into backlog — 2 production issues, 13 inbox items with investigation notes
- Created bundled bugfix PR #756 with 5 fixes:
  1. GLM 4.5 Air reasoning/prompt tag leak stripping (`<character_analysis>`, `<received message>`, `</chat_log>`)
  2. Free vision model replacement (dead Mistral Small 3.1 24B -> Gemma 3 27B)
  3. Context window: don't halve for small models (<=65536 tokens)
  4. Accept `audio/mp4` and `audio/x-m4a` for voice reference uploads
  5. Skip transcription of bot's own forwarded voice messages
- Added backlog item for refactoring tag stripping to data-driven architecture

## Unreleased on Develop (since beta.91)

| PR   | Type  | Summary                                                                             |
| ---- | ----- | ----------------------------------------------------------------------------------- |
| #737 | chore | `dorny/paths-filter` 3 -> 4 (CI action, Node 24)                                    |
| #745 | chore | `pnpm/action-setup` 4 -> 5 (CI action, Node 24)                                     |
| #752 | chore | `codecov/codecov-action` 5 -> 6 (CI, Node 24)                                       |
| #744 | fix   | `fast-xml-parser` 5.4.2 -> 5.5.6 (security)                                         |
| #754 | chore | Dev dependencies (21 updates)                                                       |
| #755 | chore | Production dependencies (14 updates)                                                |
| #756 | fix   | Bundled bugfixes (tag leaks, vision model, context window, mp4, self-transcription) |

## Previous Session

- **feat(ai-worker,api-gateway)**: Voice pipeline hardening (PR #733)
- Shipped v3.0.0-beta.91

## Recent Releases

- **v3.0.0-beta.91** (2026-03-12) — Voice pipeline hardening: typed TimeoutError, ElevenLabs TTS retry, model list cache, stale voice auto-evict
- **v3.0.0-beta.90** (2026-03-10) — ElevenLabs BYOK hardening: scoped-key detection, voice auto-reclone, STT userId fix, TTS model config
- **v3.0.0-beta.89** (2026-03-09) — Voice Engine Phases 1-3b: Python STT/TTS service, ai-worker integration, voice commands, settings dashboards

## Follow-Up Items

- Merge PR #756 after CI passes, then cut beta.92 release
- 2 production issues remain in backlog (GLM tag leaks addressed in #756, vision model addressed in #756)
- 13 inbox items awaiting triage to proper backlog sections

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
