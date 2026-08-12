---
id: TASK-522
title: >-
  backlogLint: disclose two more parse limitations and unify the doc-N message
  prefix
status: Done
assignee: []
created_date: '2026-08-11 13:21'
updated_date: '2026-08-12 15:45'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 522000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2063 review round 7. Three small residues from the relative-link gate, batched because they are all one file.

1. isRelativeFileTarget treats any bare bracketed target ending in .letters as a relative file, so a bracket-paren pair around a bare domain — `example.com`, `Node.js` — is reported as a dangling link: a confusing pnpm quality failure over text that was never a path. The version-string shape is already excluded; this broader domain-like class is not, and is not listed among the four disclosed parse limitations. Disclose it, or narrow the heuristic.

   DEMONSTRATED, not hypothetical: the FIRST draft of this very task wrote those two examples in markdown-link form, and the gate immediately reported both as dangling links. The reviewer filed this as a latent Low; it produced a live occurrence within minutes of being written down, which is why the priority is medium rather than low. Note also what that implies — a doc DESCRIBING the limitation cannot use the natural syntax to describe it, since stripCode only rescues the backticked form.

2. stripCode assumes balanced backticks. An odd count could mis-strip and silently change what gets checked. Fifth undisclosed shape, same class.

3. checkQueueDocRefs prefixes its message with the bare literal queue.md while the new sibling checkDocIdRefs prefixes with the full repo-relative path. Real cosmetic inconsistency in gate output. NOT deferred on origin: it is deferred because unifying costs a CI round for zero behavioural change, and it rides here with the docstring work in the same file.

Also in scope if convenient: checkDocIdRefs and checkRelativeLinks each walk RELATIVE_LINK_SCAN_DIRS and read every file separately, and existingDocIds is computed twice. Harmless at the current corpus size; fold into one pass if the tree grows.

Acceptance: the docstring enumerates every shape the extractor mishandles, each pinned or explicitly hedged per 02-code-standards; both doc-N checks use the same prefix convention.
<!-- SECTION:DESCRIPTION:END -->
