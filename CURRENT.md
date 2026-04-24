# Current

> **Session**: 2026-04-23 (wrapped; Identity Epic CLOSED, ApiCheck autocomplete cache shipped, Inbox triaged)
> **Version**: v3.0.0-beta.104 (released 2026-04-23 — unreleased commits ahead on develop)

---

## Next Session Goal

_Clean state. Pick based on energy:_

1. **TTS Engine Upgrade (Active Epic)** — Chatterbox Turbo is the primary candidate. Next concrete step: spin up Chatterbox in a test container (Railway dev or local) and feed it a character reference audio. Compare quality vs. Pocket TTS and ElevenLabs. See `BACKLOG.md § 🏗 Active Epic: TTS Engine Upgrade`.
2. **Attachment-download lift to ai-worker** — newly promoted to Current Focus. Active production issue (user hit the timeout twice on 2026-04-23). Structural fix: api-gateway enqueues with raw URLs, ai-worker downloads at job-run time. See `BACKLOG.md § Current Focus`.
3. **Identity Hardening — final cleanup** (atomic bundle) — flip `requireProvisionedUser` shadow-mode → strict 400; delete `getOrCreateUserShell`. **Gated on canary window**: earliest safe start ~2026-04-25 (48-72h after epic close on 2026-04-23). See `BACKLOG.md § Current Focus`.
4. **Post-deploy DM subscription loss fix** — HIGH priority, two-layer warmer. See `BACKLOG.md § Current Focus`.
5. **Quick Wins** — 5 items ready, all with concrete starts: `test:generate-schema` CHECK extension, `__autocomplete_error__` submission guards, typing-indicator error differentiation (investigation step 1), timezone 404 release note, inadequate-LLM-response detection. See `BACKLOG.md § ⚡️ Quick Wins`.

## Active Task

_None. Session ended clean._

---

## Completed This Session (2026-04-23)

### Morning: Identity & Provisioning Hardening Epic CLOSED

All six phases shipped across three months.

- **PR #880** (merged): three quick wins — `_parts` param removal, `auth.ts` Phase 5c pattern regression fix, MessageFlags.Ephemeral test-mock sweep.
- **PR #881** (merged): Phase 6 Part 1 — ESLint `no-restricted-syntax` rule banning `prisma.user.*({ where: { discordId }})` in api-gateway route handlers + 24 pre-existing drift fixes. Three rounds of review.
- **PR #882** (merged): Phase 6 Part 2 — `identityProvisioning.int.test.ts` pinning the `UserService ↔ PersonaResolver` integration contract with real PGLite, plus `createProvisionedMockReqRes` helper for Phase 5c strict-mode cutover.
- **PR #883** (merged): UserService instantiation harmonization via `getOrCreateUserService` registry. CPD 119 → 118. Mock convention split (`.mock.ts` libraries vs `__mocks__/` auto-discovery) documented with a backlog audit item.
- **`bac61af85`** (direct to develop): PR #882 review nitpicks.

### Afternoon / evening: ApiCheck autocomplete cache

- **PR #884** (merged): `ApiCheck<T>` return-type widening + two-tier (fresh TTLCache + stale Map) autocomplete cache with stale-fallback on transient HTTP errors. Four review rounds converged; the structural fix for "empty autocomplete list looks like user has no data" during backend blips.

### Post-merge follow-ups direct to develop

- **`d95c98110`** — 429 cache-level stale-fallback boundary test. Pins the 4xx/transient boundary so a future naive refactor to `status >= 500` would be caught.
- **`0bf9fc92a`** — removed shipped ApiCheck entry from Quick Wins (rot-cleanup).
- **`349e91123`** — ESLint `no-restricted-syntax` ban on `new UserService(prisma)` in api-gateway route files. Zero existing violations; purely preventive. Synthetic spike verified the selector fires with the intended message.
- **`9b928927d`** — removed the shipped UserService-ban entry from Quick Wins (second rot-cleanup pass; caught one I missed in `0bf9fc92a`).
- **`86f55583f`** — Inbox triage: 8 items redistributed across tiers. Attachment-download lift → Current Focus; 4 items → Quick Wins; 2 items → Future Themes; 3 items → Icebox. Two items split into immediate-action piece + broader category (timezone 404 release note vs. lie-on-error audit; typing-indicator step 1 vs. full investigation).
- **`a62635828`** — shrunk Identity cleanup bundle 3 → 2 items. Item #3 (ESLint rule banning `UserService.getOrCreateUserShell`) was redundant: once item #2 deletes the method, TypeScript already errors on any call site. User caught this.

### Backlog hygiene

