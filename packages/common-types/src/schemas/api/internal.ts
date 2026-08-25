/**
 * Internal API endpoints
 *
 * Service-to-service endpoints under /internal/. Not for user-scoped traffic.
 * Service-auth protected by the global middleware in api-gateway/src/index.ts.
 */

import { z } from 'zod';
import { loadedPersonalitySchema } from '../../types/schemas/personality.js';
import { forwardedOriginSchema, messageMetadataSchema } from '../../types/schemas/message.js';
import { guildMemberInfoSchema } from '../../types/schemas/discord.js';
import { SYNC_LIMITS } from '../../constants/timing.js';
import { DISCORD_SNOWFLAKE } from '../../constants/discord.js';
import { AccountExportJobStatusSchema } from './account.js';

// ============================================================================
// GET /internal/users/recent
// Returns Discord IDs of users with usage_logs activity in the last N days.
// Used by bot-client at startup to pre-populate the Discord.js DM channel
// cache (Layer 1 of the post-deploy DM-silence fix).
// ============================================================================

/**
 * Discord snowflake IDs are 17–20 digit strings per Discord's ID format spec.
 * Validating the format here catches DB corruption or test-data drift early
 * rather than letting bad IDs propagate to `client.users.fetch()` calls.
 *
 * Derives from DISCORD_SNOWFLAKE.PATTERN — the single canonical range. Two
 * disagreeing copies once meant the HTTP boundary accepted an id the
 * user-provisioning write guard refused.
 *
 * Exported for reuse by future schemas that need to validate Discord IDs
 * against the same canonical format.
 */
export const DiscordSnowflakeSchema = z.string().regex(DISCORD_SNOWFLAKE.PATTERN);

export const RecentUsersResponseSchema = z.object({
  discordIds: z.array(DiscordSnowflakeSchema),
  sinceDays: z.number().int().positive(),
});

// ============================================================================
// POST /internal/users/activity
// Fire-and-forget activity stamp for pure-client slash commands (e.g. /help)
// that never otherwise reach the gateway. Refreshes last_active_at and clears
// dm_undeliverable_since for the user, keyed by Discord ID (best-effort; a
// no-op when the user isn't provisioned yet). Mirrors the getOrCreateUser
// activity stamp — a raw UPDATE, so updated_at stays off the sync LWW resolver.
// ============================================================================

export const StampUserActivityRequestSchema = z.object({
  discordId: DiscordSnowflakeSchema,
});

export const StampUserActivityResponseSchema = z.object({
  /** True when a user row was updated; false when the user isn't provisioned yet. */
  stamped: z.boolean(),
});

// ============================================================================
// POST /internal/channel/dm-session/set
// Records active personality in a DM session. Called by bot-client after a
// multi-tag reply selects a personality; the gateway stores it so subsequent
// messages in the DM channel route to the same personality without re-running
// the tag-matching logic.
// ============================================================================

export const DmSessionSetRequestSchema = z.object({
  channelId: z.string(),
  personalitySlug: z.string(),
});

export const DmSessionSetResponseSchema = z.object({
  channelId: z.string(),
  personalitySlug: z.string(),
});

// ============================================================================
// POST /internal/guild-member-info
// Records a user's last-known guild membership (roles, colour, join date) so
// `<participants>` renders the same bytes on turns whose Discord fetch did not
// observe them. Called by bot-client's `guildMemberUpdate` listener, which is
// the only event-driven refresh source — every other one is opportunistic.
// ============================================================================

export const GuildMemberInfoRecordRequestSchema = z.object({
  guildId: DiscordSnowflakeSchema,
  discordUserId: DiscordSnowflakeSchema,
  info: guildMemberInfoSchema,
});

export const GuildMemberInfoRecordResponseSchema = z.object({
  /**
   * False when no user row matched the Discord id — an ordinary outcome, not
   * an error. A role change fires for every member of a guild, and the vast
   * majority have never used the bot; provisioning a row for each of them is
   * exactly what this endpoint must not do.
   */
  recorded: z.boolean(),
});

// ============================================================================
// GET /internal/conversation/message-personality (reclassified from /user/*)
// Looks up the personality that owns a given Discord message ID. Used by
// bot-client's reply-resolution path to route reply targeting correctly.
//
// Currently mounted at /user/conversation/message-personality but has no
// human-actor auth — it's a service-to-service lookup. The route manifest
// reclassifies it under /internal/* so the audience is explicit.
// ============================================================================

