---
id: TASK-455
title: >-
  Session mining only sees user turns, so agent-side misses the owner never
  noticed are invisible
status: To Do
assignee: []
created_date: '2026-08-07 01:05'
updated_date: '2026-08-07 12:33'
labels:
  - 'area:process'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 454000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The /tzurot-session-mining extraction step selects only user turns (jq select on type == "user"), and every category in its taxonomy — CORRECTION, REPEAT, FRUSTRATION, TRUST-CHECK, REDIRECT, PROCESS-GAP, PREFERENCE, DECISION — is anchored on something the OWNER said. That is deliberate and correct for measuring owner friction. But it means an agent-side failure the owner never commented on is structurally invisible to the pipeline.

That is arguably the more valuable half. A miss the owner noticed already got corrected in the moment and is unlikely to recur silently. A miss nobody noticed is exactly the one that recurs.

Evidence from the 2026-08-06 evening session, none of which drew any owner comment and none of which the current pipeline would surface:
- Edited the WRONG BRANCH twice while two PRs were in flight (once caught by a typecheck failure, once by a lint failure).
- Mangled a source file with a scripted multi-line perl replace, against the projects own presence-then-test guidance to prefer the Edit tool below roughly 5 replacements.
- Armed two Monitor commands with malformed SHAs (one abbreviated, one a 39-char concatenation). Both fail SAFE — the gate never fires — but also fail SILENTLY, spinning to a 30-minute timeout.
- Four successive incorrect arithmetic passes over prod diagnostic data before the fifth was right, each of which looked like a finding before being caught.

Contrast: the same session produced four owner-turn findings the current pipeline WILL catch (a fetch-cap correction, an attachment-count observation, a challenge about flip-flopping, and a misread instruction). So the pipeline is roughly half-blind, not blind.

Fix shape to consider:
- Add an OPTIONAL second extraction mode that includes assistant turns and tool results, kept separate from the owner-friction corpus so the two are not conflated.
- Add agent-side taxonomy categories: SELF-CORRECTION (agent reverses its own prior factual claim), TOOL-MISUSE (a command failed because of the agent invocation shape rather than the data), REWORK (work redone due to an agent error).
- Volume is the obvious problem — assistant turns dwarf user turns. A targeted filter is probably necessary rather than a full extract: assistant turns containing correction markers, plus tool results with a nonzero exit that are followed by a retry of the same command.

The privacy boundary is unchanged: corpus and reports stay under the machine-local mined-corpus directory, never committed, and only operationalized outcomes enter the repo.

Acceptance: a mining pass over a session can surface an agent-side failure that the owner never remarked on.
<!-- SECTION:DESCRIPTION:END -->
