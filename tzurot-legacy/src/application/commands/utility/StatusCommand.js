/**
 * Status Command - Show bot status information
 *
 * Displays comprehensive bot status including uptime, ping,
 * authentication status, and personality information.
 */

const { Command } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Format uptime into a human-readable string
 * @param {number} uptime - Uptime in seconds
 * @returns {string} Formatted uptime string
 */
function formatUptime(uptime) {
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor(((uptime % 86400) % 3600) / 60);
  const seconds = Math.floor(((uptime % 86400) % 3600) % 60);

  const parts = [];
  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (seconds > 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);

  return parts.join(', ');
}

/**
 * Creates the executor function for the status command
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} Executor function
 */
function createExecutor(dependencies = {}) {
  return async function execute(context) {
    try {
      const {
        conversationManager = require('../../../core/conversation'),
        processUtils = { uptime: () => process.uptime() },
      } = dependencies;

      // Get uptime info
      const uptime = processUtils.uptime();
      const formattedUptime = formatUptime(uptime);

      // Check authentication status using DDD system
      let isAuthenticated = false;
      let isNsfwVerified = false;

      try {
        const {
          getApplicationBootstrap,
        } = require('../../../application/bootstrap/ApplicationBootstrap');
        const bootstrap = getApplicationBootstrap();
        const authService = bootstrap.getApplicationServices().authenticationService;
        const status = await authService.getAuthenticationStatus(context.userId);
        isAuthenticated = status.isAuthenticated;
        isNsfwVerified = status.isAuthenticated && status.user?.nsfwStatus?.verified;

        logger.debug('[StatusCommand] Auth status for user', {
          userId: context.userId,
          isAuthenticated: status.isAuthenticated,
          userExists: !!status.user,
          nsfwStatus: status.user?.nsfwStatus,
          isNsfwVerified,
        });
      } catch (error) {
        logger.warn('[StatusCommand] Failed to get auth status from DDD service:', error);
      }

      // Get user's personalities if authenticated
      let personalityCount = 0;
      if (isAuthenticated) {
        // Try DDD system first
        try {
          const {
            getApplicationBootstrap,
          } = require('../../../application/bootstrap/ApplicationBootstrap');
          const bootstrap = getApplicationBootstrap();
          if (bootstrap.initialized) {
            const services = bootstrap.getApplicationServices();
            const personalityApplicationService = services.personalityApplicationService;
            const personalities = await personalityApplicationService.listPersonalitiesByOwner(
              context.userId
            );
            personalityCount = personalities ? personalities.length : 0;
          }
        } catch (error) {
          logger.warn('[StatusCommand] Failed to get personalities from DDD service:', error);
          personalityCount = 0;
        }
      }

      // Get auto-response status
      const autoResponseStatus = conversationManager.isAutoResponseEnabled
        ? conversationManager.isAutoResponseEnabled(context.userId)
        : false;

      // Check current channel activation
      const activatedChannels = conversationManager.getAllActivatedChannels
        ? conversationManager.getAllActivatedChannels()
        : {};
      const currentChannelPersonality = activatedChannels[context.channelId];
      const activatedCount = Object.keys(activatedChannels).length;

      // Get Discord client for proper ping and guild count
      const client = context.message?.client || context.interaction?.client;
      // Discord returns -1 for ping when websocket isn't ready or calculating
      const rawPing = client?.ws?.ping;
      const ping = rawPing && rawPing > 0 ? `${Math.round(rawPing)}ms` : 'Calculating...';
      const guildCount = client?.guilds?.cache?.size || 0;

      // Build status information
      const statusInfo = {
        uptime: formattedUptime,
        ping: ping,
        authenticated: isAuthenticated,
        ageVerified: isNsfwVerified,
        guildCount: guildCount,
        personalityCount,
        autoResponse: autoResponseStatus,
        currentChannelPersonality,
        activatedChannelsCount: activatedCount,
      };

      // Create embed response
      if (context.respondWithEmbed) {
        const embed = {
          title: 'Bot Status',
          description: `Current status and information for ${context.getBotName ? context.getBotName() : 'the bot'}.`,
          color: 0x2196f3,
          fields: [
            { name: 'Uptime', value: statusInfo.uptime, inline: true },
            { name: 'Ping', value: statusInfo.ping, inline: true },
            {
              name: 'Authenticated',
              value: statusInfo.authenticated ? '✅ Yes' : '❌ No',
              inline: true,
            },
            {
              name: 'Age Verified',
              value: statusInfo.ageVerified ? '✅ Yes' : '❌ No',
              inline: true,
            },
            { name: 'Guild Count', value: `${statusInfo.guildCount} servers`, inline: true },
          ],
        };

        // Add user-specific fields if authenticated
        if (isAuthenticated) {
          embed.fields.push({
            name: 'Your Personalities',
            value: personalityCount > 0 ? `${personalityCount} personalities` : 'None added yet',
            inline: true,
          });
        }

        // Add auto-response status
        embed.fields.push({
          name: 'Auto-Response',
          value: statusInfo.autoResponse ? '✅ Enabled' : '❌ Disabled',
          inline: true,
        });

        // Add current channel info
        if (currentChannelPersonality) {
          embed.fields.push({
            name: 'This Channel',
            value: `🤖 **${currentChannelPersonality}** is active`,
            inline: false,
          });
        }

        // Add activated channels count for authenticated users
        if (isAuthenticated && activatedCount > 0) {
          embed.fields.push({
            name: 'Activated Channels',
            value: `${activatedCount} channel${activatedCount !== 1 ? 's' : ''} ${activatedCount === 1 ? 'has' : 'have'} active personalities`,
            inline: true,
          });
        }

        // Add footer
        embed.footer = {
          text: `Use "${context.commandPrefix} help" for available commands.`,
        };

        await context.respondWithEmbed(embed);
      } else {
        // Fallback to text response
        const lines = [`**Bot Status**`];
        lines.push(`Uptime: ${statusInfo.uptime}`);
        lines.push(`Ping: ${statusInfo.ping}`);
        lines.push(`Authenticated: ${statusInfo.authenticated ? 'Yes' : 'No'}`);
        lines.push(`Age Verified: ${statusInfo.ageVerified ? 'Yes' : 'No'}`);
        lines.push(`Servers: ${statusInfo.guildCount}`);

        if (isAuthenticated) {
          lines.push(`Your Personalities: ${personalityCount > 0 ? personalityCount : 'None'}`);
        }

        lines.push(`Auto-Response: ${statusInfo.autoResponse ? 'Enabled' : 'Disabled'}`);

        if (currentChannelPersonality) {
          lines.push(`\nThis Channel: **${currentChannelPersonality}** is active`);
        }

        if (isAuthenticated && activatedCount > 0) {
          lines.push(`Activated Channels: ${activatedCount}`);
        }

        await context.respond(lines.join('\n'));
      }
    } catch (error) {
      logger.error('[StatusCommand] Execution failed:', error);
      await context.respond('An error occurred while getting bot status.');
    }
  };
}

/**
 * Factory function to create the status command
 * @param {Object} dependencies - Optional dependencies to inject
 * @returns {Command} The status command instance
 */
function createStatusCommand(dependencies = {}) {
  return new Command({
    name: 'status',
    description: 'Show bot status information',
    category: 'Utility',
    aliases: [],
    options: [],
    execute: createExecutor(dependencies),
  });
}

module.exports = {
  createStatusCommand,
  formatUptime, // Export for testing
};
