/**
 * Success-path diagnostic persistence, run by LLMGenerationHandler after all
 * pipeline stages (including TTSStep) so TTS attribution lands in the saved log.
 *
 * The row's provider is the provider that SERVED the call:
 * `result.metadata.providerUsed`, which GenerationStep sets to
 * `effectiveProviderUsed ?? auth provider` — the same value the usage row
 * records. The auth-resolved provider is only the fallback for a result that
 * carries no providerUsed.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import type { GenerationContext } from '../types.js';
import { storeDiagnosticLog } from './diagnosticStorage.js';

export function persistSuccessDiagnostic(prisma: PrismaClient, context: GenerationContext): void {
  if (context.diagnosticCollector === undefined || context.result?.success !== true) {
    return;
  }
  storeDiagnosticLog(
    prisma,
    context.diagnosticCollector,
    context.result.metadata?.modelUsed ?? 'unknown',
    context.result.metadata?.providerUsed ?? context.auth?.provider ?? 'unknown'
  );
}
