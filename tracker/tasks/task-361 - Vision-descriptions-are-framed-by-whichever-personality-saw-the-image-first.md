---
id: TASK-361
title: Vision descriptions are framed by whichever personality saw the image first
status: To Do
assignee: []
created_date: '2026-07-30 16:26'
updated_date: '2026-07-30 16:39'
labels:
  - 'area:ai-worker'
  - 'size:M'
dependencies: []
priority: high
ordinal: 361000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Why:** `describeImage` (`services/ai-worker/src/services/multimodal/VisionProcessor.ts`
~:709-712, :740) passes the triggering personality's `systemPrompt` — which on
this project includes jailbreak text — and its `visionConfigParams` into the
vision call. The resulting description is then written to the **model-agnostic
canonical cache** (`vision:canon:{id}`) and served to every other personality
that later sees the same image.

So a description produced under an uncensored or strongly-voiced persona's
framing is what a wholesome persona reads later. PRE-EXISTING for ordinary image
attachments — this is not introduced by the sticker work — and today it is
bounded by the canonical cache's 1h TTL and by attachment URLs being ephemeral.

**Why stickers make it worse, and why it is filed now**: a sticker description
is keyed by an immutable snowflake, so the first framing is not merely reused
for an hour — it is the permanent record, and doc-55's PR-2 durable table makes
that literal. The whole point of instance-funding stickers was that a permanent
shared artifact must not be determined by whoever happened to see it first; the
PROMPT is the same lottery as the model, one layer down. Surfaced 2026-07-30
while grounding #1872's third review round.

**Fix shape**: an `instanceFramed?: boolean` on `DescribeImageOptions` that
suppresses `personality.systemPrompt` and `visionConfigParams` in favour of a
neutral description prompt, threaded through `describeImageWithFallback` the
same way `model` already is (it re-enters `describeImage` per tier). Then set it
alongside the other shared-asset dispatch overrides in
`MultimodalProcessor.processSingleAttachment`. Consider whether ordinary images
should default to it too — arguably a description task should never carry a chat
persona's prompt — but that is a behavior change to the main image path and
wants its own evaluation.

**Promote when**: doc-55's PR-2 (durable asset table) is built — that is the
change that converts "stale for an hour" into "wrong forever", so the two belong
in the same conversation.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
OWNER DIRECTIVE 2026-07-30: this GATES the beta.187 release. Its own PR, but
the release does not cut until it is fixed — explicitly "I don't want to kick
the can down the road". Supersedes the original "promote when PR-2 is built"
annotation: that deferral is void.

PREMISE CORRECTED 2026-07-30 (owner): the original description claimed character
personas carry their own jailbreaks. THEY DO NOT. `LoadedPersonality.systemPrompt`
is the CONTENT of a linked row in the shared, admin-managed `system_prompts`
table — `PersonalityLoader.ts` selects `systemPrompt: { select: { content: true } }`
and `PersonalityDefaults.ts:119` does `rp(db.systemPrompt?.content) ?? ''`. The
table has an `isDefault` flag and personalities merely POINT at a row.

Corrected severity: cross-persona contamination happens only between
personalities linked to DIFFERENT `system_prompts` rows, and both rows are
operator-authored. If every personality points at the default row (the likely
common case) there is no contamination today at all. This is materially smaller
than first filed — not "an uncensored persona's voice leaks into a wholesome
one".

What remains genuinely real: a description is framed by whichever row the
FIRST-SIGHTING personality linked, and for a snowflake-keyed sticker that
framing is permanent. It also silently outlives any later edit to the default
prompt.

Corrected fix shape (owner call: instance prompt, ALL descriptions, via the
table that already exists — NOT a new system setting): resolve the description's
system prompt from the `isDefault` SystemPrompt row rather than the triggering
personality's linked row. No new setting, no prompt authoring, no NSFW-capability
change — the default row is what most personalities already use.
<!-- SECTION:NOTES:END -->
