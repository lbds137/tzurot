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

import { MESSAGE_LIMITS, MessageRole } from '@tzurot/common-types/constants/message';
import { type ResolvedConfigOverrides } from '@tzurot/common-types/schemas/api/configOverrides';
import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import { type JobContext } from '@tzurot/common-types/types/jobs';
import {
  type AttachmentMetadata,
  type GuildMemberInfo,
} from '@tzurot/common-types/types/schemas/discord';
import {
  type CrossChannelHistoryGroupEntry,
  type ReferencedMessage,
} from '@tzurot/common-types/types/schemas/message';
import {
  type LoadedPersonality,
  type MentionedPersona,
  type ReferencedChannel,
} from '@tzurot/common-types/types/schemas/personality';
import { type RawAssemblyInputs } from '@tzurot/common-types/types/schemas/rawEnvelope';
import {
  resolveSummonAnonymity,
  type SummonAnonymity,
} from '@tzurot/common-types/types/summon-anonymity';
import {
  buildFallbackEnvironment,
  mapCrossChannelToApiFormat,
} from '@tzurot/common-types/utils/crossChannelEnvironment';
import { resolveExtendedContextPersonaIds } from '@tzurot/common-types/utils/extendedContextPersonaResolver';
import { mergeWithHistory } from '@tzurot/common-types/utils/historyMerger';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { fromApiMessage } from './fromApiMessage.js';
import type { PersonaResolver, UserService } from '@tzurot/identity';
import { rewriteRawContent, type RewrittenContent } from './contentRewriter.js';
import { enrichRawReferences } from './referenceEnricher.js';
import { recoverRelayEchoIdentities } from './relayEchoRecovery.js';
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
  /**
   * STT fallback for extended-context voice transcripts the DB-first lookup
   * misses (never-persisted ambient voice). Returns the transcript text, or
   * null on failure (expired CDN url, no usable provider). Built by ContextStep
   * with the resolved `sttDispatch`; passing it as a callback keeps the
   * assembler decoupled from the audio/STT machinery (mirrors how the reference
   * retriever is a callback). Absent ⇒ DB-only re-resolution.
   */
  reTranscribeVoiceViaStt?: (attachment: AttachmentMetadata) => Promise<string | null>;
}

/**
 * Upper bound on extended-context voice transcripts re-resolved per turn. The
 * DB-first tier makes most resolutions cheap lookups, but this caps the
 * worst-case fan-out (incl. the STT fallback) so it can't dominate assembly
 * latency on a channel with many aged-out voice messages. 10 is ~2× headroom
 * over the typical extended-context voice count (a handful per window); raise it
 * only if real rooms routinely exceed that and lose tail transcripts.
 */
