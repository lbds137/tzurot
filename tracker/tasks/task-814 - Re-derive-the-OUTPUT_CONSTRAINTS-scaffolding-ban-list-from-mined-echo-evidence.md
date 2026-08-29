---
id: TASK-814
title: Re-derive the OUTPUT_CONSTRAINTS scaffolding-ban list from mined-echo evidence
status: To Do
assignee: []
created_date: '2026-08-29 11:16'
updated_date: '2026-08-29 14:35'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 814000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the TASK-160 audit established a criterion for ban-list membership (recorded as a doc comment on OUTPUT_CONSTRAINTS in services/ai-worker/src/services/prompt/HardcodedConstraints.ts) and found the current list fails it in BOTH directions.

Unnamed but evidence-backed: chat_log, participants, protocol, memory_archive, facts are all members of PROMPT_TEMPLATE_ORPHAN_TAGS in services/ai-worker/src/utils/responseArtifacts.ts, i.e. the model has been observed echoing their closing forms and we strip them post-hoc.

Named but never emitted by our prompt: <user> appears nowhere in prompt assembly except inside the ban constraint text itself, and from_id ships as an ATTRIBUTE (services/ai-worker/src/jobs/utils/conversationUtils.ts:102), never as an element. That these element shapes are a model invention rather than an echo of ours is not inferred from that absence — it is the recorded observation behind the pair: the GLM-4.5-Air fake-user-message-echo entry in services/ai-worker/src/utils/thinkingExtraction.ts:72-79 cites a production request in which the model improvised a reasoning channel using tags that mimic our prompt-assembly format. So the constraint sentence calling them assembly artifacts from the conversation context misdescribes them.

Third candidate: context is deliberately excluded from the responseArtifacts orphan-closer list as too collision-prone against ordinary prose, which makes prompt-side prevention the ONLY lever for it. It is currently in neither the ban list nor the strip list.

Why this is an owner call and was not done in the audit: OUTPUT_CONSTRAINTS is S0-cacheable prompt text on every single request, so any edit changes every response. Efficacy is unmeasurable locally and there is an unverified counter-consideration that naming a tag may itself prime the model to emit it, which argues for a minimal evidence-only list rather than an exhaustive one.

Options: (a) leave as-is, treating the strip layer as the guarantee and the ban list as legacy best-effort; (b) re-derive strictly from mined-echo evidence, adding the five and dropping or rewording quote/user; (c) minimal change, add context only, since it is the one tag with no post-processing lever.

Recommendation: (c). It closes the only genuine coverage gap, costs a handful of S0 tokens, and avoids churning prompt text whose efficacy we cannot measure.

OWNER DECISION 2026-08-29: **(c) APPROVED** — "for the decision points you refreshed me on, I'm on board with your recommendations", answering a refresher that named (c) add `context` only as the recommendation. So this is no longer an owner-blocked question; it is buildable work. Relabelled state:owner → state:ready.

Scope, restated now that it is a build: add `context` to the scaffolding-ban constraint and NOTHING else — do not add the five evidence-backed tags and do not drop or reword `quote`/`user`. The argument for the narrow change is that `context` is the one tag with no post-processing lever (responseArtifacts deliberately omits it from the orphan-closer list as too collision-prone against ordinary prose), while the other five are already handled by the strip layer. Efficacy of the prompt-side ban remains unmeasurable locally, and the unverified counter-consideration stands that naming a tag may prime a model to emit it — which is the reason to add ONE tag rather than five, not a reason to add none.

Acceptance: an owner decision recorded on this task — DONE, see above — and, since (c) was chosen, the constraint text plus the HardcodedConstraints.test.ts assertions updated together so the pins do not contradict the code — AND the illustrative membership paragraph in the OUTPUT_CONSTRAINTS doc comment updated in the same change. That paragraph enumerates the CURRENT list's failures (which tags are unnamed-but-evidence-backed, which are named-but-unemitted); acting on this task falsifies exactly that enumeration while leaving the reusable criterion above it correct, and nothing structural forces the revisit. Surfaced by review on PR 2249, which added the paragraph.
<!-- SECTION:DESCRIPTION:END -->
