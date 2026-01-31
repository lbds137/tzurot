/**
 * HTTP Server for handling external webhooks
 *
 * This module provides an HTTP server that can receive webhooks from external services
 * like GitHub. It's separate from the health check server to maintain separation of concerns.
 */

const http = require('http');
const crypto = require('crypto');
const logger = require('./logger');

/**
 * Verify GitHub webhook signature
 * @param {string} payload - The raw payload body
 * @param {string} signature - The signature from X-Hub-Signature-256 header
 * @param {string} secret - The webhook secret
 * @returns {boolean} Whether the signature is valid
 */
function verifyGitHubSignature(payload, signature, secret) {
  if (!signature || !secret) {
    logger.warn('[WebhookServer] Missing signature or secret for verification');
    return false;
  }

  const expectedSignature =
    'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch (error) {
    logger.error('[WebhookServer] Error verifying signature:', error);
    return false;
  }
}

/**
 * Handle GitHub release webhook
 * @param {Object} payload - The webhook payload
 * @param {Object} headers - The request headers
 */
async function handleGitHubRelease(payload, headers) {
  const event = headers['x-github-event'];

  if (event !== 'release') {
    logger.info(`[WebhookServer] Ignoring GitHub event: ${event}`);
    return { status: 'ignored', reason: 'Not a release event' };
  }

  if (payload.action !== 'published') {
    logger.info(`[WebhookServer] Ignoring release action: ${payload.action}`);
    return { status: 'ignored', reason: 'Not a published release' };
  }

  const releaseName = payload.release?.name || payload.release?.tag_name;
  logger.info(`[WebhookServer] Received GitHub release webhook for: ${releaseName}`);

  try {
    // Import the release notification manager
    const { releaseNotificationManager } = require('./core/notifications');

    // Check if the manager is initialized
    if (!releaseNotificationManager.initialized) {
      logger.warn('[WebhookServer] Release notification manager not initialized yet');
      return { status: 'pending', reason: 'Notification system not ready' };
    }

    // Trigger notification check in the background (don't await)
    releaseNotificationManager
      .checkAndNotify()
      .then(result => {
        if (result.notified) {
          logger.info(
            `[WebhookServer] Successfully triggered notifications for v${result.version} to ${result.usersNotified} users`
          );
        } else {
          logger.info(`[WebhookServer] No notifications sent: ${result.reason}`);
        }
      })
      .catch(error => {
        logger.error('[WebhookServer] Error in webhook-triggered notifications:', error);
      });

    return { status: 'accepted', release: releaseName };
  } catch (error) {
    logger.error('[WebhookServer] Error handling release webhook:', error);
    return { status: 'error', reason: error.message };
  }
}

/**
 * Handle incoming webhook request
 * @param {http.IncomingMessage} req - The request object
 * @param {http.ServerResponse} res - The response object
 * @param {string} githubSecret - The GitHub webhook secret
 */
async function handleWebhookRequest(req, res, githubSecret) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Hub-Signature-256, X-GitHub-Event'
  );

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // Route handling
  if (req.url === '/webhook/github') {
    let body = '';

    // Collect the payload
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        // Verify webhook signature
        const signature = req.headers['x-hub-signature-256'];

        if (!verifyGitHubSignature(body, signature, githubSecret)) {
          logger.warn('[WebhookServer] Invalid GitHub webhook signature');
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid signature' }));
          return;
        }

        // Parse the payload
        const payload = JSON.parse(body);

        // Handle the webhook
        const result = await handleGitHubRelease(payload, req.headers);

        // Respond to GitHub
        const statusCode = result.status === 'error' ? 500 : 200;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        logger.error('[WebhookServer] Error processing webhook:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  } else {
    // 404 for unknown routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
}

/**
 * Create and start the webhook server
 * @param {number} port - Port number for the webhook server
 * @returns {http.Server} HTTP server instance
 */
function createWebhookServer(port = 3001) {
  const githubSecret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!githubSecret) {
    logger.warn('[WebhookServer] GITHUB_WEBHOOK_SECRET not set - GitHub webhooks will be rejected');
  }

  const server = http.createServer((req, res) => {
    handleWebhookRequest(req, res, githubSecret);
  });

  server.on('error', error => {
    logger.error(`[WebhookServer] Server error: ${error.message}`, error);
  });

  server.listen(port, () => {
    logger.info(`[WebhookServer] Webhook server running on port ${port}`);
    if (githubSecret) {
      logger.info('[WebhookServer] GitHub webhook authentication enabled');
    }
  });

  return server;
}

module.exports = {
  createWebhookServer,
  verifyGitHubSignature,
  handleGitHubRelease,
};
