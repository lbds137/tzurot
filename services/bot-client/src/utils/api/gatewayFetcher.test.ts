/**
 * Tests for Gateway Fetcher Utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createEntityFetcher,
  createEntityUpdater,
  createEntityDeleter,
  createListFetcher,
  unwrapOrThrow,
  NotFoundError,
  isNotFoundError,
} from './gatewayFetcher.js';
import * as userGatewayClientModule from '../userGatewayClient.js';

// Mock the gateway client
vi.mock('../userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

describe('gatewayFetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createEntityFetcher', () => {
    interface TestResponse {
      entity: { id: string; name: string };
    }
    interface TestEntity {
      id: string;
      name: string;
    }

    const fetcher = createEntityFetcher<TestResponse, TestEntity>({
      loggerName: 'test-fetcher',
      extractResult: response => response.entity,
      actionName: 'fetch test entity',
    });

    it('should return extracted data on success', async () => {
      const mockEntity = { id: '123', name: 'Test' };
      vi.mocked(userGatewayClientModule.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { entity: mockEntity },
        status: 200,
      });

      const result = await fetcher('/user/entity', '123', 'user-456');

      expect(result).toEqual(mockEntity);
      expect(userGatewayClientModule.callGatewayApi).toHaveBeenCalledWith('/user/entity/123', {
        userId: 'user-456',
      });
    });

    it('should return null on failure', async () => {
      vi.mocked(userGatewayClientModule.callGatewayApi).mockResolvedValue({
        ok: false,
        error: 'Not found',
        status: 404,
      });

      const result = await fetcher('/user/entity', '123', 'user-456');

      expect(result).toBeNull();
    });
  });

  describe('createEntityUpdater', () => {
    interface TestResponse {
      entity: { id: string; name: string };
    }
    interface TestEntity {
      id: string;
      name: string;
    }

    it('should return extracted data on success', async () => {
      const updater = createEntityUpdater<TestResponse, TestEntity>({
        loggerName: 'test-updater',
        extractResult: response => response.entity,
        actionName: 'update test entity',
      });

      const mockEntity = { id: '123', name: 'Updated' };
      vi.mocked(userGatewayClientModule.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { entity: mockEntity },
        status: 200,
      });

      const result = await updater('/user/entity', '123', { name: 'Updated' }, 'user-456');

      expect(result).toEqual(mockEntity);
      expect(userGatewayClientModule.callGatewayApi).toHaveBeenCalledWith('/user/entity/123', {
        method: 'PUT',
        userId: 'user-456',
        body: { name: 'Updated' },
      });
    });

    it('should return null on failure by default', async () => {
      const updater = createEntityUpdater<{ entity: unknown }, unknown>({
        loggerName: 'test-updater',
        extractResult: r => r.entity,
        actionName: 'update',
      });

      vi.mocked(userGatewayClientModule.callGatewayApi).mockResolvedValue({
        ok: false,
        error: 'Server error',
        status: 500,
      });

      const result = await updater('/user/entity', '123', {}, 'user-456');

      expect(result).toBeNull();
    });

    it('should throw on failure when throwOnError is true', async () => {
      const updater = createEntityUpdater<{ entity: unknown }, unknown>({
        loggerName: 'test-updater',
        extractResult: r => r.entity,
        actionName: 'update entity',
        throwOnError: true,
      });

      vi.mocked(userGatewayClientModule.callGatewayApi).mockResolvedValue({
        ok: false,
        error: 'Server error',
        status: 500,
      });

      await expect(updater('/user/entity', '123', {}, 'user-456')).rejects.toThrow(
        'Failed to update entity: 500 - Server error'
      );
    });
  });

  describe('createEntityDeleter', () => {
    const deleter = createEntityDeleter({
      loggerName: 'test-deleter',
      actionName: 'delete test entity',
    });

    it('should return success on successful delete', async () => {
      vi.mocked(userGatewayClientModule.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { message: 'Deleted' },
        status: 200,
      });

      const result = await deleter('/user/entity', '123', 'user-456');

      expect(result).toEqual({ success: true });
      expect(userGatewayClientModule.callGatewayApi).toHaveBeenCalledWith('/user/entity/123', {
        method: 'DELETE',
        userId: 'user-456',
      });
    });

    it('should return failure with error on failed delete', async () => {
      vi.mocked(userGatewayClientModule.callGatewayApi).mockResolvedValue({
        ok: false,
        error: 'Cannot delete',
        status: 403,
      });

      const result = await deleter('/user/entity', '123', 'user-456');

      expect(result).toEqual({ success: false, error: 'Cannot delete' });
    });
  });

  describe('createListFetcher', () => {
    interface ListResponse {
      items: Array<{ id: string }>;
    }

    const fetcher = createListFetcher<ListResponse, { id: string }>({
      loggerName: 'test-list-fetcher',
      extractList: response => response.items,
      actionName: 'list items',
    });

    it('should return extracted list on success', async () => {
      const items = [{ id: '1' }, { id: '2' }];
      vi.mocked(userGatewayClientModule.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { items },
        status: 200,
      });

      const result = await fetcher('/user/items', 'user-456');

      expect(result).toEqual(items);
      expect(userGatewayClientModule.callGatewayApi).toHaveBeenCalledWith('/user/items', {
        userId: 'user-456',
      });
    });

    it('should return null on failure', async () => {
      vi.mocked(userGatewayClientModule.callGatewayApi).mockResolvedValue({
        ok: false,
        error: 'Server error',
        status: 500,
      });

      const result = await fetcher('/user/items', 'user-456');

      expect(result).toBeNull();
    });
  });

  describe('unwrapOrThrow', () => {
    it('should return data on success', () => {
      const data = { id: '123' };
      const result = unwrapOrThrow({ ok: true, data, status: 200 }, 'entity');

      expect(result).toEqual(data);
    });

    it('should throw NotFoundError on 404', () => {
      expect(() => {
        unwrapOrThrow({ ok: false, error: 'Not found', status: 404 }, 'preset');
      }).toThrow(NotFoundError);
    });

    it('should throw generic error on other failures', () => {
      expect(() => {
        unwrapOrThrow({ ok: false, error: 'Server error', status: 500 }, 'entity');
      }).toThrow('Failed to fetch entity: 500 - Server error');
    });
  });

  describe('NotFoundError', () => {
    it('should have correct properties', () => {
      const error = new NotFoundError('preset');

      expect(error.message).toBe('preset not found');
      expect(error.name).toBe('NotFoundError');
      expect(error.entityType).toBe('preset');
      expect(error.status).toBe(404);
    });
  });

  describe('isNotFoundError', () => {
    it('should return true for NotFoundError', () => {
      expect(isNotFoundError(new NotFoundError('test'))).toBe(true);
    });

    it('should return false for other errors', () => {
      expect(isNotFoundError(new Error('test'))).toBe(false);
      expect(isNotFoundError('string')).toBe(false);
      expect(isNotFoundError(null)).toBe(false);
    });
  });
});
