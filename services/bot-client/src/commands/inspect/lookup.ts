/**
 * Diagnostic log lookup functions
 *
 * Supports three identifier formats:
 * - Discord message link (guild or DM)
 * - UUID (request ID)
 * - Snowflake (message ID)
 *
 * The caller's Discord ID is forwarded to the gateway as `X-User-Id`. The
 * gateway applies per-user filtering server-side (bot owner sees all logs;
 * other users see only their own), so this client doesn't need to filter
 * results after the fact — the API never returns another user's log to a
 * non-owner caller.
 */

import { createLogger } from '@tzurot/common-types';
import { adminFetch } from '../../utils/adminApiClient.js';
import type { LookupResult, DiagnosticLogResponse, DiagnosticLogsResponse } from './types.js';

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
  callerUserId: string
): Promise<LookupResult> {
  const messageResponse = await adminFetch(
    `/admin/diagnostic/by-message/${encodeURIComponent(messageId)}`,
    { userId: callerUserId }
  );

  // 404 on /by-message is normal — could be a response message ID instead.
  // Fall back to the /by-response lookup before treating this as an error.
  if (messageResponse.status === 404) {
    logger.debug({ messageId }, 'Not found as trigger message, trying response message lookup');
    const fallbackResponse = await adminFetch(
      `/admin/diagnostic/by-response/${encodeURIComponent(messageId)}`,
      { userId: callerUserId }
    );

    if (fallbackResponse.ok) {
      const result = (await fallbackResponse.json()) as DiagnosticLogResponse;
      return { success: true, log: result.log };
    }

    if (fallbackResponse.status === 404) {
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

    const fallbackErrorText = await fallbackResponse.text();
    logger.error(
      { messageId, status: fallbackResponse.status, error: fallbackErrorText },
      'Fetch by response failed'
    );
    return {
      success: false,
      errorMessage: `Failed to fetch diagnostic logs (HTTP ${fallbackResponse.status})`,
    };
  }

  if (!messageResponse.ok) {
    const errorText = await messageResponse.text();
    logger.error(
      { messageId, status: messageResponse.status, error: errorText },
      'Fetch by message failed'
    );
    return {
      success: false,
      errorMessage: `Failed to fetch diagnostic logs (HTTP ${messageResponse.status})`,
    };
  }

  const { logs } = (await messageResponse.json()) as DiagnosticLogsResponse;

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

  return { success: true, log: logs[0] };
}

/**
 * Lookup diagnostic log by request UUID.
 */
export async function lookupByRequestId(
  requestId: string,
  callerUserId: string
): Promise<LookupResult> {
  const response = await adminFetch(`/admin/diagnostic/${encodeURIComponent(requestId)}`, {
    userId: callerUserId,
  });

  if (!response.ok) {
    if (response.status === 404) {
      return {
        success: false,
        errorMessage:
          NOT_FOUND_MESSAGE +
          RETENTION_HINT +
          '\n• The request ID may be incorrect\n' +
          '• The request may not have completed successfully',
      };
    }

    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, 'Fetch failed');
    return {
      success: false,
      errorMessage: `Failed to fetch diagnostic log (HTTP ${response.status})`,
    };
  }

  const result = (await response.json()) as DiagnosticLogResponse;
  return { success: true, log: result.log };
}

/**
 * Resolve an identifier to a diagnostic log.
 */
export async function resolveDiagnosticLog(
  identifier: string,
  callerUserId: string
): Promise<LookupResult> {
  const parsed = parseIdentifier(identifier);
  return parsed.type === 'messageId'
    ? lookupByMessageId(parsed.value, callerUserId)
    : lookupByRequestId(parsed.value, callerUserId);
}
