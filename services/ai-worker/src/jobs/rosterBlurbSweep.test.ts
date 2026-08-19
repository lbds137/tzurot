import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { AIProvider } from '@tzurot/common-types/constants/ai';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import { sweepRosterBlurbs } from './rosterBlurbSweep.js';
import {
  buildRosterBlurbCard,
  CARD_FIELDS,
  hashRosterBlurbCard,
  type RosterBlurbCard,
} from '../services/rosterBlurb/rosterBlurbPrompt.js';
import type { SystemModelInvoker } from '../services/systemModel/systemModelCall.js';

function setSettings(rosterBlurbEnabled: boolean): void {
  const values: Record<string, unknown> = {
    rosterBlurbEnabled,
    extractionModel: 'z-ai/glm-5.2',
  };
  registerSystemSettings({
    get: (key: string) => values[key],
  } as unknown as SystemSettingsService);
}

afterEach(() => resetSystemSettingsRegistration());

const EMPTY_CARD = Object.fromEntries(CARD_FIELDS.map(f => [f.key, null])) as RosterBlurbCard;

interface Row extends RosterBlurbCard {
  id: string;
  ownerId: string;
  rosterBlurbSourceHash: string | null;
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    ...EMPTY_CARD,
    id: '4f9b0f66-0000-4000-8000-0000000000aa',
    ownerId: '4f9b0f66-0000-4000-8000-0000000000bb',
    rosterBlurbSourceHash: null,
    name: 'Ilana',
    characterInfo: 'A dry-witted archivist.',
    ...overrides,
  };
}

/** Prisma double: both candidate queries return `rows`, writes are recorded. */
function makePrisma(rows: Row[]): {
  prisma: PrismaClient;
  executeRaw: ReturnType<typeof vi.fn>;
  usageCreate: ReturnType<typeof vi.fn>;
} {
  const executeRaw = vi.fn().mockResolvedValue(1);
  const usageCreate = vi.fn().mockResolvedValue({});
  const prisma = {
    personality: { findMany: vi.fn().mockResolvedValue(rows) },
    usageLog: { create: usageCreate },
    $executeRaw: executeRaw,
  } as unknown as PrismaClient;
  return { prisma, executeRaw, usageCreate };
}

function invokerReturning(content: string): Mock<SystemModelInvoker> {
  return vi.fn<SystemModelInvoker>().mockResolvedValue({
    content,
    tokensIn: 100,
    tokensOut: 20,
    provider: AIProvider.OpenRouter,
  });
}

describe('sweepRosterBlurbs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing at all when the runtime switch is off', async () => {
    setSettings(false);
    const { prisma } = makePrisma([row()]);
    const invoke = invokerReturning('{"blurb":"x"}');

    const stats = await sweepRosterBlurbs(prisma, invoke);

    expect(stats.enabled).toBe(false);
    expect(stats.scanned).toBe(0);
    expect(prisma.personality.findMany).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('skips a character whose stored hash still matches its card', async () => {
    setSettings(true);
    const fresh = row();
    fresh.rosterBlurbSourceHash = hashRosterBlurbCard(buildRosterBlurbCard(fresh));
    const { prisma, executeRaw } = makePrisma([fresh]);
    const invoke = invokerReturning('{"blurb":"x"}');

    const stats = await sweepRosterBlurbs(prisma, invoke);

    expect(stats.scanned).toBe(1);
    expect(stats.stale).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('generates and stores a blurb against the hash it was generated from', async () => {
    setSettings(true);
    const stale = row({ rosterBlurbSourceHash: 'deadbeef' });
    const { prisma, executeRaw, usageCreate } = makePrisma([stale]);
    const invoke = invokerReturning('{"blurb":"Ilana is a dry-witted archivist."}');

    const stats = await sweepRosterBlurbs(prisma, invoke);

    expect(stats).toMatchObject({ stale: 1, generated: 1, failed: 0, stampedEmpty: 0 });
    expect(invoke).toHaveBeenCalledTimes(1);
    // The stored hash must be the CURRENT card's, never the stale stored one.
    const expectedHash = hashRosterBlurbCard(buildRosterBlurbCard(stale));
    const writeArgs = executeRaw.mock.calls[0] as unknown[];
    expect(writeArgs).toContain('Ilana is a dry-witted archivist.');
    expect(writeArgs).toContain(expectedHash);
    expect(usageCreate).toHaveBeenCalledTimes(1);
  });

  it('stamps an empty card without paying for a blurb about nothing', async () => {
    setSettings(true);
    const empty = row({ name: null, characterInfo: null });
    const { prisma, executeRaw } = makePrisma([empty]);
    const invoke = invokerReturning('{"blurb":"x"}');

    const stats = await sweepRosterBlurbs(prisma, invoke);

    expect(stats).toMatchObject({ stale: 1, stampedEmpty: 1, generated: 0 });
    expect(invoke).not.toHaveBeenCalled();
    // Stamped anyway — otherwise every tick would rediscover it as stale.
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('bills a failed parse and stores nothing', async () => {
    setSettings(true);
    const { prisma, executeRaw, usageCreate } = makePrisma([row()]);
    const invoke = invokerReturning('not json at all');

    const stats = await sweepRosterBlurbs(prisma, invoke);

    expect(stats).toMatchObject({ failed: 1, generated: 0 });
    expect(executeRaw).not.toHaveBeenCalled();
    expect(usageCreate).toHaveBeenCalledTimes(1);
  });

  it('caps model calls per tick however many characters are stale', async () => {
    setSettings(true);
    const rows = Array.from({ length: 25 }, (_, i) =>
      row({ id: `4f9b0f66-0000-4000-8000-0000000000${String(i).padStart(2, '0')}` })
    );
    const { prisma } = makePrisma(rows);
    const invoke = invokerReturning('{"blurb":"Ilana is an archivist."}');

    const stats = await sweepRosterBlurbs(prisma, invoke);

    expect(stats.scanned).toBe(25);
    expect(stats.generated).toBe(10);
    expect(invoke).toHaveBeenCalledTimes(10);
  });

  it('survives a usage-row failure rather than losing the blurb', async () => {
    setSettings(true);
    const { prisma, executeRaw, usageCreate } = makePrisma([row()]);
    usageCreate.mockRejectedValue(new Error('db hiccup'));
    const invoke = invokerReturning('{"blurb":"Ilana is an archivist."}');

    const stats = await sweepRosterBlurbs(prisma, invoke);

    expect(stats.generated).toBe(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});
