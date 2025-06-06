/**
 * Webhook routes
 */

const crypto = require('crypto');
const logger = require('../logger');

/**
 * Verify GitHub webhook signature
 * @param {string} payload - The raw payload body
 * @param {string} signature - The signature from X-Hub-Signature-256 header
 * @param {string} secret - The webhook secret
 * @returns {boolean} Whether the signature is valid
 */
function verifyGitHubSignature(payload, signature, secret) {
  if (!signature || !secret) {
    logger.warn('[Webhooks] Missing signature or secret for verification');
    return false;
  }

  const expectedSignature =
    'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch (error) {
    logger.error('[Webhooks] Error verifying signature:', error);
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
    logger.info(`[Webhooks] Ignoring GitHub event: ${event}`);
    return { status: 'ignored', reason: 'Not a release event' };
  }

  if (payload.action !== 'published') {
    logger.info(`[Webhooks] Ignoring release action: ${payload.action}`);
    return { status: 'ignored', reason: 'Not a published release' };
  }

  const releaseName = payload.release?.name || payload.release?.tag_name;
  logger.info(`[Webhooks] Received GitHub release webhook for: ${releaseName}`);

  try {
    // Import the release notification manager
    const { releaseNotificationManager } = require('../core/notifications');

    // Check if the manager is initialized
    if (!releaseNotificationManager.initialized) {
      logger.warn('[Webhooks] Release notification manager not initialized yet');
      return { status: 'pending', reason: 'Notification system not ready' };
    }

    // Trigger notification check in the background (don't await)
    releaseNotificationManager
      .checkAndNotify()
      .then(result => {
        if (result.notified) {
          logger.info(
            `[Webhooks] Successfully triggered notifications for v${result.version} to ${result.usersNotified} users`
          );
        } else {
          logger.info(`[Webhooks] No notifications sent: ${result.reason}`);
        }
      })
      .catch(error => {
        logger.error('[Webhooks] Error in webhook-triggered notifications:', error);
      });

    return { status: 'accepted', release: releaseName };
  } catch (error) {
    logger.error('[Webhooks] Error handling release webhook:', error);
    return { status: 'error', reason: error.message };
  }
}

/**
 * GitHub webhook handler
 * @param {http.IncomingMessage} req - The request object
 * @param {http.ServerResponse} res - The response object
 */
async function githubWebhookHandler(req, res) {
  const githubSecret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!githubSecret) {
    logger.warn('[Webhooks] GITHUB_WEBHOOK_SECRET not set - rejecting webhook');
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Webhook secret not configured' }));
    return;
  }

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
        logger.warn('[Webhooks] Invalid GitHub webhook signature');
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
      logger.error('[Webhooks] Error processing webhook:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });
}

/**
 * Create a context-aware GitHub webhook handler
 * @param {Object} context - Context object containing dependencies
 * @returns {Function} GitHub webhook handler function
 */
function createGitHubWebhookHandler(context) {
  return async function contextAwareGithubWebhookHandler(req, res) {
    const githubSecret = process.env.GITHUB_WEBHOOK_SECRET;

    if (!githubSecret) {
      logger.warn('[Webhooks] GITHUB_WEBHOOK_SECRET not set - rejecting webhook');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Webhook secret not configured' }));
      return;
    }

    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const signature = req.headers['x-hub-signature-256'];

        if (!verifyGitHubSignature(body, signature, githubSecret)) {
          logger.warn('[Webhooks] Invalid GitHub webhook signature');
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid signature' }));
          return;
        }

        const payload = JSON.parse(body);

        // Handle release events
        if (req.headers['x-github-event'] === 'release' && payload.action === 'published') {
          const releaseName = payload.release?.name || payload.release?.tag_name;
          logger.info(`[Webhooks] Received GitHub release webhook for: ${releaseName}`);

          if (context.notificationManager) {
            try {
              await context.notificationManager.checkAndNotify();
              logger.info(`[Webhooks] Triggered notification check for release ${releaseName}`);
            } catch (error) {
              logger.error(`[Webhooks] Error processing release notification: ${error.message}`);
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'accepted', release: releaseName }));
          return;
        }

        // Handle other webhook events (ignore them)
        const result = await handleGitHubRelease(payload, req.headers);
        const statusCode = result.status === 'error' ? 500 : 200;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        logger.error('[Webhooks] Error processing webhook:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  };
}

module.exports = {
  routes: [{ method: 'POST', path: '/webhook/github', handler: githubWebhookHandler }],
  createGitHubWebhookHandler,
};
