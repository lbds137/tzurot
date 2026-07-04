### Theme: Kill the common-types root barrel (+ `package.json` exports map)

_Focus: replace the ~976-export root `index.ts` barrel with a `package.json` exports map of specific subpaths, codemodding all consumer imports to deep paths._

**Problem**: The real driver of the 976-export `xray` smell isn't line count — it's the single root `index.ts` barrel re-exporting everything. A 976-export barrel hurts TS-server performance and makes the dependency surface opaque (every consumer can reach every symbol). The 2058-line generated `user-client.ts` inflates line count but is codegen output and should be exempt from the heuristic, not split.

**Why it's a theme, not a follow-up**: Qwen 3.7 Max (council 2026-06-02) flagged this as the higher-leverage fix for the export-count metric, but it's a large cross-service codemod orthogonal to the package extraction. **Measured blast radius (2026-06-02, post-clients-extraction): 1,021 import sites** reference `@tzurot/common-types` — converting them to deep subpath imports + designing the `exports` subpath structure is a major epic on the scale of the clients extraction itself, NOT a quick follow-up. Reassess whether it's worth 1,021-site churn vs. just accepting the export count now that routes/clients are gone; the pick deserves a council pass on the subpath taxonomy before plan-mode.

### Phase 1 — Subpath taxonomy decision

- [ ] Council pass on the `exports`-map subpath structure (e.g. `@tzurot/common-types/constants`, `@tzurot/common-types/schemas/*`) — decide granularity + naming before any code moves
- [ ] Re-measure the import-site blast radius (the 1,021 figure predates later extractions) and confirm the epic is still worth the churn

### Phase 2 — Codemod

- [ ] Codemod all consumer import sites from the root barrel to deep subpath imports (mechanical; per-package slices)

### Status (2026-07-03)

In flight via grouped PRs (dual-publish — barrel `"."` stays alive until Phase 3). **PR #1472** (merged) = tooling + all `packages/*`. **Archaeology sweep #1473** (merged) rode between. **PR #1474** (merged 2026-07-04) = the three heavy services (ai-worker/api-gateway/bot-client), all green (3347 + 2252 + 5177 tests). **Scripts-hardening #1475** (merged 2026-07-04) = deleted 15 dead/superseded scripts, relocated the command-types codegen to `ops codegen:command-types`, and closed the bot-client/scripts typecheck blind spot (`update-deps`/`openrouter-gen` turned out to be a dead duplicate + one-off debug → deleted, not moved to tooling as the plan first proposed). PR 3 = the gut below. The codemod's `remainingBareRefs` scan surfaces dynamic `import()` / string-embedded / barrel-centric refs the AST can't rewrite — the PR-3 checklist for clearing them.

**Codemod-quality follow-ups (from PR #1472 review) — ✅ done in PR #1474:**

- ~~`mock-codemod.ts`: preserve the trailing blank line after a rewritten `vi.mock()` block~~ — fixed via `replaceWithText` (preserves the node's trailing trivia) instead of `remove()`+`insertStatements()`.
- ~~Format only codemod-CHANGED files, not the whole package~~ — the PR-2 workflow formats `git diff --name-only` files only.

**Codemod correctness fixes made IN PR #1474** (all latent in PR 1, surfaced by the per-service test gate):

- **Preserve `import type`** — `imp.set()`/`exp.set()` now carry `isTypeOnly`; the mutate-in-place path was silently dropping whole-import `type` (→ runtime value import of `PrismaClient`, a bot-client boundary risk). PR 1's `packages/*` carry a tolerated version → follow-ups.md.
- **Always spread the real subpath in split mocks** — a deep `vi.mock('.../constants/ai')` intercepts common-types' OWN internal `../constants/ai` import (config.ts `z.nativeEnum(AIProvider)`), so no-spread blanking crashed suite load. `buildGroupMock` no longer mirrors the original's no-spread.
- **Widened `scanRemainingBareRefs`** to catch vitest string-arg forms (`vi.doMock`/`vi.doUnmock`/`vi.importActual`), not just `import()`/`from`.

**Manual-site classes PR 2 hit (for the PR-3 service sweep, though PR-3 touches common-types not services):** namespace spies (`vi.spyOn(ns,'getConfig')` → repoint to the deep module), factory-local bindings (`const { mockIsBotOwner } = await import('./test-utils.js')` re-added inside the split mock that uses it — 4 api-gateway route tests), dynamic `await import('@tzurot/common-types')`, and a dead barrel mock (override of a non-common-types export).

**PR-3 map cleanup:** the nested `exports` entries (`schemas/api/*`, `services/tts/*`, `types/schemas/*`) are redundant — Node's `exports` `*` spans `/`, so the parent wildcard already resolves them (contradicting the design-time council claim). Verify with a resolution test, then drop the nested entries.

### Phase 3 — Barrel deletion + guard

- [ ] Clear/allowlist the BARE barrel refs from the codemod's `remainingBareRefs` scan — dynamic `import()`, string-embedded imports, and INTENTIONAL barrel-centric test fixtures (`dev/check-boundaries.test.ts` + `topology/*.test.ts` feed barrel-import strings to the analyzers; `check-boundaries.test.ts:409` verifies barrel exports). The fixtures need a deliberate allowlist or rework once the barrel is gone.
- [ ] Update the boundary checker (`dev/check-boundaries.ts`) to detect DEEP-path Prisma imports (`@tzurot/common-types/services/prisma`) in bot-client — after the barrel dies, that's the new shape of the "bot-client imports Prisma" violation it currently matches via the bare barrel string.
- [ ] Gut the root `index.ts`; drop the `"."` entry from the `exports` map.
- [ ] Guard against regression: eslint `no-restricted-imports` on the bare `@tzurot/common-types` specifier + a CI grep asserting the bare-specifier count is 0 (minus the fixture allowlist). **The grep MUST be repo-wide, not `src/`-only** — a bare-barrel ref hid in `services/bot-client/scripts/deploy-commands.ts` (outside bot-client's `src/**` tsconfig) and would have silently broken command deployment at the `"."`-drop (caught by PR #1474 review). Sweep `services/**`, `packages/**`, and root `scripts/**`.
- [ ] **Delete `scripts/migrations/barrel-kill/`** once the barrel is gutted — the codemod (`codemod.ts`, `mock-codemod.ts`, `build-symbol-map.ts`) is one-off migration tooling with no colocated tests; PR #1474 review flagged that it must not linger as permanently-untested code. Known latent gap in `mock-codemod.ts` (`hasCrossSubpathActualRef` only inspects `PropertyAssignment`, not method-shorthand `foo() { return actual.bar }`) — never fired (all suites green), moot on deletion; only relevant if someone resurrects the codemod.
- [ ] **Restore `import type` precision in PR-1's `packages/*`** (folded in here per user, 2026-07-03). The codemod's mutate-in-place path dropped whole-import `isTypeOnly` before the PR-2 fix, so PR 1's merged packages carry `import type { X }` → `import { X }` on a split import's first group. Compiles + lints (`@typescript-eslint/consistent-type-imports` not enforced) and no boundary breach in those packages, but imprecise — for value-classes (`PrismaClient`) it turns an elided type-import into a runtime import. **Fix shape**: either grep `packages/*` for deep `import { … } from '@tzurot/common-types/…'` where the symbol is type-only-used and restore `import type`, OR enable `@typescript-eslint/consistent-type-imports` (auto-fixable) as the structural guard that catches this class repo-wide (pairs naturally with the `no-restricted-imports` guard above). Surfaced 2026-07-03 (barrel-kill PR 2 test gate).

