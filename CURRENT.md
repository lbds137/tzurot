# Current

> **Session**: 2026-04-23 (wrapped; Identity & Provisioning Hardening Epic CLOSED)
> **Version**: v3.0.0-beta.104 (released 2026-04-23 — unreleased commits ahead on develop)

---

## Next Session Goal

_Identity Epic closed this session. Pick based on energy:_

1. **TTS Engine Upgrade (Active Epic)** — Chatterbox Turbo is the primary candidate. Next concrete step: spin up Chatterbox in a test container (Railway dev or local) and feed it a character reference audio. Compare quality vs. Pocket TTS and ElevenLabs. See `BACKLOG.md § 🏗 Active Epic: TTS Engine Upgrade` for the candidate list and hands-on eval plan.
2. **Identity Hardening — final cleanup** (atomic bundle) — flip `requireProvisionedUser` shadow-mode → strict 400; delete `getOrCreateUserShell`; add ESLint rule banning reintroduction. Prerequisite migration helper already landed (PR #882). See `BACKLOG.md § Current Focus`.
3. **Post-deploy DM subscription loss fix** — HIGH priority, two-layer warmer. See `BACKLOG.md § Current Focus`.
4. **Inbox triage** — fresh items accumulated this session: "lie-on-error" audit, UserService instantiation harmonization, `pnpm ops test:generate-schema` CHECK-constraint drop.

## Active Task

🏗 **TTS Engine Upgrade** (newly active — Identity Epic just closed).

Status: research done 2026-04-12, Chatterbox Turbo primary. No candidate committed yet; hands-on eval is the gate. Start with `docker compose -f docker/docker-compose.cpu.yml up -d` from [devnen/Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server).

---

## Completed This Session (2026-04-23)

### Identity & Provisioning Hardening Epic CLOSED

All six phases shipped across three months. Final session deliverables:

- **PR #880** (merged): three quick wins — `_parts` param removal, `auth.ts` Phase 5c pattern regression fix, MessageFlags.Ephemeral test-mock sweep.
- **PR #881** (merged): Phase 6 Part 1 — ESLint `no-restricted-syntax` rule banning `prisma.user.*({ where: { discordId }})` in api-gateway route handlers + 24 pre-existing drift fixes. Three rounds of claude-bot review feedback addressed (wrapper deletion, dead-field cleanup, test-comment pattern). 46 files, net -80 lines.
- **PR #882** (merged): Phase 6 Part 2 — `identityProvisioning.int.test.ts` pinning the `UserService.getOrCreateUser` ↔ `PersonaResolver.resolve` integration contract with real PGLite. Would fail loudly on the original `c88ae5b7` regression. Plus `createProvisionedMockReqRes` migration helper for the Phase 5c strict-mode cutover (reference TODO in `auth.test.ts`).
- **`bac61af85`** (direct commit to develop): nitpick fixes from PR #882 review — FK cascade comment in `beforeEach`, clarify HTTP-first/Discord-first labeling, drop staleable file-count from helper JSDoc.

### Other wins shipped this session

- **`userId` context on `getOrCreateInternalUser` shadow-mode throw** — quick win from Inbox.
- **Phase 5 CHECK-constraint structural guard** — new `schemaInvariants.int.test.ts` pins the Phase 5 DDL against migration drift. Descoped from Phase 6 per council review; landed as a quick win.

### Backlog hygiene

- Identity & Provisioning Hardening Epic section removed from BACKLOG (docs live in `docs/reference/architecture/epic-identity-hardening.md`).
- Phase 5c follow-ups (3 items) moved to Current Focus as an atomic bundle.
- Phase 6 work items section removed (shipped).
- TTS Engine Upgrade promoted Next Epic → Active Epic.
- 5 shipped items removed per session-end removals gate: `_parts` param, auth.ts Phase 5c regression, MessageFlags.Ephemeral sweep, Phase 6 route-level tests, CHECK constraint tests (partially — upgraded to structural-guard form).
- 5 new Inbox entries added from the session's review-surfaced follow-ups: lie-on-error audit, UserService instantiation harmonization, PGLite schema CHECK-constraint drop, plus two others from prior sessions.

### Council review used

Gemini 3.1 Pro Preview pressure-tested the Phase 6 plan before start (2026-04-23). Shifted Tier 1 from grep → ESLint `no-restricted-syntax`, flagged the "proxy trap" on Tier 2 (which later combined with the MessageContextBuilder-in-bot-client discovery to land the test at `UserService ↔ PersonaResolver` seam instead), correctly identified CHECK constraint tests as scope creep for Phase 6.

---

## Scratchpad

### Identity Epic closure notes

Epic spanned 2026-01 through 2026-04-23. Seven PRs across six numbered phases (plus sub-PRs for 5c), two structural cleanups still pending (Phase 5c strict-mode cutover, then shell-path deletion). The original `c88ae5b7` regression class now has author-time prevention (PR #881's ESLint rule catching 25 drift sites on first run) + runtime regression guard (PR #882's integration test pinning the UserService/PersonaResolver contract).

### TTS Epic entry point

See `BACKLOG.md § 🏗 Active Epic: TTS Engine Upgrade` and Claude auto-memory `project_voice_tts_research.md` + `project_tts_additive_design.md`. Hands-on eval of Chatterbox Turbo is the next action.

### Observed pattern worth remembering

PR #881 took three review rounds to converge (review caught bugs the refactor introduced). PR #882 converged in one round (test-only PRs have less behavior-under-change). For future refactor-heavy PRs: do a deliberate self-review pass before the first push to preempt the wave-2 cleanup (dead fields, stale types, docstring contradictions).

---

## Unreleased on Develop (since beta.104)

Substantial work pending release:

- PR #880 (merged) — three quick wins
- PR #881 (merged) — Phase 6 Part 1 (ESLint rule + 24 drift fixes)
- PR #882 (merged) — Phase 6 Part 2 (integration test + migration helper)
- `bac61af85` — round-2 nitpicks
- `userHelpers.ts` userId context + `schemaInvariants.int.test.ts` (this session, about to ship)
- Backlog hygiene + CURRENT.md (this session, about to ship)

Next release will be substantial — likely beta.105 when the DM subscription fix or a TTS milestone lands.

---

## Previous Sessions

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
