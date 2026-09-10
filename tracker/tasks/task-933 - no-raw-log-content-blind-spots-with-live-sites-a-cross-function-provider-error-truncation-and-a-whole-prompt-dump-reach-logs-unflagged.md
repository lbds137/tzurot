---
id: TASK-933
title: >-
  no-raw-log-content blind spots with live sites: a cross-function
  provider-error truncation and a whole-prompt dump reach logs unflagged
status: To Do
assignee: []
created_date: '2026-09-10 21:08'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 931000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the #2388 review found two live sites the new @tzurot/no-raw-log-content rule structurally cannot see, both inside its documented blind spots. (1) services/ai-worker/src/utils/apiErrorParser.ts (grep errorLogContextFromInfo) truncates technicalMessage, raw provider or API error text, at MAX_ERROR_MESSAGE_LENGTH in one function, and the result is spread into logger.error and diagnosticCollector.recordError at services/ai-worker/src/jobs/handlers/pipeline/steps/generationFailureResult.ts. That is cross-function flow, so the rule never sees the truncation, and the site carries neither a fix nor a justified disable, unlike the equivalent OpenRouterFetch.ts site. (2) services/ai-worker/src/services/prompt/PromptLogger.ts logs the full untruncated system prompt by plain concatenation in its if-branch. That shape has no slice, so the rule cannot see it; it is behind the NODE_ENV=development plus LOG_PROMPT_ASSEMBLY guard, a flag deployed boots refuse.
Fix shape: (1) decide whether provider error text counts as content. If not, add a justified disable at the truncation site, or route it through a named helper, so the decision is visible; if it does, log a digest plus length instead. (2) Leave the dump, but add a disable-style comment naming the guard, so a reader sees the sanctioned exception. Also decide whether the rule should gain a cross-function arm for helpers that return a truncation of their parameter.
Acceptance: both sites carry an explicit, reviewed disposition in code, and the rule doc names the remaining blind spots with a live example each.
<!-- SECTION:DESCRIPTION:END -->
