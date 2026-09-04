---
id: TASK-672
title: prefix-diff terminal sanitizer misses C1 control codes (0x80-0x9F)
status: To Do
assignee: []
created_date: '2026-08-19 02:38'
updated_date: '2026-09-04 19:58'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 672000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review finding on PR 2146, deferred deliberately at the round cap rather than dismissed.

oneLine in packages/tooling/src/cache/prefix-diff.ts neutralises C0 controls and DEL (code < 0x20 || code === 0x7f) so that verbatim prompt text -- persona bios, pasted Discord messages -- cannot garble the terminal it prints to. It does not cover the C1 range 0x80-0x9F. On a legacy 8-bit-clean terminal 0x9B is an alternate CSI introducer, i.e. a second escape-sequence entry point that never passes through the ESC (0x1B) case already handled.

Why this is a real if small gap rather than a nit: the function has an explicit written threat model -- its own comment names CR rewinding the cursor and ESC opening an ANSI sequence as the things it exists to stop. C1 is the same class for a byte range the check happens to miss, so leaving it makes the stated threat model non-exhaustive rather than merely incomplete.

Why it was NOT fixed in 2146, stated as a real reason rather than pre-existing: the PR was at review round 6, the reviewer marked both remaining items explicitly optional and non-blocking, and the review-response hard cap says stop iterating at that point because a context that keeps iterating starts generating the defects it then fixes. Real-world exposure is also low -- modern UTF-8 terminal emulators do not act on 8-bit C1 codes.

Fix shape: extend the predicate in oneLine to (code >= 0x80 && code <= 0x9f), and add the case to the existing test that pins CR and ESC neutralisation. One line plus one assertion. Negative-control it the way the sibling assertions were: mutate the predicate away and confirm the test reddens.

SECOND, SEPARATE ITEM from the same review, cosmetic and NOT worth its own task: a window boundary can split a UTF-16 surrogate pair, since offsets are code-unit-wise, leaving a lone surrogate that renders as a replacement glyph. No crash and no effect on the divergence math. Fold it in here only if it is ever actually surprising in practice.

Acceptance: a C1 byte in prompt text renders inert in the divergence window; the test covering CR and ESC also covers C1; the mutation-reddens check is run.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:58
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-74 (Idea Guard workspace root coverage — three guards hardcode two of four roots); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-672 finds it.
---
<!-- COMMENTS:END -->
