---
id: TASK-1210
title: >-
  guard:hook-probes 120s ceiling: the develop-code-commit-guard probe runs ~85s
  and times out under load
status: Done
assignee: []
created_date: '2026-10-11 14:54'
updated_date: '2026-10-11 20:54'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1199000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: guard:hook-probes runs each .probe.sh sequentially with PROBE_TIMEOUT_MS = 120000. On 2026-10-11 the develop-code-commit-guard probe measured 1m24s alone at load ~13 (252 rows after the TASK-1203 rows), and guard:hook-probes SIGTERMed a probe at the ceiling three times that day (pr-merge-review-check once, develop guard twice), each passing on rerun. A gate that fails on machine load trains reruns and hides real failures; CI runners are slower than the Deck at times.

What: measure per-probe wall time on CI (job log) and locally; then either raise the per-probe ceiling with the measured margin written beside the constant, or split the develop guard probe by section so no single probe approaches the ceiling. Do not lower coverage.

Acceptance: the slowest probe sits under half the ceiling on CI and locally, with the measurement cited at the constant.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-11 shipped in #2606: PROBE_TIMEOUT_MS 240s (slowest probe 66s@load14, 84s@13, 87s@25; CI whole set 49s); also cold-start eslint test timeouts that failed pre-push under load.
<!-- SECTION:NOTES:END -->
