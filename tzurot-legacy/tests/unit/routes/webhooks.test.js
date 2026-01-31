/**
 * Tests for Webhooks Route
 */

// Mock dependencies
jest.mock('../../../src/logger');
jest.mock('crypto');
jest.mock('../../../src/core/notifications', () => ({
  releaseNotificationManager: {
    initialized: true,
    checkAndNotify: jest.fn().mockResolvedValue({ notified: false, reason: 'Test' }),
  },
}));

const webhooksRoute = require('../../../src/routes/webhooks');
const logger = require('../../../src/logger');
const crypto = require('crypto');

describe('Webhooks Route', () => {
  let mockRequest;
  let mockResponse;
  let mockCreateHmac;
  let mockHmac;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Set up logger mocks
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();

    // Mock crypto
    mockHmac = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue('mocked-signature'),
    };
    mockCreateHmac = jest.fn().mockReturnValue(mockHmac);
    crypto.createHmac = mockCreateHmac;
    // Note: crypto.timingSafeEqual will be mocked per test as needed

    // Create mock request and response objects
    mockRequest = {
      method: 'POST',
      url: '/webhook/github',
      headers: {},
      body: '',
      on: jest.fn(),
    };

    mockResponse = {
      writeHead: jest.fn(),
      end: jest.fn(),
      setHeader: jest.fn(),
    };

    // Set up default behavior for request event handlers
    mockRequest.on.mockImplementation((event, callback) => {
      if (event === 'data') {
        // Will be overridden per test with specific data
      } else if (event === 'end') {
        setImmediate(callback); // Call the end callback
      }
    });

    // Reset environment variables
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('route configuration', () => {
    it('should export routes array', () => {
      expect(webhooksRoute.routes).toBeDefined();
      expect(Array.isArray(webhooksRoute.routes)).toBe(true);
    });

    it('should define POST /webhook/github route', () => {
      const webhookRouteConfig = webhooksRoute.routes.find(
        route => route.method === 'POST' && route.path === '/webhook/github'
      );

      expect(webhookRouteConfig).toBeDefined();
      expect(typeof webhookRouteConfig.handler).toBe('function');
    });
  });

  describe('GitHub webhook handler', () => {
    let githubHandler;

    beforeEach(() => {
      githubHandler = webhooksRoute.routes.find(
        route => route.method === 'POST' && route.path === '/webhook/github'
      ).handler;
    });

    // Helper function to simulate webhook request with body parsing (async version)
    function simulateWebhookRequestAsync(payload, headers = {}) {
      Object.assign(mockRequest.headers, headers);

      let dataCallback, endCallback;

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback;
        } else if (event === 'end') {
          endCallback = callback;
        }
      });

      const responsePromise = new Promise(resolve => {
        mockResponse.end.mockImplementation(data => {
          resolve(JSON.parse(data));
        });
      });

      githubHandler(mockRequest, mockResponse);
      dataCallback(payload);
      endCallback();

      return responsePromise;
    }

    it('should reject requests without webhook secret configured', async () => {
      // No GITHUB_WEBHOOK_SECRET set
      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'sha256=test-signature';
      mockRequest.body = JSON.stringify({ action: 'published' });

      await githubHandler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(401, {
        'Content-Type': 'application/json',
      });

      const actualResponse = mockResponse.end.mock.calls[0][0];
      const parsedResponse = JSON.parse(actualResponse);

      expect(parsedResponse.error).toBe('Webhook secret not configured');
      expect(logger.warn).toHaveBeenCalledWith(
        '[Webhooks] GITHUB_WEBHOOK_SECRET not set - rejecting webhook'
      );
    });

    it('should reject requests without GitHub signature', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      crypto.timingSafeEqual = jest.fn().mockReturnValue(false);

      const payload = JSON.stringify({ action: 'published' });
      mockRequest.headers['x-github-event'] = 'release';
      // No x-hub-signature-256 header

      let dataCallback, endCallback;

      // Set up request body simulation - store callbacks for later
      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback;
        } else if (event === 'end') {
          endCallback = callback;
        }
      });

      const responsePromise = new Promise(resolve => {
        mockResponse.end.mockImplementation(data => {
          resolve(JSON.parse(data));
        });
      });

      // Call the handler - this sets up the event listeners
      githubHandler(mockRequest, mockResponse);

      // Simulate the request data flow
      dataCallback(payload);
      endCallback();

      const parsedResponse = await responsePromise;

      expect(mockResponse.writeHead).toHaveBeenCalledWith(401, {
        'Content-Type': 'application/json',
      });
      expect(parsedResponse.error).toBe('Invalid signature');
      expect(logger.warn).toHaveBeenCalledWith('[Webhooks] Invalid GitHub webhook signature');
    });

    it('should reject requests with invalid signature', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';

      const payload = JSON.stringify({ action: 'published' });
      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'sha256=invalid-signature';

      // Mock crypto to return different signature and fail timing comparison
      mockHmac.digest.mockReturnValue('different-signature');
      crypto.timingSafeEqual = jest.fn().mockReturnValue(false);

      let dataCallback, endCallback;

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback;
        } else if (event === 'end') {
          endCallback = callback;
        }
      });

      const responsePromise = new Promise(resolve => {
        mockResponse.end.mockImplementation(data => {
          resolve(JSON.parse(data));
        });
      });

      githubHandler(mockRequest, mockResponse);
      dataCallback(payload);
      endCallback();

      const parsedResponse = await responsePromise;

      expect(mockResponse.writeHead).toHaveBeenCalledWith(401, {
        'Content-Type': 'application/json',
      });
      expect(parsedResponse.error).toBe('Invalid signature');
      expect(logger.warn).toHaveBeenCalledWith('[Webhooks] Invalid GitHub webhook signature');
    });

    it('should accept valid release webhook', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';

      const payload = JSON.stringify({
        action: 'published',
        release: { tag_name: 'v1.2.0' },
      });

      // Set up crypto to match the expected signature and pass timing comparison
      mockHmac.digest.mockReturnValue('mocked-signature');
      crypto.timingSafeEqual = jest.fn().mockReturnValue(true);
      const expectedSignature = 'sha256=mocked-signature';

      const responsePromise = simulateWebhookRequestAsync(payload, {
        'x-github-event': 'release',
        'x-hub-signature-256': expectedSignature,
      });

      const parsedResponse = await responsePromise;

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });
      expect(parsedResponse.status).toBe('accepted');
      expect(parsedResponse.release).toBe('v1.2.0');
      expect(logger.info).toHaveBeenCalledWith(
        '[Webhooks] Received GitHub release webhook for: v1.2.0'
      );
    });

    it('should ignore non-release events', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      crypto.timingSafeEqual = jest.fn().mockReturnValue(true);

      const payload = JSON.stringify({ ref: 'refs/heads/main' });
      const responsePromise = simulateWebhookRequestAsync(payload, {
        'x-github-event': 'push',
        'x-hub-signature-256': 'sha256=mocked-signature',
      });

      const parsedResponse = await responsePromise;

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });

      expect(parsedResponse.status).toBe('ignored');
      expect(parsedResponse.reason).toBe('Not a release event');
      expect(logger.info).toHaveBeenCalledWith('[Webhooks] Ignoring GitHub event: push');
    });

    it('should accept prerelease releases (no filtering implemented)', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      crypto.timingSafeEqual = jest.fn().mockReturnValue(true);

      const payload = JSON.stringify({
        action: 'published',
        release: {
          tag_name: 'v1.2.0-beta',
          draft: false,
          prerelease: true,
        },
      });

      const responsePromise = simulateWebhookRequestAsync(payload, {
        'x-github-event': 'release',
        'x-hub-signature-256': 'sha256=mocked-signature',
      });

      const parsedResponse = await responsePromise;

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });

      // Current implementation accepts all published releases, including prereleases
      expect(parsedResponse.status).toBe('accepted');
      expect(parsedResponse.release).toBe('v1.2.0-beta');
      expect(logger.info).toHaveBeenCalledWith(
        '[Webhooks] Received GitHub release webhook for: v1.2.0-beta'
      );
    });

    it('should ignore non-published release actions', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      crypto.timingSafeEqual = jest.fn().mockReturnValue(true);

      const payload = JSON.stringify({
        action: 'created',
        release: { tag_name: 'v1.2.0' },
      });

      const responsePromise = simulateWebhookRequestAsync(payload, {
        'x-github-event': 'release',
        'x-hub-signature-256': 'sha256=mocked-signature',
      });

      const parsedResponse = await responsePromise;

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });

      expect(parsedResponse.status).toBe('ignored');
      expect(parsedResponse.reason).toBe('Not a published release');
      expect(logger.info).toHaveBeenCalledWith('[Webhooks] Ignoring release action: created');
    });

    it('should verify signature correctly', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      crypto.timingSafeEqual = jest.fn().mockReturnValue(true);

      const payload = JSON.stringify({ action: 'published' });

      const responsePromise = simulateWebhookRequestAsync(payload, {
        'x-github-event': 'release',
        'x-hub-signature-256': 'sha256=mocked-signature',
      });

      await responsePromise;

      expect(crypto.createHmac).toHaveBeenCalledWith('sha256', 'test-secret');
      expect(mockHmac.update).toHaveBeenCalledWith(payload);
      expect(mockHmac.digest).toHaveBeenCalledWith('hex');
    });

    it('should handle malformed JSON gracefully', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      crypto.timingSafeEqual = jest.fn().mockReturnValue(true);

      const responsePromise = simulateWebhookRequestAsync('invalid json', {
        'x-github-event': 'release',
        'x-hub-signature-256': 'sha256=mocked-signature',
      });

      const parsedResponse = await responsePromise;

      expect(mockResponse.writeHead).toHaveBeenCalledWith(500, {
        'Content-Type': 'application/json',
      });

      expect(parsedResponse.error).toBe('Internal server error');
      expect(logger.error).toHaveBeenCalledWith(
        '[Webhooks] Error processing webhook:',
        expect.any(Error)
      );
    });

    it('should handle missing request body', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      crypto.timingSafeEqual = jest.fn().mockReturnValue(true);

      const responsePromise = simulateWebhookRequestAsync('', {
        'x-github-event': 'release',
        'x-hub-signature-256': 'sha256=mocked-signature',
      });

      const parsedResponse = await responsePromise;

      expect(mockResponse.writeHead).toHaveBeenCalledWith(500, {
        'Content-Type': 'application/json',
      });

      expect(parsedResponse.error).toBe('Internal server error');
    });

    it('should handle context with notification manager', async () => {
      const mockNotificationManager = {
        checkAndNotify: jest.fn().mockResolvedValue({ notified: true }),
      };

      const context = {
        notificationManager: mockNotificationManager,
      };

      // Create handler with context
      const { createGitHubWebhookHandler } = require('../../../src/routes/webhooks');
      const contextHandler = createGitHubWebhookHandler(context);

      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      crypto.timingSafeEqual = jest.fn().mockReturnValue(true);

      const payload = JSON.stringify({
        action: 'published',
        release: { tag_name: 'v1.2.0' },
      });

      let dataCallback, endCallback;

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback;
        } else if (event === 'end') {
          endCallback = callback;
        }
      });

      const responsePromise = new Promise(resolve => {
        mockResponse.end.mockImplementation(data => {
          resolve(JSON.parse(data));
        });
      });

      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'sha256=mocked-signature';

      contextHandler(mockRequest, mockResponse);
      dataCallback(payload);
      endCallback();

      await responsePromise;

      expect(mockNotificationManager.checkAndNotify).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[Webhooks] Triggered notification check for release v1.2.0'
      );
    });

    it('should handle notification manager errors', async () => {
      const mockNotificationManager = {
        checkAndNotify: jest.fn().mockRejectedValue(new Error('Notification failed')),
      };

      const context = {
        notificationManager: mockNotificationManager,
      };

      const { createGitHubWebhookHandler } = require('../../../src/routes/webhooks');
      const contextHandler = createGitHubWebhookHandler(context);

      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      crypto.timingSafeEqual = jest.fn().mockReturnValue(true);

      const payload = JSON.stringify({
        action: 'published',
        release: { tag_name: 'v1.2.0' },
      });

      let dataCallback, endCallback;

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback;
        } else if (event === 'end') {
          endCallback = callback;
        }
      });

      const responsePromise = new Promise(resolve => {
        mockResponse.end.mockImplementation(data => {
          resolve(JSON.parse(data));
        });
      });

      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'sha256=mocked-signature';

      contextHandler(mockRequest, mockResponse);
      dataCallback(payload);
      endCallback();

      const response = await responsePromise;

      // Use fake timers to handle async operations
      jest.runAllTimers();

      expect(logger.error).toHaveBeenCalledWith(
        '[Webhooks] Error processing release notification: Notification failed'
      );

      // Should still return success to GitHub
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });
      expect(response.status).toBe('accepted');
    });
  });

  describe('signature verification', () => {
    let githubHandler;

    beforeEach(() => {
      githubHandler = webhooksRoute.routes.find(
        route => route.method === 'POST' && route.path === '/webhook/github'
      ).handler;
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
    });

    it('should handle signature without sha256 prefix', async () => {
      crypto.timingSafeEqual = jest.fn().mockReturnValue(false);

      const payload = JSON.stringify({ action: 'published' });

      let dataCallback, endCallback;

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback;
        } else if (event === 'end') {
          endCallback = callback;
        }
      });

      const responsePromise = new Promise(resolve => {
        mockResponse.end.mockImplementation(data => {
          resolve(JSON.parse(data));
        });
      });

      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'mocked-signature'; // No sha256= prefix

      githubHandler(mockRequest, mockResponse);
      dataCallback(payload);
      endCallback();

      const response = await responsePromise;

      expect(mockResponse.writeHead).toHaveBeenCalledWith(401, {
        'Content-Type': 'application/json',
      });
      expect(response.error).toBe('Invalid signature');
    });

    it('should use timing-safe comparison for signatures', async () => {
      // This is more of a code review check - ensure we use crypto.timingSafeEqual
      const payload = JSON.stringify({ action: 'published' });

      // Mock timingSafeEqual to verify it's called
      const mockTimingSafeEqual = jest.fn().mockReturnValue(true);
      crypto.timingSafeEqual = mockTimingSafeEqual;

      let dataCallback, endCallback;

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback;
        } else if (event === 'end') {
          endCallback = callback;
        }
      });

      const responsePromise = new Promise(resolve => {
        mockResponse.end.mockImplementation(data => {
          resolve(JSON.parse(data));
        });
      });

      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'sha256=mocked-signature';

      githubHandler(mockRequest, mockResponse);
      dataCallback(payload);
      endCallback();

      await responsePromise;

      expect(mockTimingSafeEqual).toHaveBeenCalled();
    });
  });
});
