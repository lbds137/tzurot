# Tzurot UX Design System — Command Surface & Experience Spec

> **Status**: ACCEPTED 2026-07-04 (boulder #1 part 2) — full-trio council pass (GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max, §11); all 21 §10 decisions adopted as recommended (owner sign-off 2026-07-04)
> **Companion**: [`platform-portable-ux-design.md`](platform-portable-ux-design.md) (part 1 — the *machinery*: catalog, builders, enforcement). **This doc is the WHAT; part 1 is the HOW.** Part 1's phases implement this spec's decisions.
> **Theme**: [`backlog/cold/themes/platform-portable-ux-layer.md`](../../../backlog/cold/themes/platform-portable-ux-layer.md)
> **Grounding**: 3-agent sweep 2026-07-04 — full command tree (exact user-visible strings), output-side visual audit, `/inspect` + owner-command deep-dive.

## 1. Principles

1. **The command surface is a mini website.** Discord's components (commands, embeds, buttons, selects, modals) are our rendering primitives; the design system defines the site built from them. Owner framing: "a consistent design language… an abstract design system we can apply both to Discord and, eventually, a web front end."
2. **Information density is an accessibility concern.** Chunk, paginate, and expand-on-demand instead of dumping. A busy dashboard is a bug (the defaults dashboard is the current offender). Prefer progressive disclosure: summary → detail → expand → export.
3. **Recognition over recall.** Stable visual identity per entity (one emoji, everywhere), badges with legends, one list grammar — so a user recognizes "a character thing" or "a browse view" before reading a word.
4. **Owner/admin surfaces are first-class UX.** "I'm a user too, not just admin." No raw HTTP dumps, no truncated JSON blobs, no pasted snowflakes where autocomplete could exist. Same tokens, same components.
5. **Platform-neutral core.** The tokens and component semantics in this doc are Discord-independent; part 1's depcruise-bounded catalog/renderer split is the enforcement. A future web front end implements the same system with different primitives.
6. **Crystallize, don't invent.** Every rule below generalizes something already validated in-repo (named exemplar per section). Gold standard: `/character edit` (sectioned dashboard, status indicators, previews, modal editing, refresh-in-place). Named worst case: `/deny` (§6.5).

## 2. Design language — tokens

### 2.1 Entity registry (one emoji + one noun, everywhere)

Today the same entity changes emoji per view (character: 📚 browse / 👁️ view / 📝 edit; persona: 👤/🎭). Rule: **the entity emoji is the entity's identity across browse, view, edit, autocomplete badges, and help category** — the *view kind* is expressed in words, not emoji.

| Entity | Emoji | Noun (user-visible) | Notes |
| --- | --- | --- | --- |
| Character | 🎭 | character | "personality" never user-visible (already true — codify) |
| Persona | 👤 | persona | 🎭 currently used by persona view — reassigned to character (roleplay is the character's job) |
| Preset | ⚙️ | preset | browse currently 🔧 — collapse to ⚙️ |
| Memory | 🧠 | memory | |
| History | 📜 | conversation history | |
| Channel activation | 📍 | channel | |
| Model | 🤖 | model | |
| Voice | 🎤 | voice | view currently 🎙️ — collapse to 🎤 |
| API key | 💳 | API key | Keeps the established wallet identity — and avoids colliding with the 🔑 needs-key badge (collision rule below) |
| Denylist entry | 🚫 | denial | |
| Shapes | 🔗 | shapes.inc character | already stable — the exemplar |

Title grammar: `{entity emoji} {Title}` — browse: `🎭 Characters` (plural noun, drop the "X Browser" suffix); detail: `🎭 {Name}`; edit: `🎭 Editing: {Name}`; search results: `🧠 Memory Search`. Status/outcome embeds keep action emoji (✅/⚠️/❌) — those are *outcome* surfaces, not entity surfaces.

### 2.2 Badge glossary (collision resolution) + mandatory legend

Current collisions: 🔒 = private *and* needs-key *and* locked; ⭐ = default *and* active; 🌐 = public *and* global; global-preset = 🌐 *and* 📌.

| Badge | One meaning | Replaces |
| --- | --- | --- |
| 🌐 | visible to everyone (public/global — same concept: "everyone" scope) | 📌 "global preset" in models browse |
| 🔒 | private / owner-restricted | — |
| 🔐 | locked (protected from deletion) | memory's 🔒 |
| 🔑 | requires your own API key | models browse's 🔒 |
| ⭐ | default (the one used when you don't choose) | API wallet's "active" ⭐ → ✅ |
| ✅ | active / usable-by-you | |
| 🆓 | free tier | |
| 👁️ | vision-capable | |
| 👥 | owned by another user | was 👤 — reassigned (collision with the persona entity emoji) |

**Collision rule (council catch, all three models)**: no glyph may serve as both an entity emoji (§2.1) and a badge — a reader must never wonder which register a glyph is in. The two violations this caught: 👤 (persona entity) → owned-by-other badge becomes 👥; 🔑 (needs-key badge) → API-key entity stays 💳.

**🔒 vs 🔐, crisply**: 🔒 private = *visibility* (others can't see it); 🔐 locked = *protection* (visible but can't be deleted/modified). If a legend can't state a badge's meaning in a few words, the badge is wrong.

**Legend rule**: any embed that renders badges carries a footer legend for exactly the badges present, word-first (`Private 🔒 · Locked 🔐`), capped so the legend never crowds content on mobile (`joinFooter` already supports this — adopt in the two bypasses: voice browse, API-key browse). Single source: extend `AUTOCOMPLETE_BADGES` to be THE badge registry; embeds import from it, never hand-roll. **Color is never the sole signal** — every semantic-colored surface also carries its emoji/word signal (already true via ✅/⚠️/❌ prefixes; codified).

### 2.3 Colors

Rule: **embed color encodes surface kind, not entity state.** Informational surfaces (browse, detail, dashboard, stats, help) = BLURPLE, always — state is expressed via badges/fields. Semantic colors are reserved for outcome/alert surfaces: SUCCESS (completed action with payload worth an embed), WARNING (destructive confirmation, degraded-service notice), ERROR (failure detail). Kills the current drift (red deny lists, green-if-keys-exist wallet, state-flipping voice browse). No INFO color needs adding — BLURPLE is the info color.

### 2.4 List row grammar (one format)

```
**{n}.** {badges} **{name}** (`{tech-id}`)
   └ {metadata · separated · by · middots}
```

- Numbering always (`**N.**` bold) — the select menu references items by number, so rows must show it.
- Name bold; **tech-id shown only when users type it somewhere else** (character slugs — typed in @mentions — yes; memory UUIDs, preset ids — no; those live in the detail view). Council catch: an id in every row trains non-technical users to skim past a chunk of the UI.
- Second line optional, `└`-prefixed, `·` separators (retire `•`, `→`, and `—`-as-separator).
- **Density guardrails (mobile-first)**: metadata line has a max length and truncates with `…`; a row must survive a narrow phone viewport without the name wrapping away from its number. Emoji augment meaning, never carry it alone — the text of a row must be self-sufficient with every glyph stripped (screen-reader vocalization treats each emoji as a word).
- Exemplars merged: models/preset rows (numbering + `└`) + character rows (badge + name + slug).
- **Empty-list state (council catch, 2×)**: a zero-result browse is a designed surface, not a bare "0 found" — BLURPLE embed, one sentence of orientation, and the CTA command (`You haven't created any characters yet — start with \`/character create\``). Filter-produced emptiness names the filter ("No private characters match — clear the filter to see all").

### 2.5 Empty values, timestamps, typography

- **Empty value sentinel**: `_Not set_` — everywhere (`_Not configured_`, `—`, `_none_`, `N/A` retired). Temporal never-happened may use `Never` (e.g., "Last used: Never").
- **Timestamps**: Discord dynamic timestamps only — `<t:unix:R>` for recency/activity ("3 days ago"), `<t:unix:D>` for creation/long dates. The only timezone-correct, self-updating form; currently used in just 3 of ~20 date sites. Static `YYYY-MM-DD` allowed only inside file exports (attachments render no markup).
- **Typography**: bold = names/labels; backticks = ids, slugs, commands, literal input; italics = meta/hints/empty-sentinels; `·` = the inline separator.

## 3. Components

### 3.1 Browse (list) — exemplar: character/preset browse

Composition: entity-title embed (BLURPLE) + rows per §2.4 + numbered select menu (act on item) + pagination row + filter/sort where applicable + badge legend footer via `joinFooter`. Completes part 1's G9 (shared list-embed + filter-row builder). The three display-only browses (apikey/voices/channel) gain select→action per the existing ideas entry.

### 3.2 Detail card — exemplar: character view (incl. its expand buttons)

- Field labels: `{emoji} {Label}` for top-level sections (character-view style); sub-values `**Label:** value`. Deny's zero-width-space grid hack replaced by the builder's layout.
- **Overflow rule (the expand mechanism, promoted)**: prose fields over their display limit are truncated with a per-field **📖 expand button** → `sendChunkedReply` (2000-char-aware ephemeral follow-up chunks; `utils/chunkedReply.ts`). **File attachments are reserved for machine-readable/structured payloads** (JSON, XML, tables) — never for prose a user wants to *read now*.
- Footer: ID + `<t:>` created/updated. Hints move to components (buttons) or description, not footers.

### 3.3 Dashboard — exemplar: character edit (gold standard)

What makes it good, now required for all dashboards: sections with status emoji (✅⚠️🔧❌) + preview text, select-to-edit-section, modal editing, refresh-in-place after save.
**Pagination-by-concern rule (new)**: a dashboard whose section count exceeds ~6 groups sections into concern pages with page navigation and a page indicator (`Page 2/3 · Memory`); the section select scopes to the current page. Aim for 3–6 settings per page — concern-purity yields to sanity when a concern has one setting (council: 4 pages for 11 settings over-fragments; a single-setting "Display" page is a click tax). Mechanism: `DashboardConfig` gains section groups (part 1 Phase 2). If a *persistent* (non-ephemeral) dashboard ever exists, it keeps an explicit Close — the removal rule below is for ephemeral surfaces only (all current dashboards are ephemeral).
**Close buttons removed from ephemeral dashboards** (native dismiss suffices). Teardown investigation (2026-07-04) verdict: all Redis-backed sessions (character/persona/preset dashboards, memory browse/search) auto-expire via 15-min SETEX TTL — native dismiss is harmless by design. ONE incomplete-teardown bug found, and it's live today regardless of Close buttons: `SettingsSessionStorage.ts`'s in-memory `sessionMetadata` Map (holds the non-serializable `updateHandler` closure) is deleted only on the explicit Close path — every native-dismissed settings/defaults dashboard strands a closure forever. Fix: the handler is code, not session state — resolve it from a static registry keyed by `entityType` and delete the Map (filed as a Quick Win; precondition for Close removal on the settings dashboards, none for the rest). The `batchDelete` collector is timeout-bounded — no issue.

### 3.4 Outcome messages (one shape per action class)

Current state: four coexisting shapes for "you did a thing." Rule:

| Action class | Shape |
| --- | --- |
| Simple set/clear/toggle | Plain content line from the catalog: `✅ **{Verb}** · {name}` (generalize `formatSuccessBanner`) — no embed |
| Dashboard-flow save | Refresh-in-place (no separate confirmation) — keep |
| Multi-field result (import, sync report) | SUCCESS embed with payload fields |
| Destructive completion | Plain catalog line + what was removed count |

**Pending states (council catch, 2×)**: the deferral ack ("thinking…") covers the first seconds; any operation expected to run beyond ~10s (imports, purges, voice cloning, db-sync) sends progress edits at meaningful stage boundaries (`🔄 Importing — memories (2/4)…`), and its completion message states the outcome per this table. The shapes-import progress tracking is the in-repo exemplar; codified as the pattern for every long op. **Ephemerality rule (codified — currently implicit but 100% followed)**: all command replies are ephemeral; the only public outputs are persona/webhook content and explicitly social messages.

Hand-rolled success embeds (10 files duplicating the helper's output) are retired onto the catalog in part 1 Phase 1.

### 3.5 Confirmation tiers

Per part 1 §4.4 (simple 2-button / typed-phrase), with Cancel→Danger order everywhere.

### 3.6 Modals — the form system

**Capability update (verified against Discord docs 2026-07-04; discord.js ^14.26.4 in-repo)**: modals now support far more than text inputs — **String Select, User/Role/Channel/Mentionable Select, Radio Group, Checkbox Group / Checkbox, File Upload, Text Display (instructional text), and Label** (wraps any input, carries a `description` — per-field help text). Hard limits that remain: Text Input ≤4000 chars; no in-modal pagination; no in-place modal updates; a modal submit cannot open another modal (chaining requires an intermediate button). Per-component discord.js support is verified at implementation time (radio/checkbox groups are the newest).

Rules:

1. **Right input type for the value type**: boolean → Checkbox; small enum → Radio Group (≤~5) or String Select; entity/user/channel target → the native Select (never a pasted ID); free text → Text Input; file → File Upload in-modal (import/avatar flows stop needing pre-supplied command options).
2. **Label descriptions are the inline documentation layer** — every non-obvious field carries one (placeholders alone are not docs; they vanish on focus).
3. **Text Display** for section intros/warnings inside forms (e.g., the typed-phrase confirmation's warning moves INTO the modal).
4. **"Pagination" = the wizard pattern**: section-scoped modals from a dashboard (the character-edit exemplar — already our invention for exactly this) or modal → ephemeral progress line + [Continue] button → next modal. Codified, not worked around.
5. **Preserve user input on validation failure**: a rejected submit re-offers the modal pre-filled with what the user typed (ephemeral error + "Try again" button that re-opens with their values). Losing typed input to a validation error is the single most hostile modal behavior; `ModalFactory` grows this as a standard affordance.

### 3.7 Primitives inventory — underused flourishes

The "maximize the building blocks" audit — capabilities Discord gives us that the surface barely uses:

| Primitive | Status today | Delight application |
| --- | --- | --- |
| **Context-menu commands** (right-click → Apps) | **Zero in the bot** | "Inspect Message" on any message — kills the copy-message-link/ID dance for `/inspect` entirely; candidates too: "View Character" on a webhook message |
| Select-option `description` (100 chars) + emoji | Sparse | Every select option carries context (preset model + tier, character preview line) — recognition without a round-trip |
| Native User/Channel selects (messages + modals) | Unused | `/deny` add/remove target picking (§4.5) |
| Modal Label descriptions | N/A (new) | §3.6.2 inline docs |
| `<t:>` dynamic timestamps | 3 of ~20 sites | §2.5 |
| Spoilers for technical detail | error-spoiler only | keep; already the exemplar |
| **Components V2 messages** (Container, Section+Thumbnail, Media Gallery, Separator, Text Display) | Unused | The literal "mini website" layout system — web-like pages inside Discord (character card with thumbnail section, avatar galleries). Tradeoff: the `IS_COMPONENTS_V2` flag disables `content`/`embeds` on that message — per-surface migration, not a global switch. **Posture: evaluation item, not a Phase 1–3 dependency** — the design system's tokens/grammar apply to either rendering; adopt V2 first on one high-value surface (character view) as the pilot when Phase 2 touches it |

### 3.8 Button vocabulary (council catch)

Style semantics, one rule set: **Primary (blurple)** = the surface's main action (Edit, Confirm-nondestructive); **Secondary (grey)** = navigation and tertiary actions (Back, Refresh, pagination, Cancel); **Danger (red)** = destructive, always last in the row (Cancel→Danger order per part 1); **Success (green)** = reserved, rarely used (avoid a second "primary"). Label + `.setEmoji()` separation stays law (04-discord). A button either acts immediately or opens a modal — its label says which (`Edit…` ellipsis convention for "opens a form").

## 4. Information architecture — command grammar

### 4.1 Verb set (canonical meanings)

| Verb | Meaning | Notes |
| --- | --- | --- |
| `browse` | list + search + act-on-item | `admin servers` description "List…" → "Browse…" (verb already right, description drifted) |
| `view` | read one entity in full | absorbs description-level "show"/"inspect" wording; `settings timezone get` → rename `view` |
| `stats` | read aggregates | keep |
| `status` | read a mode's on/off state | keep (focus/incognito) |
| `create` / `edit` / `delete` | entity lifecycle | `delete` = destroy one entity |
| `remove` | detach an entry from a list | deny remove, apikey remove |
| `clear` | reset state; NEVER destroys entities | history clear (epoch — compliant), override clears (compliant); **`voice voices clear` violates it (destroys all voices) → rename `purge`** (council, unanimous: `delete-all` would invent a second destroy-all verb the table already assigns to `purge`) |
| `purge` | destroy-all with typed-phrase confirmation | memory purge keeps it; `voice voices purge` joins it; reserve for Tier-B confirmations |
| `set` / `set-default` | assign an override/default | keep |

Description verbs must match command verbs (a `clear` subcommand may not describe itself as "Remove…").

### 4.2 Option conventions

| Concept | One name | Replaces |
| --- | --- | --- |
| Entity selector | the entity noun (`character`, `persona`, `preset`, `model`, `voice`, `tts`) | keep — domain-named selectors are good ergonomics |
| Search text | `query` | — (already consistent) |
| Scope/type narrowing | `filter` | — |
| Capability narrowing | `capability` | — |
| Time window | `timeframe` | `period` (admin usage), `days` (admin cleanup), `duration` (incognito) |
| Raw Discord ID (last resort) | `target` + autocomplete wherever a candidate list exists | `server-id` stays (it IS specific); `/deny view` gains autocomplete from existing entries |

Selector descriptions unified: one shared phrasing per selector ("Which character", not five variants of "Character to update/edit/view/manage/export"). Option order: required first, then by importance to the user (standing audit criterion).

### 4.3 Noun taxonomy

- **character** = the AI entity (never "personality" in any user-visible string — internal name only).
- **persona** = the user's own identity presented to characters.
- **preset** = a saved model configuration.
- **memory** vs **history**: memory = long-term extracted knowledge; history = the conversation log. Already distinct; codify in descriptions.

### 4.4 Structural moves (the IA decisions)

1. **Overrides live under the entity they override, in an `override` group.** Today: character overrides → `/character overrides` ✓; persona override → `/persona override` ✓; TTS override → `/voice tts` ✓; **model-preset override → `/settings preset` ✗ (the outlier)**. Move to `/preset override set|clear|browse|set-default|clear-default`. `/settings` keeps account-level things only: apikey, timezone, defaults dashboard. (Kills the standing "/settings preset vs /preset" confusion.)
2. `settings timezone get` → `view` (verb table).
3. `voice voices clear` → `voice voices purge` (Tier-B typed-phrase confirm — it destroys entities; council-corrected from an earlier `delete-all` draft that contradicted the verb table).
4. Everything else keeps its home — the tree is structurally sound; the drift is naming and description-level.

### 4.5 `/deny` — named worst case, redesign

Problems: 7-option `add` with conditionally-relevant options (`channel` only for Channel scope, `character` only for Character scope), raw-snowflake `target` with no autocomplete, value-vocabulary leak (`PERSONALITY` as the Character scope value), silent non-owner denial on components ("This interaction failed" ghosts), red list embeds.

Redesign (single recommendation, upgraded by §3.6): **`/deny add` becomes a modal form** — User/Mentionable Select for the target (no more pasted snowflakes), Radio Group for scope, Checkbox for mute-mode, Text Input for reason, Text Display explaining scope semantics; Channel scope uses a Channel Select. `remove`/`view` gain autocomplete from existing denial entries. Plus: (a) internal values never leak into display (PERSONALITY → Character); (b) badges + BLURPLE list per §2; (c) non-owner component clicks get an ephemeral catalog line, never a "This interaction failed" ghost. Caveat: denying a server the bot shares no context with may still need a raw-ID path — keep a `target` fallback for that case only.

## 5. Discoverability

1. **Picker hygiene (verified against current Discord docs 2026-07-04)**: `setDefaultMemberPermissions('0')` on `/admin` and `/deny` hides them from non-admin members' pickers in all guilds ("If you don't have permission to use a command, it will not show up in the command picker"). Guild admins still see them; the runtime owner-gate remains authoritative. Optional per-guild tightening: user-type overwrite in Server Settings → Integrations (deny @everyone / allow owner). `contexts` keeps DM availability as the owner's escape hatch. `/preset global` (a subcommand group) cannot be hidden separately — permissions are per-command; it keeps runtime gating + "(Owner only)" description.
2. **Description style guide** (baseline is already good — verb-first, sentence case, no trailing period): no engineer jargon in descriptions (`resolved`, `detail card`, `dedup cache`, `extended context` → user words); "(Owner only)" exact casing standardized where it remains; ALL-CAPS emphasis reserved for irreversible destruction only (hard-delete, purge — current usage is actually correct; codify it).
3. **`/help`**: already fully runtime-generated (cannot go stale) — keep. Two hardening items: a tooling test that every command category exists in `CATEGORY_CONFIG` (kills the silent "📦 Other" fallthrough), and the hardcoded character-interaction footer moved to the catalog.
4. **Autocomplete as discovery**: selector autocompletes already carry badges — align badge glyphs with §2.2 so picker and embeds speak one language.

## 6. `/inspect` — per-field disposition + content audit

`/inspect` is all-users (with redaction layers) — it is part of the product surface, not an owner tool, and gets full design-system treatment.

**Entry point upgrade (D16)**: a message context-menu command — right-click any message → Apps → **Inspect Message** — replaces the copy-link/copy-ID dance as the primary path; `/inspect [identifier]` stays for UUID lookup and browse.

**Disposition table** (rule: prose → inline or expand-chunks; structured/machine-readable → attachment):

| View | Today | Spec |
| --- | --- | --- |
| Reasoning | inline <2k, else `.md` attachment | inline <2k; **else 📖 expand → `sendChunkedReply` chunked ephemerals**, capped at ~3 chunks (~6k chars) — beyond the cap, first chunks + the `.md` attachment as the overflow tail (council: an 8k-token trace as a message wall is its own density failure); keep size hint on the button |
| Full / Compact JSON | attachment | stays attachment (machine-readable) ✓ |
| System Prompt XML | attachment | stays attachment ✓ |
| Memory Inspector | `.md` table attachment + filter buttons | stays attachment (table) ✓ |
| Token Budget | `.txt` ASCII chart attachment | candidate for inline embed (it's short); low priority |
| Pipeline Health | `.md` attachment | stays attachment; **add per-step `durationMs`** (captured, currently dropped) |
| Quick Copy | inline | ✓ |

**Add** (captured in the payload, surfaced nowhere but Full JSON):
- **Input view** (new): `rawUserMessage`, attachment descriptions, voice transcript, referenced-message content — the "what did the model actually receive from me" question.
- **Model substitution flag**: embed shows requested model; `llmResponse.modelUsed` "may differ" — when it differs, show both prominently (silent substitution is invisible today; that's a diagnosis blind spot).
- Sampling params beyond temperature (topP/topK/maxTokens/penalties) — in the Model field or a config view.
- `postProcessing.finalContent` + `llmResponse.rawContent` — a "response before/after post-processing" view (diff-shaped diagnosis of extraction bugs).

**Trim**: the 🤖 "Family" line (code comments admit it's not the real provider — Upstream already exists); dead `reasoningDebug.hasReasoningTagsInContent` field (payload-side, part of the next diagnostic-schema touch).

## 7. Owner-surface fixes (first-class principle applied)

The five ranked rough spots + fixes (all flow through part-1 machinery):

1. `db-sync` dry-run preview: mid-structure `JSON.stringify(...).slice(0,1000)` code block → structured summary fields (counts per table) + full diff as `.json` attachment.
2. Raw `HTTP {status}` + raw error-body code blocks (usage/cleanup/db-sync + health/metrics variants) → catalog classifier output (outcome-honest, no transport internals; reference ID for log correlation).
3. `usage` silent top-5 caps → "…and N more" + full breakdown attachment (the `formatListForEmbedField` truncator already in db-sync is the in-repo exemplar).
4. Raw ISO timestamps (metrics, cleanup) → `<t:…:R>` per §2.5.
5. `/deny view` snowflake paste → autocomplete from existing denial entries.
6. Silent-deny ghosts (deny browse components, stale server-select) → ephemeral catalog line, never an unanswered interaction.

## 8. Exemplars ledger

| Surface | Verdict | Role |
| --- | --- | --- |
| `/character edit` dashboard | Gold standard | The bar: sections/status/preview/modal/refresh-in-place |
| `/character view` expand buttons | Gold standard | THE overflow pattern (§3.2) |
| `/admin servers` | Good | Proof owner surfaces can be first-class (pagination, select, `<t:>`) |
| `/help` | Good | Runtime-generated, stale-proof |
| shapes (stable 🔗) | Good | Entity-identity exemplar |
| `/deny` | Worst case | §4.5 redesign |
| defaults dashboard | Worst case (density) | §3.3 pagination-by-concern first application |
| `/inspect` | Mixed | §6 disposition pass |

## 9. Rollout (maps onto part 1's phases)

- **Part 1 Phase 1 (catalog)** carries: outcome-message shapes (§3.4), description/wording rules (§5.2), owner-surface error fixes (§7.2), deny ghost fixes.
- **Part 1 Phase 2 (components)** carries: list grammar + browse builder (§2.4/§3.1), detail card + expand promotion (§3.2), dashboard pagination-by-concern (§3.3), `/inspect` disposition (§6).
- **Part 1 Phase 3 (vocabulary + enforcement)** carries: verb/option renames (§4.1–4.4), entity emoji + badge registry adoption (§2.1–2.2), timestamps/sentinels sweep (§2.5), picker hygiene + registration (§5.1), deny redesign (§4.5).
- Renames are cheap: no-backward-compat rule + global re-registration; `/help` regenerates itself.

## 10. Decision table — ALL ADOPTED as recommended (owner, 2026-07-04)

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Entity emoji registry (§2.1) — owner criterion (2026-07-04): "not picky about which — consistent, and as obvious as possible; cater to the lowest common denominator." Obviousness is the selection test | Adopt table as written; council sanity-checks each glyph for obviousness |
| D2 | Badge glossary (§2.2) — 🔐 locked, 🔑 needs-key, ✅ active; 🌐 = public+global merged | Adopt |
| D3 | Browse titles drop "Browser" → plural noun (`🎭 Characters`) | Adopt |
| D4 | Informational embeds always BLURPLE (§2.3) | Adopt |
| D5 | List row grammar (§2.4) — numbered, `└` metadata, `·` separator | Adopt |
| D6 | `_Not set_` sentinel + `<t:>` timestamps everywhere (§2.5) | Adopt |
| D7 | Outcome shapes (§3.4) — plain line for simple acts, embeds only with payload | Adopt |
| D8 | Move model-preset overrides `/settings preset` → `/preset override` (§4.4.1) | Adopt (kills the split-brain) |
| D9 | `voice voices clear` → `purge` + typed-phrase confirm (council-corrected: reuse the table's destroy-all verb, don't mint `delete-all`) | Adopt |
| D10 | Time-window option name → `timeframe` everywhere | Adopt |
| D11 | Picker hygiene: `default_member_permissions('0')` on `/admin` + `/deny` (§5.1) | Adopt; optionally add per-guild user-overwrite in home guild |
| D12 | `/inspect` reasoning >2k → chunked ephemerals (§6) + Input view + model-substitution flag | Adopt |
| D13 | `/deny` redesign shape (§4.5) | Adopt as specified |
| D14 | Dashboard pagination-by-concern for the defaults dashboard: 11 settings today (`settingsConfig.ts`) → 3 concern pages: Memory (Focus, Cross-Channel, Share, Relevance, Limit) · Context & Display (Max Messages/Age/Images, Model Footer) · Voice (Transcription, Response Mode). Council-adjusted from 4 pages — a single-setting Display page was a click tax. Threshold: paginate past ~6, aim 3–6 per page | Adopt the 3-page grouping |
| D15 | Modal form toolkit (§3.6): right-input-per-type (checkbox/radio/selects/file in modals), Label descriptions as inline docs, preserve-input-on-validation-failure | Adopt |
| D16 | Context-menu command "Inspect Message" (right-click → Apps) — first context-menu command in the bot | Adopt (biggest single `/inspect` ergonomics win) |
| D17 | Components V2 posture: not a Phase 1–3 dependency; pilot on character view when Phase 2 touches it | Adopt posture |
| D18 | Remove Close buttons from all ephemeral dashboards; ~~precondition: the `SettingsSessionStorage` closure leak~~ **precondition SATISFIED 2026-07-05** — the leak fix shipped (write-only handler Map deleted outright; no registry needed). D18 is unblocked | Adopt |
| D19 | Empty-list states as designed surfaces with CTAs (§2.4) | Adopt |
| D20 | Pending-states pattern for >~10s ops + ephemerality rule codified (§3.4) | Adopt |
| D21 | Button style vocabulary (§3.8) | Adopt |

## 11. Council pass (2026-07-04 — GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max)

**Folded in** (convergent findings): the entity↔badge collision rule + 👥/💳 reassignments (all three caught my own spec violating one-glyph-one-meaning); conditional tech-id in rows; density guardrails + emoji-augment-never-carry (screen-reader vocalization); empty-list CTA states (2×); pending-states pattern (2×); `voice voices purge` not `delete-all` (unanimous — my draft contradicted its own verb table); defaults dashboard 4→3 pages; reasoning chunk cap ~3 + attachment overflow tail; page indicators; word-first legends; button vocabulary; ephemerality rule codified; persistent-dashboard Close caveat.

**Rejected, with evidence**: Qwen's `default_member_permissions('0')` correction ("admins must manually enable") — contradicted by the Discord docs fetched this session: *"Setting it to '0' will prohibit anyone in a guild from using the command unless a specific overwrite is configured or the user has admin permissions."* `'0'` stays. Qwen's "Text Display not confirmed in modals" — it's in the current modal component list (same fetch); the per-component implementation-time verification caveat already covers drift. Qwen's `browse`→`list` rename — in-repo evidence beats the claimed convention: `browse` is this bot's universal verb (10/14 groups; `list` is the single outlier) and these are interactive filter/select views. Kimi's precise-permission-bits refinement (Moderate Members for `/deny`) — misreads the gate: these are bot-owner commands, not guild-moderator features; `'0'` is the closest visibility approximation to the runtime gate, which stays authoritative. Kimi's copy-to-clipboard buttons — no such Discord primitive. Qwen's DM delivery for long reasoning — context switch mid-diagnosis, plus DM delivery has its own failure modes; chunk-cap + attachment tail instead.

**Filed, not folded**: onboarding/first-run flow (real gap, both Kimi + Qwen — but it's a feature design of its own, not a consistency rule; → `cold/ideas.md`, with empty-state CTAs (§2.4) covering the near-term need).
