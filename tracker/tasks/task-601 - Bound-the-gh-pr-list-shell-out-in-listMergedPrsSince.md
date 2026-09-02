---
id: TASK-601
title: Bound the gh pr list shell-out in listMergedPrsSince
status: Done
assignee: []
created_date: '2026-08-14 03:38'
updated_date: '2026-09-02 00:30'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 601000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: listMergedPrsSince (packages/tooling/src/release/github-prs.ts) shells out to gh pr list with no timeout. execFileSync defaults to 0, meaning unbounded. It is a network call, it runs on every release:range / release:draft-notes / release:verify-notes invocation, and it runs BEFORE the two git calls that PR 2097 just bounded in the same function chain.

So the failure that PR spent two rounds eliminating - a stalled connection hanging the command with no way to tell "still working" from "hung" - is still reachable one call earlier, in the same file. A rate limit, a network blip, or a gh auth prompt blocking on non-TTY stdin all produce it.

Fix shape: add a timeout to the execFileSync options, matching RANGE_GIT_TIMEOUT_MS in that file (30s). A gh API call that has not returned in 30s is not going to. Consider at the same time whether RANGE_GIT_TIMEOUT_MS and premigrate GIT_TIMEOUT_MS - both literal 30_000, both touched in 2097 - should become one shared constant; that is only worth doing if this third site lands, which it would.

Acceptance: every network shell-out in github-prs.ts carries a timeout; a test asserts it, matching the shape already used for countRangeChangedFiles and premigrate.

Filed rather than fixed in 2097 deliberately: that PR reached round 8 of a ~6-round cap, and five of its last six defects were introduced while fixing a previous finding. The reviewer explicitly offered fast-follow as the appropriate disposition. This is a clean small unit for a fresh context.

SECOND ITEM, same file, from the PR 2097 round-9 review: countRangeChangedFiles builds its diff-range arg as one template string, `${fromTag}..origin/${base}`. A --from or --base value starting with a dash could be parsed by git diff as an option rather than a revision. This is NOT shell injection - execFileSync with array args throughout - and it is operator-controlled only.

Merits disposition, not deferred for being theoretical: the failure is self-correcting. git rejects the malformed arg, the existing try/catch turns that into undefined, and the advisory prints SKIPPED rather than a number. The one outcome this function must never produce - a plausible wrong count - is unreachable by this path. So it is defense-in-depth on an already-safe failure mode.

Fix shape when this task is picked up: reject a leading dash on fromTag and base before building the range, or pass a `--` separator ahead of the revision arg. Do it in the same pass as the timeout above; both are hardening on the same two functions.

Note: assistant-generated from review, counts against the session net.
<!-- SECTION:DESCRIPTION:END -->
