# Current

> **Session**: 2026-04-26 (Quick Wins triage + Identity Hardening final cleanup — epic closed)
> **Version**: v3.0.0-beta.107 (released 2026-04-26)

---

## Next Session Goal

_No production issues active. Identity Hardening Epic fully closed as of PR #911. Pick from the candidates below; user-impact and shape vary._

1. **Post-deploy DM subscription loss fix** — HIGH user-facing impact on every release. Two-layer warmer spec-ready in `backlog/current-focus.md` (startup pre-warm via `client.users.fetch().createDM()` + greedy lazy registration on any interaction). Medium implementation complexity.
2. **TTS Engine Upgrade (Active Epic)** — Chatterbox Turbo is the primary candidate. Next concrete step: spin up Chatterbox in a test container (Railway dev or local) and feed it a character reference audio. Compare quality vs. Pocket TTS and ElevenLabs. Cost-bleed-driven (~$200/month ElevenLabs).
3. **Quick Wins follow-ups from PR #911 reviews** — `setAsDefault` field cleanup, Zod schema validation at gateway boundary (both in `backlog/inbox.md`).

## Active Task

_None. Session paused after PR #911 merged + Identity Hardening Epic fully closed._

---

## Completed This Session (2026-04-26)

### Inbox triage + commitlint scope additions

- Cleared two production-issues entries (LangChain reasoning drop, preset autocomplete guest-mode) after beta.107 confirmed structural fixes held overnight.
- Deleted obsolete `docs/research/langchain-reasoning-extraction-bug.md` + `scripts/glm47-reasoning-rate.ts` + `test-glm-reasoning-shape.ts` (architecture replaced).
- Added `backlog`, `prisma` to commitlint static scopes.

### Quick Wins shipped

- **PR #908** (merged): three Quick Wins bundled — dedup `WalletListResponse` to canonical `ListWalletKeysResponse` across bot-client preset/apikey paths, IPv6 mixed-compression hardening in `safeExternalFetch` via `parseIPv6ToBigInt`, structural guard test on `personalityOwnerResolver`.
- **PR #909** (merged): test-utils consolidation — three `test-utils.ts` files now wrap shared `createProvisionedMockReqRes` helper instead of duplicating mock setup.
- **PR #910** (merged): personality `MOCK_USER_ID` UUID normalization across 6 test files (24 inline `'user-uuid-123'` literals → constant).

### Identity & Provisioning Hardening Epic — CLOSED

- **PR #911** (merged): final cleanup — `requireProvisionedUser` flipped from shadow-mode passthrough to strict 400/403/500 typed errors; `getOrCreateUserShell` method + `createShellUserWithRaceProtection` helper deleted; `resolveProvisionedUserId` and `getOrCreateInternalUser` collapsed to synchronous passthroughs that throw on missing field. -1404 lines net deletion. 3 review rounds with auto-applied fixups for stale-comment archaeology. Two follow-ups surfaced into `backlog/inbox.md` (vestigial `setAsDefault` field, Zod-validation gap at gateway boundary).
- Removed obsolete `UserService.getOrCreateUserShell` cache hazard entry from icebox (the method no longer exists).

### Old session content (2026-04-24)

### Morning: three Quick Wins shipped

- **PR #885** (merged): autocomplete sentinel guards across 19 consumer sites. 5 review rounds.
- **PR #886** (merged): typing-indicator error classifier. 5 review rounds.
- **PR #887** (merged): schema CHECK-constraint preservation in pglite generator. 5 review rounds.

### Afternoon: rule infra + GLM-4.7 production bug

- **PR #888** (merged): GLM-4.7 meta-preamble leak fix — same bug class as GLM-4.5-Air (PR #875), new tag vocabulary (`<user>/<character>/<analysis>`). 5 rounds, first real application of the new review-response rule.
- **`08-review-response.md`** rule designed via three-model council (Gemini 3.1 Pro → Kimi K2.6 → GLM-5.1). Replaces "report only, never fix" with tiered procedure auto-applying trivial edit shapes via `--fixup` commits, test-gated.

### Evening: attachment-download lift + Quick Wins #6, #7, #2 + #3

