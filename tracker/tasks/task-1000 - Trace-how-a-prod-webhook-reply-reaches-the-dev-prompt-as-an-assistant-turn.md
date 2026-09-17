---
id: TASK-1000
title: Trace how a prod webhook reply reaches the dev prompt as an assistant turn
status: To Do
assignee: []
created_date: '2026-09-17 15:14'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 996000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 2026-09-17 Arm A export (request a7dd7486-d350-4e7f-9dcd-5158e3a8612b, copy at docs/local/handoffs/debug-2026-09-17-armA-aborted-a7dd7486.json) shows a PROD Emily reply rendered in the DEV prompt as assembledPrompt.messages[3] with role assistant. Owner ruling 2026-09-17: the behavior is correct and wanted (a character reply in either environment is the character own turn; TASK-999 archived on that ruling) — but the mechanism is unknown and may be doing something odd, so trace it.
Candidates: (a) db-sync carried the prod conversation_history row into dev and the history builder rendered it (then the Discord fetch dedup dropped the raw message); (b) DiscordChannelFetcher.classifyAuthorship marked the webhook message ours via the registry arm (redisService.getWebhookPersonality returning a hit for a prod message id — would imply shared or leaked registry state) or via the suffix arm (deriveBotSuffix vs the prod suffix; the two tags differ, so this arm should miss).
Fix shape: no behavior change. Probe on dev with the message id from the export: check the dev conversation_history rows for that thread and their source, and log which classifier arm fired for that message id. Record the mechanism here and in the export handoff note. If (b)-registry is the path, that is a separate finding to surface to the owner (state leaking between environments), not a fix to make in this task.
Acceptance: the mechanism is named from a runtime observation on dev, written into this task, with the follow-up (if any) filed as its own task.
<!-- SECTION:DESCRIPTION:END -->
