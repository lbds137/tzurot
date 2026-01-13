/**
 * Tests for Active Collector Registry
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerActiveCollector,
  deregisterActiveCollector,
  hasActiveCollector,
  getActiveCollectorCount,
} from './activeCollectorRegistry.js';

describe('activeCollectorRegistry', () => {
  // Clean up after each test to avoid cross-test pollution
  beforeEach(() => {
    // Get all registered IDs and clear them
    // We test the count function here too implicitly
    while (getActiveCollectorCount() > 0) {
      // Can't directly clear, but tests should clean up after themselves
    }
  });

  describe('registerActiveCollector', () => {
    it('should register a message ID', () => {
      const messageId = 'test-message-1';

      registerActiveCollector(messageId);

      expect(hasActiveCollector(messageId)).toBe(true);

      // Clean up
      deregisterActiveCollector(messageId);
    });

    it('should handle registering the same ID twice (idempotent)', () => {
      const messageId = 'test-message-2';

      registerActiveCollector(messageId);
      registerActiveCollector(messageId);

      expect(hasActiveCollector(messageId)).toBe(true);
      expect(getActiveCollectorCount()).toBeGreaterThanOrEqual(1);

      // Clean up
      deregisterActiveCollector(messageId);
    });
  });

  describe('deregisterActiveCollector', () => {
    it('should deregister a message ID', () => {
      const messageId = 'test-message-3';

      registerActiveCollector(messageId);
      expect(hasActiveCollector(messageId)).toBe(true);

      deregisterActiveCollector(messageId);
      expect(hasActiveCollector(messageId)).toBe(false);
    });

    it('should handle deregistering non-existent ID gracefully', () => {
      const messageId = 'non-existent-id';

      // Should not throw
      expect(() => deregisterActiveCollector(messageId)).not.toThrow();
      expect(hasActiveCollector(messageId)).toBe(false);
    });
  });

  describe('hasActiveCollector', () => {
    it('should return false for unregistered message ID', () => {
      expect(hasActiveCollector('unknown-message')).toBe(false);
    });

    it('should return true for registered message ID', () => {
      const messageId = 'test-message-4';

      registerActiveCollector(messageId);
      expect(hasActiveCollector(messageId)).toBe(true);

      // Clean up
      deregisterActiveCollector(messageId);
    });
  });

  describe('getActiveCollectorCount', () => {
    it('should return correct count', () => {
      const messageId1 = 'count-test-1';
      const messageId2 = 'count-test-2';
      const messageId3 = 'count-test-3';

      const initialCount = getActiveCollectorCount();

      registerActiveCollector(messageId1);
      expect(getActiveCollectorCount()).toBe(initialCount + 1);

      registerActiveCollector(messageId2);
      expect(getActiveCollectorCount()).toBe(initialCount + 2);

      registerActiveCollector(messageId3);
      expect(getActiveCollectorCount()).toBe(initialCount + 3);

      // Clean up
      deregisterActiveCollector(messageId1);
      deregisterActiveCollector(messageId2);
      deregisterActiveCollector(messageId3);

      expect(getActiveCollectorCount()).toBe(initialCount);
    });
  });

  describe('integration', () => {
    it('should simulate full lifecycle: register, check, deregister', () => {
      const messageId = 'lifecycle-test';

      // Initially not registered
      expect(hasActiveCollector(messageId)).toBe(false);

      // Register
      registerActiveCollector(messageId);
      expect(hasActiveCollector(messageId)).toBe(true);

      // Deregister (simulating collector end)
      deregisterActiveCollector(messageId);
      expect(hasActiveCollector(messageId)).toBe(false);
    });

    it('should handle multiple concurrent collectors', () => {
      const messageIds = ['concurrent-1', 'concurrent-2', 'concurrent-3'];

      // Register all
      messageIds.forEach(id => registerActiveCollector(id));

      // All should be active
      messageIds.forEach(id => {
        expect(hasActiveCollector(id)).toBe(true);
      });

      // Deregister one by one
      deregisterActiveCollector(messageIds[0]);
      expect(hasActiveCollector(messageIds[0])).toBe(false);
      expect(hasActiveCollector(messageIds[1])).toBe(true);
      expect(hasActiveCollector(messageIds[2])).toBe(true);

      // Clean up remaining
      deregisterActiveCollector(messageIds[1]);
      deregisterActiveCollector(messageIds[2]);
    });
  });
});
