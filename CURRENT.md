# Current

> **Session**: 2026-04-13
> **Version**: v3.0.0-beta.96

---

## Session Goal

_Backlog shrinkage: knock out small items and inbox triage, dependency updates, preset UX improvements, release v3.0.0-beta.96._

## Active Task

**None — session complete.** 6 PRs merged (#794-800), 1 release PR (#801) awaiting merge to main. 8 backlog items cleared, 3 review follow-ups fixed, full dependency update shipped.

---

## Completed This Session

### PR #794 — BrowseActionRow Extraction + Guard Test Trim

- Extracted shared `BrowseActionRow` type from 5 duplicate definitions into `browse/types.ts`
- Fixed deny/browse `as unknown as` cast by adopting the union type
- Removed 12 duplicate guard/parse tests from 3 settings test files (covered by factory)
- Cleaned up dead mock helpers and unused imports

### PR #795 — Route Helpers Split + configId Tightening

- Split `resolveUserIdOrSendError` into new `routeHelpers.ts` (9 import sites updated)
- Replaced `getParam` with `getRequiredParam` for configId in LLM config routes
- Added `ParameterError → 400` mapping in `asyncHandler` (was 500)
- Created `asyncHandler.test.ts` with 4 tests

### PR #796 — Thinking Tags Data-Driven

- Replaced 7 hardcoded regex patterns with single `KNOWN_THINKING_TAGS` array
- Adding a new tag now requires one line change instead of seven
- Added constraint comment, ordering safety note, readonly annotation

### PR #797 — Mention Parser Fixes + Forwarded Messages

- Forwarded messages no longer trigger AI responses in either processor
- Apostrophe names work (`@O'Reilly`)
- Possessive forms work (`@Lilith's` → matches `Lilith`)
- MCP council consulted for forwarded message design decision

### PR #798 — Dependency Updates

- 30+ packages bumped (Prisma 7.7, vite 8, ts-morph 28, vitest 4.1.4, etc.)
- `pnpm/action-setup` v6 attempted → reverted due to CI lockfile breakage
- Regenerated `pnpm-lock.yaml`

### PR #799 — Preset Error Surfacing

- Preset save/clone/create now show actual API error messages instead of generic "Failed to X"
- Extracted `extractApiErrorMessage` helper with Discord length guard (1800 char cap)
- Regex anchored to HTTP status format to prevent false positives

### PR #800 — Session Follow-ups

- Fixed double body consumption in `updateGlobalPreset` error path (read-once pattern)
- Tightened 409 duplicate check from `includes('409')` to `includes(': 409 ')`
- Increased xray analyzer test timeout to 30s for CI stability

### Other

- Closed 7 Dependabot PRs (#787-793) — superseded by consolidated #798
- ElevenLabs "aborted" edge case closed (resolved in beta.95)
- Backlog updated: 8 items cleared, 5 new items added from review findings

---

## Unreleased on Develop (since beta.96)

_(Empty — release pending merge to main)_

---

## Previous Sessions

- **2026-04-13**: Backlog shrinkage (PRs #794-800), deps update, preset UX, beta.96
- **2026-04-12**: Voice engine hardening (PR #785), Python hooks, release audit, beta.95
- **2026-04-11**: CPD Session 1 (PRs #778-780), channel rename (#781), doc audit (#782-784)
- **2026-04-10**: Browse Step 8 (PR #776), CPD 137→126
- **2026-04-09**: Browse Steps 6-7 (PR #775), footer design plan + council consultation
- **2026-04-06**: Architecture day (PRs #766, #768, #769), CPD 146→137

## Recent Releases

- **v3.0.0-beta.96** (2026-04-13) — Mention parser fixes, forwarded messages, preset error surfacing, deps update, refactors
- **v3.0.0-beta.95** (2026-04-12) — Voice engine lazy loading, ElevenLabs abort fix, CPD Session 1, browse epic, doc audit
- **v3.0.0-beta.94** (2026-04-10) — Browse standardization, config override helpers, shared abstractions
- **v3.0.0-beta.93** (2026-04-05) — Voice engine retry, security bumps, cascade resolver fixes

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
