/**
 * Account Export Assembler
 *
 * Pure DB-read assembly of a user's full-account export data (data
 * portability). Separated from the job wrapper for testability, mirroring
 * the ShapesExportFormatters split. AccountExportFiles turns this data into
 * the per-section ZIP file map.
 *
 * Deliberate exclusions, each documented in the export README so the user
 * sees them: secret material (BYOK keys/credentials export metadata only —
 * encrypted blobs are useless and plaintext behind a bearer-URL is a
 * hazard), embedding vectors (model internals, not user content), avatar and
 * voice-reference binaries (avatars are re-downloadable via /avatars; voice
 * references were user-supplied), stored export-file contents, and raw
 * usage logs (an aggregate summary ships instead).
 */

import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import { type PrismaClient, type Prisma } from '@tzurot/common-types/services/prisma';
import { isEmptyPersonalityConfig } from '@tzurot/common-types/utils/personalityConfigShape';

/** Page size for cursor sweeps over the big tables (bounded-query rule). */
const EXPORT_PAGE_SIZE = 1000;

const PROFILE_SELECT = {
  discordId: true,
  username: true,
  timezone: true,
  nsfwVerified: true,
  nsfwVerifiedAt: true,
  notifyEnabled: true,
  notifyLevel: true,
  createdAt: true,
  /** Personal config-cascade defaults (the user tier — what /settings
   *  defaults writes). Exported as the user's own data. */
  configDefaults: true,
} as const;

export type ExportProfile = Prisma.UserGetPayload<{ select: typeof PROFILE_SELECT }>;
export type ExportAdminSettings = Prisma.AdminSettingsGetPayload<object>;
export type ExportPersona = Prisma.PersonaGetPayload<object>;
export type ExportCharacter = Omit<
  Prisma.PersonalityGetPayload<object>,
  'avatarData' | 'voiceReferenceData'
>;
export type ExportConversationRow = Prisma.ConversationHistoryGetPayload<object>;
export type ExportMemoryRow = Prisma.MemoryGetPayload<object>;
export type ExportFactRow = Prisma.MemoryFactGetPayload<object>;
export type ExportFeedbackRow = Prisma.UserFeedbackGetPayload<object>;

export interface ExportUsageSummaryRow {
  provider: string;
  model: string;
  _count: { _all: number };
  _sum: { tokensIn: number | null; tokensOut: number | null };
}

/**
 * Name/slug lookup for every personality referenced anywhere in the export.
 * Users converse with characters they don't own, so this is a superset of
 * the owned+co-owned `characters` section — it's what lets the file builder
 * folder conversations/memories/facts by character slug.
 */
export interface PersonalityDirectoryEntry {
  id: string;
  name: string;
  slug: string;
}

export interface AccountExportData {
  meta: {
    exportedAt: string;
    formatVersion: 2;
    notes: string[];
  };
  profile: ExportProfile;
  personas: ExportPersona[];
  characters: ExportCharacter[];
  personalityDirectory: PersonalityDirectoryEntry[];
  conversationHistory: ExportConversationRow[];
  memories: ExportMemoryRow[];
  facts: ExportFactRow[];
  personalityConfigs: unknown[];
  personaHistoryConfigs: unknown[];
  llmConfigs: unknown[];
  ttsConfigs: unknown[];
  apiKeyMetadata: unknown[];
  credentialMetadata: unknown[];
  usageSummary: ExportUsageSummaryRow[];
  feedback: ExportFeedbackRow[];
  importJobs: unknown[];
  exportJobs: unknown[];
  releaseDeliveries: unknown[];
  shapesMappings: unknown[];
  /** The global admin-settings row — populated only when the exporting user
   *  is the superuser (the owner IS the admin); null for everyone else. */
  adminSettings: ExportAdminSettings | null;
}

export const EXPORT_NOTES = [
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
  usageSummary: ExportUsageSummaryRow[];
  feedback: ExportFeedbackRow[];
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
    sweep(c => prisma.userPersonalityConfig.findMany({ where: { userId }, ...pageArgs(c) })).then(
      // Drop dead anchor rows (every override slice null) — belt-and-suspenders
      // vs. the write-path prune and the one-off cleanup.
      rows => rows.filter(row => !isEmptyPersonalityConfig(row))
    ),
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
        omit: { fileContent: true, fileData: true },
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
async function fetchCharacters(prisma: PrismaClient, userId: string): Promise<ExportCharacter[]> {
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

/**
 * {id, name, slug} for every personality the export references — owned
 * characters plus any the user merely conversed with. FK cascades mean
 * referenced ids should always resolve; the unknown-<id8> fallback keeps the
 * export self-consistent if that invariant ever breaks.
 */
async function buildPersonalityDirectory(
  prisma: PrismaClient,
  characters: ExportCharacter[],
  referencedIds: Iterable<string>
): Promise<PersonalityDirectoryEntry[]> {
  const directory = new Map<string, PersonalityDirectoryEntry>();
  for (const character of characters) {
    directory.set(character.id, {
      id: character.id,
      name: character.name,
      slug: character.slug,
    });
  }

  const missing = [...new Set(referencedIds)].filter(id => !directory.has(id));
  if (missing.length > 0) {
    const rows = await sweep(c =>
      prisma.personality.findMany({
        where: { id: { in: missing } },
        select: { id: true, name: true, slug: true },
        ...pageArgs(c),
      })
    );
    for (const row of rows) {
      directory.set(row.id, row);
    }
    for (const id of missing) {
      if (!directory.has(id)) {
        directory.set(id, {
          id,
          name: 'Unknown character',
          slug: `unknown-${id.slice(0, 8)}`,
        });
      }
    }
  }

  return [...directory.values()];
}

export async function assembleAccountExport(
  prisma: PrismaClient,
  userId: string
): Promise<AccountExportData> {
  const userRow = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { ...PROFILE_SELECT, isSuperuser: true },
  });
  const { isSuperuser, ...user } = userRow;

  // The owner IS the admin, so the superuser's export includes the global
  // admin-settings row (config defaults, system settings, default-config
  // pointers — no secret material). Everyone else gets null.
  const adminSettings = isSuperuser
    ? await prisma.adminSettings.findUnique({ where: { id: ADMIN_SETTINGS_SINGLETON_ID } })
    : null;

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

  const shapesMappings = await sweep(cursor =>
    prisma.shapesPersonaMapping.findMany({
      where: { personaId: { in: personaIds } },
      ...pageArgs(cursor),
    })
  );

  const personalityDirectory = await buildPersonalityDirectory(prisma, characters, [
    ...conversationHistory.map(row => row.personalityId),
    ...memories.map(row => row.personalityId),
    ...facts.map(row => row.personalityId),
  ]);

  const ancillary = await fetchAncillarySections(prisma, userId);

  return {
    meta: {
      exportedAt: new Date().toISOString(),
      formatVersion: 2,
      notes: EXPORT_NOTES,
    },
    profile: user,
    personas,
    characters,
    personalityDirectory,
    conversationHistory,
    memories,
    facts,
    shapesMappings,
    adminSettings,
    ...ancillary,
  };
}
