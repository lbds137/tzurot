---
id: TASK-133
title: Re-verify /shapes import + /shapes export end-to-end after beta.126
status: To Do
assignee: []
created_date: '2026-05-30 00:00'
updated_date: '2026-09-04 19:35'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 133000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Re-verify `/shapes import` + `/shapes export` end-to-end after beta.126

**Why:** The beta.126 dev smoke confirmed the whole core transport surface (chat, voice in/out, multi-tag, DMs, db-sync, persona/character/voice-models) but **shapes import/export was not hand-verified** — it needs a desktop Chrome session to grab the shapes.inc auth cookie, and the smoke was done from a phone. The timeout-regression fix restored these routes to `DEFERRED` (PR #1119), identical to beta.125 and the same mechanism as the verified db-sync, so confidence is high — but the external shapes.inc round-trip itself wasn't exercised. Low-usage feature; even a breakage is low-impact. **Promote when**: next time at a desktop with shapes.inc auth — run an import + export against the dev (or prod) bot and confirm no `HTTP 0`/timeout. Surfaced 2026-05-30 during beta.126 release smoke. Deferred 2026-05-30.

Owner question: Should the shapes import/export round-trip be scheduled as its own verification session, or stay filed until you are next at a desktop with shapes.inc auth?
Recommendation: Keep filed — the task's promote-when is exactly "next time at a desktop with shapes.inc auth", and it already records that confidence is high (the routes were restored to DEFERRED by the same mechanism as the verified db-sync) on a low-usage, low-impact feature.

Decision 2026-09-02 (owner): keep filed until the next desktop session with shapes.inc auth.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:35
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Task already carries an explicit 2026-09-02 owner decision: "keep filed until the next desktop session with shapes.inc auth." Nothing to re-litigate; the trigger (next desktop session with shapes.inc cookie access) hasn't happened. Evidence: `cat` of the task file — Decision line dated 2026-09-02 present verbatim in the description.
---
<!-- COMMENTS:END -->
