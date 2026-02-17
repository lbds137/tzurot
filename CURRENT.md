# Current

> **Session**: 2026-02-16 (continued)
> **Version**: v3.0.0-beta.76

---

## Session Goal

_Shapes.inc character backup & import — plan finalization, implementation, and deployment._

## Active Task

Shapes.inc import **gap fixes** — 5 verified gaps from deep verification against legacy scripts. Branch: `fix/shapes-import-gaps`.

---

## Completed This Session

- [x] 🐛 **Fix 1: Partial re-import dedup** — Replaced count-based skip with content-based deduplication (query existing content → Set → skip duplicates). Partial retries now import only missing memories.
- [x] 🐛 **Fix 2: Avatar download timeout** — Added AbortController with 30s timeout to `downloadAndStoreAvatar()` fetch call. Matches `ShapesDataFetcher.REQUEST_TIMEOUT_MS`.
- [x] ✨ **Fix 3: Stuck import job cleanup** — New `cleanupStuckImportJobs.ts` scheduled every 15 minutes. Finds `in_progress` jobs older than 1 hour, marks them failed so users can retry.
- [x] ✨ **Fix 4: Capture initial message** — Extract `shape_settings.shape_initial_message` into `customFields.initialMessage` in ShapesPersonalityMapper.
- [x] ✨ **Fix 5: Parse birthday** — New `parseBirthday()` helper parses `MM-DD` and `YYYY-MM-DD` formats into `birthMonth`/`birthDay`/`birthYear` typed columns. Raw string kept in customFields as fallback.
- [x] 🏗️ **Complexity refactor** — Extracted `buildCustomFields()` with data-driven field mapping to reduce `mapPersonality` complexity below ESLint threshold.
- [x] 📝 **Backlog** — Added voice/image field import and training data import as future phases.

## Next Steps

1. Commit and create PR for `fix/shapes-import-gaps`
2. End-to-end verification: auth → import → verify character exists → talk to it
3. Release as beta.77

## Recent Highlights

- **beta.76**: Admin commands bundle, custom status, `<from>` tag fix, hook cleanup
- **beta.75**: Reply-to context, `/deny view`, denylist hardening, stop sequence cleanup
- **beta.74**: Config cascade PR feedback, prod migration catch-up

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
