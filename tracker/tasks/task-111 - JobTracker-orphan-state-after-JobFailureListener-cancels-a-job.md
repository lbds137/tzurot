---
id: TASK-111
title: JobTracker orphan state after JobFailureListener cancels a job
status: Done
assignee: []
created_date: '2026-05-19 00:00'
updated_date: '2026-08-25 18:39'
labels:
  - 'area:bot-client'
  - 'area:jobs'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 111000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`JobTracker` orphan state after `JobFailureListener` cancels a job

**Why:** `JobFailureListener.handleTerminalEvent` deliberately doesn't call `jobTracker.completeJob()` (would silently delete the "taking longer" Discord message), so the JobTracker slot + its typing indicator and notification sit until the orphan sweep at `TYPING_INDICATOR_TIMEOUT_MS + ORPHAN_SWEEP_GRACE_MS`. Symptom: a user could see a stale "taking longer" notification for up to 40 min after a job failure, even after the ordering queue is unblocked. **Fix shape**: surface the failure to the user (delete the "taking longer" message + send a brief "your request couldn't complete" notice) BEFORE calling `completeJob`. **Promote when**: any user reports a stale "taking longer" notification, OR when adding user-facing failure messaging to the AI pipeline. **Start**: `services/bot-client/src/services/JobFailureListener.ts` `handleTerminalEvent`. Surfaced 2026-05-19 by release PR #1060 review. Deferred 2026-05-19.

**DECIDED 2026-08-14 (owner, TASK-599 digest): build as filed - on terminal failure delete the "taking longer" notice, send a brief could-not-complete notice, then release the tracker slot.**
<!-- SECTION:DESCRIPTION:END -->
