# Current

> **Session**: 2026-02-16 (continued)
> **Version**: v3.0.0-beta.76

---

## Session Goal

_Shapes.inc character backup & import — API research, plan finalization, implementation._

## Active Task

Shapes.inc import plan **finalized** — API data fetched, field mappings confirmed, design decisions made. Documentation committed to develop. Ready to begin implementation on feature branch.

---

## Completed This Session

- [x] ✨ **Shapes.inc Import Plan** — Full 5-phase implementation plan in `docs/proposals/active/shapes-inc-import-plan.md`. Command structure (`/shapes auth|logout|import|export|status`), DB schema (UserCredential + ImportJob), BullMQ job pipeline, pgvector memory import with local embeddings.
- [x] 🐛 **GLM 4.5 Air Bug Triage** — Model uses `<think>` as roleplay formatting without closing tag; `UNCLOSED_TAG_PATTERN` consumes all content as thinking, leaving visible content empty. Added to backlog inbox with fix options.
- [x] 🧹 **Doc Cleanup** — Deleted completed proposals (V2_FEATURE_TRACKING, timeout-architecture-refactor, whisper-transcript-cleanup, ltm-context-separation). Moved config-cascade-design to backlog (Phase 1 done, Phases 2-5 future). Added superseded note to old shapes.inc design doc.
- [x] 🧹 **Debug Folder Cleanup** — Removed 10 stale debug files (~564KB). Kept GLM bug reference and recent diagnostic.
- [x] 🧹 **Backlog Updates** — Added GLM 4.5 Air bug to inbox, Personality Aliases to icebox, Prompt Caching to icebox, shapes.inc import plan to references.
- [x] ✨ **Shapes.inc API Research** — Fetched real data from all 7 API endpoints using session cookie. Saved configs, memories, stories, user personas for Lilith (2,267 memories) and Cerridwen (10 memories) to `debug/shapes/`. Discovered split cookie format, username-based lookup, memory pagination.
- [x] ✨ **Field Mapping Validation** — Confirmed existing `PersonalityMapper.ts` handles most fields correctly. Documented unmapped fields (all null in tested shapes). Resolved sidecar prompt → customFields storage, knowledge → `type` column on memories.
- [x] 📝 **Plan Finalization** — Updated proposal with API findings, confirmed field mappings, cookie handling notes, knowledge/sidecar design decisions. Updated BACKLOG.md with refined shapes.inc import and User System Prompts entries.

## Next Steps

1. Create feature branch `feat/shapes-import`
2. Begin Phase 1: Schema + Credential Management
3. Run `pnpm quality` after Phase 1

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
