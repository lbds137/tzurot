---
id: TASK-1069
title: >-
  Voice messages recorded by a Vencord/Vesktop plugin arrive as video/webm and
  are never transcribed
status: To Do
assignee: []
created_date: '2026-09-24 01:23'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1063000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-09-23. A voice message recorded with a Vencord/Vesktop desktop plugin (the owner uses desktop because mobile Discord age verification locks them out of NSFW channels) plays in Discord with the native voice-message player, but Tzurot never transcribes it; the persona answered that the voice arrived with no transcript. Runtime evidence, debug JSON for request d1df88bb (copy at docs/local/debug/debug-d1df88bb-vencord-webm-voice.json, gitignored): the assembled prompt carries a file element with filename voice-message.ogg and type video/webm, inputProcessing.voiceTranscript is null, attachmentDescriptions is empty. Code: services/bot-client/src/utils/voiceAttachment.ts:46 classifies a voice message as contentType audio/* AND a duration, so a video/webm upload reads as a plain file, and every downstream voice path keys on isVoiceMessage (ai-worker RAGUtils.ts:360, AudioTranscriptionJob.ts:116, api-gateway jobChainOrchestrator.ts:54).
Fix shape: add a voice discriminator that survives the content type. Candidates, verify first against one raw plugin-recorded message (attachment content_type, duration_secs, waveform, message flags): the attachment waveform (discord.js Attachment.waveform, set only on voice messages) or the message IsVoiceMessage flag. Keep genuine video/webm video uploads classified as files. Confirm the STT path accepts webm/opus (voice-engine and the Mistral provider) before routing it there.
Acceptance: a voice message whose attachment is video/webm with voice-message metadata is transcribed and renders as a voice element with its transcript, both live and replayed from history; a real video/webm video attachment still renders as a file.
<!-- SECTION:DESCRIPTION:END -->
