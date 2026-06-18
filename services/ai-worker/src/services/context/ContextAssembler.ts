/**
 * Worker-side context assembler (core surfaces).
 *
 * Re-derives the DB-derived portion of the job context from the raw assembly
 * envelope + the worker's own Prisma access, mirroring bot-client's
 * MessageContextBuilder steps 1–4: user upsert, persona resolution, timezone,
 * context epoch, channel-history hydration, extended-context user batch
 * upserts + placeholder persona resolution (shared implementation), the
 * history merge (shared implementation), and reference enrichment
 * (dedup-vs-history + transcript append, shared kernels). Content rewriting
 * and cross-channel decoration land in the follow-on slices.
 *
 * Shared-implementation guarantee: `resolveExtendedContextPersonaIds`,
 * `mergeWithHistory`, and the reference-enrichment kernels are the SAME
 * common-types functions the legacy bot-side path calls, so the two paths
 * cannot drift during burn-in.
 */

import {
  buildFallbackEnvironment,
  createLogger,
  mapCrossChannelToApiFormat,
  mergeWithHistory,
  resolveExtendedContextPersonaIds,
  MESSAGE_LIMITS,
  type ConversationMessage,
  type CrossChannelHistoryGroupEntry,
  type GuildMemberInfo,
  type JobContext,
  type LoadedPersonality,
  type MentionedPersona,
  type PersonaResolver,
  type RawAssemblyInputs,
  type ReferencedChannel,
  type ReferencedMessage,
  type ResolvedConfigOverrides,
  type UserService,
} from '@tzurot/common-types';
import { rewriteRawContent, type RewrittenContent } from './contentRewriter.js';
import { enrichRawReferences } from './referenceEnricher.js';
import type { ContextDataSource } from './types.js';

const logger = createLogger('ContextAssembler');

/** The core surfaces the assembler re-derives. */
export interface AssembledCore {
  userInternalId: string;
  /** Null in weigh-in mode — an anonymous poke has no invoking-user persona. */
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
   * In weigh-in mode this is the raw content untouched — the bot skips all
   * rewriting there, and mirroring that also avoids upserting mention users
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
   * or the job is a weigh-in (payload parity with the bot path); [] when
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

/** Per-call assembly options (job-scoped values the deps can't carry). */
export interface AssembleCoreOptions {
  /**
   * Anchor for the reference time-fallback dedup window — the job's enqueue
   * timestamp. Undefined disables the time fallback (exact-id dedup only).
   */
  referenceDedupNowMs?: number;
}

export interface ContextAssemblerDeps {
  dataSource: ContextDataSource;
  userService: UserService;
  personaResolver: PersonaResolver;
}

/**
 * Convert an envelope-carried (wire-shape) extended-context message back to
 * the ConversationMessage shape the shared merge/resolution functions
 * operate on. Inverse of bot-client's toApiConversationMessage.
 *
 * The wire shape omits channelId/guildId (extended context is same-channel
 * by construction), so both are filled from the job here — `satisfies`
 * keeps the mapping structurally checked against ConversationMessage.
 */
function fromApiMessage(
  msg: NonNullable<RawAssemblyInputs['rawExtendedContextMessages']>[number],
  channelId: string,
  guildId: string | null
): ConversationMessage {
  return {
    ...msg,
    channelId,
    guildId,
    // id/personaId are schema-optional on the wire but always populated by
    // the bot-side fetcher; '' mirrors the shadow diff's own normalization
    // ('' ids are excluded from id-keyed diffs, personaIds compare via ?? '').
    id: msg.id ?? '',
    personaId: msg.personaId ?? '',
    // Discord messages always carry timestamps; epoch-0 is a defensive
    // fallback that sorts such a row first rather than crashing assembly.
    createdAt: msg.createdAt !== undefined ? new Date(msg.createdAt) : new Date(0),
    discordMessageId: msg.discordMessageId ?? [],
  } satisfies ConversationMessage;
}

export class ContextAssembler {
  constructor(private readonly deps: ContextAssemblerDeps) {}

