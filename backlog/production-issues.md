## 🚨 Production Issues

_Active bugs observed in production. Fix before new features._

- 🐛 `[FIX]` **Persona "About You" modal silently truncates content to 2000 chars, causing data loss on edit** — Reported 2026-05-06 by a Discord user. When editing an existing persona via the dashboard, the "About You" (`content`) field pre-fills with the existing value truncated to 2000 characters (`ModalFactory.ts:98`), then auto-saves the truncated version on modal submit, permanently overwriting the original. The API schema accepts up to 4000 (`DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH`), but the modal's `maxLength` is set to 2000 in `persona/config.ts:116`. **Not a recent regression** — the 2000 limit has been there since the persona command was created in `ada15342d` (2026-01-26). The user's descriptions grew past 2000 for the first time. The character dashboard (`sections.ts`) correctly uses `DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH` (4000); the persona dashboard should match. **Fix shape**: (1) change `persona/config.ts:116` from `maxLength: 2000` to `maxLength: DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH`; (2) also fix `character/config.ts` seed fields (`characterSeedFields`) which had the same 2000 limit for `characterInfo` and `personalityTraits`; (3) verify whether the persona dashboard uses the truncation warning system (`truncationWarning.ts`) — if not, add it as a safety net so users with >4000-char content get a warning before truncation occurs. **Severity: data loss** — user content is permanently destroyed on edit with no undo path. **Status**: maxLength fix applied, tests passing. Truncation warning audit is a follow-up.

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
