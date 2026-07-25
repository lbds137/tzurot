### Theme: System model + intent linkage (internal)

_Focus: restore and then MAINTAIN an accurate model of what the system is and why it's shaped that way — the internal counterpart to the user-facing surface owned by [`user-docs-and-discoverability.md`](user-docs-and-discoverability.md)._

#### Why (owner, 2026-07-25)

> "it is probably bad that we haven't been keeping some kind of evolving documentation of how the whole system works beyond the high level stuff we do maintain. the scope of this project has gotten pretty unwieldy, and because this is agent-assisted development, I don't have the best mental model of what we actually have in the project, other than the stuff I regularly use as an aggressive dogfooder."

This is a **review-quality** problem, not a tidiness one. In agent-assisted development the owner is the only reviewer and the only person who can catch a wrong direction; a partial model degrades exactly that check. The agent's context resets every session, so neither party holds a complete model — the code holds it, and nobody reads 1,260 files.

#### Grounding (measured 2026-07-25)

| | |
| --- | ---: |
| production TypeScript files | 1,260 |
| api-gateway routes | 122 |
| ai-worker service files | 212 |
| Prisma models | 34 |
| slash-command groups | 21 |
| `docs/reference/` files | 45 |

**The only system-wide architecture document is `docs/reference/architecture/ARCHITECTURE_DECISIONS.md`, dated 2025-10-02**, subtitled "decisions from the initial planning conversation" and describing a three-service split (there are now four). Everything written since is subsystem-specific (`CACHING_AUDIT`, `model-selection-pipeline`, `group-conversation-design`), ADR-shaped, or constraint/procedure material in `.claude/`. There is no maintained answer to "what does this system consist of today."

**The gap is already being worked around in the rules.** `00-critical.md` § Don't Present Speculation as Fact requires an exhaustive xray sweep before any "we don't have X" claim, because the owner's vague memory has repeatedly beaten confident absence claims. That rule is a *symptom* of this gap, treated as a procedure.

**Half the mechanism already exists.** `pnpm ops xray` generates a declaration index from source that cannot go stale; `depcruise` enforces boundaries; `knip` finds dead code. What is missing is the narrative layer above the mechanical inventory, and any binding between intent and code.

#### Prior art assessed: Linked Intent Development (LID)

Researched 2026-07-20 (findings summarised here rather than linked — the full write-up is machine-local working material, not a tracked doc).

- **Diagnosis matches ours exactly** — its origin post is "Your Code Doesn't Remember What You Meant."
- **Mechanism**: `HLD → LLDs → EARS specs → Tests → Code`, one-way, bound by greppable semantic spec IDs (`AUTH-UI-001`) with `@spec` annotations at behaviour entry points. One grep returns intent + proving tests + implementation. Its stated bar: you should be able to delete all tests and code and regenerate them from the design artifacts.
- **The directly relevant capability**: `/arrow-maintenance:map-codebase` synthesises LLDs and an HLD **bottom-up from an existing codebase**, with `[inferred]` markers — i.e. generates the model we lack.
- **Three cautions, from the research rather than from enthusiasm**: (1) brownfield map-codebase is the author's own least-battle-proven piece — she explicitly wants it stress-tested because "most spec-driven tooling quietly assumes greenfield"; (2) maturity is thin — 86 stars, 88 commits, single contributor, ~3 months old, no visible enterprise users, third-party enforcement tooling at 12 VS Code installs; (3) its per-change review gates collide with this project's cadence (372 substantive PRs merged in 2026-07).
- **Key separability**: LID's *workflow* (staged gates) and its *artifact + binding idea* come apart. The gap above needs the second, not the first.
- Note for later: a `@spec ID` in a comment is an invariant reference, not archaeology, so it does not conflict with `02-code-standards.md` § Temporal Markers.

### Phase 0 — Generate the map from what we already have (cheap, do first)

- [ ] Synthesise a system-model document from existing mechanical sources: the xray export index, the route manifest, `prisma/schema.prisma`, and the command manifest. No new dependency, no ceremony.
- [ ] Mark inferred vs. verified sections explicitly, so the document is honest about its own confidence.
- [ ] Owner read-through — the acceptance test is whether it closes the "I don't know what we have" gap, not whether it is complete.

### Phase 1 — Keep it from rotting

- [ ] Decide the staleness mechanism, applying the house preference for generated/guard-checked over hand-prose (same constraint the sibling theme records: _"I've been avoiding it because it's gonna get stale real quick"_).
- [ ] Candidate: regenerate the mechanical sections in CI and diff them, so drift fails a gate rather than accumulating silently.

### Phase 2 — Intent binding (gated on Phase 0/1 proving useful)

- [ ] Only if the map is used and starts drifting: evaluate LID's spec-ID binding to tie intent to code. Re-check its maturity at that point — the numbers above are 2026-07 and it is young enough that a year changes the assessment materially.

**Promote when**: the owner raised it unprompted while scoping the backlog-substrate boulder, so it competes for the next epic slot; Phase 0 alone is small enough to ride as a standalone slice. Related: [`user-docs-and-discoverability.md`](user-docs-and-discoverability.md) owns the user-facing half (its Phase 0 feature inventory is the external counterpart to this theme's Phase 0 map) and [`observability-and-telemetry.md`](observability-and-telemetry.md) addresses the runtime-blindness sibling of this design-time blindness. Surfaced 2026-07-25 (owner).
