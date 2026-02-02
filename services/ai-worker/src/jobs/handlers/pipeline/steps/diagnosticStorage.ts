/**
 * Diagnostic Storage Utility
 *
 * Persists diagnostic data to the database (fire-and-forget).
 * Extracted from GenerationStep to maintain file size limits.
 */

import { createLogger, getPrismaClient } from '@tzurot/common-types';
import { sanitizeForJsonb } from '../../../../utils/jsonSanitizer.js';
import type { DiagnosticCollector } from '../../../../services/DiagnosticCollector.js';

const logger = createLogger('DiagnosticStorage');

/**
 * Store diagnostic data to the database (fire-and-forget).
 *
 * This function finalizes the diagnostic collector and writes the data to
 * the llm_diagnostic_logs table. It runs asynchronously and does NOT
 * block the response - any errors are logged but don't affect the user.
 *
 * Data is automatically cleaned up after 24 hours via the scheduled
 * cleanup-diagnostic-logs job.
 */
export function storeDiagnosticLog(
  collector: DiagnosticCollector,
  model: string,
  provider: string
): void {
  const payload = collector.finalize();

  // Sanitize payload for PostgreSQL JSONB storage
  // Handles lone surrogates (from cut-off LLM streams) and null bytes
  const sanitizedPayload = sanitizeForJsonb(payload);

  // Fire-and-forget: don't await, just log errors
  const prisma = getPrismaClient();
  prisma.llmDiagnosticLog
    .create({
      data: {
        requestId: payload.meta.requestId,
        triggerMessageId: payload.meta.triggerMessageId,
        personalityId: payload.meta.personalityId,
        userId: payload.meta.userId,
        guildId: payload.meta.guildId,
        channelId: payload.meta.channelId,
        model,
        provider,
        durationMs: payload.timing.totalDurationMs,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- Prisma JSON field requires any cast
        data: sanitizedPayload as any,
      },
    })
    .then(() => {
      logger.debug(
        { requestId: payload.meta.requestId },
        '[DiagnosticStorage] Diagnostic log stored successfully'
      );
    })
    .catch((err: unknown) => {
      logger.error(
        { err, requestId: payload.meta.requestId },
        '[DiagnosticStorage] Failed to store diagnostic log'
      );
    });
}
