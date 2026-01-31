/**
 * Release Notification System
 *
 * This module provides functionality for notifying authenticated users about new releases.
 * Users can opt out, set notification preferences, and receive DMs with release notes.
 */

const ReleaseNotificationManager = require('./ReleaseNotificationManager');
const VersionTracker = require('./VersionTracker');
const UserPreferencesPersistence = require('./UserPreferencesPersistence');
const GitHubReleaseClient = require('./GitHubReleaseClient');
const { botPrefix } = require('../../../config');

// Create singleton instance
let _instance = null;

/**
 * Get or create the singleton ReleaseNotificationManager instance
 * @returns {ReleaseNotificationManager} The notification manager instance
 */
function getInstance() {
  if (!_instance) {
    _instance = new ReleaseNotificationManager({ botPrefix });
  }
  return _instance;
}

module.exports = {
  // Main manager
  ReleaseNotificationManager,
  getInstance,

  // Components (for testing or advanced use)
  VersionTracker,
  UserPreferencesPersistence,
  GitHubReleaseClient,

  // Convenience exports
  get releaseNotificationManager() {
    return getInstance();
  },
};
