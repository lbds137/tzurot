### Theme: Railway Log Search DX for Incident Digs

_Focus: close the observability gap for cross-service correlation during prod incident investigation._

When investigating specific production issues, the current Railway log surface is painful to search — no easy way to filter by request ID across services, correlate a user-visible symptom with a specific worker job, or scope to a tight time window around a known bad event. Most digs end with "I scrolled through the log stream hoping I'd spot the right line."

**Investigation (2026-04-13)** — the tooling gap is smaller than initially thought:

- **Railway CLI 4.11.2 supports server-side `--filter` with full query syntax** — not just substring matching. Plain text search (`"error message"`), attribute filters (`@level:error`, `@level:warn`), boolean operators (`AND`, `OR`, `-` for NOT), combinations. Docs: https://docs.railway.com/guides/logs. Powerful server-side query engine already available.
- **`pnpm ops logs --filter` is NOT using it**. `packages/tooling/src/deployment/logs.ts:44-68` does client-side substring grep in JS after fetching unfiltered logs via `railway logs -n <lines>`. The wrapper's `--filter` string never reaches the Railway args array. That's why the wrapper feels less capable — because it IS.
- **Correlation-ID threading is still a real gap**: bot-client logs reliably include both `requestId` and `jobId`. But api-gateway and ai-worker often log only `jobId`. Even with full `--filter` support, `railway logs --filter "requestId:X"` finds bot-client lines but fails to stitch them to worker processing — exactly the layer where most incidents unfold.
- **Log-forwarding (Axiom/Loki/Datadog)**: recurring cost, not justified for current incident rate.

**Remaining work**:

1. **Thread `requestId` into BullMQ job data** so ai-worker handlers log it alongside `jobId` (~2 hrs). Blocks cross-service correlation with any query tool. Start in `common-types/src/types/queue-types.ts`, propagate to api-gateway submit sites and ai-worker job handlers.
2. **Document the query syntax** in `RAILWAY_CLI_REFERENCE.md` (~30 min); update `tzurot-deployment` skill's log-analysis section to use `--filter` patterns instead of `| grep` (~15 min).
3. **Optional**: add explicit `--request-id` / `--job-id` / `--since` ergonomic flags to `pnpm ops logs` that translate to Railway query syntax (`@requestId:X`) (~2-3 hrs, only valuable after step 1).
