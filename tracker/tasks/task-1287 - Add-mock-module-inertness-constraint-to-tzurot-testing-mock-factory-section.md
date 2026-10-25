---
id: TASK-1287
title: Add mock-module inertness constraint to /tzurot-testing mock-factory section
status: To Do
assignee: []
created_date: '2026-10-25 15:17'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1273000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A shared test mock module (src/test/mocks/*.mock.ts) must runtime-import nothing from the modules under test: a value import whose chain reaches a vi.mock ed module fires that factory while the mock module is mid-evaluation, and the circular await deadlocks vitest at startup - banner prints, then zero output, no error (the TASK-1254 aliasBatch.mock.ts case, fixed by inlining the literal). Add one constraint line + the symptom to the /tzurot-testing Creating Mock Factories section so the next test restructure does not rebuild the trap. Acceptance: the skill names the constraint (runtime-inert mock modules; type-only imports fine) and the hang symptom to recognize.
<!-- SECTION:DESCRIPTION:END -->
