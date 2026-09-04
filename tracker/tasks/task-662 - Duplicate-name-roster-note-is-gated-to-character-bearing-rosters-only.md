---
id: TASK-662
title: Duplicate-name roster note is gated to character-bearing rosters only
status: To Do
assignee: []
created_date: '2026-08-18 19:58'
updated_date: '2026-09-04 19:40'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 662000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review finding on PR #2143 (TASK-657 slice A). That PR added rosterHasDuplicateNames to ParticipantFormatter, covering human-vs-character and character-vs-character display-name collisions, and emits a note telling the model to bind by from_id rather than by name.

The gate: the note only fires when characters.length > 0 (services/ai-worker/src/services/prompt/ParticipantFormatter.ts, buildRosterNotes). Two HUMANS sharing a display name gets no note, even though the check would catch it and the advice fits exactly.

That gate is a scope decision, not a logical one, and it is deliberate. Firing the note on pure-human rosters would change the prompt of every existing human-only channel, and "a humans-only roster is byte-identical to before" is an invariant #2143 states, tests, and would have quietly broken. The reviewer caught that the original byte-identity test used a SINGLE human, so the duplicate branch could not fire either way and the claim was narrower than it read. #2143 now pins the two-humans-same-name case explicitly.

Same-name humans are a real scenario here, not hypothetical: TASK-528 (Done) fixed two users with the same persona name collapsing into one participants entry, so the roster can genuinely hold two entries rendering under one name.

The open question is a cost/benefit one for the owner rather than a defect: is the disambiguation note worth roughly 30 tokens of S1 prefix on every turn in channels that have a name collision? It is a cached-prefix cost, paid once per roster change rather than per turn.

Fix shape if accepted: drop the characters.length > 0 conjunct, update the byte-identity test to expect the note in the two-humans case, and note the widening in the release notes since it changes existing channels prompts.

Acceptance: the decision is recorded either way; if widened, the humans-only duplicate case renders the note and the test asserting byte-identity is updated rather than deleted.

## OWNER DECISION 2026-08-20

Widen — drop the characters.length > 0 conjunct so the duplicate-name note fires for pure-human rosters too. Rationale: the two-humans collision is real (TASK-528), the cost is ~30 CACHED S1 tokens and only in channels that actually carry a collision, and misattribution is the failure class the beta.205 theme exists to kill. Per the task's fix shape: update the byte-identity test to expect the note in the two-humans case (not delete it), and add a release-notes line since existing channels' prompts change.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. owner explicitly decided 2026-08-20 to widen (drop the `characters.length > 0` conjunct so the note fires for pure-human name collisions too), citing TASK-528 as evidence the scenario is real. The code still has the gate in place — the decided fix has not been implemented. Evidence: `grep -n "characters.length > 0" services/ai-worker/src/services/prompt/ParticipantFormatter.ts` → line 208, `buildRosterNotes` still gates the duplicate-name note on `characters.length > 0`.
---

author: digest-pass
created: 2026-09-04 19:40
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): OWNER-DECIDED, UNBUILT (Shape 14). Carries a recorded owner decision; only implementation remains. Promoted to priority medium so it runs in one of the two decided-work drain batches rather than waiting on an opportunistic trigger that has not fired.
---
<!-- COMMENTS:END -->
