## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

> Note: 7 items previously filed here all shipped in PR #1082-1084 (Layer 2 + Layer 3 of the periodic-audit-enforcement proposal). The remaining work tracked in [`docs/proposals/backlog/periodic-audit-enforcement.md`](../docs/proposals/backlog/periodic-audit-enforcement.md) is Layers 4-5 (markdown baselines + `ops:health` cron aggregator).

- **[CHORE] Merge stacked JSDoc blocks in `check-duplicate-exports.ts`** — The file uses the stacked pattern `/** description */` + `/** @internal Exported for testing */` on several exported helpers (`isAllowed`, `isSourceFile`, `parseReExportName`, `matchDeclarations`, `matchReExports`, `extractExports`, `findDuplicates`). TypeScript/TSDoc only reads the JSDoc block **immediately preceding** the declaration, so the description blocks are orphaned — they don't appear in IDE hover or generated docs. **Fix**: fold the `@internal Exported for testing` tag into each description block as a trailing `@internal` tag line (same fix already applied to `check-dockerfile-dist.ts` in PR #1148 after claude-review caught the pattern there). Grep `/** @internal Exported for testing */` across `packages/tooling/src` to confirm no other files carry the stacked form. ~10 line-moves, comment-only. Surfaced 2026-06-03 by PR #1148 claude-review.

_Shipped 2026-06-03 (quick-wins sweep, PRs #1147/#1148/#1149): redis removal + test-factories depcruise boundary, `guard:dockerfile-dist`, view.ts coverage + typed preset unflatten pipeline. One new item filed below from the sweep's review cycles._
