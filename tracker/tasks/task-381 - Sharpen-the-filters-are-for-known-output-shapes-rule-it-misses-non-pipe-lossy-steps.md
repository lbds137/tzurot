---
id: TASK-381
title: >-
  Sharpen the filters-are-for-known-output-shapes rule: it misses non-pipe lossy
  steps
status: To Do
assignee: []
created_date: '2026-07-31 22:53'
labels:
  - 'size:S'
dependencies: []
priority: medium
ordinal: 381000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Why:** `10-working-posture.md` § "Filters are for known output shapes" ALREADY EXISTS and was violated five times in a single session (2026-07-31). A rule that restates it is worthless — per `/tzurot-session-mining` step 3, an existing-but-violated rule is a compliance finding, not a missing-structure one. What is actually wrong is the rule's SCOPE and its lack of a read-side tell.

**The five instances, and why only two are covered by the current wording:**

1. `json.dumps(d)` defaults to `ensure_ascii=True`, escaping an em-dash to `—`; a literal `—` grep then missed a marker that WAS present. Nearly reported a passing smoke test as inconclusive. — a lossy TRANSFORM, not a filter.
2. `head -3` cut off the match behind three unrelated hits; nearly reported a shipped option as missing. — covered.
3. `railway logs <8-char-prefix> … 2>/dev/null` — a malformed identifier whose error was suppressed; the empty stdout read as "no data", nearly reversing a real finding. — stderr suppression, not a filter.
4. Grepped raw logs for a string my own extraction had normalized (query strings stripped), got zero, briefly believed the data had changed. — self-inflicted form mismatch.
5. `git push | tail -6` — covered, and the `git-commit-filter-guard` hook caught it (the only one caught by a guard).

So 3 of 5 fall outside "piping through grep/sed/tail/head", which is the only mechanism the rule names, and all of its cited examples are pipes.

**Fix shape (one PR to `.claude/rules/`, review-gated):**

- Broaden the mechanism from "filters" to **any lossy step between the data and your eyes**: pipes, `2>/dev/null`, encoding/serialization transforms (`json.dumps` ensure_ascii, URL normalization), and searching for a form you produced rather than the form on disk.
- Add the READ-side tell, which is the actual moment of failure: **an empty or short result means suspect your own invocation first** — (a) did I suppress stderr, (b) am I searching for a form I transformed the data into, (c) is my identifier complete and well-formed. Only after those, suspect the data.
- Consider merging with `00-critical.md` § "An empty or sparse tool result is not evidence that the data is gone", which covers the same failure from the store's side. Both were violated together; the failure lives in the seam — neither says "your own argument may be malformed."

**Do NOT just append a fourth cited example.** The rule already has three and they did not prevent five recurrences.

**Hook candidate worth evaluating in the same PR:** the commit/push filter guard is the one mechanism that actually stopped an instance. A `2>/dev/null` guard on diagnostic commands (railway/gh/psql) may be the cheap structural equivalent.

Surfaced 2026-07-31 (owner: "you should file the rule addition, otherwise it'll get lost").
<!-- SECTION:DESCRIPTION:END -->
