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

In flight via grouped PRs (dual-publish — barrel `"."` stays alive until Phase 3). **PR #1472** = tooling + all `packages/*` (taxonomy decided: file-level mirror subpaths + per-subtree wildcard `exports` map, generated deterministically from `getExportSymbols()`; codemod in `scripts/migrations/barrel-kill/`). PR 2 = the three services. PR 3 = the gut below. The codemod's `remainingBareRefs` scan surfaces dynamic `import()` / string-embedded / barrel-centric refs the AST can't rewrite — the PR-3 checklist for clearing them.

**Codemod-quality follow-ups (from PR #1472 review, do before PR 2):**

- `mock-codemod.ts`: preserve the trailing blank line after a rewritten `vi.mock()` block — `statement.remove()` + `insertStatements()` drops it, so the mock ends up flush against the following `describe(...)`. Cosmetic diff noise; fix before PR 2's larger mock volume.
- Format only codemod-CHANGED files, not the whole package — running `prettier --write "packages/$pkg/src/**"` swept an unrelated file (`xray/types.ts`, no barrel import) into PR #1472. Restrict the format pass to files the codemod actually touched.

**PR-3 map cleanup:** the nested `exports` entries (`schemas/api/*`, `services/tts/*`, `types/schemas/*`) are redundant — Node's `exports` `*` spans `/`, so the parent wildcard already resolves them (contradicting the design-time council claim). Verify with a resolution test, then drop the nested entries.

### Phase 3 — Barrel deletion + guard

- [ ] Clear/allowlist the BARE barrel refs from the codemod's `remainingBareRefs` scan — dynamic `import()`, string-embedded imports, and INTENTIONAL barrel-centric test fixtures (`dev/check-boundaries.test.ts` + `topology/*.test.ts` feed barrel-import strings to the analyzers; `check-boundaries.test.ts:409` verifies barrel exports). The fixtures need a deliberate allowlist or rework once the barrel is gone.
- [ ] Update the boundary checker (`dev/check-boundaries.ts`) to detect DEEP-path Prisma imports (`@tzurot/common-types/services/prisma`) in bot-client — after the barrel dies, that's the new shape of the "bot-client imports Prisma" violation it currently matches via the bare barrel string.
- [ ] Gut the root `index.ts`; drop the `"."` entry from the `exports` map.
- [ ] Guard against regression: eslint `no-restricted-imports` on the bare `@tzurot/common-types` specifier + a CI grep asserting the bare-specifier count is 0 (minus the fixture allowlist).
