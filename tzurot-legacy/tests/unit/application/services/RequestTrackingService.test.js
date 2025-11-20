const RequestTrackingService = require('../../../../src/application/services/RequestTrackingService');

describe('RequestTrackingService', () => {
  let service;
  let mockScheduler;
  let mockClearScheduler;
  let scheduledCallbacks;

  beforeEach(() => {
    // Mock timers
    scheduledCallbacks = [];
    mockScheduler = jest.fn((callback, delay) => {
      const id = scheduledCallbacks.length;
      scheduledCallbacks.push({ callback, delay, id });
      return id;
    });
    mockClearScheduler = jest.fn((id) => {
      const index = scheduledCallbacks.findIndex(item => item.id === id);
      if (index > -1) {
        scheduledCallbacks.splice(index, 1);
      }
    });

    // Create service with mocked timers
    service = new RequestTrackingService({
      scheduler: mockScheduler,
      clearScheduler: mockClearScheduler,
      pendingWindowMs: 1000,
      completedWindowMs: 500,
      cleanupIntervalMs: 5000
    });
  });

  afterEach(() => {
    service.stopCleanup();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const defaultService = new RequestTrackingService({
        scheduler: mockScheduler,
        clearScheduler: mockClearScheduler
      });
      expect(defaultService.pendingWindowMs).toBe(10000);
      expect(defaultService.completedWindowMs).toBe(5000);
      expect(defaultService.cleanupIntervalMs).toBe(60000);
      
      // Cleanup
      defaultService.stopCleanup();
    });

    it('should accept custom configuration', () => {
      expect(service.pendingWindowMs).toBe(1000);
      expect(service.completedWindowMs).toBe(500);
      expect(service.cleanupIntervalMs).toBe(5000);
    });

    it('should start cleanup timer on initialization', () => {
      expect(mockScheduler).toHaveBeenCalledWith(expect.any(Function), 5000);
    });
  });

  describe('checkRequest', () => {
    it('should allow new requests', () => {
      const result = service.checkRequest('user123-personality1');
      expect(result).toEqual({
        isPending: false,
        isCompleted: false,
        canProceed: true
      });
    });

    it('should block pending requests within window', () => {
      service.markPending('user123-personality1');
      const result = service.checkRequest('user123-personality1');
      expect(result).toEqual({
        isPending: true,
        isCompleted: false,
        canProceed: false,
        reason: 'Request is already in progress'
      });
    });

    it('should allow pending requests after window expires', () => {
      const now = Date.now();
      service.pendingRequests.set('user123-personality1', {
        timestamp: now - 1100 // Beyond 1000ms window
      });
      
      const result = service.checkRequest('user123-personality1');
      expect(result.canProceed).toBe(true);
    });

    it('should block recently completed requests', () => {
      service.markCompleted('user123-personality1');
      const result = service.checkRequest('user123-personality1');
      expect(result).toEqual({
        isPending: false,
        isCompleted: true,
        canProceed: false,
        reason: 'Request was recently completed'
      });
    });

    it('should allow completed requests after window expires', () => {
      const now = Date.now();
      service.completedRequests.set('user123-personality1', {
        timestamp: now - 600 // Beyond 500ms window
      });
      
      const result = service.checkRequest('user123-personality1');
      expect(result.canProceed).toBe(true);
    });
  });

  describe('markPending', () => {
    it('should add request to pending map', () => {
      service.markPending('user123-personality1');
      expect(service.pendingRequests.has('user123-personality1')).toBe(true);
    });

    it('should store metadata with request', () => {
      service.markPending('user123-personality1', { userId: 'user123' });
      const request = service.pendingRequests.get('user123-personality1');
      expect(request.userId).toBe('user123');
      expect(request.timestamp).toBeDefined();
    });
  });

  describe('markCompleted', () => {
    it('should move request from pending to completed', () => {
      service.markPending('user123-personality1');
      service.markCompleted('user123-personality1');
      
      expect(service.pendingRequests.has('user123-personality1')).toBe(false);
      expect(service.completedRequests.has('user123-personality1')).toBe(true);
    });

    it('should store metadata with completion', () => {
      service.markCompleted('user123-personality1', { result: 'success' });
      const request = service.completedRequests.get('user123-personality1');
      expect(request.result).toBe('success');
      expect(request.timestamp).toBeDefined();
    });
  });

  describe('markFailed', () => {
    it('should remove request from pending without marking completed', () => {
      service.markPending('user123-personality1');
      service.markFailed('user123-personality1');
      
      expect(service.pendingRequests.has('user123-personality1')).toBe(false);
      expect(service.completedRequests.has('user123-personality1')).toBe(false);
    });
  });

  describe('message processing', () => {
    it('should track message processing state', () => {
      expect(service.isMessageProcessing('msg123')).toBe(false);
      
      service.markMessageProcessing('msg123');
      expect(service.isMessageProcessing('msg123')).toBe(true);
    });

    it('should auto-cleanup message processing after timeout', () => {
      service.markMessageProcessing('msg123');
      expect(mockScheduler).toHaveBeenCalledWith(expect.any(Function), 2000); // 2x pending window
    });
  });

  describe('generateAddCommandKey', () => {
    it('should generate key without alias', () => {
      const key = service.generateAddCommandKey('user123', 'TestPersonality');
      expect(key).toBe('user123-testpersonality');
    });

    it('should generate key with alias', () => {
      const key = service.generateAddCommandKey('user123', 'TestPersonality', 'tp');
      expect(key).toBe('user123-testpersonality-alias-tp');
    });

    it('should lowercase names and aliases', () => {
      const key = service.generateAddCommandKey('USER123', 'TESTPERSONALITY', 'TP');
      expect(key).toBe('USER123-testpersonality-alias-tp');
    });
  });

  describe('cleanup', () => {
    it('should remove old pending requests', () => {
      const now = Date.now();
      service.pendingRequests.set('old-request', { timestamp: now - 3000 });
      service.pendingRequests.set('new-request', { timestamp: now });
      
      // Manually trigger cleanup
      const cleanupCallback = scheduledCallbacks[0].callback;
      cleanupCallback();
      
      expect(service.pendingRequests.has('old-request')).toBe(false);
      expect(service.pendingRequests.has('new-request')).toBe(true);
    });

    it('should remove old completed requests', () => {
      const now = Date.now();
      service.completedRequests.set('old-request', { timestamp: now - 2000 });
      service.completedRequests.set('new-request', { timestamp: now });
      
      // Manually trigger cleanup
      const cleanupCallback = scheduledCallbacks[0].callback;
      cleanupCallback();
      
      expect(service.completedRequests.has('old-request')).toBe(false);
      expect(service.completedRequests.has('new-request')).toBe(true);
    });

    it('should reschedule cleanup after running', () => {
      const initialSchedulerCalls = mockScheduler.mock.calls.length;
      
      // Manually trigger cleanup
      const cleanupCallback = scheduledCallbacks[0].callback;
      cleanupCallback();
      
      expect(mockScheduler).toHaveBeenCalledTimes(initialSchedulerCalls + 1);
    });
  });

  describe('stopCleanup', () => {
    it('should clear cleanup timer', () => {
      service.stopCleanup();
      expect(mockClearScheduler).toHaveBeenCalled();
      expect(service.cleanupTimer).toBeNull();
    });

    it('should handle multiple calls gracefully', () => {
      service.stopCleanup();
      service.stopCleanup();
      expect(mockClearScheduler).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStats', () => {
    it('should return current tracking statistics', () => {
      service.markPending('req1');
      service.markPending('req2');
      service.markCompleted('req3');
      service.markMessageProcessing('msg1');
      
      const stats = service.getStats();
      expect(stats).toEqual({
        pendingRequests: 2,
        completedRequests: 1,
        processingMessages: 1
      });
    });
  });

  describe('clear', () => {
    it('should clear all tracking data', () => {
      service.markPending('req1');
      service.markCompleted('req2');
      service.markMessageProcessing('msg1');
      
      service.clear();
      
      expect(service.getStats()).toEqual({
        pendingRequests: 0,
        completedRequests: 0,
        processingMessages: 0
      });
    });
  });

  describe('integration scenarios', () => {
    it('should handle typical add command flow', () => {
      const key = service.generateAddCommandKey('user123', 'TestBot');
      
      // Check initial state
      expect(service.checkRequest(key).canProceed).toBe(true);
      
      // Mark as pending
      service.markPending(key);
      expect(service.checkRequest(key).canProceed).toBe(false);
      expect(service.checkRequest(key).reason).toBe('Request is already in progress');
      
      // Mark as completed
      service.markCompleted(key);
      expect(service.checkRequest(key).canProceed).toBe(false);
      expect(service.checkRequest(key).reason).toBe('Request was recently completed');
    });

    it('should handle failed request flow', () => {
      const key = service.generateAddCommandKey('user123', 'TestBot');
      
      service.markPending(key);
      service.markFailed(key);
      
      // Should be able to retry immediately after failure
      expect(service.checkRequest(key).canProceed).toBe(true);
    });

    it('should handle concurrent requests for different personalities', () => {
      const key1 = service.generateAddCommandKey('user123', 'Bot1');
      const key2 = service.generateAddCommandKey('user123', 'Bot2');
      
      service.markPending(key1);
      
      // Different personality should be allowed
      expect(service.checkRequest(key2).canProceed).toBe(true);
    });

    it('should handle concurrent requests from different users', () => {
      const key1 = service.generateAddCommandKey('user123', 'TestBot');
      const key2 = service.generateAddCommandKey('user456', 'TestBot');
      
      service.markPending(key1);
      
      // Different user should be allowed
      expect(service.checkRequest(key2).canProceed).toBe(true);
    });
  });
});