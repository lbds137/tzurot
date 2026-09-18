---
id: TASK-1009
title: >-
  guard:prompt-tags cannot see a render site that embeds untrusted text without
  escapeXmlContent
status: To Do
assignee: []
created_date: '2026-09-18 02:28'
labels:
  - 'area:tooling'
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1005000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2446 review (claude-review, High): RecentDaysFormatter embedded model-derived digest text raw inside <recent_days>, a PROTECTED_TAGS entry, and pnpm ops guard:prompt-tags stayed green — the guard asserts only that every emitted structural tag is CLASSIFIED (protected / known-unprotected / non-prompt), never that each site rendering untrusted content into a protected tag calls escapeXmlContent. PROTECTED_TAGS neutralizes nothing by itself; escapeXmlContent is what does the work, and the guard has no view of it. Every sibling formatter (MemoryFormatter, QuoteFormatter, ParticipantFormatter, MemoryNoteSplitRender) escapes; one new formatter did not, and only the reviewer caught it.
Fix shape: extend packages/tooling/src/dev/check-prompt-tags.ts (or a sibling guard) with a second pass over the same production files: for each template literal or array join that emits a PROTECTED tag opening, find the interpolated identifiers that land between the opening and closing tag and require each to be wrapped in escapeXmlContent(...) or to appear in an allowlist of known-safe constant sources (the instruction constants, formatter-internal literals). Fail closed on an unwrapped interpolation; the allowlist lives in the guard with a one-line reason per entry. Pin with a fixture file that embeds a raw identifier and asserts the guard reds, plus the escaped form greens. Calibrate on the existing formatters first — the pass must be green on the current tree with a short allowlist, or it is the wrong heuristic.
Acceptance: a formatter that interpolates a non-constant value inside a PROTECTED tag without escapeXmlContent fails pnpm ops guard:prompt-tags; the current tree passes with every allowlist entry justified.
<!-- SECTION:DESCRIPTION:END -->
