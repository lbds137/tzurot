---
id: TASK-597
title: >-
  Restrict attachment-option file types client-side once discord.js exposes the
  filter
status: To Do
assignee: []
created_date: '2026-08-14 00:05'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 597000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Discord Developer News (August 2026) added file-type filtering for ATTACHMENT command options and File Upload components. We have six addAttachmentOption sites whose accepted types are documented only in the option DESCRIPTION prose and enforced only server-side, so a user can upload a wrong-typed file, wait for the round trip, and then get rejected.

Sites: character/index.ts image (avatar, PNG/JPG/GIF/WebP) x2, audio (voice reference, WAV/MP3/OGG/FLAC) x2, file (character JSON); preset/index.ts file (preset JSON).

BLOCKER: the installed discord.js (^14.27.0) does not expose the option. Grepped discord.js typings and discord-api-types payloads for setAllowedContentTypes and allowed_content_types - no hits. This needs a discord.js release carrying the API field before it is startable, which is why it is state:dependent rather than state:ready.

Fix shape: once available, set the allowed content types on each of the six options from the SAME constant the server-side validator uses, so the two cannot drift. Do not hand-write a second parallel list - that is the drift class 06-backlog keeps filing.

Acceptance: each attachment option declares its accepted types from the shared constant; the option description prose no longer has to carry the list as its only enforcement; server-side validation stays as defense in depth.

Note: assistant-generated intake from an owner-relayed announcement - counts against the session net.
<!-- SECTION:DESCRIPTION:END -->
