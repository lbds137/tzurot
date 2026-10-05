/**
 * Conversation import
 *
 * Imports an exported two-party conversation (JSON array of
 * `{ role, text, timestamp }`) as long-term memories for one personality,
 * owned by the bot owner's default persona.
 *
 * Privacy: the file is private conversation content. Nothing in this module
 * prints, logs or throws any turn text — only counts, pair indexes, ids and
 * error classes. Parse/refusal messages come from the core module and name
 * indexes only.
 *
 * Idempotent: ids derive from the pair's identity, inserts are
 * ON CONFLICT (id) DO NOTHING, and ids already present are not re-embedded.
 */

import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  requireProductionConfirmation,
} from '../utils/env-runner.js';
import { UsageError } from '../utils/errors.js';
import { getBotOwnerDiscordIdForEnv } from '../utils/gateway-client.js';
import { getPrismaForEnv } from './prisma-env.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { idPrefix } from '@tzurot/common-types/utils/logContentPreview';
import {
  EXTERNAL_IMPORT_SOURCE_SYSTEM,
  EXTRAS_QUERY_LIMIT,
  buildExpectedRows,
  compareVerifyRows,
  formatVerifyLines,
  pairTurns,
  parseConversationTurns,
  type ActualRow,
  type ExpectedRow,
  type ImportPair,
} from './import-conversation-core.js';

export interface ImportConversationOptions {
  env: Environment;
  file: string;
  personality: string;
  apply?: boolean;
  verify?: boolean;
  force?: boolean;
}

/** Where the target persona came from: a per-personality override, or the user's default. */
type PersonaSource = 'override' | 'default';

interface Target {
  personalityId: string;
  personaId: string;
  personaSource: PersonaSource;
}

/** Error class/code only: raw-SQL errors can echo bound parameter values (memory text). */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${error.name} ${code}` : error.name;
  }
  return 'Unknown';
}

/** Read + parse + pair the file BEFORE any DB connection. Never echoes file content. */
async function loadPairs(file: string): Promise<ImportPair[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf-8');
  } catch (error) {
    throw new UsageError(`Cannot read --file (${describeError(error)})`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // JSON.parse messages can quote a snippet of the input, so none is surfaced.
    throw new UsageError('--file is not valid JSON');
  }
  return pairTurns(parseConversationTurns(raw));
}

async function resolveTarget(
  prisma: PrismaClient,
  env: Environment,
  slug: string
): Promise<Target> {
  const personalities = await prisma.$queryRawUnsafe<{ id: string }[]>(
    'SELECT id FROM personalities WHERE slug = $1 LIMIT 1',
    slug
  );
  if (personalities[0] === undefined) {
    throw new UsageError(`No personality with slug '${slug}'`);
  }

  const ownerDiscordId = getBotOwnerDiscordIdForEnv(env);
  const users = await prisma.$queryRawUnsafe<{ id: string; default_persona_id: string }[]>(
    'SELECT id, default_persona_id FROM users WHERE discord_id = $1 LIMIT 1',
    ownerDiscordId
  );
  if (users[0] === undefined) {
    throw new UsageError('The bot owner has no user row in this environment');
  }
  // Same order as PersonaResolver: the per-personality override wins, then the user default.
  const overrides = await prisma.$queryRawUnsafe<{ persona_id: string | null }[]>(
    'SELECT persona_id FROM user_personality_configs WHERE user_id = $1::uuid AND personality_id = $2::uuid LIMIT 1',
    users[0].id,
    personalities[0].id
  );
  const overrideId = overrides[0]?.persona_id ?? null;
  const personaId = overrideId ?? users[0].default_persona_id;
  const personaSource: PersonaSource = overrideId === null ? 'default' : 'override';
  const personas = await prisma.$queryRawUnsafe<{ id: string }[]>(
    'SELECT id FROM personas WHERE id = $1::uuid LIMIT 1',
    personaId
  );
  if (personas[0] === undefined) {
    throw new UsageError(`The bot owner's ${personaSource} persona row is missing`);
  }
  return { personalityId: personalities[0].id, personaId, personaSource };
}

async function findExistingIds(prisma: PrismaClient, ids: string[]): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    'SELECT id FROM memories WHERE id = ANY($1::uuid[]) LIMIT $2',
    ids,
    ids.length
  );
  return new Set(rows.map(row => row.id));
}

function printSummary(
  pairs: ImportPair[],
  slug: string,
  target: Target,
  existing: number,
  apply: boolean
): void {
  console.log(chalk.cyan('\n📥 Conversation import'));
  console.log(chalk.dim(`   Pairs: ${pairs.length}`));
  console.log(
    chalk.dim(
      `   Range: ${pairs[0].promptAt.toISOString()} → ${pairs[pairs.length - 1].promptAt.toISOString()}`
    )
  );
  console.log(chalk.dim(`   Personality: ${slug}`));
  console.log(chalk.dim(`   Persona: ${idPrefix(target.personaId)}… (${target.personaSource})`));
  console.log(chalk.dim(`   Already imported: ${existing}`));
  if (!apply) {
    console.log(chalk.blue('\n   DRY RUN — pass --apply to write'));
  }
}

