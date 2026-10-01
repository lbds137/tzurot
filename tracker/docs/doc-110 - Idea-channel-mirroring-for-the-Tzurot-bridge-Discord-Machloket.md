---
id: doc-110
title: 'Idea: channel mirroring for the Tzurot bridge (Discord <-> Machloket)'
type: other
created_date: '2026-10-01 02:44'
---

## Idea

Lila, 2026-09-30 ~22:5x EDT (logged verbatim in intent): when we build the Tzurot bridge between Discord and Machloket, it should have the capability to **mirror channels** — the pattern established by existing Discord <-> Stoat (formerly Revolt) mirror bots: a message posted in a source channel on one platform appears in a bound channel on the other, both directions, preserving author identity markers and attachments.

## Context

- Sits downstream of the transport-parity theme: the bridge presumes M5-level conformance (doc-109) and the dual-platform data model already sketched in TASK-1138 (Discord + Machloket feeding one Tzurot).
- Existing art to study: the Discord<->Revolt/Stoat mirror bots Lila named; also Tzurot's own cross-channel history + `summarized` mode machinery (identity handling across channels is a solved-adjacent problem in this codebase).

## Open questions (for the design pass, whenever promoted)

1. Author identity: webhook persona per mirrored author (like the M3 persona render), prefix tags, or profile-linked mapping?
2. Scope of "mirror": messages only, or edits/deletes/reactions/threads/attachments too — each is a separate fidelity tier.
3. Loop prevention and rate limits when BOTH platforms host active conversations.
4. Moderation surface: does deleting on one side delete on the other (and who may)?
5. Config shape: which pairs of channels are bound, per-guild opt-in, and how it interacts with channel_settings.

## Disposition

Idea — not scheduled. Promotes when the bridge work starts for real (post-M5 pilot decision is Lila's) or on an explicit pull.
