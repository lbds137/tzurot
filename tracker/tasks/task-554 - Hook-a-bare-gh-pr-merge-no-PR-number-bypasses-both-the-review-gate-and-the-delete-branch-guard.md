---
id: TASK-554
title: >-
  Hook: a bare gh pr merge (no PR number) bypasses both the review gate and the
  delete-branch guard
status: Done
assignee: []
created_date: '2026-08-12 16:13'
updated_date: '2026-10-25 05:12'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:dependent'
dependencies:
  - TASK-1242
priority: medium
ordinal: 554000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2078 round 4 review. extract() only returns a PR number when a literal digit token follows gh pr merge. With no digit it returns empty, and pr-merge-review-check.sh exits 0 at the "if [ -z $PR_NUM ]" check before either gate runs.

A numberless "gh pr merge --delete-branch" is valid usage - gh resolves the PR from the checked-out branch - and it is arguably the most natural moment to reach for the flag, since you are sitting on the branch you are retiring. In that shape the review gate does not inject the review AND the worktree precondition does not fire.

Scope: this predates the delete-branch guard; the review gate has always had it. That is not a reason to leave it, it is the reason it was never noticed. Not fixed in 2078 because the fix changes the REVIEW GATE for every merge, not just the new guard, and needs its own probe matrix - which is more than a round-4 ride-along should carry.

Fix shape: the tokenizer can already tell the two empty cases apart. adjacent_merge_scan finds gh/pr/merge as three adjacent tokens; if that holds but no digit followed, a real invocation is present with an implicit PR. Emit that as a third signal, then resolve the number with gh pr view --json number (no positional arg resolves from the current branch) - the same call resolve_pr_view already makes. Keep the fail-open posture: an unresolvable implicit PR must allow the merge, never block it.

Landmines: the empty-PR_NUM path is also reached by a command that merely MENTIONS the phrase without invoking it, so the distinguishing signal has to come from adjacency, not from emptiness. Probe cases must cover: bare merge with the flag blocks on conflict, bare merge without the flag still injects the review, a mention-only command still no-ops, and gh pr view failing degrades to allow.

Acceptance: a numberless gh pr merge is gated by both the review gate and the delete-branch precondition, or the gap is ruled out on merit with the reason recorded; the probe pins whichever holds.

## Merged from TASK-555 (2026-10-12)

TASK-555 (priority medium): pr-merge-review-check hand-parses bash with shlex, and each review round finds another boundary. PR 2078 rounds 5-8 were the same defect class four times: shlex tokenizes, it does not model bash grammar. Round 5: a redirection OPERATOR read as a command separator, truncating the flag walk (under-arm). Round 6: a bare NEWLINE not read as a separator, walking into the next statement (false block, wrong-PR misattribution). Round 7: a backslash CONTINUATION read as a statement break, so a decoy inside an echo armed the gate (false block, unrecoverable). Round 8: a redirection TARGET scanned as an argument, so a file named -d read as the flag (false block). Each fix is correct and pinned, but they are patches to an approximately-bash model; every one was found by review rather than the 221-assertion probe suite because the fixtures shared the blind spot with the code. This task (the numberless `gh pr merge` gap) adds another recognition case to the same parser, so decide them together.

Two directions, not exclusive: (a) reduce exposure: every finding was "false block with no escape", which comes entirely from the delete-branch guard being deliberately NOT ackable; making it ackable after one showing turns a tokenizer gap into one retry, at the cost of a precondition that can be bypassed by retrying (an owner-facing strictness tradeoff, not an engineering call). (b) replace the hand-rolled walk with a real parser; bashlex is the obvious candidate but adds a dependency to a hook that currently needs only stdlib, and hooks run on EVERY Bash tool call, so import cost is a live concern.

Landmines: the PR-number walk and the flag walk have deliberately OPPOSITE strictness (the number must not over-collect, the flag must not under-collect), so a rewrite must preserve both directions. The fallback paths (legacy_scan, adjacent_merge_scan, depth cap) deliberately over-arm the review gate and deliberately do NOT arm the guard; that asymmetry is load-bearing and documented in the file. Round 13 addendum: a different sub-class, INVOCATION RECOGNITION: SHELLS and WRAPPERS were exact-string sets, so `bash -lc "gh pr merge N --delete-branch"`, `/bin/bash -c "..."` and `/usr/bin/env bash -lc "..."` ran with NO gate whatsoever while the identical `bash -c` blocked. Fixed in 2078 via a basename `command_name` helper and a clustered `-c` match. It undercuts the "false blocks are recoverable" half of option (a): ackability does nothing when the hook never runs. Any decision here must cover recognition failures separately from boundary failures.

**OPEN OWNER DECISION, preserved (DECIDED 2026-08-14, owner, TASK-599 digest): MEASURE bashlex import cost first; adopt if cheap (~<50ms, since the hook runs on every Bash call) because ackability cannot help the recognition-failure shape; if expensive, accept and document the residual risk, keeping the current fixes.** The measurement has not been done: the decision stays open until it is. Acceptance (555): either the exposure is reduced so a tokenizer gap is recoverable, or the parsing is replaced with something that models bash, or the class is ruled out on merit with the residual risk stated.

Dependent on TASK-1242 (backlog review batch C, owner-approved 2026-10-18): pr-merge-review-check.sh moves to the Seyag merge-review component, so this defect and the bashlex measurement ride upstream with it. When Seyag ships merge-review, check whether it closes the numberless-merge gap; close this task if so, otherwise re-scope it to the gap the Seyag version still has.

CLOSED 2026-10-25 per this routing: Seyag shipped merge-review with the numberless arm (seyag 367ae14 port + review rounds b0ab9d0/281474b/7e8343b/1275995, HEAD 59a2518). Runtime evidence: the seyag probe suite passes every numberless row from the seyag checkout — "numberless merge arms the branch's PR", "a flag value is not the PR number — the numberless arm fires", "numberless merge with a failing lookup: allowed" (the fail-open landmine holds), "a cd before a numberless merge: refused", compound/selector rows all PASS. The preserved bashlex import-cost decision rode upstream with the component — it now lives on the Seyag tracker, not here. Tzurot copy retirement is TASK-1242's.
<!-- SECTION:DESCRIPTION:END -->
