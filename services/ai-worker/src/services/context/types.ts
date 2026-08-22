/**
 * ContextDataSource
 *
 * The seam through which ai-worker hydrates the DB-derived parts of a job's
 * message context itself, instead of trusting the bot-client-assembled
 * payload. Exists because bot-client must be Prisma-free: context assembly
 * relocates into ai-worker, which owns the AI/memory domain and therefore
 * owns context hydration.
 *
 * Scope boundary: only DB-DERIVED context comes through this interface
 * (conversation history, cross-channel history, user timezone, context
 * epoch). Discord-derived context (attachments, guild member info,
 * environment, live channel fetches) stays in the job envelope forever —
 * only bot-client can see Discord.
 *
 * All methods are READ-ONLY: this is the read seam for DB-derived context
 * only. Persona resolution and user upserts are deliberately excluded — they
 * run through their own services (UserService, PersonaResolver, wired into
 * ContextAssembler), keeping this interface a pure reader.
 */

import type {
  ConversationMessage,
  CrossChannelHistoryGroup,
} from '@tzurot/common-types/types/conversationMessage';
import type {
  ChannelHistoryWindowParams,
  ChannelHistoryWindowResult,
} from '@tzurot/conversation-history';
import type { GuildMemberInfo } from '@tzurot/common-types/types/schemas/discord';
import type {
  CrossChannelHistoryGroupEntry,
  ReferencedMessage,
} from '@tzurot/common-types/types/schemas/message';
import type {
  MentionedPersona,
  ReferencedChannel,
} from '@tzurot/common-types/types/schemas/personality';

export interface CrossChannelHistoryParams {
  /** Active persona whose other-channel conversations to fetch */
  personaId: string;
  /** Personality scope for the conversations */
  personalityId: string;
  /** Channel to exclude (the current conversation's channel) */
  excludeChannelId: string;
  /** Per-fetch message budget (mirrors the channel-history dbLimit) */
  limit: number;
  /** Optional staleness cutoff in seconds */
  maxAgeSeconds?: number | null;
  /** Optional context-reset epoch — messages before it are excluded */
  contextEpoch?: Date;
}

export interface ContextDataSource {
  /**
   * Channel conversation history as a hysteresis-quantized window (epoch,
   * maxAge, and trigger-message exclusion all applied DB-side, inside one
   * snapshot). Returns the telemetry alongside the messages — the window's
   * head row id is what makes the cache-stability claim checkable from logs.
   */
  getChannelHistoryWindow(params: ChannelHistoryWindowParams): Promise<ChannelHistoryWindowResult>;

  /** Cross-channel history groups for the active persona+personality. */
  getCrossChannelHistory(params: CrossChannelHistoryParams): Promise<CrossChannelHistoryGroup[]>;

  /**
   * Single history row lookup by Discord message id — the DB tier of voice
   * transcript retrieval (voice messages store their transcript as the row's
   * content). The bot-side path also has a Redis-cache tier; the worker is
   * DB-only, so cache-hit-only transcripts are an expected divergence source
   * during burn-in.
   */
  getMessageByDiscordId(discordMessageId: string): Promise<ConversationMessage | null>;

  /**
   * User row lookup by Discord id — the mention-resolution DB fallback for
   * mention ids absent from the envelope's target list (user not in a
   * shared server at capture time).
   */
  findUserByDiscordId(discordId: string): Promise<{ id: string; username: string } | null>;

  /** IANA timezone for an INTERNAL user id ('UTC' fallback). */
  getUserTimezone(internalUserId: string): Promise<string>;

  /**
   * Context-reset epoch for a user+personality+persona triple, or undefined
   * when the user never reset context for that pairing.
   */
  getContextEpoch(
    internalUserId: string,
    personalityId: string,
    personaId: string
  ): Promise<Date | undefined>;

