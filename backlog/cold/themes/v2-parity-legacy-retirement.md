### Theme: v2 Parity + Legacy Retirement

_Focus: disposition every v2 capability (build / already-have / deliberately-drop), then delete `tzurot-legacy/` — the finish line is the deletion._

**PAUSED — owner 2026-07-17** (was next-epic for one day; "I really wanna kill the legacy folder" still stands). Phase 1 shipped and works, but its UX deviated from the 04-discord standards — evidence the standards aren't enforced at design time. Owner: no more new UX surface until the [Platform-Portable UX Layer](platform-portable-ux-layer.md) makes consistency structural; that theme (with the alias redesign + scoping tiers as pilot) takes the next-epic slot. Resume this epic after the UX epic's core phases.

### Phase 0 — Parity audit → disposition matrix (NEXT)

- [ ] Inventory the 21 v2 command files (`tzurot-legacy/src/application/commands/{authentication,conversation,personality,utility}/` — counted 2026-07-17: 3+4+6+8) against v3 surfaces; produce a matrix: **have-it** (name the v3 surface) / **build-it** (backlog entry each) / **drop-it** (reason recorded in the matrix, no tombstones elsewhere).
  - First-pass mapping (verify each at audit time): Add/Info/List/Remove→`/character` CRUD · Config→config cascade · Auth→`/wallet` · Blacklist→`/admin denylist` · Verify→NSFW verification · Activate/Deactivate→`/channel` · Backup→`/settings data export` · Notifications→`/notifications` · Help→`/help` · **Alias→GAP (Phase 1)** · Autorespond/Reset/Ping/Status/Purgbot/Debug/VolumeTest→unknown, audit.
- [ ] Sweep NON-command behavior: handlers (mention formats, DM handling, reference/reply behavior), error personalities, webhook shapes, `docs/features/` inventory — v2 behaviors users may still miss that never had a command.
- [ ] Cross-reference existing themes holding v2-descended items (character-portability: PNG card import, sidecar prompts; user-requested-features: multi-personality channels, allowlists, emoji actions) — the matrix links to them rather than duplicating.

### Phase 1 — Alias management (STARTED 2026-07-17, first parity build)

- [x] **MERGED #1695 2026-07-17**: `/character alias` (action: list|add|remove) + gateway alias CRUD routes — surfaces + manages the v2-migrated `personality_aliases` rows that previously resolved mentions invisibly (the `@Lila` mystery). Hardened through 5 review rounds: shadow-check visibility scoping (private-character enumeration oracle closed), routing-cache invalidation on add/remove, markdown-escaped reflected errors. Follow-ups row discharged.
- [ ] **Reverse shadow direction** (review-surfaced on PR #1695): personality create/rename doesn't check `personality_aliases`, so a later same-named character silently shadows an existing alias — the `@Lila` failure class from the other side. Needs a design call first: reject (lets aliases squat on names — probably wrong), warn-in-response (create/update response contract + bot-client rendering change), or surface-in-`/character alias list` (mark shadowed rows). Promote when: Phase-1 alias UX gets its next iteration, or a shadowed-alias support mystery recurs.

### Phase N — derived from the Phase-0 matrix

### Finish line — delete `tzurot-legacy/`

- [ ] **`tzurot-legacy/data/` is gitignored PRIVATE data (personalities) — relocate it off-repo BEFORE any folder deletion** (rm on gitignored paths is unrecoverable; 00-critical).
- [ ] `git rm -r tzurot-legacy/` + scrub its `.gitignore` entries + decide `docs/reference/v2-patterns-reference.md` (likely delete with it).
- [ ] Anything the matrix marked drop-it needs no tombstone — the matrix (this file, then git history) is the record.
