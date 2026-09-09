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

Design note carried from the TASK-920 review (PR #2379), worth reading before writing the first line of the fix. That PR needed THREE review rounds to get its five-line sibling matcher right, and the three defects were: no end-of-line requirement, no trim on the comparand, and no boundary after the name prefix. Every one of those properties is something the render path already knows — buildHeaderLine assembles name, then either a space-led id-tag suffix or the space-led separator, and sanitizeHeaderName trims and collapses runs before any of it. The matcher kept being wrong because it restates that knowledge by hand instead of deriving from it.

So the recommended starting point here is NOT a fourth hand-added lookahead on the existing pattern. It is to build the matcher FROM the render path shape, so that a change on the render side cannot silently desynchronise the strip side. If that turns out to be impractical, say why in the PR body rather than defaulting to another lookahead.
<!-- SECTION:DESCRIPTION:END -->

CORRECTION from the beta.221 pre-release audit (2026-09-09), read before acting on anything above. This task blames the wrong deleter. Run through the actual two-stage pipeline that ResponsePostProcessor calls (stripRealMessageEchoArtifacts, then stripResponseArtifacts), the generic step in services/ai-worker/src/utils/responseArtifacts.ts (grep: Standalone timestamp; the pattern is a leading bracket group followed by optional whitespace) deletes ANY leading bracket group regardless of header shape and regardless of realMessagesEnabled. It has been unconditional on every reply since commit 9d332fd6e (2026-01-05). Consequences: (1) the aside is deleted with or without the end-of-line lookahead this task proposes, so that lookahead alone would not fix the user-visible bug; (2) the separator-free keep-case  [laughs] Anyway, no.  is NOT passing only because it lacks the separator, it is eaten already by the generic step, so the fixture claim above is off; (3) three of the KEEP-CASE tests #2379 added assert byte-identity at ONE stage only and do not hold end-to-end, because nothing in the suite composes the two real strips (ResponsePostProcessor.test.ts mocks both); (4) the other-personality compound keep-case still ships debris through the generic step, the exact degradation #2379 was filed on, fixed only for the self-named case. Revised fix shape: name the generic step as the primary deleter and decide its fate first (it predates real-messages mode and its comment says it targets a standalone timestamp, which the header format no longer produces alone); add ONE seam test that runs the two strips in order over the six keep-case fixtures and the leak fixtures; only then revisit whether the name-agnostic matcher needs the lookahead. The render-path design note above still applies to whatever matcher survives. Priority stays high; this is a pre-existing unconditional deletion of leading bracket groups in every reply, not a regression of the beta.221 range.
