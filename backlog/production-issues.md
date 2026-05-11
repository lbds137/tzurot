## 🚨 Production Issues

_Active bugs observed in production. Fix before new features._

- 🐛 `[FIX]` **Cross-channel history bypasses `maxAge` (and `contextEpoch`) filter** — Surfaced 2026-05-09 by user note "channel context sharing and max age combination might not be working correctly." Verified 2026-05-10. **Bug**: `ConversationHistoryService.getCrossChannelHistory()` (`packages/common-types/src/services/ConversationHistoryService.ts:419`) queries Prisma with only `personaId`, `personalityId`, `channelId: { not: excludeChannelId }`, `deletedAt: null` — no time filter. Meanwhile `DiscordChannelFetcher.ts:256-261` correctly filters current-channel messages by `options.maxAge` and `options.contextEpoch`. **User-visible consequence**: a user who sets max-age (or context-clears via `/conversation reset`) on a personality expecting it to "forget" old context still gets cross-channel context bleed from messages that pre-date the cutoff. Affects every user who has both cross-channel history enabled AND a non-null max-age / past contextEpoch. **Fix shape**: thread `maxAge` and `contextEpoch` from `CrossChannelHistoryFetcher.fetchCrossChannelHistory` opts into `getCrossChannelHistory`; add the same `createdAt` cutoff to the Prisma `where` clause. Also audit per the user's earlier "off vs inherit" note (already in `quick-wins.md:7`) — when max-age is "off" at a level where global has a value, the override should hold, not fall through. ~30-50 LOC + tests for both filters at the cross-channel boundary. **Why production-issue tier**: silent correctness bug in a privacy/memory feature; user actively bothered.

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
