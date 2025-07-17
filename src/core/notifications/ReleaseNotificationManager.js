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
    this.botPrefix = options.botPrefix || '!tz'; // Default to !tz

    // Notification settings
    this.maxDMsPerBatch = options.maxDMsPerBatch || 10;
    this.dmDelay = options.dmDelay || 1000; // 1 second between DMs

    // Injectable delay function for testability
    this.delay =
      options.delay ||
      (ms => {
        const timer = globalThis.setTimeout || setTimeout;
        return new Promise(resolve => timer(resolve, ms));
      });
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

    // Check if we've never sent any notifications but have a saved version
    // This can happen if the bot was restarted before sending first notifications
    const lastVersion = await this.versionTracker.getLastNotifiedVersion();
    if (lastVersion && !this.preferences.hasAnyUserBeenNotified()) {
      logger.info(
        '[ReleaseNotificationManager] Found saved version but no notifications sent, clearing for first-run'
      );
      await this.versionTracker.clearSavedVersion();
    }

    // Migration is no longer needed - DDD system handles authenticated users differently
    // Users will be opted in when they first authenticate through DDD commands

    this.initialized = true;
    logger.info('[ReleaseNotificationManager] Initialized successfully');
  }

  /**
   * Add a user to notification system (for new DDD authenticated users)
   * @param {string} userId - Discord user ID
   * @param {Object} options - Notification preferences
   * @returns {Promise<void>}
   */
  async addUserToNotifications(userId, options = {}) {
    try {
      // Check if user already has preferences
      const existingPrefs = this.preferences.preferences.get(userId);

      if (!existingPrefs) {
        // Add user with default opt-in preferences
        await this.preferences.updateUserPreferences(userId, {
          optedOut: false,
          notificationLevel: 'minor',
          fromDDDAuth: true,
          ...options,
        });
        logger.info(`[ReleaseNotificationManager] Added user ${userId} to notification system`);
      }
    } catch (error) {
      logger.error(
        `[ReleaseNotificationManager] Error migrating authenticated users: ${error.message}`
      );
    }
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
      // If we have a last version, get all releases between them
      let releases;
      if (versionInfo.lastVersion) {
        releases = await this.githubClient.getReleasesBetween(
          versionInfo.lastVersion,
          versionInfo.currentVersion
        );
      } else {
        // First time running, get releases from a reasonable starting point
        // We'll use v0.0.0 as the starting point to get all releases up to current
        const allReleases = await this.githubClient.getReleasesBetween(
          '0.0.0',
          versionInfo.currentVersion
        );

        // Sort by version descending (newest first)
        releases = allReleases.sort((a, b) => {
          const versionA = a.tag_name.replace(/^v/, '');
          const versionB = b.tag_name.replace(/^v/, '');
          return this.versionTracker.compareVersions(versionB, versionA);
        });

        // Limit to last 5 releases to avoid overwhelming users
        releases = releases.slice(0, 5);

        logger.info(
          `[ReleaseNotificationManager] First run - including ${releases.length} recent releases`
        );
      }

      if (!releases || releases.length === 0) {
        logger.warn(
          '[ReleaseNotificationManager] No GitHub releases found for version ' +
            versionInfo.currentVersion
        );
        return { notified: false, reason: 'No releases found on GitHub' };
      }

      logger.info(
        `[ReleaseNotificationManager] Found ${releases.length} release(s) to notify about`
      );

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
      const results = await this.sendNotifications(usersToNotify, versionInfo, releases);

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
   * @param {Array<Object>} releases - Array of GitHub release data
   * @returns {Promise<Object>} Results of notification attempts
   */
  async sendNotifications(userIds, versionInfo, releases) {
    const results = { successful: 0, failed: 0, errors: [] };

    // Send in batches to avoid rate limits
    for (let i = 0; i < userIds.length; i += this.maxDMsPerBatch) {
      const batch = userIds.slice(i, i + this.maxDMsPerBatch);

      await Promise.all(
        batch.map(async userId => {
          try {
            // Create personalized embed for each user
            const embed = this.createReleaseEmbed(versionInfo, releases, userId);
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
   * @param {Array<Object>} releases - Array of GitHub release data
   * @param {string} userId - User ID receiving the notification
   * @returns {Discord.MessageEmbed} Release notification embed
   */
  createReleaseEmbed(versionInfo, releases, userId) {
    // Check if user has ever changed their preferences
    const prefs = this.preferences.getUserPreferences(userId);
    const hasNeverChangedSettings = !prefs.updatedAt || prefs.updatedAt === prefs.createdAt;

    // Determine footer text based on user interaction history
    let footerText;
    if (hasNeverChangedSettings && !prefs.lastNotified) {
      // First notification ever
      footerText = `📌 First time receiving this? You're automatically opted in. Use ${this.botPrefix} notifications off to opt out.`;
    } else if (hasNeverChangedSettings && prefs.lastNotified) {
      // Second+ notification without any action taken - implied consent
      footerText = `✅ You're receiving these because you haven't opted out. Use ${this.botPrefix} notifications off to stop.`;
    } else {
      // User has interacted with settings before
      footerText = `You can change your notification preferences with ${this.botPrefix} notifications`;
    }

    // Determine title based on number of releases
    const title =
      releases.length > 1
        ? `🚀 Tzurot Multiple Releases (${releases.length} versions)`
        : `🚀 Tzurot ${versionInfo.currentVersion} Released!`;

    const latestRelease = releases[0]; // Most recent release

    const embed = new Discord.EmbedBuilder()
      .setColor(this.getColorForChangeType(versionInfo.changeType))
      .setTitle(title)
      .setDescription(this.getMultiReleaseDescription(versionInfo, releases))
      .setTimestamp(new Date(latestRelease.published_at))
      .setFooter({ text: footerText });

    // Add version comparison
    if (versionInfo.lastVersion) {
      embed.addFields({
        name: 'Version Update',
        value: `${versionInfo.lastVersion} → ${versionInfo.currentVersion}`,
        inline: true,
      });
    }

    // If multiple releases, show version list
    if (releases.length > 1) {
      const versionList = releases
        .map(r => `• ${r.tag_name} - ${new Date(r.published_at).toLocaleDateString()}`)
        .join('\n');
      embed.addFields({
        name: '📋 Included Versions',
        value: versionList.substring(0, 1024), // Discord field limit
        inline: false,
      });
    }

    // Aggregate changes from all releases
    const aggregatedChanges = this.aggregateReleaseChanges(releases);

    if (aggregatedChanges.breaking.length > 0) {
      embed.addFields({
        name: '⚠️ Breaking Changes',
        value: this.formatChangesList(aggregatedChanges.breaking, 5),
        inline: false,
      });
    }

    if (aggregatedChanges.features.length > 0) {
      embed.addFields({
        name: '✨ New Features',
        value: this.formatChangesList(aggregatedChanges.features, 5),
        inline: false,
      });
    }

    if (aggregatedChanges.fixes.length > 0) {
      embed.addFields({
        name: '🐛 Bug Fixes',
        value: this.formatChangesList(aggregatedChanges.fixes, 5),
        inline: false,
      });
    }

    if (aggregatedChanges.other.length > 0) {
      embed.addFields({
        name: '🔧 Other Changes',
        value: this.formatChangesList(aggregatedChanges.other, 5),
        inline: false,
      });
    }

    // Add link to full release
    const releaseLinks =
      releases.length > 1
        ? `[View latest release](${latestRelease.html_url}) | [All releases](https://github.com/${this.githubClient.owner}/${this.githubClient.repo}/releases)`
        : `[View full release notes](${latestRelease.html_url})`;

    embed.addFields({
      name: 'More Information',
      value: releaseLinks,
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
   * Get description for multiple releases
   * @param {Object} versionInfo - Version information
   * @param {Array<Object>} releases - Array of releases
   * @returns {string} Description text
   */
  getMultiReleaseDescription(versionInfo, releases) {
    if (releases.length === 1) {
      return this.getChangeTypeDescription(versionInfo.changeType);
    }

    const versionCount = releases.length;
    const oldestRelease = releases[releases.length - 1];
    const newestRelease = releases[0];
    const timeSpan = Math.floor(
      (new Date(newestRelease.published_at) - new Date(oldestRelease.published_at)) /
        (1000 * 60 * 60 * 24)
    );

    return `You've missed ${versionCount} releases over the past ${timeSpan} days! Here's a summary of all the changes.`;
  }

  /**
   * Aggregate changes from multiple releases
   * @param {Array<Object>} releases - Array of releases
   * @returns {Object} Aggregated changes
   */
  aggregateReleaseChanges(releases) {
    const aggregated = {
      breaking: [],
      features: [],
      fixes: [],
      other: [],
    };

    // Process each release and collect changes
    for (const release of releases) {
      const changes = this.githubClient.parseReleaseChanges(release);

      // Add version prefix to each change
      const versionPrefix = releases.length > 1 ? `[${release.tag_name}] ` : '';

      aggregated.breaking.push(...changes.breaking.map(c => versionPrefix + c));
      aggregated.features.push(...changes.features.map(c => versionPrefix + c));
      aggregated.fixes.push(...changes.fixes.map(c => versionPrefix + c));
      aggregated.other.push(...changes.other.map(c => versionPrefix + c));
    }

    return aggregated;
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