- **PR #889** (merged): **structural fix for the 2026-04-23 timeout incident** — moved attachment-byte download from api-gateway sync handler to ai-worker pipeline. Beta.104 band-aided this with a 60s client timeout; this is the real fix. 5 commits in PR (bot-client proxyURL fix, ai-worker DownloadAttachmentsStep + SSRF guards, api-gateway strip, test fixture URLs, BACKLOG removal). 9 review rounds — 1 real bug caught (queue-age gate ordering on text-only jobs), rest polish. Required develop history cleanup post-merge.
- **PR #890** (merged): harden downloadAll error-handling + aggregate payload cap. Three Quick Wins (#6 + #7 + #2) bundled because they all touched `DownloadAttachmentsStep.process()`/`downloadAll()`. New `JobPayloadTooLargeError` + 50 MiB aggregate cap. 4 review rounds. Required develop history cleanup post-merge (4 visible `fixup!` commits collapsed via force-push).
- **PR #891** (merged): queue-age gate for `AudioTranscriptionJob` (Quick Win #3). New `jobAgeGate.ts` shared helper. 4 review rounds. Clean single-commit merge.

### Workflow infrastructure (the big structural fix)

- **CI `fixup-check` job** added in `.github/workflows/ci.yml` — fails the build if any branch commit has a `fixup!`/`squash!` subject. Gates the merge button structurally so the "forgot to autosquash" failure mode (which bit us 2× in this session) is now impossible. Council (Gemini 3.1 Pro) pushed back on my initial proposal to drop the fixup workflow entirely — argued the right fix was the CI check, not workflow simplification. They were correct.
- **`08-review-response.md` rule 3 amended** — clarified that `gh pr merge --rebase` does NOT autosquash, prescribed the correct pre-merge sequence, named the rebase-strategy / per-push-rebase conflation that initially caused unnecessary force-push churn.
- **Auto-memory `feedback_no_force_push_per_round.md`** — captures both the original conflation incident AND the secondary "rule was wrong about gh pr merge" mistake, plus the council-led correction toward the CI check as structural fix.
- **Auto-memory `project_glm_47_quirks.md`** (from PR #888) — GLM-4.7 meta-preamble pattern; structurally similar to 4.5-Air but new tag vocabulary.

### BACKLOG triage + 7 follow-ups added

- 3 items moved out of Inbox: CI test-suite speed → 🧊 Icebox; typed aggregated error + hard-fail vs soft-error reconsideration → ⏸️ Deferred.
- 7 new follow-up entries surfaced by PR #889/#890/#891 reviews tracked in Inbox / Quick Wins:
  - Aggregate cap on partial-failure path (Inbox)
  - Consolidate DownloadAttachmentsStep onto `checkQueueAge` helper (Quick Wins) — bundled fix for duplicate `MAX_QUEUE_AGE_MS` AND `ExpiredJobError` ownership inversion
  - 5 GLM/CPD/test-suite watch-items already tracked, refreshed

### Develop history cleanups (force-pushed twice)

- After PR #890 merged via web UI without pre-merge autosquash, force-pushed develop to collapse its 4 visible `fixup!` commits.
- After PR #891 merged, force-pushed develop again to collapse the 6 PR #888 `fixup!` commits that had been on develop pre-CI-check.

---

## Unreleased on Develop (since beta.107)

_Nothing yet — beta.107 was just cut._

---

## Previous Sessions

- **2026-04-25** (continuation of marathon): beta.105 production failures observed within minutes of deploy (extended-context embed images from external URLs aborted entire conversations); audit + council consultation surfaced 3 critical hardening items I'd have missed; PR #893 shipped beta.106 hotfix after **8 review rounds** and a real security bug catch (Teredo RFC 5952 canonical-form gap, found by claude-bot, would have shipped if reviewer hadn't caught it); release ceremony cut (PR #894).
- **2026-04-24**: 7 PRs merged (#885, #886, #887, #888, #889, #890, #891) + new review-response rule + CI `fixup-check` job + workflow rule amendments + 2 develop history cleanups + **beta.105 cut** (PR #892).
- **2026-04-23**: Identity Epic CLOSED + ApiCheck autocomplete cache + Inbox triage.
- **2026-04-22 → 2026-04-23**: v3.0.0-beta.104 released. Phase 5c PR C cutover + tech-debt sweep PR #866.
- **2026-04-21**: Tech-debt sweep PR #866.
- **2026-04-20**: v3.0.0-beta.102 released — Kimi K2.5 routing fix, hybrid post-action UX, CITEXT name uniqueness.
- **2026-04-19 / 2026-04-20**: v3.0.0-beta.101 released — Preset clone fix, ReDoS, TTS Opus transcode default, PR-monitor hook, Phase 5c PR A/B.
- **2026-04-17**: Phase 5b shipped + beta.99 release — PR #818, PR #819.
- **2026-04-15 / 2026-04-16**: Identity epic phases 3/4/5 + beta.98.
- **2026-04-14**: Identity epic Phase 1 + beta.97.

## Recent Releases

- **v3.0.0-beta.107** (2026-04-26) — Inspect UX hardening mini-epic completed: stateful filter / sort / Top-N buttons on Memory Inspector (#901), Pipeline Health checklist + quick-copy summary (#899), owner-only redaction of character internals (#898), embed redesign for the post-#895 diagnostic shape (#897). **Preset autocomplete fail-open fix** (#906) — wallet-API failures no longer hide paid models from users with active keys. SSRF defense-in-depth: `discordCdnGuard` helper now applied at every attachment fetch site including the JSON-download utility (#905); IPv6 loopback Set covers uncompressed form. Internal: OpenRouter reasoning extraction switched from transport-layer body mutation to `__includeRawResponse` post-parse (#895), three-layer canary safety net (#896). BACKLOG.md restructured into per-section files under `backlog/` (#904). Pre-push hook now clears depcruise cache (#902).
- **v3.0.0-beta.106** (2026-04-25) — Hotfix for beta.105 production failures: external embed images (Reddit/Imgur/Tenor) now reach the LLM via new `safeExternalFetch` module with layered SSRF defenses (DNS-resolution + IP-range guards including IPv4-mapped/6to4/Teredo recursion, browser User-Agent, Content-Type assertion); single bad URL no longer aborts whole conversation (partial-success tolerance in DownloadAttachmentsStep); bot error replies now include actual failure detail in spoiler tag instead of generic "Sorry, I encountered an error" (errorInfo populated in pipeline catch); VisionProcessor SSRF theater dropped (LLM provider does the fetch). Council-reviewed (Gemini 3.1 Pro Preview). 8 review rounds with 1 real security bug caught by claude-bot (Teredo RFC 5952 canonical-form gap).
- **v3.0.0-beta.105** (2026-04-24) — Attachment download lifted from api-gateway to ai-worker (#889); downloadAll hardening + 50 MiB aggregate cap (#890); transcription queue-age gate (#891); GLM-4.7 meta-preamble fix (#888); two-tier autocomplete cache (#884); identity Phase 6 part 2 + ESLint rule (#881, #882); pglite CHECK constraints (#887); typing-indicator classifier (#886); autocomplete sentinel guards (#885); uuid CVE pin.
- **v3.0.0-beta.104** (2026-04-23) — shapes.inc cookie migrated Auth0 → Better Auth; GLM-4.5-air thought leak via Chain-of-Extractors pattern; new release tooling; bot-client submit-job timeout bump.
- **v3.0.0-beta.103** (2026-04-22) — Identity Epic Phase 5c PR C cutover; voice multi-chunk TTS Opus fix; `ApiCheck<T>` tri-state type; tech-debt paydown.
- **v3.0.0-beta.102** (2026-04-20) — Hybrid post-action UX, Kimi K2.5 routing fix, CITEXT name uniqueness.
- **v3.0.0-beta.101** (2026-04-20) — Preset clone PK fix, TTS Opus transcode default, Phase 5c PR A/B.
- **v3.0.0-beta.100** (2026-04-17) — `/admin db-sync` refactor, character truncation warning, protobufjs CVE.
- **v3.0.0-beta.99** (2026-04-17) — Identity Epic Phases 3-5b, UX polish, db-sync deferred-FK fix.

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [epic-identity-hardening.md](docs/reference/architecture/epic-identity-hardening.md) - Closed epic reference
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
