/**
 * LLM Generation Handler
 *
 * Handles LLM generation jobs including preprocessing dependency merging.
 *
 * BYOK Security Model:
 * - API keys are NEVER passed through BullMQ jobs in plaintext
 * - Keys are resolved at runtime using ApiKeyResolver
 * - Keys are decrypted only in ai-worker, stored encrypted in DB
 */

import { Job } from 'bullmq';
import {
  ConversationalRAGService,
  type RAGResponse,
} from '../../services/ConversationalRAGService.js';
import {
  MessageContent,
  createLogger,
  REDIS_KEY_PREFIXES,
  AIProvider,
  GUEST_MODE,
  isFreeModel,
  AttachmentType,
  type LLMGenerationJobData,
  type LLMGenerationResult,
  type AudioTranscriptionResult,
  type ImageDescriptionResult,
  llmGenerationJobDataSchema,
} from '@tzurot/common-types';
import type { ProcessedAttachment } from '../../services/MultimodalProcessor.js';
import { extractParticipants, convertConversationHistory } from '../utils/conversationUtils.js';
import { ApiKeyResolver } from '../../services/ApiKeyResolver.js';
import { LlmConfigResolver } from '../../services/LlmConfigResolver.js';

const logger = createLogger('LLMGenerationHandler');

/**
 * Handler for LLM generation jobs
 * Processes dependencies (audio transcriptions, image descriptions) and generates AI responses
 */
export class LLMGenerationHandler {
  constructor(
    private readonly ragService: ConversationalRAGService,
    private readonly apiKeyResolver?: ApiKeyResolver,
    private readonly configResolver?: LlmConfigResolver
  ) {}

  /**
   * Process LLM generation job (may depend on preprocessing jobs)
   */
  async processJob(job: Job<LLMGenerationJobData>): Promise<LLMGenerationResult> {
    // Validate job payload against schema (contract testing)
    const validation = llmGenerationJobDataSchema.safeParse(job.data);
    if (!validation.success) {
      logger.error(
        {
          jobId: job.id,
          errors: validation.error.format(),
        },
        '[LLMGenerationHandler] Job validation failed'
      );
      throw new Error(`LLM generation job validation failed: ${validation.error.message}`);
    }

    const { dependencies } = job.data;

    // If there are dependencies, fetch their results and merge into context
    if (dependencies && dependencies.length > 0) {
      await this.processDependencies(job);
    }

    // Now perform LLM generation
    return this.generateResponse(job);
  }

  /**
   * Preprocessing results returned from dependency jobs
   */
  private preprocessingResults: {
    processedAttachments: ProcessedAttachment[];
    transcriptions: string[];
  } = { processedAttachments: [], transcriptions: [] };

