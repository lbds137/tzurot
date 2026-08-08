---
id: TASK-472
title: 'The fixup rider check fires at commit time, after the rider is already written'
status: To Do
assignee: []
created_date: '2026-08-08 19:55'
updated_date: '2026-08-08 19:55'
labels:
  - 'area:process'
  - 'area:tooling'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 472000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced 2026-08-08 across PRs 2008, 2009, 2010 and 2011 in one session.

Evidence: four separate defects, one per PR, each a SMALL RIDER on a larger change that was itself correct. (Corrected 2026-08-08 from "every defect introduced" — too strong. #2009 rounds 2-7 also found gaps in the original tokenizer, which are ordinary primary-change defects. The rider class is distinctive for evading the primary change's scrutiny, not for being the only source of bugs.)

- 2009: a heredoc-stripping rider, added to close a fail-open, deleted any real merge invocation that followed a false opener - a total gate bypass, strictly worse than the bug being fixed.
- 2008: a doc rider fixing stale figures introduced a pronoun ambiguity that made a false claim about what runs in CI.
- 2010: a compression rider dropped an attribution and left the surviving sentence describing the current tool as doing the opposite of what it does.
- 2011: a rule rider replaced an over-counting path list with an allowlist that under-counted seven runtime packages - the same defect mirrored.

Why the existing structure did not prevent it: the rider checklist in /tzurot-review-response rule 3 is correct and was READ four times that day. The FIXUP RIDER CHECK hook also fired on every one of those commits. Both are compliance-adequate and neither worked, so a third restatement is worthless.

The mechanism defect: the hook fires as a post-commit reminder, which is AFTER the rider is written, staged and committed. At that moment the honest answer to "does this need its own test" costs a rewrite, so the cheap read is "it is fine". The checklist asks authoring questions at a non-authoring moment.

Fix shapes worth weighing, none obviously right yet:
(a) Move the prompt earlier - fire on the Edit/Write that touches a file already in the staged set, not on the commit.
(b) Make it blocking rather than advisory for riders that ADD a function or a branch, so the answer has to be given rather than skimmed.
(c) Accept that the authoring moment cannot be hooked and instead make the REVIEW catch it cheaply - a rider-specific review prompt.
Option (c) is what actually worked every time in this session: the reviewer caught all four.

Acceptance: either the trigger moves to a moment where the answer is still cheap, or the rider class is explicitly delegated to review with the checklist demoted. Deciding to keep it as-is is also a valid outcome if written down with the reason.
<!-- SECTION:DESCRIPTION:END -->