export const MessagePersonalityResponseSchema = z.object({
  personalityId: z.string(),
  // Personality display name is optional — the historical conversation_history
  // row may have only the personality UUID without the display-name denormalized.
  personalityName: z.string().nullable().optional(),
});

// ============================================================================
// POST /internal/conversation/assistant-message
// Persists the assistant conversation-history row after bot-client confirms
// Discord delivery. The gateway owns the write: it derives the assistant
// timestamp (user message + 1ms), the deterministic row UUID, and the token
// count — bot-client only reports what was delivered. Idempotent upsert: when
// the row already exists (the dual-write window, where bot-client's legacy
// Prisma write is authoritative), the gateway compares instead of writing and
// reports the match so divergence is observable.
// ============================================================================

export const PersistAssistantMessageRequestSchema = z.object({
  channelId: z.string().min(1),
  guildId: z.string().nullable(),
  personalityId: z.string().uuid(),
  personaId: z.string().uuid(),
  content: z.string().min(1),
  /** Discord message IDs of the delivered chunks, in send order. */
  chunkMessageIds: z.array(DiscordSnowflakeSchema).min(1).max(SYNC_LIMITS.MAX_MESSAGE_BATCH),
  /** ISO timestamp of the triggering user message; the assistant row is persisted at +1ms. */
  userMessageTime: z.string().datetime(),
  /**
   * The model's reasoning trace, persisted onto the history row so it outlives
   * the 24h diagnostic-log window. Absent when the model produced no trace.
   * Declared here deliberately: an undeclared key is stripped by the parse
   * below, which would leave the column null forever with no error — see the
   * sentinel-survival test in internal.test.ts.
   */
  thinkingContent: z.string().optional(),
});

export const PersistAssistantMessageResponseSchema = z.object({
  /** Deterministic conversation-history row ID. */
  id: z.string(),
  /** True when this call created the row; false when it already existed. */
  created: z.boolean(),
  /**
   * Present only when the row already existed: whether the existing row's
   * content and chunk IDs match this request. False = divergence between the
   * legacy write path and this endpoint — the burn-in signal.
   */
  matched: z.boolean().optional(),
});

export type PersistAssistantMessageResponse = z.infer<typeof PersistAssistantMessageResponseSchema>;

// ============================================================================
// POST /internal/conversation/user-message
// Persists the trigger user message BEFORE job submission. A user message is
// a Discord event, so the gateway (the Discord-event data authority) owns the
// write — called synchronously by bot-client pre-submission, which preserves
// strict ordering (the next message's history query always sees this row)
// with no locks. Content arrives final (text + attachment placeholders —
// placeholder assembly is Discord-domain and stays bot-side); the gateway
// derives the deterministic row UUID and token count from what it persists.
// Idempotent upsert-with-compare, same dual-write semantics as the
// assistant-message endpoint.
// ============================================================================

export const PersistUserMessageRequestSchema = z.object({
  channelId: z.string().min(1),
  guildId: z.string().nullable(),
  personalityId: z.string().uuid(),
  personaId: z.string().uuid(),
  /** Final content: user text + attachment placeholders, assembled bot-side. */
  content: z.string().min(1),
  /** The triggering Discord message ID. */
  discordMessageId: DiscordSnowflakeSchema,
  /** Structured references / forwarded flags / embed XML — the stored shape. */
  messageMetadata: messageMetadataSchema.optional(),
  /** ISO timestamp of the Discord message (becomes the row's createdAt). */
  messageTime: z.string().datetime(),
});

/**
 * POST /api/internal/conversation/forwarded-origin
 *
 * Backfills the recovered origin of a forwarded message onto an
 * already-persisted user row. Separate from the persist call because resolving
 * the original costs Discord REST round-trips, and doing that inline would put
 * them on the path that gates AI job submission.
 *
 * The row is addressed the same way the persist derives it — the id is a pure
 * function of (channelId, personalityId, personaId, messageTime) — so no
 * lookup and no id round-trip is needed.
 */
