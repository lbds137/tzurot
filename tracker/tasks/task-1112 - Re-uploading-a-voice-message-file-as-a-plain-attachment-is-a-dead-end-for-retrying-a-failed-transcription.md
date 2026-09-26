---
id: TASK-1112
title: >-
  Re-uploading a voice-message file as a plain attachment is a dead end for
  retrying a failed transcription
status: To Do
assignee: []
created_date: '2026-09-25 22:29'
updated_date: '2026-09-26 00:07'
labels:
  - 'area:bot-client'
  - 'area:voice'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1105000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-09-25 (prod). After the voice-engine path failed on a Vencord voice message, the owner re-uploaded the same voice-message.ogg file as a plain attachment to retry. It carries no IsVoiceMessage flag, so voiceAttachment.ts classifies it as a file by design (TASK-1069 acceptance: a real video/webm upload stays a file), and the prompt receives the line Attachment type video/webm is not supported instead of a transcript (debug request 4e185c34). The behaviour is as designed but leaves no way for a user to retry a transcription.

Owner question: should a plain attachment that sniffs as audio-only (EBML with an Opus track and no video track, or OggS) be treated as an audio attachment and transcribed, even without the voice-message flag?

Recommendation: yes, narrowly - sniff the container (voiceContainerSniff.ts already does) and require an audio track with no video stream; a real video upload keeps the file path. Sizing S once TASK-1069 follow-up (the transcode) has merged, since it reuses the same prepare step.

Acceptance: uploading a .ogg or audio-only .webm file as a plain attachment produces a transcript in the prompt; a video/webm with a video track still renders as a file; a test pins both.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-26 00:06
---
Owner ruling 2026-09-25: yes, fix it, in beta.232 (not a hotfix). Re-confirmed on prod after beta.231: downloading the Vencord voice-message.ogg and re-uploading it as a plain attachment is not transcribed (screenshot on the owner side). Recommended shape unchanged: sniff the container (voiceContainerSniff.ts), treat an audio-only body (EBML with an Opus track and no video track, or OggS) as an audio attachment even without IsVoiceMessage; a video/webm with a video track stays a file; tests pin both.
---

created: 2026-09-26 00:07
---
Grounding note for the implementer: the owner screenshot (2026-09-25 20:04 EDT) shows Discord rendering the raw re-upload as a plain audio file player (voice-message.ogg, 126 KB), not a voice bubble. Verify what content_type Discord assigns a raw re-upload of this file (the earlier debug log 4e185c34 saw video/webm; a by-extension audio/ogg is also possible) with a read-only GET of the raw message before choosing the sniff branch; the bytes are EBML either way.
---
<!-- COMMENTS:END -->
