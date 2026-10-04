---
id: TASK-1156
title: >-
  surface:inventory misses variable-passed payload keys (webhook-options empty)
  and scopes test mocks in
status: To Do
assignee: []
created_date: '2026-10-04 16:26'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1148000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: GLM-week audit F2/F3, confirmed. packages/tooling/src/surface/analyzer.ts collects option keys only from object LITERALS passed directly as call/new arguments. WebhookManager.ts builds webhookOptions (username, avatarURL, threadId, files, allowedMentions) as a variable and calls webhook.send(webhookOptions), so the snapshot section webhook-options is (no entries). A UX wave adding a webhook payload key (TR-3.4, the primary personality-response path) produces NO snapshot diff. createWebhook({ name, reason }) lands in unclassified. Separately, TEST_FILE_PATTERN excludes only *.test.ts/*.spec.ts, so services/bot-client/src/test/mocks/Discord.mock.ts enters the inventory although the comment and snapshot header say tests are excluded.
What: resolve an identifier argument to its type (checker getTypeAtLocation(arg).getProperties(), filtered to discord.js-declared members) and record those keys; classify createWebhook options as webhook-options; exclude /src/test/ and *.mock.ts. Regenerate the snapshot.
Acceptance: red-first positive-control test with a variable-passed options object; snapshot webhook-options lists WebhookManager username/avatarURL/threadId/files/allowedMentions; no test/mock files in the snapshot.
<!-- SECTION:DESCRIPTION:END -->
