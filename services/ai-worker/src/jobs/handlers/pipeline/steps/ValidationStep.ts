/**
 * Validation Step
 *
 * Validates job data against the schema.
 */

import { createLogger, llmGenerationJobDataSchema } from '@tzurot/common-types';
import type { ZodIssue } from 'zod';
import type { IPipelineStep, GenerationContext } from '../types.js';

const logger = createLogger('ValidationStep');

export class ValidationStep implements IPipelineStep {
  readonly name = 'Validation';

  process(context: GenerationContext): GenerationContext {
    const { job } = context;

    const validation = llmGenerationJobDataSchema.safeParse(job.data);

    if (!validation.success) {
      // Safely extract error messages from Zod validation
      const issues: ZodIssue[] = validation.error.issues;
      const errors =
        issues.length > 0
          ? issues.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
          : validation.error.message;

      logger.error(
        {
          jobId: job.id,
          errors: validation.error.format(),
        },
        '[ValidationStep] Job validation failed'
      );

      throw new Error(`LLM generation job validation failed: ${errors}`);
    }

    logger.debug({ jobId: job.id }, '[ValidationStep] Job validation passed');

    return context;
  }
}
