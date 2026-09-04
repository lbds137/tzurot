---
id: TASK-56
title: 'Flow-level integration/e2e gate (the "declared-flow" layer in topology:check)'
status: To Do
assignee: []
created_date: '2026-06-26 00:00'
updated_date: '2026-09-04 19:37'
labels:
  - 'area:tooling'
  - 'area:testing'
  - 'size:L'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Flow-level integration/e2e gate (the "declared-flow" layer in `topology:check`)

**Why:** The Test-Pyramid epic (Phases 1–4, PR1–7) populated the CONTRACT tier — every cross-service surface is verified in isolation — but there is no gate ABOVE the seam level: nothing checks a whole multi-service flow as a sequence (e.g. Discord → gateway → worker → delivery). The PR7 close-out council (GLM-5.2 / Kimi-K2.7 / Qwen-3.7, 2026-06-26; **2 of 3 to park, Qwen dissented to drop**) deferred Kimi's "declared-flow" layer (baseline the known flows in `topology:check`, presence + sunset) because with integration=1 / e2e=0 today it would "guard an empty room." **Fix shape**: a declared-flow registry + presence gate, OR — likely the cheaper solo spend — the post-deploy smoke check filed in tracker `doc-53` (§ Post-deploy smoke check). **Promote when**: a prod bug ships that passes every seam contract but fails on multi-service STATE or SEQUENCING (the precise gap a per-seam gate structurally cannot catch). Surfaced 2026-06-26 (PR #1356/#1358 epic close-out council).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Watch's observable (integration=1/e2e≈0, no declared-flow registry) is still the current state; council explicitly deferred rather than dismissed it, with a named promote trigger (a prod bug passing every seam contract but failing multi-service sequencing). Evidence: `git grep -rn "declaredFlow\|declared-flow" packages/tooling` → no results; `find tests/e2e -type f -name "*.ts"` → 4 files, none a true multi-service sequence e2e.
---
<!-- COMMENTS:END -->
