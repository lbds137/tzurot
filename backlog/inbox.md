## 📥 Inbox

_New items go here. Triage to appropriate section weekly._

- 🏗️ `[LIFT]` **Migrate `GatewayClient` hardcoded `AbortSignal.timeout(N)` calls to named `TIMEOUTS.*` constants** — `services/bot-client/src/utils/GatewayClient.ts` has 8 hardcoded numeric timeout values inline (varying across endpoints). PR #1072 established the pattern for admin paths (`TIMEOUTS.ADMIN_GATEWAY`); the rest of GatewayClient should follow. Surfaced 2026-05-21 by PR #1072 claude-review. **Start**: grep `AbortSignal.timeout(` in `GatewayClient.ts`; introduce one `TIMEOUTS.*` constant per logical endpoint group (probably 2-4 constants, not 8 — some share semantics) in `packages/common-types/src/constants/timing.ts`.
