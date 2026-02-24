/**
 * Verification Cleanup Service Singleton Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before static imports
vi.mock('../redis.js', () => ({
  redis: {
    rpush: vi.fn(),
    expire: vi.fn(),
    lrange: vi.fn(),
    del: vi.fn(),
    keys: vi.fn(),
  },
}));

const mockCleanupForUser = vi.fn().mockResolvedValue(undefined);
const mockCleanupExpiredMessages = vi
  .fn()
  .mockResolvedValue({ processed: 0, deleted: 0, failed: 0 });

vi.mock('./VerificationMessageCleanup.js', () => ({
  VerificationMessageCleanup: class MockVerificationMessageCleanup {
    cleanupForUser = mockCleanupForUser;
    cleanupExpiredMessages = mockCleanupExpiredMessages;
  },
}));

import {
  initVerificationCleanupService,
  getVerificationCleanupService,
  cleanupVerificationMessagesForUser,
  resetForTesting,
} from './VerificationCleanupService.js';

describe('verificationCleanupService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetForTesting();
  });

  describe('initVerificationCleanupService', () => {
    it('should initialize the service', () => {
      const mockClient = { user: { id: 'bot-123' } };

      expect(() => initVerificationCleanupService(mockClient as any)).not.toThrow();
    });

    it('should warn if already initialized', () => {
      const mockClient = { user: { id: 'bot-123' } };

      initVerificationCleanupService(mockClient as any);
      // Second call should not throw but should warn
      expect(() => initVerificationCleanupService(mockClient as any)).not.toThrow();
    });
  });

  describe('getVerificationCleanupService', () => {
    it('should throw if not initialized', () => {
      expect(() => getVerificationCleanupService()).toThrow(
        'VerificationMessageCleanup service not initialized'
      );
    });

    it('should return the service after initialization', () => {
      const mockClient = { user: { id: 'bot-123' } };
      initVerificationCleanupService(mockClient as any);

      const service = getVerificationCleanupService();
      expect(service).toBeDefined();
    });
  });

  describe('cleanupVerificationMessagesForUser', () => {
    it('should do nothing if service not initialized', async () => {
      // Should not throw, just log warning
      await expect(cleanupVerificationMessagesForUser('user-123')).resolves.not.toThrow();
    });

    it('should call cleanupForUser if service is initialized', async () => {
      const mockClient = { user: { id: 'bot-123' } };
      initVerificationCleanupService(mockClient as any);

      await cleanupVerificationMessagesForUser('user-123');

      expect(mockCleanupForUser).toHaveBeenCalledWith('user-123');
    });
  });
});
