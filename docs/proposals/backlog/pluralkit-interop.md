# PluralKit Interop — Design

> **Status**: ACCEPTED 2026-07-05 — trio council pass (lookup-paradox rebuild + phase reorder folded, §7); owner sign-off 2026-07-05
> **Theme**: [`user-requested-features.md`](../../backlog/cold/themes/user-requested-features.md) (owner request 2026-07-05: system import/sync + stable identity + proxied-message pairing) · Sibling artifact: [`message-actions.md`](message-actions.md) (shared grounding wave)
> **Grounding** (2026-07-05): PK API verification (message-lookup endpoint, member model, privacy, rate limits) · our proxy-handling trace (`isProxyMessage` = producer-less scaffolding reaching PromptBuilder; `BotMessageFilter` drops all proxied messages; extended context includes them name-only; participants/memories exclude them) · v2 legacy PK handling doc (delete/repost dance) · `ShapesPersonaMapping` precedent.

## 1. Today's reality (verified)

PK-proxied messages **cannot trigger characters** (`BotMessageFilter` drops webhook/bot authors before anything runs). In extended context they appear as `role: user` with **name-only identity** (webhook display name; the shared webhook ID as pseudo-id — unstable across renames, collides across members). They're **excluded from participants** and **accrue no memories**. The `isProxyMessage` flag is dormant scaffolding: schema → job payload → `PromptBuilder` real-speaker prefix, with **no producer anywhere**. The only live PK code is reply-reference classification via `KNOWN_PROXY_APP_IDS`.

**PK API facts (verified)**: `GET /messages/{webhook_msg_id}` — anonymous, indefinite retention, dedicated 10/s limit — returns the **real sender's Discord account ID** + full member/system objects. Member **`uuid` is the lifetime-stable key** (the 5–6-char `hid` can be admin-rerolled and recycled after deletion — never key on it). A system is addressable **by its owner's Discord snowflake** (no copy-paste for public systems; `pk;token` for private). Export files carry the same data as the live API — import-by-API is primary, file import unnecessary.

## 2. Decisions

### D1. Identity model: mapping table keyed on PK member UUID

`PkMemberPersonaMapping` following the `ShapesPersonaMapping` precedent:

```prisma
model PkMemberPersonaMapping {
  id           String   @id @default(uuid())
  /// PK member uuid — the lifetime-stable key (hid can be rerolled/recycled).
  pkMemberUuid String   @unique @db.Uuid
  pkSystemUuid String   @db.Uuid
  personaId    String   @unique
  persona      Persona  @relation(fields: [personaId], references: [id], onDelete: Cascade)
  /// Discord user who linked the system (must be a PK-verified account of that system).
  mappedBy     String   @db.VarChar(20)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([pkSystemUuid])
  @@map("pk_member_persona_mappings")
}
```

Display names live on the persona (`preferredName`) and survive PK renames because sync keys on uuid. Personas stay ordinary personas — editable, usable without PK, owned by the linking user (provisioned against the **real sender's Discord ID**, which is what #1464's human-users-only invariant requires; the webhook never gets a user row).

### D2. Link + import/sync: live API, explicit consent, per-member selection

