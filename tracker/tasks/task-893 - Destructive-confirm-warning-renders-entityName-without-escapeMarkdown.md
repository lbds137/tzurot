---
id: TASK-893
title: Destructive-confirm warning renders entityName without escapeMarkdown
status: To Do
assignee: []
created_date: '2026-09-05 03:44'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 891000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: createHardDeleteConfig builds warningDescription from entityName verbatim (grep -n "entityName" services/bot-client/src/utils/confirmation/confirmDestructive.ts). Every caller passes a value that flows from a user-typed autocomplete option (a personality slug on /history purge, and whichever entity the other destructive flows name), so markdown in the name renders as formatting inside the warning embed instead of as text. The same value also feeds dynamicDeletePhrase, so the typed confirmation phrase is derived from the raw string. Surfaced by the TASK-206 orchestrator; declined there because fixing it changes the own-scope purge copy, which that unit was told to leave byte-identical.

Fix shape: escape the DISPLAY of entityName (escapeMarkdown at the point it is interpolated into warningDescription and the success embeds), leave the phrase derivation reading the raw value so the typed phrase does not change; enumerate every createHardDeleteConfig caller (grep -rn "createHardDeleteConfig(" services/bot-client/src --include=*.ts) and pin one test per caller that a name carrying an underscore or asterisk renders literally. Slugs are constrained by SLUG_MAX_LENGTH and the slug charset, so check whether the charset already excludes markdown characters; if it does for every caller, close this as verified-not-reachable with the regex cited.

Acceptance: a name containing markdown characters renders literally in every destructive-confirm warning, or the charset argument is recorded on this task and it is archived.
<!-- SECTION:DESCRIPTION:END -->
