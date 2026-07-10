### Theme: User-facing docs + discoverability

_Focus: users (and the single-developer owner) can no longer hold the platform's full feature surface in their heads — build the discoverability layer before the gap widens._

#### Why (owner dictation 2026-07-10 — wants this "preferably not too far in the future")

The platform matured faster than its user-facing documentation: "we've been building a ton of features, but the documentation is very much lagging... it's getting hard to keep a mental model of everything this application can do — I'm already having trouble remembering all of the complex features." New users face a huge slash-command surface with no guided entry ("a brand new user isn't really gonna know what to do... the help command exists, but it's probably not good enough in its current state — I could be wrong, that's an area of investigation"). Dormant-but-supported features (e.g. ElevenLabs TTS — owner no longer uses it, deliberately not ripped out) are invisible to the users who might want them. The owner currently gives ad-hoc personal rundowns; there's no centralized substitute.

The owner's stated staleness fear — "I've been avoiding it because it's gonna get stale real quick" — is the design constraint: prefer **generated or guard-checked docs** over hand-maintained prose wherever possible (house pattern: ratchets/guards).

#### Grounding already in hand (2026-07-10)

- `docs/commands.md` EXISTS and is actively maintained (updated same-week with `/memory facts`) — the reference-layer problem is partly *reachability from Discord*, not absence.
- `docs/reference/features/` is the designated home for user-facing feature docs (07-documentation); coverage unaudited.
- The UX design-system spec (`docs/proposals/backlog/ux-design-system-spec.md`) has a discoverability section — check what it already decides before designing anew.
- Sibling themes: [`first-use-onboarding-dm.md`](first-use-onboarding-dm.md) (the first-touch slice; keep its DM short, pointing into this theme's surfaces) and [`user-feedback-solicitation-revive-v2-release-notes-delivery.md`](user-feedback-solicitation-revive-v2-release-notes-delivery.md) (comms outbound; shares the system-DM primitive).

### Phase 0 — Investigation (cheap, do first)

- [ ] Audit `/help` as it actually renders today: content, navigation, staleness. Owner explicitly flagged "I could be wrong here" — measure before rebuilding.
- [ ] Feature inventory sweep: enumerate every user-facing capability (command tree + features docs + release notes archaeology) into one table — doubles as the owner's mental-model restoration document. Mark each: actively-used / dormant-but-supported (ElevenLabs-class) / candidate-for-retirement.
- [ ] Staleness-resistance survey: which surfaces can be GENERATED from the command registry (the `docs/commands.md` ↔ registry parity could be guard-checked like gate-parity) vs. must be prose.

### Phase 1 — Quick start

- [ ] A "first 10 minutes" guide: the 3-5 commands that matter first, linked from `/help`, the onboarding DM, and the README.

### Phase 2 — Help revamp + doc pipeline

- [ ] Rebuild `/help` per Phase 0 findings (likely: task-oriented entry points over alphabetical command dump; house browse/pagination patterns).
- [ ] Feature docs for the dormant-but-supported set, so "still works if someone wants it" is discoverable rather than folklore.
- [ ] Wire the parity guard chosen in Phase 0 so docs can't silently rot.

**Promote when**: owner said "not too far in the future — this problem is just gonna get worse as we build more stuff." Natural slot: after the beta.157 memory chain lands (it's the current focus), possibly interleaved with UX Phase 2 (which absorbs view/browse unification). Surfaced 2026-07-10 (owner dictation).
