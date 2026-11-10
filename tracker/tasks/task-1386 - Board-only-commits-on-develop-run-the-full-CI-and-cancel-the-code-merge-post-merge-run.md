---
id: TASK-1386
title: >-
  Board-only commits on develop run the full CI and cancel the code merge
  post-merge run
status: Done
assignee: []
created_date: '2026-11-10T14:23:00Z'
updated_date: '2026-11-10T22:03:00Z'
labels:
  - area:ci
  - size:S
  - state:ready
dependencies: []
priority: high
ordinal: 1369000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: ci.yml:4-7 triggers on every push with no path filter, and ci.yml:13-15 cancel-in-progress groups by branch. 9 of the last 22 CI runs were docs(backlog) pushes to develop, and all 5 cancelled runs were develop runs cancelled by the next push (e.g. the abfc84511 merge run cancelled by board commit 0e8e8b6a9), so a code merge loses its post-merge CI signal whenever a board commit follows within ~8 min.
What: have buildCommitMessage (packages/tooling/src/dev/tracker-commit.ts:142) append [skip ci], or add a paths-ignore for tracker/ backlog/ docs/ root md on develop pushes (decide in the PR; [skip ci] covers only tool-made commits). Update .claude/skills/tzurot-git-workflow/SKILL.md:55.
Saving: ~2,300 runner-s per board commit (Fable perf review 2026-11-10, item P1).
Risk: backlog:lint and lines:check no longer run in CI on board SHAs; pre-push docs-only path runs both (.husky/pre-push:88-99).
Acceptance (revised 2026-11-10 at build): a board-only push to develop runs CI with every heavy job skipped and cancels no other develop run; a code push still runs in full. Not "no run": main's ruleset requires 13 CI contexts and the release PR head is develop's tip (usually a board commit), so paths-ignore or [skip ci] would leave those contexts unreported and block the release merge.
Post-merge proof: on the first board push after merge, list check-runs for that SHA and confirm every main-required context (all six unit-tests cells included) is present and successful; then confirm the next code push runs in full. Then replace the unit-tests job comment's "may not expand its matrix (not verified here)" hedge in ci.yml with what was observed, and run `pnpm ops release:develop-ci` once to see it step over the board run live.
Shipped: PR 2739 (merged 2026-11-10 21:54Z as f939de8f1, f4e55be07, 4fff6cd79; residue + TASK-1399 in the PR body).
Proof (2026-11-10, board push ee47ddd55, run 42909786289): lint/build/component-integration-tests/mutation-tests/hook-posix-parse skipped; the six unit-tests cells, six docker-build-smoke legs and voice-engine-tests reported success after setup/teardown only (2 steps each); all 13 main-required contexts present. Code run 42909577442 on 4fff6cd79, in flight when the board push landed, completed success (not cancelled). `pnpm ops release:develop-ci` stepped over the board run live: `success run 42909577442 sha 4fff6cd79`, exit 0. The matrix-hedge step is moot: step-gated matrices never take a job-level skip, so the expansion question stays unobserved and the ci.yml hedge stays accurate.
<!-- SECTION:DESCRIPTION:END -->
