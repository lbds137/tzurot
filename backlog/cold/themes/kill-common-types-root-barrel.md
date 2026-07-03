### Theme: Kill the common-types root barrel (+ `package.json` exports map)

_Focus: replace the ~976-export root `index.ts` barrel with a `package.json` exports map of specific subpaths, codemodding all consumer imports to deep paths._

**Problem**: The real driver of the 976-export `xray` smell isn't line count — it's the single root `index.ts` barrel re-exporting everything. A 976-export barrel hurts TS-server performance and makes the dependency surface opaque (every consumer can reach every symbol). The 2058-line generated `user-client.ts` inflates line count but is codegen output and should be exempt from the heuristic, not split.

**Why it's a theme, not a follow-up**: Qwen 3.7 Max (council 2026-06-02) flagged this as the higher-leverage fix for the export-count metric, but it's a large cross-service codemod orthogonal to the package extraction. **Measured blast radius (2026-06-02, post-clients-extraction): 1,021 import sites** reference `@tzurot/common-types` — converting them to deep subpath imports + designing the `exports` subpath structure is a major epic on the scale of the clients extraction itself, NOT a quick follow-up. Reassess whether it's worth 1,021-site churn vs. just accepting the export count now that routes/clients are gone; the pick deserves a council pass on the subpath taxonomy before plan-mode.

### Phase 1 — Subpath taxonomy decision

- [ ] Council pass on the `exports`-map subpath structure (e.g. `@tzurot/common-types/constants`, `@tzurot/common-types/schemas/*`) — decide granularity + naming before any code moves
- [ ] Re-measure the import-site blast radius (the 1,021 figure predates later extractions) and confirm the epic is still worth the churn

### Phase 2 — Codemod

- [ ] Codemod all consumer import sites from the root barrel to deep subpath imports (mechanical; per-package slices)

### Phase 3 — Barrel deletion + guard

- [ ] Gut the root `index.ts`; land the `package.json` `exports` map
- [ ] Guard against regression: knip (or a structural check) fails when new root-barrel re-exports accumulate
