---
id: TASK-1145
title: >-
  ops command: inventory bot-client's discord.js surface as the Machloket
  conformance checklist
status: Done
assignee: []
created_date: '2026-09-28 04:13'
updated_date: '2026-10-01 17:25'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1137000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner hard line 2026-09-28: Machloket (the Spacebar fork, doc-83) implements at minimum everything Tzurot needs. Today that checklist is a hand-run grep (doc-83: grep bot-client for its discord.js surface). A hand grep drifts, and a UX wave can add a primitive the fork never hears about until the joint boot.

What: a pnpm ops command (packages/tooling, per 05-tooling No Standalone Scripts) that derives from bot-client source the discord.js surface it depends on: interaction response kinds used (reply, deferReply, editReply, followUp, deferUpdate, update, showModal, respond for autocomplete, ephemeral flags), component types built (buttons, string/user/role/channel selects, modals and their inputs, Components V2 containers), command option types incl. autocomplete, webhook features (thread_id, files, username/avatar), and REST routes called outside discord.js helpers. Emit JSON + markdown; the Spacebar fork session consumes it as its conformance list. Consider a checked-in snapshot plus a CI check so a PR that adds a primitive shows up as a snapshot diff (the doc-14 rule then becomes mechanical).

Acceptance: the command runs on develop and lists every primitive category above with file refs; positive control: a known site (a showModal call, an autocomplete option) appears; the snapshot check, if built, fails when a new primitive is added.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-30: theme doc-109 (transport parity) opened; its Appendix A was the manual v1 of this command's output — the fork and Machloket sessions consumed it until this command shipped. 2026-10-01: SHIPPED (PR #2562) as `pnpm ops surface:inventory` + the snapshot pair at `docs/reference/conformance/` + the `--check` gate in quality and CI; the live conformance list is the snapshot, and doc-109's Appendix A is kept as dated history.
<!-- SECTION:NOTES:END -->
