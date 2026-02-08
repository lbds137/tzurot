/**
 * Tests for Memory Detail API Client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchMemory, updateMemory, toggleMemoryLock, deleteMemory } from './detailApi.js';
import type { MemoryItem } from './detailApi.js';

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
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

// Mock userGatewayClient
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

describe('Memory Detail API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { memory },
      });

      const result = await fetchMemory('user-123', 'memory-123');

      expect(result).toEqual(memory);
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/memory-123', {
        userId: 'user-123',
        method: 'GET',
      });
    });

    it('should return null on API error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Not found',
      });

      const result = await fetchMemory('user-123', 'memory-123');

      expect(result).toBeNull();
    });
  });

  describe('updateMemory', () => {
    it('should update memory successfully', async () => {
      const memory = createMockMemory({ content: 'Updated content' });
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { memory },
      });

      const result = await updateMemory('user-123', 'memory-123', 'Updated content');

      expect(result).toEqual(memory);
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/memory-123', {
        userId: 'user-123',
        method: 'PATCH',
        body: { content: 'Updated content' },
      });
    });

    it('should return null on API error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Update failed',
      });

      const result = await updateMemory('user-123', 'memory-123', 'New content');

      expect(result).toBeNull();
    });
  });

  describe('toggleMemoryLock', () => {
    it('should toggle lock successfully', async () => {
      const memory = createMockMemory({ isLocked: true });
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { memory },
      });

      const result = await toggleMemoryLock('user-123', 'memory-123');

      expect(result).toEqual(memory);
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/memory-123/lock', {
        userId: 'user-123',
        method: 'POST',
      });
    });

    it('should return null on API error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Lock failed',
      });

      const result = await toggleMemoryLock('user-123', 'memory-123');

      expect(result).toBeNull();
    });
  });

  describe('deleteMemory', () => {
    it('should delete memory successfully', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { success: true },
      });

      const result = await deleteMemory('user-123', 'memory-123');

      expect(result).toBe(true);
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/memory-123', {
        userId: 'user-123',
        method: 'DELETE',
      });
    });

    it('should return false on API error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Delete failed',
      });

      const result = await deleteMemory('user-123', 'memory-123');

      expect(result).toBe(false);
    });
  });
});