`/pluralkit link` — resolves the invoker's system **by their own Discord snowflake**, which is simultaneously the proof-of-ownership (you can only link a system your account belongs to — Kimi's impersonation concern is structurally closed). Private systems prompt for a `pk;token` — **used for that invocation and discarded, never stored** (council: Qwen challenged necessity — public systems need no token at all; Kimi: don't hold the breach surface; storage reconsidered only if background auto-sync ever becomes a feature). Multi-account systems: any member account can link; personas are owned by the linking account (co-ownership across the system's accounts = deferred, trigger: a real system asks — GLM's lock-in caveat, documented not solved). Linking is the consent gate for identity **use**; see D3 for the honest lookup contract.

`/pluralkit import` — lists members (respecting member privacy: private fields arrive null and are skipped), user **selects which members become personas** (a system may have dozens; no bulk-create by default). Field mapping: `display_name ?? name` → persona name/preferredName, `description` → content seed, `pronouns` → pronouns. Avatar: personas have no avatar field — **not** added in v1 (personas don't render avatars anywhere today; revisit if a persona-avatar feature lands).

`/pluralkit sync` — re-fetch, diff by uuid, confirm before applying. Conflict rule (council-simplified from the draft's full three-way merge — 2:1 "a diff/merge UI is a bug farm at this scale"): **field-domain split** — identity fields (name/preferredName, pronouns) are PK-owned and sync PK-wins (shown in the diff); **persona `content` is seeded once at import and never auto-synced** — a changed PK description surfaces as "description changed — update content? [view diff]" requiring explicit confirmation, because content is where users invest RP-specific curation. The mapping row stores the last-synced PK member JSON (cheap snapshot, powers the diffs). Renames/deletions surface explicitly (deleted member → unlink-or-keep; kept personas note their PK member is gone — a recycled hid will NOT reconnect, uuid is the key).

### D3. Passive pairing: attribute proxied messages in context (council-rebuilt)

The draft's "no lookups for unlinked systems ever" was **self-contradictory** — all three council models caught it: a webhook message's system is unknowable without the lookup. The fixed mechanism is a **local prefilter, then lookup, then discard**:

1. Webhook message matches `KNOWN_PROXY_APP_IDS` → **local DB check**: does the webhook display name match a linked member's name/display-name (mapping table + synced member names)? No match → **no API call at all** (unlinked systems cost zero lookups in the common case and keep today's name-only behavior).
2. Name matches → `GET /messages/{id}` to confirm (protects against cross-system name collisions) → uuid mapped → the context message gets the **persona's identity** (personaName/personaId → the existing attribution machinery: langchainConverter speaker lines, participants section, and the `isProxyMessage` real-speaker prefix — the prompt mechanism is the existing one, now fed real identity), sender joins participants, memories accrue to the member's persona by construction. Uuid not mapped (collision) → discard immediately, negative-cache.
3. Guards (council, all three): in-process TTL cache per message id; negative cache per (webhook-name, channel); **negative caches invalidated on `/pluralkit link|import|sync`** (else a fresh link looks broken for the TTL); 429 backoff; every failure degrades to name-only — the PK API is never load-bearing for message flow.

Privacy contract, stated plainly: lookups fire only on a linked-member name match or rare collision; results for unlinked systems are discarded unused; unlinked users keep exactly the anonymity PK gave them. **This also forces the phase order: import must precede pairing** (the prefilter needs member names) — the council was unanimous the draft had it backwards.

### D4. Proxied triggers (Phase 3 — the full exclusion fix)

Let mapped members **invoke characters through their proxies**: detection → pairing → resolve sender → auth/session/BYOK as that user → generate, reply to the webhook message. The **delete/repost dance**: council split three ways (hold / hold+dedup / drop-originals-outright); synthesis = **hold ~2s + idempotency**: a message from a linked user matching their own synced `proxy_tags` is held ~2s — deleted (PK reposted) → the webhook copy is canonical; NOT deleted (PK down, autoproxy off, tag misfire) → process the original normally, **no lost triggers** (this safety property is why Qwen's zero-latency drop-the-original variant was declined for v1 — it loses the message on any PK misfire; noted as an optimization if the hold latency ever bothers anyone, it only affects proxy-tagged messages that also invoke characters). Belt-and-braces idempotency key on (sender, content-hash, channel, short window) kills any residual double-response (Kimi). PK-side `pk;edit`/deletes of proxied messages reconcile via the existing heal-on-read machinery, same as human edits (live context fetch picks up edits immediately; persisted trigger rows heal on next sync pass). Rate limits: trigger-path lookups share the 10/s bucket — queue with jitter + backoff; degrade to not-a-trigger, never to a hang.

### D5. What stays out

Groups/switches/fronting (import members only — fronter-awareness is a fascinating v2+ with a real trigger: a plural user asks for it) · autoproxy awareness · Tupperbox interop (same architecture would extend; PK first, trigger: demand) · writing anything back to PK (read-only integration, forever — their data, our copy).

## 3. Command surface

`/pluralkit link | import | sync | unlink | status` — spelled out (design-system: no jargon abbreviations in command names; "PluralKit" is the product's name). All ephemeral, design-system patterns (browse-select for member import, diff-confirm for sync, destructive-confirm for unlink).

## 4. Phasing

| Phase | Contents | Value |
| --- | --- | --- |
| **1 — link + import/sync** | `/pluralkit link/import/sync/unlink/status`, mapping table, proxy-tag + member-name storage (council-reordered: pairing's prefilter needs these) | Personas match the system |
| **2 — passive pairing** | D3 prefilter+lookup in context assembly, `isProxyMessage` producer, participants + memory attribution | Scene fidelity: characters know who's speaking |
| **3 — proxied triggers** | D4 (hold+idempotency dance, auth-as-sender) | Plural users no longer excluded from invoking characters |
| **v2+ (triggered)** | Fronting awareness · Tupperbox (the KNOWN_PROXY_APP_IDS path stays a clean no-op for it meanwhile) · persona avatars · co-ownership | |

## 5. Interactions with accepted designs

Prompt-assembly: paired messages are attributed user-role speakers (its multi-party mapping handles them; the real-speaker prefix is its S-tier text). Memory: persona scoping + the social matrix apply unchanged — a mapped member IS a persona. Message-actions: the Info card on a proxied-adjacent turn can show the member attribution. #1464: strengthened, not weakened — the human sender is the account of record everywhere.

## 6. Open calls — post-council status

| # | Call | Resolution |
| --- | --- | --- |
| 1 | Consent boundary | **Rebuilt** (draft was self-contradictory, all 3 caught it): local name-prefilter → lookup → discard-if-unlinked; privacy contract stated in D3 — **CONFIRMED 2026-07-05** |
| 2 | Sync conflict | **Field-domain split** (identity PK-wins; content seed-once + manual-confirm) — simpler than the draft's three-way merge, per council 2:1 — **CONFIRMED 2026-07-05** |
| 3 | Phase order | **Import first — unanimous** (draft had it backwards; pairing needs mappings + names) |
| 4 | Trigger dance | **Hold ~2s + idempotency** (safety over Qwen's zero-latency drop — no lost triggers on PK misfire) — **CONFIRMED 2026-07-05** |
| 5 | Tokens | **Never stored** (per-invocation use + discard; public systems need none) — **CONFIRMED 2026-07-05** |

## 7. Council record (2026-07-05 — GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max)

The lookup-paradox catch (all three) forced D3's rebuild and the phase reorder — the round's load-bearing correction. Also adopted: negative-cache invalidation on link (GLM+Kimi); rate-limit guards + PK-API-never-load-bearing degradation (Kimi+Qwen); snapshot-on-mapping-row for diffs; link-by-own-snowflake as proof-of-ownership (Kimi's impersonation concern); system-owner lock-in documented (GLM); PK-side edit/delete reconciliation via heal-on-read (Qwen — mostly a non-issue since context is live-fetched, noted explicitly); prompt-injection mechanism named explicitly (Qwen — it's the existing attribution machinery, fed real identity).
