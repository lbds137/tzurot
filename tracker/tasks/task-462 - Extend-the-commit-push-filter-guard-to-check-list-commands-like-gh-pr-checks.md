---
id: TASK-462
title: Extend the commit/push filter guard to check-list commands like gh pr checks
status: To Do
assignee: []
created_date: '2026-08-07 22:30'
updated_date: '2026-08-07 22:30'
labels:
  - 'area:tooling'
  - 'area:process'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 461000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: git-commit-filter-guard blocks a filtered git commit/push. It does NOT cover gh pr checks, and that is the pipe that caused real damage: gh pr checks 2000 | tail -30 cut a red lint off the TOP of the list, and a failing release PR got reported as green. The SHA-pinned actions/runs query caught it, not the check list.

Same class, same fix shape: a check-list command whose output is truncated hides failures at whichever end gets cut. There is a clean alternative that loses nothing: awk -F tab and select rows where field 2 is not pass.

Fix shape: extend the existing PreToolUse guard (must be BLOCKING — non-blocking PostToolUse output never reaches the agent, confirmed by the TASK-458 probe) to reject a gh pr checks piped into tail/head, naming the awk alternative in the message. Keep GIT_TARGET untouched so the three-way agreement test is unaffected.

Caveat worth weighing before building: piping is legitimate for many commands, so scope this narrowly to check-list commands or it becomes noise. Owner call — a new blocking guard changes every session.

Evidence of recurrence: the agent reached for a filtered git commit/push FOUR times in the 2026-08-07 session and was blocked each time; the one uncovered variant is the one that landed.

## SCOPE RECOMMENDATION 2026-08-07 — narrow it to TRUNCATION, not filtering

Owner is open to this "if the trade-off is worth it". Analysis, with the
evidence from the session that produced both the incident and the counterexample:

**As filed, the trade-off is bad.** Extending the guard to "filters on
gh pr checks" would block legitimate use. In this same session the useful
invocation was `gh pr checks 2002 | awk -F'\t' '$2 != "pass"'` — a filter whose
whole purpose is to SURFACE failures. A guard that fires on the correct query
gets routed around, and a routed-around guard is worse than none.

**The real failure mode is truncation, not filtering.** The incident: `gh pr
checks 2000 | tail -30` on a list whose red `lint` row sat at the TOP. tail
silently dropped it and a failing release PR was reported as green. Contrast
`| grep fail`, which is a deliberate question with a complete answer. head/tail
discard by POSITION and cannot tell you they discarded anything; grep/awk/jq
select by PREDICATE and their emptiness is itself informative.

**Recommended scope**: block `head`/`tail` (and `sed -n 'N,Mp'`-style windowing)
on gh READ commands — `gh pr checks`, `gh pr view`, `gh run list`,
`gh api .../comments` and the ops wrappers `gh:pr-comments` / `gh:pr-reviews`
(the git-workflow skill already says in prose "Never pipe review fetches through
| tail"). Explicitly ALLOW grep/awk/jq.

**Cost side, honestly**: the guard process already runs on every Bash call, so
one more pattern is ~free at runtime. False-positive surface is small but not
zero — `gh run list | head -5` to eyeball recent runs is a reasonable thing to
want, and would be blocked. Acceptable: the message can name the full-output
alternative, and the whole point is that "I only wanted the first few" is
exactly the assumption that hid the red row.

**Scope caveat the owner should weigh — this buys ONE class, not the pattern.**
The two worse misses in the same session were `sed -n '18,40p'` on a tracker
task file (a window mistaken for the whole file, which produced a wrong pushed
commit and a wrong claim to the owner) and a grep scoped to two named files
declared a complete sweep. Neither is a gh command; neither would be caught.
Those belong to TASK-465, which adds a decision-point trigger to the existing
lossy-steps rule. Do not let this guard create a false sense that the class is
covered.

Verdict: worth building, at the narrowed scope. One confirmed incident with real
cost, deterministic trigger, near-zero runtime cost. AWAITING owner go-ahead on
the narrowing before implementation.
<!-- SECTION:DESCRIPTION:END -->
