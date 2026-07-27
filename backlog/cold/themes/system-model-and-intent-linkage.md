### Theme: System model + intent linkage (internal)

_Focus: restore and then MAINTAIN an accurate model of what the system is and why it's shaped that way — the internal counterpart to the user-facing surface owned by [`user-docs-and-discoverability.md`](user-docs-and-discoverability.md)._

#### Why (owner, 2026-07-25)

> "it is probably bad that we haven't been keeping some kind of evolving documentation of how the whole system works beyond the high level stuff we do maintain. the scope of this project has gotten pretty unwieldy, and because this is agent-assisted development, I don't have the best mental model of what we actually have in the project, other than the stuff I regularly use as an aggressive dogfooder."

This is a **review-quality** problem, not a tidiness one. In agent-assisted development the owner is the only reviewer and the only person who can catch a wrong direction; a partial model degrades exactly that check. The agent's context resets every session, so neither party holds a complete model — the code holds it, and nobody reads 1,260 files.

#### Grounding (measured 2026-07-25)

| | |
| --- | ---: |
| production TypeScript files | 1,260 |
| api-gateway route handlers | ~190 (recounted 2026-07-27; the 2026-07-25 "122" undercounted) |
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

### Phase 0 — ELICIT the map (rewritten 2026-07-25 after council)

> **The first version of this phase was wrong and is recorded here so it isn't re-proposed.** It said: "synthesise the document from the xray export index, route manifest, schema, and command manifest." All three council models rejected it. Mechanical sources yield a **structural graph, not the narrative why** — _"a generated map of 1,260 files will just be a massive, unreadable hairball. It will not replace the missing architecture document; it will just give the agent a larger context window to get lost in"_ (Qwen); _"a prerequisite, not the solution"_ (GLM). Completeness is not the goal — the generated index already provides completeness. **The goal is that the owner can say what the system is without opening the repo.**

**The artifact**: `docs/reference/architecture/system-model.md`, **hard budget ~150 lines**, five sections:

1. **Services as characters** — 4 services × ~3 lines: what it is _for_ in user-visible terms, and what breaks if it dies.
2. **Flows, not routes** — the top 5–10 end-to-end flows as short numbered paths. 122 routes collapse into a handful of flows; a route only means something inside one.
3. **Invariants and why** — ≤15 bullets of load-bearing decisions, **including the archaeology** (why the 4th service exists, why all Discord calls route through the ack-first path). This is the layer no generator can produce.
4. **Known lies / drift** — ≤10 bullets. Explicitly listing where the map disagrees with the territory is what keeps it trusted.
5. **Concept → location index** — ≤30 lines bridging user-visible concepts to files, citing the mechanical layer beneath rather than restating it.

**Who writes it — elicited, not generated, and not owner-authored alone** (they can't; that is the problem):

- [ ] Agent drafts a **skeleton** using the mechanical sources as **evidence, not content**: cluster the 122 routes into candidate flows by shared models; use git co-change heat (372 PRs/month is a rich signal) to decide what earns page space; use `knip:dead` to prune.
- [ ] **Structured 45–60 min interview** with the owner-as-dogfooder — "walk me through what happens when a user does X" — filling in the why and correcting the flows against real usage.
- [ ] **The owner edits the draft until it matches their experience.** This is the load-bearing step: the editing *is* the restoration. A document handed to them changes nothing in their head.

**Acceptance test — the blank-page redraw**: a week later, the owner sketches the 4 services and top flows from memory. Gaps mean either the page lies (fix the page) or the system genuinely doesn't fit in one head (that's a finding — file simplification items). If it doesn't change what the owner can say from memory, it failed regardless of accuracy.

### Phase 1 — Keep it from rotting

- [ ] **15-minute re-touch at every epic close**: "what did this epic change on the map?" Slots into existing cadence rather than adding a ritual.
- [ ] The agent may **file drift notes** ("this PR adds a 123rd route in a new service — update the page?") but **never auto-appends**. Append-only docs rot; the line budget forces eviction-to-appendix instead of growth.
- [ ] Diagnosis worth keeping: the 2025-10-02 doc didn't die because nothing regenerated it — **it died because nothing owned its truth.** A generation guard would not have saved it.

### Phase 2 — Intent binding (gated on Phase 0/1 proving useful)

- [ ] Only if the map is used and starts drifting: evaluate LID's spec-ID binding to tie intent to code. Re-check its maturity at that point — the numbers above are 2026-07 and it is young enough that a year changes the assessment materially.

**Promote when**: the owner raised it unprompted while scoping the backlog-substrate boulder, so it competes for the next epic slot; Phase 0 alone is small enough to ride as a standalone slice. Related: [`user-docs-and-discoverability.md`](user-docs-and-discoverability.md) owns the user-facing half (its Phase 0 feature inventory is the external counterpart to this theme's Phase 0 map) and [`observability-and-telemetry.md`](observability-and-telemetry.md) addresses the runtime-blindness sibling of this design-time blindness. Surfaced 2026-07-25 (owner).
