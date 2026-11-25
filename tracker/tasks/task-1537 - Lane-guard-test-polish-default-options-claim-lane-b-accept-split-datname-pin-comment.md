---
id: TASK-1537
title: >-
  Lane guard test polish: default-options claim, lane-b accept split, datname
  pin comment
status: To Do
assignee: []
created_date: '2026-11-25T07:40:00Z'
labels:
  - area:test-utils
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1537000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2807 (TASK-1536) review round 5 left four non-blocking nits. The owner ruled that the PR merges and they are filed. Test-utils residue is filed rather than declined (06-backlog.md, process-residue default: test-utils counts as runtime there).

What:
1. packages/test-utils/src/testLane.test.ts, test "uses process.env and the workspace root when called with default options": it stubs TZUROT_TEST_LANE=b, and resolveTestLane returns early on a non-empty env lane, so the findWorkspaceRoot(process.cwd()) default never affects the result. Either rename it to "uses process.env when called with default options", or add a case with TZUROT_TEST_LANE stubbed to '' that asserts lane a's database is accepted from this checkout.
2. Same file: split "accepts lane b on its own database and on tzurot_test under CI" into two its, or drop its tzurot_test half (the lane-a CI accept test already covers that path).
3. packages/tooling/src/test/test-lane.ts: the comment above the pg_database datname query should cite the specific test "refuses an unsafe database name before invoking podman", and its line (over 100 columns) should be wrapped by hand.
4. testLane.test.ts: rename "refuses another lane integration database and names both lanes" to use "another lane's".

Acceptance: the four edits land; for item 1, either the test name no longer claims the workspace-root default, or a mutation replacing that default with a fixed rootDir turns the new case red.
<!-- SECTION:DESCRIPTION:END -->
