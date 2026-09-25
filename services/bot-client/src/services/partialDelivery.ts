/**
 * Partial-delivery error path.
 *
 * `DiscordResponseSender.sendResponse` splits a response into chunks and
 * sends them one at a time. A send that throws AFTER at least one chunk
 * landed on Discord surfaces here as a {@link PartialDeliveryError} carrying
 * the ids and undecorated text of the chunks that DID land — {@link
 * toSendFailure} is the seam that performs that conversion. A throw with
 * ZERO delivered chunks rethrows the original error unchanged: zero ids
 * still means nothing reached Discord (pinned by `toSendFailure`'s own test
 * "returns the same error unchanged when zero chunks were delivered").
 *
 * The turn a Discord conversation persists is anchored on ONE deterministic
 * row per turn (its id excludes content, so a second persist with different
 * content is a divergent-replay warning downstream). {@link
 * resolveErrorPathTurn} composes that single row for every shape an error
 * path can land in — a partial send followed by a delivered error notice, a
 * partial send whose error notice ALSO failed, an error notice with no
 * partial, or nothing at all — and {@link settleErrorPathTurn} is the
 * effectful wrapper callers invoke from inside a catch block: it persists
 * the resolved row (swallowing and logging any persist failure) and forwards
 * the combined ids to the diagnostic-log updater. It never throws.
 *
 * Pinning tests: `partialDelivery.test.ts` (this module's own units) and
 * `DiscordResponseSender.test.ts`'s "propagates a webhook send failure
 * instead of returning a short id list" / partial-delivery describe blocks.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import { updateDiagnosticResponseIds } from '../utils/gatewayServiceCalls.js';

const logger = createLogger('partialDelivery');

/**
 * Thrown by `DiscordResponseSender.sendResponse` when a chunked send fails
 * partway through, after at least one chunk was already delivered to
 * Discord. Carries the delivered chunks' message ids (in delivery order) and
 * their undecorated text, plus the original failure as `cause`.
 */
export class PartialDeliveryError extends Error {
  readonly chunkMessageIds: string[];
  readonly deliveredContent: string;
  declare readonly cause: unknown;

  constructor(options: {
    chunkMessageIds: string[];
    deliveredContent: string;
    totalChunks: number;
    cause: unknown;
  }) {
    const { chunkMessageIds, deliveredContent, totalChunks, cause } = options;
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `Partial delivery: ${chunkMessageIds.length} of ${totalChunks} chunks sent before: ${causeMessage}`,
      { cause }
    );
    this.name = 'PartialDeliveryError';
    this.chunkMessageIds = chunkMessageIds;
    this.deliveredContent = deliveredContent;
  }
}

/**
 * Convert a mid-send failure into a {@link PartialDeliveryError} when at
 * least one chunk was already delivered, or return `error` unchanged when
 * nothing was. Called from `sendResponse`'s dispatch catch — `progress`
 * carries the same `chunkMessageIds` array the send loop pushed into, plus
 * the parallel undecorated `plainChunks` array so the composed
 * `deliveredContent` never includes the DM speaker prefix or a footer/TTS
 * decoration that never made it to Discord.
 */
export function toSendFailure(
  error: unknown,
  progress: { chunkMessageIds: string[]; plainChunks: string[]; totalChunks: number }
): unknown {
  const { chunkMessageIds, plainChunks, totalChunks } = progress;
  if (chunkMessageIds.length === 0) {
    return error;
  }
  const ids = [...chunkMessageIds];
  const deliveredContent = plainChunks
    .slice(0, ids.length)
    .filter(chunk => chunk.length > 0)
    .join('\n');
  return new PartialDeliveryError({
    chunkMessageIds: ids,
    deliveredContent,
    totalChunks,
    cause: error,
  });
}

