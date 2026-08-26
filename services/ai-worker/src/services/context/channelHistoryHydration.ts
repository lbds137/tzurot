/**
 * Channel-history hydration for the current turn.
 *
 * Split out of `ContextAssembler` for the file-size limit (mirrors
 * `historyWindowTelemetry.ts`'s split for the same reason). Owns the cap
 * derivation and the DM/guild history-scoping decision so `assembleCore`
 * stays a thin orchestrator over its steps.
 */

import { MESSAGE_LIMITS } from '@tzurot/common-types/constants/message';
import {
  shouldScopeHistoryToPersonality,
  type ResolvedConfigOverrides,
} from '@tzurot/common-types/schemas/api/configOverrides';
import { type JobContext } from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { type ChannelHistoryWindowResult } from '@tzurot/conversation-history';
import { type ContextDataSource } from './types.js';

/** Return shape of {@link hydrateChannelHistory}. */
export interface HydratedChannelHistory {
  dbHistory: ChannelHistoryWindowResult['messages'];
  historyWindowMeta: ChannelHistoryWindowResult['meta'];
  cap: number;
  /**
   * True when this turn is an ISOLATED DM: history is scoped to the
   * personality AND the channel is a DM. Surfaced rather than recomputed at
   * the caller, so the DB-scoping decision and the extended-context decision
   * cannot drift apart. In a guild this stays false even under isolation —
   * see {@link hydrateChannelHistory}'s note on the live-channel read.
   */
  isolatedDm: boolean;
}

/** Inputs to {@link hydrateChannelHistory}. */
export interface HydrateChannelHistoryParams {
  dataSource: ContextDataSource;
  jobContext: JobContext;
  personality: LoadedPersonality;
  configOverrides: ResolvedConfigOverrides | undefined;
  channelId: string;
  contextEpoch: Date | undefined;
}

/**
 * Hydrate channel history for the current turn — same cap derivation as the
 * bot-side dbLimit.
 */
export async function hydrateChannelHistory(
  params: HydrateChannelHistoryParams
): Promise<HydratedChannelHistory> {
  const { dataSource, jobContext, personality, configOverrides, channelId, contextEpoch } = params;
  const cap = Math.min(
    configOverrides?.maxMessages ?? MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
    MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT
  );
  // Exclude the trigger message from the assembled history. bot-client
  // persists it to the gateway BEFORE submitting this job (durability for the
  // next turn), and this hydration runs after — so the just-sent message is
  // already in the channel history. It is also delivered as the live user
  // turn, so without this exclusion it appears twice: once in the assembled
  // history and again as the current message. (The bot-side history fetch
  // reads before the persist and never saw it; the worker must drop it here.)
  //
  // The exclusion is a predicate, not a post-filter, and that placement is
  // load-bearing under windowing: the window's count and its rows must
  // describe the same set. Dropping a row afterwards returned one message
  // fewer than the arithmetic promised, which the old code compensated for
  // with a fetch-one-extra `+1`. Inside the predicate there is nothing to
  // compensate for.
  const isDm = jobContext.serverId === undefined;
  const scopeHistoryToPersonality = shouldScopeHistoryToPersonality(
    configOverrides?.shareHistoryAcrossPersonalities ?? 'always',
    isDm
  );
  const { messages: dbHistory, meta: historyWindowMeta } = await dataSource.getChannelHistoryWindow(
    {
      channelId,
      cap,
      contextEpoch,
      maxAgeSeconds: configOverrides?.maxAge ?? undefined,
      excludeDiscordMessageId: jobContext.triggerMessageId,
      personalityId: scopeHistoryToPersonality ? personality.id : undefined,
    }
  );
  // The DB read is personality-scoped in DMs and guilds alike, but the LIVE
  // channel read (extended context) is only dropped in DMs — a sibling
  // character's replies in a guild are already visible in the room to everyone
  // present, so surfacing them there is not a privacy leak. The caller gates
  // the extended-context merge on this flag; the guild asymmetry is pinned by
  // the DM/guild seam pair in `ContextAssembler.test.ts`.
  return {
    dbHistory,
    historyWindowMeta,
    cap,
    isolatedDm: scopeHistoryToPersonality && isDm,
  };
}
