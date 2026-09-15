---
id: TASK-983
title: >-
  Reference and quote timestamps still render in the fallback zone, so the
  one-zone-per-prompt invariant has a hole
status: Done
assignee: []
created_date: '2026-09-14 21:32'
updated_date: '2026-09-15 18:43'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 979000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the beta.225 timezone fix threaded context.userTimezone into the volatile anchor and every conversation-turn header, which closes the reported bug. Two prompt-facing callers of promptTime were deliberately left out of that PR and still render in the APP_SETTINGS.TIMEZONE fallback, so a reference or forwarded-quote timestamp in the prompt can still disagree with the anchor by the zone offset for any user whose configured zone is not America/New_York. Same bug CLASS, different surface.

Sites (verify before editing, cites drift):
- services/ai-worker/src/services/prompt/storedReference.ts:207 — time: promptTime(ref.timestamp)
- services/ai-worker/src/services/ReferencedMessageFormatter.ts:462 — time: promptTime(ref.timestamp)

promptTime already ACCEPTS an optional timezone as of the beta.225 fix, so both sites compile unchanged today. That is exactly why this needs a task rather than a compiler error to find it.

Why it was deferred rather than fixed inline: breadth, not merit. fromStoredReference is already a four-parameter positional function and its own callers sit in jobs/utils/xmlMetadataFormatters.ts at lines 96 and 110, which would need the same threading, and so on upward. Threading it properly wants an options-object refactor of fromStoredReference, which is a larger and independently reviewable change than the turn-header fix it would have ridden along with.

SECOND CORRECTION, 2026-09-15 grounding pass: this paragraph originally justified the options object by saying a fifth parameter would reach the max-params ceiling. That is FALSE. max-params is configured ['warn', {max: 5}] in eslint.config.js, and ESLint warns only ABOVE max, so fromStoredReference at five parameters would still lint clean. The options object remains the right call on readability grounds — three consecutive optional parameters of which two are easy to transpose — and on local precedent (LiveReferenceContext in ReferencedMessageFormatter.ts was bundled for exactly this reason, per its own doc comment). It is a DESIGN decision, not a lint-forced one, and must not be defended as forced in any PR body.

Grounding pass 2026-09-15 also settled the upward threading, which this description left open. Both paths already carry an options object at the hop that needs the value, so nothing above them widens: the stored path goes conversationUtils renderHistoryEntryBody (already holds opts.timezone) to QuotedSectionInput to fromStoredReference; the live path goes ConversationInputProcessor processInputs (already holds context.userTimezone) to ReferenceRenderContext to fromLiveReference, which already destructures renderContext. Only fromStoredReference changes shape.

Fix shape: convert fromStoredReference to an options object, add timezone to it, thread from the same per-turn context.userTimezone the header path already uses, and do the same for the ReferencedMessageFormatter site (which has renderContext in scope and may be able to carry it there). Never coalesce the value at any hop: undefined must stay undefined so every formatter falls back to APP_SETTINGS.TIMEZONE identically. That non-coalescing rule is the whole invariant.

Acceptance: a prompt containing BOTH a turn header and a reference or forwarded-quote timestamp, rendered for a user in a non-America/New_York zone, shows both in that user zone; and a test pins the two against each other the way RealMessagesBuilder.test.ts pins the anchor against the newest turn header.

PRIORITY RAISED to high 2026-09-14 (PR 2428 round 2). Reason: locality. The reference and forwarded-quote timestamps render into the SAME volatile prefix as the `<datetime>` now-anchor, so the two disagreeing values sit close together in one prompt region rather than in distant blocks. That makes this a more visible recurrence of the reported bug than the conversation-turn headers PR 2428 fixed.

One correction to the review that raised it, so the next reader is not misled: the anchor is inside an explicit `<context>` element carrying only `<datetime>` and the current-location line (PromptBuilder.buildVolatilePrefix, grep `const contextSection`). `referencedMessagesFormatted` is a SEPARATE variable assembled into the same volatile prefix further down (grep `const referencesContext`). Same prefix and same user message, NOT the same `<context>` element. The locality argument holds; the specific containment claim does not.
<!-- SECTION:DESCRIPTION:END -->
