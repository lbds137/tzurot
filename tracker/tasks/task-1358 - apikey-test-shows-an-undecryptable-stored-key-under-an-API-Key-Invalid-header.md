---
id: TASK-1358
title: apikey test shows an undecryptable stored key under an API Key Invalid header
status: To Do
assignee: []
created_date: '2026-11-08T05:26:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1341000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: after the TASK-1022 fix, POST /api/user/wallet/test answers 401 with the owner-ruled message (Your saved <provider> key cannot be read anymore. Set it again with /settings apikey set.) when the stored key will not decrypt. bot-client services/bot-client/src/commands/settings/apikey/test.ts routes every non-404/429 failure to buildKeyInvalidEmbed (title API Key Invalid, description says the key failed validation, a What to do list about provider credits), so the user sees the correct message inside a frame that claims the provider rejected the key. What: branch result.status === 401 to render the gateway message plainly (or a catalog spec) without the invalid-key framing; copy wording is an owner call. Acceptance: a test in test.test.ts pins that a 401 result renders the gateway message without the API Key Invalid title.

Member (claude-review round 4 on PR 2721): undecryptableApiKeyMessage (packages/common-types/src/utils/providerDisplayName.ts) interpolates getProviderDisplayName, so a Mistral user who runs /settings apikey test on an unreadable key reads "Your saved Mistral (Voxtral TTS/STT) key can't be read anymore". The parenthetical reads awkwardly in a sentence. Per the owner ruling the copy uses the display name; whether to keep it or add a short-name variant for sentences is an owner copy call, decide it with this task's rendering.
<!-- SECTION:DESCRIPTION:END -->
