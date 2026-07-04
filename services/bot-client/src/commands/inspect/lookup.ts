/**
 * Diagnostic log lookup functions
 *
 * Supports three identifier formats:
 * - Discord message link (guild or DM)
 * - UUID (request ID)
 * - Snowflake (message ID)
 *
 * The caller's Discord ID is forwarded to the gateway via the typed
 * `UserClient` (X-User-Id header). The gateway applies per-user filtering
 * server-side (bot owner sees all logs; other users see only their own),
 * so this client doesn't need to filter results after the fact — the API
 * never returns another user's log to a non-owner caller.
 */

import { type DiagnosticLog as ApiDiagnosticLog } from '@tzurot/common-types/schemas/api/diagnostic';
import { type DiagnosticPayload } from '@tzurot/common-types/types/diagnostic';
import { normalizeDateTime } from '@tzurot/common-types/utils/dateFormatting';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type UserClient } from '@tzurot/clients';
import type { LookupResult, DiagnosticLog } from './types.js';

const logger = createLogger('inspect');

/** Shared hint appended to 404 messages about log retention */
const RETENTION_HINT = '• The log may have expired (24h retention)';

/** Common "not found" message used for 404s */
const NOT_FOUND_MESSAGE = 'Diagnostic log not found.\n';

/** Discord message link regex - captures channel and message IDs */
const MESSAGE_LINK_REGEX = /discord\.com\/channels\/(?:@me|\d+)\/(\d+)\/(\d+)/;

/** UUID v4 regex for request IDs */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Discord snowflake ID regex (numeric, 17-20 digits) */
const SNOWFLAKE_REGEX = /^\d{17,20}$/;

/**
 * Adapt the Zod-validated diagnostic-log shape from the typed UserClient
 * into the local `DiagnosticLog` shape consumed by inspect view builders.
 *
 * The two differ in three places:
 * - `triggerMessageId`: API returns `string | null`; locals treat the
 *   field as optional (`?: string`). Map null → undefined.
 * - `createdAt`: Zod schema types this as `string | Date`. Normalize
 *   to ISO string regardless of runtime type so downstream view code
 *   can rely on the string contract.
 * - `data`: schema is `unknown` (trusted JSONB blob); cast to the
 *   structural `DiagnosticPayload` consumers expect.
 */
function adaptLog(log: ApiDiagnosticLog): DiagnosticLog {
  return {
    id: log.id,
    requestId: log.requestId,
    triggerMessageId: log.triggerMessageId ?? undefined,
    personalityId: log.personalityId,
    userId: log.userId,
    guildId: log.guildId,
    channelId: log.channelId,
    model: log.model,
    provider: log.provider,
    durationMs: log.durationMs,
    createdAt: normalizeDateTime(log.createdAt),
    data: log.data as DiagnosticPayload,
  };
}

/**
 * Parse identifier to extract message ID if it's a Discord link
 */
export function parseIdentifier(identifier: string): {
  type: 'messageId' | 'requestId';
  value: string;
} {
  const linkMatch = MESSAGE_LINK_REGEX.exec(identifier);
  if (linkMatch !== null) {
    return { type: 'messageId', value: linkMatch[2] };
  }

  if (UUID_REGEX.test(identifier)) {
    return { type: 'requestId', value: identifier };
  }

  if (SNOWFLAKE_REGEX.test(identifier)) {
    return { type: 'messageId', value: identifier };
  }

  // Default to treating as request ID for backwards compatibility
  return { type: 'requestId', value: identifier };
}

/**
 * Lookup diagnostic log by Discord message ID
 * Tries trigger message first, then response message as fallback.
 */
export async function lookupByMessageId(
  messageId: string,
  userClient: UserClient
): Promise<LookupResult> {
  const messageResult = await userClient.getDiagnosticByMessage(messageId);

  // 404 on /by-message is normal — could be a response message ID instead.
  // Fall back to the /by-response lookup before treating this as an error.
  if (!messageResult.ok && messageResult.status === 404) {
    logger.debug({ messageId }, 'Not found as trigger message, trying response message lookup');
    const fallbackResult = await userClient.getDiagnosticByResponse(messageId);

    if (fallbackResult.ok) {
      return { success: true, log: adaptLog(fallbackResult.data.log) };
    }

    if (fallbackResult.status === 404) {
      logger.debug(
        { messageId },
        'Diagnostic log not found via by-message or by-response — likely expired or unknown message ID'
      );
      return {
        success: false,
        errorMessage:
          'No diagnostic logs found for this message.\n' +
          RETENTION_HINT +
          '\n• The message may not have triggered or been an AI response\n' +
          '• The message ID may be incorrect',
      };
    }

    logger.error(
      { messageId, status: fallbackResult.status, error: fallbackResult.error },
      'Fetch by response failed'
    );
    return {
      success: false,
      errorMessage: `Failed to fetch diagnostic logs (HTTP ${fallbackResult.status})`,
    };
  }

  if (!messageResult.ok) {
    logger.error(
      { messageId, status: messageResult.status, error: messageResult.error },
      'Fetch by message failed'
    );
    return {
      success: false,
      errorMessage: `Failed to fetch diagnostic logs (HTTP ${messageResult.status})`,
    };
  }

  const { logs } = messageResult.data;

  if (logs.length === 0) {
    return {
      success: false,
      errorMessage:
        'No diagnostic logs found for this message.\n' +
        RETENTION_HINT +
        '\n• The message may not have triggered an AI response',
    };
  }

  if (logs.length > 1) {
    logger.info(
      { messageId, count: logs.length },
      'Multiple logs found for message, using most recent'
    );
  }

  return { success: true, log: adaptLog(logs[0]) };
}

/**
 * Lookup diagnostic log by request UUID.
 */
export async function lookupByRequestId(
  requestId: string,
  userClient: UserClient
): Promise<LookupResult> {
  const result = await userClient.getDiagnosticByRequestId(requestId);

  if (!result.ok) {
    if (result.status === 404) {
      return {
        success: false,
        errorMessage:
          NOT_FOUND_MESSAGE +
          RETENTION_HINT +
          '\n• The request ID may be incorrect\n' +
          '• The request may not have completed successfully',
      };
    }

    logger.error({ status: result.status, error: result.error }, 'Fetch failed');
    return {
      success: false,
      errorMessage: `Failed to fetch diagnostic log (HTTP ${result.status})`,
    };
  }

  return { success: true, log: adaptLog(result.data.log) };
}

/**
 * Resolve an identifier to a diagnostic log.
 */
export async function resolveDiagnosticLog(
  identifier: string,
  userClient: UserClient
): Promise<LookupResult> {
  const parsed = parseIdentifier(identifier);
  return parsed.type === 'messageId'
    ? lookupByMessageId(parsed.value, userClient)
    : lookupByRequestId(parsed.value, userClient);
}
