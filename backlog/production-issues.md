## 🚨 Production Issues

_Active bugs observed in production. Fix before new features._

- 🐛 **[FIX] Manifest-conformance audit: other routes may carry the same handler≠contract latent bug** — Surfaced 2026-06-07: character edit/import/visibility broke in prod (beta.127) because `updatePersonality` + `setPersonalityVisibility` handlers returned shapes that don't match their manifest-declared output schemas (`GetPersonalityResponseSchema` requires `canEdit`; visibility even returned a partial personality). The generated typed clients VALIDATE responses (legacy `callGatewayApi` didn't), so any handler that drifted from its declared contract fails at the client in production, not in CI. The two known routes are fixed (with schema-parse test pins), but **every other manifest route is unaudited for the same class**. Action: (1) sweep all manifest entries — for each route, parse the handler's actual success response through its declared `output` schema (a script or an int-test harness over the route table); (2) consider structural enforcement: dev/test-mode response validation middleware in the gateway, or a generated contract-test suite per route. Until the sweep runs, assume more routes are silently broken for any caller that exercises them.

_Cleared 2026-05-30:_

- _**Vision-heavy jobs blew through the 10-min safety timeout; late results silently dropped** → resolved by **PR #1117** (ships in v3.0.0-beta.126). All three sub-bugs addressed: (1) raised `MULTI_TAG.COORDINATOR_TIMEOUT_MS` to 18 min and decoupled the ordering buffer (`ORDERING_MAX_WAIT_MS`) from the shared `JOB_WAIT` so transcription's budget is unaffected; (2) `deliverGroup` skips `confirmDelivery` for `status==='timedout'` slots, ending the synthetic-path 404 noise; (3) late-result recovery — `handleSafetyTimeout` writes a per-jobId Redis marker and `MessageHandler.tryRecoverLateResult` re-delivers the real reply as a notice-prefixed follow-up when it arrives after the synthetic timeout. Originally observed 2026-05-29 (a 10-image vision job ran 11m38s vs the 10-min budget)._

_Cleared 2026-05-23 (on develop, awaiting release):_

- _**`/inspect` non-functional + diagnostic response-IDs unlinked — missing `X-User-Id` header on adminFetch calls** → resolved by **PR #1087** (merged to develop 2026-05-23, ships in next release). Rearchitected per council recommendation: PATCH `/response-ids` swapped to `requireServiceAuth()` (internal call, no human user); GET diagnostic routes swapped to `requireUserAuth()` + server-side per-user filtering in Prisma WHERE clauses. Replaces client-side `filterUserId` anti-pattern (which violated least-privilege by shipping other users' diagnostic data across the service boundary just to drop it at the last mile). 404-not-403 existence-hiding preserved for non-owner `/:requestId` lookups. Fail-closed `resolveCallerUserId` guard prevents silent filter degradation on middleware mis-wiring. Net +566/-199 LOC across 10 files, 7 new server-side filtering tests + 1 middleware-identity test + 1 regression test for the `lookupByMessageId` fallback-path log mis-attribution bug surfaced during review._

_Cleared 2026-05-19:_

- _**Multi-personality ping race: wrong personality + duplicate response content** → resolved by **PR #1049** (shipped in v3.0.0-beta.123). Root cause: `ResponseOrderingService.processQueue` called a shared `deliverFn` for all drained results; the multi-tag closure ignored its arguments, so when two groups raced in the same channel one group's deliverFn re-delivered its own slots while the other group's deliverFn never fired. Fix: store `deliverFn` per `BufferedResult`. Originally observed 2026-05-17 in `#monotheism` channel — three @-pings to two personalities returned three Samael responses with the second text-identical to the first. Re-add this entry if the symptom resurfaces._

_Cleared 2026-05-10:_

- _**Cross-channel history bypassed `maxAge` and `contextEpoch` filters; cross-channel budget was a residual** → resolved by **PR #1011** (merged 2026-05-10, ships in next release). Three interlocking bugs: `getChannelHistory` ignored maxAge at the DB layer (stale rows leaked through, filling dbHistory to dbLimit); `fetchCrossChannelIfEnabled` computed cross-channel budget as `dbLimit - currentHistoryLength` (silently zero when current is full); `getCrossChannelHistory` had no time filter at all (would surface arbitrarily old context even after the other two fixed). Fix: shared `computeHistoryCutoff` helper used by both Prisma queries; cross-channel gets its own dbLimit budget (additive, not residual) — matches the user's mental model that cross-channel context is part of memory continuity, not "filler when current is sparse"._

