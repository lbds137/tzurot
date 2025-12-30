/**
 * LLM Generation Handler
 *
 * Handles LLM generation jobs using a Pipeline Pattern for thread safety
 * and separation of concerns.
 *
 * BYOK Security Model:
 * - API keys are NEVER passed through BullMQ jobs in plaintext
 * - Keys are resolved at runtime using ApiKeyResolver
 * - Keys are decrypted only in ai-worker, stored encrypted in DB
 *
 * Pipeline Pattern:
 * This handler uses a stateless pipeline where each step receives a context
 * object and returns an updated context. This ensures:
 * - Thread safety: No instance state, no race conditions
 * - Testability: Each step can be tested independently
 * - Extensibility: New steps can be added without modifying existing code
 */

import { Job } from 'bullmq';
import { ConversationalRAGService } from '../../services/ConversationalRAGService.js';
import {
  createLogger,
  type LLMGenerationJobData,
  type LLMGenerationResult,
} from '@tzurot/common-types';
import { ApiKeyResolver } from '../../services/ApiKeyResolver.js';
import { LlmConfigResolver } from '../../services/LlmConfigResolver.js';
import {
  type IPipelineStep,
  type GenerationContext,
  ValidationStep,
  DependencyStep,
  ConfigStep,
  AuthStep,
  ContextStep,
  GenerationStep,
} from './pipeline/index.js';

const logger = createLogger('LLMGenerationHandler');

/**
 * Handler for LLM generation jobs
 *
 * Uses the Pipeline Pattern to process jobs through discrete steps:
 * 1. ValidationStep - Validates job data against schema
 * 2. DependencyStep - Fetches preprocessing results (audio/image) from Redis
 * 3. ConfigStep - Resolves LLM config with user overrides
 * 4. AuthStep - Resolves API key (BYOK) and handles guest mode
 * 5. ContextStep - Prepares conversation history and participants
 * 6. GenerationStep - Calls RAG service to generate response
 *
 * Each step is stateless - context flows through as function arguments,
 * ensuring thread safety when handling concurrent jobs.
 *
 * ## Error Handling / Failure Behavior
 *
 * **All pipeline steps are critical** - any failure stops the pipeline and returns
 * an error result. There are no "optional" steps that can be skipped on failure.
 *
 * **ValidationStep** runs outside try/catch:
 * - Validation errors indicate programming errors (malformed job data)
 * - These propagate as exceptions and fail the BullMQ job directly
 * - No error result is returned; the job goes to the failed queue
 *
 * **Steps 2-6** run inside try/catch:
 * - Errors are caught and converted to error results with `success: false`
 * - Error results include `failedStep` and `lastSuccessfulStep` for debugging
 * - These are "soft failures" - the job completes but reports an error to the client
 *
 * This design ensures:
 * - BullMQ retries are only used for transient infrastructure failures (validation errors)
 * - Application-level errors (API rate limits, model unavailable) return error messages to users
 * - Debugging information is always available in the error result metadata
 */
export class LLMGenerationHandler {
  private readonly pipeline: IPipelineStep[];

  constructor(
    ragService: ConversationalRAGService,
    apiKeyResolver?: ApiKeyResolver,
    configResolver?: LlmConfigResolver
  ) {
    // Build the pipeline with all steps
    // Order matters: each step may depend on results from previous steps
    this.pipeline = [
      new ValidationStep(),
      new DependencyStep(),
      new ConfigStep(configResolver),
      new AuthStep(apiKeyResolver, configResolver),
      new ContextStep(),
      new GenerationStep(ragService),
    ];
  }

  /**
   * Process LLM generation job through the pipeline
   */
  async processJob(job: Job<LLMGenerationJobData>): Promise<LLMGenerationResult> {
    const startTime = Date.now();

    // Initialize context - this is the only state, and it's scoped to this call
    let context: GenerationContext = {
      job,
      startTime,
    };

    // Run validation first (outside try/catch so validation errors propagate)
    // Validation errors indicate programming errors and should fail the job
    const validationStep = this.pipeline[0];
    context = await validationStep.process(context);

    logger.info(
      { jobId: job.id, requestId: job.data.requestId, personality: job.data.personality?.name },
      '[LLMGenerationHandler] Processing job through pipeline'
    );

    // Track which step we're on for error reporting
    let currentStepName = 'unknown';
    let lastSuccessfulStep = 'ValidationStep';

    try {
      // Execute remaining pipeline steps in order (skip validation, already done)
      for (let i = 1; i < this.pipeline.length; i++) {
        const step = this.pipeline[i];
        currentStepName = step.name;

        logger.debug(
          { jobId: job.id, step: step.name },
          '[LLMGenerationHandler.processJob] Executing pipeline step'
        );

        context = await step.process(context);
        lastSuccessfulStep = step.name;
      }

      // Verify we have a result
      if (!context.result) {
        throw new Error('Pipeline completed but no result was generated');
      }

      const processingTimeMs = Date.now() - startTime;
      logger.info(
        { jobId: job.id, processingTimeMs, success: context.result.success },
        '[LLMGenerationHandler.processJob] Job completed'
      );

      return context.result;
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;

      logger.error(
        {
          err: error,
          jobId: job.id,
          processingTimeMs,
          failedStep: currentStepName,
          lastSuccessfulStep,
        },
        '[LLMGenerationHandler.processJob] Pipeline failed'
      );

      // Return error result with step information for debugging
      return {
        requestId: job.data.requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        personalityErrorMessage: job.data.personality.errorMessage,
        metadata: {
          processingTimeMs,
          failedStep: currentStepName,
          lastSuccessfulStep,
          errorStack: error instanceof Error ? error.stack : undefined,
        },
      };
    }
  }
}
