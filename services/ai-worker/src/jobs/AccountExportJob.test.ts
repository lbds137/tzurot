import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { unzipSync, strFromU8 } from 'fflate';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { AccountExportJobData } from '@tzurot/common-types/types/account-export';
import type { AccountExportData } from './AccountExportAssembler.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const assembleMock = vi.hoisted(() => vi.fn());
vi.mock('./AccountExportAssembler.js', () => ({
  assembleAccountExport: assembleMock,
}));

import { processAccountExportJob } from './AccountExportJob.js';

const mockPrisma = {
  exportJob: { update: vi.fn().mockResolvedValue({}) },
} as unknown as PrismaClient;

function makeJob(
  attempt: { attemptsMade?: number; attempts?: number } = {}
): Job<AccountExportJobData> {
  return {
    id: 'bullmq-1',
    data: { userId: 'user-uuid-1', exportJobId: 'export-job-1' },
    attemptsMade: attempt.attemptsMade ?? 0,
    opts: { attempts: attempt.attempts ?? 1 },
  } as unknown as Job<AccountExportJobData>;
}

const NOW = new Date('2026-07-15T12:00:00Z');

/** Minimal but formatter-complete payload: the job runs the REAL file
 *  builder + zip, so every field the markdown formatters touch is present. */
function makePayload(): AccountExportData {
  return {
    meta: { exportedAt: NOW.toISOString(), formatVersion: 2, notes: ['note one'] },
    profile: {
      username: 'alice',
      discordId: '123456789012345678',
      timezone: 'UTC',
      nsfwVerified: false,
      nsfwVerifiedAt: null,
      notifyEnabled: true,
      notifyLevel: 'minor',
      createdAt: NOW,
      configDefaults: null,
    },
    personas: [
      {
        id: 'aaaaaaaa-1111-2222-3333-444444444444',
        name: 'Nyx',
        preferredName: null,
        pronouns: null,
        description: null,
        content: 'about me',
        ownerId: 'user-uuid-1',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    characters: [],
    personalityDirectory: [{ id: 'char-1', name: 'Azura', slug: 'azura' }],
    conversationHistory: [
      {
        id: 'msg-1',
        channelId: 'chan-1',
        guildId: null,
        personalityId: 'char-1',
        personaId: 'aaaaaaaa-1111-2222-3333-444444444444',
        role: 'user',
        content: 'hello there',
        createdAt: NOW,
        deletedAt: null,
        editedAt: null,
      },
      {
        id: 'msg-2',
        channelId: 'chan-1',
        guildId: null,
        personalityId: 'char-1',
        personaId: 'aaaaaaaa-1111-2222-3333-444444444444',
        role: 'assistant',
        content: 'greetings',
        createdAt: NOW,
        deletedAt: null,
        editedAt: null,
      },
    ] as unknown as AccountExportData['conversationHistory'],
    memories: [
      {
        id: 'mem-1',
        personalityId: 'char-1',
        content: 'a shared moment',
        createdAt: NOW,
        isLocked: false,
        visibility: 'normal',
        type: 'memory',
        isSummarized: false,
      },
    ] as unknown as AccountExportData['memories'],
    facts: [],
    personalityConfigs: [],
    personaHistoryConfigs: [],
    llmConfigs: [],
    ttsConfigs: [],
    apiKeyMetadata: [],
    credentialMetadata: [],
    usageSummary: [],
    feedback: [],
    importJobs: [],
    exportJobs: [],
    releaseDeliveries: [],
    shapesMappings: [],
    adminSettings: null,
  };
}

describe('processAccountExportJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transitions pending → in_progress → completed with a ZIP payload and metadata', async () => {
    assembleMock.mockResolvedValue(makePayload());

    const result = await processAccountExportJob(makeJob(), mockPrisma);

    expect(result.success).toBe(true);
    expect(result.fileSizeBytes).toBeGreaterThan(0);

    const updates = (mockPrisma.exportJob.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updates[0][0].data.status).toBe('in_progress');
    const final = updates[1][0].data;
    expect(final.status).toBe('completed');
    expect(final.fileName).toMatch(/^tzurot-account-export-alice-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(final.fileContent).toBeNull();
    expect(final.fileData).toBeInstanceOf(Uint8Array);
    expect(final.exportMetadata).toEqual(
      expect.objectContaining({ conversationHistory: 2, memories: 1, personas: 1 })
    );

    // The stored bytes are a real ZIP of the file map — unzip and verify.
    const files = unzipSync(final.fileData as Uint8Array);
    expect(strFromU8(files['README.md'])).toContain('Tzurot Account Export');
    expect(JSON.parse(strFromU8(files['profile.json'])).username).toBe('alice');
    expect(strFromU8(files['conversations/azura.md'])).toContain('greetings');
    expect(final.exportMetadata.files).toBe(Object.keys(files).length);
  });

  it('sanitizes usernames that are not filename-safe', async () => {
    const payload = makePayload();
    payload.profile = { ...payload.profile, username: 'a/б c!' };
    assembleMock.mockResolvedValue(payload);

    await processAccountExportJob(makeJob(), mockPrisma);

    const final = (mockPrisma.exportJob.update as ReturnType<typeof vi.fn>).mock.calls[1][0].data;
    expect(final.fileName).not.toMatch(/[/!\s]/);
  });

  it('re-throws on non-final attempts so BullMQ actually retries (row stays in_progress)', async () => {
    assembleMock.mockRejectedValue(new Error('transient pool timeout'));

    await expect(
      processAccountExportJob(makeJob({ attemptsMade: 0, attempts: 3 }), mockPrisma)
    ).rejects.toThrow('transient pool timeout');

    // Only the in_progress transition ran — the row was NOT marked failed.
    const updates = (mockPrisma.exportJob.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updates).toHaveLength(1);
    expect(updates[0][0].data.status).toBe('in_progress');
  });

  it('marks the row failed (with the error message) only on the final attempt', async () => {
    assembleMock.mockRejectedValue(new Error('db exploded'));

    const result = await processAccountExportJob(
      makeJob({ attemptsMade: 2, attempts: 3 }),
      mockPrisma
    );

    expect(result).toEqual({ success: false, fileSizeBytes: 0, error: 'db exploded' });
    const final = (mockPrisma.exportJob.update as ReturnType<typeof vi.fn>).mock.calls[1][0].data;
    expect(final.status).toBe('failed');
    expect(final.errorMessage).toBe('db exploded');
  });
});
