const Discord = require('discord.js');
const VersionTracker = require('./VersionTracker');
const UserPreferencesPersistence = require('./UserPreferencesPersistence');
const GitHubReleaseClient = require('./GitHubReleaseClient');
const logger = require('../../logger');

/**
 * ReleaseNotificationManager - Manages sending release notifications to users
 */
class ReleaseNotificationManager {
  constructor(options = {}) {
    this.client = options.client; // Discord client
    this.versionTracker = options.versionTracker || new VersionTracker();
    this.preferences = options.preferences || new UserPreferencesPersistence();
    this.githubClient = options.githubClient || new GitHubReleaseClient();
    this.initialized = false;

    // Notification settings
    this.maxDMsPerBatch = options.maxDMsPerBatch || 10;
    this.dmDelay = options.dmDelay || 1000; // 1 second between DMs

    // Injectable delay function for testability
    this.delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  /**
   * Initialize the notification manager
   * @param {Discord.Client} client - Discord client
   * @returns {Promise<void>}
   */
  async initialize(client) {
    if (client) {
      this.client = client;
    }

    if (!this.client) {
      throw new Error('Discord client is required for ReleaseNotificationManager');
    }

    // Load user preferences
    await this.preferences.load();

    this.initialized = true;
    logger.info('[ReleaseNotificationManager] Initialized successfully');
  }

  /**
   * Check for new version and send notifications
   * @returns {Promise<Object>} Notification results
   */
  async checkAndNotify() {
    if (!this.initialized) {
      throw new Error('ReleaseNotificationManager not initialized');
    }

    try {
      // Check for new version
      const versionInfo = await this.versionTracker.checkForNewVersion();

      if (!versionInfo.hasNewVersion) {
        logger.info('[ReleaseNotificationManager] No new version to notify about');
        return { notified: false, reason: 'No new version' };
      }

      // Get release information from GitHub
      const release = await this.githubClient.getReleaseByTag(versionInfo.currentVersion);

      if (!release) {
        logger.warn(
          '[ReleaseNotificationManager] No GitHub release found for version ' +
            versionInfo.currentVersion
        );
        return { notified: false, reason: 'No release found on GitHub' };
      }

      // Get users to notify based on change type
      const usersToNotify = this.preferences.getUsersToNotify(versionInfo.changeType);

      if (usersToNotify.length === 0) {
        logger.info(
          '[ReleaseNotificationManager] No users to notify for ' +
            versionInfo.changeType +
            ' change'
        );
        await this.versionTracker.saveNotifiedVersion(versionInfo.currentVersion);
        return { notified: false, reason: 'No users opted in for this change type' };
      }

      // Send notifications
      const results = await this.sendNotifications(usersToNotify, versionInfo, release);

      // Save that we've notified about this version
      await this.versionTracker.saveNotifiedVersion(versionInfo.currentVersion);

      return {
        notified: true,
        version: versionInfo.currentVersion,
        changeType: versionInfo.changeType,
        usersNotified: results.successful,
        usersFailed: results.failed,
      };
    } catch (error) {
      logger.error(`[ReleaseNotificationManager] Error during check and notify: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send notifications to users
   * @param {Array<string>} userIds - User IDs to notify
   * @param {Object} versionInfo - Version information
   * @param {Object} release - GitHub release data
   * @returns {Promise<Object>} Results of notification attempts
   */
  async sendNotifications(userIds, versionInfo, release) {
    const results = { successful: 0, failed: 0, errors: [] };

    // Send in batches to avoid rate limits
    for (let i = 0; i < userIds.length; i += this.maxDMsPerBatch) {
      const batch = userIds.slice(i, i + this.maxDMsPerBatch);

      await Promise.all(
        batch.map(async userId => {
          try {
            // Create personalized embed for each user
            const embed = this.createReleaseEmbed(versionInfo, release, userId);
            await this.sendDMToUser(userId, embed);
            await this.preferences.recordNotification(userId, versionInfo.currentVersion);
            results.successful++;
          } catch (error) {
            logger.error(
              `[ReleaseNotificationManager] Failed to notify user ${userId}: ${error.message}`
            );
            results.failed++;
            results.errors.push({ userId, error: error.message });
          }
        })
      );

      // Delay between batches
      if (i + this.maxDMsPerBatch < userIds.length) {
        await this.delay(this.dmDelay * this.maxDMsPerBatch);
      }
    }

    logger.info(
      `[ReleaseNotificationManager] Notification results - Success: ${results.successful}, Failed: ${results.failed}`
    );

    return results;
  }

  /**
   * Send DM to a specific user
   * @param {string} userId - User ID
   * @param {Discord.MessageEmbed} embed - Embed to send
   * @returns {Promise<void>}
   */
  async sendDMToUser(userId, embed) {
    try {
      const user = await this.client.users.fetch(userId);
      if (!user) {
        throw new Error('User not found');
      }

      await user.send({ embeds: [embed] });
      logger.info(`[ReleaseNotificationManager] Sent release notification to user ${userId}`);
    } catch (error) {
      // If DMs are disabled, mark user as opted out
      if (error.code === 50007) {
        // Cannot send messages to this user
        logger.info(
          `[ReleaseNotificationManager] User ${userId} has DMs disabled, marking as opted out`
        );
        await this.preferences.setOptOut(userId, true);
      }
      throw error;
    }
  }

  /**
   * Create release notification embed
   * @param {Object} versionInfo - Version information
   * @param {Object} release - GitHub release data
   * @param {string} userId - User ID receiving the notification
   * @returns {Discord.MessageEmbed} Release notification embed
   */
  createReleaseEmbed(versionInfo, release, userId) {
    // Check if user has ever changed their preferences
    const prefs = this.preferences.getUserPreferences(userId);
    const hasNeverChangedSettings = !prefs.updatedAt || prefs.updatedAt === prefs.createdAt;

    // Determine footer text based on user interaction history
    let footerText;
    if (hasNeverChangedSettings && !prefs.lastNotified) {
      // First notification ever
      footerText =
        "📌 First time receiving this? You're automatically opted in. Use !tz notifications off to opt out.";
    } else if (hasNeverChangedSettings && prefs.lastNotified) {
      // Second+ notification without any action taken - implied consent
      footerText =
        "✅ You're receiving these because you haven't opted out. Use !tz notifications off to stop.";
    } else {
      // User has interacted with settings before
      footerText = 'You can change your notification preferences with !tz notifications';
    }

    const embed = new Discord.EmbedBuilder()
      .setColor(this.getColorForChangeType(versionInfo.changeType))
      .setTitle(`🚀 Tzurot ${versionInfo.currentVersion} Released!`)
      .setDescription(this.getChangeTypeDescription(versionInfo.changeType))
      .setTimestamp(new Date(release.published_at))
      .setFooter({ text: footerText });

    // Add version comparison
    if (versionInfo.lastVersion) {
      embed.addFields({
        name: 'Version Update',
        value: `${versionInfo.lastVersion} → ${versionInfo.currentVersion}`,
        inline: true,
      });
    }

    // Parse and add changes
    const changes = this.githubClient.parseReleaseChanges(release);

    if (changes.breaking.length > 0) {
      embed.addFields({
        name: '⚠️ Breaking Changes',
        value: this.formatChangesList(changes.breaking, 5),
        inline: false,
      });
    }

    if (changes.features.length > 0) {
      embed.addFields({
        name: '✨ New Features',
        value: this.formatChangesList(changes.features, 5),
        inline: false,
      });
    }

    if (changes.fixes.length > 0) {
      embed.addFields({
        name: '🐛 Bug Fixes',
        value: this.formatChangesList(changes.fixes, 5),
        inline: false,
      });
    }

    // Add link to full release
    embed.addFields({
      name: 'More Information',
      value: `[View full release notes](${release.html_url})`,
      inline: false,
    });

    return embed;
  }

  /**
   * Format a list of changes for embed
   * @param {Array<string>} changes - List of changes
   * @param {number} maxItems - Maximum items to show
   * @returns {string} Formatted changes
   */
  formatChangesList(changes, maxItems = 5) {
    const items = changes.slice(0, maxItems);
    const formatted = items.map(item => `• ${item}`).join('\n');

    if (changes.length > maxItems) {
      return formatted + `\n• ...and ${changes.length - maxItems} more`;
    }

    return formatted;
  }

  /**
   * Get embed color for change type
   * @param {string} changeType - Type of change
   * @returns {number} Discord color value
   */
  getColorForChangeType(changeType) {
    switch (changeType) {
      case 'major':
        return 0xff0000; // Red
      case 'minor':
        return 0x00ff00; // Green
      case 'patch':
        return 0x0099ff; // Blue
      default:
        return 0x808080; // Gray
    }
  }

  /**
   * Get description for change type
   * @param {string} changeType - Type of change
   * @returns {string} Human-readable description
   */
  getChangeTypeDescription(changeType) {
    switch (changeType) {
      case 'major':
        return 'This is a major release with significant changes and new features!';
      case 'minor':
        return 'This release includes new features and improvements.';
      case 'patch':
        return 'This release includes bug fixes and minor improvements.';
      default:
        return 'A new version has been released.';
    }
  }

  /**
   * Get notification statistics
   * @returns {Object} Statistics about notifications
   */
  getStatistics() {
    return this.preferences.getStatistics();
  }
}

module.exports = ReleaseNotificationManager;