  /**
   * Assemble the core surfaces. Throws on unexpected failures — the SHADOW
   * caller owns the never-throws contract, not the assembler (at cutover the
   * assembler's errors must surface as real job failures).
   */
  async assembleCore(
    jobContext: JobContext,
    personality: LoadedPersonality,
    configOverrides: ResolvedConfigOverrides | undefined,
    options?: AssembleCoreOptions
  ): Promise<AssembledCore> {
    const raw = jobContext.rawAssemblyInputs;
    if (raw === undefined) {
      throw new Error('[ContextAssembler] rawAssemblyInputs missing — envelope not enabled?');
    }
    const channelId = jobContext.channelId;
    if (channelId === undefined || channelId.length === 0) {
      throw new Error('[ContextAssembler] channelId missing from job context');
    }

    // Step 1: user upsert + persona resolution (the worker-side equivalent
    // of bot-client's resolveUserContext). displayName comes from the
    // envelope; falls back to the username for senders predating the field.
    const user = await this.deps.userService.getOrCreateUser(
      jobContext.userId,
      jobContext.userName ?? jobContext.userId,
      raw.rawAuthorDisplayName ?? jobContext.userName
    );
    if (user === null) {
      throw new Error('[ContextAssembler] getOrCreateUser returned null (bot author?)');
    }
    // Step 2: persona + timezone + context epoch. Weigh-in nulls the OUTPUT
    // persona AND skips the epoch — a channel-scoped summon must not be bound
    // by the invoking user's persona-scoped STM reset (see helper).
    const { activePersonaId, activePersonaName, contextEpoch } = await this.resolvePersonaContext(
      jobContext,
      personality.id,
      user.userId
    );
    const userTimezone = await this.deps.dataSource.getUserTimezone(user.userId);

    // Step 3: hydrate channel history — same limit derivation as the
    // bot-side dbLimit (and as the hydration shadow).
    const limit = Math.min(
      configOverrides?.maxMessages ?? MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
      MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT
    );
    const dbHistory = await this.deps.dataSource.getChannelHistory(
      channelId,
      limit,
      contextEpoch,
      configOverrides?.maxAge ?? undefined
    );

    // Step 4: envelope-carried extended context — batch-upsert the observed
    // users, resolve placeholder personaIds (shared impl, which also re-keys
    // the raw guild map to persona UUIDs), merge (shared impl). ABSENT raw
    // messages = the fetch didn't run bot-side.
    const { history, participantGuildInfo } = await this.mergeExtendedContext(
      raw,
      dbHistory,
      personality.id,
      {
        channelId,
        guildId: jobContext.serverId ?? null,
      }
    );

    // Step 5: re-derive reference enrichment from the raw snapshots —
    // dedup against the just-assembled history, transcripts from OWN DB.
    const referencedMessages = await this.enrichReferences(raw, history, options);

    // Step 6: content rewriting (links → user mentions → channels → roles),
    // skipped wholesale in weigh-in mode to mirror the bot-side early return.
    const rewritten = await this.rewriteContent(jobContext, raw, personality);

    // Step 7: cross-channel history — own DB fetch, environment names from
    // the envelope's cache map (the worker can't ask Discord), shared wire
    // mapper. Same budget as the channel-history dbLimit, mirroring the
    // bot-side fetchCrossChannelIfEnabled gate (disabled or weigh-in →
    // undefined, matching the payload's absent field).
    const crossChannelHistory = await this.assembleCrossChannel(jobContext, personality, {
      enabled:
        configOverrides?.crossChannelHistoryEnabled === true && jobContext.isWeighIn !== true,
      personaId: activePersonaId,
      excludeChannelId: channelId,
      limit,
      maxAgeSeconds: configOverrides?.maxAge ?? undefined,
      contextEpoch,
    });

    logger.debug(
      {
        userInternalId: user.userId,
        activePersonaId,
        dbCount: dbHistory.length,
        mergedCount: history.length,
        referenceCount: referencedMessages?.length,
        crossChannelGroups: crossChannelHistory?.length,
      },
      'Core context assembled'
    );

    return {
      userInternalId: user.userId,
      activePersonaId,
      activePersonaName,
      userTimezone,
      contextEpoch,
      history,
      referencedMessages,
      messageContent: rewritten.messageContent,
      mentionedPersonas: rewritten.mentionedPersonas,
      referencedChannels: rewritten.referencedChannels,
      crossChannelHistory,
      participantGuildInfo,
      activePersonaGuildInfo: raw.rawActiveGuildMemberInfo,
    };
  }

