/**
 * Validated Queue Wrapper
 *
 * Defensive wrapper around BullMQ queue.add() that validates job payloads
 * before enqueueing them. This provides a central enforcement point for
 * contract validation, preventing invalid jobs from entering the queue.
 *
 * Usage:
 *   import { addValidatedJob } from './validatedQueue.js';
 *
 *   // Instead of:
 *   await queue.add(JobType.AudioTranscription, jobData, opts);
 *
 *   // Use:
 *   await addValidatedJob(queue, JobType.AudioTranscription, jobData, opts);
 */

import type { Queue, JobsOptions, Job } from 'bullmq';
import {
  createLogger,
  audioTranscriptionJobDataSchema,
  imageDescriptionJobDataSchema,
  llmGenerationJobDataSchema,
  shapesImportJobDataSchema,
  shapesExportJobDataSchema,
  JobType,
} from '@tzurot/common-types';
import type { ZodSchema } from 'zod';

const logger = createLogger('ValidatedQueue');

/**
 * Map of job types to their Zod validation schemas
 * This ensures all job types have runtime validation
 */
const SCHEMA_MAP: Record<JobType, ZodSchema> = {
  [JobType.AudioTranscription]: audioTranscriptionJobDataSchema,
  [JobType.ImageDescription]: imageDescriptionJobDataSchema,
  [JobType.LLMGeneration]: llmGenerationJobDataSchema,
  [JobType.ShapesImport]: shapesImportJobDataSchema,
  [JobType.ShapesExport]: shapesExportJobDataSchema,
};

/**
 * Add a job to the queue with automatic schema validation
 *
 * @param queue - BullMQ queue instance
 * @param jobType - Type of job being created
 * @param jobData - Job payload data
 * @param opts - BullMQ job options (jobId, priority, etc.)
 * @returns BullMQ Job instance
 * @throws Error if validation fails
 *
 * @example
 * ```typescript
 * const job = await addValidatedJob(
 *   aiQueue,
 *   JobType.AudioTranscription,
 *   {
 *     requestId: 'req-123',
 *     jobType: JobType.AudioTranscription,
 *     attachment: audioFile,
 *     context: { userId: 'user-123' },
 *     responseDestination: { type: 'discord', channelId: 'channel-123' }
 *   },
 *   { jobId: 'audio-req-123' }
 * );
 * ```
 */
export async function addValidatedJob<T>(
  queue: Queue,
  jobType: JobType,
  jobData: T,
  opts?: JobsOptions
): Promise<Job> {
  const schema = SCHEMA_MAP[jobType];

  if (schema === undefined) {
    // This should never happen unless a new JobType is added without updating SCHEMA_MAP
    logger.warn({ jobType }, '[ValidatedQueue] No schema found for job type - skipping validation');
    return queue.add(jobType, jobData, opts);
  }

  // Validate payload before adding to queue
  const validation = schema.safeParse(jobData);
  if (!validation.success) {
    logger.error(
      {
        jobType,
        errors: validation.error.format(),
        jobId: opts?.jobId,
      },
      '[ValidatedQueue] Job validation failed - refusing to enqueue invalid job'
    );

    throw new Error(
      `Invalid ${jobType} job data: ${validation.error.message}. ` +
        `Errors: ${JSON.stringify(validation.error.format())}`
    );
  }

  // Validation passed - add to queue
  logger.debug(
    {
      jobType,
      jobId: opts?.jobId,
    },
    '[ValidatedQueue] Job validation succeeded - adding to queue'
  );

  return queue.add(jobType, jobData, opts);
}

/**
 * Add multiple jobs to the queue with validation
 * Validates all jobs before adding any (atomic operation)
 *
 * @param queue - BullMQ queue instance
 * @param jobs - Array of job specifications
 * @returns Array of BullMQ Job instances
 * @throws Error if any validation fails (no jobs are added)
 */
export async function addValidatedJobs(
  queue: Queue,
  jobs: {
    jobType: JobType;
    jobData: unknown;
    opts?: JobsOptions;
  }[]
): Promise<Job[]> {
  // Validate ALL jobs first (fail fast)
  for (const { jobType, jobData, opts } of jobs) {
    const schema = SCHEMA_MAP[jobType];

    if (schema === undefined) {
      logger.warn(
        { jobType },
        '[ValidatedQueue] No schema found for job type - skipping validation'
      );
      continue;
    }

    const validation = schema.safeParse(jobData);
    if (!validation.success) {
      logger.error(
        {
          jobType,
          errors: validation.error.format(),
          jobId: opts?.jobId,
        },
        '[ValidatedQueue] Batch job validation failed'
      );

      throw new Error(`Invalid ${jobType} job data in batch: ${validation.error.message}`);
    }
  }

  // All validations passed - add all jobs
  logger.debug(
    { count: jobs.length },
    '[ValidatedQueue] Batch validation succeeded - adding jobs to queue'
  );

  return Promise.all(jobs.map(({ jobType, jobData, opts }) => queue.add(jobType, jobData, opts)));
}
