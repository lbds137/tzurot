/**
 * Raw assembly envelope schemas.
 *
 * The raw Discord-origin inputs bot-client ships so ai-worker's context
 * assembler can re-derive the LLM context worker-side. During burn-in these
 * ride ALONGSIDE the legacy assembled payload (behind CONTEXT_RAW_ENVELOPE);
 * at cutover the legacy assembled fields stop shipping and this object (plus
 * the always-Discord fields like attachments and environment) becomes the
 * job's context source.
 *
 * Everything in here is Discord-origin or pure-computed — no DB-derived data.
 */

import { z } from 'zod';
import {
  attachmentMetadataSchema,
  discordEnvironmentSchema,
  guildMemberInfoSchema,
} from './discord.js';
import { apiConversationMessageSchema, referencedMessageSchema } from './message.js';

/**
 * A Discord user observed in raw assembly inputs (mention targets,
 * extended-context authors, reactors) — the minimal fields the worker-side
 * assembler needs to re-run user upserts and persona resolution.
 */
export const rawDiscordUserSchema = z.object({
  discordId: z.string(),
  username: z.string(),
  displayName: z.string(),
  isBot: z.boolean().optional(),
});

/**
 * A channel referenced via `<#id>` in the message content — name (and topic,
 * for the referencedChannels context block) resolved from the guild cache at
 * capture time, since the worker cannot resolve Discord names itself.
 */
export const rawMentionedChannelSchema = z.object({
  channelId: z.string(),
  channelName: z.string(),
  topic: z.string().optional(),
  guildId: z.string().optional(),
});

/**
 * A role referenced via `<@&id>` in the message content — resolved from the
 * guild cache at capture time. Roles have no other envelope source (unlike
 * channels, which the environment map also covers).
 */
export const rawMentionedRoleSchema = z.object({
  roleId: z.string(),
  roleName: z.string(),
  mentionable: z.boolean().optional(),
});