  /**
   * Fetch and merge preprocessing results (audio transcriptions, image descriptions)
   * Returns structured data for use by RAG service instead of orphaned string
   */
  private async processDependencies(job: Job<LLMGenerationJobData>): Promise<void> {
    const { dependencies } = job.data;

    // Reset for this job
    this.preprocessingResults = { processedAttachments: [], transcriptions: [] };

    if (!dependencies || dependencies.length === 0) {
      return;
    }

    logger.info(
      {
        jobId: job.id,
        dependencyCount: dependencies.length,
      },
      '[LLMGenerationHandler] LLM job has dependencies - fetching preprocessing results'
    );

    // Fetch dependency results from Redis
    const { redisService } = await import('../../redis.js');

    // Collect all audio transcriptions
    const transcriptions: string[] = [];
    // Collect all image descriptions
    const imageDescriptions: { url: string; description: string }[] = [];

    for (const dep of dependencies) {
      try {
        // Extract key from resultKey (strip REDIS_KEY_PREFIXES.JOB_RESULT prefix)
        const key = dep.resultKey?.substring(REDIS_KEY_PREFIXES.JOB_RESULT.length) ?? dep.jobId;

        if ((dep.type as string) === 'audio-transcription') {
          const result = await redisService.getJobResult<AudioTranscriptionResult>(key);
          if (
            result?.success === true &&
            result.content !== undefined &&
            result.content.length > 0
          ) {
            transcriptions.push(result.content);
            logger.debug(
              { jobId: dep.jobId, key },
              '[LLMGenerationHandler] Retrieved audio transcription'
            );
          } else {
            logger.warn(
              { jobId: dep.jobId, key },
              '[LLMGenerationHandler] Audio transcription job failed or has no result'
            );
          }
        } else if ((dep.type as string) === 'image-description') {
          const result = await redisService.getJobResult<ImageDescriptionResult>(key);
          if (
            result?.success === true &&
            result.descriptions !== undefined &&
            result.descriptions.length > 0
          ) {
            imageDescriptions.push(...result.descriptions);
            logger.debug(
              { jobId: dep.jobId, key, count: result.descriptions.length },
              '[LLMGenerationHandler] Retrieved image descriptions'
            );
          } else {
            logger.warn(
              { jobId: dep.jobId, key },
              '[LLMGenerationHandler] Image description job failed or has no result'
            );
          }
        }
      } catch (error) {
        logger.error(
          { err: error, jobId: dep.jobId, type: dep.type },
          '[LLMGenerationHandler] Failed to fetch dependency result - continuing without it'
        );
      }
    }

    // Convert image descriptions to ProcessedAttachment format for RAG service
    // This avoids duplicate vision API calls - the descriptions are already computed
    const processedAttachments: ProcessedAttachment[] = imageDescriptions.map(img => ({
      type: AttachmentType.Image,
      description: img.description,
      originalUrl: img.url,
      // Minimal metadata - full metadata not needed since description is already computed
      metadata: {
        url: img.url,
        name: img.url.split('/').pop() ?? 'image',
        contentType: 'image/unknown',
        size: 0,
      },
    }));

    // Store results for use by generateResponse
    this.preprocessingResults = {
      processedAttachments,
      transcriptions,
    };

    logger.info(
      {
        jobId: job.id,
        transcriptionCount: transcriptions.length,
        imageCount: processedAttachments.length,
      },
      '[LLMGenerationHandler] Fetched preprocessing results from dependency jobs'
    );
  }

