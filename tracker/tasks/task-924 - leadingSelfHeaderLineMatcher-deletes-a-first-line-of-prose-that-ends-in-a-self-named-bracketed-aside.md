---
id: TASK-924
title: >-
  leadingSelfHeaderLineMatcher deletes a first line of prose that ends in a
  self-named bracketed aside
status: To Do
assignee: []
created_date: '2026-09-09 19:44'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 922000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2379 round 4 admitted a preamble of up to 120 non-header units before the self-named header so a decorated leak (stray tag, dash, italic aside, then the header) still strips. The preamble also admits free prose, so a first line that does NOT open with a bracket but ENDS with a bracketed em-dash aside whose bracket opens with the responding personality name is now deleted whole with its newline. Probed 2026-09-09 against the source with npx tsx: the string  He handed me the note - [Name - 1834]  newline  And I read it twice.  becomes  And I read it twice.  A mid-line header that is not at end of line survives, and the same shape with a different name inside the brackets survives (it is the blank-name keep-case fixture). Before #2379 that content survived both strip stages. This is the delete direction of the leak-vs-delete asymmetry the design is built around, it is live because realMessagesEnabled is on in prod, and the PR body, docstring, acceptance and residue sections do not name it. Found by the pre-release audit of the beta.221 range; cut proceeded with this as fix-forward.

Fix shape: either require the preamble to be empty-or-bracket-only (bracket groups, whitespace, dashes, asterisks; no free prose) so a decorated leak still matches while narrated prose does not, or record the shape as a deliberate strip-case. Prefer the first. Add the prose-then-aside shape as a named keep-case in RealMessagesBuilder.test.ts and in responseArtifacts.test.ts, and make the canary the deletion of the preamble narrowing. Coordinate with TASK-921 (matcher derived from the render path) and TASK-923 (the generic bracket step is the primary deleter for position-0 asides): whichever lands first should check whether the render-path derivation dissolves this too.

Acceptance: the prose-then-aside fixture is byte-identical through stripRealMessageEchoArtifacts; the three decorated-leak fixtures from #2379 still strip; the canary reddens with the narrowing reverted.
<!-- SECTION:DESCRIPTION:END -->
