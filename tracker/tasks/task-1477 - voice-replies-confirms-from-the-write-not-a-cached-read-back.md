---
id: TASK-1477
title: /voice replies confirms from the write, not a cached read-back
status: To Do
assignee: []
created_date: '2026-11-20T06:36:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1477000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2773 reviews (three rounds) found the /voice replies confirmation re-reads GET /user/voice-resolution after the write. That read (a) can be served from a stale cascade cache entry, since invalidation is async pub/sub, and then renders success next to the OLD mode, and (b) runs fetchAllTzurotVoices, live provider list calls the confirmation throws away.
What: render the confirmed value and source from the write itself (mode + user-personality, the top cascade tier) and use a read only for personalityName and voiceEnabled, via a cheaper read or a skip-voices query flag on the route; if a read-back stays, a value or source mismatch falls back to the committedUnconfirmed shape. Add replies.test.ts cases for the mismatch, the autocomplete-sentinel early return, and the thrown-error catch path.
Acceptance: no provider voice listing on /voice replies; the stale-cache case cannot render success with the old mode; the three new test cases pass.
<!-- SECTION:DESCRIPTION:END -->
