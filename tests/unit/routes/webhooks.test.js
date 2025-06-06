/**
 * Tests for Webhooks Route
 */

// Mock dependencies
jest.mock('../../../src/logger');
jest.mock('crypto');
jest.mock('../../../src/core/notifications', () => ({
  releaseNotificationManager: {
    initialized: true,
    checkAndNotify: jest.fn().mockResolvedValue({ notified: false, reason: 'Test' })
  }
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
    crypto.timingSafeEqual = jest.fn().mockReturnValue(true);

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

    // Helper function to simulate webhook request with body parsing
    function simulateWebhookRequest(payload, headers = {}, assertions, done) {
      let dataCallback, endCallback;
      
      Object.assign(mockRequest.headers, headers);
      
      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback;
        } else if (event === 'end') {
          endCallback = callback;
        }
      });

      mockResponse.end.mockImplementation((data) => {
        try {
          assertions(JSON.parse(data));
          done();
        } catch (error) {
          done(error);
        }
      });

      githubHandler(mockRequest, mockResponse);
      dataCallback(payload);
      endCallback();
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
      expect(logger.warn).toHaveBeenCalledWith('[Webhooks] GITHUB_WEBHOOK_SECRET not set - rejecting webhook');
    });

    it('should reject requests without GitHub signature', (done) => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      
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

      // Override response.end to capture when the response is sent
      mockResponse.end.mockImplementation((data) => {
        try {
          const parsedResponse = JSON.parse(data);
          
          expect(mockResponse.writeHead).toHaveBeenCalledWith(401, {
            'Content-Type': 'application/json',
          });
          expect(parsedResponse.error).toBe('Invalid signature');
          expect(logger.warn).toHaveBeenCalledWith('[Webhooks] Invalid GitHub webhook signature');
          done();
        } catch (error) {
          done(error);
        }
      });

      // Call the handler - this sets up the event listeners
      githubHandler(mockRequest, mockResponse);
      
      // Simulate the request data flow
      dataCallback(payload);
      endCallback();
    });

    it('should reject requests with invalid signature', (done) => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      
      const payload = JSON.stringify({ action: 'published' });
      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'sha256=invalid-signature';

      // Mock crypto to return different signature
      mockHmac.digest.mockReturnValue('different-signature');

      let dataCallback, endCallback;
      
      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback;
        } else if (event === 'end') {
          endCallback = callback;
        }
      });

      mockResponse.end.mockImplementation((data) => {
        try {
          const parsedResponse = JSON.parse(data);
          
          expect(mockResponse.writeHead).toHaveBeenCalledWith(401, {
            'Content-Type': 'application/json',
          });
          expect(parsedResponse.error).toBe('Invalid signature');
          expect(logger.warn).toHaveBeenCalledWith('[Webhooks] Invalid GitHub webhook signature');
          done();
        } catch (error) {
          done(error);
        }
      });

      githubHandler(mockRequest, mockResponse);
      dataCallback(payload);
      endCallback();
    });

    it('should accept valid release webhook', (done) => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      
      const payload = JSON.stringify({ 
        action: 'published',
        release: { tag_name: 'v1.2.0' }
      });

      // Set up crypto to match the expected signature
      mockHmac.digest.mockReturnValue('mocked-signature');
      const expectedSignature = 'sha256=mocked-signature';

      simulateWebhookRequest(
        payload,
        {
          'x-github-event': 'release',
          'x-hub-signature-256': expectedSignature
        },
        (parsedResponse) => {
          expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
            'Content-Type': 'application/json',
          });
          expect(parsedResponse.status).toBe('accepted');
          expect(parsedResponse.release).toBe('v1.2.0');
          expect(logger.info).toHaveBeenCalledWith('[Webhooks] Received GitHub release webhook for: v1.2.0');
        },
        done
      );
    });

    it('should ignore non-release events', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      
      mockRequest.headers['x-github-event'] = 'push';
      mockRequest.headers['x-hub-signature-256'] = 'sha256=mocked-signature';
      mockRequest.body = JSON.stringify({ ref: 'refs/heads/main' });

      await githubHandler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });

      const actualResponse = mockResponse.end.mock.calls[0][0];
      const parsedResponse = JSON.parse(actualResponse);
      
      expect(parsedResponse.status).toBe('ignored');
      expect(parsedResponse.message).toBe('Event type not handled');
      expect(logger.info).toHaveBeenCalledWith('[Webhooks] GitHub webhook ignored: push event');
    });

    it('should ignore draft and prerelease releases', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      
      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'sha256=mocked-signature';
      mockRequest.body = JSON.stringify({ 
        action: 'published',
        release: { 
          tag_name: 'v1.2.0-beta',
          draft: false,
          prerelease: true
        }
      });

      await githubHandler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });

      const actualResponse = mockResponse.end.mock.calls[0][0];
      const parsedResponse = JSON.parse(actualResponse);
      
      expect(parsedResponse.status).toBe('ignored');
      expect(parsedResponse.message).toBe('Draft or prerelease ignored');
      expect(logger.info).toHaveBeenCalledWith('[Webhooks] GitHub release webhook ignored: draft/prerelease v1.2.0-beta');
    });

    it('should ignore non-published release actions', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      
      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'sha256=mocked-signature';
      mockRequest.body = JSON.stringify({ 
        action: 'created',
        release: { tag_name: 'v1.2.0' }
      });

      await githubHandler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });

      const actualResponse = mockResponse.end.mock.calls[0][0];
      const parsedResponse = JSON.parse(actualResponse);
      
      expect(parsedResponse.status).toBe('ignored');
      expect(parsedResponse.message).toBe('Only published releases are processed');
      expect(logger.info).toHaveBeenCalledWith('[Webhooks] GitHub release webhook ignored: action created');
    });

    it('should verify signature correctly', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      
      const payload = JSON.stringify({ action: 'published' });
      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'sha256=mocked-signature';
      mockRequest.body = payload;

      await githubHandler(mockRequest, mockResponse);

      expect(crypto.createHmac).toHaveBeenCalledWith('sha256', 'test-secret');
      expect(mockHmac.update).toHaveBeenCalledWith(payload);
      expect(mockHmac.digest).toHaveBeenCalledWith('hex');
    });

    it('should handle malformed JSON gracefully', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      
      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'sha256=mocked-signature';
      mockRequest.body = 'invalid json';

      await githubHandler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(400, {
        'Content-Type': 'application/json',
      });

      const actualResponse = mockResponse.end.mock.calls[0][0];
      const parsedResponse = JSON.parse(actualResponse);
      
      expect(parsedResponse.error).toBe('Invalid JSON payload');
      expect(logger.error).toHaveBeenCalledWith(
        '[Webhooks] GitHub webhook JSON parse error: Unexpected token \'i\', "invalid json" is not valid JSON'
      );
    });

    it('should handle missing request body', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
      
      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'sha256=mocked-signature';
      mockRequest.body = undefined;

      await githubHandler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(400, {
        'Content-Type': 'application/json',
      });

      const actualResponse = mockResponse.end.mock.calls[0][0];
      const parsedResponse = JSON.parse(actualResponse);
      
      expect(parsedResponse.error).toBe('Missing request body');
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
      
      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'sha256=mocked-signature';
      mockRequest.body = JSON.stringify({ 
        action: 'published',
        release: { tag_name: 'v1.2.0' }
      });

      await contextHandler(mockRequest, mockResponse);

      expect(mockNotificationManager.checkAndNotify).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('[Webhooks] Triggered notification check for release v1.2.0');
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
      
      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'sha256=mocked-signature';
      mockRequest.body = JSON.stringify({ 
        action: 'published',
        release: { tag_name: 'v1.2.0' }
      });

      await contextHandler(mockRequest, mockResponse);

      expect(logger.error).toHaveBeenCalledWith(
        '[Webhooks] Error processing release notification: Notification failed'
      );
      
      // Should still return success to GitHub
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });
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
      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'mocked-signature'; // No sha256= prefix
      mockRequest.body = JSON.stringify({ action: 'published' });

      await githubHandler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(401, {
        'Content-Type': 'application/json',
      });
    });

    it('should use timing-safe comparison for signatures', async () => {
      // This is more of a code review check - ensure we use crypto.timingSafeEqual
      const payload = JSON.stringify({ action: 'published' });
      mockRequest.headers['x-github-event'] = 'release';
      mockRequest.headers['x-hub-signature-256'] = 'sha256=mocked-signature';
      mockRequest.body = payload;

      // Mock timingSafeEqual to verify it's called
      const mockTimingSafeEqual = jest.fn().mockReturnValue(true);
      crypto.timingSafeEqual = mockTimingSafeEqual;

      await githubHandler(mockRequest, mockResponse);

      expect(mockTimingSafeEqual).toHaveBeenCalled();
    });
  });
});