export const PatchForwardedOriginRequestSchema = z.object({
  channelId: z.string().min(1),
  personalityId: z.string().uuid(),
  personaId: z.string().uuid(),
  /** Same ISO timestamp the persist used; the row id derives from it. */
  messageTime: z.string().datetime(),
  /**
   * Tightened here rather than on `forwardedOriginSchema` itself, and the
   * asymmetry is load-bearing. That schema is also reached through
   * `messageMetadataSchema`, which `parseMessageMetadata` runs over every
   * STORED row — and it returns `undefined` for the ENTIRE blob on any
   * failure, so a `.datetime()` there would turn one malformed field into the
   * loss of `referencedMessages`, `embedsXml`, `voiceTranscripts` and
   * `reactions` alongside it.
   *
   * A write boundary has no such coupling: rejecting a bad inbound backfill
   * costs one unattributed quote. So strictness lives at the door, and reads
   * stay lenient.
   */
  forwardedFrom: forwardedOriginSchema.extend({
    timestamp: z.string().datetime().optional(),
  }),
});

export const PatchForwardedOriginResponseSchema = z.object({
  /** False when no row matched — an expected outcome, not an error. */
  updated: z.boolean(),
});

/** Shape intentionally identical to the assistant-message response. */
export const PersistUserMessageResponseSchema = z.object({
  id: z.string(),
  created: z.boolean(),
  matched: z.boolean().optional(),
});

export type PersistUserMessageResponse = z.infer<typeof PersistUserMessageResponseSchema>;

// ============================================================================
// POST /internal/conversation/sync
// Opportunistic edit/delete sync. bot-client ships the Discord snapshot it
// fetched for a channel+personality; the gateway runs the diff against DB
// state (detecting edited content and deleted messages) and applies the
// writes (content updates, soft-deletes). Replaces bot-client's
// direct-Prisma SyncExecutor path. Idempotent: re-posting an already-applied
// snapshot finds zero work.
// ============================================================================

export const ConversationSyncRequestSchema = z.object({
  channelId: z.string().min(1),
  personalityId: z.string().uuid(),
  observedMessages: z
    .array(
      z.object({
        discordMessageId: DiscordSnowflakeSchema,
        /** Raw Discord content. May be empty (e.g. voice messages). */
        content: z.string(),
        createdAt: z.string().datetime(),
      })
    )
    .min(1)
    .max(SYNC_LIMITS.MAX_DISCORD_ID_LOOKUP),
});

export const ConversationSyncResponseSchema = z.object({
  /** Messages whose content was updated (edit detected). */
  updated: z.number().int().nonnegative(),
  /** Messages soft-deleted (present in DB window, absent from the snapshot). */
  deleted: z.number().int().nonnegative(),
});

export type ConversationSyncResponse = z.infer<typeof ConversationSyncResponseSchema>;

// ============================================================================
// GET /internal/personality/load
// Routing read: resolves a personality by name/slug/alias/ID with the same
// access-control semantics as PersonalityService.loadPersonality. Used by
// bot-client's pre-job routing paths (mention parsing, reply resolution,
// channel activation) once those stop reading the DB directly. Not-found is a
// normal outcome (mention candidates mostly miss), so the response carries
// null rather than a 404.
// ============================================================================

export const LoadPersonalityInternalResponseSchema = z.object({
  personality: loadedPersonalitySchema.nullable(),
});

export type LoadPersonalityInternalResponse = z.infer<typeof LoadPersonalityInternalResponseSchema>;

// ============================================================================
// POST /internal/v1/routing-context
// Hot-path routing read: resolves the per-(user, personality) routing facts a
// message needs BEFORE the AI job is dispatched — internal user UUID, active
// persona (override → default cascade), persona display name, user timezone,
// and the STM context-epoch. Provisions the user + default persona on first
// contact (idempotent upsert keyed on discordId). Consolidated into one
// endpoint because the reads are sequentially dependent (UUID → cascade →
// epoch); per-read routes would cost ~4 serialized HTTP hops on the single
// most latency-sensitive path in the system. The persona cascade runs here,
// where Prisma is legal, instead of being reimplemented in bot-client.
//
// Versioned (/v1/) — the response is the routing contract bot-client depends
// on; evolve it additively only.
// ============================================================================

