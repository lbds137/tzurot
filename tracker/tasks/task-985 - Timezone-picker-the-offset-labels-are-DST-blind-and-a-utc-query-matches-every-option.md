---
id: TASK-985
title: >-
  Timezone picker: the offset labels are DST-blind and a "utc" query matches
  every option
status: Done
assignee: []
created_date: '2026-09-14 23:16'
updated_date: '2026-09-15 19:20'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 981000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the timezone picker displays a hardcoded offset string per option, and those strings are DST-blind. Europe/London carries offset UTC+0 while it is actually UTC+1 from late March to late October; America/New_York carries UTC-5 while it is UTC-4 over the same window. For roughly eight months a year the offset shown to the user is wrong by an hour for every DST zone in the list. The CONVERSION is correct, because it uses the IANA zone, so this is a display defect only - but the display is what a user picks from.

Observed 2026-09-14 while runtime-verifying the beta.225 timezone fix: the owner set Europe/London and the prompt correctly rendered GMT+1, while the picker had advertised that option as UTC+0.

CORRECTION, recorded so the next reader is not misled: this task was first filed claiming the owner intended UTC and was misled into picking London by the label. That premise is FALSE - the owner confirmed London was the deliberate choice. The DST-blind label below is verified independently of that story and is the whole of this task.

Sites (verify before editing, cites drift): packages/common-types/src/constants/timezone.ts, the TIMEZONE_OPTIONS array; and the autocomplete handler in services/bot-client/src/commands/settings/index.ts that filters it.

Secondary, verified but unmotivated by any real mis-selection: the autocomplete filter matches on value, label OR offset, and every option offset contains the literal text UTC. So the query utc matches all 24 options and filters nothing, and the genuine UTC (Coordinated Universal Time) entry sorts last at index 23. Reproduced by direct call against the built constant. The 25-choice Discord cap is NOT involved - 24 options all fit, and an earlier reading that blamed truncation was wrong. Worth fixing while the file is open; not worth a PR on its own.

Fix shape: derive the offset at render time from the IANA zone rather than storing a string - Intl.DateTimeFormat with timeZoneName shortOffset against the current date - and drop the static offset field. While there, rank exact value and label matches ahead of offset matches in the autocomplete filter.

Acceptance: the offset shown for Europe/London reads UTC+1 during BST and UTC+0 outside it, pinned by a test that fixes the clock on both sides of the DST boundary; and typing utc returns the UTC entry in the first three choices.
<!-- SECTION:DESCRIPTION:END -->
