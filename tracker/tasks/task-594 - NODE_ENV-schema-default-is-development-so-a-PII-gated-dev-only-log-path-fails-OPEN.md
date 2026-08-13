---
id: TASK-594
title: >-
  NODE_ENV schema default is development, so a PII-gated dev-only log path fails
  OPEN
status: To Do
assignee: []
created_date: '2026-08-13 22:57'
labels:
  - 'area:common-types'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 594000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: config.ts:151 declares NODE_ENV: z.enum([development, production, test]).default(development). The default is the DEVELOPMENT value, which is the wrong direction for anything gated on it. PromptLogger.logDetailedPromptAssembly returns early unless NODE_ENV === development, and when it does run it logs the persona display name AND the entire assembled system prompt, which embeds the persona bio. So the protection for that dump is an env var being present, and its absence enables the dump rather than disabling it.

What holds today: packages/tooling/src/deployment/setup-railway-variables.ts declares NODE_ENV required with defaultValue production, so a properly provisioned Railway service has it set. Verified in code only - I was not able to read the live Railway value in the session that filed this, so treat the runtime state as unconfirmed rather than as verified-good. Confirming it is a one-command check for the owner: railway variables --service ai-worker --environment production.

The residual risk is not that the variable is wrong today; it is that a new service, a restored environment, or a variable-wipe silently turns on a full-prompt PII dump in production with no error and no signal. A fail-closed default costs nothing.

Fix shape, pick one: (a) flip the schema default to production, so the fail-open becomes fail-closed and a genuine local dev run sets NODE_ENV=development explicitly - this is the cheapest and matches how the deployed config is already provisioned; (b) leave the default but make the dev-only guard require an explicit opt-in flag of its own rather than piggybacking on NODE_ENV, which decouples an expensive PII dump from a general-purpose environment switch. Prefer (a) unless local-dev ergonomics break, in which case (b) is the more honest fix since it names the actual capability.

Check for other consumers before flipping: grep NODE_ENV across services and packages, since anything else branching on the development value inherits the same flip.

Acceptance: a deployed service with NODE_ENV unset does not log persona bios or assembled system prompts, and whichever behaviour is chosen is pinned by a test.

Source: 2026-08-13 claude-review round 4 on the persona-logging PR asked for a sanity check that NODE_ENV can never be development in a deployed environment; checking it surfaced the fail-open default.
<!-- SECTION:DESCRIPTION:END -->
