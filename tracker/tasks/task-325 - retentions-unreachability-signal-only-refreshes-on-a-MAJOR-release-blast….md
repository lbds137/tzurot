---
id: TASK-325
title: "retention's unreachability signal only refreshes on a MAJOR-release blast…"
status: To Do
assignee: []
created_date: '2026-07-25 00:00'
labels: []
dependencies: []
ordinal: 325000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-25, **DISPOSITIONED 2026-07-25 (owner)** — retention's unreachability signal only refreshes on a MAJOR-release blast (`releaseBroadcast.ts` is the sole writer of `dm_undeliverable_since`), so the Phase-2 cohort is structurally near-empty between majors. Measured on prod: 0 stamped, 51 inactive ≥180d, ~27 would become both after the next major. **Owner accepted the coupling**: Phase 2 _is_ the unreachable branch, and blast-proven unreachability is exactly its input — the 51 inactive-but-reachable users are **Phase 3's** cohort (notify + export offer + grace), not this one. So the coupling bounds Phase 2's reach rather than breaking it, and the first real purge waits on the next major cut. Documented in the privacy policy's inactivity section. **Promote when**: Phase 3 is scoped (it inherits the reachable population), or a reachability source independent of blasts becomes worth building.

**Why:** Not a defect — a deliberate scope boundary between Phase 2 and Phase 3, recorded so the empty cohort doesn't read as a broken query.
<!-- SECTION:DESCRIPTION:END -->
