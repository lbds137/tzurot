/**
 * Tests for the Memory Facts API client.
 *
 * The contract under test mirrors detailApi: null/false ONLY on a genuine
 * 404; everything else (including the locked-fact 403) throws so callers
 * classify honestly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InfraError, GatewayClientError } from '@tzurot/clients';
import { fetchFacts, fetchFact, correctFact, forgetFact, setFactLock } from './factsApi.js';
import type { FactItem } from './factsApi.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

interface FactClientStub {
  listFacts: ReturnType<typeof vi.fn>;
  getFact: ReturnType<typeof vi.fn>;
  correctFact: ReturnType<typeof vi.fn>;
  forgetFact: ReturnType<typeof vi.fn>;
  setFactLock: ReturnType<typeof vi.fn>;
}

function createStub(): FactClientStub {
  return {
    listFacts: vi.fn(),
    getFact: vi.fn(),
    correctFact: vi.fn(),
    forgetFact: vi.fn(),
    setFactLock: vi.fn(),
  };
}

const createMockFact = (overrides: Partial<FactItem> = {}): FactItem => ({
  id: 'fact-123',
  personalityId: 'personality-456',
  personaId: 'persona-789',
  statement: 'The user has a cat named Miso',
  entityTags: ['user'],
  salience: 0.7,
  tier: 'observed',
  isLocked: false,
  validFrom: '2026-06-15T12:00:00.000Z',
  supersededAt: null,
  supersededById: null,
  forgotten: false,
  sourceMemoryIds: ['mem-1'],
  createdAt: '2026-06-15T12:00:00.000Z',
  ...overrides,
});

describe('Memory Facts API', () => {
  let stub: FactClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
  });

  describe('fetchFacts', () => {
    it('passes personality scope + stringified pagination to the client', async () => {
      const response = {
        facts: [createMockFact()],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
      };
      stub.listFacts.mockResolvedValue(makeOk(response));

      const result = await fetchFacts(asUserClient(stub), 'personality-456', 20, 10);

      expect(result).toEqual(response);
      expect(stub.listFacts).toHaveBeenCalledWith({
        personalityId: 'personality-456',
        limit: '10',
        offset: '20',
      });
    });

    it('returns null on failure (browse degrades to a transient message)', async () => {
      stub.listFacts.mockResolvedValue(makeErr(500, 'boom'));

      expect(await fetchFacts(asUserClient(stub), 'personality-456', 0, 10)).toBeNull();
    });
  });

  describe('fetchFact', () => {
    it('unwraps the fact on success', async () => {
      const fact = createMockFact();
      stub.getFact.mockResolvedValue(makeOk({ fact }));

      expect(await fetchFact(asUserClient(stub), 'fact-123', 'user-1')).toEqual(fact);
      expect(stub.getFact).toHaveBeenCalledWith('fact-123');
    });

    it('returns null ONLY on a genuine 404', async () => {
      stub.getFact.mockResolvedValue(makeErr(404, 'Not found'));
      expect(await fetchFact(asUserClient(stub), 'fact-123')).toBeNull();
    });

    it('THROWS on an infra failure — a timeout must never read as "not found"', async () => {
      stub.getFact.mockResolvedValue(makeErr(0, 'timed out', undefined, 'timeout'));
      await expect(fetchFact(asUserClient(stub), 'fact-123')).rejects.toThrow(InfraError);
    });
  });

  describe('correctFact', () => {
    it('sends the corrected statement and returns the SURVIVOR fact', async () => {
      // On a statement collision the survivor can be a DIFFERENT row.
      const survivor = createMockFact({ id: 'other-fact', tier: 'corrected' });
      stub.correctFact.mockResolvedValue(makeOk({ fact: survivor, supersededFactId: 'fact-123' }));

      const result = await correctFact(
        asUserClient(stub),
        'fact-123',
        'The user has a cat named Mochi',
        'user-1'
      );

      expect(result).toEqual(survivor);
      expect(stub.correctFact).toHaveBeenCalledWith('fact-123', {
        statement: 'The user has a cat named Mochi',
      });
    });

    it('THROWS on the locked-fact 403 (hard freeze surfaces, not silence)', async () => {
      stub.correctFact.mockResolvedValue(makeErr(403, 'Cannot correct a locked fact'));
      await expect(correctFact(asUserClient(stub), 'fact-123', 'x')).rejects.toThrow(
        GatewayClientError
      );
    });

    it('returns null ONLY on a genuine 404', async () => {
      stub.correctFact.mockResolvedValue(makeErr(404, 'Not found'));
      expect(await correctFact(asUserClient(stub), 'fact-123', 'x')).toBeNull();
    });
  });

  describe('forgetFact', () => {
    it('returns true on success', async () => {
      stub.forgetFact.mockResolvedValue(makeOk({ id: 'fact-123', forgotten: true }));

      expect(await forgetFact(asUserClient(stub), 'fact-123', 'user-1')).toBe(true);
      expect(stub.forgetFact).toHaveBeenCalledWith('fact-123');
    });

    it('returns false ONLY on a genuine 404 (already gone)', async () => {
      stub.forgetFact.mockResolvedValue(makeErr(404, 'Not found'));
      expect(await forgetFact(asUserClient(stub), 'fact-123')).toBe(false);
    });

    it('THROWS on the locked-fact 403', async () => {
      stub.forgetFact.mockResolvedValue(makeErr(403, 'Cannot forget a locked fact'));
      await expect(forgetFact(asUserClient(stub), 'fact-123')).rejects.toThrow(GatewayClientError);
    });
  });

  describe('setFactLock', () => {
    it('sets the lock state explicitly with PUT + { locked }', async () => {
      const fact = createMockFact({ isLocked: true });
      stub.setFactLock.mockResolvedValue(makeOk({ fact }));

      const result = await setFactLock(asUserClient(stub), 'fact-123', true, 'user-1');

      expect(result).toEqual(fact);
      expect(stub.setFactLock).toHaveBeenCalledWith('fact-123', { locked: true });
    });

    it('THROWS on a 5xx so the caller can classify the write honestly', async () => {
      stub.setFactLock.mockResolvedValue(makeErr(500, 'boom'));
      await expect(setFactLock(asUserClient(stub), 'fact-123', true)).rejects.toThrow(InfraError);
    });
  });
});