export const rawAssemblyInputsSchema = z.object({
  /**
   * The trigger message's EFFECTIVE text, before mention replacement and
   * [Reference N] link rewriting — message.content for a normal trigger, and
   * the forward snapshot text for a forwarded trigger (bot-client resolves this
   * via getEffectiveContent). The worker re-derives the current turn solely from
   * this field, so the forward snapshot text MUST be here — it is NOT carried by
   * rawReferencedMessages (the BFS crawler only captures fetchable message-id
   * references, never a forward's inline snapshot). EMPTY for voice triggers,
   * where the worker re-transcribes the shipped attachment itself (the bot-side
   * STT transcript rides rawRoutingTranscript, telemetry-only) — keeping the
   * voice transcript out of this field is what lets the shadow diff STT.
   */
  rawMessageContent: z.string(),
  /**
   * The bot-side STT transcript produced for routing (mention detection in
   * spoken text). TELEMETRY-ONLY: assembly ignores it — the prompt's
   * transcript comes from the worker's own transcription via the
   * attachment-description path — and the shadow diffs it against the
   * worker transcript to measure STT divergence. Consuming it for assembly
   * (skipping the worker STT) is a deliberate post-burn-in change gated on
   * that divergence data. ABSENT for non-voice triggers and when bot-side
   * STT produced nothing.
   */
  rawRoutingTranscript: z.string().optional(),
  /**
   * The author's effective display name (member nick ?? globalName ??
   * username) — feeds getOrCreateUser's persona naming for first-contact
   * users, which the worker-side assembler re-runs. Absent only from senders
   * predating this field (the assembler falls back to the username).
   */
  rawAuthorDisplayName: z.string().optional(),
  /**
   * message.mentions.users — targets for worker-side persona resolution +
   * content rewriting. Absent when the message mentions no users (mentions
   * are always observed on a Discord message, so unlike the extended-context
   * arrays below there is no ABSENT/EMPTY distinction here).
   */
  rawMentionedUsers: z.array(rawDiscordUserSchema).optional(),
  /** `<#id>` channel references found in the raw content, names from guild cache. */
  rawMentionedChannels: z.array(rawMentionedChannelSchema).optional(),
  /** `<@&id>` role references found in the raw content, names from guild cache. */
  rawMentionedRoles: z.array(rawMentionedRoleSchema).optional(),
  /**
   * Discord-fetched reply/link reference snapshots BEFORE DB enrichment:
   * no voice transcripts appended, no dedup-vs-history stubbing applied
   * (full content always), referenceNumber = crawl order (dedup-independent,
   * so the worker's own dedup decisions never renumber). Reuses the enriched
   * wire shape — the raw snapshot is the same fields minus DB additions.
   * ABSENT = reference extraction didn't run (weigh-in mode) or the sender
   * predates this field; EMPTY = extraction ran and found no references.
   */
  rawReferencedMessages: z.array(referencedMessageSchema).optional(),
  /**
   * Discord-fetched extended-context messages BEFORE the merge with DB
   * history. Array-field semantics (also for the two user lists below):
   * ABSENT = the extended-context fetch didn't run for this message;
   * EMPTY = the fetch ran and observed nothing. The shadow assembler treats
   * the two differently, so producers must not collapse [] to undefined.
   */
  rawExtendedContextMessages: z.array(apiConversationMessageSchema).optional(),
  /** Authors observed in extended context — inputs to the batch user upsert. */
  rawExtendedContextUsers: z.array(rawDiscordUserSchema).optional(),
  /** Users who reacted to extended-context messages (separate upsert batch). */
  rawReactorUsers: z.array(rawDiscordUserSchema).optional(),
  /**
   * Guild member info (roles, display color, join date) for extended-context
   * participants, keyed by the PRE-resolution placeholder id
   * (`discord:<authorId>`) exactly as the channel fetcher builds it — the
   * worker re-keys to persona UUIDs during its own persona resolution.
   * ABSENT = DM or the extended-context fetch didn't run; EMPTY = the fetch
   * ran in a guild but observed no member data.
   */
  rawParticipantGuildInfo: z.record(z.string(), guildMemberInfoSchema).optional(),
  /**
   * Image attachments observed across extended-context messages, UNCAPPED
   * (each carries sourceDiscordMessageId linking it to its message). The
   * worker applies the maxImages cap from its own resolved config — raw
   * inputs ship pre-decision. Deliberately a flat list rather than
   * per-message attachments on rawExtendedContextMessages: both the producer
   * (channel fetcher) and the consumer (vision preprocessing) use the flat
   * shape, and the per-message alternative would mutate the shared
   * conversation-history wire schema. ABSENT = fetch didn't run; EMPTY =
   * fetch ran and observed no images.
   */
  rawExtendedContextImageAttachments: z.array(attachmentMetadataSchema).optional(),
  /**
   * Voice attachments from extended-context messages whose transcript the bot
   * could NOT resolve at fetch time (aged out of the 5-min Redis cache, and no
   * bot transcript-reply was in the window). Each carries `sourceDiscordMessageId`
   * so the worker can re-resolve and inject the transcript: DB-first via
   * getMessageByDiscordId (the row content IS the transcript for persisted voice),
   * STT-fallback on the attachment url for never-persisted ambient voice. Shipped
   * only for the messages that need re-resolution — a cache HIT ships its
   * transcript on the message itself. ABSENT = fetch didn't run; EMPTY = fetch ran
   * and every voice message already had its transcript.
   */
  rawExtendedContextVoiceMessages: z.array(attachmentMetadataSchema).optional(),
  /**
   * Guild member info for the TRIGGERING user (message.member), the raw form
   * of activePersonaGuildInfo. Keyless scalar — no persona re-keying needed.
   * ABSENT = DM or member data unavailable.
   */
  rawActiveGuildMemberInfo: guildMemberInfoSchema.optional(),
  /**
   * Guild→channel environment map from the Discord.js cache, for decorating
   * worker-fetched cross-channel groups with names the worker can't resolve.
   * Keyed by channelId. Missing entries degrade to id-only location blocks.
   */
  knownChannelEnvironments: z.record(z.string(), discordEnvironmentSchema).optional(),
});

export type RawDiscordUser = z.infer<typeof rawDiscordUserSchema>;

export type RawMentionedChannel = z.infer<typeof rawMentionedChannelSchema>;

export type RawMentionedRole = z.infer<typeof rawMentionedRoleSchema>;

export type RawAssemblyInputs = z.infer<typeof rawAssemblyInputsSchema>;
