---
id: TASK-1108
title: >-
  Spacebar spike: map the discord.js surface bot-client uses against the
  Spacebar server, then probe an instance hands-on
status: To Do
assignee: []
created_date: '2026-09-25 18:51'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1101000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner directive 2026-09-25 (#general and the driver session): "I honestly want to fork and self host something so Tzurot has a proper home"; wants the spike soon. doc-83 carries the candidates and the 2026-09-25 input (federation is now a requirement). No new repo: the spike output is a decision doc in Tzurot; a Spacebar fork, if the spike says so, is a later decision.

Fix shape, part 1 (read-only, cloud-lane eligible): grep services/bot-client for its discord.js surface (REST routes and gateway events actually used: application-command registration, interaction create for slash/component/modal/autocomplete, webhooks execute/edit, message forwards and references, voice messages, attachments) into a checklist; for each row read the Spacebar server source (api, gateway, cdn) and mark implemented / stub / missing with the file cite; add one paragraph per candidate (Spacebar, Stoat, the Matrix-shaped option in doc-79) on what federation would mean; answer whether discord.js can be pointed at a non-Discord host (REST api base + gateway URL) with the option names cited. Output: docs/local/spacebar-spike.md plus a summary section in doc-83.

Part 2 (hands-on, depends on part 1 answering the host question yes): podman-compose a Spacebar instance on the Deck, point a dev bot-client at it, and record which checklist rows work at runtime (command registration, an interaction round trip, a webhook post, a component click). Part 2 is its own unit.

Acceptance: every checklist row has a verdict with a cite; the federation paragraphs exist; doc-83 has a dated summary and a recommendation (fork Spacebar / adopt Stoat / neither) for the owner to rule on.
<!-- SECTION:DESCRIPTION:END -->

created: 2026-09-25 15:28
---
PART 1 DONE 2026-09-25 (local read-only agent; docs/local/spacebar-spike.md; doc-83 carries the summary and recommendation). Verdict: Spacebar has the persona path, interactions reply half is stubs (deferred reply TODO, editReply unknown webhook, modal/autocomplete missing); discord.js host override is possible via rest.api/rest.cdn/rest.mediaProxy with three bot-client/ai-worker touch points; no federation on Spacebar or Stoat. Recommendation: patch-set fork of Spacebar, provisional; part 2 (podman probe on the Deck) decides. Task stays open for part 2; owner rules on the fork.
---
