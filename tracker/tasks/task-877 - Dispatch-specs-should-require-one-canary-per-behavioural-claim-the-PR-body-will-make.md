---
id: TASK-877
title: >-
  Dispatch specs should require one canary per behavioural claim the PR body
  will make
status: Done
assignee: []
created_date: '2026-09-03 12:05'
updated_date: '2026-09-04 08:57'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 876000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: three PRs in one session shipped a PR-body claim that described the INTENT of the change rather than the state of the artifact, and a reviewer caught each. #2314 said "four deltas, everything else byte-identical" - true of the moved region, silent about the new module header the split created. #2315 said two behaviours were "pinned by tests" when one had no fixture that could fail on it: every delimiter in the suite was three characters, where slice(match[1].length) and the old slice(3) are identical. #2316 left a comment asserting a scope the same commit had just invalidated.

The rule and the hook both already exist - 02-code-standards on behaviour-asserting comments, 10-working-posture on sweeping a changed premise, and pr-body-ref-gate.sh, which blocked two other claim lines in the same session. So this is a compliance gap, not a missing-structure one, and another rule would be worthless. Per 00-critical the fix has to remove the opportunity rather than restate the constraint.

The mechanical gap: dispatch specs already mandate canaries, but the author picks which behaviour to canary, and nothing ties that choice to the claims the PR body will later make. On #2315 the canaries targeted SUB_BULLET and the shared-classification drift - both real - while the unpinned tag-slicing fix went unmentioned and unverified.

Fix shape: amend the spec template canary section in .claude/skills/tzurot-orchestration/SKILL.md so the canary set is DERIVED from the claim set - for every behaviour the PR body will assert as fixed or pinned, name the mutation that falsifies it. A claim with no corresponding canary is the signal the claim is unverified, which is exactly the #2315 shape. Consider whether the report requirements should ask the orchestrator to list claim/canary pairs, so the main loop can see an unpaired claim before writing the body.

SECOND ITEM, same surface, folded in rather than filed separately. Inner workers repeatedly report GIT STATE read from the loaded project context stale gitStatus snapshot instead of from a live git command. Three occurrences in one session, all three naming a branch and uncommitted files that had not been current since session start. The orchestrator caught every one and pasted real output instead, so nothing escaped - the spec template report requirement that git-state claims appear as pasted command output is doing its job at that layer. The cheap addition is one line in the VERBATIM inner-worker instruction block telling the worker never to source git state from loaded context, only from a command it just ran. Same file, same section, so one PR should carry both.

THIRD ITEM, same root as the first. The PR-body claim gate blocked three separate lines in one session for the same shape: prose asserting that verification happened without naming the mechanism - I confirmed this empirically, measured both directions, verified against the files. Each passed once a command or a file cite was put on the same line. So the pattern is not only unpaired canaries but claim LANGUAGE that sounds verified; the template should say that a claim of having verified something names the command whose output is the evidence, in the spec and in the PR body alike.

This touches a load-bearing skill and needs a review-gated PR of its own; it was deliberately not folded into any in-flight PR.

FOURTH ITEM, added 2026-09-03 from PR 2319, and it is NOT covered by the three above. Those all address a claim with NO canary. This one is a claim WITH a passing canary whose scope is narrower than the sentence attached to it, which the one-canary-per-claim rule would have marked satisfied.

Two instances, one PR, both caught by review. Round 2: I tested whether the embedded COMMIT_RE copy inside BYPASS_RE could grant a false bypass, ran real fixtures, reported it verified - but every fixture held the real commit UNPREFIXED, where blocking is correct whatever the counts do. The reviewer varied exactly that property and found a spurious block. Round 3: the comment I then wrote asserted the inflation is symmetric between the two uses of the pattern; runtime says it is asymmetric. In both cases a test existed, passed, and was honestly run. What was wrong was the SCOPE of the sentence: the test covered one scenario, the claim described the mechanism.

00-critical already carries the inverse - verifying the mechanism is not verifying the scenario, i.e. confirming a mechanism says nothing about whether each listed trigger reaches it. The direction observed here is the mirror image and is not stated anywhere: verifying a scenario says nothing about the mechanism, so a claim generalising from one passing fixture to a property of the code needs either a second fixture varying the next property, or a sentence scoped to the fixture actually run. Mechanically findable at claim time - the tell is a sentence about a MECHANISM (cannot, always, is symmetric, is safe) resting on evidence that is a single SCENARIO.

Fix shape for this item specifically: one clause in 00-critical section Verify Before Accepting External Feedback stating the mirror direction beside the existing sentence, plus a line in the spec template canary section saying a canary pins the case it runs and not the general property, so a body claim broader than the canary is scoped down or given a second canary. Same surface and same root as the three above, so it rides the same PR rather than being filed separately.

Acceptance: the spec template asks for one canary per behavioural claim; the report requirements surface claim/canary pairs; the inner-worker block forbids sourcing git state from loaded context; 00-critical states the scenario-does-not-verify-mechanism direction beside its existing inverse; a spec written from the amended template on a real unit produces a claim set where every entry names its falsifying mutation and no entry claims more than its mutation covers.

### Items 1–4 SHIPPED (PR #2321); only acceptance clause 5 remains

The spec template derives canaries from the claim set (item 1), the report lists claim/canary pairs and every verified-claim names its command (item 3), the inner worker never sources git state from loaded context (item 2), and 00-critical carries the scenario-does-not-verify-mechanism mirror (item 4). Clause 5 — a spec written FROM the amended template on a real unit produces a fully paired claim set — is an observation to make on the next real dispatch, not something this PR could supply (the one paired example predates the amendment). Close this task on that observation; note the unit and its claim/canary pairs here when it happens.

### Clause 5 OBSERVED on TASK-642 (PR #2322) — closing

The first real unit dispatched from the amended template. The spec carried a twelve-claim table (K1–K12) written before any code, each row naming the probe cases it rests on and the mutation that falsifies it; the orchestrator applied every mutation, recorded which cases reddened, and restored the hook with an md5 proof. Pairs as measured: K1 identifier class → cases 1, 8, 9, 10, 17; K2 quote kind → 2 (the spec predicted 2 and 16; the report split off K2b, dropping the quote-walking prefix → 16 only); K3 -F check → 3, 4; K4 identifier requirement → 6; K5 lookbehind → 7; K6 rg and git grep alternation → 8, 9; K7 segment split → 10 (the spec predicted 15; the report showed 15 is double-protected by its own -F and corrected the hook comment to say that half is unpinned); K8 command-position check → 11, 15; K10 tool_name → 13; K11 bypass → 14; the round-2 double-quoted-run alternative → 18, 19 only. Three entries were scoped down rather than canaried, each saying so: K4b (a plain trailing anchor is pinned by the trigger structure, the input has no backslash), K9 (a scope decision, not a mechanism), K12 (rc-2 fall-through is structurally mirrored from the model hook and not probe-able).

Both halves of the clause held: every entry names its falsifying mutation, and where a prediction was wider than its mutation (K2, K7) the report narrowed the claim instead of the canary. The main-loop diff read still found a real miss the claim set did not cover (a double-quoted flag value before the pattern), which became the round-2 claim with its own canary — the mechanism catches unpaired claims, not absent ones.
<!-- SECTION:DESCRIPTION:END -->
