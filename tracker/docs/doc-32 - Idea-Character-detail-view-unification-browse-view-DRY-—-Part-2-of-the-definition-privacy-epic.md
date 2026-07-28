---
id: doc-32
title: >-
  Idea: Character detail-view unification (browse/view DRY — Part 2 of the
  definition-privacy epic)
type: other
created_date: '2026-07-28 11:11'
---

## Character detail-view unification (browse/view DRY — Part 2 of the definition-privacy epic)

_Part 1 (definitionPublic toggle + redaction + rendering + import/export round-trip) SHIPPED 2026-07-07 (#1546/#1547/#1548, rides beta.154). The customFields export gap shipped with it; voice-reference export has its own follow-ups row._

**Remaining scope (deferred by plan, promote when picked)**: `/character view` uses its own paged builder (`view.ts`); `/character browse`→select opens the edit dashboard (`buildDashboardEmbed`). Owner goal: browse-select opens the SAME canonical detail view as `/character view`, and browse→select→shared-detail-view becomes a common pattern across commands (not just character). Pure-UX refactor, independent of the privacy fix (redaction is DRY at the API). Related follow-ups to absorb: the browse isAdmin param fix, /character option-access idiom drift.