async function insertMemory(
  prisma: PrismaClient,
  row: ExpectedRow,
  target: Target,
  embedding: Float32Array
): Promise<boolean> {
  const embeddingStr = `[${Array.from(embedding).join(',')}]`;
  const now = new Date();
  const result = await prisma.$executeRaw`
    INSERT INTO memories (
      id, persona_id, personality_id, content, embedding,
      is_summarized, session_id, canon_scope, summary_type,
      channel_id, guild_id, message_ids, senders,
      created_at, updated_at, source_system, type, is_locked, visibility
    ) VALUES (
      ${row.id}::uuid, ${target.personaId}::uuid, ${target.personalityId}::uuid,
      ${row.content}, ${embeddingStr}::vector,
      false, NULL, 'personal', NULL,
      NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
      ${row.createdAt}, ${now}, ${EXTERNAL_IMPORT_SOURCE_SYSTEM}, 'memory', false, 'normal'
    )
    ON CONFLICT (id) DO NOTHING
  `;
  return result > 0;
}

/** Embed and insert the rows not yet present, sequentially (single in-process ONNX model). */
async function embedAndInsert(
  prisma: PrismaClient,
  rows: ExpectedRow[],
  existing: Set<string>,
  target: Target
): Promise<{ inserted: number; alreadyExisted: number; failed: number }> {
  let inserted = 0;
  let failed = 0;
  const todo = rows.filter(row => !existing.has(row.id));
  let alreadyExisted = rows.length - todo.length;
  if (todo.length === 0) {
    return { inserted, alreadyExisted, failed };
  }

  const { LocalEmbeddingService } = await import('@tzurot/embeddings');
  const embeddingService = new LocalEmbeddingService();
  if (!(await embeddingService.initialize())) {
    throw new Error('Failed to initialize embedding service');
  }
  try {
    for (const row of todo) {
      try {
        const embedding = await embeddingService.getEmbedding(row.content);
        if (embedding === undefined) {
          console.error(chalk.red(`   Pair ${row.index}: embedding failed`));
          failed++;
          continue;
        }
        if (await insertMemory(prisma, row, target, embedding)) {
          inserted++;
        } else {
          alreadyExisted++;
        }
      } catch (error) {
        console.error(chalk.red(`   Pair ${row.index}: insert failed (${describeError(error)})`));
        failed++;
      }
    }
  } finally {
    await embeddingService.shutdown();
  }
  return { inserted, alreadyExisted, failed };
}

/** Read-only verification of what is in the DB against what the file implies. */
async function verifyImport(
  prisma: PrismaClient,
  expected: ExpectedRow[],
  target: Target
): Promise<void> {
  const ids = expected.map(row => row.id);
  const { actual, extraTaggedIds } = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const found = await tx.$queryRawUnsafe<ActualRow[]>(
      `SELECT id, content, created_at, personality_id, persona_id
       FROM memories WHERE id = ANY($1::uuid[]) LIMIT $2`,
      ids,
      ids.length
    );
    const extras = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM memories
       WHERE source_system = $1 AND personality_id = $2::uuid AND persona_id = $3::uuid
         AND id <> ALL($4::uuid[])
       LIMIT $5`,
      EXTERNAL_IMPORT_SOURCE_SYSTEM,
      target.personalityId,
      target.personaId,
      ids,
      EXTRAS_QUERY_LIMIT
    );
    return { actual: found, extraTaggedIds: extras.map(row => row.id) };
  });

  const checks = compareVerifyRows({ expected, actual, extraTaggedIds, target });
  console.log(chalk.cyan('\n🔍 Verify'));
  for (const [i, line] of formatVerifyLines(checks).entries()) {
    console.log(checks[i].pass ? chalk.green(`   ${line}`) : chalk.red(`   ${line}`));
  }
  if (checks.some(check => !check.pass)) {
    process.exitCode = 1;
  }
}

export async function importConversation(options: ImportConversationOptions): Promise<void> {
  const { env, file, personality, apply = false, verify = false, force = false } = options;

  validateEnvironment(env);
  showEnvironmentBanner(env);

  const pairs = await loadPairs(file);

  const { prisma, disconnect } = await getPrismaForEnv(env);
  try {
    const target = await resolveTarget(prisma, env, personality);
    const expected = buildExpectedRows(pairs, target.personaId, target.personalityId);
    const existing = await findExistingIds(
      prisma,
      expected.map(row => row.id)
    );
    printSummary(pairs, personality, target, existing.size, apply);

    if (apply) {
      if (env === 'prod' && !force) {
        await requireProductionConfirmation('import conversation memories');
      }
      const { inserted, alreadyExisted, failed } = await embedAndInsert(
        prisma,
        expected,
        existing,
        target
      );
      console.log(chalk.green('\n✅ Import complete'));
      console.log(chalk.dim(`   Inserted: ${inserted}`));
      console.log(chalk.dim(`   Already existed: ${alreadyExisted}`));
      if (failed > 0) {
        console.log(chalk.yellow(`   Failed: ${failed}`));
        process.exitCode = 1;
      }
    }

    if (verify) {
      await verifyImport(prisma, expected, target);
    }
  } finally {
    await disconnect();
  }
}
