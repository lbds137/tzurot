# Current

> **Session**: 2026-04-16 (next)
> **Version**: v3.0.0-beta.98 (released 2026-04-15)

---

## Session Goal (2026-04-16)

_Post-deploy validate beta.98 → Phase 3 council pressure-test → optional Quick Win for cool-down._

1. **Validate beta.98 in prod** (~10 min): two log queries ready in the release notes. Confirm the cross-channel leak guard is firing (`@level:info LinkExtractor Invoking user lacks access`) and that MEDIA_NOT_FOUND classification rate went up post-deploy vs pre-deploy. Close the loop on today's shipped work.
2. **Phase 3 council pressure-test** (~45 min): eliminate `PersonaResolver.setUserDefault` lazy mutation side effect. Epic's cross-cutting principle is "council review BEFORE each phase starts." Phase 3 entry is in `docs/reference/architecture/epic-identity-hardening.md § Phase 3`. Goal of the council session: pressure-test the proposed extraction of `ensureDefaultPersona()` as an explicit method called at request boundary instead of mid-resolution — catch failure modes, scope drift, and alternate designs before writing code.
3. **Optional Quick Win** if energy remains: 5 items in Quick Wins section of BACKLOG (preset save errors opaque, preset clone auto-numbering, avatar upload timeout, "taking longer" notification, xray analyzer flaky test).

## Active Task

🏗 **Identity & Provisioning Hardening Epic — Phase 1 + 2 shipped. Phase 3 queued for council review.**

Identity epic status:

