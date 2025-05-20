/**
 * Auth Command Handler
 * Manages user authentication with the AI service
 */
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const auth = require('../../auth');
const webhookUserTracker = require('../../utils/webhookUserTracker');
const { botPrefix } = require('../../../config');

/**
 * Command metadata
 */
const meta = {
  name: 'auth',
  description: 'Authenticate with the AI service',
  usage: 'auth <start|code|status|revoke|cleanup>',
  aliases: [],
  permissions: []
};

/**
 * Handle auth start subcommand
 * @param {Object} message - Discord message
 * @returns {Promise<Object>} Command result
 */
async function handleStart(message) {
  const directSend = validator.createDirectSend(message);
  
  try {
    const authUrl = await auth.getAuthorizationUrl();
    
    if (!authUrl) {
      return await directSend('❌ Failed to generate authentication URL. Please try again later.');
    }
    
    // Check if this is a DM or a public channel
    const isDM = message.channel.isDMBased();
    
    if (isDM) {
      // In DMs, we can safely send the auth URL directly
      return await directSend(
        `**Authentication Required**\n\n` +
        `Please click the link below to authenticate with the service:\n\n` +
        `${authUrl}\n\n` +
        `After authorizing, you'll receive a code. Use \`${botPrefix} auth code YOUR_CODE\` to complete the process.`
      );
    } else {
      // In public channels, send a DM with the auth URL
      try {
        await message.author.send(
          `**Authentication Required**\n\n` +
          `Please click the link below to authenticate with the service:\n\n` +
          `${authUrl}\n\n` +
          `After authorizing, you'll receive a code. Use \`${botPrefix} auth code YOUR_CODE\` here in DM to complete the process.`
        );
        
        // Let them know in the channel that we've sent a DM
        return await directSend(
          `I've sent you a DM with authentication instructions. Please check your DMs.`
        );
      } catch (dmError) {
        // If DM fails, let them know but with less specific info
        return await directSend(
          `❌ Unable to send you a DM. Please ensure your DMs are open, then try again. You can open DMs in User Settings > Privacy & Safety.`
        );
      }
    }
  } catch (error) {
    logger.error(`[Auth] Error starting auth process: ${error.message}`);
    return await directSend(`❌ An error occurred: ${error.message}`);
  }
}

/**
 * Handle auth code subcommand
 * @param {Object} message - Discord message
 * @param {Array<string>} args - Command args
 * @returns {Promise<Object>} Command result
 */
async function handleCode(message, args) {
  const directSend = validator.createDirectSend(message);
  
  // Check if a code was provided
  if (args.length < 1) {
    return await directSend(`Please provide your authorization code. Usage: \`${botPrefix} auth code YOUR_CODE\``);
  }
  
  // Get the code from the args
  let code = args[0];
  
  // Check if this is a DM channel
  const isDM = message.channel.isDMBased();
  
  // For security, only accept auth codes in DMs
  if (!isDM) {
    // Try to delete the message to protect the code
    try {
      await message.delete();
    } catch (deleteError) {
      logger.warn(`[Auth] Failed to delete auth code message: ${deleteError.message}`);
    }
    
    return await directSend(
      `❌ For security, please submit your authorization code via DM, not in a public channel.`
    );
  }
  
  // Check if the code is wrapped in Discord spoiler tags ||code||
  if (code.startsWith('||') && code.endsWith('||')) {
    // Remove the spoiler tags
    code = code.substring(2, code.length - 2);
    logger.info(`[Auth] Extracted code from spoiler tags`);
  }
  
  // Show typing indicator while processing
  message.channel.sendTyping().catch(() => {});
  
  try {
    // Exchange the code for a token
    logger.info(`[Auth] Exchanging code for token...`);
    const token = await auth.exchangeCodeForToken(code);
    
    if (!token) {
      return await directSend('❌ Authorization failed. The code may be invalid or expired.');
    }
    
    // Store the token
    logger.info(`[Auth] Storing token for user ${message.author.id}`);
    const stored = await auth.storeUserToken(message.author.id, token);
    
    if (!stored) {
      return await directSend('❌ Failed to store authorization token. Please try again later.');
    }
    
    return await directSend('✅ Authorization successful! The bot will now use your account for AI interactions.');
  } catch (error) {
    logger.error(`Error during auth code exchange: ${error.message}`);
    return await directSend('❌ An error occurred during authorization. Please try again later.');
  }
}

/**
 * Handle auth status subcommand
 * @param {Object} message - Discord message
 * @returns {Promise<Object>} Command result
 */
