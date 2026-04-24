# Current

> **Session**: 2026-04-24 (in progress — two remaining Quick Wins + TTS Epic pending; substantial rule-infra work done)
> **Version**: v3.0.0-beta.104 (released 2026-04-23 — substantial unreleased commits ahead on develop)

---

## Next Session Goal

_Pick based on energy:_

1. **TTS Engine Upgrade (Active Epic)** — Chatterbox Turbo is the primary candidate. Next concrete step: spin up Chatterbox in a test container (Railway dev or local) and feed it a character reference audio. Compare quality vs. Pocket TTS and ElevenLabs. See `BACKLOG.md § 🏗 Active Epic: TTS Engine Upgrade`.
2. **Attachment-download lift to ai-worker** — still in Current Focus. Active production issue. Structural fix: api-gateway enqueues with raw URLs, ai-worker downloads at job-run time. See `BACKLOG.md § Current Focus`.
3. **Identity Hardening — final cleanup** (atomic bundle) — flip `requireProvisionedUser` shadow-mode → strict 400; delete `getOrCreateUserShell`. Canary window closed (~2026-04-25 earliest), safe to start anytime now. See `BACKLOG.md § Current Focus`.
4. **Post-deploy DM subscription loss fix** — HIGH priority, two-layer warmer spec-ready. See `BACKLOG.md § Current Focus`.
5. **Remaining Quick Wins** — inadequate-LLM-response detection (4-6hr, moved to Logging theme) is the only one left. Three shipped today (PR #885 autocomplete sentinel guards, PR #886 typing-indicator classifier, PR #887 schema CHECK constraints). Timezone 404 release-note addenda staged in `Unreleased on Develop` section below.

## Active Task

_None. Session paused mid-stride after PR #888 merged and rule-refinement follow-up committed._

---

## Completed This Session (2026-04-24)

### Morning: three Quick Wins shipped

- **PR #885** (merged): autocomplete sentinel guards across **19 consumer sites**. `__autocomplete_error__` sentinel from PR #884 was passing through to gateway as a real slug, producing generic 404s. Added `isAutocompleteErrorSentinel` predicate + `AUTOCOMPLETE_UNAVAILABLE_MESSAGE`, wired into every command that reads autocomplete-backed options (memory, history, persona, shapes, character, settings, channel). 5 review rounds. Reviewer caught sprawl I missed — original scope was "shapes/persona/personality" but full grep surfaced 19 sites; first miss was reviewer catching `deny/add` + `deny/remove` using `context.getOption<T>()` idiom I hadn't searched for.
- **PR #886** (merged): typing-indicator error classifier. New `typingErrorClassifier.ts` util with `classifyTypingError` + `handleTypingError` — turns single-bucket "Failed to send typing indicator" warn into differentiated rate-limit/channel-unreachable/network/unknown logs with structural level choices (error triggers interval cleanup, info suppresses network noise). Wired into 3 catch sites in JobTracker + VoiceTranscriptionService. 5 review rounds.
- **PR #887** (merged): schema CHECK-constraint preservation in pglite generator. Prisma's `migrate diff --from-empty` has no CHECK-constraint representation, so any CHECK added via hand-written migration (birthday range, persona name invariants) silently dropped from the PGLite test schema. New `extractCheckConstraints()` sweeps `prisma/migrations/**/migration.sql`, preserves 5 existing constraints. Round 3 caught a semantic bug: my original dedup comment claimed "first wins = matches Postgres's last-write-wins" — self-contradictory. Fixed with `Map<name,statement>.set()` overwrite, last-wins to match prod after drop+re-add. 5 review rounds.

### Afternoon: rule infra + GLM-4.7 production bug

- **Rule change**: `.claude/rules/08-review-response.md` created via three-model council (Gemini 3.1 Pro → Kimi K2.6 → GLM-5.1). Replaces step 4 of PR-monitoring ("do not fix anything, report only") with a tiered procedure auto-applying trivial edit shapes via `--fixup` commits, test-gated. Ships with edit-shape whitelist (trivial + always-ASK), round-3 convergence cap, prescribed batch-summary format. GLM-5.1 contributed the "conflict → ASK" dissolve + edit-shape whitelist + tests-as-safety-net; Gemini drafted initial "structural override" proposal; Kimi's critique surfaced fatal asymmetry + atomic-commit workflow mismatch.
- **Rule refinement `c9341035b`**: first application of the rule (PR #888 round 1) immediately exposed that documentation-file edits triggered scope-expansion concern. Added "Documentation-only addition" to trivial-shape whitelist (BACKLOG.md / release notes / CHANGELOG / docs/) with explicit `.claude/rules/` + `.claude/skills/` carve-out.
- **PR #888** (merged): GLM-4.7 meta-preamble leak fix. User's personality ("Lilith") emitted `<user>...</user><character>...</character><analysis>...</analysis>` preamble before in-character response, reviewer-captured in a debug dump. Same bug class as GLM-4.5-Air (PR #875) with new tag vocabulary. Gemini council-reviewed the regex shape — caught truncation pathology (`max_tokens` mid-reasoning → full XML leak) my original regex missed. Fixed with permutation-tolerant + truncation-tolerant pattern (`(?:<\/analysis>|$)`). First real application of the new review-response rule: 5 rounds, **3 user-attention decisions** across 12 reviewer findings (under old rule would have been ~12 rubber-stamp asks).
- **Rule refinement `15fef2d51`**: second pass, from PR #888 iteration learnings. Added reviewer-self-contradiction row to signal-conflict table (round 3 said drop `?? ''`, round 4 said add it back — dismiss with prior-round citation). Clarified "user intervention" wording on rule 5 (must be explicit ASK answer / approval / directive, not passive acknowledgment).

### Direct-to-develop commits (chronological)

- **`8150da2b4`** — Quick Win #1: timezone 404 release-note addenda staged in "Unreleased on Develop"
- **`cbbdd25fd`** — Icebox entry for structural follow-up to PR #885 (sentinelSafe schema field on `defineTypedOptions`)
- **`03b2e4a53`** — Trim 6-line test comment to zero lines per PR #885 round-5 nit
- **`0f9b4d2c0`** — Delete stale `scripts/testing/regenerate-pglite-schema.sh` + update 4 referencing files; shell script output diverged from ops-CLI generator post-PR-#887
- **`2b3dbb2a9`** — New rule `08-review-response.md`
- **`c9341035b`** — Rule refinement: docs-only edits are trivial-shape
- **`15fef2d51`** — Rule refinement: self-contradiction + user-intervention wording

### Auto-memory saved today

- `project_glm_47_quirks.md` — GLM-4.7 meta-preamble leak pattern, structurally similar to 4.5-Air but new tag vocabulary. Expect next GLM revision to ship another variant; each needs its own extractor, don't try prompt-level "don't use XML" instructions (fights RL training). MEMORY.md index updated.

### Council used today

- **Three-model rule-change design**: Gemini 3.1 Pro → Kimi K2.6 → GLM-5.1. Each model meaningfully upgraded the prior's proposal. GLM's "agent-reviewer symmetry" frame dissolved several disagreements the prior two models had debated as binary.
- **Gemini 3.1 Pro**: PR #888 regex design. Caught truncation pathology my original draft missed.
- **Kimi K2.6**: PR #888 round 3 sanity-check on reviewer's two asks (truncation case-sensitivity + `{0,2}` edge case). Confirmed both calls; flagged "don't second-guess it" on the quality-over-velocity trade-off.

---

## Unreleased on Develop (since beta.104)

Substantial work pending release. Covers three calendar days of merged work:

**From 2026-04-23:**

- PR #880, #881, #882, #883, #884 — Identity Epic close, UserService harmonization, ApiCheck autocomplete cache
- `bac61af85`, `d95c98110`, `349e91123` — post-merge follow-ups
- `0bf9fc92a`, `9b928927d`, `86f55583f`, `a62635828` — backlog hygiene + Identity cleanup bundle tightening

**From 2026-04-24 (today):**

- PR #885 — autocomplete sentinel guards (19 consumer sites)
- PR #886 — typing-indicator error classifier
- PR #887 — schema CHECK-constraint preservation in pglite generator
- PR #888 — GLM-4.7 meta-preamble leak fix (Chain-of-Extractors extension)
- `8150da2b4` — beta.105 release-note addenda for timezone 404 contract
- `cbbdd25fd` — icebox entry for sentinelSafe structural follow-up
- `03b2e4a53` — trim sentinel-test comment
- `0f9b4d2c0` — delete stale `regenerate-pglite-schema.sh` + update referencing files
- `2b3dbb2a9` — new rule `08-review-response.md`
- `c9341035b` — rule refinement: docs-only trivial-shape
- `15fef2d51` — rule refinement: self-contradiction + user-intervention wording
- This CURRENT.md update (about to ship).

Next release will be beta.105 when the DM subscription fix or a TTS milestone lands. Substantial enough that release notes will span two days of work — `pnpm ops release:draft-notes` will generate most of it automatically; paste the timezone 404 addendum below at draft time.

### Release-note addenda (manual — paste at beta.105 draft time)

The auto-generated notes from `pnpm ops release:draft-notes` will not surface the following behavior-visible change. Paste this line under **Improvements** (or **Breaking Changes** if any downstream caller is confirmed to rely on the old response) in the beta.105 draft:

```markdown
- **api-gateway:** `GET /user/timezone` now returns `404` instead of `{ timezone: 'UTC', isDefault: true }` when the user row is missing (PR #881). Graceful-degradation callers should handle 404 explicitly; bot-client was already updated to treat 404 as the missing-user signal.
```

Context: PR #881 replaced the old "silently default to UTC" handler with a proper 404 when `requireProvisionedUser` guarantees the user row should exist but doesn't. Architecturally correct but it's a contract change on a rarely-exercised error path.

---

## Previous Sessions

- **2026-04-24** (this session, in progress): three Quick Wins shipped (PRs #885, #886, #887) + GLM-4.7 leak fix (PR #888) + new review-response rule designed via three-model council + two rule refinements from first-application learnings.
- **2026-04-23**: Identity Epic CLOSED + ApiCheck autocomplete cache + Inbox triage.
- **2026-04-22 → 2026-04-23**: v3.0.0-beta.104 released. Phase 5c PR C cutover + tech-debt sweep PR #866.
- **2026-04-21**: Tech-debt sweep PR #866 (9 commits, 4 review rounds).
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
