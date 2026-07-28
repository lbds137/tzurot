---
id: doc-46
title: >-
  Idea: Memory modes' persistent layer — a cascade enum under the session modes
  (council 2026-07-21 + owner reflection 2026-07-22)
type: other
created_date: '2026-07-28 11:11'
---

## Memory modes' persistent layer — a cascade enum under the session modes (council 2026-07-21 + owner reflection 2026-07-22)

Two design inputs, one feature. (1) Council-unanimous during the incognito/focus redesign (shipped as `/memory fresh`, #1753): character OWNERS should be able to configure memory behavior for their character — a separate control axis from user-side privacy sessions, composing via most-restrictive-wins (either side can suppress, neither can force-enable). (2) Owner post-ship reflection: the persistent shape is probably a single **multi-switch enum** — memory = read+write / read-only / write-only / none — as symmetric entries in the config cascade (character-owner level, user level, user-character override; channel/guild plausible — guild-level "no memory in this server" has a real privacy use; admin-global makes less sense), covering both incognito (write off) and fresh (read off) semantics in one option. Motivating case: dungeon-crawl character cards running permanent fresh mode still WRITE to LTM — extraction + embeddings + rows that will never be read. The architectural read: fresh's writes-continue behavior is a FEATURE for temporary sessions (turn fresh off and the character remembers what happened) but WASTE for permanent usage — persistent and temporary are different jobs, and a forever-session encoding a permanent preference lives only in Redis (a flush silently drops it). End-state sketch: cascade enum = the persistent/structural layer (Postgres-backed, dashboard-visible, exported), Redis sessions = the temporary override layer on top, most-restrictive-wins across both. NOT a rewrite of #1753 — the session machinery survives as the temporary layer; the enum is additive (non-breaking, doesn't need a major). Interim workaround (zero code): stack `incognito forever` + `fresh forever` per character = "none". **Promote when**: owner schedules it, or the memory-system-overhaul theme (`doc-8`) is picked up — this is a named design input to that conversation.

