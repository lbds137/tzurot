## 🎯 Current Focus

_This week's active work. Max 3 items._

### Identity Hardening — final cleanup (post-epic)

The Identity & Provisioning Hardening Epic shipped end-to-end as of 2026-04-23 (Phases 1–6; see `docs/reference/architecture/epic-identity-hardening.md`). Two small follow-ups remain, sequenced as one atomic bundle:

- 🧹 **Tighten `requireProvisionedUser` shadow-mode to strict 400** — `services/api-gateway/src/services/AuthMiddleware.ts:193-204` already plans this cutover. Safe once prod canary stays clean for 48-72h (earliest: ~2026-04-25). Middleware returns 400 on missing/malformed user-context headers instead of falling through. Removes the fallback branch from `resolveProvisionedUserId` + `getOrCreateInternalUser`. **Prerequisite migration (already landed in PR #882)**: `createProvisionedMockReqRes` helper in `services/api-gateway/src/test/shared-route-test-utils.ts`. The route test files currently mock `requireProvisionedUser` as a no-op. The strict-cutover PR applies the helper to every test file before flipping the middleware — migration + strict flip as one atomic change.
- 🧹 **Delete `getOrCreateUserShell` method + canary log + helper fallback branches** — After the shadow-mode tightening above lands and canary confirms zero hits, the shell path is truly dead. Delete `UserService.getOrCreateUserShell` + its `[Identity] Shell path executed` canary log at `packages/common-types/src/services/UserService.ts:215`. Both `resolveProvisionedUserId` and `getOrCreateInternalUser` collapse to passthroughs reading `req.provisionedUserId` directly. **Also update `eslint.config.js:56`**: the existing ban on direct `prisma.user.create/upsert/createMany` currently names `getOrCreateUserShell` as the canonical HTTP-route alternative — remove that reference when the method is deleted.

### Post-deploy DM subscription loss fix

🐛 `[FIX]` **HIGH priority** — user-facing friction on every release. Every time we ship a release and bot-client restarts, **plain-text DMs silently fail until the user fires a slash command** in the DM. Slash commands work (they go through `interactionCreate` which establishes the DM channel as a side effect). Guild messages work. Only plain-text `MESSAGE_CREATE` events in DMs get dropped on Discord's side.

**Root cause**: Discord doesn't automatically re-subscribe a bot to existing DM channels on gateway reconnect. DM channel subscriptions are per-bot-per-user and ephemeral across bot reconnects. When user DMs a bot that has no active subscription to their DM channel, Discord silently drops the message. Slash-command interactions trigger `POST /users/@me/channels` implicitly, re-establishing the subscription. Once re-subscribed, plain-text DMs route normally until the next bot restart.

**Observed**: 2026-04-20 (initial report, misdiagnosed as user-install state), 2026-04-22 (beta.103 release night, pattern confirmed by user noting correlation with every deploy). The prior "deauth + reauth" mitigation was partially effective because reauth forced the Discord client to re-open the DM channel, incidentally re-subscribing the bot.

**Two-layer fix (belt-and-suspenders)**:

**Layer 1 — Startup pre-warming**: on bot-client `ClientReady`, fetch all Discord IDs of users active in the last N days (30 or 90) from api-gateway, then rate-limited loop `client.users.fetch(id).createDM()` on each. Handles cold-start case so existing users don't need to interact first.

**Layer 2 — Greedy lazy registration**: on any user interaction (message received in guild OR DM, slash command, button, select menu, modal, autocomplete), greedily call `createDM()` for that user's Discord ID. Memoize via in-memory `Set<userId>` so we only fire once per user per bot lifetime. This is the correctness guarantee — any user we see, in any context, gets a live DM subscription established within their first interaction post-restart. Memoization set clears on restart naturally, matching Discord's own subscription lifecycle.

**Architecture**: centralize in a `DMSubscriptionWarmer` service (bot-client), memoizes via `Set<userId>`, rate-limits via simple queue (~10 req/sec to respect Discord's `POST /users/@me/channels` bucket). Both layers funnel through the same service — startup = batch-mode loop, greedy = per-interaction single call.

**Changes needed**:

- (a) new endpoint `GET /internal/users/recent?sinceDays=30` on api-gateway (service-auth protected, returns Discord IDs only) — for Layer 1
- (b) new `DMSubscriptionWarmer` service in `services/bot-client/src/services/` with queue-based rate limiting
- (c) wire Layer 1 into `services/bot-client/src/index.ts` after `Events.ClientReady`, before "fully operational"
- (d) wire Layer 2 into `MessageHandler.handleMessage` (for every non-bot, non-system message) and the `interactionCreate` handler (for every interaction)
- (e) fire-and-forget throughout; log warming progress + failures; circuit-breaker on 429s

**Acceptable residual**: a brand-new user who has never interacted with the bot at all (not in a guild, never triggered a slash command, truly first contact via DM) still needs to slash-command first. Unavoidable without bot-initiated DM creation, which Discord doesn't allow. Layer 2 shrinks this edge case to "first-ever interaction only."

**Start**: `services/bot-client/src/services/` for the new warmer service; `services/bot-client/src/index.ts` around line 256 (`Events.MessageCreate` handler) and 267 (`Events.InteractionCreate`) for Layer 2 wire-up; `services/api-gateway/src/routes/` for the new endpoint.

Promoted from Inbox 2026-04-22.

### Other in-flight

_None beyond the above. TTS Engine Upgrade is Active Epic._
