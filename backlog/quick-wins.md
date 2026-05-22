## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

- **[CHORE] Migrate `/admin/db-sync` + `/admin/cleanup` to `X-User-Id` header** — both routes pass `{ownerId}` in POST body, which is why `extractOwnerId` retains a body-fallback path. All other admin routes use the `X-User-Id` header convention (post-PR #1081). Migrating these two would let the body fallback come out of `extractOwnerId` entirely. **Start**: `services/bot-client/src/commands/admin/db-sync.ts:137-140` + `commands/admin/cleanup.ts:31` — drop the `ownerId` body field, rely on `adminPostJson` setting the header. Then drop the body block in `services/api-gateway/src/services/AuthMiddleware.ts:extractOwnerId`. ~10 LOC. Surfaced by PR #1081 review.

- **[CHORE] Detect orphan WHY.md files in `guard:audit-tool-docs`** — current check is unidirectional: every registered tool must have a WHY.md, but a WHY.md file with no registry entry would survive untouched (knip can't catch it — `whyPath` strings are data, not imports). **Start**: in `checkAuditToolDocsFromRegistry`, walk `packages/tooling/src/**/*.WHY.md` and assert each path matches at least one registry entry. Add a third finding category (`orphanWhyFiles`) reported as hard-fail. Surfaced by PR #1083 review.

> Note: 3 items previously filed here (`runEslint` guard, non-summary path test, single-word slug enforcement) were rolled into the Layer 2 scope of [`docs/proposals/backlog/periodic-audit-enforcement.md`](../docs/proposals/backlog/periodic-audit-enforcement.md) on 2026-05-22 — they touch the same code Layer 2 will expand, so absorbing avoids context-switching.
