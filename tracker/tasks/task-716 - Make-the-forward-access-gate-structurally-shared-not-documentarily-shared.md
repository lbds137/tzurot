---
id: TASK-716
title: 'Make the forward access gate structurally shared, not documentarily shared'
status: Done
assignee: []
created_date: '2026-08-21 16:09'
updated_date: '2026-08-21 17:29'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 716000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review finding on PR 2170 round 3 (Low, non-blocking), and it survives that PR rather than being answered by it.

TASK-712 shipped by porting the gate: buildForwardMarker (SnapshotFormatter.ts) and resolveOriginChannelName (forwardedMessageUtils.ts:403) now run the same three checks in the same order -- isDMBased, permissionsFor carrying ViewChannel, satisfiesPrivateThreadMembership -- differing only in terminal value (a marker string versus undefined). What keeps them in sync today is a docstring cross-reference, which is a convention rather than a mechanism.

The divergence risk is the point: the ORIGINAL bug this whole thread came from was a second gate written from the first that silently dropped the thread half. That is precisely the failure a documentary link does not prevent. TASK-710 already extracted the private-thread step for the same reason; this is the same argument applied to the two steps above it.

Fix shape: extract a boolean helper, roughly canForwarderViewChannel(channel, forwarderId): Promise<boolean>, next to satisfiesPrivateThreadMembership in utils/threadAccess.ts, and call it from both sites. Channel RESOLUTION stays per-site and is not part of the extraction: SnapshotFormatter reads the bot cache and narrows from Channel-or-undefined, while resolveOriginChannelName receives an already-resolved TextBasedChannel. Only the gate that follows resolution is common.

Not done inside PR 2170 deliberately: it edits resolveOriginChannelName, a function shipped in #2167 and untouched by that PR, so folding it in would have grown a round-3 diff into a second shipped surface. That is scope growth at the worst moment, not a merit objection.

Watch item rather than a premise: the reviewer tied this to the CPD ratchet. Not verified that these two fragments actually trip jscpd -- they are short and call-dominant, which is exactly the shape the post-filter excludes. Check pnpm ops cpd:filtered before citing duplication counts as a reason.

Acceptance: one helper owns the ViewChannel-plus-thread-membership decision; both call sites use it; a test proves a change to the helper reaches both paths, so the two cannot drift silently again.
FIX SHAPE REVISED 2026-08-21 after PR 2170 round 6, which proposed a better one than the
canForwarderViewChannel extraction filed above. Prefer the reviewer's: EXPORT resolveOriginChannelName
from forwardedMessageUtils.ts and have buildForwardMarker call it, reducing that function to cache
resolution plus marker formatting.

Why it is better: the extraction shape shares three of the four gate steps, leaving the fourth (returning
the channel name) still written twice. Calling resolveOriginChannelName shares ALL of it, so the two paths
cannot diverge at all rather than being harder to diverge.

Import direction VERIFIED, not assumed: forwardedMessageUtils.ts imports nothing from handlers/, so no
cycle. And the direction is established precedent rather than new — handlers/references/types.ts,
MessageFormatter.ts and strategies/LinkReferenceStrategy.ts already import forwardedMessageUtils.

The narrowing also already lines up: buildForwardMarker gates on channel?.isTextBased() !== true, and
isTextBased is a discord.js type predicate, so the surviving value is exactly the TextBasedChannel that
resolveOriginChannelName accepts. No cast expected; if one turns out necessary, that is a stop condition
worth reporting rather than working around.

Shape after the change:

  const channel = forwardedFrom.client?.channels?.cache?.get(originChannelId);
  if (channel?.isTextBased() !== true) return GENERIC_FORWARD_MARKER;
  const name = await resolveOriginChannelName(channel, forwardedFrom.author.id);
  return name !== undefined ? `(forwarded from #${name})` : GENERIC_FORWARD_MARKER;

Keep the extraction shape as the fallback only if exporting turns out to be objectionable on layering
grounds. Nothing found so far suggests it will be.
RIDE-ALONG, from PR 2170 round 7 (non-blocking, deliberately not fixed in that PR because it had
already passed the review-round cap and the fix touches this same function): the
appendForwardedSnapshots docstring in ReferenceFormatter.ts OVERSTATES what hoisting the marker
protects. It says the now-synchronous loop body is what protects reference numbering, contrasting
it with discipline -- but the numbering was never merely disciplined. A for-of with an await inside
is sequential by construction, and FormatState is a fresh local per format() call, so no
interleaving was possible before the hoist either. The accurate framing is that the hoist removes
the SHAPE a future Promise.all refactor could exploit, not that it fixed a live ordering risk. The
current-state half of the claim is true; the implied before-and-after contrast is not.

Correct it in this task's PR, which restructures buildForwardMarker a few lines away.

Also settled while triaging that round, so nobody re-raises it: the reviewer noted that
forwardedFrom.author.id would be a WEBHOOK id when one of our own personas forwards a message. That
is not a hole -- permissionsFor on a webhook id finds no guild member and returns null, which the
gate already treats as fail-closed. The consequence is only that a persona-forwarded message never
gets its origin channel named. Same behaviour as the sibling path, and in the safe direction.
SHIPPED — PR #2172, merged 2026-08-21. One review round, no blocking or non-blocking findings.

Acceptance, quoted and answered per clause:
"one helper owns the ViewChannel-plus-thread-membership decision; both call sites use it; a test
proves a change to the helper reaches both paths, so the two cannot drift silently again."
- ONE HELPER OWNS IT: MET. resolveOriginChannelName, exported.
- BOTH CALL SITES USE IT: MET.
- A TEST PROVES A CHANGE REACHES BOTH: MET, and verified by canary rather than asserted — breaking
  the ViewChannel check inside the shared function reddens four tests across BOTH files. Had it
  reddened only one, the sharing would not have been structural and the PR would have been pointless.

The reviewer's shape (call the function) beat the filed shape (extract a sub-helper), for a reason
worth keeping: the extraction shared three of four steps and left the fourth written twice, so it
would have made divergence harder rather than impossible. The import direction was verified rather
than assumed — no cycle, and three files under handlers/references/ already import that module.

Also shipped: the appendForwardedSnapshots docstring correction carried from #2170 round 7 (the
synchronous loop body did not start protecting numbering; a for-of with an await is sequential
anyway), and an invariant comment on the newly-exported function that it stays caller-agnostic —
exporting a security gate makes "just add a flag for my case" the next available mistake, which
would reintroduce divergence through the door this PR closed.

Left open and tracked: TASK-717, the throws-for-non-member premise beneath satisfiesPrivateThreadMembership,
now the single unverified claim under all three private-thread gates and the only one in this area
that fails toward GRANTING rather than denying.
<!-- SECTION:DESCRIPTION:END -->