- Inbox went from 8 items → 0 (empty state labeled with triage date).
- Quick Wins went from 1 item → 5 (concrete-start, bounded-scope items each).
- Current Focus went from 2 clusters → 3 (added attachment-download lift).
- New Future Theme: "Typing Indicator Reliability" — prerequisite Quick Win ships error-differentiation logging first.
- New subsection in Logging & Error Observability theme: "Lie-on-Error Fallback Audit (api-gateway category sweep)."
- 2 items removed from Quick Wins as shipped (ApiCheck autocomplete, UserService ban).
- Identity cleanup bundle reflects actual state: strict-400 cutover gated on ~2026-04-25 canary window; method-delete item now also covers the `eslint.config.js:56` reference update.

### Council review used

Gemini 3.1 Pro Preview (morning) pressure-tested the Phase 6 plan — shifted Tier 1 to ESLint `no-restricted-syntax`, flagged the proxy trap, correctly scoped out CHECK constraint tests from Phase 6.

Kimi K2.6 + GLM-5.1 (afternoon) used for ApiCheck Option A/B tradeoffs on stale-cache behavior. Option B (stale-with-TTL-reset on transient only, sentinel placeholder on permanent) was council-blessed across both models.

---

## Scratchpad

### Patterns worth remembering from today

- **PR #884 converged faster with each round** (1 blocking + 2 non-blocking → 1 blocking + 2 non-blocking → 1 non-blocking + approve). Rounds 2 and 3 were roughly same-shape (medium + minors) but the fix quality improved — carrying a behavioral test for `commitFetchedField` was exactly the kind of invariant-pin that answers "how do I know this didn't regress?" Good to remember: behavioral tests beat implementation tests when the cost is the same.
- **Removals gate is the gate that rots.** Shipped the ApiCheck ban entry but missed removing the UserService ban entry in the same session. Second-pass grep caught it. Pattern: after shipping a backlog item, grep BACKLOG.md for BOTH the feature name AND any sibling items — the "same Quick Wins section I'm about to add to" is a common blind spot.
- **"Block reintroduction" ESLint rules are often redundant with TypeScript.** Item #3 of Identity cleanup (ban `UserService.getOrCreateUserShell` calls) added no value over TypeScript's "property does not exist" error. General filter: ESLint bans earn keep when types can't distinguish context (legal in X, banned in Y); not when the banned thing is being deleted globally.
- **Commitlint enforces 100-char headers.** Husky `commit-msg` hook rejected a 120-char heredoc title before it touched the repo. Good guardrail; remember for future long titles.

### PR #884 post-merge state

All behavior is stable. Diagnostic/investigation PRs for `glm-4.5-air:free` near-duplicate replies remain in Icebox/Latent awaiting next incident. The observability PR from 2026-04-19 is live in prod — next duplicate report gives us ground-truth data.

### Feedback memories saved today

- `feedback_no_polling_loop_stacking.md` — don't stack `until`-loop polling when commands auto-background. Use Monitor tool or single Bash with timeout.
- `feedback_avoid_opaque_sugar.md` — prefer explicit enumeration over `...spread` / `export *` when readers need to track what's stubbed vs. passed through. Shared infra reads >> author keystrokes.

---

## Unreleased on Develop (since beta.104)

Substantial work pending release:

- PR #880, #881, #882, #883, #884 (all merged) — Identity Epic close, UserService harmonization, ApiCheck autocomplete cache.
- `bac61af85` — PR #882 round-2 nitpicks.
- `d95c98110` — 429 stale-fallback boundary test.
- `349e91123` — ESLint ban on direct `new UserService(prisma)` in route files.
- `0bf9fc92a`, `9b928927d`, `86f55583f`, `a62635828` — backlog hygiene (rot-cleanup + triage + Identity cleanup bundle tightening).
- This CURRENT.md update (about to ship).

Next release will be substantial — likely beta.105 when the DM subscription fix or a TTS milestone lands.

### Release-note addenda (manual — paste at beta.105 draft time)

The auto-generated notes from `pnpm ops release:draft-notes` will not surface the following behavior-visible change. Paste this line under **Improvements** (or **Breaking Changes** if any downstream caller is confirmed to rely on the old response) in the beta.105 draft:

```markdown
- **api-gateway:** `GET /user/timezone` now returns `404` instead of `{ timezone: 'UTC', isDefault: true }` when the user row is missing (PR #881). Graceful-degradation callers should handle 404 explicitly; bot-client was already updated to treat 404 as the missing-user signal.
```

Context: PR #881 replaced the old "silently default to UTC" handler with a proper 404 when `requireProvisionedUser` guarantees the user row should exist but doesn't. Architecturally correct but it's a contract change on a rarely-exercised error path.

---

## Previous Sessions

- **2026-04-23** (this session): Identity Epic CLOSED + ApiCheck autocomplete cache + Inbox triage.
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
