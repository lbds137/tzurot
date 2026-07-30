---
id: TASK-368
title: Load-bearing invariants live in docstrings where nothing executes them
status: To Do
assignee: []
created_date: '2026-07-30 23:08'
labels:
  - 'area:ai-worker'
dependencies: []
priority: medium
ordinal: 368000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Surfaced 2026-07-30 by TASK-364. Kimi K3's framing: "Every invariant currently living in a docstring or code comment is an unfiled bug report."**

Three instances found in ONE investigation, all in the reference/vision path:

1. `persistReferenceDescriptions`'s docstring states its purpose is to stop a quoted image rendering as "a bare `[image/type: name]` marker on replay" — it names the EXACT symptom of TASK-364. It was wired to one of two consumers. The invariant was known, written in prose, and unenforced.
2. The deduped stub renders `[Referenced message — full text in the chat log]`. That is a factual claim about another renderer's output, asserted in a string literal, never verified. It is FALSE for images — the chat-log copy carries bare `<embed><image url>` with no descriptions.
3. `buildDedupedReferenceStub`'s comment explains WHY markers are prepended and text capped, but nothing enforces that the field list stays complete.

**The class:** a comment that describes a cross-module contract is a test that never runs. Where a docstring asserts "X carries this so Y need not", that claim should be executable — GLM 5.2's concrete proposal: derive the deduped path's legitimate exclusion set from what the chat-log renderer ACTUALLY produces for the same message (`stubFields must contain fullFields minus logFields`), so the premise is checked rather than asserted.

**Action:** sweep the reference/prompt-assembly modules for docstrings making cross-module carriage claims; for each, either add an executable assertion or downgrade the wording so it stops reading as a guarantee. Not a broad doc audit — scoped to claims of the form "the other renderer/layer carries this."
<!-- SECTION:DESCRIPTION:END -->
