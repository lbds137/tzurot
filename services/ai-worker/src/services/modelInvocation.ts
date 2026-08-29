/**
 * Model Invocation
 *
 * The model-invoke-and-clean step of the RAG pipeline, extracted out of
 * `ConversationalRAGService` purely for size — that file counts at the
 * `max-lines` ceiling, and this step has no other reason to live separately
 * from its caller.
 */

import { type BaseMessage } from '@langchain/core/messages';
import { TEXT_LIMITS } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { contentToText } from '../utils/baseMessageContent.js';
import { type LLMInvoker } from './LLMInvoker.js';
import { type PromptBuilder } from './PromptBuilder.js';
import { type ResponsePostProcessor } from './ResponsePostProcessor.js';
import { type ConversationInputProcessor } from './ConversationInputProcessor.js';
import {
  buildInvocationMessages,
  buildModelSamplingConfig,
  countMediaAttachments,
} from './RAGUtils.js';
import { checkModelReasoningSupport } from '../redis.js';
import { deriveCacheKeyId } from './RateLimitCache.js';
import { interveningShippedText, logGeneratedResponse } from './cacheObservability.js';
import {
  parseResponseMetadata,
  recordPreInvocationDiagnostics,
  recordLlmResponseDiagnostic,
  recordPostProcessingDiagnostics,
} from './diagnostics/DiagnosticRecorders.js';
import type { DiagnosticCollector } from './DiagnosticCollector.js';
import type { ModelInvocationOptions, ModelInvocationResult } from './ConversationalRAGTypes.js';

// The log NAME stays 'ConversationalRAGService' although the module moved:
// `logGeneratedResponse`'s contract is to emit through the CALLER's logger so
// the 'Generated response' line keeps its service name in production log
// queries (see its doc-comment in cacheObservability.ts), and every other
// line here carried that name before the extraction too.
const logger = createLogger('ConversationalRAGService');

/**
 * Dependencies `invokeModelAndClean` needs from its owning service. Passed as
 * one object rather than four parameters, and taken as an argument rather than
 * read off `this`, so the invocation half is testable without constructing the
 * whole RAG service.
 */
export interface ModelInvocationDeps {
  promptBuilder: PromptBuilder;
  llmInvoker: LLMInvoker;
  responsePostProcessor: ResponsePostProcessor;
  inputProcessor: ConversationInputProcessor;
}

