---
id: doc-7
title: 'Theme: Follow-Up Pool Drain'
type: other
created_date: '2026-07-28 11:11'
---

### Theme: Follow-Up Pool Drain

_Focus: get the small-item pool (now the `tracker/` task store; ~335 open tasks) to a size where the aging surface is actionable — by shipping the work, not by deleting it._

Surfaced 2026-07-25. The admission bar + ruled-out exit (#1787) stop the inflow;
this theme is the outflow. Both halves are needed — the measurement below shows
outflow alone cannot win.

### The measurement (2026-07-25, reproducible by grep)

Growth, from `git show <sha>:backlog/cold/follow-ups.md | grep -c '^|'` at weekly points:

| Date       | Rows |
| ---------- | ---: |
| 2026-06-20 |  116 |
| 2026-06-27 |  156 |
| 2026-07-04 |  192 |
| 2026-07-11 |  263 |
| 2026-07-18 |  319 |
| 2026-07-25 |  357 |

**3.1× in five weeks, +48/week.** The 2026-07-24 triage read all 366 rows, merged
five PRs and removed ten — and that week still ended **+38**. Outflow at any
plausible rate loses to inflow; that is why #1787 exists.

**Trigger-shape split** across the 336 rows carrying a `Promote when:` — note that
missing triggers were never the problem, 94% have one:

- **123 opportunistic** — "next `.claude/rules` PR", "next tooling-DRY pass", "whenever someone touches this"
- **103 event-gated** — "a user reports", "p95 > 10s", "if config counts grow"

**The opportunistic rows do not cluster by trigger phrase**: 72 distinct named
targets across 128 clauses, **zero repeated**. Each names its own file
(`VisionProcessor`, `ReleaseReconcile.ts`, `MistralTtsProvider`). Clustering by
**domain** works where clustering by phrase does not — restricting the match to
the trigger clause rather than the row body is what makes it trustworthy (a
whole-row keyword pass was tried first and rejected: it returned STT transcripts
and Pocket TTS quantization as "quota" hits).

| Domain                | Rows | Domain          | Rows |
| --------------------- | ---: | --------------- | ---: |
| browse / UI           |   10 | vision          |    3 |
| jobs / queue          |   10 | quota           |    2 |
| preset / config       |    9 | notifications   |    2 |
| skills / rules / hooks |    8 | sync            |    2 |
| memory                |    7 | website / docs  |    2 |
| tooling               |    7 | tts / voice     |    5 |
| release               |    6 |                 |      |

**~73 of 128 cluster; ~55 do not** — each naming a unique file with no sibling.

### Phase 1 — Batch the clustered rows (~73 rows, ~13 PRs)

Each domain becomes one PR that does the pass its rows are waiting for. Work the
rows literally requested; ~2–10 rows each. Start with the largest clusters
(browse/UI, jobs/queue, preset/config) to establish the rows-per-batch rate
before committing to the projection.

- [x] Confirm the domain assignment per row before each batch (the table above is
      a regex clustering, not a hand-read — treat it as a starting list)
- [ ] One PR per domain; remove its rows in the same PR per the removals gate

**Batch log** (rows-per-batch rate data):

- **jobs/queue** — #1862 (2026-07-29): 6 tasks shipped (10/97/171/212/219/319) of 19
  open `area:jobs`; the rest are own-PR-sized (M/L) or honestly gated — the regex
  table's "10 rows" overcounted by including gated members. Hand-read confirmed
  essential before each batch. Note: browse/UI cluster should WAIT for the UX
  epic's Waves 4–6 (factory sweep rewrites that surface).
- **config** — #1863 (2026-07-29): 3 tasks shipped (12/37/42) + 2 dispositioned
  (28 archived on a measurement — premise gone; 188 re-grounded half-stale) of
  the table's "9 rows". Second batch confirming the pattern: regex-cluster
  counts ≈ 2× the buildable yield; the rest are gated/owner-call/own-PR-sized.
  Projection at this rate: ~13 clusters ≈ ~35-45 shippable items, not ~73.
- **tooling (schema-audit sub-batch)** — #1864 (2026-07-29): 5 tasks shipped
  (114–118) — the highest-yield batch yet, because all five came from ONE PR's
  review rounds against ONE module family (task-117's promote-when literally
  named the bundle). Selection heuristic confirmed: same-origin same-module
  clusters beat trigger-regex clusters. Remaining tooling candidates (51, 142,
  4) are own-PR-sized.

### Phase 2 — The ~55 scattered singletons

No natural batch: each names a distinct file, so the trigger can never fire on its
own. The honest fork per row is **do it now in a sweep** or **rule it out on
merit** — this is where `06-backlog.md`'s ruled-out exit stops being theoretical.

- [ ] Read each; sort into do-now vs rule-out. NOT a bulk delete — the exit
      requires a technical reason per item in the removing commit, and anything
      user-visible is the owner's call.
- [ ] **Promote the rationale check first**: `doc-47` (Idea: Ruled-out removals need a mechanical rationale check) is explicitly gated on this phase
      starting. Build it before the first batch of rule-outs, not after.

### Phase 3 — Make batch entries reachable

`dev:deferred-refs` scans the tracker store for tasks naming your changed paths
and prints them at commit/push (`packages/tooling/src/dev/check-deferred-refs.ts`)
— but only tasks. Pointing it also at the tracker doc store (`tracker/docs/`) would
make a filed batch surface when someone touches a file it names.

- [ ] Detail + tradeoffs in `doc-48` (Idea: BACKLOG.md ↔ 06-backlog.md content parity has no guard) (option 3) — same domain, tracked there

**Honest qualification** measured the same day: the admission bar's premise is
"nobody greps a several-hundred-row table before unrelated work," and
`deferred-refs` does exactly that automatically. But it surfaced **1 of 357 rows**
across ~6 pushes touching tooling, rules, workflows and docs — most rows name a
symbol rather than a path it can match. The bar stands; the qualification is that
a path-naming row is meaningfully more reachable than a symbol-naming one.

### Success criterion

Not zero. The pool is honest — the 2026-07-24 full read found ~0 rows removable
on the shipped/obsolete exits. Target is a pool small enough that the digest's
oldest-20 surface (`pnpm ops backlog:digest`) rotates through real candidates
instead of showing the same 2026-01-26 tasks every run.

### Notes

Tasks live in `tracker/tasks/` as the authoritative text (the table this theme
originally measured was imported 1:1 in #1822); this file is the scope index.
Mark tasks Done as each phase ships, per `06-backlog.md`'s session-end removal
gate.
