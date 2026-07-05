---
name: tzurot-design-boulder
description: 'The design-boulder process: grounded, council-reviewed architecture design sessions producing an ACCEPTED artifact. Invoke with /tzurot-design-boulder when starting a design session for a feature or subsystem too large to plan inline.'
lastUpdated: '2026-07-05'
---

# Design Boulder Procedures

**Invoke with /tzurot-design-boulder** when starting a design session. A "boulder" is
a design-heavy work item where the _approach_ is the deliverable: multi-system
features, architecture rewrites, new subsystems. The output is an ACCEPTED design
artifact in `docs/proposals/backlog/`, not code.

Proven across the full accepted-artifact set in `docs/proposals/backlog/`.

## When to boulder vs. plan inline

| Boulder                                                                                      | Plan mode / inline                    |
| -------------------------------------------------------------------------------------------- | ------------------------------------- |
| The design decides architecture for quarters (tiers, schemas, protocols)                     | The design is one PR's shape          |
| Multiple viable approaches with real tradeoffs                                               | One obvious approach                  |
| Grounding requires research (external prior art, provider docs, multi-file code archaeology) | The codebase context fits in one read |
| The owner has directives/opinions to incorporate                                             | Purely technical call                 |

## The cadence

### 1. Ground (parallel agents + own archaeology)

- **2–4 read-only agents**, each with a distinct lens: (a) the system as
  actually implemented (exact orders, types, call sites — design-grade, not
  vibes), (b) entity/data landscape, (c) external prior art / provider APIs
  (web), (d) our own prior designs and backlog archaeology.
- **Check for prior design work FIRST** (`docs/proposals/backlog/`, themes,
  `git log`) — prior proposals have nearly been re-derived. Their resolved
  decisions carry forward; their stale claims get flagged, not trusted.
- **Verify provider/library facts against first-party docs**, not memory —
  stale provider knowledge has forced whole design sections to be deleted.
  Mark findings [V] verified / [I] inferred; anything load-bearing gets a
  citation or a named runtime probe.
- Agents return structured reports; the grounding output that matters most is
  the table nobody can argue with (exact orders, scoping matrices, traced
  wires).

### 2. Draft (decision table + open calls)

- One artifact in `docs/proposals/backlog/<slug>.md`. Header: Status (Draft),
  what it supersedes/extends, owner directives verbatim, grounding provenance.
- Body: the system-as-is (verified facts only) → numbered decisions (D1..Dn),
  each with rationale AND the rejected alternative → what this deliberately
  does NOT do → schema/phasing sketches → **§ Open calls**: the genuinely
  contestable choices, each with a recommendation.
- **Confirm the owner's actual concern is the artifact's center** — an
  artifact centered on the wrong concern costs a full second artifact. If the
  directive is dictated/informal, restate what you think the center is before
  drafting deep.
- Plans touching schema or user-visible behavior: restate user-visible
  semantics in plain terms (per `00-critical.md` § Before Code Changes).

### 3. Council (full trio, adversarial)

- **Load `/tzurot-council-mcp` first** and use its CURRENT roster + model IDs —
  a from-memory roster runs short and wastes the pass.
- One adversarial brief per model (identical text): compressed verified
  context + the decisions + numbered open calls + "attack: wrong X, missed Y;
  verdict per call; top 3 misses." Send all trio calls in ONE message
  (parallel).
- **Fold verdicts honestly**: unanimous-accept → confirm; split → the split IS
  the owner question (present all positions); council catches a real flaw →
  rebuild that section and SAY SO in the doc ("council-rebuilt", "the draft
  was self-contradictory — all three caught it"). Add a **§ Council record**:
  what was adopted, what was declined and why, per-model attribution.
- Councils earn their tokens on implementation truth (wire contracts,
  fan-out math, phase ordering) — feed them implementation-grade context,
  not vision statements.

### 4. Owner pass (batched)

- One `AskUserQuestion` batch: the genuinely-owner calls as separate questions
  (council splits, taste calls), everything council-unanimous as a single
  "Confirm all (Recommended)" with a Hold option that names the doc path.
- Owner answers that are new design input (not just confirm/deny) get folded
  as "owner-refined" decisions with the reasoning captured.
- Owner directives are immutable session state — a decided call never gets
  re-proposed in a later phase.

### 5. Land (acceptance + absorption wiring)

All in one commit (docs-only → direct develop commit is sanctioned):

- Artifact Status → `ACCEPTED <date>` + council/owner sign-off line; open
  calls table → per-row CONFIRMED/decided status.
- **Absorption map**: superseded proposals get a superseded-by note (keep the
  still-useful tables); themes whose items the artifact discharges get an
  annotation (strike what's absorbed, keep what remains); follow-ups rows
  promoted into the design get updated; `backlog/now.md` + `CURRENT.md`
  updated. `pnpm ops guard:proposal-links` + `pnpm backlog:lint` must pass.
- Declined ideas get NO tombstone — the decline rationale lives in the
  artifact's council record.

## Variants

- **Sibling boulders, shared grounding**: two related designs can share one
  grounding wave; draft both, run ONE trio pass covering both (verdicts per
  open call of each), land together.
- **Owner-input mid-flight**: owners drop links/notes/voice-dictated scoping
  models during grounding — treat as grounding input, cite as "owner
  directive" in the artifact, and use local `curl`/`wget` with a browser UA
  for bot-walled links the owner has personally vetted.
- **Prod bugs surfaced by grounding**: file on the board immediately
  (`now.md` § Production Issues) and let the owner sequence them vs. the
  design work — grounding agents reading real code find real bugs.

## Anti-patterns

| Don't                                       | Do                                                                |
| ------------------------------------------- | ----------------------------------------------------------------- |
| Draft from memory of how the system works   | Ground first; the draft cites the sweep                           |
| Present the council a vision statement      | Feed it call sites, orders, types                                 |
| Merge council riders silently               | § Council record with attribution                                 |
| Re-derive a prior proposal                  | Mine it; carry its resolved decisions forward                     |
| Land the artifact without absorption wiring | The landing commit IS the wiring                                  |
| Treat "design done" as "work done"          | Phasing table names the build slices; board carries the next step |
