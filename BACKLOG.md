# Backlog

> **Last Updated**: 2026-04-20
> **Version**: v3.0.0-beta.101 (released — next unreleased bundle starts fresh on develop)

Single source of truth for all work. Tech debt competes for the same time as features.

**Tags**: 🏗️ `[LIFT]` refactor/debt | ✨ `[FEAT]` feature | 🐛 `[FIX]` bug | 🧹 `[CHORE]` maintenance

---

## 🚨 Production Issues

_Active bugs observed in production. Fix before new features._

_None currently._

---

## 📥 Inbox

_New items go here. Triage to appropriate section weekly._

- 🏗️ `[LIFT]` **ShapesDataFetcher hardening — six follow-ons adjacent to the cookie migration** — Web Claude's companion recommendations to the cookie-migration guide. Each item is individually pickable; bundling avoided (they touch different concerns) and full-rewrite avoided (current design is clean). **High-value** (4 items): (1) **schema-drift canary** — Zod-validate top-level response shapes at each endpoint, log `warn` not `throw` on missing fields so partial exports still complete; (2) **persist raw JSON alongside typed output** — cheap schema resilience + user-data-portability win (users may need fields we haven't surfaced); (3) **detect bot-protection** — header-check for `cf-ray`/`cf-mitigated`/`x-px-*`/`x-datadome` + HTML-on-JSON-endpoint, throw a distinct `ShapesBotProtectionError` so the failure mode is obvious vs confusing 403s; (4) **fallback docs** — README section "If this tool stops working" pointing users to GDPR/CCPA data-access-request rights with a template (fast-path vs legally-guaranteed-slow-path framing). **Polish** (2 items): (5) **BullMQ global concurrency cap** (max 2-3 concurrent fetches) — low-and-slow is more ethical + more durable; (6) **distinct 401 failure modes** — (a) first-request cookie expired, (b) mid-job expiry needing page-resume support (this one bundles a real feature), (c) every-attempt-401 meaning cookie name changed again. **Recorded constraint** (do NOT do): no Playwright/Puppeteer/IP rotation/CAPTCHA solving/anti-fingerprinting — shifts project posture from "exercising user rights" to "evading countermeasures," weaker ethically + more fragile. **Full proposal**: [`docs/proposals/backlog/shapes-inc-fetcher-hardening.md`](docs/proposals/backlog/shapes-inc-fetcher-hardening.md). **Sequencing**: queue after the cookie migration lands — these items depend on the new cookie path being stable first. Surfaced 2026-04-22.

