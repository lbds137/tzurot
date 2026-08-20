---
id: TASK-690
title: >-
  /chat and /random echo the user message unchunked, so a long message overflows
  Discord
status: To Do
assignee: []
created_date: '2026-08-20 01:17'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 690000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: sendAndPersistUserMessage (services/bot-client/src/services/character/characterTurn.ts:227) sends the prefixed echo as ONE channel.send with no split and no truncation. The message option is capped at 2000 (services/bot-client/src/commands/chat/index.ts:69, services/bot-client/src/commands/random/index.ts:57), so the sent content is message.length + displayName.length + 6 against the 2000-char Discord message cap. The overflow margin varies PER PERSONA, so the same message length succeeds for one persona and fails for another. No try/catch wraps the call site (characterTurn.ts:108), so the throw fails the whole turn rather than degrading.

NOT RUNTIME-CONFIRMED: this is code-reading. The unverified link is that Discord rejects a bot message over 2000 characters. Cheap to confirm with one long /chat once the account restriction lifts.

The response path already solves exactly this: DiscordResponseSender.ts:181-182 builds the prefixed string and THEN calls splitMessage from common-types/utils/discord. The echo path never got the same treatment.

OWNER DECISION (2026-08-19): while fixing the chunking, RAISE the input cap on both commands from 2000 to 4000. Rationale: 4000 is the Nitro message length, so a Nitro user gets parity with typing a message normally. Discord permits it — max_length carries a documented maximum of 6000, and 6000 is also the default when unset (verified against the Discord developer docs directly, not the code comment in tagPool.ts). Note the asymmetry that makes chunking load-bearing rather than optional: Nitro raises the ceiling for the HUMAN, but the bot still sends at 2000, so without chunking the bump would simply move the break point.

Fix shape: in sendAndPersistUserMessage, build the prefixed content then splitMessage it and send each chunk. Return the LAST chunk as the anchor Message, because the caller anchors the assistant row at echo createdAt + 1ms and the pair must stay ordered against the real Discord timeline. Then set both message options to 4000. One fix covers both commands, since /chat and /random both run through characterTurn.

Acceptance: a 4000-character /chat message echoes as multiple messages with no send failure, the persisted user row carries the full text, the assistant reply still sorts after the whole echo, and both options accept 4000.
<!-- SECTION:DESCRIPTION:END -->
