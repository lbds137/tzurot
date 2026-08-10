---
id: doc-72
title: 'Idea: Dashboard index navigation — hub page + jump-to select + back-to-index'
type: other
created_date: '2026-08-10 02:05'
---

_Origin: owner gripe 2026-08-09, mid-smoke, about the admin settings dashboard
(9 pages after the models/limits split). Prev/next-only navigation makes a
named-page dashboard behave like a linked list when its structure is a tree._

## The concrete case — /admin settings

- **Index (hub) page**: a landing view listing the setting groups, with the
  house select-menu pattern to jump straight to a group's page. 9 groups is
  well under the 25-option select ceiling. Pure navigation — no settings
  rendered on the hub itself.
- **Back-to-index button** on every group page, alongside prev/next (house
  button-order conventions; custom-id in the `command::action::id` format).
- Pages are PREDICTABLE AND NAMED — which is what makes the hub cheap: the
  option labels already exist as group names.

## The generalization — jump navigation for long browse surfaces

The browse utilities (`buildBrowseButtons`, `createBrowseCustomIdHelpers`)
could grow an optional jump control when page count exceeds a threshold
(~4+): a select menu of pages, labeled by section NAME where pages are named
(dashboards) or by page number + first-item preview where they are not
(character browse, memory browse). Two flavors, one mechanism.

Constraints to check at build time:

- Message component limit: 5 rows per message — the jump select consumes a
  row, so surfaces already at 5 rows need a layout decision, not a bolt-on.
- Select interactions route through the exported `handleSelectMenu` per the
  component-routing rule (no collectors).
- Session state: dashboards already carry sessions; a hub page must not
  invalidate the session shape (`fetchOrCreateSession` reuse).

## Relation

Standalone UX theme; touches the same `utils/browse` + `utils/dashboard`
machinery doc-71's `/tag assign` flow would use — if both build, the jump
control should ship once, in the shared utilities.

## Promote when

Owner annoyance recurs (it will — the settings dashboard is the owner's own
daily surface), or bundled with doc-71's browse-machinery work.