- 🧹 `[CHORE]` **Shapes.inc cookie submit hardening — gateway preflight + value-length floor (direct follow-up to PR #869)** — Two defense-in-depth additions on the `POST /user/shapes/auth` endpoint, bundled because both touch the same handler in `services/api-gateway/src/routes/user/shapes/auth.ts`:

  **(a) Live preflight against shapes.inc on cookie submit** — council-recommended during PR #869 design review. Before persisting an encrypted cookie, hit a lightweight shapes.inc endpoint (likely `/api/auth/session` — Better Auth's conventional session-introspection path; needs verification) with the submitted cookie. If it 401s, reject the modal interaction immediately so the user knows their harvested cookie was already expired/invalid, rather than discovering it on their first `/shapes import` attempt ~5 minutes later. **Design questions**: (i) which shapes.inc endpoint is the lightest valid preflight? `/api/auth/session` is the Better Auth default but not guaranteed present; fallback candidates include `/api/shapes/username/me` or a HEAD on any GET endpoint; (ii) transient-failure handling — a shapes.inc 5xx should NOT reject the user's valid cookie, so we need a "preflight inconclusive → persist anyway with a soft warning" path; (iii) latency budget — the gateway already defers-reply, so a 2-3s preflight fits, but a 10s one hurts UX; (iv) rate-limit posture — one preflight per user per save is fine, but log metric-ably so we'd spot any amplification.

  **(b) Server-side token-value length floor** — flagged in claude-bot review of PR #869 (2026-04-22, 12:26 PM). The gateway currently accepts any non-empty value after `__Secure-better-auth.session_token=`, including a single character. The bot-client modal normalizes input through `parseShapesSessionCookieInput` which enforces `SHAPES_TOKEN_MIN_LENGTH` (32 chars) + regex, but a direct API call bypasses the modal parser. Today this doesn't cause silent corruption — the actual auth check happens against shapes.inc on first import — but it does mean we can persist structurally-invalid tokens. **Fix shape**: in `createStoreHandler`, add `sessionCookie.length < expectedPrefix.length + SHAPES_TOKEN_MIN_LENGTH` to the early-reject conditional. Optionally also apply `SHAPES_TOKEN_SHAPE` regex via the `parseShapesSessionCookieInput` helper for full parity with the bot-client gate.

  **Sequencing**: ship (b) as a preamble in the same PR as (a) — it's ~5 lines and a 2-3 line test, and it establishes the "gateway strictly validates submitted cookie shape" foundation that (a) builds on. **Start**: `services/api-gateway/src/routes/user/shapes/auth.ts:~58` (validation block); `services/api-gateway/src/routes/user/shapes/auth.test.ts` for the regression tests. For (a)'s endpoint discovery: test against prod shapes.inc with a known-good cookie before committing to a path. Surfaced 2026-04-22 during PR #869 design review (council) + claude-bot review. Next-up in queue.

- 🏗️ `[LIFT]` **Split BACKLOG.md into a navigable structure — council-guided design** — Single-file backlog has outgrown the format. Current size is ~48k tokens / ~1100 lines; sections span from 🚨 Production Issues through 🧊 Icebox + ⏸️ Deferred + References, and individual Inbox entries routinely exceed 20 lines. Navigation via `grep` + line-number jumps works but breaks down for higher-level views ("what's in flight?", "what's blocked on what?"). User-stated reason: there are a LOT of good ideas in flight and no matter how much the "shrink the backlog" feedback gets applied, the backlog keeps growing — because the idea throughput is genuinely high, not because of bloat. That's a feature, not a bug. We need a file structure that scales with idea volume instead of fighting it. **Non-goal**: reinventing Jira. No ticket numbering, no statuses beyond what we already have, no workflow engine. Aim is file-system-native navigability. **Design questions for council**: (a) split by section type (e.g., `backlog/inbox/*.md`, `backlog/icebox/*.md`, `backlog/active-epic/*.md`) vs split by domain/area (e.g., `backlog/bot-client/`, `backlog/ai-worker/`)? (b) one-file-per-item vs grouped-by-theme files? (c) does `CURRENT.md` get a similar treatment, or does it stay as a session tracker rooted at the top level? (d) how to preserve the "Production Issues → Current Focus → Quick Wins → Active Epic → Future Themes → Icebox → Deferred" topology when items live in separate files? (e) mechanical enforcement: tooling to prevent drift (e.g., `pnpm ops backlog:index` that rebuilds a top-level index; structure tests that fail if an item lacks required frontmatter). **Start**: consult `tzurot-council-mcp` skill with Gemini 3.1 Pro Preview on the design-questions list; draft a proposal in `docs/proposals/backlog/`; pilot on one section (Icebox likely — least active) before migrating the whole thing. Surfaced 2026-04-22.

- ✨ `[FEAT]` **Migrate Nyx persona from global CLAUDE.md to a user-level custom output style** — Nyx (the personality/tone/communication-rules block) currently lives in `~/.claude/CLAUDE.md` Universal Preferences. This works but couples persona with instruction-set content (safety rules, keybindings, Steam Deck env). Claude Code now supports custom output styles (see https://code.claude.com/docs/en/output-styles) — persona could move to a dedicated `~/.claude/output-styles/nyx.md` (or similar), leaving CLAUDE.md for mechanical prefs and safety constraints only. **Requirements**: (a) do NOT lose the "Explanatory" style's Insights-box format — user explicitly values that; the new style should merge Nyx persona + Explanatory format; (b) research what's actually customizable in output styles (full prompt override? delta layer?); (c) verify that the style activates automatically across all sessions (not per-project) since Nyx is a cross-project persona; (d) determine whether merging two styles (Nyx + Explanatory) is supported or if we need to fork Explanatory's template and add Nyx to the fork. **Investigation steps**: (1) fetch and read https://code.claude.com/docs/en/output-styles end-to-end; (2) inspect `~/.claude/output-styles/` (if exists) for existing style definitions; (3) inspect built-in styles for the Explanatory definition as a template; (4) pilot as `nyx.md` in a throwaway project before promoting to user-level default. **Start**: WebFetch the output-styles doc; `ls ~/.claude/output-styles/ 2>/dev/null` to see if the directory exists and what's in it. Surfaced 2026-04-22.

- 🧹 `[CHORE]` **Security audit pass — malicious user behavior, DDoS surface, public-endpoint privilege escalation** — Systematic review of what a hostile user could do to harm the app. Scope: (a) **api-gateway public / unauth endpoints** (image proxy, any media CDN routes, health checks, anything without `requireUserAuth` / `requireProvisionedUser`) — rate limits, resource consumption bounds, input validation; (b) **endpoint authz escalation** — any route where `req.userId` / `req.provisionedUserId` could be spoofed upstream or where crafted params let a user access another user's data (persona IDs, character IDs, memory IDs, preset IDs across isolation boundaries); (c) **DDoS / DoS amplification** — expensive operations a single request can trigger (embedding generation, large AI context pulls, transcription jobs, TTS synthesis, multi-chunk voice), lack of per-user rate limits on paid-by-us LLM/TTS/STT calls, unbounded `findMany` queries still lurking after the 03-database.md sweep; (d) **webhook / bot-client surface** — what a malicious Discord user could craft via slash-command args, message content, or voice attachments to exhaust resources (huge attachments, recursive references, adversarial reasoning-tag payloads); (e) **secret leakage paths** — logs, error messages, PR bodies, commit history, git blame on removed env-handling code. **Fix shape**: this is an audit meta-task that produces a list of concrete backlog items, not a single PR. Suggested structure: (1) run `/security-review` skill on the current branch as a first pass — covers the OWASP-ish code-level findings; (2) `pnpm ops xray --summary` on api-gateway + bot-client to enumerate public/unauth endpoints and walk each against categories a-d; (3) output: one Inbox entry per finding, grouped by severity (critical / high / medium / low). **Start**: `pnpm depcruise` + `pnpm ops xray --summary` for the surface map; `services/api-gateway/src/routes/` for endpoint enumeration; `grep -r 'requireUserAuth\|requireProvisionedUser' services/api-gateway/src/routes/` to find the auth boundary. Surfaced 2026-04-22.

- ✨ `[FEAT]` **Discord system-message handling — welcome/join events in activated channels** — Open question: when a user joins a guild where the bot is activated in the welcome channel, Discord emits a `MESSAGE_CREATE` for the system-generated join message. Does the bot currently see these? Do they arrive as empty-content messages (and fall into whatever guard handles empty content), or as typed system messages with `message.system === true` and a known `MessageType` (`UserJoin`, `GuildBoost`, `ChannelPinnedMessage`, etc.)? If unhandled, the risk is either (a) silent pass-through to the AI with empty input (bad-quality responses), (b) duplicate responses (one to the system msg, one to anything the user actually types after), or (c) they're dropped entirely and we miss a UX opportunity for personality-aware welcomes. **Investigation steps**: (1) grep `MessageType.UserJoin`, `message.system`, and `isSystem` across `services/bot-client/src/handlers/MessageHandler.ts` + `PersonalityMessageHandler.ts` — see if there's explicit handling today; (2) test in a local guild by joining with a second account — observe what fires in ai-worker logs; (3) inspect `message.content` for system messages (typically empty string with `message.system === true` and `message.type === MessageType.UserJoin`). **Decision points after investigation**: ignore them explicitly (safest default, ship as a guard), respond with a personality-aware welcome (feature opportunity, opt-in per guild), or surface only when channel is explicitly configured for welcomes. Surfaced 2026-04-21.

- 🐛 `[FIX]` **Post-deploy DM subscription loss — bot-client doesn't re-establish DM channels on startup or after user activity** — Every time we ship a release and bot-client restarts, **plain-text DMs silently fail until the user fires a slash command** in the DM. Slash commands work (they go through `interactionCreate` which establishes the DM channel as a side effect). Guild messages work. Only plain-text `MESSAGE_CREATE` events in DMs get dropped on Discord's side. **Root cause**: Discord doesn't automatically re-subscribe a bot to existing DM channels on gateway reconnect. DM channel subscriptions are per-bot-per-user and ephemeral across bot reconnects. When user DMs a bot that has no active subscription to their DM channel, Discord silently drops the message. Slash-command interactions trigger `POST /users/@me/channels` implicitly, re-establishing the subscription. Once re-subscribed, plain-text DMs route normally until the next bot restart. **Observed**: 2026-04-20 (initial report, misdiagnosed as user-install state), 2026-04-22 (beta.103 release night, pattern confirmed by user noting correlation with every deploy). The prior "deauth + reauth" mitigation was partially effective because reauth forced the Discord client to re-open the DM channel, incidentally re-subscribing the bot.

  **Two-layer fix (belt-and-suspenders)**:

  **Layer 1 — Startup pre-warming**: on bot-client `ClientReady`, fetch all Discord IDs of users active in the last N days (30 or 90) from api-gateway, then rate-limited loop `client.users.fetch(id).createDM()` on each. Handles the cold-start case so existing users don't need to interact first. Bounded by the "recent activity" window.

  **Layer 2 — Greedy lazy registration**: on any user interaction (message received in guild OR DM, slash command, button, select menu, modal, autocomplete), greedily call `createDM()` for that user's Discord ID. Memoize via an in-memory `Set<userId>` so we only fire once per user per bot lifetime. This is the correctness guarantee — any user we see, in any context, gets a live DM subscription established within their first interaction post-restart. Handles new users, idle-past-window users, and any edge case the startup query misses.

  **Architecture**: centralize in a `DMSubscriptionWarmer` service (bot-client), memoizes via `Set<userId>`, rate-limits via simple queue (~10 req/sec to respect Discord's `POST /users/@me/channels` bucket). Both layers funnel through the same service — startup = batch-mode loop, greedy = per-interaction single call. Memoization set clears on restart naturally, matching Discord's own subscription lifecycle.

  **Changes needed**:
  - (a) new endpoint `GET /internal/users/recent?sinceDays=30` on api-gateway (service-auth protected, returns Discord IDs only) — for Layer 1
  - (b) new `DMSubscriptionWarmer` service in `services/bot-client/src/services/` with queue-based rate limiting
  - (c) wire Layer 1 into `services/bot-client/src/index.ts` after `Events.ClientReady`, before "fully operational"
  - (d) wire Layer 2 into `MessageHandler.handleMessage` (for every non-bot, non-system message) and the `interactionCreate` handler (for every interaction)
  - (e) fire-and-forget throughout (bot-client processes events normally during warming); log warming progress + failures; circuit-breaker on 429s

  **Acceptable residual**: a brand-new user who has never interacted with the bot at all (not in a guild, never triggered a slash command, truly first contact via DM) still needs to slash-command first. This is unavoidable without bot-initiated DM creation, which Discord doesn't allow. Layer 2 shrinks this edge case to "first-ever interaction only."

  **Priority**: HIGH — this causes friction for every user every release. Highest-impact FIX bug currently backlogged. **Start**: `services/bot-client/src/services/` for the new warmer service; `services/bot-client/src/index.ts` around line 256 (`Events.MessageCreate` handler) and 267 (`Events.InteractionCreate`) for Layer 2 wire-up; `services/api-gateway/src/routes/` for the new endpoint.

- 🧹 `[CHORE]` **Test coverage for sample-rate-mismatch warn path in `ttsSynthesizer.ts`** — The multi-chunk TTS synthesis path has a best-effort warn-log when chunks return different sample rates (rather than hard-failing on mismatch). The warn emission isn't currently tested. Low risk in practice because voice-engine uses a single model that can't actually produce mismatched rates — but belt-and-suspenders coverage would pin the contract. **Fix shape**: in `ttsSynthesizer.test.ts`, add a test that mocks two chunks with different sample rates and asserts `logger.warn` was called with the expected fields. **Start**: `services/ai-worker/src/services/voice/ttsSynthesizer.test.ts`. Surfaced by claude-bot review on release PR #867 (2026-04-22).

- 🧹 `[CHORE]` **Add `userId` context to `getOrCreateInternalUser` shadow-mode throw** — In `services/api-gateway/src/routes/user/userHelpers.ts`, the shadow-mode fallback path throws `new Error('User not found after creation')` with no user context if the fallback fires (extremely unlikely, but a genuine runtime guard). Without `userId` in the message, a prod incident would be harder to triage. **Caveat — very likely obsolete**: Phase 5c final cleanup (already in Active Epic) deletes the shell path entirely. If that cleanup lands before this polish, the throw site disappears naturally. Only pick this up if Phase 5c cleanup stalls for > 1-2 weeks. **Fix shape**: include `userId` in the Error message (or convert to a structured `logger.error({ userId, ... }, 'msg')` + throw sentinel). Surfaced by claude-bot review on release PR #867 (2026-04-22).

- 🧹 `[CHORE]` **Refactor `preset/dashboardButtons.handleDeleteButton` to defer before Redis session lookup** — The `getSessionDataOrReply` helper does a Redis session lookup then either returns data or calls `interaction.reply(SESSION_EXPIRED)`. When called from `handleDeleteButton`, the Redis lookup precedes any `defer*` / `reply`, meaning a slow Redis round-trip would consume Discord's 3-second interaction budget. Today's Redis is fast enough that this hasn't surfaced in practice, but the pattern is replicated across handlers. **Blocker on the simple fix**: if the caller does `deferUpdate` first, `getSessionDataOrReply`'s fallback `interaction.reply(SESSION_EXPIRED)` would error because the interaction is already acked. **Fix shape**: add a sibling helper (or refactor existing) that takes an already-deferred interaction and uses `followUp` for the SESSION_EXPIRED branch. Then update `handleDeleteButton` to `deferUpdate` first, then call the new helper. **Start**: `services/bot-client/src/utils/dashboard/sessionHelpers.ts:192` `getSessionDataOrReply`; `services/bot-client/src/commands/preset/dashboardButtons.ts:210` `handleDeleteButton`. Character's equivalent handler was fixed in a prior sweep — this is the remaining instance. Surfaced 2026-04-19 during PR #836 r4 review; narrowed 2026-04-21.

- 🧹 `[CHORE]` **Investigate bot-client Pino log-level `info`-vs-`warn` drift** — While diagnosing the voice-engine over-size bug on 2026-04-19, the incident log entry `TTS audio exceeds Discord file size limit, skipping attachment` appeared as `level: "info"` in the Railway JSON stream even though `services/bot-client/src/services/DiscordResponseSender.ts:254` emits it via `logger.warn(...)`. Either Pino's numeric-level config is being flattened to `info` somewhere in the bot-client transport pipeline, or the stream is relabelling. Makes `railway logs --filter '@level:warn'` and similar severity-based filters unreliable across services — which matters for future incident response. **Fix shape**: (a) pick a known `logger.warn` callsite in bot-client; capture a real emitted log from prod via `railway logs --json`; (b) compare the `level` field value to what Pino should emit per its level map (`warn = 40`); (c) trace the logger bootstrap in `packages/common-types/src/utils/createLogger.ts` (or wherever the factory lives) and any Railway-side forwarding. Either the pino config is misconfigured (e.g., `formatters.level` returning the wrong shape) or a transport is stripping numeric levels and re-emitting as strings. **Start**: `services/bot-client/src/services/DiscordResponseSender.ts:254` (known warn call) + `packages/common-types` logger factory. Cross-check against ai-worker logs — those DID emit `level: "info"` / `level: "error"` correctly in the same incident window, so the drift may be bot-client-specific. Surfaced 2026-04-19.

- 🐛 `[FIX]` **Near-duplicate consecutive replies on `glm-4.5-air:free` — observability-first investigation** — Rare but recurring: `z-ai/glm-4.5-air:free` occasionally emits two consecutive responses with near-byte-identical bodies. Frequency has been trending down, possibly due to reasoning-mode usage, but the root cause isn't known. Two rounds of council pressure-test narrowed the hypothesis space but did not identify a definitive fix — see details below.

  **What we've ruled out** (do not retry any of these):
  - **Request-hash cache busting (nonce in system prompt)**: previously tried, did not resolve. So this is NOT OpenRouter/provider-level hash-keyed caching — changing payload bytes doesn't help.
  - **Temperature jitter**: breaks this specific model — output quality collapses above a narrow operating range.
  - **Threshold adjustment**: math doesn't support it. Prod NEAR_MISS distribution clusters at 0.72–0.78, and council (Gemini 3.1 Pro Preview, 2026-04-19) showed that a one-adjective difference in a multi-paragraph response yields Jaccard ≥ 0.95, so a genuine near-duplicate from this failure mode would NOT land in the 0.72–0.78 band. The observed NEAR_MISS distribution is baseline persona-style overlap, not almost-caught duplicates.

  **Working hypothesis**: **model-inference-level stickiness** — `glm-4.5-air:free` has sampling or attention patterns that produce very similar outputs across near-identical prompts, independent of OpenRouter's cache. This would be a Z-AI-provider-side behavior, not something we can prevent at the request layer.

  **Secondary hypothesis**: **DB write-read race** — bot-client's `MessageHandler.ts:154` delivers response to Discord BEFORE `saveAssistantMessage()` at line 171 persists to DB. A rapid user follow-up fires a new job before persistence completes, so the follow-up's `conversationHistory` snapshot (from `ConversationHistoryService.getChannelHistory`) misses the prior response. Duplicate detector then compares against older unrelated messages (baseline 0.72–0.78 overlap) and passes. Small race window (typically <200ms) but non-zero.

  **Approach — observability-first, not fix-first** (PR in flight, 2026-04-19):
  - Expanded `CrossTurnDetection` diagnostic logging: full per-message `comparisonReport` (8-char hash, 80-char prefix, Jaccard and bigram scores) for every check, so the next incident gives us ground-truth data instead of requiring another hypothesis round.
  - Race-window telemetry in `ContextStep`: computes delta between job creation time and newest-assistant-message persisted timestamp. Logs `warn` when delta < 500ms (would indicate race is firing).
  - Reasoning-mode actual-vs-requested telemetry in `ResponsePostProcessor`: logs whether reasoning was configured AND whether the response actually contained reasoning tokens. User reports reasoning mode sometimes fails to engage on this model; knowing whether incidents correlate with non-engaged reasoning is a useful signal.

  **Runbook for next incident** (when user reports a duplicate):
  1. Get approximate UTC time, channel ID, personality, and whether reasoning mode was requested.
  2. `railway logs --service ai-worker --json | jq -c 'select(.name == "CrossTurnDetection")' | grep <jobId or time window>` — inspect `comparisonReport` for the affected job. Was the prior response in the list? What were its scores?
  3. Check for `[ContextStep] Race-window signal` warnings near that time. If present, the race is the cause.
  4. Check `[ResponsePostProcessor] Reasoning mode requested but did NOT engage` around that time. Correlation with duplicate incidents tells us whether reasoning-mode reliability is part of the story.
  5. If none of the above explain it, the model-inference-stickiness hypothesis stands — potential mitigations include swapping models for specific users, adding a user-facing "regenerate" button, or accepting the residual given low frequency.

  **Why we're not fixing aggressively**: the user has invested in many rounds of model-specific patches for this model already (echo parroting, hallucinated tool-use XML, `<received message>` echo). Frequency is trending down. Observability first, targeted fix when the diagnostic data is in hand, rather than another hypothesis-shopping round.

  **Start**: the observability PR (commits `<TBD>` on develop). Once merged, monitor prod logs. On next occurrence, correlate `comparisonReport` against the user's observation. Surfaced 2026-04-19; diagnostic PR same day.

- 🐛 `[FIX]` **Character `Open Editor` can still blow the 3-second window on cold cache + slow gateway** — The two-click Edit-with-Truncation flow (PR #825 option b) materially narrowed but did not fully eliminate the 3-second risk. `handleOpenEditorButton` in `services/bot-client/src/commands/character/truncationWarning.ts` still calls `resolveCharacterSectionContext` before `interaction.showModal` — because Discord requires `showModal` to be the first response to an interaction, we can't `deferReply` before the resolve. In the common case the session is hot from step 1's warm and this is a sub-ms Redis hit. But a cold-cache fallthrough (Redis eviction, pod cold start, TTL past the step-1 warm window) routes through the gateway's `fetchCharacter`, which can take hundreds of ms to multi-seconds under load. When that blows the window, the handler's 10062 catch surfaces a visible retry message — not silent, but the user is already one click deep into a consent flow and the retry ask is confusing. Surfaced by PR #825 R8 (2026-04-17).

  **Why tracked now (low priority)**: the 10062 fallback is user-actionable (clicks "Open Editor" again, fresh 3-sec window, very likely succeeds on second try), so the bug is not silent. But the retry UX could be improved.

  **Fix options** (none urgent):
  - **(a)** Pre-resolve the full `CharacterSectionContext` during step 1's warm and stash it in an in-memory cache keyed by the `open_editor` button's customId. Step 2 retrieves synchronously, builds modal, `showModal` with zero async work. Works for single-replica bot-client; breaks on multi-replica unless the cache is Redis-backed (which reintroduces the async). Tzurot is currently single-replica for bot-client (Discord gateway requirement).
  - **(b)** Pre-build the modal (not just the context) during step 1 and stash the modal JSON. Same trade-offs as (a).
  - **(c)** Just raise the gateway timeout on `fetchCharacter` when called from the session-helpers path so the cold-cache fetch reliably fits in 3 sec. Smallest change but doesn't defend against the raw Redis latency spike.
  - Do nothing: the 10062 retry path is user-actionable. Accept the residual and rely on the warn log for frequency monitoring.

  **Start**:
  - Handler with the residual race: `services/bot-client/src/commands/character/truncationWarning.ts` `handleOpenEditorButton`
  - 10062 catch: same file, immediately after `await interaction.showModal(modal)`
  - Session-warm origin: same file, `handleEditTruncatedButton` step 2
  - Session layer with the gateway fallback: `services/bot-client/src/utils/dashboard/sessionHelpers.ts` `fetchOrCreateSession`

- 🐛 `[FIX]` **Stale "Open Editor" button after step-1 session-warm failure in character truncation flow** — Sibling to the 3-sec residual entry above. When `handleEditTruncatedButton`'s session warm fails (character-deleted race between warning display and opt-in click), the handler already sent `interaction.update` with the "Ready to edit" embed + Open Editor button; `loadCharacterSectionData` then sent a followUp error; but the Open Editor button is still visible. If the user clicks it, `resolveCharacterSectionContext` fails again and sends a second redundant followUp. User sees two back-to-back "Character not found" messages with a stale button between them. Flagged by PR #825 R10 (2026-04-17).

  **Not a data-safety issue**: the second failure is just UX noise. The user can close the warning and re-open the dashboard; no data is lost or corrupted. That's why this is tracked separately from the 3-sec residual rather than bundled in as a blocker.

  **Fix options**:
  - **(a)** On warm-null return, send a **second** `interaction.editMessage` to disable the Open Editor button (set `.setDisabled(true)`) so clicking it is impossible. Cleanest UX; requires tracking the original message id since the interaction is acked.
  - **(b)** On warm-null return, replace the "Ready to edit" embed entirely with the error state via `interaction.editReply` (in place of the followUp). Removes the stale button by replacing its container. UX is clearer (one message, one state) but requires rework of the `loadCharacterSectionData` error-reply path since it currently sends a followUp, not an editReply.
  - **(c)** Accept the double-error UX. The underlying state (character deleted) is rare enough that the edge case doesn't warrant the complexity. Log-only fix + documentation comment.

  Option (c) is what the code currently does. (a) or (b) are the UX improvements.

  **Start**:
  - Warm-failure branch: `services/bot-client/src/commands/character/truncationWarning.ts` `handleEditTruncatedButton` — the `if (warmResult === null)` block
  - Followup sender (the stale message producer): `services/bot-client/src/commands/character/sectionContext.ts` `replyError` + `loadCharacterSectionData`

- 🧹 `[CHORE]` **Add lint/test assertion that dashboard section fields declare `maxLength`** — `detectOverLengthFields` in `services/bot-client/src/commands/character/truncationWarning.ts` (and by extension the character field silent-truncation warning) intentionally skips fields where `field.maxLength === undefined`, because `ModalFactory` applies default caps only at modal-show time and we don't want to warn about defaults users can't configure. The tradeoff: if a new section field is ever added to `services/bot-client/src/commands/character/config.ts` without an explicit `maxLength`, the silent-truncate path for that field silently re-opens and users lose data with no warning — same bug the PR #825 fix was designed to prevent, just scoped to new fields. Currently nothing enforces `maxLength` presence; the protection is "discipline + code review." Flagged in PR #825 R3 (2026-04-17).

  **Fix options**:
  - **(a)** Narrow the `FieldDefinition` type: make `maxLength` required on text/paragraph input types. Catches the bug at compile time; may require minor churn at each call site that currently omits it.
  - **(b)** Add a structure.test.ts-style assertion that walks the dashboard config and fails CI if any field has input `TextInputStyle.Paragraph` / `Short` without `maxLength`. Runtime check, same signal, weaker — runs only in CI.
  - **(c)** Doc-only: add a JSDoc note on `FieldDefinition.maxLength` documenting the invariant, relying on code review. Weakest, not recommended.

  Option (a) is the cleanest long-term. (b) is the cheaper short-term.

  **Start**:
  - Current skip logic: `services/bot-client/src/commands/character/truncationWarning.ts` `detectOverLengthFields`
  - Field definitions: `services/bot-client/src/utils/dashboard/types.ts` (look for `FieldDefinition`)
  - Consumer config: `services/bot-client/src/commands/character/config.ts`

- 🐛 `[FIX]` **Typing indicator intermittently stops during long AI responses — investigate** — User has observed the "bot is typing…" indicator disappearing before the AI response actually lands, multiple times, not yet reproduced deterministically. Unclear whether this is a bot-side bug (failed `sendTyping` refresh not recovering) or a Discord client-side display glitch (indicator sent but not rendered).

  **Current implementation — two independent typing loops**:
  - `services/bot-client/src/services/JobTracker.ts:85-149` — fires `channel.sendTyping()` every 8s (`TYPING_INDICATOR_INTERVAL_MS`) until the 10-min cutoff (`TYPING_INDICATOR_TIMEOUT_MS`) or job completion. Errors are logged and **swallowed** at lines 144-146 (comment: "channel might be temporarily unavailable"); the interval continues.
  - `services/bot-client/src/services/VoiceTranscriptionService.ts:186-198` — independent interval at the same 8s cadence for voice-transcription flows, also swallowing errors (lines 194-196).

  **Known constants**:
  - Discord's typing indicator expires ~10s after the last ping.
  - Refresh at 8s → only a **2-second buffer**. A single missed refresh can cause a visible dropout until the next 8s tick succeeds.
  - discord.js v14.26.2 (`services/bot-client/package.json`).

  **Hypotheses to investigate** (ranked by likelihood):
  1. **Rate limiting on `sendTyping`** — Discord rate-limits `POST /channels/{id}/typing` per-channel. When the bot processes multiple @mentions in the same channel simultaneously (e.g., two users pinging different personalities at once), two JobTracker entries fire typing every 8s each into the same channel, doubling the effective rate. Under concurrent usage this can hit the channel rate limit. The current `catch` block treats 429s identically to any other error — no backoff, no logging differentiation. **Cheapest investigation**: Railway log search for `'[JobTracker] Failed to send typing indicator'` grouped by channel and by 5-min windows. If rate-limited, retry-after headers should be attached to the rejected request in discord.js.
  2. **Handoff gap between VoiceTranscriptionService and JobTracker** — for voice-message flows: VoiceTranscriptionService runs its typing loop during transcription, then terminates its interval when transcription finishes. PersonalityMessageHandler then starts JobTracker's typing loop for the AI response. If the handoff takes >2s (voice transcription cleanup + AI job submission), the Discord indicator will flicker off between the last VoiceTranscriptionService ping and the first JobTracker ping. **Check**: grep for the handoff site — probably `PersonalityMessageHandler` or the voice-message path in `MessageHandler` — and measure the wall-clock gap between the two intervals.
  3. **Gateway disconnect/reconnect during long jobs** — if the bot's gateway connection drops and auto-reconnects mid-job, the `typingInterval` keeps firing in-process but the `sendTyping` REST calls may fail silently or queue. After reconnect, queued calls may or may not succeed. **Check**: correlate typing dropouts with `Client#disconnect`/`Client#resume` events. discord.js logs these at `info` if `rest.debug` is enabled.
  4. **Discord client-side rendering bug** — known anecdotally that Discord desktop and mobile clients sometimes fail to display the typing indicator even when the gateway delivered the event. More common on mobile and intermittent connections. **Not fixable bot-side**; only relevant to rule out. **Check**: does the user see the dropout on desktop, mobile, both? Reproducible in a second client?
  5. **Abuse-prevention heuristics** — anecdotal reports in Discord developer community that the server suppresses typing indicators that have been running continuously for "a long time" as abuse prevention. No official documentation. **Check**: does the dropout correlate with job age? Jobs >5 min showing dropouts more often than fast jobs?
  6. **discord.js bug or regression** — v14.26.2 is recent; check release notes for any typing-related changes. **Check**: GitHub issues on discord.js for `sendTyping` + `indicator` in the last 6 months.

  **Investigation steps (in order)**:
  1. **Differentiate error types in the catch block** — at `JobTracker.ts:144` and `VoiceTranscriptionService.ts:194`, classify the error: 429 rate-limit → log at warn with retry-after and next-refresh offset; network → log at info (transient); channel-gone (404 / 50013) → log at error and clear the interval (no point continuing). Ship this first — it's a prerequisite for every other investigation step because today the logs don't distinguish failure modes.
  2. **Add per-channel aggregation telemetry** — count of `sendTyping` calls and failures per channel per 5-min window. Surfaces rate-limit patterns. Can live in the existing logger output; no new infrastructure required.
  3. **Measure the voice-handoff gap** — instrument the transition from VoiceTranscriptionService → JobTracker with a timestamped log pair. If the gap is >2s on the reproducer cases, this is almost certainly the voice-specific failure mode.
  4. **User-side reproduction capture** — when the user notices a dropout next, they record: (a) channel, (b) approximate time (UTC), (c) whether it was a voice message or text, (d) whether it was a long reply or a short one, (e) client (desktop/web/mobile). Cross-reference with the differentiated logs from step 1.

  **Remediation options (pick after findings)**:
  - **If rate-limiting**: reduce refresh rate (8s → 7s widens buffer but also increases rate), OR coalesce typing loops per-channel (one loop per channel regardless of how many jobs are active), OR back off on 429 instead of silently retrying at the fixed 8s cadence.
  - **If voice-handoff gap**: continue the first typing loop across the handoff rather than restarting fresh. Pass the `sendTyping` responsibility through the VoiceTranscription → PersonalityMessage transition without a gap.
  - **If gateway reconnect**: subscribe to `Client#resume` and re-fire typing for all tracked jobs on reconnect.
  - **If Discord client bug**: nothing to do bot-side; document and close.

  **Why this deserves investigation despite being a "small" UX bug**: the typing indicator is the sole signal a user has that the bot received their message and is working on it. Dropouts → users assume "bot is broken" → they retry → duplicate requests → more load → more rate limits → more dropouts. The feedback loop makes it worse under load, not self-healing.

  **Start**: `services/bot-client/src/services/JobTracker.ts:141-147` (the silent-swallow catch) is the bottleneck for every investigation step. Step 1 (error differentiation) is the cheapest action and unblocks the rest. Related existing item: the "JobTracker orphan sweep" entry directly below — if orphan sweep lands first, factor the error-differentiation change into the same PR since both touch the same interval callback.

- 🐛 `[FIX]` **Kimi K2.6 reasoning leaks as plain text — recommend reasoning-off on K2.x presets + add detection telemetry** — Kimi K2.6 via OpenRouter (`moonshotai/kimi-k2.6`) emits its chain-of-thought as plain narration mingled with the final response, terminated by `"Final decision:\n<actual answer>"`. No `<think>` / `</think>` tags, no orphan closing tag (unlike K2.5's documented quirk), and OpenRouter's `message.reasoning` field is not populated (`hasReasoningInKwargs: false`, `hasReasoningDetails: false`, `hasReasoningTagsInContent: false`). Our thinking-extraction utility correctly finds nothing to extract because nothing is structurally marked — a full 1,500-token reasoning dump reaches Discord as the visible "response." Example: `requestId 3876327d-5e6f-4361-a6ac-5840843584a9` (2026-04-21) — user said `@Cold test`, got 158 seconds of reasoning plus 6 words of actual answer.

  **Council consultation (Gemini 3.1 Pro Preview, 2026-04-21)**: this is a known-class upstream parser lag — Moonshot changed K2.6's CoT delimiter from K2.5's orphan `</think>` to a plain-text `"Final decision:"` marker, and OpenRouter's reasoning parser hasn't been updated. Prompt-level fixes (instructing the model to wrap reasoning in tags) fight the model's RL training and are unreliable.

  **Recommended user-facing action (not a code change)**: turn reasoning OFF on any preset pointing at `moonshotai/kimi-k2.6`. Reviewing the actual reasoning content in the debug log showed it was low-value narration (personality rehashing, format-rule debating) with no chain-of-thought quality that justifies 10x the token cost + latency. `reasoning.enabled: false` gives a strictly better UX for this model.

  **Heuristic extractor (Option 2 council recommended) — deliberately NOT building now**: a split-on-`"Final decision:"` / `"Final answer:"` / `"I'll go with:"` regex would work for K2.6's current output pattern but has false-positive risk on legitimate roleplay content ending in those phrases, AND the underlying reasoning content isn't valuable enough to surface. Revisit if (a) a future Kimi release produces high-quality reasoning with the same broken structure, OR (b) users report preferring K2.6-with-reasoning despite the cost/quality trade-off.

  **Cheap telemetry (SHIPPED)**: per-model `reasoning-did-not-engage` warn-log added to `ResponsePostProcessor.ts` by bundling `modelName` into the existing reasoning-engagement diagnostic. Log searches can now grep `@level:warn AND "did NOT engage"` with a `modelName` field — when K2.7 or similar ships we'll see the parse-miss rate per model.

  **Upstream follow-up**: file issue with OpenRouter asking them to recognize Kimi K2.6's `"Final decision:"` delimiter and populate `message.reasoning` accordingly. If accepted, our heuristic becomes unnecessary.

- 🧹 `[CHORE]` **Apply `ApiCheck<T>` pattern to the 3 autocomplete caches (follow-up to the class-of-bug fix)** — The critical callsites (`checkNsfwVerification`, `checkGuestModePremiumAccess`) were fixed in a PR that introduced `services/bot-client/src/utils/apiCheck.ts` and established per-callsite fail-open / fail-closed policies. Three medium-severity instances remain in `services/bot-client/src/utils/autocomplete/autocompleteCache.ts`: `getCachedPersonalities` (~line 88), `getCachedPersonas` (~line 141), `getCachedShapes` (~line 192). All three return `[]` on API error, so transient failures make users see empty autocompletes and think they have no personalities/personas/shapes (60s cache TTL limits blast radius but doesn't fix the false "empty" perception). **Fix shape**: widen each cache's return to `ApiCheck<T[]>`; each autocomplete handler renders a single non-selectable placeholder `[Unable to load — try again]` choice on `{ kind: 'error' }`. **Open product question** (decide at implementation time): do we want to show stale-cache-past-TTL as a third fallback option, or is the error placeholder enough? **Start**: `services/bot-client/src/utils/autocomplete/autocompleteCache.ts`; the three autocomplete handlers in `services/bot-client/src/utils/autocomplete/`. Surfaced by Explore pass 2026-04-21.

- 🧹 `[CHORE]` **Automate step 5 of release flow ("rebase develop onto main after merge")** — The git-workflow skill documents this step but nothing enforces it. Got skipped after beta.98 shipped; showed up ~24 hrs later as "conflicts with main" on the beta.99 release PR (develop still had pre-rebase SHAs for beta.98-era commits while main had the post-rebase versions). The content was identical — git rebase auto-skipped via `--reapply-cherry-picks` behavior — but the PR looked scary until we diagnosed it. Fix shape: (a) add a `pnpm ops release:finalize` command that runs `git fetch --all && git checkout main && git pull && git checkout develop && git pull && git rebase origin/main && git push --force-with-lease` and prompts for confirmation at each step; (b) alternatively, extend `pnpm ops release:tag` (or whatever posts the GitHub release) to run the rebase as its final action; (c) add a pre-session-start guard that detects "main has commits develop doesn't have same-SHA" and reminds to finalize. Surfaced during beta.99 release. **Start**: `packages/tooling/src/commands/release.ts` — already has `release:bump`, adding `release:finalize` fits naturally. Test case: simulate post-merge state with a local-only `main` ahead of develop.
- 🧹 `[CHORE]` **Add `pnpm ops release:verify-notes` command** — Compares proposed release notes against `git log v<previous-tag>..HEAD --no-merges` to catch duplicate/missing items. The beta.94 release had 4 items duplicated from beta.93 because notes were written from CURRENT.md (session tracker) instead of the actual tag diff. The git-workflow skill now documents the correct process, but a tooling command would enforce it mechanically. **Start**: `packages/tooling/src/commands/release.ts` — add a `verify-notes` subcommand that parses release notes markdown, extracts PR numbers, and cross-checks against the commit range.

## 🎯 Current Focus

_This week's active work. Max 3 items._

### Identity & Provisioning Hardening Epic — Phase 5c (next)

Phases 1–5b shipped 2026-04-16 (PRs #803/#807/#808/#814/#816/#817/#818). **Phase 5c** is queued: eliminate the `getOrCreateUserShell` path entirely. It exists because api-gateway HTTP routes only see `discordUserId` in `req.userId`, but the only HTTP client (bot-client) already has the full Discord interaction context at slash-command-handler time. Fix shape: pre-provision via `getOrCreateUser(discordId, username, displayName, bio)` in bot-client before any HTTP call; api-gateway routes switch to `findUserByDiscordIdOrFail` (404 if not provisioned); delete `createShellUserWithRaceProtection`, `buildShellPlaceholderPersonaName`, and the placeholder-rename block in `runMaintenanceTasks`. Council pressure-test first — the API contract for "user must exist" is a middleware-vs-handler design call. **Also fold in**: (a) tighten `User.defaultPersona` relation in Prisma schema from `Persona?` to `Persona` (relation field is stale after Phase 5b made the scalar FK `String` NOT NULL — surfaced in PR #819 review); (b) make `test-utils` import `DEFAULT_PERSONA_DESCRIPTION` (already extracted to `packages/common-types/src/constants/persona.ts` in PR #819) instead of mirroring the literal. Tried during PR #819 review — fails because Turbo's build DAG treats common-types's devDependency on `@tzurot/test-utils` as a build-order edge, and adding common-types as a runtime dep of test-utils creates the inverse edge. Breaking the cycle requires either (i) dropping `@tzurot/test-utils` from common-types's devDependencies and replacing its usage in `.int.test.ts` files with a non-package-dep mechanism (vitest path alias to source, or inlined helpers), or (ii) moving the shared constant(s) into a third standalone package that neither common-types nor test-utils depends on. Both are structural package-graph surgery, which is why they belong in 5c. Both items are type/organization tightenings that pair naturally with the dead-code cleanup 5c enables — after the relation tightens, `PersonaResolver` Priority 3 fallback and the dangling-FK error branches become structurally unreachable and can be deleted too.

After 5c: **Phase 6 — integration test coverage for the refactor-regression class**. Goal: the `c88ae5b7` class of regression fails loudly in tests. End-to-end test exercising "user hits HTTP route → later Discord interaction → system prompt correctness assertion." Estimated ~2 days. Entry point: `docs/reference/architecture/epic-identity-hardening.md § Phase 6`.

### Other in-flight

_None currently. TTS engine upgrade was promoted to Next Epic 2026-04-21._

---

## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

### 🐛 Detect and Retry Inadequate LLM Responses

LLMs occasionally return a 200 OK with garbage content — e.g., glm-5 returned just `"N" (1 token, finishReason: "unknown"`, 160s duration). Needs compound scoring heuristic + timing data threading through RAGResponse. ~4-6hr feature, not a quick win — moved details to Logging & Error Observability theme.

---

## 🏗 Active Epic: Identity & Provisioning Hardening

_Focus: eliminate the structural conditions that let the persona-snowflake bug ship undetected for 4 months. Seven numbered phases, two remaining (5c, 6)._

**Status**: Phases 1–5b shipped to prod by 2026-04-17 (beta.99). Phase 5c PR A (#829) + PR B (#830) merged to develop 2026-04-18 — unreleased, awaiting PR C + Phase 6 to bundle into Release 1. Phase 1 (PR #803, beta.97) tactical heal. Phase 2 (PRs #807/#808, beta.98) provisioning choke point. Phase 3 (PR #814, beta.99) read-only PersonaResolver. Phase 4 (PR #816, beta.99) killed discord:XXXX format. Phase 5 (PR #817, beta.99) DB-level invariants. Phase 5b (PR #818, beta.99) NOT NULL default_persona_id via single-statement CTE bootstrap + backfillDefaultPersona deletion.

**Full epic doc**: `docs/reference/architecture/epic-identity-hardening.md` — phase scopes, decision records (D1–D6), cross-cutting principles.

**Remaining phases**:

- **Phase 5c**: eliminate the shell-creation path entirely. Sub-sequenced across three PRs:
  - **PR A** (shipped 2026-04-18, PR #829): bot-client sends `X-User-Username` + `X-User-DisplayName` headers (URI-encoded) alongside `X-User-Id` on every api-gateway request. `GatewayUser` type in `common-types`.
  - **PR B** (shipped 2026-04-18, PR #830): gateway-side `requireProvisionedUser(prisma)` middleware consumes those headers and provisions via the full `getOrCreateUser` path. Canary log inside `UserService.getOrCreateUserShell` (top 6 frames of stack + `discordId`) tells us when the old path still fires. Shadow-mode: existing handlers still call `getOrCreateUserShell` unchanged.
  - **PR C (remaining)**: swap handlers from `getOrCreateUserShell(req.userId)` → `req.provisionedUserId`. Delete `getOrCreateUserShell`, `createShellUserWithRaceProtection`, `buildShellPlaceholderPersonaName`, the placeholder-rename block in `runMaintenanceTasks`, and the canary log. Fold in:
    - **Double-`UserService` cleanup**: `wallet/setKey.ts` and `services/api-gateway/src/routes/user/llm-config.ts` each construct a local `new UserService(prisma)` in their route factories to call `getOrCreateUserShell`. After the cutover, these can read `req.provisionedUserId` directly and the handler-side UserService construction disappears. Flagged by PR #830 R3 review — not a regression PR B introduced, but PR C is the natural cleanup.
    - **`isBot` param tightening**: middleware omits `isBot` when calling `getOrCreateUser`; currently fine because bot accounts don't reach user-scoped HTTP routes in practice, but PR C's strict-rejection logic should account for bot detection.
    - **Graceful-degradation → strict rejection**: tighten middleware from "fall through on missing/malformed headers" to 400 Bad Request once every prod bot-client is on the new code path (confirmed by zero canary hits for 48–72h).
    - **Username drift-sync**: async fire-and-forget update when header-provided username differs from the stored one (per Gemini council review).
    - **Tightening `User.defaultPersona` relation** in Prisma schema from `Persona?` to `Persona` — relation field is stale after Phase 5b made the scalar FK NOT NULL. Surfaced in PR #819 review.
    - **`test-utils` → `common-types` package-graph cleanup**: make `test-utils` import `DEFAULT_PERSONA_DESCRIPTION` from `common-types`. Blocked on a Turbo build-DAG cycle (common-types has a devDependency on `@tzurot/test-utils`, which would create the inverse edge). Needs structural surgery — either drop the devDependency and swap for a vitest path alias, or move the shared constant(s) into a third standalone package.
    - **Prisma/PGLite test-database factory DRY (follow-on to `createTestPGlite` — 2026-04-22)**: The PGLite-factory refactor landed `createTestPGlite()` that encapsulates only the PGlite constructor + extension set. Deliberately out of scope: a broader `createTestDatabase()` (or `createTestPrisma(pglite)`) helper that would also encapsulate the `new PrismaPGlite(pglite) + new PrismaClient({ adapter })` boilerplate duplicated across all 16 `.int.test.ts` + 1 `.e2e.test.ts` call sites. Same blocker as the `DEFAULT_PERSONA_DESCRIPTION` item above: `@tzurot/common-types` (PrismaClient) + `pglite-prisma-adapter` would need to become runtime deps of `test-utils`, which reopens the Turbo DAG cycle. Unblocked by the same structural fix. Scope once unblocked: move adapter+client construction into test-utils, migrate the ~17 call sites, likely drop `as PrismaClient` casts currently used at the boundary. Surfaced while scoping the `createTestPGlite` PR — explicitly deferred because fixing the DAG cycle is 5c-scale package surgery.
  - **Also closes a known gap** flagged in PR #818 R4 review: the placeholder-rename block in `runMaintenanceTasks` is two separate writes (`user.update` + `persona.updateMany`) with no transaction, so a crash between them leaves the user with the real username but the persona stuck on `"User {discordId}"` — and the `user.username === discordId` guard never retries. PR C removes the block entirely, so the atomicity question disappears rather than needing its own fix.
- **Phase 6**: integration test coverage for the refactor-regression class (would have caught `c88ae5b7`). ~2 days.

**Cross-cutting principle**: council pressure-test BEFORE each phase starts, not mid-implementation. ADR when an architectural choice is made. (Phases 3, 4, 5 all validated this principle — council reframes consistently shrank or correctly-scoped each phase.)

### Phase 5c work items (consolidated from Inbox 2026-04-21)

- 🧹 **Tighten `requireProvisionedUser` shadow-mode to strict 400** — `services/api-gateway/src/services/AuthMiddleware.ts:194-200` already plans this cutover. Safe once Phase 5c PR C (shell-path migration) prod canary stays clean for 48-72h. Middleware returns 400 on missing/malformed user-context headers instead of falling through. Removes the fallback branch from `resolveProvisionedUserId` + `getOrCreateInternalUser`.
- 🧹 **Final Phase 5c cleanup — delete `getOrCreateUserShell` method + canary log + helper fallback branches** — After the shadow-mode tightening above lands and canary confirms zero hits, the shell path is truly dead. Delete `UserService.getOrCreateUserShell` + its `[Identity] Shell path executed` canary log. Both `resolveProvisionedUserId` and `getOrCreateInternalUser` collapse to passthroughs reading `req.provisionedUserId` directly.
- 🧹 **ESLint `no-restricted-syntax` rule banning `UserService.getOrCreateUserShell`** — Blocks reintroduction of the shell path. Do after the method is deleted (above), otherwise the allowlist bookkeeping is noisy. Once deleted, this rule is enforcing "don't bring this back."

### Phase 6 work items (consolidated from Inbox 2026-04-21)

- 🧹 **Route-level integration tests exercising the middleware-attached `provisionedUserId` path** — Pre-existing pattern across all api-gateway route tests: `requireProvisionedUser` is mocked as a no-op that calls `next()` without attaching `req.provisionedUserId`. So every route test exercises the shadow-mode fallback branch of `resolveProvisionedUserId` / `getOrCreateInternalUser`, not the common provisioned path. Helper-level tests in `resolveProvisionedUserId.test.ts` + `userHelpers.test.ts` cover the provisioned branch with structural assertions (no DB calls), so there's a safety net. But route-level zero-DB-round-trip property isn't verified at route depth. Flagged by claude-bot review on PR #858. **Fix shape**: for each route that calls `resolveProvisionedUserId` or `getOrCreateInternalUser`, add at least one test that mocks the middleware to attach `provisionedUserId` + `provisionedDefaultPersonaId`, and assert the handler doesn't hit `prisma.user.findUnique` / `$executeRaw`. **Start**: any of `nsfw.test.ts`, `timezone.test.ts`, `config-overrides.test.ts` for a reference pattern once one is written.
- 🧹 **Real-Postgres integration test coverage for Phase 5 CHECK constraints** — `personas_name_non_empty` and `personas_name_not_snowflake` (added in Identity Epic Phase 5, 2026-04-16) are enforced at the DB level but can't be tested via PGLite. Prisma doesn't represent CHECK constraints in the schema, so `pnpm ops test:generate-schema` doesn't include them in the PGLite-derived test schema. Two invariants currently have zero automated regression coverage — a future migration that accidentally drops them (or a drift-ignore rule that over-matches) would pass all existing tests. **Fix shape options**: (a) dedicated real-Postgres integration test fixture that applies migrations to a real Postgres instance and exercises CHECK constraints directly; (b) extend `pnpm ops test:generate-schema` to parse CHECK constraints from migration SQL and append to the generated PGLite schema; (c) scope into Phase 6's end-to-end integration test work naturally; (d) **intermediate cheap guard**: a `structure.test.ts`-style test that reads `prisma/migrations/*phase_5*/migration.sql` and asserts the CHECK DDL strings are still present. Cheap (~20 LOC + pattern match), no new infrastructure — reasonable stopgap until the real-Postgres fixture lands. Surfaced by claude-bot review on PRs #817, #819.

---

## 📅 Next Epic: TTS Engine Upgrade

_Focus: Eliminate the ~$200/month ElevenLabs recurring cost via self-hosted + BYOK alternatives. Promoted 2026-04-21 from "Current Focus → Other in-flight" after priority-validation discussion (cost bleed outprioritizes tech debt)._

**Status**: Research done 2026-04-12 identified Chatterbox (self-hosted) and Voxtral (BYOK) as top candidates. Gemini 3.1 Flash TTS (announced 2026-04-15, preview) added as third BYOK candidate. No candidate committed yet — hands-on eval is the gate.

**The goal**: ~90% cost reduction (self-hosted) or ~75% (BYOK Voxtral/Fish) on the TTS line item.

**Additive design** (per user preference — see Claude auto-memory `project_tts_additive_design.md`): new engines selectable alongside existing Pocket TTS; nothing replaced wholesale. Users pick their local TTS engine.

### Candidates

**Self-hosted (replace Pocket TTS):**

- **Chatterbox Turbo** (350M, Resemble AI, MIT) — beats ElevenLabs in 63.75% of blind tests; native zero-shot voice cloning + emotion control; explicit CPU Docker support; OpenAI-compatible API servers exist. **Primary candidate.**
- **Kokoro 82M** (Apache) — #1 TTS Arena, tiny and CPU-optimized. No native voice cloning (needs third-party KokoClone addon). Backup if Chatterbox is too heavy for Railway 4GB.

**BYOK (replace ElevenLabs as premium tier):**

- **Gemini 3.1 Flash TTS** (Google, 2026-04-15) — 70+ languages, **#2 on Artificial Analysis Speech Arena Leaderboard** (ahead of ElevenLabs Eleven v3, only behind Inworld TTS 1.5 Max — confirmed 2026-04-15 via @ArtificialAnlys), Elo 1,211, "Audio Profiles" via natural-language Director's Notes, SynthID watermarking. **Open questions**: pricing not disclosed (preview), whether "Audio Profiles" includes true zero-shot cloning or preset-voice selection only, latency, API stability.
- **Voxtral** (Mistral, $16/1M chars) — 73% cheaper than ElevenLabs, wins 68% vs EL Flash in human prefs, zero-shot cloning from 3s audio confirmed. Open-weight available as self-host fallback.
- **Fish Audio** ($15/1M chars) — #1 TTS-Arena, 75% cheaper than ElevenLabs.

### Ancillary work folded in

- **Proactive voice-engine warmup parallel to ElevenLabs TTS** — Kick off voice-engine `/health` warmup (fire-and-forget) at start of every ElevenLabs attempt so the fallback path has a warm engine waiting. Currently fallback incurs ~47s cold start. Low urgency — beta.97 widened the outer budget to 240s. **Start**: `services/ai-worker/src/jobs/handlers/pipeline/steps/TTSStep.ts` `performElevenLabsTTSWithFallback`; consider a shared `VoiceEngineWarmup` helper callable from both ElevenLabs and voice-engine-direct paths.
- **Reduce ElevenLabs per-attempt timeout from 60s to 30-45s** — Beta.97 cut ElevenLabs retries 2→1, but per-attempt timeout is still 60s (hardcoded in `elevenLabsFetch` via `AbortController`). When ElevenLabs genuinely can't respond, detecting failure 15-30s earlier gives voice-engine fallback more headroom. Requires measurement: what's the p99 ElevenLabs successful-call duration? If <30s, the 60s budget is 2x overkill. **Start**: `services/ai-worker/src/services/voice/ElevenLabsClient.ts` `elevenLabsFetch`; pair with the retry telemetry added to `withRetry` in beta.97.
- **Audit ElevenLabs STT + voice-engine retry counts for same bug pattern** — Beta.97 reduced `ELEVENLABS_MAX_ATTEMPTS` (TTS) 2→1. Parallel code paths likely have the same latent bug: `ELEVENLABS_STT_RETRY.MAX_ATTEMPTS` in `services/ai-worker/src/services/multimodal/AudioProcessor.ts:28`, and voice-engine retry in `services/ai-worker/src/services/voice/VoiceEngineClient.ts:219` (comment says "matches ElevenLabs retry budget"). Likely need the same 2→1 cut. Not bundled into beta.97 to keep scope tight; folding into this epic once telemetry shows retry success rates for STT and voice-engine paths. **Adjacent**: when any `MAX_ATTEMPTS` is raised again, add direct unit tests for the relevant `isTransient*Error` classifier before the bump — at `maxAttempts=1` the classifier is dormant (never invoked by `withRetry`), so a silent classification regression wouldn't fail any current test (`services/ai-worker/src/jobs/handlers/pipeline/steps/TTSStep.ts` `isTransientElevenLabsError` flagged in PR #805 review).

### Next steps

1. Spin up Chatterbox Turbo in a test container (Railway dev or local) — `docker compose -f docker/docker-compose.cpu.yml up -d` from [devnen/Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server)
2. Feed it a character reference audio; compare output quality vs Pocket TTS and vs ElevenLabs
3. Hands-on Gemini + Voxtral eval with the same reference audio (pricing transparency first for Gemini before committing)
4. Pick the BYOK option based on quality + price + cloning fidelity; plan voice-engine integration (swap TTS backend, keep STT as-is)

**Start**: `services/voice-engine/server.py` (current Pocket TTS integration); research links saved in Claude auto-memory (`project_voice_tts_research.md`).

---

## 📦 Future Theme: CPD Clone Reduction

_Focus: Reduce code clones to <100. Demoted from Next Epic 2026-04-21 when TTS promoted; resume after TTS Epic completes._

**Progress**: 175 → 127 (PRs #599, #665–#668); grew to 152 from features; PR #729 → 146; 2026-04-06 architecture day (PRs #766, #768, #769) → 137; PR #776 (browse footer helpers) → 126; Session 1 (PRs #778, #779) → 118; PR #785 (ElevenLabs `readBody` extraction) → 119; 2026-04-13 quick wins session (PRs #794-798, thinking tags data-driven, BrowseActionRow extraction, routeHelpers split) → 119. **Current (`develop`): 119.** BrowseActionRow and thinking tag dedup were type/regex clones not counted by CPD; runtime code clone count unchanged.

### Completed (Phases 1-4)

Phases 1-4 shipped in PRs #599, #665-#668, #704 — Redis setup factory, error reply helpers, route test utilities, personality formatters, API gateway route boilerplate extractions. See git history for details.

### Phase 5: Bot-Client Dashboard Patterns (~16 clones)

Session/ownership boilerplate and modal/select handling repeated across all dashboard commands.

- [ ] Standardize `requireDashboardSession` utility — session lookup + expiry + ownership check (8 clones across settings, preset, persona, deny dashboards)
- [ ] Extract `handleDashboardModalSubmit` — section lookup + value extraction + API call + refresh (4 clones)
- [ ] Extract `handleDashboardSelectMenu` — edit prefix parsing + section lookup (2 clones)
- [ ] Deduplicate persona profile section config — single source of truth between `config.ts` and `profileSections.ts` (3 clones)

### Phase 6: Bot-Client Command Patterns (~15 clones)

Subcommand routing, browse/pagination, custom IDs, and command-specific duplication.

- [ ] Consolidate subcommand routers — parameterized router with context-type generic (3 clones)
- [x] Migrate browse consumers to `browse/` utilities, delete `paginationBuilder.ts` (4 clones) — PRs #771-776
- [x] Servers command: use `createBrowseCustomIdHelpers` instead of inline parsing (4 clones) — PR #773
- [ ] Extract memory command shared helpers — `formatMemoryLine` (remaining clones)

### Phase 7: Cross-Service & Common-Types (~15 clones)

Shared types, config resolver patterns, and remaining cross-service duplication.

- [x] Define `PersonalityFields` type in common-types — `PersonalityCharacterFields` interface + Zod schema fragment (4 files updated)
- [ ] Extract `CacheWithTTL` base — cleanup interval + user-prefix invalidation (6 clones across config resolvers)
- [x] DRY personality create/update Zod schemas — use `.extend()` (2 clones) — already implemented via `...PersonalityCharacterFieldsSchema.shape` composition in `PersonalityCreateSchema` and `PersonalityUpdateSchema` (confirmed during Session 1 investigation, 2026-04-11)
- [ ] Extract `sessionContextFields` Zod fragment — shared between jobs.ts and personality schemas (1 clone)
- [ ] ResultsListener: use shared `createIORedisClient` factory (1 clone)

### Phase 8: AI Worker + Tooling (~10 clones)

Smaller wins in ai-worker internal patterns and tooling utilities.

- [ ] Extract `createStuckJobCleanup(model, config)` factory (2 clones)
- [x] Extract `handleShapesJobError` shared error handler — `shapesJobHelpers.ts` factory with callbacks
- [ ] Extract tooling `spawnWithPiping` and shared `execFileSafe` helpers (3 clones)
- [ ] Extract migration preamble helper (`validateEnvironment` + banner + client) (2 clones)

### Remaining (~10 clones)

Small, localized duplication (1-2 clones each) across deny commands, shapes formatters, preset import types, autocomplete error handling, avatar file ops. Fix opportunistically.

**Target**: <100 clones or <1.5%. Currently 119 clones on develop.

---

## 📦 Future Themes

_Epics ordered by dependency. Pick the next one when current epic completes._

### Theme: Preset Cascade Standardization (multi-PR epic)

_Focus: cross-tier preset-editing UX parity with the config-override cascade. Surfaced 2026-04-20 during Kimi-K2.5-routing bug triage (PR #853)._

The preset cascade (`LlmConfigResolver.resolveConfig`) has user-tier commands (`/settings preset default`, `/settings preset set <personality>`, `/settings preset clear-default`) but **no character-tier UX** for a personality creator to pin their character to a specific preset. Historically "filled" by the auto-pin bug PR #853 removed. Now personalities correctly cascade to current global default, but creators have no opt-in pin path.

**Contrast with the config-override cascade** (sampling, memory, reasoning, vision): has dashboards at **every tier** — `/settings defaults edit`, `/channel settings`, `/channel context`, per-personality override via `user_personality_configs.configOverrides`. Preset commands are flat args at user tier only. The asymmetry is probably why auto-pin slipped through — preset stopped at user-tier because "character tier is set at creation, done."

**Fix shape (multi-PR epic)**:

1. Add character-tier preset editing: new `/character edit` dashboard section for "Default preset" (read from `personality_default_configs`, write via new API endpoint). Creator/owner only. Opt-in — absent row → cascade to global default.
2. Standardize cascade UX: audit preset, config-overrides, and context settings for a common pattern — probably dashboard-per-tier with pin/inherit/clear semantics at each level. Document the canonical pattern in `.claude/rules/` so future settings cascades follow it.
3. Consider whether current resolver priority (`user-per-personality → user-default → personality-default → global-default`) is right, or whether users expect `user-default` to supersede `personality-default`. Council consultation 2026-04-20 flagged this as a genuine design question, not a bug.
4. Shapes import currently writes its own `personality_default_configs` upsert with the shapes.inc-specified model — preserve this as the "deliberate pin" path. Might need UX to explain "this was set by shapes import, not by you" in the edit dashboard.

**Also folds in** (moved from Inbox during 2026-04-21 triage):

- Post-`/character create` dashboard missing Delete button — two entry points produce different dashboards. Unify via dashboard factory.
- `/persona create` UX should mirror `/character create` (plus edit-in-place) — specific case of broader cascade-UX-inconsistency problem.
- Bot-owner/admin should be able to delete any preset — admin override capability for moderation/maintenance. Extend `services/api-gateway/src/routes/admin/llm-config.ts` to allow deleting any LlmConfig regardless of owner.
- Add Create button inside `/X browse` view for convenience — streamline "add one more" loop across browse-capable commands.

**Start**: `packages/common-types/src/services/LlmConfigResolver.ts:141` (cascade logic); `services/bot-client/src/commands/settings/preset/` (user-tier template); `services/bot-client/src/commands/character/dashboardButtons.ts` (add section); `services/ai-worker/src/jobs/ShapesImportHelpers.ts:41` (shapes pin path to preserve).

### Theme: `/character chat` in DMs — protocol-agnostic PersonalityChatManager extract

_Focus: `/character chat` slash command currently hard-errors in DMs because its render path uses webhooks (guild-only). Council-blessed Option D: extract domain logic so both message-handler AND slash-command entry points share one manager._

**Current gap**: typing `/character chat personality:Foo` in a DM produces "This command can only be used in text channels or threads." Regular `@CharacterName hello` in DMs works fine via `DMSessionProcessor` + `PersonalityMessageHandler`.

**Council rejected the obvious DRY shortcut**: do NOT synthesize a fake `Message` from an `Interaction` to reuse `handleMessage`. Known footgun — `discord.js` `Message` and `Interaction` back onto different Discord APIs (`message.reply()` vs `interaction.followUp()`, no `message.reference`/`mentions` on interactions, different typing-indicator semantics). Faking it is effectively shipping a `discord.js` mock in production code.

**Fix shape (Option D, council-blessed)**: extract domain logic out of `PersonalityMessageHandler.handleMessage` into a new `services/character/PersonalityChatManager.ts` accepting protocol-agnostic `ChatGenerationRequest { userId, channelId, isNsfwChannel, personalityId, userPrompt, authorDisplayName }`, returning the response payload. Both entry points parse their own Discord objects, call the manager, then handle delivery in their native protocol (plain reply for messages/DMs; webhook for guild slash commands; `interaction.followUp` for DM slash commands).

**Benefits**: no duplicated context building, no hacky fakes, future-proofs a hypothetical web-dashboard / API entry point.

**Risk**: touches a hot path shared by multiple processors — needs integration test coverage across DMSessionProcessor, BotMentionProcessor, and the slash command before the refactor lands.

**Also ship alongside**: belt-and-suspenders runtime message — if the DM branch of `/character chat` ever hits an unsupported state, reply with `In DMs you can also just type @CharacterName hello — no slash command needed.` instead of a bare technical error.

**Start**: `services/bot-client/src/services/PersonalityMessageHandler.ts` (source of logic to extract); `services/bot-client/src/commands/character/chat.ts:425` (site of webhook-only hard gate); `services/bot-client/src/processors/DMSessionProcessor.ts` (second caller of handleMessage that must keep working). Council consultation 2026-04-20 (Gemini 3.1 Pro Preview).

### Theme: Schema Audit for Nullable-That-Isn't FK Columns

_Focus: find other schema concessions like the Phase 5b `default_persona_id` nullability that was a code-convention workaround, not a real application state._

Phase 5b's NOT NULL fix revealed a pattern: `users.default_persona_id` was nullable at the DB level not because `null` was a meaningful application state, but because one code path (`getOrCreateUserShell`) was inconvenient to fix properly. Similar concessions likely exist elsewhere — this epic has found three load-bearing workaround patterns (`discord:XXXX` dual-tier, shell-user, null `default_persona_id`) in ~6 months of v3 development, suggesting more are hiding.

**Audit recipe**: (a) grep `prisma/schema.prisma` for `?` (optional) on FK columns and columns that are "always set" in application logic — for each, ask "can this actually be null in production, or is the app enforcing non-null via convention?"; (b) grep for default-value-that-never-applies patterns (columns with `@default` that callers always override); (c) grep Prisma `findUnique` / `findFirst` callers for `?.fieldName ?? fallback` patterns where `fallback` is never actually used in production; (d) grep for wide union types in TypeScript (`string | null`, `string | undefined`, domain enums widened to `string`) that the app narrows at runtime.

**Why it matters**: every schema concession is a place where a future refactor can silently re-introduce a bug class — the 5b class was the persona-snowflake bug that shipped undetected for 4 months.

**Why out of scope of Identity Epic**: audit doesn't have a single unifying theme — it's a discovery pass that will spawn multiple independent fix PRs. Best done as its own mini-epic after Phase 6 integration tests land (so we can lean on those tests when tightening invariants).

**Start**: `prisma/schema.prisma` — enumerate every `?` on non-timestamp columns, cross-reference with `.findUnique` usage sites to identify which nullable values are never null at rest.

### Theme: Enforce "Human Users Only" at Auth Middleware

_Focus: middleware-level invariant that rejects bot-user HTTP requests, moving the guarantee from code convention to structural enforcement._

PR #807 removed the 400-for-bot branch from api-gateway HTTP routes (NSFW verify, timezone, wallet, config-overrides, shapes auth/import/export, model-override, personality-config-overrides, llm-config) on the rationale that "HTTP routes aren't bot-accessible in practice — bots don't authenticate via session/discordId." That assumption holds today because Discord OAuth → session cookie only issues sessions to real Discord users.

**Risk**: if a future auth mode ever allows bot accounts (service-to-service JWT for third-party integrations, machine-user API keys, OAuth app-installation flow, etc.), the bot-user path is gone from all those routes and would silently provision shell users for bot Discord IDs.

**Fix shape**: add an `isBotUser` check to `requireUserAuth` middleware in `services/api-gateway/src/services/AuthMiddleware.ts` that rejects session subjects marked as bots before any route handler runs. Moves the guarantee from "code convention" to "middleware invariant" — route handlers no longer need to care about the distinction. Cost: one check per request, applied uniformly.

**Surfaced by**: PR #812 release reviewer observation F.

**Start**: `services/api-gateway/src/services/AuthMiddleware.ts`; check how session data encodes bot status (likely not at all yet since current Discord OAuth doesn't issue sessions to bots — may need to add that field); add rejection test case.

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

### Theme: Package Extraction

_Focus: Reduce common-types export bloat and split bot-client, the largest package. Demoted from Next Epic 2026-04-15 when Identity Hardening promoted; resume after CPD Clone Reduction completes._

**Codebase snapshot (2026-02-12)**: 108K hand-written production LOC + 45K Prisma-generated.

| Package      | Files | LOC | Exports | Status                                                                              |
| ------------ | ----- | --- | ------- | ----------------------------------------------------------------------------------- |
| bot-client   | 254   | 46K | 767     | **Outlier** — nearly half the codebase, primary extraction target                   |
| ai-worker    | 105   | 19K | —       | Healthy                                                                             |
| api-gateway  | 104   | 17K | —       | Healthy                                                                             |
| common-types | 99    | 16K | 607     | LOC is fine (45K "bloat" was Prisma-generated); **607 exports** is the real problem |
| tooling      | 61    | 9K  | —       | Fine                                                                                |

#### Phase 1: Assessment

- [ ] Reassess common-types export count — categorize exports by domain to identify extraction boundaries
- [ ] Profile bot-client's 46K lines — which subdirectories are self-contained?
- [ ] Reference: PR #558 analysis

#### Phase 2: Extraction

- [ ] Candidates: `@tzurot/discord-dashboard` (30 files, self-contained), `@tzurot/message-references` (12 files), `@tzurot/discord-command-context` (6 files)
- [ ] Re-evaluate whether common-types needs splitting or just export pruning

**Previous work**: Architecture Health epic (PRs #593–#597) completed dead code purge, oversized file splits, 400-line max-lines limit, and circular dependency resolution (54→25, all remaining are generated Prisma code).

---

### Theme: Memory System Overhaul

_Dependency chain: Configuration Consolidation → LTM Summarization → Table Migration → OpenMemory_

#### 1. ✨ LTM Summarization (Shapes.inc Style)

Verbatim conversation storage is redundant with extended context. Replace with LLM-generated summaries.

- [ ] Configurable grouping (5, 10, 50 messages or 1h, 4h, 24h time windows)
- [ ] Separate LLM call for summarization (fast/cheap model)
- [ ] Store summaries as LTM instead of verbatim turns

#### 2. 🏗️ Memories Table Migration

Two formats coexist (shapes.inc imports vs tzurot-v3 verbatim). Need unified format.

- [ ] Design unified memory format (draw from both sources)
- [ ] One-time migration of existing tzurot-v3 memories
- [ ] Run existing verbatim memories through summarizer

#### 3. 🏗️ OpenMemory Migration

Waypoint graph architecture with multi-sector storage.

- [ ] Design waypoint graph schema
- [ ] Migration path from current flat memories
- [ ] See `docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md`

#### 🏗️ Per-User Quotas

No limits on memories per persona. Add `maxMemoriesPerPersona` (default: 10,000).

#### 🏗️ Contrastive Retrieval for RAG

Improve memory retrieval quality with contrastive methods.

#### ✨ Cross-channel history — smarter retrieval with limits

Limit messages per channel, prioritize channels with active conversations. Distinct from the user-driven `/history range` import (tracked in Inbox) — this one is about the automatic retrieval path that assembles context at generation time.

---

### Theme: Character Portability

_Import and export characters and user data. Users own their data._

#### ✨ User Data Export

Unified export of all user-owned data. Currently preset export and character export exist but are separate.

- [ ] `/persona export` command - download all user data as JSON/ZIP
- [ ] Include: personas, presets, LLM configs, memories, conversation history
- [ ] Include: user settings, timezone, API keys (masked)
- [ ] Consider: character cards (PNG with embedded metadata) for personalities
- [ ] Privacy: only export data the user owns or has created

**Existing partial implementations**: `/preset export`, `/character export`

#### ✨ Character Card Import

Import V2/V3 character cards (PNG with embedded metadata). SillyTavern compatibility.

- [ ] Parse PNG metadata (V2 JSON in tEXt chunk, V3 in separate format)
- [ ] Map character card fields to v3 personality schema
- [ ] `/character import` support for PNG files

#### ✨ Shapes.inc Import

Phases 1-4 shipped (PRs #593-#662): schema, data fetcher, import pipeline, `/shapes` commands. Remaining backlogged phases:

- [ ] Phase 5: Sidecar prompt injection (depends on "User System Prompts" feature)
- [ ] Phase 6: Voice/image field import (voice tracked in Voice Engine Phase 5; image deferred)
- [ ] Phase 7: Training data import (needs training data schema first)
- [ ] Phase 8: Resolve memory sender UUIDs to display names via shapes.inc API
- [ ] Phase 9: Configurable export sections (`include_config`, `include_memories`, etc.)

---

### Theme: User-Requested Features

_Features requested by actual users. High value._

#### ✨ Multi-Personality Per Channel

Allow multiple personalities active in a single channel.

- [ ] Track multiple active personalities per channel
- [ ] Natural order speaker selection (who responds next)
- [ ] Handle @mentions when multiple personalities present
- [ ] `/channel add-personality` and `/channel remove-personality` commands

#### ✨ User System Prompts (Sidecar Prompts)

Per-user text injected into the system message, shaping how characters interact with that specific user. Shapes.inc calls this "user personalization" — a freeform backstory (~3KB) the user writes about themselves per character. During shapes.inc import, this data is preserved in `customFields.sidecarPrompt` JSONB.

- [ ] Add `sidecarPrompt` field to `UserPersonalityConfig` (per-user-per-character) or `User` (global)
- [ ] Prompt assembly: inject sidecar text into system message (after character profile, before conversation)
- [ ] `/persona` dashboard upgrade to edit sidecar prompt
- [ ] Migration: move shapes.inc imported `customFields.sidecarPrompt` to proper field

#### ✨ Channel Allowlist/Denylist

Prevents bot from spamming unwanted channels, reduces server kicks.

- [ ] Add `mode` (allowlist/denylist) and `channels` array to ChannelSettings
- [ ] `/channel restrict` command for server admins
- [ ] Middleware check in message handler
- [ ] Consider "Ghost Mode" - bot listens but only replies when pinged

#### ✨ Multi-Character Invocation Per Message

Support tagging multiple characters in one message, each responding in order.

**Example**: `@character1 @character2 hello both` → both respond sequentially

- [ ] Modify mention extraction to return array of all valid mentions
- [ ] Combine reply target + mentions into ordered list (reply first, then mentions L→R)
- [ ] Add max limit (3-4 characters per message) to prevent abuse

#### ✨ Emoji Reaction Actions

Allow emoji reactions to trigger personality actions.

- [ ] Define action mapping (❤️ = positive feedback, 👎 = regenerate, etc.)
- [ ] Hook into reaction events (reactionAdd handler)
- [ ] Action dispatch based on emoji → action mapping

#### ✨ Denylist Duration Support

Allow `/deny` entries to have an optional expiration for temporary bans (e.g., `duration:24h`). Requires `expiresAt` column, filter check, and BullMQ cleanup job.

#### ✨ Transcript Spoiler Word List

Admin-managed list of words to auto-spoiler in voice transcripts (`||word||`). Add `spoilerWords` string array to `AdminSettings` JSONB with case-insensitive word-boundary matching.

#### ✨ Discord Emoji/Sticker Image Support

Support custom Discord emoji and stickers in vision context. Extract emoji URLs from `<:name:id>` format, sticker URLs from message stickers, include alongside attachments.

---

### Theme: Model Configuration Overhaul

_Redesign how models are configured. Bundle paid/free/vision into reusable profiles._

#### ✨ Config cascade extension — server, user-server, user-channel tiers

Current cascade: admin < personality < channel < user-default < user+personality. Missing tiers:

- **Server-level defaults** (server admins can set channel-scoped-to-guild defaults)
- **User-channel** (per-user per-channel, e.g., "1 week maxAge globally but off in #general")

User-default overriding channel is by design but limits power-user flexibility. Significant refactor — likely bundled with LLM Config Profiles since both change cascade shape.

#### ✨ LLM Config Profiles (Meta Configs)

Current LlmConfig is a single model. Redesign as **profiles** that bundle paid + free models together, so the system can auto-fallback and users pick a profile rather than individual models.

**Core concept**: A profile is a named container with a description/purpose (e.g., "General Purpose", "NSFW", "Coding") that holds:

- Paid model config (model, temperature, max tokens, etc.)
- Free model config (fallback when quota/billing isn't available)
- Vision model config (bundled in — changing the global vision model should be one action, not per-LlmConfig)

**Cascade integration**: Profiles apply at all 4 config cascade levels — admin global default, personality default, user global default, user-personality override. Vision model inherits from the profile by default but users can override at any tier.

**User-facing**:

- Admin creates global profiles (themed defaults everyone can use)
- Users can create their own profiles (global/non-global, like personalities)
- `/preset` system may merge into or coexist with this

**Open questions**:

- Relationship to existing `Preset` system — replace, merge, or layer on top?
- How many vision profile themes are actually needed? (general, NSFW, document — or just general + NSFW)
- Character-level free model default (does it exist today? needs investigation)

#### ✨ Free Model Quota Resilience

Automatic fallback to alternative free model on 402 quota errors. Track quota hits per model to avoid repeated failures. Foundation shipped in PR #587.

#### 🏗️ Vision Model as Full LLM Config

Currently vision model is just a model name string. Promote to a full `LlmConfig` reference (temperature, max tokens, system prompt, etc.) — but exclude the `visionModel` field itself (no recursive vision config). Likely folded into profiles above.

---

### Theme: Next-Gen AI Capabilities

_Future features: agentic behavior, multi-modality, advanced prompts._

#### Advanced Prompt Features

_SillyTavern-inspired prompt engineering._

- **Lorebooks / Sticky Context** - Keyword-triggered lore injection with TTL
- **Author's Note Depth Injection** - Insert notes at configurable depth in conversation
- **Dynamic Directive Injection** - Anti-sycophancy prompt techniques

#### Agentic Features

_Self-directed personality behaviors._

- **Agentic Scaffolding** - Think → Act → Observe loop
- **Dream Sequences** - Self-reflection and memory consolidation
- **Relationship Graphs** - Track relationships between users and personalities

#### Multi-Modality

_Beyond text: voice and images._

- **Image Generation** - AI-generated images from personalities

---

### Theme: Voice Engine

_Focus: Two-tier voice system (self-hosted free + ElevenLabs BYOK premium) for both STT and TTS._

**Status**: Phases 1–4.6 shipped. Free tier (Parakeet TDT + Pocket TTS) in v3.0.0-beta.89. ElevenLabs BYOK (Phase 4) in PR #727. Configurable TTS model + cleanup (Phase 4.6) in PR #729. Dev-testing fixes (scoped-key detection, voice auto-reclone, STT userId) in v3.0.0-beta.90.

| Tier               | STT                         | TTS               |
| ------------------ | --------------------------- | ----------------- |
| Free (self-hosted) | NVIDIA Parakeet TDT 0.6B v3 | Kyutai Pocket TTS |
| Premium (BYOK)     | ElevenLabs Scribe v2        | ElevenLabs v3     |

#### Phases 1-4.6 (COMPLETE)

All shipped across beta.89-90 + PRs #710, #727, #729, #731-733. Key milestones:

- **Phase 1**: Python FastAPI voice-engine service (Parakeet TDT STT + Pocket TTS), Railway Serverless
- **Phase 2**: ai-worker VoiceEngineClient integration, replaced Whisper STT
- **Phase 3/3b**: TTS pipeline (TTSStep, chunked synthesis, Redis audio storage), `/character voice` command, config cascade wiring
- **Phase 4/4.5**: ElevenLabs BYOK (TTS, STT, voice cloning, slot management), Whisper removal
- **Phase 4.6**: Configurable TTS model (`/settings voices model`), CPD cleanup (152→146)

See git history for detailed task lists.

#### Phase 5: Shapes.inc Voice Field Import

Import voice configuration from shapes.inc character data.

- [ ] Map shapes.inc `voice_model`, `voice_id`, `voice_stability` fields to Tzurot voice config
- [ ] Set `voiceEnabled: true` for imported characters with voice data
- [ ] Create voice states from imported reference audio if available

**Research**: `docs/research/voice-cloning-2026.md`

#### 🐛 Voice Pipeline Resilience (Cold Start + Timeout Architecture)

Intermittent failures from Railway Serverless cold starts (~56s). Significant progress made in beta.92 and beta.93 work:

**Completed:**

- [x] STT bot-client timeout (`AbortSignal.timeout(120s)`) — PR #757
- [x] Adaptive TTS timeout (150s ElevenLabs, 240s voice-engine) — PR #757
- [x] Warmup polling returns `{ ready, elapsedMs }` for observability — PR #757
- [x] Timeout-aware user error messages — PR #757
- [x] ECONNREFUSED retry resilience for both TTS and STT — PR #759

**Remaining:**

- [ ] Parallel TTS chunking — synthesize chunks concurrently instead of sequentially (long messages still bottleneck)
- [ ] Better user feedback during STT wait — "Transcription in progress..." → "Taking longer than expected..." → error
- [ ] Transcription retry outcome surfacing — user sees generic error, not retry status

---

### Theme: Logging & Error Observability

_Comprehensive audit of logging quality, error serialization, and log hygiene across the stack._

#### 🐛 Error Serialization Audit

During the GLM-5 empty response investigation, `err` serialized as `{_nonErrorObject: true, raw: "{}"}` despite being a real `Error`. Makes logs nearly useless for debugging provider issues.

- [ ] Audit LangChain throwing non-Error objects that look like Errors
- [ ] Audit Node `undici` fetch errors — `TypeError` from `fetch()` serializes as `raw: "{}"` in Pino (non-enumerable properties). Seen in `GatewayClient.submitJob()` and `PersonalityMessageHandler` on Railway dev (2026-02-15)
- [ ] Review `normalizeErrorForLogging()` in `retry.ts` wrapping behavior
- [ ] Review `determineErrorType()` in `logger.ts` checking `constructor.name`
- [ ] Codebase-wide scan for `{ err: ... }` patterns that produce useless output
- [ ] Goal: every `{ err: ... }` log shows message + stack, never `raw: "{}"`

#### 🐛 Inadequate LLM Response Detection

Compound scoring heuristic to detect garbage 200 OK responses (e.g., glm-5 returned just `"N"`, 1 token, `finishReason: "unknown"`, 160s). All signals already collected by `DiagnosticCollector` but timing data needs threading through `RAGResponse`. Integrates into PR #702's retry loop via `FallbackResponse` ranking.

**Signals**: `finishReason` unknown/error (+0.4), `completionTokens` ≤1/≤5 (+0.3/+0.15), no stop sequence + short (+0.2), extreme ms-per-token (+0.2), empty content (+0.3). Threshold: ≥0.5. Max 1 content retry.

**Files**: `ConversationalRAGTypes.ts` (add timing field), `ConversationalRAGService.ts` (thread timing), `RetryDecisionHelper.ts` or new scorer, `GenerationStep.ts` (call scorer), tests.

**Reference**: `debug/debug-compact-736e6c99-*.json`

#### 🏗️ Per-Attempt Diagnostic Tracking in Retry Loop

When the fallback response path is used (PR #672), the diagnostic payload has data from attempt 1 (token counts, model, raw content) but `llmInvocationMs: undefined` because timing was reset for attempt 2 which failed. Add a `diagnosticAttempt` field or per-attempt timing array so the payload is internally consistent about which attempt's data it contains.

#### 🧹 Logging Verbosity Audit

Some operations log at INFO when they should be DEBUG. Noisy logs obscure real issues in production.

- [ ] Audit all `logger.info()` calls — demote routine operations to DEBUG
- [ ] Ensure ERROR/WARN are reserved for actionable items
- [ ] Review hot paths (message processing, cache lookups) for excessive logging

#### 🏗️ Consistent Service Prefix Injection

Auto-inject `[ServiceName]` prefix in logs instead of hardcoding in every log call.

- [ ] Extend Pino logger factory to auto-add service name prefix
- [ ] Remove manual `[ServiceName]` prefixes from log messages
- [ ] Consider structured `service` field instead of string prefix

#### 🏗️ Audit Error Sanitization in Log Pipeline

Two gaps: (1) Enumerable Error properties (e.g. Axios `error.config.url`) bypass `sanitizeObject()` early-return for `instanceof Error`. (2) `getErrorContext` callback results spread into log objects without sanitization. Check OpenRouter/LangChain error objects, document API contract. Discovered during PR #700.

#### ✨ Admin/User Error Context Differentiation

Admin errors should show full technical context; user errors show sanitized version. Partially done in PR #587 (error display framework shipped), this is the remaining differentiation.

- [ ] Admin error responses include stack traces and internal context
- [ ] User-facing errors show friendly messages without internals

---

### Theme: Observability & Tooling

_Backend health: monitoring, debugging, developer experience._

#### 🏗️ Metrics & Monitoring (Prometheus)

Production observability with metrics collection.

- [ ] Add Prometheus metrics endpoint
- [ ] Key metrics: request latency, token usage, error rates, queue depth

#### 🏗️ Database-Configurable Model Capabilities

Move hardcoded model patterns to database for admin updates without deployment.

#### 🏗️ Graduate Warnings to Errors (CI Strictness Ratchet)

Pre-push hook runs CPD and depcruise in warning-only mode (non-blocking). ESLint has warnings for complexity/statements that don't block CI. As we hit targets, tighten the ratchet:

- [ ] **CPD**: Currently non-blocking in pre-push. Once under target (<100 clones), add threshold check that blocks push
- [ ] **Duplicate Exports**: `guard:duplicate-exports` runs in CI with `continue-on-error: true`. Add ratchet (baseline count file + "new duplicates above baseline" check) so it blocks CI while still allowing existing allowlisted duplicates. Then drop `continue-on-error`
- [ ] **ESLint warnings**: `max-statements`, `complexity`, `max-lines-per-function` are warn-level. Audit current violation count, set a baseline, block new violations
- [ ] **Knip**: Dead code detection runs manually. Add to pre-push or CI as blocking check

Goal: every quality check that currently warns should eventually block, with a clear baseline so new violations are caught immediately.

#### 🏗️ Schema-Type Unification (Zod `z.infer`)

Adopt `z.infer<typeof schema>` across all job types to eliminate manual interface/schema sync. Currently each job type has both a Zod schema and a hand-written TypeScript interface that must be kept in sync manually.

- [ ] Replace `ShapesImportJobData` / `ShapesImportJobResult` interfaces with `z.infer<>` derivations
- [ ] Do the same for `AudioTranscriptionJobData`, `ImageDescriptionJobData`, `LLMGenerationJobData`
- [ ] Consider discriminated unions for success/failure result types (compile-time enforcement that `personalityId` is required on success, `error` is required on failure)
- [ ] Audit all Zod schemas in common-types for interface/schema drift

**Context**: PR #651 added Zod schemas for shapes import jobs and an enforcement test that catches missing schemas. This follow-up eliminates the remaining duplication.

#### 🏗️ Investigate Safe Auto-Migration on Railway

Prisma migrations are currently manual post-deploy (`pnpm ops db:migrate --env dev/prod`). This caused a P2002 bug when a migration was deployed as code but never applied. Investigate: dev-only auto-migration in start command, pre-deploy hook with `prisma migrate deploy`, CI step that validates migration state matches schema.

#### 🏗️ API Gateway Middleware Wiring Integration Tests

Add supertest-style integration tests that boot the actual Express app with real middleware. Verifies auth middleware is correctly applied (factory functions called, not just passed), routes respond properly, error middleware works. Audit `router.use(...)` calls for missing `()` on factory functions. Discovered during PR #691.

#### 🧹 Ops CLI Command Migration

Migrate stub commands to proper TypeScript implementations.

### Theme: Observability & Analytics

_Codebase-wide decisions on retry counts, timeouts, cache TTLs, rate limits, and feature adoption currently rely on guesswork because we don't systematically capture the data needed to answer them. Vision-pipeline telemetry landed 2026-04-14 as the first concrete step; treat the rest as epic-sized work._

#### ✨ Observability & Telemetry Strategy

**Problem**: System-health decisions (retry counts, timeouts, cache TTLs, queue concurrency) are made without quantitative data. Same pattern exists throughout ai-worker, api-gateway, bot-client — vision-pipeline fix on 2026-04-14 was just the first concrete instance.

**Scope**:

- Audit current logging across all services, identify gap events (hot-path successes with `durationMs`, cache hit/miss rates, job durations, queue depths, retry success rates per category)
- Establish `{ durationMs, attempt, errorCategory, ...dimensionX }` structured-log conventions across the codebase (vision-pipeline retry logs are the prototype)
- Document Railway query cookbook (builds on `pnpm ops logs --filter` DSL passthrough)
- Define "decision-triggering metrics" — events that, when queried, answer a specific tuning question

**Non-goal**: standing up Prometheus/Datadog/OTel. Pino + structured logs + Railway server-side query DSL is likely sufficient at one-person-project scale.

#### ✨ User Analytics Strategy

**Problem**: No systematic view of product usage. Questions unanswerable today: which personalities have active users? Are users adopting `/browse` or falling back to `/list`? Does voice-engine adoption correlate with specific personalities? What's retention look like by user cohort?

**Scope**:

- Event taxonomy: command invocations, personality switches, voice/vision/memory usage, user-facing errors (as product signals, not debug signals)
- Privacy constraints: opaque user IDs only — never usernames, message content, or PII
- **Build-vs-buy decision** (first real decision point for this epic):
  - Off-the-shelf leading candidate: **PostHog self-hosted on Railway** (open-source, product-analytics-native, supports server-side event ingestion, self-hostable to avoid third-party data)
  - Lighter alternatives: Plausible (too web-page-centric for a Discord bot), custom Postgres event table + query UI (most control, heaviest ops burden)
- Integration surface: event emission as middleware/hooks in command handlers and job processors, decoupled from business logic

**Non-goal**: anything requiring message-content inspection (privacy non-starter).

---

## 🧊 Icebox

_Ideas for later. Resist the shiny object._

### Triaged from Inbox 2026-04-21

_Items moved from Inbox during backlog-shrink pass. Full prose preserved — implementation detail, start-file pointers, and reasoning stay accessible for when a session picks any of these up._

- 🧹 `[CHORE]` **`detail.ts` silent-fail risk if imported in isolation post-PR-#856 refactor** — PR #856 moved the `registerBrowseRebuilder('deny', …)` call out of `browse.ts` into a dedicated `browseRebuilder.ts` that's imported by `deny/index.ts` at startup. Today's entry points (command loader → `index.ts`) all transitively load `browseRebuilder.ts` before any detail handler fires, so the rebuilder is always registered when needed. Residual risk (flagged by claude-bot review on PR #856 but intentionally not blocked): if a future test or code path imports `deny/detail.ts` directly without also loading `deny/index.ts` or `deny/browseRebuilder.ts`, the back-button / post-action rebuild path would silently fail to find a registered rebuilder — the symptom would be a "no rebuilder registered for 'deny'" log (or whatever the registry's miss-behavior is) and the user seeing a stale screen. **Fix shape**: either (a) add a defensive `import './browseRebuilder.js';` side-effect back into `detail.ts` (tradeoff: reintroduces the edge depcruise flagged, so only meaningful if we also teach depcruise to ignore side-effect-only imports, probably not worth it); (b) add a lightweight runtime assertion in the rebuilder-consuming code path (e.g. inside `handleSharedBackButton`) that logs an error if no `'deny'` rebuilder is registered — catches the failure mode without coupling detail.ts to the rebuilder module; (c) write an explicit integration test for the `detail.ts`-only import scenario that asserts the back-button fails cleanly (not silently). Option (b) is cheapest and most broadly useful (protects all four browse-capable commands, not just deny). Not urgent — single entry point today makes this theoretical. **Start**: `services/bot-client/src/utils/dashboard/sharedBackButtonHandler.ts` (or wherever the rebuilder registry is consumed); `services/bot-client/src/commands/deny/browseRebuilder.ts` for the registration-point JSDoc that already calls out this pattern.

- 🧹 `[CHORE]` **Periodic 8-point cleanup-sweep skill** — Inspired by a Shaw tweet (2026-04-20) prescribing an 8-subagent cleanup pass over a codebase: deduplicate/DRY, consolidate types, prune unused code (knip), untangle circular deps, remove weak types (`unknown`/`any`), remove defensive try/catch without purpose, remove deprecated/legacy/fallback code, strip AI-slop comments. We already enforce all 8 concerns **continuously** via CI (CPD, `common-types`, knip, depcruise, `strict: true`, 00-critical rules on error handling and "no backward compatibility", CLAUDE.md comment rules). Continuous enforcement is better for steady state — but it doesn't catch _accumulated drift_ that squeaks past linters (e.g., in-motion narration comments that no linter flags). **Fix shape**: add a `/tzurot-cleanup-sweep` skill under `.claude/skills/` that fans out parallel `Agent` invocations — one per concern — with a "report + implement high-confidence items only" contract. Runs quarterly or between epics as an audit. Keep continuous enforcement in CI; the skill is the explicit periodic deep-clean. **Deliberate divergence from Shaw's prescription**: we DO treat `unknown` as correct at system boundaries when paired with Zod — the skill's "weak types" agent should flag only `unknown` inside internal logic, not at boundary layers. **Start**: `.claude/skills/tzurot-arch-audit/` is the existing audit skill — use as the structural template; differ in that this one fans out to sub-agents and implements fixes rather than only reporting. Surfaced 2026-04-21 via Shaw tweet (@shawmakesmagic).

- 🧹 `[CHORE]` **AI-slop comment explicit hunt — periodic sweep** — Narrative-slop comments like `// Previously this did X`, `// Now updated to Y`, `// As part of PR #123`, `// Refactored from the old version`, or `// TODO(claude)` accumulate invisibly — no linter catches them, and CLAUDE.md's "no in-motion narration" rule depends on author discipline. A grep-based sweep every few releases is low-cost. **Fix shape**: a repo-wide grep for patterns like `// (Previously|Now|Formerly|Refactored|Updated|Changed|As part of|Per PR|Moved from|Extracted from)`, plus `// TODO(claude)` and bare `// AI:` markers. Report hits, hand-review each (some may be legitimate "why" comments that just use the trigger phrases), remove or rewrite the rest. Could live inside the cleanup-sweep skill above (entry #8), or as its own standalone skill/script. Possibly folds into a periodic `pnpm ops xray --comments-audit` subcommand. **First sweep done 2026-04-20** (commit `ca24d6f48`): size was ~24 hits across 19 files, of which 8 were genuine narrative-slop and got rewritten/removed; the rest were legitimate "why" comments using trigger words. Tell that worked: if removing the comment leaves a reader worse off, it earned its place. **Next sweep**: re-run after each release; expect single-digit new accumulations. Surfaced 2026-04-21 via Shaw tweet comparison.

- ✨ `[FEAT]` **Bring back v2 `/cleandm` command for removing bot-authored clutter from DM history** — v2 had a `cleandm` command that let users clear bot-posted non-conversation messages from their DM so the channel kept just the actual personality conversations. v3 regressed on this: verification prompts, help messages, error replies, and slash-command error responses accumulate in the DM and clutter the scroll-back. **Fix shape**: new DM-only slash command `/cleandm [scope:recent|all]` that (a) fetches the bot's own messages in the current DM channel (bots can only delete their own messages), (b) filters out any that match the personality-reply prefix `DM_PERSONALITY_PREFIX_REGEX = /^\*\*(.+?):\*\*/` from `DMSessionProcessor.ts`, (c) bulk-deletes the remainder respecting Discord's DM rate limit (~5 deletes/sec). **Architectural fit**: reuse the existing `DM_PERSONALITY_PREFIX_REGEX` as the "is this conversational?" classifier — it's already the rule `DMSessionProcessor` uses to decide session membership, so cleanup logic tracks any future prefix changes for free. **Scope options**: `recent` = last ~100 messages (fast, bounded); `all` = full-history sweep with progress updates and chunked deletion. Default to `recent`. **Start**: new command at `services/bot-client/src/commands/dm/cleandm.ts`. Add `.setContexts(DM)` + `.setIntegrationTypes(UserInstall)` on the SlashCommandBuilder so the command only surfaces in DMs. Surfaced 2026-04-20 during DM-broken investigation.

- 🧹 `[CHORE]` **Narrow the PostToolUse-hook payload jq paths after observational data arrives** — `.claude/hooks/pr-monitor-reminder.sh` currently tries three jq paths to extract `gh pr create` stdout (`.tool_result.stdout // .tool_response.output // .output // empty`) because Claude Code's PostToolUse payload shape isn't strictly documented. A stderr line fires on parse miss so drift is detectable. **Revisit after 3–5 PRs land via the hook**: if the stderr line never fires, the three paths are dead code — narrow to the single path the payload actually uses. If it fires every time, stdout parsing is dead weight and the `gh pr list --head` fallback is the only real code path — drop the parse entirely. Either way, remove the guesswork once data exists. **Start**: check `journalctl` / terminal history for `pr-monitor-reminder: no tool_result stdout available` lines across the next few PR cycles. Surfaced 2026-04-19 during PR #837 r5 review.

- 🧊 `[ICEBOX]` **UUIDv7 audit for other deterministic-UUID-from-mutable-input tables** — 2026-04-19 LlmConfig fix applied the same pattern Phase 5 personas used: random-UUID PK + `@@unique([ownerId, name])`. Other deterministic-UUID generators in `packages/common-types/src/utils/deterministicUuid.ts` should be audited: are they keyed off mutable user inputs, or off stable identifiers (Discord IDs, slugs)? **Candidates for same treatment**: `generateSystemPromptUuid(name)` — name is user-editable; any rename-then-recreate scenario could hit the same phantom collision. **Likely fine as-is**: `generateUserUuid(discordId)`, `generatePersonalityUuid(slug)` (slug is immutable/assigned), `generatePersonaUuid` (Phase 5 fixed this one). Audit-first, action-second. **Start**: enumerate each `generate*Uuid` in `deterministicUuid.ts`, cross-reference against the entity's schema to check if the seed source is mutable. Surfaced 2026-04-19.

- 🏗️ `[LIFT]` **Audit LLM response max-length to cap TTS-audio size at a defensible ceiling** — Post-Opus transcode, 64 kbps Opus keeps ~17 min of speech under Discord's 8 MiB attachment limit. The `voice_omitted_too_long.txt` fallback in `DiscordResponseSender.fetchTTSFiles` handles the residual, but if an LLM ever produces a response long enough to exceed 17 min of speech, the upstream problem (unbounded response length) is worse than the TTS drop — users would see a 17+ min audio attempt fail, and the same text would likely also be chunked across many Discord messages. No explicit max-response-length is enforced today. **Fix shape**: audit the generation pipeline's max-token configs in `services/ai-worker/src/services/` (probably `ConversationalRAGService` or model-config cascade); consider whether to cap response length at ~3000 chars (≈3 min of speech, comfortably under any ceiling). If implemented, the fallback attachment becomes structurally unreachable for the primary path and can be reduced to pure defense-in-depth. **Speculative — wait for residual data**: may never fire in practice if most responses stay under 2000 chars already. The `voice_omitted_too_long.txt` log frequency over the first week post-deploy is the empirical input for whether this audit is needed. Surfaced 2026-04-19 during voice-engine over-size fix.

- ✨ `[FEAT]` **Investigate Discord user-app integration capabilities** — Tzurot is currently installed as a server-scoped bot. Discord also supports "user app" installations where the bot is scoped to the user and can be invoked anywhere (including servers where the bot isn't installed, DMs, and group DMs). Slash commands already partially work in this form (noticed they can be used in other servers). Investigate: what else does user-app scope unlock? Could it make the bot semi-usable in group DMs? Could it improve 1:1 DM UX? What are the limitations (rate limits, permissions, webhook availability)? Low priority — scoping/scouting only until higher-priority work lands. **Start**: read Discord developer docs on user-install apps, compare feature matrix to our current server-install feature set, identify any UX gains specific to Tzurot's personality-chat model.

- 🐛 `[FIX]` **AI occasionally hallucinating response footer, causing duplication** — Rarely, models (observed with `z-ai/glm-4.5-air:free`) hallucinate the "Model: ... / FREE Using free model" footer text into their response content, which then gets the real footer appended on top — resulting in doubled footer lines. Very rare but user-visible. Investigate whether post-processing already strips known footer patterns; if not, add a cleanup step in `ResponsePostProcessor` or the response sender that detects and removes hallucinated footer content before the real footer is appended. Related: the LLM duplicate/looping response detection item may share post-processing infrastructure. **Start**: grep for footer-appending logic (likely in bot-client response sender or ai-worker post-processor), check if any existing stripping handles this pattern.

- 🐛 `[FIX]` **LLM duplicate/looping response detection** — GLM-5 observed producing responses with repeated content blocks (same paragraphs appearing twice within one message). Post-processing should detect and deduplicate repeated paragraph-level blocks. Observed 2026-04-05 with `z-ai/glm-5`. **Start**: `services/ai-worker/src/services/ResponsePostProcessor.ts` — add a deduplication step; `services/ai-worker/src/utils/responseArtifacts.ts` — may fit alongside existing cleanup patterns.

- 🏗️ `[LIFT]` **Rate limit `/voice-references/:slug`** — Unauthenticated endpoint serving binary audio from DB. Low urgency (Railway private networking limits exposure).

- 🏗️ `[LIFT]` **Dynamic free model selection from OpenRouter** — Replace hardcoded `FREE_MODELS` / `VISION_FALLBACK_FREE` with a query layer on `OpenRouterModelCache`. Models go stale when sunset. **Start**: `services/api-gateway/src/services/OpenRouterModelCache.ts`.

- ✨ `[FEAT]` **Inspect command privacy toggle** — Per-personality toggle to hide character card details from `/inspect`.

- ✨ `[FEAT]` **Character import — optional voice file support** — Accept optional voice reference audio alongside character data import.

- 🏗️ `[LIFT]` **Standardize over-long field handling pattern across commands (rule-of-three watch)** — Two consumers now have the two-flow pattern (detection + destructive-action warning + explicit opt-in; "View Full" for reads): `/memory` via `detailModals.ts:61-156` and `/character` via `truncationWarning.ts` (shipped in PR #825 / beta.100). The pattern is duplicated, not shared. Per rule-of-three, the third consumer triggers extraction into a shared utility `services/bot-client/src/utils/dashboard/overLongFieldWarning.ts`. Likely third-consumer candidates: personas with long `content`, presets with long `systemPrompt`. **Action**: (1) Audit persona and preset edit flows for silent `slice(0, maxLength)` truncation sites — grep `services/bot-client/src/commands/{persona,preset}/` for `slice` and `setValue`. (2) When the audit surfaces a real data-loss case, fix it AND extract the shared utility in the same PR (migrate memory + character + new-consumer to the shared module). (3) If no third consumer surfaces naturally, leave as-is — the duplication cost is bounded and the two implementations are small. **Start**: `services/bot-client/src/commands/memory/detailModals.ts:61-156` (memory impl), `services/bot-client/src/commands/character/truncationWarning.ts` (character impl), `services/bot-client/src/commands/{persona,preset}/` for audit targets.

- 🧹 `[CHORE]` **Periodic audit of `scripts/` for patterns to promote to `packages/tooling/`** — `scripts/` is documented as a home for one-off data migration / codegen / investigation scripts that run once and are deleted. But over time the category accretes permanent-ish files (current subdirectories: `analysis/`, `data/`, `debug/`, `deployment/`, `migrations/`, `testing/`, `src/db/`, etc.) that suggest some "one-offs" actually repeat. When a pattern has 3+ sibling scripts, it's graduated past "one-off" and should become a `pnpm ops` command with structured options, tests, and doc. Audit rule: when adding a new `scripts/` file, check `scripts/` for sibling files with similar shape; if 3+ exist, promote. Schedule a quarterly audit to catch accreted patterns. **Start**: `find scripts/ -name '*.ts'` to enumerate, group by shape, identify 3+ sibling clusters as promotion candidates.

- ✨ `[FEAT]` **Cross-channel context slice via message-link range** — Users want to import a specific slice of another channel's history into the current conversation by giving a start and end marker (message ID or message link), not just individual messages. Today the only reliable way to pull other-channel context is to paste a bunch of message links one-by-one and let the reference parser expand each — messy, tedious, and doesn't preserve ordering well for long ranges. Distinct from LLM-driven auto-retrieval path; this is explicitly user-driven bulk import of a known range. **Investigation (2026-04-13)**: infrastructure is ready, but there's a security prereq. Location is `services/bot-client/src/handlers/references/`. Clean Parser → Resolver → Formatter architecture. Strategy pattern already in place: `handlers/references/strategies/` has `ReplyReferenceStrategy` and `LinkReferenceStrategy`. A new `MessageRangeStrategy` plugs in as a sibling — no architectural refactor needed. Estimated ~100–150 LOC. **🔴 CRITICAL security finding — permission check is bot-only, not user-scoped**: `LinkExtractor.fetchMessageFromLink()` (lines 124-251) fetches via `sourceMessage.client` (the bot's own Discord credentials). It verifies the bot has access; it does NOT verify the invoking user has access to the source channel. This is already a live info-leak vector in single-link expansion. **A range-import feature would inherit and amplify this (1 link → N messages).** Fixing the permission check is a hard prerequisite for safely shipping range-import. **Start (when a session picks this up)**: fix `LinkExtractor.fetchMessageFromLink()` user-permission check first; then create `handlers/references/strategies/MessageRangeStrategy.ts` + `MessageRangeExtractor.ts`; plug into `ReferenceCrawler.ts`.

### v2 Parity (Low Priority)

_Eventually kill v2, but these are rarely used features._

- **Personality Aliases** - User-managed alternative names for personalities. v2 had: multi-word aliases (1-4 words, longest-match priority), smart collision handling (append name parts, then random suffix), auto-alias creation from display names, and alias reassignment between personalities. Single-level indirection only (alias → personality ID, no chains). v3 already has `PersonalityAlias` model in schema.
- **Rate Limiting** - Token bucket rate limiting
- **PluralKit Proxy Support** - Support PluralKit proxied messages

### Latent (relevant only if specific triggers fire)

#### 🏗️ Singleton-hazard guard for `UserService` cache

Relevant only if `UserService` is ever refactored from per-request instantiation to a singleton (a reasonable perf improvement).

`UserService.getOrCreateUserShell` intentionally does NOT write to `this.userCache` to prevent a subtle bug: in a singleton context, a shell call would cache a `discordId → userId` mapping, causing subsequent `getOrCreateUser` calls to short-circuit out of the cache and skip `runMaintenanceTasks` (username upgrade + persona backfill). Today's per-request instantiation keeps the cache cold, so this is latent.

Hazard is documented in the cache field's JSDoc (`packages/common-types/src/services/UserService.ts`). Options if UserService is made a singleton: (a) split the caches so shell and full have separate tracking; (b) move username upgrade/persona backfill out of the hot-path into an explicit "ensure provisioned" method callers invoke. Flagged by PR #805 review.

#### 🐛 Voice engine (Pocket TTS) intermittent failures

_Superseded by TTS engine upgrade epic in Current Focus._ Pocket TTS is being replaced by Chatterbox Turbo (research done 2026-04-12, evaluation in progress). Any fix to Pocket TTS would be throwaway work once the replacement ships. Revisit only if the TTS epic stalls for multi-session reasons.

#### ✨ "Cough fallback" pre-recorded audio for TTS failure (RP immersion)

Even after the Opus transcode + `voice_omitted_too_long.txt` fallback (shipped 2026-04-19), an unrecoverable TTS failure still breaks roleplay fiction — the user sees a text attachment named "voice_omitted_too_long" instead of hearing the character. Council raised the idea (2026-04-19) of a pre-recorded 1-sec neutral audio clip (sigh, static, ambient breath) that plays when voice synth hits a terminal error. Maintains character immersion at the cost of mild ambiguity (user might not realize it's an error state).

**Fix shape**: pre-record a short (~1 sec, <50 KB) audio asset; wire it into `DiscordResponseSender.fetchTTSFiles` as a final fallback after the text-attachment branch; consider per-personality opt-in (some characters may want a specific voiced "sorry, couldn't speak" instead of generic ambient sound).

**Why Icebox**: pure polish. The `voice_omitted_too_long.txt` attachment already gives the user a visible signal that voice was attempted. The cough fallback is a UX upgrade, not a correctness fix. Revisit if users report the text-attachment signal feels jarring for specific personalities.

### Infrastructure Debt (Do Opportunistically)

#### 🏗️ Reasoning/Thinking Modernization

Partially done: migrated from `include_reasoning` to modern `reasoning` param via `modelKwargs`. But the custom fetch wrapper in `ModelFactory.ts` that intercepts raw OpenRouter HTTP responses and injects `<reasoning>` tags is still fragile — LangChain's Chat Completions converter silently drops `reasoning` fields, so we intercept before it parses. Needs a cleaner approach (e.g., native Responses API support from OpenRouter, or a LangChain plugin).

**Full details**: `~/.claude/plans/tender-tinkering-stonebraker.md` (Phase 4)

#### 🏗️ Prompt Caching (Anthropic)

Add `cache_control` breakpoints to static prompt sections (character profile, response protocol) for Anthropic models via OpenRouter. Deferred Phase 4 from the XML prompt restructure.

#### 🏗️ Streaming Responses

Stream LLM responses to Discord for better UX on long generations.

#### 🏗️ File Naming Convention Audit

Inconsistent casing between services. Low value / high effort.

#### 🏗️ Incognito Mode - Parallel API Calls

Status command fires up to 100 parallel API calls. Have API return names with sessions.

#### 🏗️ Platform Abstraction Layer — decouple UX from Discord

**Origin (stream of consciousness, 2026-04-13)**: what if there were a translation layer between _the user interactions I want_ and _what Discord slash commands actually look like_? Framed two ways:

1. **Portability hedge**: Discord may stop being a viable platform at some point, and we don't want to be caught flat-footed. A layer that encodes "what experience do I want users to have" separately from "how does Discord express that" would make retargeting to Stoat (née Revolt), a web UI, or any other arbitrary platform a matter of writing a new adapter rather than rewriting every command.
2. **Near-term DX**: a standardized DSL for building slash commands quickly and easily — on top of (and in the same spirit as) the ongoing CPD reduction / duplication cleanup. Instead of each command hand-rolling a `SlashCommandBuilder` tree + bespoke option parsing + bespoke handler wiring, a small in-house builder describes "a command with these options and this intent," and generators produce the Discord registration, the dispatch, and (eventually) any alternate-platform adapter.

**Why it's in Icebox and not deleted**: (a) the CPD reduction work (subcommand router consolidation, browse helpers, dashboard session/modal utilities) is already pushing toward this shape without anyone asking for it — if a DSL eventually crystallizes, it should crystallize the patterns the consolidation work has already validated, not invent new ones; (b) it's the right frame if/when Discord does become untenable, and having thought about it is cheaper than needing it without having thought about it.

**Revisit when**: (1) CPD is at a low baseline and the remaining command boilerplate visibly wants to be a builder function (`defineSlashCommand({ name, options, intent, onInvoke })`) rather than raw `SlashCommandBuilder` chains, or (2) a concrete portability requirement appears (Discord API change, new platform target, web UI project).

**Current state (2026-04-13 investigation)**: the codebase is already **~45–55% DSL-shaped**. `defineCommand()` at `services/bot-client/src/utils/defineCommand.ts:57-162` already serves as the DSL nucleus — it enforces command contracts, abstracts deferral modes (with context-type variance: `ModalCommandContext` vs `DeferredCommandContext` vs `SafeCommandContext`), and declares component routing via `componentPrefixes`. Shared utilities cover browse/dashboard/session/modal patterns comprehensively (see table in `.claude/rules/04-discord.md`). Empirical utility-call density: browse commands ~7% of LOC, dashboard commands ~13%.

**What `defineCommand` does NOT yet absorb** (the residual boilerplate a full DSL would need to cover): `SlashCommandBuilder` chain construction (e.g., `commands/character/index.ts:215-388` is 174 LOC of Discord.js tree), option parsing via per-command codegen helpers, subcommand routing via external factories (`createMixedModeSubcommandRouter`, `createTypedSubcommandRouter`), error-handling try-catch wrapping, and `ModalBuilder` / `TextInputBuilder` chains.

**What Phases 5–6 of the Active Epic would push further**: `requireDashboardSession` (~8 clones), dashboard modal/select handlers (~6 clones), subcommand router consolidation (~3 clones). After those land, ~35–50 LOC per command remains as essentially irreducible `SlashCommandBuilder` + `ModalBuilder` tree construction. That's Discord.js API surface and can't go into a utility without either (a) code generation, (b) a declarative schema compiler, or (c) a thinner-than-Discord.js DSL that accepts less API control.

**Framing insight**: a realistic DSL could eliminate 50–60% of per-command boilerplate; the remaining 40–50% IS the Discord.js API surface — which is also exactly what a cross-platform abstraction layer would need to replace. So the irreducible-boilerplate problem and the portability problem are the same problem viewed from two angles. This suggests the "revisit" trigger isn't really about CPD reaching zero — it's about whether the cost of a schema compiler or code generator is worth paying, which correlates with how seriously we're pursuing portability.

**User's own framing**: "Probably a bit pie in the sky, but I want to at least think about it."

### Code Quality

#### 🏗️ Unify Shapes Job Error Handlers

`handleExportError` (ShapesExportJob.ts) and `handleImportError` (ShapesImportJob.ts) are near-identical: `willRetry` computation, three-way log message, re-throw or mark DB as failed. Extract to a shared helper in `shapesCredentials.ts` or a new `shapesJobHelpers.ts`.

#### 🧹 Audit Existing Tests for Type Violations

Review all `*.test.ts` files to ensure they match their naming convention.

### Low-Priority Audits

- **Audit API Routes for Zod Validation** — Several routes use manual `typeof` + `isValidDiscordId()` instead of Zod schemas at boundaries. Large scope, no recent production impact. Discovered PR #688.
- **DB-Sync Deletion Propagation** — Cross-env sync only upserts, so prod deletions get undone on re-sync. Workaround: manual cleanup. Needs design decision (tombstones, deletion log, sync manifest). Low urgency.

### Nice-to-Have Features

- **Release Notifications** - `/changelog` command, announcement channel, GitHub webhook
- **Remove Dashboard Close Button** - Redundant with Discord's native "Dismiss Message" on ephemeral messages. Sessions auto-expire via Redis TTL (15 min) anyway.
- **Align Preset Browse UX with Character Browse** - Characters group by owner with clear section headers and consistent emoji badges (from the Emoji Standardization epic). Presets still use a flat list with ad-hoc badging. Needs: owner grouping, standardized emoji badges, consistent legend formatting.

### Tooling Polish

#### 🏗️ Type-Safe Command Options Hardening

- [ ] CI validation for `commandOptions.ts` schema-handler drift
- [ ] AST-based parsing for robustness
- [ ] Channel type refinement

#### 🧹 Railway Ops CLI Enhancements

Low priority quality-of-life improvements.

#### ✨ Dynamic Model Selection for Presets

Fetch OpenRouter model list dynamically instead of hardcoded options.

#### 🏗️ Slash Command UX Audit

Full audit of all slash command UI patterns. Review shared utilities usage, identify gaps/inconsistencies, standardize patterns.

#### 🧹 Free-Tier Model Strategy

Define free-tier model allowlist, usage quotas, upgrade prompts.

#### 🐛 Revisit Vision `maxAttempts` After Telemetry Data

**Problem**: Vision retry cap set to `maxAttempts: 2` (1 initial + 1 retry) on 2026-04-14 without empirical retry-success-rate data for AbortError-originated TIMEOUT errors. Council argued for 1 attempt (0 retries) on the assumption that 90s-budget AbortErrors are near-100% deterministic per URL. Kept 2 attempts until measurement proves otherwise.

**Action**: After 1–2 weeks of prod telemetry from the vision-pipeline diagnostic bundle, grep ai-worker logs for `attempt=2` successes on operations where `attempt=1` failed with `errorCategory=timeout`. If retry success rate on TIMEOUT is <5%, cut `VISION_MAX_ATTEMPTS` in `services/ai-worker/src/jobs/ImageDescriptionJob.ts` to 1. If >20%, keep at 2. Between, reconsider with fresh eyes.

**Why out of scope now**: Cannot decide empirically without the telemetry the diagnostic bundle installs.

#### 🧹 Deduplicate `parseApiError` Calls in Retry Path

**Problem**: `ImageDescriptionJob` (and other vision-adjacent callers) pass both `shouldRetry: shouldRetryError` and `getErrorContext: getErrorLogContext` to `withRetry`. Each wrapper internally calls `parseApiError(error)`, so every failed attempt parses the same error twice. Not a correctness issue — both return the same result for a given input — but inefficient if the parser grows more expensive (e.g., deeper cause-chain traversal, richer classification).

**Action**: Add an optional `getErrorContext` variant that receives a pre-parsed `ApiErrorInfo` instead of raw error, or have `withRetry` expose the parsed info from its own `shouldRetry` call into `getErrorContext`. Either approach removes the duplicate parse without changing the external surface for callers that don't need it.

**Why out of scope**: Efficiency nit flagged during PR #802 review; the parser is currently cheap (regex + switch) so duplication is zero-impact in practice. Fix when touching the retry primitive for other reasons.

#### 🐛 `modelName` Lost as Structured Attribute Field After LLMInvoker Log Deletion

**Problem**: PR #802 deleted the `[LLMInvoker] LLM invocation completed` log which had `modelName` as a top-level structured field (queryable via Railway DSL `@modelName:claude-sonnet-4-6`). The replacement `withRetry` success log embeds model name inside `operationName: "LLM invocation (claude-sonnet-4-6)"` — still substring-searchable but no longer an attribute filter. Per-model latency/success-rate queries are harder.

**Action**: Add an optional `extraLogFields: Record<string, unknown>` option to `RetryOptions` that spreads into every lifecycle log. `LLMInvoker` can then pass `extraLogFields: { modelName }` to restore the structured field without reintroducing a second log line. Alternative: extract model name from `operationName` via a Railway query macro — less ergonomic.

**Why out of scope**: Legit queryability regression but low priority for a solo-dev workflow where substring search suffices. Right home is the Observability & Telemetry Strategy epic in Future Themes — that epic will standardize the `extraLogFields` / `dimensions` pattern across all retry-like primitives.

#### 🐛 Revisit `TIMEOUTS.VISION_MODEL` After Telemetry Data

**Problem**: 90s vision-model timeout may be mis-calibrated. 63% hit rate in 2026-04-14 prod-log analysis suggests systemic (provider/CDN stall) rather than "almost-long-enough." If p95 successful response times are 25–35s, 90s is 2–3x overkill.

**Action**: After 1–2 weeks of prod telemetry, analyze `durationMs` distribution from `[Retry] Image description succeeded on attempt` log entries. Tune `TIMEOUTS.VISION_MODEL` in `packages/common-types/src/constants/timing.ts` to p99 + small headroom.

**Why out of scope now**: Cannot tune without the telemetry the diagnostic bundle installs.

---

## ⏸️ Deferred

_Decided not to do yet._

| Item                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema versioning for BullMQ jobs                | No breaking changes yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Contract tests for HTTP API                      | Single consumer, but middleware wiring tests needed (see Inbox). Revisit after wiring audit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Redis pipelining                                 | Fast enough at current traffic                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| BYOK `lastUsedAt` tracking                       | Nice-to-have, not breaking                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Handler factory generator                        | Add when creating many new routes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Scaling preparation (timers)                     | Single-instance sufficient for now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Denylist batch cache invalidation                | Single pubsub messages handle current scale; premature optimization for bulk ops that rarely happen                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Deny detail view DashboardBuilder migration      | Action-oriented UI (toggle/edit/delete) doesn't fit multi-section edit dashboard pattern; already uses SessionManager and DASHBOARD_MESSAGES                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `memory_only` import ownership check             | Not a bug — memory_only imports should work across personality owners since memories belong to the importing user, not the personality owner                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm/action-setup` v5→v6 upgrade                | Investigation 2026-04-17: v6 only adds pnpm 11 support; we use pnpm 10.30.3 (`packageManager` in package.json). v6 replaces the bundled pnpm with a bootstrap installer (see compare v5...v6: `dist/pnpm.cjs` removed, new `src/install-pnpm/bootstrap/`), which caused `ERR_PNPM_BROKEN_LOCKFILE` in our CI. Zero benefit for us on pnpm 10.x. Revisit if: (a) we adopt pnpm 11, (b) v5 is deprecated, (c) a v6.x patch fixes the bootstrap's pnpm version resolution.                                                                                                   |
| JobTracker orphan-sweep user-visible message     | When the 40-min orphan sweep fires, `completeJob` silently deletes the "taking longer" notification with no replacement, so the user just sees the notification disappear. Flagged in PR #820 round 2. Decided not to surface a user-visible message because: (a) orphans require a worker crash or Redis partition — rare in practice, (b) the `logger.warn` in `scheduleOrphanSweep` is the correct signal for ops. Revisit if we see the silent-disappear UX cause real user confusion. Start: `services/bot-client/src/services/JobTracker.ts` `scheduleOrphanSweep`. |
| JobTracker "Completed job" log on orphan-release | `completeJob` emits `logger.info("Completed job after Xs")` regardless of why it was called, so an orphan-sweep release at 40 min reads like a successful completion in logs. Flagged in PR #820 round 2. The preceding `logger.warn` from `scheduleOrphanSweep` provides correlation context, and passing an `isOrphan` flag (or splitting into a separate `forceReleaseJob` method) adds complexity for a rare path. Revisit if we need to distinguish these in aggregated log queries. Start: `services/bot-client/src/services/JobTracker.ts` `completeJob`.          |

---

## References

- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full release history
- [docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md](docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md)
- Shapes.inc import: Phases 1-4 complete on develop (see Character Portability theme)
- [docs/research/sillytavern-features.md](docs/research/sillytavern-features.md)
- [docs/research/voice-cloning-2026.md](docs/research/voice-cloning-2026.md) - Voice engine research summary + implementation map
