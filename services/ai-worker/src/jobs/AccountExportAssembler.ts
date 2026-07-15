/**
 * Account Export Assembler
 *
 * Pure DB-read assembly of a user's full-account export payload (data
 * portability). Separated from the job wrapper for testability, mirroring
 * the ShapesExportFormatters split.
 *
 * Deliberate exclusions, each documented in the payload's meta.notes so the
 * user sees them: secret material (BYOK keys/credentials export metadata
 * only — encrypted blobs are useless and plaintext behind a bearer-URL is a
 * hazard), embedding vectors (model internals, not user content), avatar and
 * voice-reference binaries (avatars are re-downloadable via /avatars; voice
 * references were user-supplied), stored export-file contents, and raw
 * usage logs (an aggregate summary ships instead).
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';

/** Page size for cursor sweeps over the big tables (bounded-query rule). */
const EXPORT_PAGE_SIZE = 1000;

export interface AccountExportFile {
  meta: {
    exportedAt: string;
    formatVersion: 1;
    notes: string[];
  };
  profile: Record<string, unknown>;
  personas: unknown[];
  characters: unknown[];
  personalityConfigs: unknown[];
  personaHistoryConfigs: unknown[];
  conversationHistory: unknown[];
  memories: unknown[];
  facts: unknown[];
  llmConfigs: unknown[];
  ttsConfigs: unknown[];
  apiKeyMetadata: unknown[];
  credentialMetadata: unknown[];
  usageSummary: unknown[];
  feedback: unknown[];
  importJobs: unknown[];
  exportJobs: unknown[];
  releaseDeliveries: unknown[];
}

const EXPORT_NOTES = [
  'API keys and external credentials are listed as metadata only; secret material is never exported.',
  'Memory embedding vectors are model internals and are not included.',
  'Avatar images and voice-reference audio binaries are not included; avatars remain downloadable from the bot while the character exists.',
  'Stored export/import file contents are not re-embedded; only job metadata is listed.',
  'Usage is an aggregate summary per provider/model; raw per-request logs are not included.',
];

/**
 * Cursor-sweep a table without clipping: bounded pages, unbounded total —
 * an export must cover the whole account (same idiom as the broadcast
 * recipient resolver).
 */
async function sweep<T extends { id: string }>(
  fetchPage: (cursor: string | undefined) => Promise<T[]>
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    rows.push(...page);
    if (page.length < EXPORT_PAGE_SIZE) {
      return rows;
    }
    cursor = page[page.length - 1].id;
  }
}

