---
id: TASK-1224
title: >-
  Evaluate split-mode memory accuracy: Haiku readers over 30 days of owner and
  Emily turns plus reasoning traces
status: Done
assignee: []
created_date: '2026-10-13 01:07'
updated_date: '2026-10-13 01:26'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1213000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-10-12: archive summarization (split-mode render, doc-8) is on in prod for Lilith and Emily; with Emily it works generally fine but with a somewhat noticeable accuracy loss. The owner proposed Haiku readers to evaluate the last 30 days of owner/Emily conversation turns and reasoning traces.

Data available (schema read 2026-10-12): conversation_history keeps content and thinking_content (the reasoning trace of assistant turns) for the 30-day history window. The rendered prompt (which memories were injected, split vs verbatim) is only in llm_diagnostic_logs, kept 24 hours, so a 30-day read sees the effect (responses and reasoning) but not the injected notes. A reader can still flag turns where the character misremembers, invents or blurs a past event, and the reasoning trace often names the note it leaned on.

What: (0) measure first: count owner/Emily assistant turns in the last 30 days and the total chars, to size the fan-out; (1) pull read-only from prod (personal data: Anthropic models only, local files under docs/local/, never committed); (2) Haiku readers, at most the configured workflow size, each scoring a slice for memory-accuracy errors with quoted evidence and a category (wrong detail, merged events, lost nuance, invented, fine); (3) one synthesis: error rate, the dominant failure shape, and whether it traces to the summary text (check a sample against the stored summaries in memories). Lilith as a comparison arm if volume allows.

Acceptance: a local report with counts, categories and quoted examples, plus a recommendation for the split-mode summarizer prompt or the per-character switch.

DONE 2026-10-12 (report: docs/local/emily-eval/REPORT.md, local; 20 Haiku readers + 1 Sonnet synthesis over 513 replies, 130 flagged turns with full reasoning, 400 summaries). Result: at least 41 replies (8%) carry a confirmed memory error, 85% of them model-side (time arithmetic, unsourced specifics); none attributable to summaries or digest (a visibility blind spot); summaries 79.5% faithful with 4 serious defects. A suspected clock offset was an export artifact (TIMESTAMP without zone parsed as local by node-pg; snowflake-checked), not a bug. Follow-ups: TASK-1225 (per-turn provenance), TASK-1226 (summarizer prompt v2), TASK-1227 (no-summary render path), TASK-1228 (chat prompt rules, owner call).
<!-- SECTION:DESCRIPTION:END -->
