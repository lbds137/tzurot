/**
 * Worker-side context assembler (core surfaces).
 *
 * Re-derives the DB-derived portion of the job context from the raw assembly
 * envelope + the worker's own Prisma access, mirroring bot-client's
 * MessageContextBuilder steps 1–4: user upsert, persona resolution, timezone,
 * context epoch, channel-history hydration, extended-context user batch
 * upserts + placeholder persona resolution (shared implementation), and the
 * history merge (shared implementation). Content rewriting, reference
 * enrichment, and cross-channel decoration land in the follow-on slice.
 *
 * Shared-implementation guarantee: `resolveExtendedContextPersonaIds` and
 * `mergeWithHistory` are the SAME common-types functions the legacy bot-side
 * path calls, so the two paths cannot drift during burn-in.
 */

import {
  createLogger,
  mergeWithHistory,
  resolveExtendedContextPersonaIds,
  MESSAGE_LIMITS,
  type ConversationMessage,
  type JobContext,
  type LoadedPersonality,
  type PersonaResolver,
  type RawAssemblyInputs,
  type ResolvedConfigOverrides,
  type UserService,
} from '@tzurot/common-types';
import type { ContextDataSource } from './types.js';

const logger = createLogger('ContextAssembler');

/** The core (a3-i) surfaces the assembler re-derives. */
export interface AssembledCore {
  userInternalId: string;
  activePersonaId: string;
  activePersonaName: string | null;
  userTimezone: string;
  contextEpoch: Date | undefined;
  /** Hydrated DB history merged with envelope-carried extended context. */
  history: ConversationMessage[];
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
 * The cast bridges a known wire-shape gap: the envelope does not carry
 * channelId/guildId (extended context is same-channel by construction, so
 * they're derivable from the job). Nothing in the shadow path reads them —
 * the merge dedups on discordMessageId, the resolver touches personaId, and
 * the diff compares ids/content/personaIds — but the cutover slice must fill
 * them from job context before the assembled history feeds prompt building.
 */
function fromApiMessage(
  msg: NonNullable<RawAssemblyInputs['rawExtendedContextMessages']>[number]
): ConversationMessage {
  return {
    ...msg,
    // Discord messages always carry timestamps; epoch-0 is a defensive
    // fallback that sorts such a row first rather than crashing assembly.
    createdAt: msg.createdAt !== undefined ? new Date(msg.createdAt) : new Date(0),
    discordMessageId: msg.discordMessageId ?? [],
  } as ConversationMessage;
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
    configOverrides: ResolvedConfigOverrides | undefined
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
    const personaResult = await this.deps.personaResolver.resolve(
      jobContext.userId,
      personality.id
    );
    const activePersonaId = personaResult.config.personaId;
    const activePersonaName = personaResult.config.preferredName;

    // Step 2: timezone + context epoch.
    const userTimezone = await this.deps.dataSource.getUserTimezone(user.userId);
    const contextEpoch = await this.deps.dataSource.getContextEpoch(
      user.userId,
      personality.id,
      activePersonaId
    );

    // Step 3: hydrate channel history — same limit derivation as the
    // bot-side dbLimit (and as the 2.5a hydration shadow).
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
    // users, resolve placeholder personaIds (shared impl), merge (shared
    // impl). ABSENT raw messages = the fetch didn't run bot-side.
    const history = await this.mergeExtendedContext(raw, dbHistory, personality.id);

    logger.debug(
      {
        userInternalId: user.userId,
        activePersonaId,
        dbCount: dbHistory.length,
        mergedCount: history.length,
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
    };
  }

  /** Steps the envelope's extended context through upsert → resolve → merge. */
  private async mergeExtendedContext(
    raw: RawAssemblyInputs,
    dbHistory: ConversationMessage[],
    personalityId: string
  ): Promise<ConversationMessage[]> {
    const rawMessages = raw.rawExtendedContextMessages;
    if (rawMessages === undefined || rawMessages.length === 0) {
      return dbHistory;
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

    const messages = rawMessages.map(fromApiMessage);

    if (usersToResolve.length > 0) {
      const userMap = await this.deps.userService.getOrCreateUsersInBatch(usersToResolve);
      // participantGuildInfo intentionally omitted: the envelope does not yet
      // carry the pre-resolution (discord:-keyed) map, so the payload's
      // already-remapped copy is authoritative for that surface until the
      // envelope grows the raw form (tracked for the cutover slice).
      await resolveExtendedContextPersonaIds(
        messages,
        userMap,
        personalityId,
        this.deps.personaResolver,
        undefined
      );
    }

    return mergeWithHistory(messages, dbHistory);
  }
}
