/**
 * Tests for Memory Detail API Client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InfraError } from '@tzurot/clients';
import { fetchMemory, updateMemory, setMemoryLock, deleteMemory } from './detailApi.js';
import type { MemoryItem } from '@tzurot/common-types/schemas/api/memory';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

interface MemoryClientStub {
  getMemory: ReturnType<typeof vi.fn>;
  updateMemory: ReturnType<typeof vi.fn>;
  deleteMemory: ReturnType<typeof vi.fn>;
  setMemoryLock: ReturnType<typeof vi.fn>;
}

function createStub(): MemoryClientStub {
  return {
    getMemory: vi.fn(),
    updateMemory: vi.fn(),
    deleteMemory: vi.fn(),
    setMemoryLock: vi.fn(),
  };
}

describe('Memory Detail API', () => {
  let stub: MemoryClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
  });

  const createMockMemory = (overrides: Partial<MemoryItem> = {}): MemoryItem => ({
    id: 'memory-123',
    content: 'Test memory content',
    createdAt: '2025-06-15T12:00:00.000Z',
    updatedAt: '2025-06-15T12:00:00.000Z',
    personalityId: 'personality-456',
    personalityName: 'Lilith',
    isLocked: false,
    ...overrides,
  });

  describe('fetchMemory', () => {
    it('should fetch memory successfully', async () => {
      const memory = createMockMemory();
      stub.getMemory.mockResolvedValue(makeOk({ memory }));

      const result = await fetchMemory(asUserClient(stub), 'memory-123', 'user-123');

      expect(result).toEqual(memory);
      expect(stub.getMemory).toHaveBeenCalledWith('memory-123');
    });

    it('returns null ONLY on a genuine 404 (definitive absence)', async () => {
      stub.getMemory.mockResolvedValue(makeErr(404, 'Not found'));

      const result = await fetchMemory(asUserClient(stub), 'memory-123', 'user-123');

      expect(result).toBeNull();
    });

    it('THROWS on an infra failure — a timeout must never read as "not found"', async () => {
      stub.getMemory.mockResolvedValue(makeErr(0, 'timed out', undefined, 'timeout'));

      await expect(fetchMemory(asUserClient(stub), 'memory-123', 'user-123')).rejects.toThrow(
        InfraError
      );
    });
  });

  describe('updateMemory', () => {
    it('should update memory successfully', async () => {
      const memory = createMockMemory({ content: 'Updated content' });
      stub.updateMemory.mockResolvedValue(makeOk({ memory }));

      const result = await updateMemory(
        asUserClient(stub),
        'memory-123',
        'Updated content',
        'user-123'
      );

      expect(result).toEqual(memory);
      expect(stub.updateMemory).toHaveBeenCalledWith('memory-123', { content: 'Updated content' });
    });

    it('returns null ONLY on a genuine 404', async () => {
      stub.updateMemory.mockResolvedValue(makeErr(404, 'Not found'));

      const result = await updateMemory(asUserClient(stub), 'memory-123', 'New content');

      expect(result).toBeNull();
    });

    it('THROWS on a 5xx so the caller can classify the write honestly', async () => {
      stub.updateMemory.mockResolvedValue(makeErr(500, 'Update failed'));

      await expect(updateMemory(asUserClient(stub), 'memory-123', 'New content')).rejects.toThrow(
        InfraError
      );
    });
  });

  describe('setMemoryLock', () => {
    it('sets the lock state explicitly with PUT + { locked }', async () => {
      const memory = createMockMemory({ isLocked: true });
      stub.setMemoryLock.mockResolvedValue(makeOk({ memory }));

      const result = await setMemoryLock(asUserClient(stub), 'memory-123', true, 'user-123');

      expect(result).toEqual(memory);
      expect(stub.setMemoryLock).toHaveBeenCalledWith('memory-123', { locked: true });
    });

    it('passes locked=false through to the API for unlock', async () => {
      const memory = createMockMemory({ isLocked: false });
      stub.setMemoryLock.mockResolvedValue(makeOk({ memory }));

      await setMemoryLock(asUserClient(stub), 'memory-123', false);

      expect(stub.setMemoryLock).toHaveBeenCalledWith('memory-123', { locked: false });
    });

    it('returns null ONLY on a genuine 404', async () => {
      stub.setMemoryLock.mockResolvedValue(makeErr(404, 'Not found'));

      const result = await setMemoryLock(asUserClient(stub), 'memory-123', true);

      expect(result).toBeNull();
    });

    it('THROWS on an infra failure — the old null-collapse hid outcome-uncertain lock writes', async () => {
      stub.setMemoryLock.mockResolvedValue(makeErr(0, 'socket hang up', undefined, 'network'));

      await expect(setMemoryLock(asUserClient(stub), 'memory-123', true)).rejects.toThrow(
        InfraError
      );
    });
  });

  describe('deleteMemory', () => {
    it('should delete memory successfully', async () => {
      stub.deleteMemory.mockResolvedValue(makeOk({ success: true }));

      const result = await deleteMemory(asUserClient(stub), 'memory-123', 'user-123');

      expect(result).toBe(true);
      expect(stub.deleteMemory).toHaveBeenCalledWith('memory-123');
    });

    it('returns false ONLY on a genuine 404 (already gone)', async () => {
      stub.deleteMemory.mockResolvedValue(makeErr(404, 'Not found'));

      const result = await deleteMemory(asUserClient(stub), 'memory-123');

      expect(result).toBe(false);
    });

    it('THROWS on a 5xx instead of reading as "delete failed, retry"', async () => {
      stub.deleteMemory.mockResolvedValue(makeErr(500, 'Delete failed'));

      await expect(deleteMemory(asUserClient(stub), 'memory-123')).rejects.toThrow(InfraError);
    });
  });
});