export const RoutingContextRequestSchema = z.object({
  /** Message author's Discord snowflake — the provisioning + cascade key. */
  discordId: DiscordSnowflakeSchema,
  /**
   * Discord username, for provisioning the user shell on first contact.
   * `.min(1)` enforces the caller contract — Discord usernames are always
   * non-empty, and an empty one would be stored verbatim as the user shell's
   * username.
   */
  username: z.string().min(1).max(255),
  /**
   * Display name, for seeding the default persona's name on first contact.
   * May legitimately be blank (a user without a global display name), so it is
   * intentionally NOT `.min(1)`-constrained.
   */
  displayName: z.string().max(255),
  /** True for bot authors; provisioning rejects them (returns 400). */
  isBot: z.boolean().optional(),
  /**
   * Target personality whose persona cascade to resolve. Always a deterministic
   * v5 UUID (`generatePersonalityUuid`), so the `.uuid()` constraint is exact —
   * the call-site (bot-client `MessageContextBuilder`) passes `personality.id`.
   */
  personalityId: z.string().uuid(),
});

export type RoutingContextRequest = z.infer<typeof RoutingContextRequestSchema>;

export const RoutingContextResponseSchema = z.object({
  /** Internal user UUID (FK for everything downstream). */
  userId: z.string().uuid(),
  /**
   * Resolved active persona (override → default cascade): a UUID, OR the empty
   * string for the system-default fallback (which the epoch lookup treats as a
   * non-matching key). The union encodes both cases so a malformed non-UUID,
   * non-empty id can't slip through.
   */
  personaId: z.union([z.string().uuid(), z.literal('')]),
  /** Persona display name; null when the cascade has no preferred name. */
  personaName: z.string().nullable(),
  /** IANA timezone; `getUserTimezone` falls back to 'UTC', so always present. */
  timezone: z.string(),
  /** STM context-epoch (last-reset) as ISO; null when no reset is recorded. */
  contextEpoch: z.string().datetime().nullable(),
});

export type RoutingContextResponse = z.infer<typeof RoutingContextResponseSchema>;

/**
 * One secret's rotation-ledger state, with overdue computed server-side so
 * the nag consumer never re-derives interval math.
 */
export const SecretRotationEntrySchema = z.object({
  /** Ledger key, e.g. 'byok-encryption-key'. */
  name: z.string().min(1).max(50),
  /** Last rotation as ISO datetime. */
  rotatedAt: z.string().datetime(),
  intervalDays: z.number().int().positive(),
  /** Days PAST the interval; 0 while still within it. */
  overdueDays: z.number().int().nonnegative(),
});

export const SecretRotationStatusResponseSchema = z.object({
  entries: z.array(SecretRotationEntrySchema),
  overdueCount: z.number().int().nonnegative(),
});

// ============================================================================
// GET /internal/retention/preview — purge-eligible cohort (Retention Phase 2)
// ============================================================================

/**
 * One purge-eligible user, with what would happen to the characters they own.
 * Read-only reporting: the preview mutates nothing.
 */
export const RetentionPreviewUserSchema = z.object({
  /**
   * Deliberately NOT snowflake-validated: the preview is a display-only
   * report, and a malformed stored id (a legacy row holds the literal
   * 'unknown') is a finding the report must SURFACE — snowflake validation
   * here crashed the CLI and silenced the daily nag on exactly that anomaly
   * the moment the bystander arm made the cohort non-empty. The notify
   * pipeline's recipient schemas stay strict; such rows never qualify there.
   */
  discordId: z.string().min(1).max(32),
  /**
   * Display-only identity token, rendered beside the id because `<@id>`
   * mentions often fail to resolve on mobile. Deliberately NOT `.min(1)`:
   * the same fail-open doctrine `discordId` above documents — nag delivery
   * outranks field validity, so a malformed or empty stored username must
   * never crash the CLI or silence the daily nag. The rendering surfaces
   * omit the token rather than reject the payload.
   */
  username: z.string().max(255),
  /** Inactivity anchor as ISO — last_active_at, or created_at when never stamped. */
  inactiveSince: z.string().datetime(),
  /**
   * Label precedence mirrors signal strength: `account_gone` (Discord 10013)
   * beats `unreachable`, which beats the reachable reasons — `grace_expired`
   * (warned, then silent through the whole grace window) and `bystander`
   * (never deliberately used the bot; purged without notice by owner call).
   */
  reason: z.enum(['unreachable', 'account_gone', 'grace_expired', 'bystander']),
  ownedCharacters: z.object({
    /** Nobody else has data on them — deleted with the account. */
    toDelete: z.number().int().nonnegative(),
    /** Other users have data on them — re-homed to the orphan sentinel (D11). */
    toReHome: z.number().int().nonnegative(),
  }),
});