- ✅ Phase 1 (PR #803, beta.97): tactical heal for persona-snowflake bug. 14 users healed in prod.
- ✅ Phase 2 (PRs #807, #808, beta.98): single choke point for user creation, `ProvisionedUser` return type, ESLint guard on direct `prisma.user/persona.create`.
- 📋 **Phase 3 (next)**: eliminate `PersonaResolver.setUserDefault` lazy mutation side effect — ~3 days estimated.
- 📋 Phase 4-6: dual-tier personaId kill, DB-level FK constraint, integration test coverage for refactor-regression class.

---

## Completed Previous Session (2026-04-15)

Heavy session: Phase 2 of the Identity epic + a council-triaged "Quality, Security, Polish" bundle + release.

### Phase 2 Identity Hardening (beta.98)

- **PR #807** — provisioning choke point: 13 missed `resolveUserIdOrSendError` callers migrated inline, `ProvisionedUser` return shape for `getOrCreateUser`, ESLint `no-restricted-syntax` ban on direct `prisma.user/persona.create` outside UserService. Council right-sized scope from ~1 week → ~3 hrs.
- **PR #808** — follow-up nits: tightened integration-test assertion to deterministic UUID equality, documented ESLint aliasing-bypass in epic D5.

### beta.98 Bundle — A/B/C (council-triaged as one release)

- **PR #809 (Item A)** — cross-channel data leak fix in `LinkExtractor`. New `verifyInvokerCanAccessSource` decision tree (DM participant → guild membership in SOURCE guild → base permissions → private-thread membership), fail-closed throughout. 9 new tests covering the full matrix. SIX review passes before merge; reviewer flagged progressively smaller issues each round until "approve" on pass 6.
- **PR #810 (Item B)** — `MEDIA_NOT_FOUND` regex fix. Original pattern missed prod variants with extra words (`"status code"`, `"image from"`). Verified before fixing that PR #802 already shipped AbortError classification, vision retry cap, and per-attempt telemetry — Item B reduced from "heaviest lift" to ~15-min regex fix.
- **PR #811 (Item C)** — abbreviation-period mention matching. "Dr. Gregory House" couldn't be @mentioned because per-word punctuation strip removed the period. Two-pass approach (full-strip + period-preserving variants) generates both candidates; dedup prevents explosion.

### Release

- **v3.0.0-beta.98** via PR #812 — 3 bug fixes + 1 improvement (Phase 2) + tests + chores. Tag pushed, GitHub release created, Railway deploying from main.

### Housekeeping

- Session-start + triage: moved 4 items to Quick Wins, 2 to Future Themes, 2 to Icebox-Latent, 3 promoted to Current Focus bundle.
- Memory saved: `feedback_verify_reviewer_claims` — verify bot/human reviewer factual claims before echoing (triggered when reviewer was wrong about `GUILD_MEMBERS` intent config).
- Post-release polish: 4 observation responses from PR #812 review landed as docs commit `8928204da` on develop (BACKLOG entry for auth-middleware hardening, comment tweaks on DM test / regex bounds / batch migration intent).
- New Inbox item: Gemini 3.1 Flash TTS evaluation (announced 2026-04-15).

---

## Scratchpad

**Post-deploy validation commands for beta.98** (run at start of next session):

```bash
# Confirm cross-channel leak guard is firing in prod
pnpm ops logs --service bot-client --env prod \
  --filter "@level:info LinkExtractor Invoking user lacks access" --lines 500

# Confirm MEDIA_NOT_FOUND classification rate went up vs pre-deploy baseline
pnpm ops logs --service ai-worker --env prod \
  --filter "@level:info errorCategory:media_not_found" --lines 500

# (Reference from beta.97 post-deploy — still useful)
pnpm ops logs --service ai-worker --env prod --filter "vision" --lines 2000
```

**Baselines to beat post-deploy**:

- MEDIA_NOT_FOUND classification: pre-beta.98 was ~0 hits (regex missed actual prod formats); post-deploy should show the ~7% of vision failures that were previously classified as retryable BAD_REQUEST now correctly as MEDIA_NOT_FOUND.
- Cross-channel leak: no prior denial logs (check didn't exist); first `Invoking user lacks access` log confirms the guard is wired correctly.

**Identity epic remaining phases** (detailed in `docs/reference/architecture/epic-identity-hardening.md`):

- ~~Phase 2: Unify user provisioning~~ ✅ shipped in PRs #807, #808 (beta.98)
- **Phase 3**: Eliminate `PersonaResolver.setUserDefault` lazy mutation side effect (council review first)
- Phase 4: Kill `discord:XXXX` dual-tier personaId format
- Phase 5: DB-level FK constraint `User.defaultPersonaId → Persona.id` + migration
- Phase 6: Integration test coverage for the refactor-regression class (would have caught `c88ae5b7`)

---

## Unreleased on Develop (since beta.98)

- **docs**: post-release review observations from PR #812 addressed as docs commit `8928204da` (BACKLOG entry for auth-middleware hardening; comment tweaks on DM test, MEDIA_NOT_FOUND regex bounds calibration, batch migration intent).

---

## Previous Sessions

- **2026-04-15**: **Identity epic Phase 2 + beta.98 release bundle** — PRs #807, #808 (Phase 2), #809 (cross-channel security), #810 (MEDIA_NOT_FOUND regex), #811 (abbreviation periods in mentions), #812 (release).
- **2026-04-14**: **Identity epic Phase 1** + vision retry fix + TTS budget fix + release (PRs #802-#806), beta.97.
- **2026-04-13**: Backlog shrinkage (PRs #794-800), deps update, preset UX, beta.96.
- **2026-04-12**: Voice engine hardening (PR #785), Python hooks, release audit, beta.95.
- **2026-04-11**: CPD Session 1 (PRs #778-780), channel rename (#781), doc audit (#782-784).
- **2026-04-10**: Browse Step 8 (PR #776), CPD 137→126.
- **2026-04-09**: Browse Steps 6-7 (PR #775), footer design plan + council consultation.

## Recent Releases

- **v3.0.0-beta.98** (2026-04-15) — Cross-channel permission guard (security), MEDIA_NOT_FOUND regex fix, abbreviation-period mention matching, Phase 2 Identity Hardening (provisioning choke point + `ProvisionedUser` type + ESLint guard).
- **v3.0.0-beta.97** (2026-04-14) — Identity & provisioning heal (14 users), vision retry classifier fix + telemetry, TTS budget unification, pytest security bump.
- **v3.0.0-beta.96** (2026-04-13) — Mention parser fixes, forwarded messages, preset error surfacing, deps update, refactors.
- **v3.0.0-beta.95** (2026-04-12) — Voice engine lazy loading, ElevenLabs abort fix, CPD Session 1, browse epic, doc audit.

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [epic-identity-hardening.md](docs/reference/architecture/epic-identity-hardening.md) - Phase 3 entry point
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