const EXTENDED_CONTEXT_VOICE_REDERIVE_CAP = 10;

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
    // Exclude the trigger message from the assembled history. bot-client
    // persists it to the gateway BEFORE submitting this job (durability for the
    // next turn), and this hydration runs after — so the just-sent message is
    // already in the channel history. It is also delivered as the live user
    // turn, so without this filter it appears twice: once in the assembled
    // history and again as the current message. (The bot-side history fetch
    // reads before the persist and never saw it; the worker must drop it here.)
    //
    // Fetch one extra row when a trigger is present: it's always the newest row
    // in the window (just persisted), so filtering it from a plain `limit`
    // fetch would shrink history to limit-1 and drop the oldest message. The +1
    // keeps a full limit-deep window after the filter. (A rare no-match — the
    // trigger isn't in the DB — leaves limit+1, which is harmless.)
    const triggerMessageId = jobContext.triggerMessageId;
    const fetchLimit = triggerMessageId !== undefined ? limit + 1 : limit;
    const dbHistory = (
      await this.deps.dataSource.getChannelHistory(
        channelId,
        fetchLimit,
        contextEpoch,
        configOverrides?.maxAge ?? undefined
      )
    ).filter(
      msg =>
        triggerMessageId === undefined || !(msg.discordMessageId ?? []).includes(triggerMessageId)
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

    // Step 4.5: re-resolve transcripts for extended-context voice messages the
    // bot couldn't transcribe at fetch time (aged out of its Redis cache). The
    // transcript text the bot already produced lives in the DB for persisted
    // voice; STT only re-runs for never-persisted ambient voice. Mutates the
    // matching history messages in place before reference enrichment reads them.
    await this.injectExtendedContextVoiceTranscripts(
      history,
      raw.rawExtendedContextVoiceMessages,
      options
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

    // Extended-context assistant messages arrive attributed by webhook display
    // name (which two personalities can share). Remap to the unique name via the
    // bot-resolved personalityId so the chat log keeps them distinct.
    await this.remapExtendedContextPersonalityNames(messages);

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

    // Recover the human behind relay-echoes AFTER persona resolution (which strips
    // their unresolvable bot personaId to ''), so they re-unify with the human's
    // direct messages instead of fragmenting under the bot's webhook name.
    await recoverRelayEchoIdentities(messages, this.deps.dataSource);

    return { history: mergeWithHistory(messages, dbHistory), participantGuildInfo };
  }

  /**
   * Overwrite extended-context assistant messages' `personalityName` with the
   * unique personality name resolved from `personalityId`. The bot-side fetcher
   * can only derive the webhook display name, which two personalities may share;
   * the unique name is what disambiguates them in the chat log. Messages without
   * a resolved personalityId (registry miss) keep the display-name attribution.
   */
  private async remapExtendedContextPersonalityNames(
    messages: ConversationMessage[]
  ): Promise<void> {
    const ids = [
      ...new Set(
        messages
          .filter(m => m.role === MessageRole.Assistant)
          .map(m => m.personalityId)
          .filter((id): id is string => id !== undefined && id.length > 0)
      ),
    ];
    if (ids.length === 0) {
      return;
    }
    const nameById = await this.deps.dataSource.getPersonalityNamesByIds(ids);
    for (const message of messages) {
      if (message.role !== MessageRole.Assistant || message.personalityId === undefined) {
        continue;
      }
      const uniqueName = nameById.get(message.personalityId);
      if (uniqueName !== undefined && uniqueName.length > 0) {
        message.personalityName = uniqueName;
      }
    }
  }

  /**
   * Re-resolve transcripts for extended-context voice messages the bot shipped
   * unresolved (`rawExtendedContextVoiceMessages` — cache miss at fetch time),
   * and inject them onto the matching history messages in place. Bounded +
   * parallelized; skips any message that already carries a transcript (a cache
   * HIT shipped its text on the message itself).
   */
  private async injectExtendedContextVoiceTranscripts(
    history: ConversationMessage[],
    voiceRefs: AttachmentMetadata[] | undefined,
    options: AssembleCoreOptions | undefined
  ): Promise<void> {
    if (voiceRefs === undefined || voiceRefs.length === 0) {
      return;
    }
    // The refs arrive in collector order — OLDEST-first (bot-client reverses only
    // the `messages` array before shipping, not the attachment lists). Take the
    // newest TAIL so the cap, when it bites, keeps the most-recent unresolved voice
    // — the right priority for room awareness. (slice(-n) returns the whole array
    // when there are fewer than n, so no length guard is needed.)
    if (voiceRefs.length > EXTENDED_CONTEXT_VOICE_REDERIVE_CAP) {
      // Operational signal: a high-activity voice channel silently loses the
      // oldest transcripts under the cap; log so it's traceable.
      logger.info(
        { total: voiceRefs.length, cap: EXTENDED_CONTEXT_VOICE_REDERIVE_CAP },
        'Extended-context voice cap reached; oldest unresolved transcripts dropped'
      );
    }
    const capped = voiceRefs.slice(-EXTENDED_CONTEXT_VOICE_REDERIVE_CAP);
    await Promise.all(
      capped.map(async ref => {
        const sourceId = ref.sourceDiscordMessageId;
        if (sourceId === undefined || sourceId.length === 0) {
          return;
        }
        const target = history.find(m => (m.discordMessageId ?? []).includes(sourceId));
        // Skip the bot's own (assistant) voice output: its transcript would just
        // duplicate the message text, and the chat-log renderer drops assistant
        // transcripts anyway — so re-resolving one is a wasted STT call.
        if (target?.role === MessageRole.Assistant) {
          return;
        }
        // Only re-resolve when the message lacks a transcript — a cache HIT
        // shipped its transcript on the message metadata already. The pre-await
        // guard is race-safe because Discord allows one audio attachment per voice
        // message, so the collector ships at most one ref per sourceDiscordMessageId
        // — no two concurrent tasks target the same message.
        if (target === undefined || (target.messageMetadata?.voiceTranscripts?.length ?? 0) > 0) {
          return;
        }
        try {
          // resolveVoiceTranscript never returns an empty string (both tiers guard
          // length), so a non-null result is always a usable transcript.
          const transcript = await this.resolveVoiceTranscript(sourceId, ref, options);
          if (transcript !== null) {
            target.messageMetadata = { ...target.messageMetadata, voiceTranscripts: [transcript] };
          }
        } catch (err) {
          // These transcripts are optional enhancements to existing history
          // messages. A single failure — most plausibly a DB error in the
          // resolve path's getMessageByDiscordId tier (the STT tier already
          // degrades to null internally) — must skip this one ref, never reject
          // the Promise.all and abort context assembly for the whole job.
          logger.warn(
            { err, sourceId },
            'Extended-context voice transcript re-resolution failed; leaving the message transcript-less'
          );
        }
      })
    );
  }

  /**
   * DB-first, STT-fallback transcript resolution for one extended-context voice
   * message. The persisted row's content IS the transcript (identical to the
   * reference retriever) — cheap and always preferred; STT only re-runs for
   * never-persisted ambient voice the bot transcribed for display but never
   * stored. Returns null when neither yields text (graceful: no transcript).
   */
  private async resolveVoiceTranscript(
    discordMessageId: string,
    attachment: AttachmentMetadata,
    options: AssembleCoreOptions | undefined
  ): Promise<string | null> {
    // Same DB tier as the reference retriever (the `retrieveTranscript` closure in
    // enrichReferences): both do getMessageByDiscordId → row.content. Kept as
    // separate sites because that closure binds its own dedup window; if the DB
    // access pattern changes, update both.
    const row = await this.deps.dataSource.getMessageByDiscordId(discordMessageId);
    if (row?.content !== undefined && row.content.length > 0) {
      return row.content;
    }
    return (await options?.reTranscribeVoiceViaStt?.(attachment)) ?? null;
  }
}
