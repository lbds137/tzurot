---
id: TASK-800
title: >-
  Sanitize model/provider in the /inspect diagnostic embed (markdown-injection
  class)
status: Done
assignee: []
created_date: '2026-08-28 22:19'
updated_date: '2026-08-29 22:26'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 800000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found while fixing the same class in the ops-alert embeds (PR #2245). services/bot-client/src/commands/inspect/embed.ts:181-186 renders llmConfig.model, llmConfig.provider, llmResponse.modelUsed and reasoningDebug.upstreamProvider into an embed field value with NO sanitization and NO surrounding backticks.

Why those values are not safe: model and provider are FREE-TEXT modal inputs on the /preset dashboard, validated for length only (model maxLength 255 at commands/preset/config.ts:249, provider 50 at presetSections.ts:69). A user can name a model `[Free Nitro](http://evil.example)` and Discord renders it as a live masked link inside an embed field value.

The fix already exists: stripMarkdownDelimiters in packages/common-types/src/constants/discord.ts, used by buildModelFooterText and now by ErrorChannelReporter. Route these four values through it.

Sibling sites checked and SAFE, do not re-sweep them: inspect/extendedViews.ts:211 and preset/presetSections.ts:84 both wrap the value in backticks, and markdown links do not render inside inline code.

UNVERIFIED, and it sets the severity: whether one user can /inspect a turn that another user own preset served. The view is ephemeral, so the invoker is the only viewer; if inspect is self-only the impact is self-targeting and cosmetic, and if it can reach another user turn it is a real cross-user phishing surface aimed at whoever runs the command. Establish that first, then fix regardless since the fix is one function call per site.

Acceptance: all four values routed through stripMarkdownDelimiters, with a test asserting a masked-link model id renders inert, canaried against the unsanitized version.
<!-- SECTION:DESCRIPTION:END -->
