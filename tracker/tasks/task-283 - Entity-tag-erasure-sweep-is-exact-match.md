---
id: TASK-283
title: 'Entity-tag erasure sweep is exact-match'
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
labels:
  - 'origin:review'
dependencies: []
ordinal: 283000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Entity-tag erasure sweep is exact-match — disclose or widen — Account deletion's facts-about-you sweep matches `user:` tags against username + persona names + preferred names (lowercased, exact). Free-text model tags using a nickname/variant ("Ali" for "Alice") under OTHER users' scopes survive "delete everything about me" (#1655 r2 obs 1 — inherent to free-text tagging, not a coding bug). **Fix shape**: (a) one disclosure line in the privacy policy's erasure section + the delete warning embed ("references to you under nicknames other users' characters coined may persist"), and/or (b) widen the sweep (fuzzy/trigram match or an alias table) — needs design; owner already accepted exact-name collateral, fuzzy raises the false-positive stakes. **Promote when**: the legal docs' finalization pass (contact-method/effective-date fill-in) — the disclosure belongs in that edit; or a real erasure request arrives. Surfaced 2026-07-15 (#1655 r2).

**Why:** The erasure right must not overclaim; a one-line disclosure is the honest floor.
<!-- SECTION:DESCRIPTION:END -->
