/**
 * RAG-path vision helpers: cross-provider auth resolution + history enrichment.
 *
 * `resolveRagVisionAuth` resolves the vision-provider key + provider + model ONCE
 * per request so every vision call site in the RAG path (history enrichment,
 * current-message inline fallback, referenced-message attachments) uses the
 * correct cross-provider key instead of the raw main-model key — which 401s when
 * the vision model lives on a different provider than the main model. All sites
 * share one personality + user per request, so a single resolution is correct.
 *
 * `enrichRagHistory` runs the history image-description / stored-reference
 * enrichment using that resolved auth.
 *
 * Extracted from `ConversationalRAGService` so the orchestration file stays under
 * the line cap and these branches are independently testable.
 *
 * Auth fails open: with no resolver wired (tests) or no upstream provider, or on
 * a resolver fail-fast/throw, it degrades to the main key — the pre-existing
 * behaviour (the cross-provider call then 401s to a placeholder description,
 * reachable only when no system free-fallback key is configured).
 */

import { type AIProvider } from '@tzurot/common-types/constants/ai';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { resolveVisionConfig } from './visionAuthResolver.js';
import { processAttachments, deriveApiKeySource } from '../MultimodalProcessor.js';
import { enrichConversationHistory } from '../RAGUtils.js';
import { visionDescriptionCache } from '../../redis.js';
import type { ApiKeyResolver } from '../ApiKeyResolver.js';
import type { ConversationContext, ResolvedVisionAuth } from '../ConversationalRAGTypes.js';

const logger = createLogger('RagVisionAuth');

/** Inputs for {@link resolveRagVisionAuth}. */
export interface ResolveRagVisionAuthOptions {
  personality: LoadedPersonality;
  userId: string | undefined;
  isGuestMode: boolean;
  /** Main-model key (auth.apiKey) — drives the same-provider fast path only. */
  mainApiKey: string | undefined;
  /** Effective post-promotion provider (auth.provider). */
  mainProvider: AIProvider | undefined;
  /** Absent in legacy/test callers → degrade to passing the main key through. */
  apiKeyResolver?: ApiKeyResolver;
}

export async function resolveRagVisionAuth(
  opts: ResolveRagVisionAuthOptions
): Promise<ResolvedVisionAuth> {
  const { personality, userId, isGuestMode, mainApiKey, mainProvider, apiKeyResolver } = opts;

  if (apiKeyResolver === undefined || mainProvider === undefined) {
    return { userApiKey: mainApiKey };
  }

  try {
    const result = await resolveVisionConfig({
      personality,
      mainProvider,
      mainApiKey,
      isGuestMode,
      userId,
      apiKeyResolver,
    });
    if (result.kind === 'resolved') {
      return {
        userApiKey: result.config.apiKey,
        visionProvider: result.config.provider,
        model: result.config.model,
      };
    }
    logger.warn(
      { userId, visionProvider: result.provider },
      'Vision config fail-fast in RAG path — degrading to main-model key'
    );
    return { userApiKey: mainApiKey };
  } catch (error) {
    logger.warn(
      { err: error, userId },
      'Vision config resolution threw in RAG path — degrading to main-model key'
    );
    return { userApiKey: mainApiKey };
  }
}

/** Inputs for {@link enrichRagHistory}. */
export interface EnrichRagHistoryOptions {
  prisma: PrismaClient;
  context: ConversationContext;
  personality: LoadedPersonality;
  /** Resolved cross-provider vision auth (from {@link resolveRagVisionAuth}). */
  visionAuth: ResolvedVisionAuth;
  isGuestMode: boolean;
  sttDispatch?: SttDispatch;
}

/**
 * Enrich conversation history with inline image descriptions + hydrated stored
 * references, using the cross-provider-resolved vision auth so history images on
 * a different provider than the main model don't 401.
 */
export async function enrichRagHistory(opts: EnrichRagHistoryOptions): Promise<void> {
  const { prisma, context, personality, visionAuth, isGuestMode, sttDispatch } = opts;
  const visionLoggingContext = {
    userId: context.userId,
    apiKeySource: deriveApiKeySource(isGuestMode, visionAuth.userApiKey),
  };
  await enrichConversationHistory(
    context.rawConversationHistory,
    context.preprocessedExtendedContextAttachments,
    prisma,
    visionDescriptionCache,
    atts =>
      processAttachments(atts, personality, {
        isGuestMode,
        userApiKey: visionAuth.userApiKey,
        sttDispatch,
        visionProvider: visionAuth.visionProvider,
        model: visionAuth.model,
        loggingContext: visionLoggingContext,
      })
  );
}
