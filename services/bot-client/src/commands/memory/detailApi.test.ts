/**
 * Tests for Memory Detail API Client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

    it('should return null on API error', async () => {
      stub.getMemory.mockResolvedValue(makeErr(404, 'Not found'));

      const result = await fetchMemory(asUserClient(stub), 'memory-123', 'user-123');

      expect(result).toBeNull();
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

    it('should return null on API error', async () => {
      stub.updateMemory.mockResolvedValue(makeErr(500, 'Update failed'));

      const result = await updateMemory(asUserClient(stub), 'memory-123', 'New content');

      expect(result).toBeNull();
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

    it('returns null on API error', async () => {
      stub.setMemoryLock.mockResolvedValue(makeErr(500, 'Lock failed'));

      const result = await setMemoryLock(asUserClient(stub), 'memory-123', true);

      expect(result).toBeNull();
    });
  });

  describe('deleteMemory', () => {
    it('should delete memory successfully', async () => {
      stub.deleteMemory.mockResolvedValue(makeOk({ success: true }));

      const result = await deleteMemory(asUserClient(stub), 'memory-123', 'user-123');

      expect(result).toBe(true);
      expect(stub.deleteMemory).toHaveBeenCalledWith('memory-123');
    });

    it('should return false on API error', async () => {
      stub.deleteMemory.mockResolvedValue(makeErr(500, 'Delete failed'));

      const result = await deleteMemory(asUserClient(stub), 'memory-123');

      expect(result).toBe(false);
    });
  });
});