  /**
   * Resolve the persona and its context epoch. Weigh-in is an anonymous,
   * channel-scoped summon: the prompt must carry NO invoking-user persona, so
   * the OUTPUT persona goes null (mirroring the bot, which clears it in
   * chat.ts adjustContextForWeighIn). It must ALSO carry no context-epoch
   * cutoff — the epoch is the invoking user's persona-scoped STM-reset
   * (`/conversation reset`), which is the wrong granularity to bound a SHARED
   * channel the personality is asked to comment on. A recent personal reset
   * would otherwise silently truncate the channel history; there is no coarser
   * channel/server epoch to fall back to, so weigh-in applies none (maxAge is
   * the only bound). The persona is still resolved (its cache-populating read
   * is harmless), but its epoch lookup is skipped. Memory read/write skip is
   * gated separately by isWeighIn.
   */
  private async resolvePersonaContext(
    jobContext: JobContext,
    personalityId: string,
    internalUserId: string
  ): Promise<{
    activePersonaId: string | null;
    activePersonaName: string | null;
    contextEpoch: Date | undefined;
  }> {
    const personaResult = await this.deps.personaResolver.resolve(jobContext.userId, personalityId);
    const resolvedPersonaId = personaResult.config.personaId;
    // Anonymity (incognito), not framing (isWeighIn): a personal summon keeps
    // its persona + STM epoch even though it uses the weigh-in framing. Defaults
    // to isWeighIn so existing weigh-in jobs stay anonymous.
    const incognito = jobContext.incognito ?? Boolean(jobContext.isWeighIn);
    const contextEpoch = incognito
      ? undefined
      : await this.deps.dataSource.getContextEpoch(
          internalUserId,
          personalityId,
          resolvedPersonaId
        );
    return {
      activePersonaId: incognito ? null : resolvedPersonaId,
      activePersonaName: incognito ? null : personaResult.config.preferredName,
      contextEpoch,
    };
  }

  /**
   * Content rewriting through the shared kernels — incognito (anonymous) jobs
   * pass the raw content through untouched, avoiding mention-user upserts. A
   * personal summon (incognito=false) rewrites mentions like a normal chat.
   */
  private async rewriteContent(
    jobContext: JobContext,
    raw: RawAssemblyInputs,
    personality: LoadedPersonality
  ): Promise<RewrittenContent> {
    if (jobContext.incognito ?? Boolean(jobContext.isWeighIn)) {
      return {
        messageContent: raw.rawMessageContent,
        mentionedPersonas: undefined,
        referencedChannels: undefined,
      };
    }
    return rewriteRawContent({
      raw,
      rawReferences: raw.rawReferencedMessages,
      personalityId: personality.id,
      deps: {
        getOrCreateUser: (discordId, username, displayName, bio, isBot) =>
          this.deps.userService.getOrCreateUser(discordId, username, displayName, bio, isBot),
        resolvePersona: async (discordUserId, pid) => {
          const result = await this.deps.personaResolver.resolve(discordUserId, pid);
          return {
            personaId: result.config.personaId,
            preferredName: result.config.preferredName,
          };
        },
        findUserByDiscordId: discordId => this.deps.dataSource.findUserByDiscordId(discordId),
      },
    });
  }

  /**
   * Fetch + decorate + serialize cross-channel history. Environment names
   * come from the envelope's knownChannelEnvironments map; channels missing
   * from it (lazily-cached threads, post-capture renames) degrade to the
   * shared fallback environment — an accepted divergence vs the bot's
   * live-fetch decoration.
   */
  private async assembleCrossChannel(
    jobContext: JobContext,
    personality: LoadedPersonality,
    opts: {
      enabled: boolean;
      /** Null only in weigh-in mode, where `enabled` is always false. */
      personaId: string | null;
      /** The narrowed current-channel id from assembleCore's guard. */
      excludeChannelId: string;
      limit: number;
      maxAgeSeconds: number | undefined;
      contextEpoch: Date | undefined;
    }
  ): Promise<CrossChannelHistoryGroupEntry[] | undefined> {
    if (!opts.enabled) {
      return undefined;
    }
    // Invariant: cross-channel is disabled for weigh-in (the `enabled` flag
    // gates on isWeighIn), so a non-null persona always reaches here. Fail loud
    // if a future change decouples the two, rather than silently querying with
    // a bad id.
    if (opts.personaId === null) {
      throw new Error('[ContextAssembler] cross-channel enabled with a null persona');
    }
    const personaId = opts.personaId;

    const groups = await this.deps.dataSource.getCrossChannelHistory({
      personaId,
      personalityId: personality.id,
      excludeChannelId: opts.excludeChannelId,
      limit: opts.limit,
      maxAgeSeconds: opts.maxAgeSeconds,
      contextEpoch: opts.contextEpoch,
    });

    const envByChannelId = jobContext.rawAssemblyInputs?.knownChannelEnvironments ?? {};
    return mapCrossChannelToApiFormat(
      groups.map(group => ({
        channelEnvironment:
          envByChannelId[group.channelId] ??
          buildFallbackEnvironment(group.channelId, group.guildId),
        messages: group.messages,
      }))
    );
  }

