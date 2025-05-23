/**
 * Tests for Request Registry
 * 
 * Tests the request tracking and deduplication system including
 * request lifecycle management, duplicate detection, and cleanup.
 */

const { Registry } = require('../../src/requestRegistry');
const logger = require('../../src/logger');

// Mock dependencies
jest.mock('../../src/logger');

describe('Request Registry', () => {
  let registry;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Mock setInterval and clearInterval
    jest.spyOn(global, 'setInterval');
    jest.spyOn(global, 'clearInterval');
  });

  afterEach(() => {
    // Clean up the registry
    if (registry) {
      registry.destroy();
    }
    jest.useRealTimers();
    
    // Restore spies if they exist
    if (global.setInterval && global.setInterval.mockRestore) {
      global.setInterval.mockRestore();
    }
    if (global.clearInterval && global.clearInterval.mockRestore) {
      global.clearInterval.mockRestore();
    }
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const defaultRegistry = new Registry();
      
      expect(defaultRegistry.entryLifetime).toBe(30000);
      expect(defaultRegistry.cleanupInterval).toBe(60000);
      expect(defaultRegistry.enableLogging).toBe(true);
      expect(defaultRegistry.size).toBe(0);
      
      defaultRegistry.destroy();
    });

    it('should initialize with custom values', () => {
      registry = new Registry({
        entryLifetime: 1000,
        cleanupInterval: 2000,
        enableLogging: true
      });
      
      expect(registry.entryLifetime).toBe(1000);
      expect(registry.cleanupInterval).toBe(2000);
      expect(registry.enableLogging).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        '[RequestRegistry] Initialized with entryLifetime=1000ms, cleanupInterval=2000ms'
      );
    });

    it('should respect enableLogging=false', () => {
      jest.clearAllMocks(); // Clear previous logger calls
      const silentRegistry = new Registry({ enableLogging: false });
      
      expect(silentRegistry.enableLogging).toBe(false);
      expect(logger.info).not.toHaveBeenCalled();
      
      silentRegistry.destroy();
    });

    it('should start cleanup interval timer', () => {
      registry = new Registry({
        entryLifetime: 1000,
        cleanupInterval: 2000,
        enableLogging: true
      });
      
      expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 2000);
    });
  });

  describe('generateRequestId', () => {
    beforeEach(() => {
      registry = new Registry({
        entryLifetime: 1000,
        cleanupInterval: 2000,
        enableLogging: true
      });
    });
    
    it('should generate unique request IDs', () => {
      const id1 = registry.generateRequestId('test');
      const id2 = registry.generateRequestId('test');
      
      expect(id1).toMatch(/^test-\d+-[a-z0-9]{8}$/);
      expect(id2).toMatch(/^test-\d+-[a-z0-9]{8}$/);
      expect(id1).not.toBe(id2);
    });

    it('should handle empty baseName', () => {
      const id = registry.generateRequestId('');
      expect(id).toMatch(/^-\d+-[a-z0-9]{8}$/);
    });
  });

  describe('addRequest', () => {
    beforeEach(() => {
      registry = new Registry({
        entryLifetime: 1000,
        cleanupInterval: 2000,
        enableLogging: true
      });
    });
    
    it('should add a request to the registry', () => {
      const entry = registry.addRequest('test-key', { customData: 'value' });
      
      expect(entry).toMatchObject({
        requestId: expect.stringMatching(/^test-\d+-[a-z0-9]{8}$/),
        timestamp: expect.any(Number),
        completed: false,
        customData: 'value'
      });
      expect(registry.size).toBe(1);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Added request:')
      );
    });

    it('should throw error for missing key', () => {
      expect(() => registry.addRequest()).toThrow('Request key is required');
      expect(() => registry.addRequest('')).toThrow('Request key is required');
      expect(() => registry.addRequest(null)).toThrow('Request key is required');
    });

    it('should handle key without dash', () => {
      const entry = registry.addRequest('simplekey');
      expect(entry.requestId).toMatch(/^simplekey-\d+-[a-z0-9]{8}$/);
    });

    it('should merge provided data with default fields', () => {
      const entry = registry.addRequest('test-key', {
        userId: '123',
        action: 'test-action'
      });
      
      expect(entry).toMatchObject({
        requestId: expect.any(String),
        timestamp: expect.any(Number),
        completed: false,
        userId: '123',
        action: 'test-action'
      });
    });
  });

  describe('checkRequest', () => {
    beforeEach(() => {
      registry = new Registry({
        entryLifetime: 1000,
        cleanupInterval: 2000,
        enableLogging: true
      });
    });
    
    it('should return request data if found', () => {
      registry.addRequest('test-key', { data: 'test' });
      
      const result = registry.checkRequest('test-key');
      
      expect(result).toMatchObject({
        requestId: expect.any(String),
        timestamp: expect.any(Number),
        completed: false,
        data: 'test'
      });
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Found request: test-key, status: pending')
      );
    });

    it('should return null if request not found', () => {
      const result = registry.checkRequest('nonexistent');
      
      expect(result).toBeNull();
    });

    it('should return null for invalid keys', () => {
      expect(registry.checkRequest()).toBeNull();
      expect(registry.checkRequest('')).toBeNull();
      expect(registry.checkRequest(null)).toBeNull();
    });

    it('should return a copy of the entry', () => {
      registry.addRequest('test-key', { mutable: 'data' });
      
      const result = registry.checkRequest('test-key');
      result.mutable = 'modified';
      
      const original = registry.checkRequest('test-key');
      expect(original.mutable).toBe('data');
    });
  });

  describe('isDuplicate', () => {
    beforeEach(() => {
      registry = new Registry({
        entryLifetime: 1000,
        cleanupInterval: 2000,
        enableLogging: true
      });
    });
    
    it('should detect duplicate within time window', () => {
      registry.addRequest('test-key');
      
      const result = registry.isDuplicate('test-key');
      
      expect(result).toMatchObject({
        isDuplicate: true,
        requestId: expect.any(String),
        timeSinceOriginal: expect.any(Number),
        originalEntry: expect.objectContaining({
          completed: false
        })
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate request detected')
      );
    });

    it('should not detect duplicate outside time window', () => {
      registry.addRequest('test-key');
      
      // Advance time past the entry lifetime
      jest.advanceTimersByTime(1100);
      
      const result = registry.isDuplicate('test-key');
      expect(result).toBeNull();
    });

    it('should return null for non-existent requests', () => {
      const result = registry.isDuplicate('nonexistent');
      expect(result).toBeNull();
    });

    it('should respect custom time window', () => {
      registry.addRequest('test-key');
      
      // Advance time but within custom window
      jest.advanceTimersByTime(600);
      
      const result = registry.isDuplicate('test-key', { timeWindow: 500 });
      expect(result).toBeNull();
    });

    it('should handle blockIncomplete option', () => {
      registry.addRequest('test-key');
      
      // Should block by default
      let result = registry.isDuplicate('test-key');
      expect(result).not.toBeNull();
      
      // Should not block incomplete when option is false
      result = registry.isDuplicate('test-key', { blockIncomplete: false });
      expect(result).toBeNull();
      
      // Complete the request
      registry.completeRequest('test-key');
      
      // Should block completed requests regardless of option
      result = registry.isDuplicate('test-key', { blockIncomplete: false });
      expect(result).not.toBeNull();
    });
  });

  describe('updateRequest', () => {
    beforeEach(() => {
      registry = new Registry({
        entryLifetime: 1000,
        cleanupInterval: 2000,
        enableLogging: true
      });
    });
    
    it('should update existing request', () => {
      registry.addRequest('test-key', { status: 'pending' });
      
      const result = registry.updateRequest('test-key', {
        status: 'processing',
        progress: 50
      });
      
      expect(result).toBe(true);
      expect(registry.checkRequest('test-key')).toMatchObject({
        status: 'processing',
        progress: 50
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Updated request: test-key')
      );
    });

    it('should return false for non-existent request', () => {
      const result = registry.updateRequest('nonexistent', { status: 'test' });
      
      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        '[RequestRegistry] Cannot update; request not found: nonexistent'
      );
    });

    it('should preserve existing fields not in updates', () => {
      registry.addRequest('test-key', { field1: 'value1', field2: 'value2' });
      
      registry.updateRequest('test-key', { field2: 'updated' });
      
      const entry = registry.checkRequest('test-key');
      expect(entry.field1).toBe('value1');
      expect(entry.field2).toBe('updated');
    });
  });

  describe('completeRequest', () => {
    beforeEach(() => {
      registry = new Registry({
        entryLifetime: 1000,
        cleanupInterval: 2000,
        enableLogging: true
      });
    });
    
    it('should mark request as completed', () => {
      registry.addRequest('test-key');
      
      // Advance time slightly to ensure completedAt > timestamp
      jest.advanceTimersByTime(1);
      
      const result = registry.completeRequest('test-key');
      
      expect(result).toBe(true);
      const entry = registry.checkRequest('test-key');
      expect(entry.completed).toBe(true);
      expect(entry.completedAt).toBeDefined();
      expect(entry.completedAt).toBeGreaterThanOrEqual(entry.timestamp);
    });

    it('should include additional data', () => {
      registry.addRequest('test-key');
      
      registry.completeRequest('test-key', {
        result: 'success',
        responseTime: 123
      });
      
      const entry = registry.checkRequest('test-key');
      expect(entry).toMatchObject({
        completed: true,
        completedAt: expect.any(Number),
        result: 'success',
        responseTime: 123
      });
    });

    it('should return false for non-existent request', () => {
      const result = registry.completeRequest('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('removeRequest', () => {
    beforeEach(() => {
      registry = new Registry({
        entryLifetime: 1000,
        cleanupInterval: 2000,
        enableLogging: true
      });
    });
    
    it('should remove existing request', () => {
      registry.addRequest('test-key');
      expect(registry.size).toBe(1);
      
      const result = registry.removeRequest('test-key');
      
      expect(result).toBe(true);
      expect(registry.size).toBe(0);
      expect(registry.checkRequest('test-key')).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        '[RequestRegistry] Removed request: test-key'
      );
    });

    it('should return false for non-existent request', () => {
      const result = registry.removeRequest('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('cleanupOldEntries', () => {
    beforeEach(() => {
      registry = new Registry({
        entryLifetime: 1000,
        cleanupInterval: 2000,
        enableLogging: true
      });
    });
    
    it('should remove entries older than maxAge', () => {
      // Add some requests
      registry.addRequest('old-1');
      registry.addRequest('old-2');
      
      // Advance time
      jest.advanceTimersByTime(1500);
      
      // Add newer requests
      registry.addRequest('new-1');
      registry.addRequest('new-2');
      
      expect(registry.size).toBe(4);
      
      // Cleanup with default maxAge (1000ms)
      const removed = registry.cleanupOldEntries();
      
      expect(removed).toBe(2);
      expect(registry.size).toBe(2);
      expect(registry.checkRequest('old-1')).toBeNull();
      expect(registry.checkRequest('old-2')).toBeNull();
      expect(registry.checkRequest('new-1')).not.toBeNull();
      expect(registry.checkRequest('new-2')).not.toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        '[RequestRegistry] Cleaned up 2 old entries, registry size: 2'
      );
    });

    it('should use custom maxAge', () => {
      registry.addRequest('test-1');
      
      jest.advanceTimersByTime(600);
      registry.addRequest('test-2');
      
      // Cleanup with custom maxAge
      const removed = registry.cleanupOldEntries(500);
      
      expect(removed).toBe(1);
      expect(registry.checkRequest('test-1')).toBeNull();
      expect(registry.checkRequest('test-2')).not.toBeNull();
    });

    it('should return 0 when no entries to remove', () => {
      registry.addRequest('test');
      
      const removed = registry.cleanupOldEntries();
      
      expect(removed).toBe(0);
      expect(registry.size).toBe(1);
    });

    it('should be called automatically by cleanup interval', () => {
      registry.addRequest('test');
      
      // Spy on cleanupOldEntries
      jest.spyOn(registry, 'cleanupOldEntries');
      
      // Advance time to trigger cleanup interval
      jest.advanceTimersByTime(2000);
      
      expect(registry.cleanupOldEntries).toHaveBeenCalled();
    });
  });

  describe('size getter', () => {
    beforeEach(() => {
      registry = new Registry({
        entryLifetime: 1000,
        cleanupInterval: 2000,
        enableLogging: true
      });
    });
    
    it('should return current registry size', () => {
      expect(registry.size).toBe(0);
      
      registry.addRequest('test-1');
      expect(registry.size).toBe(1);
      
      registry.addRequest('test-2');
      expect(registry.size).toBe(2);
      
      registry.removeRequest('test-1');
      expect(registry.size).toBe(1);
    });
  });

  describe('getAllEntries', () => {
    beforeEach(() => {
      registry = new Registry({
        entryLifetime: 1000,
        cleanupInterval: 2000,
        enableLogging: true
      });
    });
    
    it('should return copy of all entries', () => {
      registry.addRequest('test-1', { data: 'one' });
      registry.addRequest('test-2', { data: 'two' });
      
      const entries = registry.getAllEntries();
      
      expect(entries).toBeInstanceOf(Map);
      expect(entries.size).toBe(2);
      expect(entries.has('test-1')).toBe(true);
      expect(entries.has('test-2')).toBe(true);
      
      // Verify it's a copy
      entries.delete('test-1');
      expect(registry.size).toBe(2);
    });

    it('should return empty map when registry is empty', () => {
      const entries = registry.getAllEntries();
      
      expect(entries).toBeInstanceOf(Map);
      expect(entries.size).toBe(0);
    });
  });

  describe('destroy', () => {
    beforeEach(() => {
      registry = new Registry({
        entryLifetime: 1000,
        cleanupInterval: 2000,
        enableLogging: true
      });
    });
    
    it('should clean up resources and clear registry', () => {
      registry.addRequest('test-1');
      registry.addRequest('test-2');
      
      expect(registry.size).toBe(2);
      
      registry.destroy();
      
      expect(registry.size).toBe(0);
      expect(clearInterval).toHaveBeenCalled();
      expect(registry.cleanupIntervalId).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        '[RequestRegistry] Registry destroyed and resources cleaned up'
      );
    });

    it('should handle multiple destroy calls', () => {
      registry.destroy();
      
      // Second destroy should not throw
      expect(() => registry.destroy()).not.toThrow();
    });
  });

  describe('integration scenarios', () => {
    beforeEach(() => {
      registry = new Registry({
        entryLifetime: 1000,
        cleanupInterval: 2000,
        enableLogging: true
      });
    });
    
    it('should handle typical request lifecycle', () => {
      // 1. Add request
      const entry = registry.addRequest('user-123-action', {
        userId: '123',
        action: 'sendMessage'
      });
      
      // 2. Check for duplicates
      const dupCheck = registry.isDuplicate('user-123-action');
      expect(dupCheck).not.toBeNull();
      
      // 3. Update progress
      registry.updateRequest('user-123-action', { progress: 50 });
      
      // 4. Complete request
      registry.completeRequest('user-123-action', { result: 'success' });
      
      // 5. Verify final state
      const final = registry.checkRequest('user-123-action');
      expect(final).toMatchObject({
        completed: true,
        progress: 50,
        result: 'success'
      });
    });

    it('should handle concurrent requests with different keys', () => {
      registry.addRequest('user-123-action1');
      registry.addRequest('user-123-action2');
      registry.addRequest('user-456-action1');
      
      expect(registry.size).toBe(3);
      
      // Each should be tracked independently
      expect(registry.isDuplicate('user-123-action1')).not.toBeNull();
      expect(registry.isDuplicate('user-123-action2')).not.toBeNull();
      expect(registry.isDuplicate('user-456-action1')).not.toBeNull();
    });
  });

  describe('silent mode', () => {
    let silentRegistry;

    beforeEach(() => {
      silentRegistry = new Registry({
        enableLogging: false,
        entryLifetime: 1000,
        cleanupInterval: 2000
      });
    });

    afterEach(() => {
      silentRegistry.destroy();
    });

    it('should not log operations when enableLogging is false', () => {
      const initialCallCount = logger.info.mock.calls.length;
      
      silentRegistry.addRequest('test');
      silentRegistry.checkRequest('test');
      silentRegistry.isDuplicate('test');
      silentRegistry.updateRequest('test', { data: 'test' });
      silentRegistry.completeRequest('test');
      silentRegistry.removeRequest('test');
      silentRegistry.cleanupOldEntries();
      silentRegistry.destroy();
      
      // No new log calls should have been made
      expect(logger.info).toHaveBeenCalledTimes(initialCallCount);
      expect(logger.debug).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});