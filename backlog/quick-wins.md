## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

> Note: 7 items previously filed here all shipped in PR #1082-1084 (Layer 2 + Layer 3 of the periodic-audit-enforcement proposal). The remaining work tracked in [`docs/proposals/backlog/periodic-audit-enforcement.md`](../docs/proposals/backlog/periodic-audit-enforcement.md) is Layers 4-5 (markdown baselines + `ops:health` cron aggregator).

- **[LIFT] Cover `view.ts` `handleExpandField` + `handleViewPagination` error path** — PR #1132 added `handleView` / `handleViewPagination` happy + 404 coverage but left two gaps: (1) `handleExpandField` (view.ts ~428-470, wired in `dashboard.ts`, mocked at the import boundary in `dashboard.test.ts` so its body never executes) has 5 untested branches — found → `sendChunkedReply`, character-not-found, unknown-field, empty-content → `_Not set_`, catch → error. (2) `handleViewPagination`'s catch block (non-404/403 error → silent log, keep existing content) is untested. **Fix shape**: reuse the `gatewayClientStubs` + `characterViewOptions`/`clientsFor` mock pattern now in `view.test.ts`; `handleExpandField` needs `deferReply` alongside `editReply` on the mock interaction. ~40-60 LOC. Surfaced by PR #1132 claude-review.
