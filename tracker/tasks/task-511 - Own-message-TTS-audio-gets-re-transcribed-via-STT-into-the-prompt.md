---
id: TASK-511
title: Own-message TTS audio gets re-transcribed via STT into the prompt
status: Done
assignee: []
created_date: '2026-08-10 20:57'
updated_date: '2026-08-10 22:00'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 511000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod debug 37ceb5d2 (2026-08-10) shows a quoted bot message carrying a voice transcript with real STT errors (Ring settles for wing settles, Kush O2 for Cush O2, 7.12 a.m. for 7:12 AM) - the pipeline ran speech-to-text over audio WE generated from known text. Cost: an STT pass per quoted own-voice message; prompt carries a lossy near-duplicate next to the true text already in chat_log; mismatch is a latent confusion risk for the model. Attribution itself is CORRECT (quote labeled assistant/own message) - this is redundancy, not the old self-voice-confusion bug.
Fix shape: when a voice attachment hangs on one of our own (webhook/bot) messages, source the transcript from the message text or the TTS input instead of STT - or drop the voice block from own-message quotes entirely (the stub already points at chat_log for full text). Sweep both render sites: the current-turn contextual_references quote AND chat_log-embedded quotes (both shapes observed in the same debug log).
Acceptance: a quoted own-voice message renders with no STT-derived transcript; no STT call is made for own-message audio.

Corrected diagnosis (owner-prompted history dig, same day): NOT a regression and not merely redundancy - it is the fourth member of the class fixed in June 2026. fc5faf995 guarded the chat_log render + extended-context injection; 0d38a1e24 guarded bot-client forwarded own-bot audio; all three guards verified intact. The REPLY-reference path (DependencyStep -> AttachmentProcessor.processVoiceAttachment) never had a guard (pickaxe-verified) and dispatches STT unconditionally, even though referencedMessageSchema.authorRole already carries the assistant classification at that point. Fix: authorRole==assistant skips STT in the reference path, render identity-only per the June principle; sweep every transcribeAudio dispatch site for a fifth member; regression test at the reference seam (mock only the STT boundary, assert no dispatch for assistant refs).
<!-- SECTION:DESCRIPTION:END -->
