/**
 * Memory-archive summarizer: row load + raw-SQL writes.
 *
 * Split out of ArchiveSummaryProcessor.ts to keep both modules under the
 * max-lines limit, and to give the PGLite component test a focused surface.
 *
 * ALL writes here use `prisma.$executeRaw`, never `prisma.memory.update`:
 * `memories` is sync-tracked and dev↔prod reconciliation is last-write-wins
 * on `updated_at` (`.claude/rules/03-database.md` § Sync-Tracked Tables), so a
 * Prisma `update()` would let a machine-generated summary out-rank a genuine
 * content edit made in the other environment.
 *
 * Raw SQL also lets every write carry a content guard (`AND content =
 * ${expectedContent}`): a user can edit a memory's content while a job is
 * mid-flight, and the guard makes that write a no-op against the now-stale
 * row rather than resurrecting a summary of content the row no longer holds.
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { MAX_SUMMARY_ATTEMPTS } from './constants.js';

/** One row's fields as loaded for summarization. */
export interface ArchiveSummaryRow {
  id: string;
  content: string;
  personalityId: string;
  personaId: string | null;
  ownerId: string | null;
  summaryStatus: string | null;
  summaryAttempts: number;
  sourceContentHash: string | null;
  summaryPromptVersion: number | null;
  personaName: string | null;
  personalityName: string;
}

interface RawRow {
  id: string;
  content: string;
  personality_id: string;
  persona_id: string | null;
  owner_id: string | null;
  summary_status: string | null;
  summary_attempts: number;
  source_content_hash: string | null;
  summary_prompt_version: number | null;
  persona_name: string | null;
  personality_name: string;
}

/** Load one memory row plus the persona/personality names the prompt needs. */
export async function loadArchiveSummaryRow(
  prisma: PrismaClient,
  memoryId: string
): Promise<ArchiveSummaryRow | null> {
  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT m.id, m.content, m.personality_id, m.persona_id, m.summary_status,
           m.summary_attempts, m.source_content_hash, m.summary_prompt_version,
           persona.owner_id AS owner_id,
           COALESCE(persona.preferred_name, persona.name) AS persona_name,
           COALESCE(personality.display_name, personality.name) AS personality_name
    FROM memories m
    LEFT JOIN personas persona ON m.persona_id = persona.id
    JOIN personalities personality ON m.personality_id = personality.id
    WHERE m.id = ${memoryId}::uuid
  `;
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    content: row.content,
    personalityId: row.personality_id,
    personaId: row.persona_id,
    ownerId: row.owner_id,
    summaryStatus: row.summary_status,
    summaryAttempts: row.summary_attempts,
    sourceContentHash: row.source_content_hash,
    summaryPromptVersion: row.summary_prompt_version,
    personaName: row.persona_name,
    personalityName: row.personality_name,
  };
}

/** @spec MEM-ARCH-016
 * Write a successful summarization. Raw SQL never bumps `updated_at`.
 * `expectedContent` guards the write against a content edit landing between
 * load and write; the update becomes a no-op when the content no longer
 * matches, and the caller reads that from the returned affected-row count —
 * `$executeRaw` resolving to that count is pinned by
 * `rosterBlurbSweep.component.test.ts`'s `stampMissingHashes` suite, not
 * assumed. */
export async function writeArchiveSummarySuccess(
  prisma: PrismaClient,
  input: {
    memoryId: string;
    expectedContent: string;
    summary: string;
    model: string;
    promptVersion: number;
    sourceContentHash: string;
  }
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE memories
    SET assistant_summary = ${input.summary}, summary_status = 'done', summary_model = ${input.model},
        summary_prompt_version = ${input.promptVersion}, source_content_hash = ${input.sourceContentHash},
        summary_completed_at = NOW(), summary_attempts = 0, summary_last_error = NULL
    WHERE id = ${input.memoryId}::uuid AND content = ${input.expectedContent}
  `;
}

/** @spec MEM-ARCH-020
 * Write a BILLED failure (a model call happened and spent tokens). The
 * attempts count and the resulting status are computed from the SAME CASE
 * expression so they can never disagree from a stale JS read racing a
 * concurrent write. Three billed failures against the same content **and**
 * prompt version mark the row `dead`; a content edit or a prompt-version
 * bump each restart the count at 1. `expectedContent` guards the write
 * against a content edit landing between load and write; the caller reads a
 * no-op write from the returned affected-row count. The write also stamps
 * the prompt version that produced this terminal verdict, so a re-enqueue of
 * a `dead` row skips instead of re-billing.
 */
export async function writeArchiveSummaryFailure(
  prisma: PrismaClient,
  input: {
    memoryId: string;
    expectedContent: string;
    sourceContentHash: string;
    errorClass: string;
    promptVersion: number;
  }
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE memories
    SET summary_attempts = CASE WHEN source_content_hash = ${input.sourceContentHash} AND summary_prompt_version = ${input.promptVersion} THEN summary_attempts + 1 ELSE 1 END,
        source_content_hash = ${input.sourceContentHash},
        summary_last_error = ${input.errorClass},
        summary_prompt_version = ${input.promptVersion},
        summary_status = CASE
          WHEN (CASE WHEN source_content_hash = ${input.sourceContentHash} AND summary_prompt_version = ${input.promptVersion} THEN summary_attempts + 1 ELSE 1 END) >= ${MAX_SUMMARY_ATTEMPTS}
          THEN 'dead' ELSE 'failed' END
    WHERE id = ${input.memoryId}::uuid AND content = ${input.expectedContent}
  `;
}

/** @spec MEM-ARCH-015
 * Mark a row dead because its content does not match the stored template.
 * Not a billed failure — no model call was made, so no attempts are spent.
 * `expectedContent` guards the write against a content edit landing between
 * load and write; the caller reads a no-op write from the returned
 * affected-row count. The write also stamps the prompt version that produced
 * this terminal verdict, so a re-enqueue of a `dead` row skips instead of
 * re-billing. */
export async function writeArchiveSummaryNoTemplate(
  prisma: PrismaClient,
  input: {
    memoryId: string;
    expectedContent: string;
    sourceContentHash: string;
    promptVersion: number;
  }
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE memories
    SET summary_status = 'dead', summary_last_error = 'no_template', source_content_hash = ${input.sourceContentHash},
        summary_prompt_version = ${input.promptVersion}
    WHERE id = ${input.memoryId}::uuid AND content = ${input.expectedContent}
  `;
}