_Cleared 2026-05-08:_

- _**`/character chat` orphans long-running jobs on free models** → resolved by **PR #994** (shipped in v3.0.0-beta.118). Structural fix: bot-client switched from polling (2-min `TIMEOUTS.JOB_BASE` cap) to push-based result delivery via `ResultsListener` + `MessageHandler.handleSlashJobResult`. Slash chat now delivers via the same `JobTracker` infrastructure as the @mention path; free-model users with multi-minute jobs receive their responses cleanly. Bundled with DM support (channel-type guard loosened) and the council-blessed `PersonalityChatManager` extract. Fast-follow PR #995 added test gaps; #996/#998 closed dependency vulnerabilities discovered during the cycle._

- _**Voice transcription pipeline hang via `await channel.sendTyping()`** → resolved across **PR #1000 + PR #1001** (shipped in v3.0.0-beta.119). PR #1000 wrapped sendTyping in a fire-and-forget helper with latency telemetry + ESLint guard against re-introducing `await` on the call (root cause: discord.js REST queue stalls under sustained Discord rate-limit pressure, leaving the promise neither resolved nor rejected). PR #1001 added an `asyncio.Lock` around `Parakeet.transcribe()` in voice-engine to fix a NeMo `freeze()`/`unfreeze()` race when concurrent transcription requests arrive on a single model instance. Both root causes captured; see `backlog/inbox.md` for the `@discordjs/rest@2.6.1` upstream investigation follow-up._

_Cleared 2026-05-06:_

- _**Persona "About You" modal silently truncates content to 2000 chars, causing data loss on edit** → resolved by **PR #983** (merged 2026-05-06, on develop awaiting prod release). The fix raised `persona/config.ts` `content` field maxLength from 2000 to `DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH` (4000), aligning UI with API schema. Companion changes lowered `personalityTraits` seed field cap from 2000 to `DISCORD_LIMITS.SHORT_PARAGRAPH_MAX_LENGTH` (1000) to match the API's existing `.max(1000)` (the inverse silent-rejection bug), and extracted the new `SHORT_PARAGRAPH_MAX_LENGTH` constant to eliminate six bare `1000` literals. Regression tests added at both schema layer (`personality.test.ts` boundary tests) and UI-config layer (`character/config.test.ts`, `persona/config.test.ts` maxLength assertions). Truncation warning audit for the persona dashboard remains tracked as a follow-up in `inbox.md`._

_Cleared 2026-04-29:_

- _**DM system prompt: non-active participants emitted with full `about_user` block** → resolved by **beta.110 / PR #932** (in prod). User-verified 2026-04-29 via fresh DM diagnostic dump: single `<participants>` block contains only the active user, `<about>` empty, no foreign persona injection. Matches the documented verification criteria exactly. The `loadPersonasAndResolveReferences` injection of personality-static-field-resolved users into the participants list is gone; text-replacement preserved._

- _**Vision negative-cache poisons attachments forever on transient AUTH failures** → resolved across two PRs:_
  - _**Beta.110 / PR #935** (in prod): architectural fix — drops L2 PostgreSQL, decouples cache policy from retry policy, AUTH cache TTL drops from "permanent" to 5 min so the user's vision recovers within 5 min of any underlying glitch._
  - _**PR #938** (on develop, ships next release): root-cause fix — discovered post-beta.110 that the "transient AUTH" was actually deterministic cross-provider mis-routing (z.ai key sent to OpenRouter for personalities with main=z.ai + vision=OpenRouter). New `visionAuthResolver` seam re-resolves the API key against the vision provider independently from the main-model resolution._
  - _User-verified on dev 2026-04-29 — image vision succeeds end-to-end. The recovery path is already in prod via beta.110; the underlying-cause fix ships with the next release._

_Previously cleared 2026-04-26 after beta.107 deploy — both prior entries resolved by structural fixes:_

- _LangChain reasoning extraction drop (~11% on GLM-4.7) → addressed by **#895** switching from transport-layer body mutation to `__includeRawResponse` post-parse, bypassing the LangChain `BaseMessage.content` round-trip where the injected tags were being dropped._
- _Preset autocomplete guest-mode trigger for logged-in users → addressed by **#906** flipping the wallet-API check from fail-closed to fail-open, so transient API blips no longer hide paid models from users with active keys._

_If either symptom recurs, treat as a regression and re-investigate from scratch._
