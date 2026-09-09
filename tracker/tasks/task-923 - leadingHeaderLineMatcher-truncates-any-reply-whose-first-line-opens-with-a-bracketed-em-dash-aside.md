---
id: TASK-923
title: >-
  leadingHeaderLineMatcher truncates any reply whose first line opens with a
  bracketed em-dash aside
status: To Do
assignee: []
created_date: '2026-09-09 16:34'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 921000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the name-agnostic leadingHeaderLineMatcher in services/ai-worker/src/services/context/RealMessagesBuilder.ts has no end-of-line requirement, so it strips a header-shaped bracket group sitting at position 0 whatever follows it on the same line. Any reply opening with a bracketed, em-dash-separated aside loses that aside. Measured through the real strip pipeline with a scratch vitest probe against the ai-worker source:

  [Name remembers - the promise made] I said I would never leave.  becomes  I said I would never leave.
  [laughs - really] Anyway, no.  becomes  Anyway, no.

(The dashes above are em dashes in the actual fixtures; written as hyphens here only to keep this description parseable.) The second case carries no personality name at all, which is what makes this the sibling matcher rather than the self-scoped one TASK-920 shipped. This is user-visible content deletion in a roleplay product and it has been live since TASK-727.

The suite looks like it covers this and does not. The existing keep-case  [laughs] Anyway, no.  passes only because it lacks the separator; add one and the same fixture is eaten. Treat that keep-case as a false negative when writing the fix.

Scope note: TASK-920 (PR #2379) closed the same defect in the self-scoped leadingSelfHeaderLineMatcher by requiring the closing bracket to end the line. That fix does NOT reach this matcher, and the owner decided on 2026-09-09 to ship #2379 and file this separately rather than widen that PR.

Why this needs a measurement before a fix rather than the same one-line lookahead: requiring end-of-line here would stop stripping a genuine leak shape, a model emitting its header and then continuing the reply on the same line. There is no personality name to scope by, so the self-matcher trick does not transfer, and the tradeoff is a product call about which failure is worse. The prod signal that decides it is whether one-line header-plus-reply leaks actually occur; the headerLinesStripped telemetry plus a log sweep for the strip warn can answer it.

Acceptance: a prod measurement establishing whether a header followed by same-line reply text occurs in practice; then either the end-of-line lookahead with a canary showing the narration fixture survives and the leak fixtures still strip, or a narrower discriminator with the same canary pair; plus a strengthened keep-case replacing the separator-free one that currently passes vacuously.
<!-- SECTION:DESCRIPTION:END -->
