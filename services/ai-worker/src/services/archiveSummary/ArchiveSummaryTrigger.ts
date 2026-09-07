/**
 * Memory-Archive Summarizer Trigger (slice B1, write side)
 *
 * Called as a fire-and-forget tail step after a non-chunked memory row is
 * stored. Enqueues exactly one archive-summary job keyed by the memory's own
 * id — a deterministic BullMQ jobId, so an enqueue storm (a retried write, a
 * re-summarize sweep) dedupes to the single in-flight job for that row.
 *
 * Mirrors `ExtractionTrigger`'s throw-proof posture: this rides the
 * memory-write tail and must never fail the reply pipeline, so every failure
 * is logged and swallowed.
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Queue } from 'bullmq';
import { JobType } from '@tzurot/common-types/constants/queue';
import type { ArchiveSummaryJobData } from '@tzurot/common-types/types/jobs';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('ArchiveSummaryTrigger');

export class ArchiveSummaryTrigger {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: Queue,
    /** Runtime job-creation switch, read per fire. */
    private readonly enabled: () => boolean
  ) {}

  async enqueue(input: {
    memoryId: string;
    personalityId: string;
    reason: 'write' | 'retrieval' | 'sweep';
  }): Promise<void> {
    try {
      // @spec MEM-ARCH-013
      if (!this.enabled()) {
        return;
      }

      const jobData: ArchiveSummaryJobData = {
        requestId: `archive-summary-${input.memoryId}`,
        jobType: JobType.ArchiveSummary,
        responseDestination: { type: 'api' },
        version: 1,
        memoryId: input.memoryId,
        personalityId: input.personalityId,
        reason: input.reason,
      };

      await this.queue.add(JobType.ArchiveSummary, jobData, {
        jobId: input.memoryId, // deterministic — dedupes a re-enqueue of the same row
      });

      // `done` and `dead` are both terminal here: this stamp never re-admits
      // either one, matching the schema's invariant that a dead row is
      // re-admitted only by a content edit or a prompt-version bump. A `done`
      // row being re-summarized keeps its live summary and its `done` status
      // until the new one lands, so the render never loses a summary it
      // already has. A `dead` row with a stale prompt version still gets
      // re-summarized despite its status never being reset here: the
      // processor loads it as `dead` with an outdated `summary_prompt_version`,
      // so its idempotence check (which additionally requires the row to be
      // current) does not fire, and the job proceeds — preserving the
      // prompt-version-bump re-admission path through a different mechanism.
      await this.prisma.$executeRaw`
        UPDATE memories
        SET summary_status = CASE WHEN summary_status IN ('done', 'dead') THEN summary_status ELSE 'pending' END,
            summary_requested_at = NOW()
        WHERE id = ${input.memoryId}::uuid
      `;
    } catch (error) {
      logger.debug(
        { err: error, memoryId: input.memoryId, personalityId: input.personalityId },
        'Archive-summary trigger failed — summarization delayed, memory is safe in Postgres'
      );
    }
  }
}