export const RetentionPreviewResponseSchema = z.object({
  users: z.array(RetentionPreviewUserSchema),
  totals: z.object({
    eligibleCount: z.number().int().nonnegative(),
    userbaseCount: z.number().int().nonnegative(),
    /** Cohort as a percentage of the userbase, one decimal place. */
    percentOfUserbase: z.number().nonnegative(),
    charactersToDelete: z.number().int().nonnegative(),
    charactersToReHome: z.number().int().nonnegative(),
    /** Cohort exceeds the breaker's warning share — review before purging. */
    breakerWarning: z.boolean(),
    /** Reachable + inactive ≥180d, not yet warned — the notify cohort (Phase 3). */
    reachableToNotify: z.number().int().nonnegative(),
    /** Warned, grace window still running (any activity aborts the clock). */
    inGrace: z.number().int().nonnegative(),
    /** Warned, window expired, still silent — the grace_expired purge subset. */
    graceExpired: z.number().int().nonnegative(),
    /** Never deliberately used the bot — the silent-purge subset of the cohort. */
    bystander: z.number().int().nonnegative(),
  }),
});

export type RetentionPreviewResponse = z.infer<typeof RetentionPreviewResponseSchema>;

// ============================================================================
// POST /internal/retention/purge — erase ONE eligible account (Phase 2, D2)
// ============================================================================

/**
 * The purge acts on ONE user per call. A per-batch endpoint would exceed the
 * platform's ~60s request timeout partway through a cohort and leave a partial,
 * unrecorded purge; the CLI loops instead, and re-running it resumes.
 */
export const RetentionPurgeRequestSchema = z.object({
  /**
   * Same relaxation as the preview user schema: the id is a lookup key, not
   * a trust boundary (parameterized SQL + the in-tx eligibility re-check own
   * safety), and the operator must be able to purge a malformed-id row the
   * preview surfaced — that junk is precisely what the bystander arm sweeps.
   */
  discordId: z.string().min(1).max(32),
  /** Operator/run label recorded in the audit ledger. */
  runContext: z.string().max(200).optional(),
  /**
   * Proceed even though the cohort exceeds the hard-ceiling share of the
   * userbase. Deliberately separate from the CLI's `--force` (which only skips
   * the interactive prompt) so no single flag can wipe a quarter of the
   * userbase off one bad tracking signal.
   */
  breakerOverride: z.boolean().optional(),
});

export const RetentionPurgeResponseSchema = z.object({
  // Echoes the request's id — same relaxation, or purging a malformed-id row
  // would succeed server-side and then fail the client's response parse.
  discordId: z.string().min(1).max(32),
  /** `skipped` covers every normal no-op; only a thrown error is a failure. */
  status: z.enum(['purged', 'skipped']),
  /** Present when status is `skipped`. */
  reason: z.enum(['already_gone', 'no_longer_eligible', 'breaker_tripped']).optional(),
  /** Operator-facing explanation for a tripped breaker. */
  detail: z.string().optional(),
  charactersDeleted: z.number().int().nonnegative().optional(),
  charactersReHomed: z.number().int().nonnegative().optional(),
});

export type RetentionPurgeResponse = z.infer<typeof RetentionPurgeResponseSchema>;

// ============================================================================
// POST /internal/retention/reconcile-off-db — retry owed off-DB cleanup (D15)
// ============================================================================

/**
 * Replays the off-DB cleanup (avatar unlink) for audit-ledger rows whose
 * reconciliation is still owed, ONE BOUNDED BATCH per call — a backlog must
 * not run the whole queue inside one ~60s HTTP request. Idempotent — an
 * already-settled ledger is a zero-row no-op — so it is safe to run at the
 * end of every purge run. `remaining` counts rows the call did NOT attempt
 * (rows that failed in-batch stay queued but are not "remaining"); the CLI
 * loops while it is nonzero.
 */
export const RetentionReconcileOffDbResponseSchema = z.object({
  settled: z.number().int().nonnegative(),
  stillFailing: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
});

