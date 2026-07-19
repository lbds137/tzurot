## 🏗 Active Epic: Platform-Portable UX Layer (Discord Design System)

_Focus: lift the bot's UI + messaging vocabulary to the routing layer's standardization level — encode UX **intent** separately from its Discord expression, so the experience is consistent **by construction** (not reconciled by periodic audits) and portable via adapters. Promoted 2026-07-17 (owner re-sequence: the `/character alias` build deviated from the 04-discord subcommand standards despite the rules table being clear — "no more UX surface until consistency is by construction"; v2-parity PAUSED behind this). Memory System Overhaul parked mid-epic at a natural pause → [`cold/themes/memory-system-overhaul.md`](cold/themes/memory-system-overhaul.md)._

**This epic is the beta-exit gate (owner 2026-07-17).** The project stays in beta because the user-facing surface is still in flux — under strict semver every command-structure change is breaking, so 1.0 is only honest once the surface stops moving. Completion bar: not "components exist" but "the command surface is reconciled onto them and enforcement makes regressions structural." Meta-pattern to guard: Phase 1 shipped and the epic then stalled behind successive re-routes — **see it through**; when new work tries to preempt, the preemption gets surfaced against this line, not silently absorbed.

**Governing artifacts (both ACCEPTED 2026-07-04, boulder #1 — two docs, one system)**:

1. [`docs/proposals/backlog/ux-design-system-spec.md`](../docs/proposals/backlog/ux-design-system-spec.md) — **the WHAT** (normative): tokens (entity emojis, badge glossary + collision rule, colors, list grammar, sentinels/timestamps), components (browse/detail/dashboard/modals/outcome/pending, expand mechanism, button vocabulary), command grammar (verb table, option conventions, IA moves), discoverability, `/inspect` + owner-surface dispositions. All 21 decisions owner-adopted.
2. [`docs/proposals/backlog/platform-portable-ux-design.md`](../docs/proposals/backlog/platform-portable-ux-design.md) — **the HOW** (machinery): message catalog + outcome-honesty classifier, builder consolidation, enforcement (ESLint + ratchet + depcruise), phasing (§5); the spec's §9 maps decisions onto phases. Gap inventory G1–G11 in its §3.2.

Plan-mode for each phase starts from the artifacts (+ build-time council per project norm). Do not re-derive design calls — §6/§10 decided them.

### Roadmap (machinery §5 · spec §9)

| Phase | Contents | Status |
| --- | --- | --- |
| 1 — catalog + voice | `ux/catalog` + `ux/render`, outcome-honesty classifier over all gateway writes, in-character straggler sites, `ux:literals` ratchet | ✅ COMPLETE 2026-07-08 — ten-PR train #1550–#1561, ratchet **448 → 92** (−79%; residual = documented exemption classes). Per-PR table in [`cold/epic-log.md`](cold/epic-log.md) |
| **2 — components** | Confirmation hierarchy merge + button-order fixes (G6/G7) · detail-card builder + retrofit ×6 (G5) · modal adoption ×9 per-site-fit (G4) + modal form toolkit (D15: right-input-per-type, Label descriptions, preserve-input-on-failure) · browse list-embed/filter-row builders (G9) + list grammar (§2.4) + empty-state CTAs (D19) · dashboard pagination-by-concern (D14: defaults dashboard 3 pages) · Close-button removal (D18 — precondition satisfied) · post-action button-preservation criterion · `/inspect` disposition pass (spec §6) · Components-V2 pilot on character view (D17) | **IN FLIGHT** — pilot ✅ (#1703) · browse builders + retrofit 17/17 ✅ (#1700/#1707/#1709/#1710) · confirmation+router ✅ (#1697/#1698) · alias tiers ✅ (#1701/#1702) · modal wave ✅ COMPLETE (#1711/#1714/#1716/#1718 — zero hand-rolled sites) · D18 ✅ (#1717) · **NEXT: PR-6 detail-card builder** → PR-7 (router migration + D14 residual) → PR-8 `/inspect` → PR-9 V2 pilot |
| 3 — vocabulary + enforcement | Verb/option renames (§4.1–4.4: `/settings preset`→`/preset override`, `voice voices clear`→`purge`, `timeframe` everywhere) · entity emoji + badge registry adoption (§2.1–2.2) · timestamps/sentinels sweep (§2.5) · custom-ID unification (G8) · ESLint rules + AST literal rule (retires grep ratchet) + depcruise boundary (G10) · picker hygiene (§5.1) · `/deny` redesign (§4.5) · parameter-ordering sweep | queued (2 and 3 may interleave per §5) |
| 4 — adapter | Second renderer when a concrete second platform is scheduled — until then the depcruise boundary IS the portability posture | trigger-gated |

### Pilot surface: `/character alias` redesign + scoping tiers (owner-directed 2026-07-17)

The alias command (#1695) works but shipped action-multiplexed (`action: list|add|remove` + retype-the-alias-to-remove) instead of the browse/dashboard shape the 04-discord table prescribes — the incident that promoted this theme. It becomes the design system's **pilot**: small, fresh, and exercising exactly the components Phase 2 must produce (browse + select menu, dashboard with per-row remove, destructive confirm). **Redesign it ON the new components, not before them.**

**Scoping tiers ride the pilot** (owner design input 2026-07-17 — redesigning the surface twice is waste; the dashboard is designed against the tiered model):

- **Implicit global register**: character names/slugs — already resolver step 1, always wins, no work.
- **Global aliases**: existing `personality_aliases` table; write gate narrows from character-owner to **bot-owner only**. v2-migrated rows grandfather in as global (all effectively owner-created).
- **User-scoped aliases**: new tier — a user's personal `@mommy` → character mapping affecting only their own resolution. Schema: `userId` on the alias row (null = global) with per-user uniqueness; resolver step 2 checks the mentioning user's aliases before global ones. The bot-client resolution cache is already keyed `(userId, nameOrId)` — per-user resolution is the cache's natural grain.
- **User-scoped, NOT persona-scoped** (owner-decided): persona-scoping gets messy AND makes aliases unstable across persona switches.
- Verified 2026-07-17: **v2 had no scoping at all** — the tiers are new design, not parity.
- Open product call for the design pass: #1695 lets any character owner add global-effect aliases to their own character; under the tiered model this likely goes away (owners get user-scoped like everyone else; global blessing is the bot owner's). Cross-check the reverse-shadow question in [v2-parity](cold/themes/v2-parity-legacy-retirement.md) Phase 1 — shadowing semantics change per-tier.

### Owner design inputs (2026-07-18) — bind release + Phase 3 planning

1. **Breaking-release posture**: the epic's renames/UX changes break the existing command contract — batch them so users are disrupted ONCE, in a clearly-labeled "major" release (Breaking Changes section leads the notes; consider pairing with the beta-exit framing since this epic IS the beta-exit gate). Phase 3's rename cluster (`/settings preset`→`/preset override`, `voice voices clear`→`purge`, option renames) is the natural batch — avoid dribbling contract breakage across small releases. Goal: minimize disruption.
2. **Onboarding command** (new design question): a "Getting Started" surface in-bot, like the website's page — `/help` subcommand vs. separate top-level command is the open call. Related, NOT duplicates: `cold/themes/first-use-onboarding-dm.md` (push-style, one-time DM) and `cold/themes/user-docs-and-discoverability.md` (docs pipeline + /help revamp) — the command is the PULL-style companion; design them coherently.
3. **Command-tree semantics review**: spec §4.4 deliberately punted macro-structure ("the tree is structurally sound"); owner goals reopen it — ergonomics, discoverability, and a **Discord-limits budget** (100 global commands; 25 subcommands+groups per command is the tighter cap as /character and /settings accrete) with headroom to grow. Needs a decision pass — natural home: a rider on Phase 3's IA work, council-checked.

### Phase 1 follow-ups still open (rows in `cold/follow-ups.md`)

System-voice straggler wording (STT/top-catch/truncation) · partial-failure errored-slot delivery · `maxRetries:0` metrics watch · `deletePersona`/`getCachedPersonalities` wrapper widening.

_Per-PR slice detail goes to [`cold/epic-log.md`](cold/epic-log.md). The 5-dimension audit + catalogued-inconsistencies tables live in the git history of [`cold/themes/platform-portable-ux-layer.md`](cold/themes/platform-portable-ux-layer.md) (now a redirect stub) and the artifacts' grounding sections._
