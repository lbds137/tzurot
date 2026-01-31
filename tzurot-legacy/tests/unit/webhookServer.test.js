/**
 * Tests for webhook server
 */

const http = require('http');
const crypto = require('crypto');
const {
  createWebhookServer,
  verifyGitHubSignature,
  handleGitHubRelease,
} = require('../../src/webhookServer');
const logger = require('../../src/logger');
const { releaseNotificationManager } = require('../../src/core/notifications');

// Mock dependencies
jest.mock('../../src/logger');
jest.mock('../../src/core/notifications', () => ({
  releaseNotificationManager: {
    initialized: true,
    checkAndNotify: jest.fn(),
  },
}));

describe('webhookServer', () => {
  let server;
  const testPort = 3099; // Use a non-standard port for testing
  const testSecret = 'test-webhook-secret';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GITHUB_WEBHOOK_SECRET = testSecret;
  });

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  describe('verifyGitHubSignature', () => {
    it('should verify valid signature', () => {
      const payload = '{"test":"data"}';
      const signature =
        'sha256=' + crypto.createHmac('sha256', testSecret).update(payload).digest('hex');

      const result = verifyGitHubSignature(payload, signature, testSecret);
      expect(result).toBe(true);
    });

    it('should reject invalid signature', () => {
      const payload = '{"test":"data"}';
      const signature = 'sha256=invalid';

      const result = verifyGitHubSignature(payload, signature, testSecret);
      expect(result).toBe(false);
    });

    it('should reject missing signature', () => {
      const result = verifyGitHubSignature('payload', null, testSecret);
      expect(result).toBe(false);
    });

    it('should reject missing secret', () => {
      const result = verifyGitHubSignature('payload', 'signature', null);
      expect(result).toBe(false);
    });
  });

  describe('handleGitHubRelease', () => {
    beforeEach(() => {
      releaseNotificationManager.checkAndNotify.mockResolvedValue({
        notified: true,
        version: '1.0.0',
        usersNotified: 5,
      });
    });

    it('should handle published release', async () => {
      const payload = {
        action: 'published',
        release: {
          name: 'v1.0.0',
          tag_name: 'v1.0.0',
        },
      };
      const headers = { 'x-github-event': 'release' };

      const result = await handleGitHubRelease(payload, headers);

      expect(result.status).toBe('accepted');
      expect(result.release).toBe('v1.0.0');

      // Wait a tick for the background promise
      await new Promise(resolve => setImmediate(resolve));
      expect(releaseNotificationManager.checkAndNotify).toHaveBeenCalled();
    });

    it('should ignore non-published release actions', async () => {
      const payload = {
        action: 'created', // Not 'published'
        release: { tag_name: 'v1.0.0' },
      };
      const headers = { 'x-github-event': 'release' };

      const result = await handleGitHubRelease(payload, headers);

      expect(result.status).toBe('ignored');
      expect(result.reason).toBe('Not a published release');
      expect(releaseNotificationManager.checkAndNotify).not.toHaveBeenCalled();
    });

    it('should ignore non-release events', async () => {
      const payload = { action: 'opened' };
      const headers = { 'x-github-event': 'pull_request' };

      const result = await handleGitHubRelease(payload, headers);

      expect(result.status).toBe('ignored');
      expect(result.reason).toBe('Not a release event');
      expect(releaseNotificationManager.checkAndNotify).not.toHaveBeenCalled();
    });

    it('should handle uninitialized notification manager', async () => {
      releaseNotificationManager.initialized = false;

      const payload = {
        action: 'published',
        release: { tag_name: 'v1.0.0' },
      };
      const headers = { 'x-github-event': 'release' };

      const result = await handleGitHubRelease(payload, headers);

      expect(result.status).toBe('pending');
      expect(result.reason).toBe('Notification system not ready');
      expect(releaseNotificationManager.checkAndNotify).not.toHaveBeenCalled();

      // Restore for other tests
      releaseNotificationManager.initialized = true;
    });
  });

  describe('createWebhookServer', () => {
    it('should create and start server', done => {
      server = createWebhookServer(testPort);

      // Give server time to start
      setTimeout(() => {
        expect(logger.info).toHaveBeenCalledWith(
          `[WebhookServer] Webhook server running on port ${testPort}`
        );
        done();
      }, 100);
    });

    it('should handle OPTIONS requests', done => {
      server = createWebhookServer(testPort);

      setTimeout(() => {
        const req = http.request(
          {
            hostname: 'localhost',
            port: testPort,
            path: '/webhook/github',
            method: 'OPTIONS',
          },
          res => {
            expect(res.statusCode).toBe(200);
            done();
          }
        );

        req.end();
      }, 100);
    });

    it('should reject non-POST requests', done => {
      server = createWebhookServer(testPort);

      setTimeout(() => {
        const req = http.request(
          {
            hostname: 'localhost',
            port: testPort,
            path: '/webhook/github',
            method: 'GET',
          },
          res => {
            expect(res.statusCode).toBe(405);

            let body = '';
            res.on('data', chunk => (body += chunk));
            res.on('end', () => {
              const response = JSON.parse(body);
              expect(response.error).toBe('Method not allowed');
              done();
            });
          }
        );

        req.end();
      }, 100);
    });

    it('should return 404 for unknown routes', done => {
      server = createWebhookServer(testPort);

      setTimeout(() => {
        const req = http.request(
          {
            hostname: 'localhost',
            port: testPort,
            path: '/unknown',
            method: 'POST',
          },
          res => {
            expect(res.statusCode).toBe(404);

            let body = '';
            res.on('data', chunk => (body += chunk));
            res.on('end', () => {
              const response = JSON.parse(body);
              expect(response.error).toBe('Not found');
              done();
            });
          }
        );

        req.end();
      }, 100);
    });

    it('should reject webhooks with invalid signature', done => {
      server = createWebhookServer(testPort);

      setTimeout(() => {
        const payload = JSON.stringify({ action: 'published' });

        const req = http.request(
          {
            hostname: 'localhost',
            port: testPort,
            path: '/webhook/github',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Hub-Signature-256': 'sha256=invalid',
              'X-GitHub-Event': 'release',
            },
          },
          res => {
            expect(res.statusCode).toBe(401);

            let body = '';
            res.on('data', chunk => (body += chunk));
            res.on('end', () => {
              const response = JSON.parse(body);
              expect(response.error).toBe('Invalid signature');
              done();
            });
          }
        );

        req.write(payload);
        req.end();
      }, 100);
    });
  });
});
