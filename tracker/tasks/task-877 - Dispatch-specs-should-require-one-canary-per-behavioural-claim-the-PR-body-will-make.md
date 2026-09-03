---
id: TASK-877
title: >-
  Dispatch specs should require one canary per behavioural claim the PR body
  will make
status: To Do
assignee: []
created_date: '2026-09-03 12:05'
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

This touches a load-bearing skill and needs a review-gated PR of its own; it was deliberately not folded into any in-flight PR.

Acceptance: the spec template asks for one canary per behavioural claim; the report requirements surface claim/canary pairs; a spec written from the amended template on a real unit produces a claim set where every entry names its falsifying mutation.
<!-- SECTION:DESCRIPTION:END -->