/**
 * Strip the DM speaker prefix (`**DisplayName:** `) from a chunk's start.
 * The splitter trims chunk boundaries, so chunk 0 may start with the prefix
 * exactly as built, OR with its trailing space trimmed off — both are
 * checked. A chunk that doesn't start with the (trimmed) prefix is returned
 * unchanged, which covers every later chunk and any webhook-channel chunk.
 */
export function stripDmPrefix(chunk: string, prefix: string): string {
  const bare = prefix.trimEnd();
  if (!chunk.startsWith(bare)) {
    return chunk;
  }
  const rest = chunk.slice(bare.length);
  return rest.startsWith(' ') ? rest.slice(1) : rest;
}

/** A single turn's worth of content + delivered chunk ids, ready to persist. */
export interface PersistableTurn {
  content: string;
  chunkMessageIds: string[];
}

/** What an error path should persist, and which ids to report as diagnostic. */
export interface ErrorPathOutcome {
  persist: PersistableTurn | null;
  diagnosticIds: string[];
}

/**
 * Compose the turn's single persisted row from a partial success send and/or
 * an error-notice send. `errorTurn === null` means the error-notice send
 * itself failed (nothing of the notice reached Discord); a non-null
 * `errorTurn.content` is already spoiler-stripped by the caller.
 *
 * Pure — see this module's JSDoc for the shape enumeration; pinned row-by-row
 * in `partialDelivery.test.ts`.
 */
export function resolveErrorPathTurn(args: {
  partial: PartialDeliveryError | undefined;
  errorTurn: PersistableTurn | null;
  persistErrorText: boolean;
}): ErrorPathOutcome {
  const { partial, errorTurn, persistErrorText } = args;
  const diagnosticIds = [
    ...(partial?.chunkMessageIds ?? []),
    ...(errorTurn?.chunkMessageIds ?? []),
  ];

  if (partial !== undefined) {
    if (errorTurn !== null && persistErrorText) {
      return {
        persist: {
          content: partial.deliveredContent + '\n' + errorTurn.content,
          chunkMessageIds: [...partial.chunkMessageIds, ...errorTurn.chunkMessageIds],
        },
        diagnosticIds,
      };
    }
    return {
      persist: {
        content: partial.deliveredContent,
        chunkMessageIds: [...partial.chunkMessageIds],
      },
      diagnosticIds,
    };
  }

  if (errorTurn !== null && persistErrorText) {
    return {
      persist: { content: errorTurn.content, chunkMessageIds: [...errorTurn.chunkMessageIds] },
      diagnosticIds,
    };
  }

  return { persist: null, diagnosticIds };
}

/**
 * Effectful wrapper around {@link resolveErrorPathTurn} for callers running
 * inside a catch block: persists the resolved single row (if any) and
 * forwards the combined delivered+error-notice ids to the diagnostic-log
 * updater. Both effects are best-effort — a persist failure is logged, never
 * rethrown, and the diagnostic update is fire-and-forget — so this function
 * itself never throws.
 */
export async function settleErrorPathTurn(args: {
  partial: PartialDeliveryError | undefined;
  errorTurn: PersistableTurn | null;
  persistErrorText: boolean;
  save: (turn: PersistableTurn) => Promise<void>;
  requestId: string;
  logContext: Record<string, unknown>;
}): Promise<void> {
  const { partial, errorTurn, persistErrorText, save, requestId, logContext } = args;
  const { persist, diagnosticIds } = resolveErrorPathTurn({ partial, errorTurn, persistErrorText });

  if (persist !== null) {
    try {
      await save(persist);
    } catch (persistError) {
      logger.error(
        { err: persistError, ...logContext },
        'Failed to persist error-path turn to conversation history (already sent)'
      );
    }
  }

  if (diagnosticIds.length > 0) {
    void updateDiagnosticResponseIds(requestId, diagnosticIds).catch(err => {
      logger.warn(
        { err, ...logContext },
        'Failed to update diagnostic response IDs for error path'
      );
    });
  }
}
