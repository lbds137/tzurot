/**
 * Diagnostic log lookup functions
 *
 * Supports three identifier formats:
 * - Discord message link (guild or DM)
 * - UUID (request ID)
 * - Snowflake (message ID)
 *
 * Non-admin users are filtered by userId — they can only see their own logs.
 */

import { createLogger } from '@tzurot/common-types';
import { adminFetch } from '../../utils/adminApiClient.js';
import type { LookupResult, DiagnosticLogResponse, DiagnosticLogsResponse } from './types.js';

const logger = createLogger('inspect');

/** Shared hint appended to 404 messages about log retention */
const RETENTION_HINT = '\u2022 The log may have expired (24h retention)';

/** Common "not found" message used for 404s and access control rejections */
const NOT_FOUND_MESSAGE = 'Diagnostic log not found.\n';

/** Log message for access control denials (audit trail) */
const ACCESS_DENIED_LOG = '[Inspect] Access denied: log belongs to another user';

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
 * When filterUserId is set, rejects logs not belonging to that user.
 */
export async function lookupByMessageId(
  messageId: string,
  filterUserId?: string
): Promise<LookupResult> {
  let response = await adminFetch(`/admin/diagnostic/by-message/${encodeURIComponent(messageId)}`);

  if (response.status === 404) {
    logger.debug(
      { messageId },
      '[Inspect] Not found as trigger message, trying response message lookup'
    );
    response = await adminFetch(`/admin/diagnostic/by-response/${encodeURIComponent(messageId)}`);

    if (response.ok) {
      const result = (await response.json()) as DiagnosticLogResponse;
      if (filterUserId !== undefined && result.log.userId !== filterUserId) {
        logger.info({ messageId, filterUserId }, ACCESS_DENIED_LOG);
        return { success: false, errorMessage: NOT_FOUND_MESSAGE + RETENTION_HINT };
      }
      return { success: true, log: result.log };
    }
  }

  if (!response.ok) {
    if (response.status === 404) {
      return {
        success: false,
        errorMessage:
          'No diagnostic logs found for this message.\n' +
          RETENTION_HINT +
          '\n\u2022 The message may not have triggered or been an AI response\n' +
          '\u2022 The message ID may be incorrect',
      };
    }

    const errorText = await response.text();
    logger.error(
      { status: response.status, error: errorText },
      '[Inspect] Fetch by message failed'
    );
    return {
      success: false,
      errorMessage: `Failed to fetch diagnostic logs (HTTP ${response.status})`,
    };
  }

  const { logs } = (await response.json()) as DiagnosticLogsResponse;

  if (logs.length === 0) {
    return {
      success: false,
      errorMessage:
        'No diagnostic logs found for this message.\n' +
        RETENTION_HINT +
        '\n\u2022 The message may not have triggered an AI response',
    };
  }

  if (logs.length > 1) {
    logger.info(
      { messageId, count: logs.length },
      '[Inspect] Multiple logs found for message, using most recent'
    );
  }

  const log = logs[0];
  if (filterUserId !== undefined && log.userId !== filterUserId) {
    logger.info({ messageId, filterUserId }, ACCESS_DENIED_LOG);
    return { success: false, errorMessage: NOT_FOUND_MESSAGE + RETENTION_HINT };
  }

  return { success: true, log };
}

/**
 * Lookup diagnostic log by request UUID.
 * When filterUserId is set, rejects logs not belonging to that user.
 */
export async function lookupByRequestId(
  requestId: string,
  filterUserId?: string
): Promise<LookupResult> {
  const response = await adminFetch(`/admin/diagnostic/${encodeURIComponent(requestId)}`);

  if (!response.ok) {
    if (response.status === 404) {
      return {
        success: false,
        errorMessage:
          NOT_FOUND_MESSAGE +
          RETENTION_HINT +
          '\n\u2022 The request ID may be incorrect\n' +
          '\u2022 The request may not have completed successfully',
      };
    }

    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, '[Inspect] Fetch failed');
    return {
      success: false,
      errorMessage: `Failed to fetch diagnostic log (HTTP ${response.status})`,
    };
  }

  const result = (await response.json()) as DiagnosticLogResponse;

  if (filterUserId !== undefined && result.log.userId !== filterUserId) {
    logger.info({ requestId, filterUserId }, ACCESS_DENIED_LOG);
    return { success: false, errorMessage: NOT_FOUND_MESSAGE + RETENTION_HINT };
  }

  return { success: true, log: result.log };
}

/**
 * Resolve an identifier to a diagnostic log.
 * When filterUserId is set, rejects logs not belonging to that user.
 */
export async function resolveDiagnosticLog(
  identifier: string,
  filterUserId?: string
): Promise<LookupResult> {
  const parsed = parseIdentifier(identifier);
  return parsed.type === 'messageId'
    ? lookupByMessageId(parsed.value, filterUserId)
    : lookupByRequestId(parsed.value, filterUserId);
}
