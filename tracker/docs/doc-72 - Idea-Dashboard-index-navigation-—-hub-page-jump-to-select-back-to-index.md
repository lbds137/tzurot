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

**Member of doc-14's component vocabulary** (Platform-Portable UX Layer — the
"storybook" of generalized patterns the Discord client implements first and
future interfaces, e.g. Stoat, implement later). Whatever pattern ships here is
a design-system component, not a one-off. Touches the same `utils/browse` +
`utils/dashboard` machinery doc-71's `/tag assign` flow would use — if both
build, the jump control ships once, in the shared utilities.

## Promote when

Owner annoyance recurs (it will — the settings dashboard is the owner's own
daily surface), or bundled with doc-71's browse-machinery work.

**At pickup (owner instruction, 2026-08-09): run the design through a council
pass before plan-mode** — the two-level navigation is complex enough UX that
independent perspectives should pressure-test it (index-landing threshold,
component-row budget, whether the jump control belongs in browse utils or
dashboard machinery) before anything is built.

## Owner reiteration (2026-09-17, while running the doc-97 probe on a phone)

Editing overrides and settings is dense enough that finding one row is
annoying, and the missing index (this doc's hub page) is the thing the owner
reached for by name. Two members added from that session:

- **Reset ALL to default on the hub page** — one control on the index that
  clears every override the dashboard owns for that scope, with a confirm.
  Pairs with the per-page reset (tracker task filed the same day, "Reset to
  defaults button on every settings page").
- **Density**: the hub page is also the answer to the row count — a group page
  should hold one concern, not every setting of the scope.

## Council pass (2026-09-24, pickup)

**Code state at pickup (read, not recalled):**
- **Paged dashboards:** admin settings has 11 pages (Memory, Context & Display,
  Voice, plus 8 `System ·` pages; `SYSTEM_SETTINGS_PAGES` in
  `systemSettingsConfig.ts`). User defaults has 3 (`buildCascadePages`).
  Navigation is prev/next only.
- **Flat dashboards:** character settings, character overrides and channel
  settings show all ~17 cascade settings on one overview (`settings:` spreads
  in their command files).
- **Reset today:** channel settings alone has a whole-dashboard reset
  (`resetButton` in `channel/settings.ts`).
- **Rows:** a page uses at most 3 of the 5 (settings select, the pagination
  row, and a reset row when one exists).

**Three models asked** (`~openai/gpt-sol-latest`, `z-ai/glm-5.3-prime`, and
the server default, which answered as an Anthropic model).

**Unanimous:**
- A hub for the 11-page admin dashboard.
- No per-page jump select: it duplicates the hub, costs a row, and puts two
  selects on one message, which invites mis-taps on a phone. TASK-256 is
  absorbed by the hub.
- The Index button goes in an existing row.
- Back from a setting returns to the page it was opened from.
- Dashboards of 3 pages or fewer don't LAND on the hub.
- Build inside the settings machinery. The browse surfaces (143-item character
  browse) need their own design, such as a filter or a letter bucket, and no
  generic paged-index framework is built now.
- No undo for reset-all.

**Split:**
- **Flat dashboards → concern pages.** GPT and GLM said yes: it fixes the
  scanning, and every dashboard then shares one grammar. The Anthropic answer
  said no: fix the select labels instead. The owner's density note above sides
  with splitting.
- **Reset-all.** GLM and the Anthropic answer said build it, labeled with a
  count, behind its own confirm state, idempotent, and landing back on the hub
  when the session has expired. GPT said defer it, and never let it silently
  include admin defaults.

**Owner rulings (2026-09-24, AskUserQuestion):**
- **Landing, "Page 1 + Index button":** a dashboard of 3 pages or fewer opens
  on page 1. Every page of every paged dashboard carries an Index button that
  opens the hub. Only dashboards of 4+ pages (today, admin's 11) LAND on the
  hub.
- **Admin reset, "Not on admin":** Reset all appears only on hubs whose scope
  holds the user's own overrides: user defaults, character settings, character
  overrides and channel settings. The admin hub gets no Reset all, and admin
  keeps per-page reset only.

**Planned units:**
- **PR A, navigation:** the hub view, the landing threshold, the Index button,
  and the flat → concern-page split. Closes TASK-256.
- **PR B, resets:** TASK-1001's per-page reset, plus the hub's reset-all.
