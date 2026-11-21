---
id: TASK-1495
title: Attachment URL log-shape follow-ups from PR 2777 review
status: To Do
assignee: []
created_date: '2026-11-21T12:29:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1495000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2777 (TASK-1385) round-4 claude-review left low/nit findings, merged per owner ruling 11-21.

What:
1. discordCdnGuard.ts unexpected-host warn logs raw hostname; an IP literal is never-log data. Route through attachmentUrlShape (yields [ip-host]).
2. no-raw-log-content collectChildren: the destructured-const skipUrl covers call args nested in object/array literals (const { a } = { a: String(attachment.url) }). Narrow to the initializer call itself (optionally under await), or pin as a known limit.
3. DISCORD_ATTACHMENT_HOSTS ignores DISCORD_INSTANCE_ORIGIN, so self-hosted attachment URLs lose their ids (no leak). Accept the configured host or document it.
4. logContentPreview tests: userinfo credentials sentinel; Discord host with non-default port.
5. VisionProcessor <data-url> branch vs [unparsable-url]: reconcile or fix the comment.

Acceptance: items 1 and 2 fixed red-first; 3-5 fixed or declined with reason in the PR body.
<!-- SECTION:DESCRIPTION:END -->