  /**
   * Personality `name`s keyed by id, for the ids present. Used to remap
   * extended-context assistant attribution from the webhook display name (which
   * two personalities can share) to the more distinguishing — though not
   * unique — `name`. Missing/unknown ids are
   * simply absent from the map.
   */
  getPersonalityNamesByIds(ids: string[]): Promise<Map<string, string>>;

  /**
   * Generated roster blurbs keyed by personality id, for the ids present.
   *
   * ONLY renderable blurbs are returned. The column has three states — null
   * (never generated), `''` (generated, the card had nothing describable), and
   * real prose — and the first two render identically (name-only), so they are
   * collapsed into "absent from the map" here rather than at every reader.
   * `''` reaching a renderer that guards on null alone would emit an empty
   * description, which is the specific bug that collapse prevents.
   */
  getRosterBlurbsByIds(ids: string[]): Promise<Map<string, string>>;

  /**
   * Persisted user identities keyed by Discord message id, for relay-echo
   * recovery. A `/chat` relay-echo (the bot reposting user input as
   * `**Name:** …`) is bot-authored, so the extended-context fetch can't see the
   * human behind it — it arrives role=user with no personaId and the bot's
   * webhook name as discordUsername. But the same message was persisted with the
   * human's persona, so we recover it by discord message id. Only user-role rows
   * carrying a real persona are returned; unknown ids are simply absent.
   */
  getUserIdentitiesByDiscordIds(discordIds: string[]): Promise<Map<string, RelayEchoUserIdentity>>;
}

/** The human identity behind a persisted (relay-echo) user message. */
export interface RelayEchoUserIdentity {
  personaId: string;
  personaName: string;
  discordUsername: string;
}

/** The core surfaces the assembler re-derives. */
export interface AssembledCore {
  userInternalId: string;
  /** Null for an incognito summon — an anonymous poke has no invoking-user persona. */
  activePersonaId: string | null;
  activePersonaName: string | null;
  userTimezone: string;
  contextEpoch: Date | undefined;
  /** Hydrated DB history merged with envelope-carried extended context. */
  history: ConversationMessage[];
  /**
   * Enriched references re-derived from the envelope's raw snapshots
   * (dedup-vs-OWN-history + DB transcript append). Undefined when the
   * envelope carries no raw references (extraction didn't run bot-side —
   * weigh-in mode or a sender predating the field).
   */
  referencedMessages: ReferencedMessage[] | undefined;
  /**
   * The rewritten message content ([Reference N] links + mention names).
   * For an incognito summon this is the raw content untouched — the bot skips
   * all rewriting there, and mirroring that also avoids upserting mention users
   * for anonymous pokes.
   */
  messageContent: string;
  /** Personas resolved from user mentions; undefined when none (payload parity). */
  mentionedPersonas: MentionedPersona[] | undefined;
  /** Channels resolved from channel mentions; undefined when none (payload parity). */
  referencedChannels: ReferencedChannel[] | undefined;
  /**
   * Cross-channel history groups, decorated from the envelope's
   * knownChannelEnvironments (fallback env for cache misses) and serialized
   * through the shared wire mapper. Undefined when the feature is disabled
   * or the summon is incognito (payload parity with the bot path); [] when
   * enabled but nothing eligible was found.
   */
  crossChannelHistory: CrossChannelHistoryGroupEntry[] | undefined;
  /**
   * Extended-context participant guild info, re-keyed from the envelope's
   * pre-resolution `discord:*` map to persona UUIDs by the SAME shared
   * resolver call the bot uses. Undefined when the envelope carries no raw
   * map (DM, fetch didn't run, or a sender predating the field).
   */
  participantGuildInfo: Record<string, GuildMemberInfo> | undefined;
  /**
   * The triggering user's guild info, passed through from the envelope's
   * raw scalar. Unconditional (present even in weigh-in, mirroring the
   * payload: the bot clears the persona fields for weigh-in but ships this
   * one, where it's inert downstream because no active persona reads it).
   */
  activePersonaGuildInfo: GuildMemberInfo | undefined;
}
