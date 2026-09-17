/**
 * `digestCandidates` — wiring test. `selectDigestCandidatePairs` itself is
 * pinned by its own unit + PGLite component tests in common-types; this file
 * mocks that seam and asserts the arguments crossing it, plus the report's
 * two behaviours the C10 canary names: one line per candidate, and an
 * explicit `no candidates` line on empty (never silent).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { primeMock, isLoadedMock, getMock, selectMock } = vi.hoisted(() => ({
  primeMock: vi.fn().mockResolvedValue(undefined),
  isLoadedMock: vi.fn().mockReturnValue(true),
  getMock: vi.fn(),
  selectMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('../utils/env-runner.js', () => ({
  validateEnvironment: vi.fn(),
  showEnvironmentBanner: vi.fn(),
}));

vi.mock('../memory/prisma-env.js', () => ({
  getPrismaForEnv: vi.fn().mockResolvedValue({
    prisma: {},
    disconnect: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@tzurot/common-types/services/SystemSettingsService', () => ({
  // A regular `function` (not an arrow) so `new SystemSettingsService(...)`
  // in the module under test can invoke it as a constructor — arrow
  // functions are not constructible, and vitest's `new` handling surfaces
  // that as "is not a constructor" rather than silently coercing it.
  SystemSettingsService: vi.fn().mockImplementation(function SystemSettingsServiceMock() {
    return { prime: primeMock, isLoaded: isLoadedMock, get: getMock };
  }),
}));

vi.mock('@tzurot/common-types/services/recentDaysDigestSelection', () => ({
  selectDigestCandidatePairs: selectMock,
}));

import { digestCandidates } from './candidates.js';

const NOW = new Date('2026-09-17T00:00:00.000Z');

function makePair(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    personaId: 'persona-1',
    personalityId: 'personality-1',
    personalitySlug: 'char-a',
    ownerId: 'owner-1',
    ownerTimezone: 'UTC',
    personaName: 'Persona One',
    personaPreferredName: null,
    personalityName: 'Char A',
    personalityDisplayName: null,
    epoch: null,
    newestRowAt: NOW,
    windowRowCount: 5,
    digestId: null,
    digestStatus: null,
    digestAttempts: null,
    sourceWatermark: null,
    generatedAt: null,
    requestedAt: null,
    ...overrides,
  };
}

function loggedLines(logSpy: ReturnType<typeof vi.spyOn>): string[] {
  return logSpy.mock.calls.map((call: unknown[]) => String(call[0]));
}

describe('digestCandidates', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    primeMock.mockResolvedValue(undefined);
    isLoadedMock.mockReturnValue(true);
    getMock.mockImplementation((key: string) => {
      if (key === 'recentDaysDigestEnabled') return true;
      if (key === 'recentDaysDigestPersonalities') return ['char-a'];
      throw new Error(`unexpected settings key: ${key}`);
    });
    selectMock.mockResolvedValue([]);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('passes the live settings row personalities and the prompt version across the seam', async () => {
    selectMock.mockResolvedValueOnce([makePair()]);
    await digestCandidates({ env: 'dev' });

    expect(selectMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ personalitySlugs: ['char-a'], promptVersion: 1 })
    );
  });

  it('prints one line per candidate', async () => {
    selectMock.mockResolvedValueOnce([
      makePair({ personalitySlug: 'char-a' }),
      makePair({ personalitySlug: 'char-b', personaName: 'Persona Two' }),
    ]);
    await digestCandidates({ env: 'dev' });

    const lines = loggedLines(logSpy);
    expect(lines.some(line => line.includes('char-a'))).toBe(true);
    expect(lines.some(line => line.includes('char-b'))).toBe(true);
    expect(lines.some(line => line.includes('no candidates'))).toBe(false);
  });

  // Canary C10 (candidates half): the empty branch must print an explicit
  // marker rather than falling through silently. Mutation: delete the
  // `pairs.length === 0` branch's `no candidates` line → this reds.
  it('prints "no candidates" on an empty result, never silently', async () => {
    selectMock.mockResolvedValueOnce([]);
    await digestCandidates({ env: 'dev' });

    const lines = loggedLines(logSpy);
    expect(lines.some(line => line.includes('no candidates'))).toBe(true);
  });

  // Canary: the gate line's regenerations/day figure is derived from
  // `RECENT_DAYS_DIGEST.MIN_REGEN_INTERVAL_MS` (24h / 2h = 12), not a
  // hardcoded sweep-cadence count. Mutation: halving the divisor in the
  // derivation reds this — see the deviation report for the RED tail.
  it('prints the design spend-rule figure of 12 regenerations/day in the gate line', async () => {
    selectMock.mockResolvedValueOnce([makePair()]);
    await digestCandidates({ env: 'dev' });

    const lines = loggedLines(logSpy);
    expect(lines.some(line => line.includes('× 12 regenerations/day max'))).toBe(true);
  });

  it('reports settings as unavailable and queries with an empty slug list when the row never loaded', async () => {
    isLoadedMock.mockReturnValue(false);
    await digestCandidates({ env: 'dev' });

    expect(selectMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ personalitySlugs: [] })
    );
    const lines = loggedLines(logSpy);
    expect(lines.some(line => line.includes('unavailable'))).toBe(true);
  });
});