function pageArgs(cursor: string | undefined): {
  take: number;
  orderBy: { id: 'asc' };
  cursor?: { id: string };
  skip?: number;
} {
  return {
    take: EXPORT_PAGE_SIZE,
    orderBy: { id: 'asc' },
    ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

/** The small per-user sections: configs, key/credential metadata, usage
 *  aggregate, feedback, job metadata, delivery log. Fetched in parallel. */
async function fetchAncillarySections(
  prisma: PrismaClient,
  userId: string
): Promise<{
  personalityConfigs: unknown[];
  personaHistoryConfigs: unknown[];
  llmConfigs: unknown[];
  ttsConfigs: unknown[];
  apiKeyMetadata: unknown[];
  credentialMetadata: unknown[];
  usageSummary: unknown[];
  feedback: unknown[];
  importJobs: unknown[];
  exportJobs: unknown[];
  releaseDeliveries: unknown[];
}> {
  const [
    personalityConfigs,
    personaHistoryConfigs,
    llmConfigs,
    ttsConfigs,
    apiKeyMetadata,
    credentialMetadata,
    usageSummary,
    feedback,
    importJobs,
    exportJobs,
    releaseDeliveries,
  ] = await Promise.all([
    sweep(c => prisma.userPersonalityConfig.findMany({ where: { userId }, ...pageArgs(c) })),
    sweep(c => prisma.userPersonaHistoryConfig.findMany({ where: { userId }, ...pageArgs(c) })),
    sweep(c => prisma.llmConfig.findMany({ where: { ownerId: userId }, ...pageArgs(c) })),
    sweep(c => prisma.ttsConfig.findMany({ where: { ownerId: userId }, ...pageArgs(c) })),
    sweep(c =>
      prisma.userApiKey.findMany({
        where: { userId },
        select: { id: true, provider: true, createdAt: true, updatedAt: true },
        ...pageArgs(c),
      })
    ),
    sweep(c =>
      prisma.userCredential.findMany({
        where: { userId },
        select: { id: true, service: true, credentialType: true, createdAt: true, expiresAt: true },
        ...pageArgs(c),
      })
    ),
    prisma.usageLog.groupBy({
      by: ['provider', 'model'],
      where: { userId },
      _count: { _all: true },
      _sum: { tokensIn: true, tokensOut: true },
    }),
    sweep(c => prisma.userFeedback.findMany({ where: { userId }, ...pageArgs(c) })),
    sweep(c => prisma.importJob.findMany({ where: { userId }, ...pageArgs(c) })),
    sweep(c =>
      prisma.exportJob.findMany({
        where: { userId },
        omit: { fileContent: true },
        ...pageArgs(c),
      })
    ),
    sweep(c => prisma.releaseDeliveryLog.findMany({ where: { userId }, ...pageArgs(c) })),
  ]);

  return {
    personalityConfigs,
    personaHistoryConfigs,
    llmConfigs,
    ttsConfigs,
    apiKeyMetadata,
    credentialMetadata,
    usageSummary,
    feedback,
    importJobs,
    exportJobs,
    releaseDeliveries,
  };
}

/**
 * Every co-ownership junction row for the user. The junction has a composite
 * PK (personalityId, userId); with userId fixed, personalityId is a valid
 * cursor on its own.
 */
async function sweepOwnerships(prisma: PrismaClient, userId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.personalityOwner.findMany({
      where: { userId, ...(cursor !== undefined ? { personalityId: { gt: cursor } } : {}) },
      select: { personalityId: true },
      orderBy: { personalityId: 'asc' },
      take: EXPORT_PAGE_SIZE,
    });
    ids.push(...page.map(row => row.personalityId));
    if (page.length < EXPORT_PAGE_SIZE) {
      return ids;
    }
    cursor = page[page.length - 1].personalityId;
  }
}

/** Owned + co-owned character definitions, via the ownership junction. */
async function fetchCharacters(prisma: PrismaClient, userId: string): Promise<unknown[]> {
  const coOwned = await sweepOwnerships(prisma, userId);
  const directlyOwned = await sweep(c =>
    prisma.personality.findMany({
      where: { ownerId: userId },
      select: { id: true },
      ...pageArgs(c),
    })
  );
  const personalityIds = [...new Set([...coOwned, ...directlyOwned.map(row => row.id)])];
  return sweep(c =>
    prisma.personality.findMany({
      where: { id: { in: personalityIds } },
      ...pageArgs(c),
      // Everything except binary blobs — the definition is the user's content.
      omit: { avatarData: true, voiceReferenceData: true },
    })
  );
}

export async function assembleAccountExport(
  prisma: PrismaClient,
  userId: string
): Promise<AccountExportFile> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      discordId: true,
      username: true,
      timezone: true,
      nsfwVerified: true,
      nsfwVerifiedAt: true,
      notifyEnabled: true,
      notifyLevel: true,
      createdAt: true,
    },
  });

  const personas = await sweep(c =>
    prisma.persona.findMany({ where: { ownerId: userId }, ...pageArgs(c) })
  );
  const personaIds = personas.map(persona => persona.id);

  const characters = await fetchCharacters(prisma, userId);

  const conversationHistory = await sweep(cursor =>
    prisma.conversationHistory.findMany({
      where: { personaId: { in: personaIds } },
      ...pageArgs(cursor),
    })
  );

  // Embedding vectors are Unsupported("vector") columns — the Prisma client
  // never returns them, so no omit is needed for the "no embeddings" note.
  const memories = await sweep(cursor =>
    prisma.memory.findMany({
      where: { personaId: { in: personaIds } },
      ...pageArgs(cursor),
    })
  );

  const facts = await sweep(cursor =>
    prisma.memoryFact.findMany({
      where: { personaId: { in: personaIds } },
      ...pageArgs(cursor),
    })
  );

  const ancillary = await fetchAncillarySections(prisma, userId);

  return {
    meta: {
      exportedAt: new Date().toISOString(),
      formatVersion: 1,
      notes: EXPORT_NOTES,
    },
    profile: user,
    personas,
    characters,
    conversationHistory,
    memories,
    facts,
    ...ancillary,
  };
}