// ============================================================================
// POST /internal/retention/notify — enqueue warning-DM batches (Phase 3)
// ============================================================================

/**
 * Operator-driven (manual-approval doctrine, like the purge): resolves the
 * reachable-but-inactive cohort, enqueues warning-DM batches to the
 * retention-notify queue. Cross-run idempotency is the predicate itself
 * (retention_notified_at IS NULL) — re-running resumes where a run stopped.
 */
export const RetentionNotifyRequestSchema = z.object({
  /** Resolve and report the cohort without enqueuing anything. */
  dryRun: z.boolean().optional(),
  /**
   * Proceed past the hard-ceiling breaker share. Deliberately separate from
   * the CLI's `--force` (which only skips the interactive prompt) — same
   * two-flag discipline as the purge.
   */
  breakerOverride: z.boolean().optional(),
  /** Operator/run label (log context + the deterministic-jobId seed). */
  runContext: z.string().max(200).optional(),
});

export const RetentionNotifyCohortUserSchema = z.object({
  discordId: DiscordSnowflakeSchema,
  /** Inactivity anchor as ISO — last_active_at, or created_at when never stamped. */
  inactiveSince: z.string().datetime(),
});

export const RetentionNotifyResponseSchema = z.object({
  /** `refused_breaker` enqueues nothing; `empty` is the healthy steady state. */
  status: z.enum(['enqueued', 'dry_run', 'empty', 'refused_breaker']),
  cohortSize: z.number().int().nonnegative(),
  userbaseCount: z.number().int().nonnegative(),
  percentOfUserbase: z.number().nonnegative(),
  /** Cohort exceeds the warn share — expected ~15-18% on the first real run (zombie cohort). */
  breakerWarning: z.boolean(),
  batchesEnqueued: z.number().int().nonnegative(),
  /** Present when status is `refused_breaker`. */
  breakerDetail: z.string().optional(),
  /** The resolved cohort (who would be / was DMed) — the dry-run's whole point. */
  recipients: z.array(RetentionNotifyCohortUserSchema),
});

export type RetentionNotifyResponse = z.infer<typeof RetentionNotifyResponseSchema>;

// ============================================================================
// POST /internal/retention/notify/filter — send-time still-eligible re-check
// ============================================================================

/**
 * The notify analogue of the purge's TOCTOU re-check: of these users, which
 * are STILL notify-eligible? A user active since cohort resolution must not
 * be DMed a deletion warning. The worker calls this before every batch send
 * (throw-before-spend: a filter failure aborts the batch, never skips it).
 */
export const RetentionNotifyFilterRequestSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(50),
});

export const RetentionNotifyFilterResponseSchema = z.object({
  stillEligibleUserIds: z.array(z.string().uuid()),
});

// ============================================================================
// POST /internal/retention/notify/report — per-recipient delivery outcomes
// ============================================================================

/**
 * The worker reports each outcome immediately after the send attempt (a
 * mid-batch crash strands at most one row). `sent` stamps the grace clock;
 * 50278/50007 stamp dm_undeliverable_since and 10013 stamps
 * discord_account_gone_at (the re-route to the unreachable purge branch);
 * bot-level (20026) and transient outcomes stamp NOTHING — a quarantined bot
 * says nothing about the recipient.
 */
export const RetentionNotifyReportRequestSchema = z.object({
  outcomes: z
    .array(
      z.object({
        userId: z.string().uuid(),
        status: z.enum(['sent', 'failed_permanent', 'failed_bot_level', 'failed_transient']),
        /** Discord error code for failures (e.g. '50278', '10013'). */
        errorCode: z.string().optional(),
      })
    )
    .min(1)
    .max(50),
});

export const RetentionNotifyReportResponseSchema = z.object({
  /** Rows a stamp actually wrote — guarded no-ops (re-reports) contribute 0. */
  processed: z.number().int().nonnegative(),
});

// ============================================================================
// POST /internal/telemetry/command-event — one row per command invocation
// Emitted fire-and-forget by bot-client's dispatch choke points. Records THAT
// a command ran, never WHAT was said: no message content, no free text. The
// `context` bag is allowlist-filtered by the handler before insert, so a
// future caller cannot widen the recorded surface by adding a key here.
// ============================================================================

