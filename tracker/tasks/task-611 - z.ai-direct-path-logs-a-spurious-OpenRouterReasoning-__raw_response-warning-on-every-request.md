---
id: TASK-611
title: >-
  z.ai-direct path logs a spurious OpenRouterReasoning __raw_response warning on
  every request
status: To Do
assignee: []
created_date: '2026-08-14 18:27'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 611000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: every z.ai-direct generation logs "[OpenRouterReasoning] Expected __raw_response in additional_kwargs but found none - verify ChatOpenAI __includeRawResponse setting and @langchain/openai version" from ModelFactory. Observed in prod 2026-08-14 on job llm-842a8368-9b8d-47ca-8ea7-99fd6a66322d.

This is not a misconfiguration. ModelFactory.ts:481-485 withholds __includeRawResponse for the z.ai build ON PURPOSE, because z.ai uses its own thinking-field protocol rather than OpenRouter reasoning bridge. So the bridge is running on a path that deliberately opted out of it, and reporting the intended absence as a problem.

Extraction is unaffected: the same job shows apiReasoningLength=3391 pulled from reasoning_content in additional_kwargs, so the response side works. The cost is a warning-shaped line on a completely healthy path, on every single z.ai request, which teaches the reader to filter out a message that would matter on the OpenRouter path.

Fix shape: gate the __raw_response check on the effective provider, so it only fires where __includeRawResponse was actually requested. Check whether the surrounding extractor has other OpenRouter-only assumptions running on the z.ai path while there.

Acceptance: a z.ai-direct generation produces no OpenRouterReasoning warning; an OpenRouter generation genuinely missing __raw_response still does.
<!-- SECTION:DESCRIPTION:END -->
