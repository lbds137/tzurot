import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

const mockFindUnique = vi.hoisted(() => vi.fn());
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

// Prisma is injected into the resolver functions; this stub only needs the
// single method they call.
const mockPrisma = { user: { findUnique: mockFindUnique } } as unknown as PrismaClient;

import {
  createDiagnosticCollectorForRequest,
  resolvePersonalityOwnerDiscordId,
} from './personalityOwnerResolver.js';

describe('resolvePersonalityOwnerDiscordId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the discordId when the User row exists', async () => {
    mockFindUnique.mockResolvedValue({ discordId: '111111111111111111' });
    const result = await resolvePersonalityOwnerDiscordId(mockPrisma, 'owner-uuid');
    expect(result).toBe('111111111111111111');
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'owner-uuid' },
      select: { discordId: true },
    });
  });

  it('returns null when the User row was deleted (findUnique returns null)', async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await resolvePersonalityOwnerDiscordId(mockPrisma, 'owner-uuid');
    expect(result).toBeNull();
  });

  it('returns null and does not throw when prisma throws (transient DB error)', async () => {
    mockFindUnique.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const result = await resolvePersonalityOwnerDiscordId(mockPrisma, 'owner-uuid');
    expect(result).toBeNull();
  });

  it('returns null when the User row exists but discordId is missing', async () => {
    // Defensive: shouldn't happen per schema (discordId is required), but
    // guards against a future schema that drops the column.
    mockFindUnique.mockResolvedValue({});
    const result = await resolvePersonalityOwnerDiscordId(mockPrisma, 'owner-uuid');
    expect(result).toBeNull();
  });
});

describe('createDiagnosticCollectorForRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('threads the resolved Discord ID into the collector meta', async () => {
    mockFindUnique.mockResolvedValue({ discordId: '111111111111111111' });
    const collector = await createDiagnosticCollectorForRequest({
      prisma: mockPrisma,
      requestId: 'r1',
      personalityId: 'p1',
      personalityName: 'TestPersonality',
      personalityOwnerInternalId: 'owner-uuid',
      userId: 'user-discord-id',
    });
    const payload = collector.finalize();
    expect(payload.meta.personalityOwnerDiscordId).toBe('111111111111111111');
    expect(payload.meta.personalityName).toBe('TestPersonality');
  });

  it('produces undefined personalityOwnerDiscordId in meta when owner resolution fails', async () => {
    mockFindUnique.mockRejectedValue(new Error('db down'));
    const collector = await createDiagnosticCollectorForRequest({
      prisma: mockPrisma,
      requestId: 'r1',
      personalityId: 'p1',
      personalityName: 'TestPersonality',
      personalityOwnerInternalId: 'owner-uuid',
      userId: 'user-discord-id',
    });
    const payload = collector.finalize();
    expect(payload.meta.personalityOwnerDiscordId).toBeUndefined();
  });

  it('passes through optional fields (triggerMessageId, serverId, channelId)', async () => {
    mockFindUnique.mockResolvedValue({ discordId: '999' });
    const collector = await createDiagnosticCollectorForRequest({
      prisma: mockPrisma,
      requestId: 'r1',
      triggerMessageId: 'msg-1',
      personalityId: 'p1',
      personalityName: 'TestPersonality',
      personalityOwnerInternalId: 'owner-uuid',
      userId: 'user-discord-id',
      serverId: 'guild-1',
      channelId: 'channel-1',
    });
    const payload = collector.finalize();
    expect(payload.meta.triggerMessageId).toBe('msg-1');
    expect(payload.meta.guildId).toBe('guild-1');
    expect(payload.meta.channelId).toBe('channel-1');
  });

  it('coerces undefined serverId to null in meta (DM convention)', async () => {
    mockFindUnique.mockResolvedValue({ discordId: '999' });
    const collector = await createDiagnosticCollectorForRequest({
      prisma: mockPrisma,
      requestId: 'r1',
      personalityId: 'p1',
      personalityName: 'TestPersonality',
      personalityOwnerInternalId: 'owner-uuid',
      userId: 'user-discord-id',
      // No serverId — DM context
    });
    const payload = collector.finalize();
    expect(payload.meta.guildId).toBeNull();
  });
});

/**
 * Structural guard: prevent future write paths from constructing
 * DiagnosticCollector directly and bypassing the owner-resolver call.
 *
 * Why this matters: viewContext.canViewCharacter falls back to "show
 * everything" when meta.personalityOwnerDiscordId is undefined. The fallback
 * is intentional for legacy logs (pre-PR-#898), deleted-owner User rows, and
 * test environments — but a current-era write path that forgot to populate
 * the field would silently grant cross-user access to character internals.
 *
 * createDiagnosticCollectorForRequest is the single approved construction
 * site. This test asserts no other production file in ai-worker creates a
 * collector via `new DiagnosticCollector(...)`.
 */
describe('DiagnosticCollector construction is funneled through the owner resolver', () => {
  it('production code constructs DiagnosticCollector only via createDiagnosticCollectorForRequest', () => {
    const aiWorkerSrc = path.resolve(__dirname, '../..');
    const productionFiles: string[] = [];

    function collectTsFiles(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip test infra, mocks, and build output
          if (
            entry.name === 'test' ||
            entry.name === 'mocks' ||
            entry.name === '__mocks__' ||
            entry.name === 'dist' ||
            entry.name === 'node_modules'
          ) {
            continue;
          }
          collectTsFiles(full);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          // Skip test files
          if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) {
            continue;
          }
          productionFiles.push(full);
        }
      }
    }
    collectTsFiles(aiWorkerSrc);

    const offenders: { file: string; line: number; text: string }[] = [];
    const constructPattern = /\bnew\s+DiagnosticCollector\s*\(/;

    for (const file of productionFiles) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((text, idx) => {
        if (constructPattern.test(text)) {
          offenders.push({ file, line: idx + 1, text: text.trim() });
        }
      });
    }

    // Allowed callsites:
    // - personalityOwnerResolver.ts: the resolver helper (single approved
    //   construction site for production paths)
    // - DiagnosticCollector.ts: the class definition itself, whose JSDoc
    //   examples include literal `new DiagnosticCollector(...)` snippets
    const allowedSuffixes = [
      path.normalize('services/diagnostics/personalityOwnerResolver.ts'),
      path.normalize('services/DiagnosticCollector.ts'),
    ];
    const isAllowed = (file: string): boolean =>
      allowedSuffixes.some(suffix => file.endsWith(suffix));
    const unauthorized = offenders.filter(o => !isAllowed(o.file));

    expect(
      unauthorized,
      `Unauthorized DiagnosticCollector constructions:\n${unauthorized
        .map(o => `  ${o.file}:${o.line} → ${o.text}`)
        .join(
          '\n'
        )}\nAll production code must construct DiagnosticCollector via createDiagnosticCollectorForRequest so the owner resolver is invoked.`
    ).toEqual([]);
    // Sanity: each allowlist entry still maps to a real construction site.
    // Catches accidental rename of either file that would silently make this
    // test trivially pass.
    const resolverPath = path.normalize('services/diagnostics/personalityOwnerResolver.ts');
    expect(offenders.some(o => o.file.endsWith(resolverPath))).toBe(true);
    const collectorPath = path.normalize('services/DiagnosticCollector.ts');
    expect(offenders.some(o => o.file.endsWith(collectorPath))).toBe(true);
  });
});
