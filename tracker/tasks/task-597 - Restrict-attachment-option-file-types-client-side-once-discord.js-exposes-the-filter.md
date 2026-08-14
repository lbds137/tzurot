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

VERIFIED SPEC (read from the Discord reference page, owner asked whether JSON imports are covered - they are):
- Values are either a dot-prefixed file EXTENSION (.json) or one of the predefined GROUP names (image, video, audio). MIME types are NOT accepted. Extensions are case-insensitive, normalized to lowercase.
- Maximum 10 file types.
- No wildcards - the docs direct you to the group names instead of enumerating extensions.
- CLIENT-SIDE ONLY, and extension-only: quoting the reference, "This feature only checks the file extension against the filename and does not inspect the file contents. You are still responsible for validating the actual contents of the file."

So all six sites map cleanly: the two avatar options take the image group, the two voice-reference options take the audio group, and both JSON import options (character and preset) take .json.

The client-side-only nature makes the shared-constant requirement above sharper, not softer: this filter can never replace server-side validation, because a renamed .json file passes it. It removes the wrong-file round trip; it does not remove a single existing check. Any implementation that deletes a server-side content check because the picker now filters is WRONG.

Note: assistant-generated intake from an owner-relayed announcement - counts against the session net.
<!-- SECTION:DESCRIPTION:END -->
