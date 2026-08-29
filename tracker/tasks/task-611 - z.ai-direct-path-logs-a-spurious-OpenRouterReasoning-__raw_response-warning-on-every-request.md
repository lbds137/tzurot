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

GROUNDING 2026-08-29 (read, not built — line cites verified at read time, re-verify before editing).

Current shape: buildOpenRouterModel sets __includeRawResponse: true (services/ai-worker/src/services/ModelFactory.ts:493); buildZaiCodingModel deliberately omits it with a comment saying why (ModelFactory.ts:561). The warn itself is NOT in ModelFactory — it fires in validateAndExtractRawMessage at services/ai-worker/src/services/modelFactory/extractOpenRouterReasoning.ts:129, when __raw_response is undefined AND the message is complete (a streaming chunk with no finish_reason returns silently already). The extractor is exported as extractAndPopulateOpenRouterReasoning(message: BaseMessage) and has exactly ONE production call site: services/ai-worker/src/services/LLMInvoker.ts:478, inside invokeSingleAttempt(model, messages, modelName).

THE TRAP, and the reason the recorded fix shape above needs care: invokeSingleAttempt does not know the effective provider. It has only modelName, and there is a tempting heuristic a few lines away at LLMInvoker.ts:537 that does exactly the wrong thing — const provider = modelName.includes('/') ? modelName.split('/')[0] : 'unknown'. Deriving the provider from the model-id prefix is UNSOUND for this gate for two independently-shipped reasons: (a) TASK-789 fix in PR 2240 has buildZaiCodingModel STRIP the z-ai/ prefix at the client boundary, so the name may not carry it; (b) TASK-702 describes the live converse case, a z-ai/-prefixed model routed to OpenRouter for a user holding an OpenRouter key and no z.ai key. The prefix says which MODEL, not which ENDPOINT the request went to — and __includeRawResponse is decided per-endpoint at build time.

Sound carrier instead: both builders already return a small result object shaped { ..., modelName }, so an explicit expectsRawResponse boolean set beside __includeRawResponse in each builder and threaded to the call site is the honest signal, since it originates at the same place the flag does. Gate only the WARN on it — extraction already no-ops correctly without the flag, so behaviour must not otherwise change.

Sizing note: this is a small threading change across ModelFactory + LLMInvoker + the extractor signature, not a one-line gate.

BUNDLING: 789 (shipped half), 702, and this task share ONE root confusion — treating the model-id prefix as a proxy for the endpoint. 789 fixed it at the client boundary, 702 is a param denylist keyed on it, and 611 would have reintroduced it in a log gate. Worth one themed PR with a shared helper rather than three fixes each re-deciding the question. 702 cannot ride along as-is: its acceptance is a recorded PROBE result (one live OpenRouter call to z-ai/glm-4.7 with frequency_penalty), which a PR cannot contain.

Acceptance: a z.ai-direct generation produces no OpenRouterReasoning warning; an OpenRouter generation genuinely missing __raw_response still does; and the gate does not consult the model-id prefix. Both arms pinned by tests, including one that would fail if the gate were keyed on modelName.
<!-- SECTION:DESCRIPTION:END -->
