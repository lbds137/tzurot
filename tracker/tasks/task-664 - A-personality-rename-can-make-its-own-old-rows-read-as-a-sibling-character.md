---
id: TASK-664
title: A personality rename can make its own old rows read as a sibling character
status: To Do
assignee: []
created_date: '2026-08-18 20:30'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 664000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review finding on PR #2143. resolveSpeakerInfo decides self-vs-sibling by a bidirectional PREFIX match on the name (services/ai-worker/src/jobs/utils/participantUtils.ts): isSelf = speakerLower.startsWith(personalityLower) || personalityLower.startsWith(speakerLower).

The false-POSITIVE direction is known, documented and tested -- a sibling named Alex under an Alexandra responder reads as self, so it is excluded from the roster. #2143 pins that as known behaviour.

The false-NEGATIVE direction is untested and now costs more. Rename a personality to something that does not share a prefix with its old name (Lilith -> Nyx), and its own historical rows still carry the OLD name in personalityName, because that column is stamped at write time. Those rows fail the prefix test, so they render role="character" -- the personality reads its own past lines as another character speaking.

What #2143 changed: before it, that mislabelled only the chat_log role attribute. Now extractCharacterParticipants uses the same decision for roster MEMBERSHIP, so the rename also materialises a persistent character_participant entry for the old name, with a from_id resolving to the personality own id. The model is shown itself as a separate conversation peer for as long as those rows stay in the window.

Not a regression from #2143 -- the misclassification predates it -- but the blast radius grew from one attribute to a standing roster entry, which is why it is worth fixing rather than accepting.

Fix shape: the row already carries personalityId, which is stable across renames, while the name is not. Compare ids when both sides have one and fall back to the prefix heuristic only when the row lacks an id (the extended-context registry-miss fallback stores a display name with no id -- that fallback is the entire reason the comparison is name-based today). That also shrinks the known false-positive case for free.

Acceptance: a self-authored row stamped with a pre-rename name resolves to role="assistant" and produces no roster entry, pinned by a test; the id-less fallback row keeps todays prefix behaviour, also pinned.
<!-- SECTION:DESCRIPTION:END -->