async function handleStatus(message) {
  const directSend = validator.createDirectSend(message);
  
  // Check if the user has a valid token
  const hasToken = auth.hasValidToken(message.author.id);
  
  if (hasToken) {
    // Get token age and expiration info
    const tokenAge = auth.getTokenAge(message.author.id);
    const expirationInfo = auth.getTokenExpirationInfo(message.author.id);
    
    let statusMessage = '✅ You have a valid authorization token. The bot is using your account for AI interactions.';
    
    // Add token age and expiration info if available
    if (tokenAge !== null && expirationInfo) {
      statusMessage += `\n\n**Token Details:**\n`;
      statusMessage += `- Created: ${tokenAge} day${tokenAge !== 1 ? 's' : ''} ago\n`;
      statusMessage += `- Expires in: ${expirationInfo.daysUntilExpiration} day${expirationInfo.daysUntilExpiration !== 1 ? 's' : ''}\n`;
      statusMessage += `- Time remaining: ${expirationInfo.percentRemaining}%`;
      
      // Add warning if token is expiring soon (less than 7 days)
      if (expirationInfo.daysUntilExpiration < 7) {
        statusMessage += `\n\n⚠️ **Your token will expire soon.** When it expires, you'll need to re-authenticate. Use \`${botPrefix} auth revoke\` and then \`${botPrefix} auth start\` to renew your token.`;
      }
    }
    
    return await directSend(statusMessage);
  } else {
    return await directSend(
      `❌ You don't have an authorization token. Use \`${botPrefix} auth start\` to begin the authorization process.`
    );
  }
}

/**
 * Handle auth revoke subcommand
 * @param {Object} message - Discord message
 * @returns {Promise<Object>} Command result
 */
async function handleRevoke(message) {
  const directSend = validator.createDirectSend(message);
  
  // Delete the user's token
  const deleted = await auth.deleteUserToken(message.author.id);
  
  if (deleted) {
    return await directSend('✅ Your authorization has been revoked. The bot will no longer use your personal account.');
  } else {
    return await directSend('❌ Failed to revoke authorization. Please try again later.');
  }
}

/**
 * Handle auth cleanup subcommand (admin only)
 * @param {Object} message - Discord message
 * @returns {Promise<Object>} Command result
 */
async function handleCleanup(message) {
  const directSend = validator.createDirectSend(message);
  
  // Check if the user is an admin or bot owner
  const isAdmin = message.member && message.member.permissions.has('ADMINISTRATOR');
  const isBotOwner = message.author.id === process.env.BOT_OWNER_ID;
  
  if (!isAdmin && !isBotOwner) {
    return await directSend('❌ This command can only be used by server administrators or the bot owner.');
  }
  
  try {
    // Run the cleanup
    const removedCount = await auth.cleanupExpiredTokens();
    
    if (removedCount > 0) {
      return await directSend(`✅ Cleanup complete. Removed ${removedCount} expired token${removedCount === 1 ? '' : 's'}.`);
    } else {
      return await directSend('✅ Cleanup complete. No expired tokens were found.');
    }
  } catch (error) {
    logger.error(`[Auth] Error during manual cleanup: ${error.message}`);
    return await directSend(`❌ An error occurred during cleanup: ${error.message}`);
  }
}

/**
 * Execute the auth command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args) {
  const directSend = validator.createDirectSend(message);
  
  // If this is a webhook message, check if it's from a proxy system
  if (message.webhookId) {
    // Check if this is a known proxy system like PluralKit
    if (webhookUserTracker.isProxySystemWebhook(message)) {
      // Handle proxy system webhooks specially for auth
      logger.info(`[Auth] Detected proxy system webhook for auth command: ${message.author.username}`);
      // Return a more informative message for proxy systems
      return await directSend(
        `**Authentication with Proxy Systems**\n\n` +
        `For security reasons, authentication commands can't be used through webhook systems like PluralKit.\n\n` +
        `Please use your regular Discord account (without the proxy) to run authentication commands.`
      );
    }
  }
  
  // Check if the user provided a subcommand
  if (args.length < 1) {
    // Create standard help text for all users
    let helpText = `**Authentication Commands**\n\n` +
      `- \`${botPrefix} auth start\` - Begin the authentication process\n` +
      `- \`${botPrefix} auth code <code>\` - Submit your authorization code (DM only)\n` +
      `- \`${botPrefix} auth status\` - Check your authentication status\n` +
      `- \`${botPrefix} auth revoke\` - Revoke your authorization\n\n` +
      `For security, authorization codes should only be submitted via DM.`;
    
    // Check if user is admin or bot owner for additional commands
    const isAdmin = message.member && message.member.permissions.has('ADMINISTRATOR');
    const isBotOwner = message.author.id === process.env.BOT_OWNER_ID;
    
    if (isAdmin || isBotOwner) {
      helpText += `\n\n**Admin Commands:**\n` +
        `- \`${botPrefix} auth cleanup\` - Clean up expired tokens`;
    }
    
    return await directSend(helpText);
  }
  
  const subCommand = args[0].toLowerCase();
  const subArgs = args.slice(1);
  
  switch (subCommand) {
    case 'start':
      return await handleStart(message);
      
    case 'code':
      return await handleCode(message, subArgs);
      
    case 'status':
      return await handleStatus(message);
      
    case 'revoke':
      return await handleRevoke(message);
      
    case 'cleanup':
      return await handleCleanup(message);
      
    default:
      return await directSend(
        `Unknown auth subcommand: \`${subCommand}\`. Use \`${botPrefix} auth\` to see available subcommands.`
      );
  }
}

module.exports = {
  meta,
  execute
};