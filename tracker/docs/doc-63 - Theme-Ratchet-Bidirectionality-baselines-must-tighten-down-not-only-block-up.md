---
id: doc-63
title: >-
  Theme: Ratchet Bidirectionality - baselines must tighten down, not only block
  up
type: other
created_date: '2026-08-09 15:44'
---

_Focus: every ratchet in the repo blocks regressions UP; almost none has a moment where it tightens DOWN. Owner directive (2026-08-09, verbatim): "we ratchet on a lot of things but I'm not convinced we ever revisit those ratchets later to tighten them down rather than just keep things from going up."_

### The inventory (each gets the same three questions)

Per ratchet: (1) does a down-tightening moment exist at all? (2) who/what owns invoking it? (3) what would the tightened value be derived from?

| Ratchet | Baseline | Down-mechanism today |
| --- | --- | --- |
| CPD filtered-lines | `.github/baselines/cpd-baseline.json` | `cpd:update-baseline` CAN write lower, but nothing ever triggers it after a dedup ships |
| Test-coverage gaps | `test-coverage-baseline.json` (`knownGaps`) | closing a gap doesn't shrink the list unless `--update` is run; no cadence |
| Mutation scores | per-package baselines | `mutation:update-baseline` needs fresh local reports for EVERY package — so heavy it's only run when forced |
| Always-loaded lines/bytes | `lines-baseline` | the ONLY one with a scoped down-write (`lines:update-baseline --surface`) — and it has never been used to ratchet down |
| Lint suppressions | xray `--suppressions` target 0 | count-only; no baseline, drifts unwatched |
| pnpm.overrides bounds | TASK-317 | undershoot direction already filed as a task |

### Phase sketch

- **Phase 1 — audit**: run each ratchet's measurement fresh; compare actual vs baseline; every slack gap (actual well under baseline) is a free tighten. Output: per-ratchet delta table.
- **Phase 2 — down-writes**: apply the free tightens via each tool's sanctioned update path (never hand-edits); one PR, before/after in the body.
- **Phase 3 — cadence**: give down-tightening an owner-moment (candidate: the release preflight or the periodic doc-audit) so this theme doesn't itself become a one-off.

### Members / relations

- The doc-61 context-economy pass is this theme's `lines:check` instance (trim then down-write the baseline) — being built first, and its shape is the template for Phase 2.
- TASK-323 (tokens not lines) refines the lines ratchet's metric; TASK-317 is the overrides instance.

