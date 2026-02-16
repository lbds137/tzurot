# Current

> **Session**: 2026-02-16 (continued)
> **Version**: v3.0.0-beta.76

---

## Session Goal

_Shapes.inc character backup & import planning + housekeeping._

## Active Task

Shapes.inc implementation **blocked** — waiting for real API data in `debug/shapes/`.

---

## Completed This Session

- [x] ✨ **Shapes.inc Import Plan** — Full 5-phase implementation plan in `docs/proposals/active/shapes-inc-import-plan.md`. Command structure (`/shapes auth|logout|import|export|status`), DB schema (UserCredential + ImportJob), BullMQ job pipeline, pgvector memory import with local embeddings.
- [x] 🐛 **GLM 4.5 Air Bug Triage** — Model uses `<think>` as roleplay formatting without closing tag; `UNCLOSED_TAG_PATTERN` consumes all content as thinking, leaving visible content empty. Added to backlog inbox with fix options.
- [x] 🧹 **Doc Cleanup** — Deleted completed proposals (V2_FEATURE_TRACKING, timeout-architecture-refactor, whisper-transcript-cleanup, ltm-context-separation). Moved config-cascade-design to backlog (Phase 1 done, Phases 2-5 future). Added superseded note to old shapes.inc design doc.
- [x] 🧹 **Debug Folder Cleanup** — Removed 10 stale debug files (~564KB). Kept GLM bug reference and recent diagnostic.
- [x] 🧹 **Backlog Updates** — Added GLM 4.5 Air bug to inbox, Personality Aliases to icebox (with v2 feature documentation), Prompt Caching to icebox, shapes.inc import plan to references.

## Next Session

- Shapes.inc implementation Phase 1 (once real API data available)
- CPD (copy-paste detection) cleanup — tackle the 149 clones
- Slash Command UX Audit from backlog

## Recent Highlights

- **beta.76**: Admin commands bundle, custom status, `<from>` tag fix, hook cleanup
- **beta.75**: Reply-to context, `/deny view`, denylist hardening, stop sequence cleanup
- **beta.74**: Config cascade PR feedback, prod migration catch-up

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- **[Shapes.inc Import Plan](docs/proposals/active/shapes-inc-import-plan.md)** - Active proposal
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
