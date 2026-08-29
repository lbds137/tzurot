---
id: TASK-827
title: >-
  Backtick error.message in the /inspect Error field — the last masked-link
  surface there
status: To Do
assignee: []
created_date: '2026-08-29 22:06'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 827000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2255 sanitized every identifier-shaped value in the /inspect diagnostic embed through stripMarkdownDelimiters, but deliberately left services/bot-client/src/commands/inspect/embed.ts error.message and error.category alone: stripping ()[]<> from a diagnostic message destroys the diagnostic it exists to carry (expected (a), got (b)). That leaves error.message as the ONE remaining line in that embed capable of rendering a live masked link.

The severity is higher than the PR body stated, and the review corrected it: the PR argued error.message is not a free-text user field. A reviewer pointed out that model and provider ARE free text (validated for length only) and routinely appear INSIDE a provider error string — model not found: <user-crafted id> — so user-controlled text reaches this line indirectly. The deferral reasoning about readability still holds; the claim that no user text can reach it does not.

Fix shape: wrap the rendered error.message in a backtick code span rather than stripping it, since markdown links do not render inside inline code and the diagnostic punctuation survives. The wrinkle that makes this a separate change rather than a one-liner: the message can itself contain a backtick, which would terminate the span early and re-expose the tail. Decide the escaping rule first — a fenced block, a longer backtick run sized to the content, or strip backticks only. The value is already truncated to 200 chars at the call site, so the chosen form must survive truncation mid-span too.

Acceptance: a provider error string carrying a masked link renders inert in the /inspect Error field; ordinary punctuation such as parentheses survives unchanged; a message containing a backtick cannot break out of the span; and the behavior is canaried against the unescaped version.
<!-- SECTION:DESCRIPTION:END -->
