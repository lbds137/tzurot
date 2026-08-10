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

## The generalization — TWO-LEVEL navigation for long browse surfaces

(Owner refinement, same session: the index is a LEVEL, not a bolt-on.)

- **Level 1 — the index**: browse commands LAND here by default. A select menu
  of sections/pages — labeled by section NAME where pages are named
  (dashboards) or by page number + first-item preview where they are not
  (character browse, memory browse).
- **The index paginates itself** when its entries exceed the 25-option select
  ceiling — this is structural, not optional: a 143-character roster's index
  is 6+ index pages by arithmetic. Prev/next at the index level too.
- **Level 2 — the drilled-in page**: prev/next within the level, plus an
  always-present back-to-index button (one level up). Never strand the user in
  level 2 with only linear motion.

Open design question for the build: whether small surfaces (<= ~3 pages) skip
the index and open directly at page 1 (today's behavior) — a hub for 2 pages
is ceremony. Threshold-gated landing keeps small browses one-tap.

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
