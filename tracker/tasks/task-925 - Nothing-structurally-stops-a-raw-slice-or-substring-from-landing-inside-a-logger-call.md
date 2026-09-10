---
id: TASK-925
title: >-
  Nothing structurally stops a raw slice or substring from landing inside a
  logger call
status: Done
assignee: []
created_date: '2026-09-09 19:44'
updated_date: '2026-09-10 21:50'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 923000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2373 moved 16 content-preview call lines behind contentPreview() and LOG_CONTENT_PREVIEWS, and the helper is bypass-proof once called. Nothing forces a caller to use it: a bare text.slice(0, N) written straight into a logger.warn object bypasses the whole mechanism, and the only thing catching that today is a hand-run grep. That grep produced three false negatives in the same PR, measured by the pre-release audit: the shapes-list route (bodyPreview, fixed in the beta.221 ride-along), a third TranscriptRetriever site the body counted as two, and the round-1 body that read its own output through head. Three misses of one class in one PR is the trigger in 00-critical Fix Recurring Failures Structurally.

Fix shape: an ESLint rule in the local plugin (the component-handler-ack-first rule is the shape to copy) or a pnpm ops guard that flags a .slice(0, <literal>) or .substring(0, <literal>) call expression inside the first argument object of logger.(info|warn|error|debug) unless it is wrapped in contentPreview or contentDigest. Positive-control it against the fixed shapes-list site reverted. Register per docs/reference/audit-enforcement.md if it becomes a guard.

Acceptance: the rule or guard is red on the reverted shapes-list site and green on the tree; it runs in pnpm quality and CI; its probe or test is registered.
<!-- SECTION:DESCRIPTION:END -->

Vocabulary variant from the #2380 review (2026-09-09): services/bot-client/src/utils/gatewayServiceCalls.ts (grep: Transcription request failed) interpolates the full response body text into a thrown Error message, so a later logger call with err: error carries the raw body in .message. That shape is neither a slice nor a substring inside a logger argument, so the fix shape above would not see it; when the rule or guard is built, include a second pattern for a response.text() result reaching an Error constructor or a logger argument unwrapped, and sweep for it with the same positive control. Verified on the merged ref before filing.

SHAPE CORRECTION 2026-09-10 (first dispatch census): the Fix shape above is wrong on both sides.
- Over-fires: an AST scan of every non-test .ts found 34 inline logger truncations, and zero are user content. They are 12 persona-UUID prefixes, 9 action-token prefixes, 8 attachment-URL prefixes, 1 capped provider error, and array slices.
- Under-fires: it misses real content truncated into a local first and then logged by name, which is exactly the shape of several sites 6f0f7e059 fixed.

Main-loop decision (engineering call, reported to the owner):
- A type-aware funnel rule: a string .slice(0, …) or .substring(0, …) reaching a logger first-argument property, inline or through one same-scope const.
- Named helpers idPrefix and urlPrefix in logContentPreview.ts, with the 29 id/token/URL sites migrated to them.
- Pattern B as above.
- Scope widens to about 14 runtime files. Spec: docs/local/handoffs/spec-925-logger-raw-slice-rule.md, REVISION section.
