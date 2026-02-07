/**
 * GatewayClient Tests
 *
 * Tests the API Gateway HTTP client for AI generation requests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GatewayClient,
  _clearAdminSettingsCacheForTesting,
  invalidateChannelSettingsCache,
  clearAllChannelSettingsCache,
} from './GatewayClient.js';
import { JobStatus, ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types';

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    getConfig: () => ({
      GATEWAY_URL: 'http://default-gateway.test',
      INTERNAL_SERVICE_SECRET: 'test-secret',
    }),
  };
});

describe('GatewayClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let originalAbortSignalTimeout: typeof AbortSignal.timeout;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    // Mock AbortSignal.timeout to work with fake timers
    // Returns a signal that never aborts (tests mock fetch directly)
    originalAbortSignalTimeout = AbortSignal.timeout;
    AbortSignal.timeout = () => new AbortController().signal;

    // Clear caches between tests
    clearAllChannelSettingsCache();
    _clearAdminSettingsCacheForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    AbortSignal.timeout = originalAbortSignalTimeout;
  });

  describe('constructor', () => {
    it('should use provided baseUrl', () => {
      const client = new GatewayClient('http://custom.test');
      // Verify by making a request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobId: 'job-1', requestId: 'req-1', status: 'pending' }),
      });

      client.generate({ name: 'test' } as never, { messageContent: 'hi' } as never);

      expect(mockFetch).toHaveBeenCalledWith('http://custom.test/ai/generate', expect.any(Object));
    });

    it('should fall back to config.GATEWAY_URL when not provided', () => {
      const client = new GatewayClient();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobId: 'job-1', requestId: 'req-1', status: 'pending' }),
      });

      client.generate({ name: 'test' } as never, { messageContent: 'hi' } as never);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://default-gateway.test/ai/generate',
        expect.any(Object)
      );
    });
  });

  describe('generate()', () => {
    it('should return jobId and requestId on success', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobId: 'job-123', requestId: 'req-456', status: 'pending' }),
      });

      const result = await client.generate(
        { name: 'personality', displayName: 'Test' } as never,
        { messageContent: 'Hello', userId: 'user-1' } as never
      );

      expect(result).toEqual({ jobId: 'job-123', requestId: 'req-456' });
    });

    it('should throw on non-ok response', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(
        client.generate({ name: 'test' } as never, { messageContent: 'hi' } as never)
      ).rejects.toThrow('Gateway request failed: 500 Internal Server Error');
    });

    it('should throw on network error', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        client.generate({ name: 'test' } as never, { messageContent: 'hi' } as never)
      ).rejects.toThrow('Network error');
    });

    it('should send correct headers and body', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobId: 'job-1', requestId: 'req-1', status: 'pending' }),
      });

      const personality = { name: 'test-personality', model: 'gpt-4' };
      const context = {
        messageContent: 'Hello world',
        userId: 'user-123',
        conversationHistory: [{ role: 'user', content: 'Previous' }],
      };

      await client.generate(personality as never, context as never);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.gateway/ai/generate',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': 'test-secret',
          },
          body: expect.stringContaining('"message":"Hello world"'),
        })
      );
    });
  });

  describe('transcribe()', () => {
    it('should return content on success', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jobId: 'job-1',
            status: JobStatus.Completed,
            result: {
              content: 'Transcribed text',
              metadata: { processingTimeMs: 1500 },
            },
          }),
      });

      const result = await client.transcribe([
        { url: 'http://audio.test/file.ogg', contentType: 'audio/ogg' },
      ]);

      expect(result).toEqual({
        content: 'Transcribed text',
        metadata: { processingTimeMs: 1500 },
      });
    });

    it('should throw on non-ok response', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      });

      await expect(
        client.transcribe([{ url: 'http://test/audio.ogg', contentType: 'audio/ogg' }])
      ).rejects.toThrow('Transcription request failed: 400 Bad Request');
    });

    it('should throw on non-completed status', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jobId: 'job-failed',
            status: JobStatus.Failed,
            result: null,
          }),
      });

      await expect(
        client.transcribe([{ url: 'http://test/audio.ogg', contentType: 'audio/ogg' }])
      ).rejects.toThrow('Transcription job job-failed status: failed');
    });

    it('should throw on empty content', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jobId: 'job-1',
            status: JobStatus.Completed,
            result: { content: '' },
          }),
      });

      await expect(
        client.transcribe([{ url: 'http://test/audio.ogg', contentType: 'audio/ogg' }])
      ).rejects.toThrow('No transcript in job result');
    });

    it('should use wait=true query param', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jobId: 'job-1',
            status: JobStatus.Completed,
            result: { content: 'text' },
          }),
      });

      await client.transcribe([{ url: 'http://test/audio.ogg', contentType: 'audio/ogg' }]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.gateway/ai/transcribe?wait=true',
        expect.any(Object)
      );
    });
  });

  describe('confirmDelivery()', () => {
    it('should succeed silently on ok response', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({ ok: true });

      await expect(client.confirmDelivery('job-123')).resolves.toBeUndefined();
    });

    it('should not throw on failure (best-effort)', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Error'),
      });

      // Should not throw
      await expect(client.confirmDelivery('job-123')).resolves.toBeUndefined();
    });

    it('should not throw on network error (best-effort)', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Should not throw
      await expect(client.confirmDelivery('job-123')).resolves.toBeUndefined();
    });

    it('should use correct endpoint', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({ ok: true });

      await client.confirmDelivery('job-xyz');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.gateway/ai/job/job-xyz/confirm-delivery',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('pollJobUntilComplete()', () => {
    // Tests that complete immediately (no setTimeout involved) use real timers
    describe('immediate completion/failure', () => {
      it('should return result when job completes immediately', async () => {
        const client = new GatewayClient('http://test.gateway');
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'completed',
              result: { content: 'AI response', metadata: {} },
            }),
        });

        const result = await client.pollJobUntilComplete('job-123');

        expect(result).toEqual({ content: 'AI response', metadata: {} });
      });

      it('should throw on failed job status', async () => {
        const client = new GatewayClient('http://test.gateway');
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ status: 'failed' }),
        });

        await expect(client.pollJobUntilComplete('job-123')).rejects.toThrow('Job job-123 failed');
      });

      it('should use default options from constants', async () => {
        const client = new GatewayClient('http://test.gateway');
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'completed',
              result: { content: 'Result' },
            }),
        });

        await client.pollJobUntilComplete('job-123');

        // Verify it used the constants (implicitly tested by not throwing)
        expect(mockFetch).toHaveBeenCalledWith(
          'http://test.gateway/ai/job/job-123',
          expect.any(Object)
        );
      });
    });

    // Tests involving polling/waiting use fake timers
    describe('polling behavior', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      it('should poll multiple times until completion', async () => {
        const client = new GatewayClient('http://test.gateway');

        let fetchCount = 0;
        mockFetch.mockImplementation(() => {
          fetchCount++;
          if (fetchCount === 1) {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ status: 'pending' }),
            });
          } else if (fetchCount === 2) {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ status: 'processing' }),
            });
          } else {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  status: 'completed',
                  result: { content: 'Done!' },
                }),
            });
          }
        });

        const pollPromise = client.pollJobUntilComplete('job-123', {
          maxWaitMs: 10000,
          pollIntervalMs: 100,
        });

        // Run all timers and microtasks until the promise resolves
        await vi.runAllTimersAsync();

        const result = await pollPromise;
        expect(result).toEqual({ content: 'Done!' });
        expect(fetchCount).toBe(3);
      });

      it('should throw on timeout', async () => {
        const client = new GatewayClient('http://test.gateway');

        // Always return pending
        mockFetch.mockImplementation(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ status: 'pending' }),
          })
        );

        const pollPromise = client.pollJobUntilComplete('job-123', {
          maxWaitMs: 500,
          pollIntervalMs: 100,
        });

        // IMPORTANT: Attach rejection handler BEFORE running timers
        const assertionPromise = expect(pollPromise).rejects.toThrow(
          'Job job-123 timed out after 500ms'
        );

        // Run all timers - this will exhaust the while loop
        await vi.runAllTimersAsync();

        await assertionPromise;
      });

      it('should retry on network error during poll', async () => {
        const client = new GatewayClient('http://test.gateway');

        // First poll: network error
        mockFetch.mockRejectedValueOnce(new Error('Network error'));
        // Second poll (after retry): success
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'completed',
              result: { content: 'Success after retry' },
            }),
        });

        const pollPromise = client.pollJobUntilComplete('job-123', {
          pollIntervalMs: 100,
        });

        // Run all timers
        await vi.runAllTimersAsync();

        const result = await pollPromise;
        expect(result).toEqual({ content: 'Success after retry' });
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it('should handle non-ok response during poll', async () => {
        const client = new GatewayClient('http://test.gateway');

        // First poll: 500 error
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
        });
        // Second poll (after retry): success
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'completed',
              result: { content: 'Got it' },
            }),
        });

        const pollPromise = client.pollJobUntilComplete('job-123', {
          pollIntervalMs: 100,
        });

        // Run all timers
        await vi.runAllTimersAsync();

        const result = await pollPromise;
        expect(result).toEqual({ content: 'Got it' });
      });
    });
  });

  describe('getChannelActivation()', () => {
    it('should return activation data when channel is activated', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            isActivated: true,
            activation: {
              id: 'activation-uuid',
              channelId: '123456789012345678',
              personalitySlug: 'test-char',
              personalityName: 'Test Character',
              activatedBy: 'user-uuid',
              createdAt: '2024-01-01T00:00:00.000Z',
            },
          }),
      });

      const result = await client.getChannelActivation('123456789012345678');

      expect(result).toEqual({
        isActivated: true,
        activation: expect.objectContaining({
          personalitySlug: 'test-char',
          personalityName: 'Test Character',
        }),
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.gateway/user/channel/123456789012345678',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Service-Auth': 'test-secret',
          }),
        })
      );
    });

    it('should return isActivated=false when no activation', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            isActivated: false,
          }),
      });

      const result = await client.getChannelActivation('123456789012345678');

      expect(result).toEqual({
        isActivated: false,
      });
    });

    it('should return null on non-ok response', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await client.getChannelActivation('123456789012345678');

      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.getChannelActivation('123456789012345678');

      expect(result).toBeNull();
    });

    it('should return cached result on second call', async () => {
      const client = new GatewayClient('http://test.gateway');
      const activationData = {
        isActivated: true,
        activation: {
          id: 'activation-uuid',
          channelId: '123456789012345678',
          personalitySlug: 'test-char',
          personalityName: 'Test Character',
          activatedBy: 'user-uuid',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(activationData),
      });

      // First call - should fetch from gateway
      const result1 = await client.getChannelActivation('123456789012345678');
      expect(result1).toEqual(activationData);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - should return cached result without fetch
      const result2 = await client.getChannelActivation('123456789012345678');
      expect(result2).toEqual(activationData);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still only 1 call
    });

    it('should cache isActivated=false responses', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ isActivated: false }),
      });

      // First call - should fetch
      const result1 = await client.getChannelActivation('not-activated-channel');
      expect(result1).toEqual({ isActivated: false });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - should return cached result
      const result2 = await client.getChannelActivation('not-activated-channel');
      expect(result2).toEqual({ isActivated: false });
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still only 1 call
    });

    it('should not cache errors', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ isActivated: false }),
      });

      // First call - should fail
      const result1 = await client.getChannelActivation('error-channel');
      expect(result1).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - should retry fetch (error wasn't cached)
      const result2 = await client.getChannelActivation('error-channel');
      expect(result2).toEqual({ isActivated: false });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('healthCheck()', () => {
    it('should return true on ok response', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await client.healthCheck();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('http://test.gateway/health');
    });

    it('should return false on non-ok response', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('getAdminSettings()', () => {
    it('should return admin settings on success', async () => {
      const client = new GatewayClient('http://test.gateway');
      const settingsData = {
        id: ADMIN_SETTINGS_SINGLETON_ID,
        updatedBy: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(settingsData),
      });

      const result = await client.getAdminSettings();

      expect(result).toEqual(settingsData);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.gateway/admin/settings',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Service-Auth': 'test-secret',
          }),
        })
      );
    });

    it('should return null on non-ok response', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await client.getAdminSettings();

      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.getAdminSettings();

      expect(result).toBeNull();
    });

    it('should cache admin settings (singleton)', async () => {
      const client = new GatewayClient('http://test.gateway');
      const settingsData = {
        id: ADMIN_SETTINGS_SINGLETON_ID,
        updatedBy: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(settingsData),
      });

      // First call - should fetch
      const result1 = await client.getAdminSettings();
      expect(result1).toEqual(settingsData);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - should return cached
      const result2 = await client.getAdminSettings();
      expect(result2).toEqual(settingsData);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should invalidate cache when invalidateAdminSettingsCache is called', async () => {
      const client = new GatewayClient('http://test.gateway');
      const settingsData = {
        id: ADMIN_SETTINGS_SINGLETON_ID,
        updatedBy: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(settingsData),
      });

      // First call - fetch
      await client.getAdminSettings();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Invalidate cache
      client.invalidateAdminSettingsCache();

      // Second call - should fetch again
      await client.getAdminSettings();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('lookupPersonalityFromConversation()', () => {
    it('should return personality data when found', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            personalityId: 'personality-uuid-123',
            personalityName: 'TestBot',
          }),
      });

      const result = await client.lookupPersonalityFromConversation('msg-123');

      expect(result).toEqual({
        personalityId: 'personality-uuid-123',
        personalityName: 'TestBot',
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.gateway/user/conversation/message-personality?discordMessageId=msg-123',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Service-Auth': 'test-secret',
          }),
        })
      );
    });

    it('should return null on 404 (message not found)', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await client.lookupPersonalityFromConversation('nonexistent-msg');

      expect(result).toBeNull();
    });

    it('should return null on non-ok response (other errors)', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await client.lookupPersonalityFromConversation('msg-123');

      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.lookupPersonalityFromConversation('msg-123');

      expect(result).toBeNull();
    });

    it('should URL-encode the discordMessageId', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            personalityId: 'personality-uuid-123',
          }),
      });

      await client.lookupPersonalityFromConversation('msg with spaces');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.gateway/user/conversation/message-personality?discordMessageId=msg%20with%20spaces',
        expect.any(Object)
      );
    });
  });

  describe('cache invalidation functions', () => {
    it('invalidateChannelSettingsCache should clear specific channel from cache', async () => {
      const client = new GatewayClient('http://test.gateway');

      // First, populate the cache
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ hasSettings: true }),
      });
      await client.getChannelSettings('channel-123');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Invalidate the cache for this channel
      invalidateChannelSettingsCache('channel-123');

      // Next call should fetch again
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ hasSettings: true }),
      });
      await client.getChannelSettings('channel-123');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('clearAllChannelSettingsCache should clear entire cache', async () => {
      const client = new GatewayClient('http://test.gateway');

      // Populate cache for multiple channels
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ hasSettings: true }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ hasSettings: false }),
      });
      await client.getChannelSettings('channel-1');
      await client.getChannelSettings('channel-2');
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Clear all cache
      clearAllChannelSettingsCache();

      // Both should fetch again
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ hasSettings: true }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ hasSettings: false }),
      });
      await client.getChannelSettings('channel-1');
      await client.getChannelSettings('channel-2');
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('updateDiagnosticResponseIds()', () => {
    it('should send PATCH request with response message IDs', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await client.updateDiagnosticResponseIds('req-123', ['msg-1', 'msg-2']);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.gateway/admin/diagnostic/req-123/response-ids',
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Service-Auth': 'test-secret',
          }),
          body: JSON.stringify({ responseMessageIds: ['msg-1', 'msg-2'] }),
        })
      );
    });

    it('should URL-encode the requestId', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await client.updateDiagnosticResponseIds('req with spaces', ['msg-1']);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.gateway/admin/diagnostic/req%20with%20spaces/response-ids',
        expect.any(Object)
      );
    });

    it('should not throw on non-ok response (fire-and-forget)', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // Should not throw
      await expect(
        client.updateDiagnosticResponseIds('req-123', ['msg-1'])
      ).resolves.toBeUndefined();
    });

    it('should not throw on network error (fire-and-forget)', async () => {
      const client = new GatewayClient('http://test.gateway');
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Should not throw
      await expect(
        client.updateDiagnosticResponseIds('req-123', ['msg-1'])
      ).resolves.toBeUndefined();
    });
  });
});
