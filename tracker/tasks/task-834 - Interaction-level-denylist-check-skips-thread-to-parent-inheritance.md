---
id: TASK-834
title: Interaction-level denylist check skips thread-to-parent inheritance
status: To Do
assignee: []
created_date: '2026-08-30 18:31'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 834000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a parent-channel denial blocks a user MESSAGES in a child thread but does NOT block their SLASH COMMANDS in that same thread. Two callers of the same cache method disagree, and only one does the inheritance.

Verified at source:
- services/bot-client/src/services/DenylistCache.ts:151 isChannelDenied is a flat map lookup with no fallback of its own. Inheritance is the CALLER responsibility.
- services/bot-client/src/processors/DenylistFilter.ts:60-65 (message path) builds [message.channelId, parentId] via getThreadParentId and checks BOTH.
- services/bot-client/src/index.ts:525 (interaction path) calls isChannelDenied(interaction.user.id, interaction.channelId) with NO parent fallback.

CORRECTION to the review framing that surfaced this: claude-review on PR 2260 described the gap as newly reachable because that PR added a thread picker. That is not right, and the distinction matters for priority. The gap predates the thread picker entirely: parent-channel denials on GuildText channels have always existed, and threads under them have always existed, so a denied parent has always failed to cover slash commands in its threads. PR 2260 added thread-SCOPED denials, which is a different feature and is not what creates this asymmetry.

Why not fixed in PR 2260: different file, different mechanism (interaction dispatch vs message processing), and changing interaction-level denial semantics is a user-visible enforcement change that wants its own tests rather than riding a labels-and-picker PR.

Fix shape: extract the channelIdsToCheck construction that DenylistFilter.ts:60-62 already does, and use it at the interaction site too. Prefer a shared helper over a second copy, so the two paths cannot drift again. getThreadParentId already exists.

OWNER FLAG: this is a denial-enforcement bypass, so the severity call is the owner one, not an agent one. Anyone denied in a parent channel can currently still run slash commands in its threads.

Acceptance: a parent-channel denial suppresses slash-command interactions in child threads; message-path behavior is unchanged; one test pins each path against the same shared helper.

GROUNDED 2026-08-30 — read before building; this REVISES the fix shape above and adds a landmine the original filing missed.

CALLER COUNT IS EXACTLY TWO in production: index.ts:525 (interaction) and DenylistFilter.ts:65 (message). Everything else matching isChannelDenied is DenylistCache.test.ts or DenylistFilter.test.ts. So this is a two-site change, not a sweep.

REVISED FIX SHAPE — push the parent INTO the cache method rather than extracting a caller-side helper. isChannelDenied's sibling isBlocked ALREADY takes parentChannelId as its fifth parameter and already does thread-to-parent inheritance internally (DenylistCache.ts:187+). Giving isChannelDenied the same shape makes the two methods symmetric and puts the inheritance rule where a reader looks for it, instead of leaving it as a caller responsibility that one of two callers forgot. Prefer the parameter REQUIRED-but-nullable — isChannelDenied(userId, channelId, parentChannelId: string | null) — so the compiler forces every caller to consider it. An optional param would let the next caller forget exactly the way index.ts did.

LANDMINE, and this is the one that would silently break the acceptance: the two inheritance semantics are DELIBERATELY DIFFERENT and are documented at DenylistFilter.ts:56-59. The message path treats ANY mode as denial — BLOCK or MUTE, on the thread OR the parent, either one suppresses the response. isBlocked does NOT work that way: it inherits only BLOCK from the parent, and an explicit MUTE on the thread OVERRIDES a parent BLOCK (comment at the channel-scoped branch: "Only inherit from parent if thread has NO explicit entry"). So implementing isChannelDenied inheritance by copying isBlocked would change message-path behavior, which the acceptance above forbids. Implement the ANY-MODE rule, and keep the divergence comment — moving it onto the cache method is the natural home once both rules live there.

Interaction-side detail: the interaction path has interaction.channel (Channel or null) alongside interaction.channelId, so getThreadParentId(interaction.channel) works there with no API fetch — it reads channel.parentId, a plain snowflake, per its own docstring. Where interaction.channel is null (uncached), parent resolution yields null and behavior degrades to exactly today's, which is an acceptable floor but should be stated in the PR rather than discovered.
<!-- SECTION:DESCRIPTION:END -->
