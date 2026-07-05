# Message-Action Affordances — Design

> **Status**: ACCEPTED 2026-07-05 — trio council pass (riders folded, §7); owner decisions locked (§6)
> **Theme**: [`user-requested-features.md`](../../backlog/cold/themes/user-requested-features.md) (user request 2026-07-03, PluralKit research mandated) · Sibling artifact: [`pluralkit-interop.md`](pluralkit-interop.md) (shared grounding wave)
> **Grounding** (2026-07-05): PluralKit source study (edit/reactions/reproxy mechanics, storage, authz) · Tupperbox/shapes.inc prior art · Discord platform verification (webhook edit PATCH unlimited-time; **buttons on application-owned webhook messages CONFIRMED**) · our infra map (webhook token retained, message ids persisted 3 ways, button routing wired, reaction infra absent, delete/edit reconciliation heal-on-read).

## 1. Surface decision: context-menu + ephemeral panel — not reactions

**Right-click persona message → Apps → "Message Actions" → ephemeral panel with action buttons.** Rationale:

- Our reaction infrastructure is absent (no intents/partials/listeners) while button+interaction routing is fully wired, and the design-system spec's D16 already commits to message context-menu commands (Inspect) — same registration, second command.
- PK's reaction grammar exists because PK predates components; shapes.inc *moved off* reactions to a menu once unconstrained. Reactions cost: intents + partials + a ManageMessages cleanup dance + guessable emoji vocabulary + anyone-can-react noise handling.
- Persistent buttons on every persona message = visual chrome on the entire roleplay surface — rejected for the same immersion reasons as the `/image` command (design-system D13 logic). The ephemeral panel gives typed affordances, built-in "who clicked", confirmations per the design-system's confirmation tiers, and zero chrome.
- **Reactions as PK-parity are a v2 option** (trigger: users habitually try reacting — measurable via the Info action's usage vs. reaction attempts if we ever listen).

Phase-0 spike (flagged by research): confirm component interactions on webhook-authored messages route to our app (expected; not doc-verbatim). If it fails, nothing changes — the panel is spawned by the context-menu command, not carried on the message.

## 2. The actions (v1 set)

| Action | Mechanics | Permission |
| --- | --- | --- |
| **Info** | Ephemeral card: character (current name + avatar even if the webhook shows a stale name — closes the stale-identity gap), triggered-by, when, model; link to `/inspect` when within its window | Anyone in the channel (PK's ❓ precedent) |
| **Delete** | `webhook.deleteMessage` (all chunks of the turn) + history soft-delete + tombstone + **memory propagation** per the accepted memory design (its Phase-0 `messageIds` linkage is the dependency) | Triggering user (via `personaId → Persona.ownerId`) or bot owner |
| **Regenerate** | Re-run generation for the trigger turn (context rebuilt fresh); delivery = **edit-in-place-first (owner-refined)**: same chunk count → edit every chunk (all ids survive); shrink → edit survivors + delete trailing orphans (chunk 1's id — the usual reply target — survives); grow → delete+resend (appended chunks would detach visually; atomicity wins). Best-effort sequencing with 404-heal on mid-flight failures. History updated + memory re-captured. **Window: rows carrying `triggerMessageId` (Phase-0 FK); 24h diagnostics fallback for pre-FK rows** | Triggering user or bot owner |
| **Edit** | Modal pre-filled with current content (design-system preserve-input rule) → webhook PATCH (chunk strategy as Regenerate) + history content update + `editedAt`/`editedBy` + memory re-capture. `allowed_mentions` stays hard-clamped | Triggering user or bot owner |

**Not in v1**: 🔔 ping (no analog — Info covers "whose scene"), regenerate-as-different-character (v2 with a real ask), reaction parity.

### Council hardening (2026-07-05, all adopted)

- **Concurrency**: one-in-flight lock per turn for Regenerate (double-click = "already regenerating"); interaction-expiry handling (ephemeral panels die at 15 min — every button click re-validates the message still exists and the actor still has permission, never trusts panel-open-time state).
- **404-heal**: any action hitting a Discord 404 (message manually deleted) marks the history row soft-deleted + tombstoned on the spot — the action layer becomes an opportunistic reconciler. A messageDelete listener remains out of v1 (heal-on-read + 404-heal cover the paths that matter; revisit if drift is observed in practice).
- **Webhook-token lifecycle**: the token is re-discoverable (`fetchWebhooks` — that's how the cache fills), so no DB persistence; the failure contract is explicit — 401/404 on PATCH → invalidate cache → re-fetch → retry once; webhook deleted entirely → **old messages are edit-orphaned** (a new webhook can't edit another webhook's messages) but Delete still works via bot ManageMessages; the panel reports edit-unavailable honestly.
- **Attribution**: history rows touched by Regenerate/Edit record who did it (`editedBy` alongside `editedAt`); a full audit table is deferred (trigger: a real dispute — same bar as the guild-settings history table).
- **Info stays anyone-visible** (PK ❓ precedent, friend-group context) — noted as a deliberate metadata-visibility call, not an oversight.

## 3. Supporting decisions

- **Message store**: no new store — the three existing paths cover it (Redis msgId→personality 7d; `conversation_history.discordMessageId[]` indefinite; diagnostic logs 24h). PK's lesson (indefinite mid→identity, no content) is already our DB shape. The DM fork: persona DMs are plain bot messages (`message.edit`) — `DiscordResponseSender`'s existing webhook-vs-DM fork extends to an action layer with a small unified "sent-message handle" helper (the infra map's gap #5).
- **Turn pairing**: v1 leans on the 24h diagnostic linkage for regenerate; the missing assistant↔trigger FK is filed as a schema-PR rider (populate a `triggerMessageId` on assistant history rows going forward — cheap, kills the adjacency heuristic for future messages).
- **Event-driven reconciliation stays out of scope**: manual Discord-side deletes/edits keep heal-on-read semantics (adding messageDelete/Update listeners is a separate decision with its own intent costs; the actions here are bot-mediated so they update history synchronously — no reconciliation lag for OUR actions).
- **UX per the design system**: destructive confirm tiers, catalog wording, outcome lines; the panel is an ephemeral surface (native dismiss, no Close button).

## 4. Adjacent-usability items (theme-mandated brainstorm — filed, not designed)

From the infra sweep: (1) jump-to-trigger link on Info (once `triggerMessageId` exists); (2) stale-webhook-name on old messages — Info mitigates; renames could optionally backfill recent messages via webhook edit (v2 flourish); (3) event-driven edit/delete listeners (separate decision, above); (4) the memory-propagation gap (owned by memory Phase 0); (5) unified sent-message handle (ships with this design).

## 5. Phasing

| Phase | Contents |
| --- | --- |
| **0** | Routing probe; **`triggerMessageId` column ships here** (council: prerequisite, not rider); unified sent-message handle |
| **1** | Context-menu command + panel; **Info + Delete** (+ 404-heal; memory propagation wired when memory Phase 0 lands) |
| **2** | **Regenerate** (FK-based window + concurrency lock) |
| **3** | **Edit** (modal; council 2:1 — its modal-UX + permission surface deserves its own phase) |
| **4+ (triggered)** | Reaction parity · regenerate-as-other-character · rename backfill · audit table · **edit-triggered auto-regenerate** (old owner note: "if I edit my message, will the bot edit the reply?" — needs the messageUpdate listener this design deferred; trigger: real friction with manual regenerate) |

## 6. Open calls — post-council status

| # | Call | Status |
| --- | --- | --- |
| 1+2 | **Edit/Delete permissions** | **OWNER DECIDED 2026-07-05: triggering user + bot owner ONLY, both actions** (GLM's position — the scene director + operator; character owners do not act on others' scenes). Symmetric, tight. |
| 3 | Regenerate window | **FK-first adopted** (council 2:1; diagnostics = fallback only) |
| 4 | Chunk strategy | **OWNER REFINED 2026-07-05: edit-in-place-first** — same-count edit all; shrink = edit + delete trailing; grow = delete+resend (atomicity). Supersedes the council's blanket delete+resend. |
| 5 | v1 set | **Edit deferred to its own phase — CONFIRMED** |

## 7. Council record (2026-07-05 — GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max)

Adopted: regenerate concurrency lock + interaction-expiry revalidation (GLM+Qwen); 404-heal on manual deletes (Qwen+Kimi); webhook-token failure contract incl. edit-orphaning honesty (Kimi+Qwen — Kimi's persist-encrypted suggestion declined: the token is re-fetchable, that's how the cache fills); FK-first regenerate (Kimi+Qwen); Edit → own phase (Kimi+Qwen); editedBy attribution, audit table trigger-deferred (Kimi). Cross-cutting (Kimi): PK-imported personas resolve `Persona.ownerId` to the linking human — message-action permission checks work unchanged on paired turns.
