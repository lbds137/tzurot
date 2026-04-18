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
  toGatewayUser: (user: { id?: string; username?: string; globalName?: string | null }) => ({
    discordId: user.id ?? 'test-user-id',
    username: user.username ?? 'testuser',
    displayName: user.globalName ?? user.username ?? 'testuser',
  }),
}));

const TEST_USER = {
  discordId: 'user-123',
  username: 'testuser',
  displayName: 'testuser',
} as const;

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

      const result = await fetchMemory(TEST_USER, 'memory-123');

      expect(result).toEqual(memory);
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/memory-123', {
        user: {
          discordId: 'user-123',
          username: 'testuser',
          displayName: 'testuser',
        },
        method: 'GET',
      });
    });

    it('should return null on API error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Not found',
      });

      const result = await fetchMemory(TEST_USER, 'memory-123');

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

      const result = await updateMemory(TEST_USER, 'memory-123', 'Updated content');

      expect(result).toEqual(memory);
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/memory-123', {
        user: {
          discordId: 'user-123',
          username: 'testuser',
          displayName: 'testuser',
        },
        method: 'PATCH',
        body: { content: 'Updated content' },
      });
    });

    it('should return null on API error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Update failed',
      });

      const result = await updateMemory(TEST_USER, 'memory-123', 'New content');

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

      const result = await toggleMemoryLock(TEST_USER, 'memory-123');

      expect(result).toEqual(memory);
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/memory-123/lock', {
        user: {
          discordId: 'user-123',
          username: 'testuser',
          displayName: 'testuser',
        },
        method: 'POST',
      });
    });

    it('should return null on API error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Lock failed',
      });

      const result = await toggleMemoryLock(TEST_USER, 'memory-123');

      expect(result).toBeNull();
    });
  });

  describe('deleteMemory', () => {
    it('should delete memory successfully', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { success: true },
      });

      const result = await deleteMemory(TEST_USER, 'memory-123');

      expect(result).toBe(true);
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/memory-123', {
        user: {
          discordId: 'user-123',
          username: 'testuser',
          displayName: 'testuser',
        },
        method: 'DELETE',
      });
    });

    it('should return false on API error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Delete failed',
      });

      const result = await deleteMemory(TEST_USER, 'memory-123');

      expect(result).toBe(false);
    });
  });
});
