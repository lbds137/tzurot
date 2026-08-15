---
id: TASK-615
title: >-
  Extract the shared message-context-menu lookup skeleton when a third command
  appears
status: To Do
assignee: []
created_date: '2026-08-15 10:34'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 615000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: inspectMessage.ts and viewReasoning.ts are ~85 percent identical — clientsFor -> resolveDiagnosticLog -> miss-branch editReply with CATALOG.error.validation -> success-path render -> info log -> catch -> classifyGatewayFailure. claude-review raised this on both review rounds of PR 2104 and argued the divergence collapses to ONE callback (the success-path renderer) plus two string params, comfortably under the 2-callback ceiling in 02-code-standards.

Why it was NOT extracted in 2104: two instances is below our own bar for abstracting, and the measurement backs that — the pair does not reach the top-8 CPD clone pairs (all of which are 36+ lines), and pnpm ops cpd:check passes. Extracting at two risks the wrong abstraction; the CPD post-filter deliberately excludes skeleton-shape uniformity.

Promote when: a THIRD message context-menu command is added. At that point the shape is proven and the extraction shifts from speculative to warranted.

What: extract runMessageContextLookup(interaction, { noun, hintOnMiss, render }) into a bot-client util, convert all three commands to call sites.

Acceptance: three context-menu commands share one skeleton; each keeps its own noun, miss-path hint and renderer; cpd:filtered no worse than before.
<!-- SECTION:DESCRIPTION:END -->