/** Coarse location class — deliberately not a channel id. */
export const CommandEventChannelKindSchema = z.enum(['guild', 'dm', 'thread']);

/** Invocation result class. `user_error` covers "the ask did not happen". */
export const CommandEventOutcomeSchema = z.enum([
  'ok',
  'user_error',
  'system_error',
  'rate_limited',
  'cancelled',
]);

export const RecordCommandEventRequestSchema = z.object({
  userId: DiscordSnowflakeSchema,
  /** Omitted for DM invocations. */
  guildId: DiscordSnowflakeSchema.optional(),
  channelKind: CommandEventChannelKindSchema,
  /** Dotted command path, e.g. "character.create". Matches the column cap. */
  command: z.string().min(1).max(100),
  characterId: z.string().uuid().optional(),
  outcome: CommandEventOutcomeSchema,
  /** A stable machine code — never a rendered message. */
  errorCode: z.string().max(100).optional(),
  latencyMs: z.number().int().nonnegative(),
  /**
   * Coarse technical tags. KEYS are accepted permissively here and narrowed
   * by the handler's allowlist: key-level rejection would turn a
   * telemetry-only mistake into a 400 on a fire-and-forget path, so the
   * handler drops unknown keys and still records the event.
   *
   * VALUES are restricted to scalars, and that half IS enforced here — a
   * nested object or array under an allowlisted key would sail past a
   * key-only allowlist carrying arbitrary content, so the shape has to close
   * at the boundary rather than in the strip.
   */
  context: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

/**
 * The write is unconditional, so `recorded` is always true — the field exists
 * because every manifest route needs an output schema for the typed client's
 * return inference, and an empty body would fail that parse. A failed insert
 * surfaces as a 500, not as `recorded: false`.
 */
export const RecordCommandEventResponseSchema = z.object({
  recorded: z.boolean(),
});

// ============================================================================
// POST /internal/export-smoke/start
// GET  /internal/export-smoke/status
//
// Weekly export-path smoke: drives the real account-export job pipeline
// (assembler → ZIP → download) against a system-reserved sentinel account
// (`ORPHAN_SENTINEL_DISCORD_ID`), never a real user. `start` snapshots
// expected row counts from the source DB so the smoke can assert the
// finished artifact's manifest against them; `status` polls the resulting
// export_jobs row by id. No human-actor semantics — service-auth only, like
// every other /internal/* route.
// ============================================================================

/**
 * The `ExpectedExportManifestInput` payload (see
 * `@tzurot/common-types/schemas/export/accountExportManifest`), minus
 * `directory` — the finished export artifact supplies `personality-
 * directory.json` itself, so the smoke doesn't need the gateway to echo it
 * back. `totals` is a convenience denormalization of the count maps for a
 * cheap sanity check before the smoke parses the full artifact.
 */
export const ExportSmokeExpectedCountsSchema = z.object({
  personas: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  characters: z.array(z.object({ id: z.string().uuid(), slug: z.string() })),
  conversationCountsByPersonalityId: z.record(z.string(), z.number().int().nonnegative()),
  memoryCountsByPersonalityId: z.record(z.string(), z.number().int().nonnegative()),
  factCountsByPersonalityId: z.record(z.string(), z.number().int().nonnegative()),
  totals: z.object({
    personas: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative(),
    conversations: z.number().int().nonnegative(),
    memories: z.number().int().nonnegative(),
    facts: z.number().int().nonnegative(),
  }),
  /** The sentinel is never a superuser — always false for the smoke's own row. */
  isSuperuser: z.boolean(),
});

/** No request body — `.strict()` so a stray field is a parse error, not a silent no-op. */
export const ExportSmokeStartRequestSchema = z.object({}).strict();

export const ExportSmokeStartResponseSchema = z.object({
  exportJobId: z.string().uuid(),
  expectedCounts: ExportSmokeExpectedCountsSchema,
});

export const ExportSmokeStatusRequestSchema = z.object({
  jobId: z.string().uuid(),
});

export const ExportSmokeStatusResponseSchema = z.object({
  // The DB column is untyped varchar, but the smoke's own wire contract pins
  // the known values — a typo'd status should fail parse loudly here rather
  // than silently poll until the scheduler's timeout.
  status: AccountExportJobStatusSchema,
  downloadUrl: z.string().nullable(),
});
