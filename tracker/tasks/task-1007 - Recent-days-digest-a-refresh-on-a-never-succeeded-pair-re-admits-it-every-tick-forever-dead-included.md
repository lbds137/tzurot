---
id: TASK-1007
title: >-
  Recent-days digest: a refresh on a never-succeeded pair re-admits it every
  tick forever, dead included
status: Done
assignee: []
created_date: '2026-09-18 01:50'
updated_date: '2026-09-18 04:19'
labels:
  - 'area:ai-worker'
  - 'area:common-types'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1003000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: observed on dev 2026-09-18. The owner pair failed first_person at 01:36Z (attempts 1). A digest:refresh at 01:39Z set pending + requested_at. The 01:46Z tick failed again and, because the failure write counts a pending row as a fresh cycle, attempts RESET to 1. The failure write (recentDaysDigestStore.ts recordDigestFailure) never clears requested_at, and the selection query (recentDaysDigestSelection.ts) re-admits on requested_at > COALESCE(generated_at, -infinity) with no digest_status check, so a pair whose generated_at is null forever is selected on every tick, two billed calls each, and going dead does not stop it. Distinct from TASK-1004, which covers the bounded three-tick case with no refresh stamp. Second observation for the same family: the attempts counter resets whenever the watermark moves, so an ACTIVELY chatting pair whose digests always fail is billed twice per tick for as long as the chat continues, never reaching dead; TASK-1004 calls the no-refresh case bounded, which holds only for a quiet pair.
Runtime-confirmed 2026-09-18: the pair went dead at the 02:06Z tick (attempts 3) and the 02:16Z tick selected it AGAIN — sweep line selected=1 dead=1, two more usage rows (41942 in / 548 out, 42535 in / 408 out), attempts 4, requested_at still 01:39:18Z. Ten billed passes on one pair in 40 minutes with no path to stopping except an operator write or the switch.
Fix shape: (1) the failure write sets requested_at = NULL (the request was consumed by the attempt it triggered; a refresh buys exactly one cycle) — one-line SET plus the C6 component fixture; (2) the selection query excludes digest_status = dead unless the watermark moved or the prompt version changed (a refresh alone must not resurrect a dead pair) — pin with a C1 fixture: dead + requested_at set + unchanged watermark → not selected; (3) decide with the owner whether the moving-watermark reset should cap total attempts per pair per day (design D8 territory), or leave it to TASK-1004 backoff. Dev recovery for the current row is a manual requested_at = NULL (the agent was classifier-blocked from writing it; the owner ran it or turned the switch off).
Acceptance: with the switch on and a pair that always fails validation, the sweep bills that pair at most MAX_ATTEMPTS cycles per refresh or per watermark move, and a dead pair with only a refresh stamp is not selected.
<!-- SECTION:DESCRIPTION:END -->
