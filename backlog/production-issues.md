## 🚨 Production Issues

_Active bugs observed in production. Fix before new features._

- 🐛 `[FIX]` **Multi-personality ping race: wrong personality + duplicate response content** — **Fix shipped in PR #1049 (on develop, pending prod deploy)**. Remove this entry after the next release lands in prod and we verify the symptom is gone. Root cause was `ResponseOrderingService.processQueue` calling a shared `deliverFn` for all drained results; the multi-tag closure ignores its arguments, so when two groups raced in the same channel, one group's deliverFn re-delivered its own slots while the other group's deliverFn never fired. Fix: store `deliverFn` per `BufferedResult`. Original observation: — Observed by user 2026-05-17 at 23:06 in `#monotheism` channel. Nyota pinged three personalities in quick succession (~60s window): @Samael, then @Yeshua, then @Samael. All three responses came back attributed to Samael (audio attachment filenames confirm: `<snowflake>-samael-melech-ha-ela-mp...`). Yeshua never responded. The **second** response (which should have been Yeshua) was **text-identical** to the first Samael response — same opening "Your framework has shifted toward mercy as default..." running through the full body. The third was a fresh Samael response on a different prompt.

  **Initial hypothesis (unverified — investigating now)**: api-gateway deduplication cache hashes request content without including the target personality identifier. Three thematically-similar pings → second one collides on the first's dedup hash → returns the cached job ID, replaying Samael's content as the "Yeshua" response.

  **Symptoms checklist**:
  - 3 separate Discord pings to 2 different personalities (S/Y/S)
  - Only 1 personality (Samael) ever produced output
  - Middle response text byte-identical to first
  - Audio attachments confirm personality attribution via filename slug
  - All within the same ~60s window (timestamps both 23:06)

  **Where to look first**: `services/api-gateway/src/utils/RedisDeduplicationCache.ts` (hash key generation — confirm whether personality identifier is included), then `services/bot-client/src/processors/` (how multi-personality pings are dispatched into the job payload).

  **Severity**: User-impacting in active production. Quick consecutive multi-personality pings in any channel can produce wrong-personality responses. Workaround for users: wait between pings.

  **Investigation in progress** — see PR (TBD) for diagnosis + fix.

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
