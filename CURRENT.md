# Current

> **Session**: 2026-04-04
> **Version**: v3.0.0-beta.91

---

## Session Goal

_Post-surgery return session — dependency updates, bug triage from 3 weeks of user reports._

## Active Task

Dependency PRs in progress. Dependabot rebasing #753 (prod deps) and #754 (dev deps).

---

## Completed This Session

- Merged 4 Dependabot PRs: CI action bumps (#737 paths-filter, #745 pnpm/action-setup, #752 codecov) + security fix (#744 fast-xml-parser)
- Closed 4 superseded per-package dep PRs (#746-749) — covered by monorepo-wide #753/#754
- Requested Dependabot rebase on #753 (prod deps, 12 updates) and #754 (dev deps, 21 updates)
- Triaged 13+ user bug reports from Discord into backlog — 2 production issues, 13 inbox items with investigation notes

## Unreleased on Develop (since beta.91)

| PR   | Type  | Summary                                         |
| ---- | ----- | ----------------------------------------------- |
| #737 | chore | `dorny/paths-filter` 3 → 4 (CI action, Node 24) |
| #745 | chore | `pnpm/action-setup` 4 → 5 (CI action, Node 24)  |
| #752 | chore | `codecov/codecov-action` 5 → 6 (CI, Node 24)    |
| #744 | fix   | `fast-xml-parser` 5.4.2 → 5.5.6 (security)      |

## Previous Session

- **feat(ai-worker,api-gateway)**: Voice pipeline hardening (PR #733) — typed `TimeoutError` across all ai-worker timeout sites, `ElevenLabsTimeoutError extends TimeoutError`, 5-min TTLCache for ElevenLabs model list in api-gateway
- Addressed 3 rounds of PR review feedback (cache-before-DB optimization, cross-reference docs, null check confirmation)
- Shipped v3.0.0-beta.91

## Recent Releases

- **v3.0.0-beta.91** (2026-03-12) — Voice pipeline hardening: typed TimeoutError, ElevenLabs TTS retry, model list cache, stale voice auto-evict
- **v3.0.0-beta.90** (2026-03-10) — ElevenLabs BYOK hardening: scoped-key detection, voice auto-reclone, STT userId fix, TTS model config
- **v3.0.0-beta.89** (2026-03-09) — Voice Engine Phases 1–3b: Python STT/TTS service, ai-worker integration, voice commands, settings dashboards

## Follow-Up Items

- Merge #753 and #754 after Dependabot rebases complete
- Production issues: GLM 4.5 Air tag leaks, free vision model sunset (Mistral Small 3.1 24B)

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
