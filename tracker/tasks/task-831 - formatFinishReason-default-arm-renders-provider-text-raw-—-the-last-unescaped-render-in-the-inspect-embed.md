---
id: TASK-831
title: >-
  formatFinishReason default arm renders provider text raw — the last unescaped
  render in the /inspect embed
status: Done
assignee: []
created_date: '2026-08-30 16:11'
updated_date: '2026-09-04 18:09'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 831000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-827 (#pending) wrapped error.message in an inert code span via toInertCodeSpan, and a structural sweep of all 36 interpolations in services/bot-client/src/commands/inspect/embed.ts found exactly one remaining raw render of external text: formatFinishReason (embed.ts:37-55) returns the provider string unmodified in its default arm, rendered at embed.ts:275. Every decorated arm returns a FINISH_REASONS constant and is safe by construction; only the default arm carries text the provider chose.

Weaker case than error.message: finishReason is provider-API-controlled, not user-controlled. Filed on defense-in-depth grounds, the same basis on which 00-critical requires encodeURIComponent on values from trusted API responses.

Why this was NOT ridden along with TASK-827: it is not a one-line change. embed.test.ts:127 pins the current behavior with an explicit test named "passes through unrecognized reasons unchanged", and the JSDoc states "Anything else -> no decoration". Reversing a deliberately pinned contract inside another PR is the rider shape that evades review scrutiny.

Design question to answer first: wrap ONLY the default arm (rendering becomes inconsistent — stop is bare, an unknown reason is code-spanned) or wrap ALL arms (consistent, but changes the visible Finish Reason line on every diagnostic embed). The second is an owner-taste call on a user-visible surface. Check for a prior decision on the passthrough before flipping it.

Fix shape: whichever arm set is chosen, wrap via toInertCodeSpan from @tzurot/common-types/constants/discord (already imported in embed.ts as of TASK-827). Update the embed.test.ts:127 case to match the chosen semantics, and add a masked-link case mirroring the five error-message cases TASK-827 added.

Acceptance: a provider-supplied finishReason carrying a masked link renders inert in the /inspect Response field; the chosen arm-set semantics are stated in the JSDoc and pinned by a test; and the change is canaried against the unwrapped version.
<!-- SECTION:DESCRIPTION:END -->
