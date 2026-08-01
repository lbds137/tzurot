---
id: TASK-395
title: Three approved observability one-liners from beta.189 that never shipped
status: To Do
assignee: []
created_date: '2026-08-01 20:54'
labels:
  - 'size:S'
  - 'area:ai-worker'
  - 'area:bot-client'
dependencies: []
priority: medium
ordinal: 395000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Filed 2026-08-01 because they were about to be lost.** These three were approved in a pre-beta.189 session and have survived only as one italic line of prose in CURRENT.md — a file that gets RESET at every release cut. They have already ridden across at least two sessions untouched, and when I went looking for their original justification in the session logs, the only thing left anywhere was the summary line itself. The detail is already gone. That is the promise-ledger failure exactly: approved work whose sole home is chat prose.

Filing as ONE task, not three, because they are one small PR of ride-along observability.

**1. fallback-to-assistant tripwire log**
Site: `services/ai-worker/src/services/prompt/referenceRole.ts` around line 148 — the `return "assistant"` on the name-match fallback path in `deriveRefRole`.
Intent: log when the name-match fallback promotes a reference to `assistant`, so TASK-164 stops being a purely theoretical collision and becomes an observable one. TASK-164 is an approved rule-out whose grounding argues the risk is bounded; this line is what would falsify that if it is wrong. Log the matched name and the personality name (both are non-PII display names already in prompts).

**2. autocomplete miss-duration log at info**
Site: `services/bot-client/src/utils/autocomplete/autocompleteCache.ts` — the hit path already logs at debug (around line 191, `Personality cache hit`). The miss path should log its DURATION at **info**.
Intent: autocomplete has a hard interactivity budget and a miss means a gateway round-trip; without a duration at info there is no way to see how often misses push the response past useful latency.

**3. route-tier comment carrying the cache-warming reasoning**
Site: **NOT YET IDENTIFIED.** `rg route.?tier|routeTier` returns nothing, so the phrase in CURRENT.md is a paraphrase rather than a symbol name. Best guess from context is the dual-context (autocomplete + browse) list routes named in TASK-132, where a timeout tier exists and the reason for it is cache-warming — but that is inference, not verification. Whoever picks this up: confirm the site before writing, and if it cannot be found, close this third item as unrecoverable rather than inventing a comment.

**Acceptance**: items 1 and 2 shipped; item 3 either shipped against a confirmed site or closed as unrecoverable with that stated in the commit.
<!-- SECTION:DESCRIPTION:END -->
