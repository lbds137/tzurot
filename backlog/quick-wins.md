## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

- **[CHORE] Migrate `/admin/db-sync` + `/admin/cleanup` to `X-User-Id` header** — both routes pass `{ownerId}` in POST body, which is why `extractOwnerId` retains a body-fallback path. All other admin routes use the `X-User-Id` header convention (post-PR #1081). Migrating these two would let the body fallback come out of `extractOwnerId` entirely. **Start**: `services/bot-client/src/commands/admin/db-sync.ts:137-140` + `commands/admin/cleanup.ts:31` — drop the `ownerId` body field, rely on `adminPostJson` setting the header. Then drop the body block in `services/api-gateway/src/services/AuthMiddleware.ts:extractOwnerId`. ~10 LOC. Surfaced by PR #1081 review.
