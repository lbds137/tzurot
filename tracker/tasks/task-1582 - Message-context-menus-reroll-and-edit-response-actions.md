---
id: TASK-1582
title: 'Message context menus: reroll and edit response actions'
status: To Do
assignee: []
created_date: '2026-11-28T01:10:00Z'
updated_date: '2026-11-28T01:11:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1572000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila ask 11-27 for the next release (relayed via Deck): context / app menu options to reroll a response and/or edit the response (with a modal or something). Sits beside TASK-1558/1559 (Chime In and Edit Character message actions, shipped in beta.252). What: right-click a character reply then Apps then Reroll (regenerate that response; semantics to propose: old response kept or replaced in history, incognito carry, billable-generation accounting) and Apps then Edit Response (modal to edit the message text; semantics to propose: memory extraction on edited text, edited-marker and provenance rendering). Acceptance: reroll + edit semantics proposed to Lila and approved before build; menus follow the Chime In / Edit Character command pattern; component tier pins command structure; unit tests pin the regeneration and edit paths.
<!-- SECTION:DESCRIPTION:END -->
