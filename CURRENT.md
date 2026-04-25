# Current

> **Session**: 2026-04-24 (long session — substantial work across attachment refactor, multiple PR review cycles, workflow rule + CI infrastructure)
> **Version**: v3.0.0-beta.104 (released 2026-04-23 — beta.105 ready to cut)

---

## Next Session Goal

_Pick based on energy:_

1. **Cut beta.105 release** — substantial unreleased work (16 commits, 4 user-facing improvements + CVE pin). `pnpm bump-version` then assemble release notes from the conventional changelog. The auto-generated notes will cover most of it; the timezone 404 release-note addendum from earlier in the session still needs manual paste.
2. **TTS Engine Upgrade (Active Epic)** — Chatterbox Turbo is the primary candidate. Next concrete step: spin up Chatterbox in a test container (Railway dev or local) and feed it a character reference audio. Compare quality vs. Pocket TTS and ElevenLabs.
3. **Identity Hardening — final cleanup** (atomic bundle) — flip `requireProvisionedUser` shadow-mode → strict 400; delete `getOrCreateUserShell`. Canary window closed (~2026-04-25 earliest), safe to start anytime now.
4. **Post-deploy DM subscription loss fix** — HIGH priority, two-layer warmer spec-ready.

## Active Task

_None. Session paused after PR #891 merged + post-merge cleanup committed + develop history fully cleaned._

---

## Completed This Session (2026-04-24)

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

## Unreleased on Develop (since beta.104)

**16 commits** since beta.104, three calendar days of merged work. Substantial enough that release notes will span multiple categories.

**Headline user-facing changes:**

- 🚀 **Attachment download lifted to ai-worker** (PR #889) — fixes the 12-screenshot timeout incident structurally. api-gateway's `/ai/generate` and `/ai/transcribe` return in milliseconds regardless of attachment size.
- 🐛 **Reddit/Imgur embed images now work** — `embedImageExtractor.ts` prefers `proxyURL` so external-hosted images route through Discord's media proxy (which passes the strict CDN allowlist).
- 🐛 **GLM-4.7 reasoning leak fix** (PR #888) — strips `<user>/<character>/<analysis>` meta-preamble from responses; same fix class as the existing GLM-4.5-Air handler.
- 🛡️ **Hardened attachment download error handling** (PR #890) — typed errors (`HttpError`, `AttachmentTooLargeError`, `JobPayloadTooLargeError`), aggregate 50 MiB payload cap, labeled error messages for incident triage.
- 🛡️ **Queue-age gate for transcription jobs** (PR #891) — symmetric with the LLM-gen pipeline, classified telemetry on stale-CDN-URL failures.

**Security:**

- 🔒 CVE pin: `uuid >=14.0.0` via pnpm override (GHSA-w5hq-g745-h8pq).

**Infrastructure / dev-facing (not release-note material but real changes):**

- CI `fixup-check` job — structurally enforces clean merge history
- Multiple `.claude/rules/08-review-response.md` clarifications (3 amendments today)
- BACKLOG triage + 7 new follow-up entries
- Stale `regenerate-pglite-schema.sh` deleted post-PR #887
- Three quick-win Quick-Wins shipped morning of the session (PR #885, #886, #887)

### Release-note addenda (manual — paste at beta.105 draft time)

The auto-generated notes from `pnpm ops release:draft-notes` will not surface the following behavior-visible change. Paste this line under **Improvements** in the beta.105 draft:

```markdown
- **api-gateway:** `GET /user/timezone` now returns `404` instead of `{ timezone: 'UTC', isDefault: true }` when the user row is missing (PR #881). Graceful-degradation callers should handle 404 explicitly; bot-client was already updated to treat 404 as the missing-user signal.
```

---

## Previous Sessions

- **2026-04-24** (this session): 7 PRs merged (#885, #886, #887, #888, #889, #890, #891) + new review-response rule + CI `fixup-check` job + workflow rule amendments + 2 develop history cleanups.
- **2026-04-23**: Identity Epic CLOSED + ApiCheck autocomplete cache + Inbox triage.
- **2026-04-22 → 2026-04-23**: v3.0.0-beta.104 released. Phase 5c PR C cutover + tech-debt sweep PR #866.
- **2026-04-21**: Tech-debt sweep PR #866.
- **2026-04-20**: v3.0.0-beta.102 released — Kimi K2.5 routing fix, hybrid post-action UX, CITEXT name uniqueness.
- **2026-04-19 / 2026-04-20**: v3.0.0-beta.101 released — Preset clone fix, ReDoS, TTS Opus transcode default, PR-monitor hook, Phase 5c PR A/B.
- **2026-04-17**: Phase 5b shipped + beta.99 release — PR #818, PR #819.
- **2026-04-15 / 2026-04-16**: Identity epic phases 3/4/5 + beta.98.
- **2026-04-14**: Identity epic Phase 1 + beta.97.

## Recent Releases

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
