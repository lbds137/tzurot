---
id: TASK-13
title: 'estimator disambiguation drift + self-variant comment direction (#1599 round-4 nits) —…'
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
labels: []
dependencies: []
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-12 — estimator disambiguation drift + self-variant comment direction (#1599 round-4 nits) — (a) `getFormattedMessageCharLength` has no `allPersonalityNames` parameter, so the user-branch disambiguation suffix (`" (@username)"`) is unaccounted when the collision is against a SIBLING personality name (pre-existing, few chars per collision) — and `resolveSpeakerForEstimation`'s "can't drift" docstring overclaims accordingly; (b) the accepted-edge comments on `participantUtils.isSelf` / `referenceRole.isSelfVariant` describe one direction of a symmetric bidirectional-prefix check — the reverse edge (responder "Alex", unrelated sibling "Alexandra" reads as self) applies equally and should be written down. **Fix shape**: thread the set (or note the bound) + two comment edits. **Promote when**: next touch of either file.

**Why:** Doc honesty + a few-token estimate gap; both reviewer-flagged non-blocking.
<!-- SECTION:DESCRIPTION:END -->
