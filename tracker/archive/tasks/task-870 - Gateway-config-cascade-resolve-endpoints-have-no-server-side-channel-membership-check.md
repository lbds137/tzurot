---
id: TASK-870
title: >-
  Gateway config-cascade resolve endpoints have no server-side
  channel-membership check
status: To Do
assignee: []
created_date: '2026-09-02 20:01'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 870000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: surfaced by the claude-review on PR #2307. handleResolveCascade and handleResolveChannelCascade (services/api-gateway/src/routes/user/config-overrides.ts, verify before editing - cites drift) are gated by requireUserAuth + requireProvisionedUser only; the moderator (Manage Messages) check lives in bot-client handleChannelSettings, so the gateway itself does not verify the caller is a member or moderator of the channelId it resolves. Read-only, channel-tier config values only; the #2307 endpoint promotes channelId from an optional query param to the path, which makes the surface more direct. Predates #2307 (the resolve/:personalityId?channelId= route had the same shape).

Unverified premise to settle first: whether the gateway user-auth path is reachable by anyone other than bot-client holding the service credential. If it is not, the exposure requires an already-compromised service key and this is an accepted risk to document; if it is, a membership check needs a Discord-side lookup the gateway does not have today.

Owner question: add a gateway-side channel-membership or moderator check to the config-cascade resolve endpoints, or record the current shape as an accepted risk?
Recommendation: settle the reachability premise first (one read of requireUserAuth); if the path is bot-client-only, document as accepted risk in docs/local and archive - the check would duplicate a gate the only caller already applies.

Acceptance: the premise is settled with a cite; either the endpoints verify membership/moderator status server-side with tests for the denied case, or the accepted-risk note exists and this task is archived with the reason.
<!-- SECTION:DESCRIPTION:END -->