  /**
   * Generate AI response using RAG service
   */
  private async generateResponse(job: Job<LLMGenerationJobData>): Promise<LLMGenerationResult> {
    const startTime = Date.now();
    const { requestId, personality, message, context } = job.data;

    logger.info(
      `[LLMGenerationHandler] Processing LLM generation job ${job.id} (${requestId}) for ${personality.name}`
    );

    // Resolve LLM config with user overrides
    // Hierarchy: user-personality > user-default > personality default
    let effectivePersonality = personality;
    let configSource: 'personality' | 'user-personality' | 'user-default' = 'personality';

    if (this.configResolver) {
      try {
        const configResult = await this.configResolver.resolveConfig(
          context.userId,
          personality.id,
          personality
        );

        configSource = configResult.source;

        // If user has an override, apply it to the personality
        if (configResult.source !== 'personality') {
          effectivePersonality = {
            ...personality,
            model: configResult.config.model,
            visionModel: configResult.config.visionModel ?? personality.visionModel,
            temperature: configResult.config.temperature ?? personality.temperature,
            topP: configResult.config.topP ?? personality.topP,
            topK: configResult.config.topK ?? personality.topK,
            frequencyPenalty: configResult.config.frequencyPenalty ?? personality.frequencyPenalty,
            presencePenalty: configResult.config.presencePenalty ?? personality.presencePenalty,
            repetitionPenalty:
              configResult.config.repetitionPenalty ?? personality.repetitionPenalty,
            maxTokens: configResult.config.maxTokens ?? personality.maxTokens,
            memoryScoreThreshold:
              configResult.config.memoryScoreThreshold ?? personality.memoryScoreThreshold,
            memoryLimit: configResult.config.memoryLimit ?? personality.memoryLimit,
            contextWindowTokens:
              configResult.config.contextWindowTokens ?? personality.contextWindowTokens,
          };

          logger.info(
            {
              userId: context.userId,
              personalityId: personality.id,
              source: configResult.source,
              configName: configResult.configName,
              model: effectivePersonality.model,
            },
            '[LLMGenerationHandler] Applied user config override'
          );
        }
      } catch (error) {
        logger.warn(
          { err: error, userId: context.userId },
          '[LLMGenerationHandler] Failed to resolve user config, using personality default'
        );
      }
    }

    // BYOK: Resolve API key from database using ApiKeyResolver
    // The key is NEVER passed through BullMQ - we look it up here using userId
    let resolvedApiKey: string | undefined;
    let resolvedProvider: string | undefined;
    let isGuestMode = false;

    if (this.apiKeyResolver) {
      try {
        const keyResult = await this.apiKeyResolver.resolveApiKey(
          context.userId,
          AIProvider.OpenRouter // Default provider - could be determined from personality.model
        );
        resolvedApiKey = keyResult.apiKey;
        resolvedProvider = keyResult.provider;
        isGuestMode = keyResult.isGuestMode;

        logger.debug(
          {
            userId: context.userId,
            source: keyResult.source,
            provider: resolvedProvider,
            isGuestMode,
          },
          '[LLMGenerationHandler] Resolved API key'
        );

        // Guest Mode: Enforce free-model-only
        if (isGuestMode) {
          const currentModel = effectivePersonality.model;

          // If current model is not free, override to guest default
          if (!isFreeModel(currentModel)) {
            // Try to get free default from database first, fall back to hardcoded
            let guestModel: string = GUEST_MODE.DEFAULT_MODEL;
            if (this.configResolver) {
              try {
                const freeConfig = await this.configResolver.getFreeDefaultConfig();
                if (freeConfig !== null) {
                  guestModel = freeConfig.model;
                  logger.debug(
                    { model: guestModel },
                    '[LLMGenerationHandler] Using database free default config'
                  );
                }
              } catch (error) {
                logger.warn(
                  { err: error },
                  '[LLMGenerationHandler] Failed to get free default config, using hardcoded fallback'
                );
              }
            }

            logger.info(
              {
                userId: context.userId,
                originalModel: currentModel,
                guestModel,
              },
              '[LLMGenerationHandler] Guest mode: overriding paid model with free model'
            );

            effectivePersonality = {
              ...effectivePersonality,
              model: guestModel,
              // Clear vision model if not free - guest mode may not support vision on all models
              visionModel:
                effectivePersonality.visionModel !== undefined &&
                effectivePersonality.visionModel.length > 0 &&
                isFreeModel(effectivePersonality.visionModel)
                  ? effectivePersonality.visionModel
                  : undefined,
            };
          }

          logger.info(
            { userId: context.userId, model: effectivePersonality.model },
            '[LLMGenerationHandler] Guest mode active - using free model'
          );
        }
      } catch (error) {
        // Log but don't fail - guest mode can still work
        logger.warn(
          { err: error, userId: context.userId },
          '[LLMGenerationHandler] Failed to resolve API key, falling back to guest mode'
        );
        isGuestMode = true;

        // Apply guest mode model override
        if (!isFreeModel(effectivePersonality.model)) {
          // Try to get free default from database, fall back to hardcoded
          let guestModel: string = GUEST_MODE.DEFAULT_MODEL;
          if (this.configResolver) {
            try {
              const freeConfig = await this.configResolver.getFreeDefaultConfig();
              if (freeConfig !== null) {
                guestModel = freeConfig.model;
              }
            } catch {
              // Silently fall back to hardcoded - we're already in error recovery
            }
          }
          effectivePersonality = {
            ...effectivePersonality,
            model: guestModel,
          };
        }
      }
    }

    // Debug: Check if referencedMessages exists in job data
    logger.info(
      `[LLMGenerationHandler] Job data context inspection: ` +
        `hasReferencedMessages=${context.referencedMessages !== undefined && context.referencedMessages !== null}, ` +
        `count=${context.referencedMessages?.length ?? 0}, ` +
        `type=${typeof context.referencedMessages}, ` +
        `contextKeys=[${Object.keys(context).join(', ')}]`
    );

    try {
      // Calculate oldest timestamp from conversation history (for LTM deduplication)
      let oldestHistoryTimestamp: number | undefined;
      if (context.conversationHistory && context.conversationHistory.length > 0) {
        const timestamps = context.conversationHistory
          .map(msg =>
            msg.createdAt !== undefined && msg.createdAt.length > 0
              ? new Date(msg.createdAt).getTime()
              : null
          )
          .filter((t): t is number => t !== null);

        if (timestamps.length > 0) {
          oldestHistoryTimestamp = Math.min(...timestamps);
          logger.debug(
            `[LLMGenerationHandler] Oldest conversation message: ${new Date(oldestHistoryTimestamp).toISOString()}`
          );
        }
      }

      // Extract unique participants BEFORE converting to BaseMessage
      const participants = extractParticipants(
        context.conversationHistory ?? [],
        context.activePersonaId,
        context.activePersonaName
      );

      // Add mentioned personas to participants (if not already present)
      let allParticipants = participants;
      if (context.mentionedPersonas && context.mentionedPersonas.length > 0) {
        const existingIds = new Set(participants.map(p => p.personaId));
        const mentionedParticipants = context.mentionedPersonas
          .filter(mentioned => !existingIds.has(mentioned.personaId))
          .map(mentioned => ({
            personaId: mentioned.personaId,
            personaName: mentioned.personaName,
            isActive: false,
          }));

        if (mentionedParticipants.length > 0) {
          allParticipants = [...participants, ...mentionedParticipants];
          for (const p of mentionedParticipants) {
            logger.debug(
              `[LLMGenerationHandler] Added mentioned persona to participants: ${p.personaName}`
            );
          }
        }
      }

      // Convert conversation history to BaseMessage format
      const conversationHistory = convertConversationHistory(
        context.conversationHistory ?? [],
        personality.name
      );

      // Generate response using RAG
      // Note: resolvedApiKey comes from ApiKeyResolver (BYOK) or is undefined (system key fallback)
      // Note: effectivePersonality has user config overrides applied (if any)
      // Note: isGuestMode determines which vision fallback model to use
      // Note: preprocessedAttachments from dependency jobs avoids duplicate vision API calls
      const response: RAGResponse = await this.ragService.generateResponse(
        effectivePersonality,
        message as MessageContent,
        {
          userId: context.userId,
          userName: context.userName,
          userTimezone: context.userTimezone,
          channelId: context.channelId,
          serverId: context.serverId,
          sessionId: context.sessionId,
          isProxyMessage: context.isProxyMessage,
          activePersonaId: context.activePersonaId,
          activePersonaName: context.activePersonaName,
          conversationHistory,
          rawConversationHistory: context.conversationHistory,
          oldestHistoryTimestamp,
          participants: allParticipants,
          attachments: context.attachments,
          // Use preprocessed attachments from dependency jobs if available
          // This avoids duplicate vision API calls
          preprocessedAttachments:
            this.preprocessingResults.processedAttachments.length > 0
              ? this.preprocessingResults.processedAttachments
              : undefined,
          environment: context.environment,
          referencedMessages: context.referencedMessages,
          referencedChannels: context.referencedChannels,
        },
        resolvedApiKey,
        isGuestMode
      );

      const processingTimeMs = Date.now() - startTime;

      logger.info(`[LLMGenerationHandler] Job ${job.id} completed in ${processingTimeMs}ms`);

      const jobResult: LLMGenerationResult = {
        requestId,
        success: true,
        content: response.content,
        attachmentDescriptions: response.attachmentDescriptions,
        referencedMessagesDescriptions: response.referencedMessagesDescriptions,
        metadata: {
          retrievedMemories: response.retrievedMemories,
          tokensIn: response.tokensIn,
          tokensOut: response.tokensOut,
          processingTimeMs,
          modelUsed: response.modelUsed,
          providerUsed: resolvedProvider,
          configSource, // 'personality' | 'user-personality' | 'user-default'
          isGuestMode, // True if using free model (no API key)
        },
      };

      logger.debug({ jobResult }, '[LLMGenerationHandler] Returning job result');

      return jobResult;
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;

      logger.error({ err: error }, `[LLMGenerationHandler] Job ${job.id} failed`);

      const jobResult: LLMGenerationResult = {
        requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        // Include personality's custom error message for webhook response
        personalityErrorMessage: personality.errorMessage,
        metadata: {
          processingTimeMs,
        },
      };

      return jobResult;
    }
  }
}
