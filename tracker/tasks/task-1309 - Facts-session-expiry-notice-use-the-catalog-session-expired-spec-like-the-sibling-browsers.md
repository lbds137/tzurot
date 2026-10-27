---
id: TASK-1309
title: >-
  Facts session-expiry notice: use the catalog session-expired spec like the
  sibling browsers?
status: To Do
assignee: []
created_date: '2026-10-27T14:08:00Z'
labels:
  - area:bot-client
  - size:S
  - state:owner
dependencies: []
priority: low
ordinal: 1293000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2672 review round 3 (low, consistency). FACTS_SESSION_EXPIRED in factsBrowse.ts is a hand-written string (a clock glyph, This interaction has expired. Please run /memory facts again.), while the memories batch, alias batch and alias batch confirm flows use CATALOG.progress.sessionExpired(command), which renders Session expired. Please run the command again with the catalog glyph and a warning severity. The facts helper followUpFactsRefusal is now the single place that sends it, so the switch is one line plus the tests that pin the constant.

What: send the session-gone refusal through CATALOG.progress.sessionExpired with the /memory facts command hint, and retire the FACTS_SESSION_EXPIRED constant and its tests that pin the old wording. (factsBrowse.ts has no raw-content-allowlist entry after PR 2672, since the copy no longer sits at a content position directly.)

Owner question: do you want the facts expired-session notice reworded to match the other browsers (catalog wording and glyph), or keep the current facts-specific wording?
Recommendation: switch to the catalog spec. The three sibling flows already use it, the wording change is small and consistent, and the facts copy has no reason to differ; a one-line comment is the only alternative if you want it kept.

Acceptance: per decision; if switched, the expiry tests derive the text from the catalog.
<!-- SECTION:DESCRIPTION:END -->
