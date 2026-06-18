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
  resolveSummonAnonymity,
  type RawAssemblyInputs,
  type ReferencedChannel,
  type ReferencedMessage,
  type ResolvedConfigOverrides,
  type SummonAnonymity,
  type UserService,
} from '@tzurot/common-types';
import { rewriteRawContent, type RewrittenContent } from './contentRewriter.js';
import { enrichRawReferences } from './referenceEnricher.js';
import type { ContextDataSource } from './types.js';

const logger = createLogger('ContextAssembler');

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
    // Step 2: persona + timezone + context epoch. An incognito summon has no
    // persona arm, so the OUTPUT persona is null and the epoch is skipped — a
    // channel-scoped anonymous poke must not be bound by the invoking user's
    // persona-scoped STM reset (see helper).
    const { summon, contextEpoch } = await this.resolvePersonaContext(
      jobContext,
      personality.id,
      user.userId
    );
    const activePersonaId = summon.kind === 'personal' ? summon.activePersonaId : null;
    const activePersonaName = summon.kind === 'personal' ? summon.activePersonaName : null;
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
    // skipped wholesale for an incognito summon to mirror the bot-side early
    // return (also avoids upserting mention users for an anonymous poke).
    const rewritten = await this.rewriteContent(summon, raw, personality);

    // Step 7: cross-channel history — own DB fetch, environment names from the
    // envelope's cache map (the worker can't ask Discord), shared wire mapper,
    // same budget as the channel-history dbLimit. The persona-scoping gate lives
    // in the helper, which narrows on the summon union (see its doc).
    const crossChannelHistory = await this.assembleCrossChannel(jobContext, personality, summon, {
      crossChannelEnabled: configOverrides?.crossChannelHistoryEnabled === true,
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
   * channel/server epoch to fall back to, so incognito applies none (maxAge is
   * the only bound). The persona is still resolved (its cache-populating read
   * is harmless), but the OUTPUT persona + its epoch lookup are bundled into
   * the returned `SummonAnonymity` — an incognito summon has no persona arm, so
   * the epoch is skipped and downstream can't read a persona that isn't there.
   */
  private async resolvePersonaContext(
    jobContext: JobContext,
    personalityId: string,
    internalUserId: string
  ): Promise<{ summon: SummonAnonymity; contextEpoch: Date | undefined }> {
    const personaResult = await this.deps.personaResolver.resolve(jobContext.userId, personalityId);
    // Anonymity (incognito), not framing (isWeighIn): a personal summon keeps its
    // persona + STM epoch even with weigh-in framing. The resolver owns the
    // `incognito ?? isWeighIn` default so it lives in exactly one place.
    const summon = resolveSummonAnonymity(jobContext, {
      activePersonaId: personaResult.config.personaId,
      activePersonaName: personaResult.config.preferredName,
    });
    const contextEpoch =
      summon.kind === 'personal'
        ? await this.deps.dataSource.getContextEpoch(
            internalUserId,
            personalityId,
            summon.activePersonaId
          )
        : undefined;
    return { summon, contextEpoch };
  }

  /**
   * Content rewriting through the shared kernels — an incognito summon passes
   * the raw content through untouched, avoiding mention-user upserts. A personal
   * summon rewrites mentions like a normal chat.
   */
  private async rewriteContent(
    summon: SummonAnonymity,
    raw: RawAssemblyInputs,
    personality: LoadedPersonality
  ): Promise<RewrittenContent> {
    if (summon.kind === 'incognito') {
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
    summon: SummonAnonymity,
    opts: {
      crossChannelEnabled: boolean;
      /** The narrowed current-channel id from assembleCore's guard. */
      excludeChannelId: string;
      limit: number;
      maxAgeSeconds: number | undefined;
      contextEpoch: Date | undefined;
    }
  ): Promise<CrossChannelHistoryGroupEntry[] | undefined> {
    // Cross-channel history and the persona are a unit: it's persona-scoped, so
    // it's enabled for ANY personal summon (including a personal weigh-in) and
    // impossible for an incognito one (no persona to scope it to). Narrowing on
    // `summon.kind === 'personal'` makes `summon.activePersonaId` non-null BY
    // TYPE below — "cross-channel with a null persona" is unrepresentable by
    // type, no runtime guard needed. Framing (`isWeighIn`) is
    // deliberately not part of this decision. Undefined when disabled/incognito
    // (payload parity with the bot path); [] when enabled but nothing eligible.
    if (!opts.crossChannelEnabled || summon.kind !== 'personal') {
      return undefined;
    }
    const groups = await this.deps.dataSource.getCrossChannelHistory({
      personaId: summon.activePersonaId,
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