  /**
   * Enrich raw reference snapshots (shared kernels) — undefined when the
   * envelope carries none (ABSENT = extraction didn't run bot-side).
   */
  private async enrichReferences(
    raw: RawAssemblyInputs,
    history: ConversationMessage[],
    options: AssembleCoreOptions | undefined
  ): Promise<ReferencedMessage[] | undefined> {
    if (raw.rawReferencedMessages === undefined) {
      return undefined;
    }
    return enrichRawReferences({
      rawReferences: raw.rawReferencedMessages,
      history,
      // DB lookup is per-message, not per-URL — the shared kernel passes
      // attachmentUrl but this retriever drops it (each voice message row
      // stores one transcript as its content).
      retrieveTranscript: async (discordMessageId: string) => {
        // DB tier only — the bot-side Redis-cache tier has no worker
        // equivalent (accepted burn-in divergence; the row IS the transcript
        // for persisted voice messages).
        const row = await this.deps.dataSource.getMessageByDiscordId(discordMessageId);
        return row?.content !== undefined && row.content.length > 0 ? row.content : null;
      },
      nowMs: options?.referenceDedupNowMs,
    });
  }

  /** Steps the envelope's extended context through upsert → resolve → merge. */
  private async mergeExtendedContext(
    raw: RawAssemblyInputs,
    dbHistory: ConversationMessage[],
    personalityId: string,
    location: { channelId: string; guildId: string | null }
  ): Promise<{
    history: ConversationMessage[];
    participantGuildInfo: Record<string, GuildMemberInfo> | undefined;
  }> {
    const rawMessages = raw.rawExtendedContextMessages;
    if (rawMessages === undefined || rawMessages.length === 0) {
      // No extended-context messages to merge, but the guild map can still be
      // present (e.g. {} = fetch ran in a guild, observed no member data).
      // Return the cloned unremapped map rather than undefined: with no
      // messages there are no `discord:*` keys to remap, so unremapped IS the
      // resolved form — and it preserves the ABSENT (undefined) vs EMPTY ({})
      // distinction the ContextStep adopt-guard depends on.
      return {
        history: dbHistory,
        participantGuildInfo:
          raw.rawParticipantGuildInfo !== undefined
            ? structuredClone(raw.rawParticipantGuildInfo)
            : undefined,
      };
    }

    const usersToResolve = [
      ...(raw.rawExtendedContextUsers ?? []),
      ...(raw.rawReactorUsers ?? []),
    ].map(u => ({
      discordId: u.discordId,
      username: u.username,
      displayName: u.displayName,
      // The envelope builder presence-encodes this field (isBot: true when a
      // bot, omitted otherwise), so absent ⇒ human — `?? false` reconstructs
      // the builder's contract exactly, not a lossy default.
      isBot: u.isBot ?? false,
    }));

    const messages = rawMessages.map(m => fromApiMessage(m, location.channelId, location.guildId));

    // The shared resolver remaps the guild map's `discord:*` keys to persona
    // UUIDs IN PLACE — clone so the job's envelope object stays pristine.
    // When no users resolve, the bot keeps its unremapped map; returning the
    // clone unremapped mirrors that exactly (parity by construction).
    const participantGuildInfo =
      raw.rawParticipantGuildInfo !== undefined
        ? structuredClone(raw.rawParticipantGuildInfo)
        : undefined;

    if (usersToResolve.length > 0) {
      const userMap = await this.deps.userService.getOrCreateUsersInBatch(usersToResolve);
      await resolveExtendedContextPersonaIds(
        messages,
        userMap,
        personalityId,
        this.deps.personaResolver,
        participantGuildInfo
      );
    }

    return { history: mergeWithHistory(messages, dbHistory), participantGuildInfo };
  }
}