/** Invoke the model and clean up the response */
// eslint-disable-next-line max-lines-per-function -- Core orchestration method with diagnostic logging
export async function invokeModelAndClean(
  deps: ModelInvocationDeps,
  opts: ModelInvocationOptions
): Promise<ModelInvocationResult> {
  const {
    personality,
    systemPrompt,
    systemPromptSections,
    serializedHistory,
    currentMessage,
    historyMessages,
    crossChannelMessage,
    userMessage,
    realMessagesEnabled,
    context,
    userApiKey,
    isGuestMode,
    retryConfig,
    maxLlmAttempts,
    diagnosticCollector: diagnosticCollectorRef,
  } = opts;
  // Cast from opaque DiagnosticCollectorRef to concrete type (safe — callers always pass DiagnosticCollector)
  const diagnosticCollector = diagnosticCollectorRef as DiagnosticCollector | undefined;

  // See `buildInvocationMessages`'s doc-comment for the byte-parity
  // contract this assembly must hold across both flag states.
  const messages: BaseMessage[] = buildInvocationMessages(
    systemPrompt,
    crossChannelMessage,
    historyMessages,
    currentMessage
  );

  // Check reasoning capability (async, cached with 5-min TTL).
  // Gated on the level being SET (not on it being enabled): ModelFactory's
  // supportsReasoning gate must also suppress an explicit `off`, so the
  // capability answer is needed whenever any level is configured.
  const supportsReasoning =
    personality.thinking !== undefined
      ? await checkModelReasoningSupport(personality.model)
      : undefined;

  // Get model with all LLM sampling parameters (retry config overrides for duplicate detection)
  const { model, modelName, expectsRawResponse } = deps.llmInvoker.getModel(
    buildModelSamplingConfig({ personality, userApiKey, retryConfig, supportsReasoning })
  );

  // Calculate attachment counts for timeout
  const { imageCount, audioCount } = countMediaAttachments(context.attachments);

  // Record assembled prompt (with section map) + LLM config for diagnostics
  if (diagnosticCollector) {
    recordPreInvocationDiagnostics({
      collector: diagnosticCollector,
      messages,
      systemPromptSections,
      countTokens: text => deps.promptBuilder.countTokens(text),
      modelName,
      personality,
      effectiveTemperature: retryConfig?.temperatureOverride ?? personality.temperature,
      effectiveFrequencyPenalty:
        retryConfig?.frequencyPenaltyOverride ?? personality.frequencyPenalty,
    });
  }

  // cacheKeyId scopes doom caches by BILLING identity: guest/system-key
  // routes (including quota retargets, which pass the system key as a
  // string with isGuestMode=true) must scope as 'system', or the user's own
  // cached 402 vetoes the fallback that was chosen to dodge it.
  const cacheKeyId = deriveCacheKeyId(userApiKey, context.userId, isGuestMode);
  const response = await deps.llmInvoker.invokeWithRetry({
    model,
    messages,
    modelName,
    cacheKeyId,
    imageCount,
    audioCount,
    maxAttempts: maxLlmAttempts,
    expectsRawResponse,
  });

  // Non-text parts (thinking blocks, images) are intentionally excluded —
  // thinking content arrives via reasoning_details and is handled by
  // parseResponseMetadata/thinkingExtraction, not the content array.
  const rawContent = contentToText(response.content);

  // Extract token usage, finish reason, and reasoning details
  const metadata = parseResponseMetadata(response);
  const { usageMetadata, additionalKwargs, responseMetadata } = metadata;

  // Record LLM response for diagnostics
  if (diagnosticCollector) {
    recordLlmResponseDiagnostic(diagnosticCollector, rawContent, modelName, metadata);
  }

  // Process response: deduplicate, extract reasoning, strip artifacts, replace placeholders
  const processed = deps.responsePostProcessor.processResponse(
    rawContent,
    additionalKwargs,
    responseMetadata,
    {
      personalityName: personality.name,
      userName: deps.inputProcessor.resolveUserName(context),
      discordUsername: context.discordUsername,
      // Gate: only check for leaked CoT when reasoning was configured.
      // Uses !== false (not === true) as a defensive guard — supportsReasoning
      // is always boolean in practice, but this prevents future undefined values
      // from accidentally suppressing glitch detection.
      //
      // Deliberately keys on the level being SET, not on it being enabled: a
      // config asking for `off` is exactly where an unrequested trace is most
      // likely to leak into content (providers that think regardless of the
      // request), so narrowing this to `!== 'off'` would disable leak
      // detection precisely where it earns its keep.
      reasoningEnabled: personality.thinking !== undefined && supportsReasoning !== false,
      // Included in the per-model reasoning-did-not-engage warn so log
      // searches can correlate extraction misses with specific upstream
      // model releases.
      modelName,
      // Threaded so the post-processor can strip leading verbatim echoes of
      // the user's message from the response (some LLMs learned this pattern).
      userMessage,
      realMessagesEnabled,
      telemetry: { channelId: context.channelId, requestId: context.requestId },
    }
  );

  const { cleanedContent, thinkingContent, wasDeduplicated, onlyThinkingProduced } = processed;

  // Record post-processing for diagnostics
  if (diagnosticCollector) {
    recordPostProcessingDiagnostics({
      collector: diagnosticCollector,
      rawContent,
      thinkingContent,
      cleanedContent,
    });
  }

  logger.debug(
    {
      rawContentPreview: rawContent.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW),
      cleanedContentPreview: cleanedContent.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW),
      wasDeduplicated,
      hadThinkingBlocks: thinkingContent !== null,
      thinkingContentLength: thinkingContent?.length ?? 0,
    },
    `Content cleanup check for ${personality.name}`
  );

  // Carries the token counts plus the prefix-cache diagnostics: the turn gap
  // the provider TTL races against, and three hashes that localize a prefix
  // change (stable core vs. inside history vs. the whole prompt).
  logGeneratedResponse(logger, {
    charCount: cleanedContent.length,
    personalityName: personality.name,
    modelName,
    systemPromptText: contentToText(systemPrompt.content),
    systemPromptSections,
    serializedHistory,
    currentMessageText: contentToText(currentMessage.content),
    ...interveningShippedText(messages),
    shippedHistoryCount: historyMessages?.length ?? 0,
    history: context.rawConversationHistory,
    triggerMessageId: context.triggerMessageId,
    cacheReadTokens: usageMetadata?.input_token_details?.cache_read,
    inputTokens: usageMetadata?.input_tokens,
  });

  return {
    cleanedContent,
    modelName,
    tokensIn: usageMetadata?.input_tokens,
    tokensOut: usageMetadata?.output_tokens,
    thinkingContent: thinkingContent ?? undefined,
    onlyThinkingProduced,
  };
}
