---
id: TASK-716
title: 'Make the forward access gate structurally shared, not documentarily shared'
status: To Do
assignee: []
created_date: '2026-08-21 16:09'
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
<!-- SECTION:DESCRIPTION:END -->
