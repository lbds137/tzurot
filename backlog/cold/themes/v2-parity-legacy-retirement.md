### Theme: v2 Parity + Legacy Retirement

_Focus: disposition every v2 capability (build / already-have / deliberately-drop), then delete `tzurot-legacy/` — the finish line is the deletion._

**NEXT EPIC — owner-decided 2026-07-17** ("I really wanna kill the legacy folder"). Promote into `active-epic.md` when the spinoff-knockout stragglers are dispositioned.

### Phase 0 — Parity audit → disposition matrix (NEXT)

- [ ] Inventory the 17 v2 commands (`tzurot-legacy/src/application/commands/{authentication,conversation,personality,utility}/`) against v3 surfaces; produce a matrix: **have-it** (name the v3 surface) / **build-it** (backlog entry each) / **drop-it** (reason recorded in the matrix, no tombstones elsewhere).
  - First-pass mapping (verify each at audit time): Add/Info/List/Remove→`/character` CRUD · Config→config cascade · Auth→`/wallet` · Blacklist→`/admin denylist` · Verify→NSFW verification · Activate/Deactivate→`/channel` · Backup→`/settings data export` · Notifications→`/notifications` · Help→`/help` · **Alias→GAP (Phase 1)** · Autorespond/Reset/Ping/Status/Purgbot/Debug/VolumeTest→unknown, audit.
- [ ] Sweep NON-command behavior: handlers (mention formats, DM handling, reference/reply behavior), error personalities, webhook shapes, `docs/features/` inventory — v2 behaviors users may still miss that never had a command.
- [ ] Cross-reference existing themes holding v2-descended items (character-portability: PNG card import, sidecar prompts; user-requested-features: multi-personality channels, allowlists, emoji actions) — the matrix links to them rather than duplicating.

### Phase 1 — Alias management (STARTED 2026-07-17, first parity build)

- [x] BUILT 2026-07-17 (same session; PR pending merge): `/character alias` (action: list|add|remove) + gateway alias CRUD routes — surfaces + manages the v2-migrated `personality_aliases` rows that today resolve mentions invisibly (the `@Lila` mystery). Discharges the 2026-07-17 follow-ups row at ship.

### Phase N — derived from the Phase-0 matrix

### Finish line — delete `tzurot-legacy/`

- [ ] **`tzurot-legacy/data/` is gitignored PRIVATE data (personalities) — relocate it off-repo BEFORE any folder deletion** (rm on gitignored paths is unrecoverable; 00-critical).
- [ ] `git rm -r tzurot-legacy/` + scrub its `.gitignore` entries + decide `docs/reference/v2-patterns-reference.md` (likely delete with it).
- [ ] Anything the matrix marked drop-it needs no tombstone — the matrix (this file, then git history) is the record.
