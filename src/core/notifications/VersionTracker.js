const fs = require('fs').promises;
const path = require('path');
const logger = require('../../logger');

/**
 * VersionTracker - Tracks bot version changes and determines when notifications are needed
 */
class VersionTracker {
  constructor(options = {}) {
    this.dataPath = options.dataPath || path.join(__dirname, '../../../data');
    this.versionFile = path.join(this.dataPath, 'lastNotifiedVersion.json');
    this.packageJsonPath = options.packageJsonPath || path.join(__dirname, '../../../package.json');
  }

  /**
   * Get the current version from package.json
   * @returns {Promise<string>} Current version
   */
  async getCurrentVersion() {
    try {
      const packageJson = JSON.parse(await fs.readFile(this.packageJsonPath, 'utf8'));
      return packageJson.version;
    } catch (error) {
      logger.error(`[VersionTracker] Error reading package.json: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the last notified version
   * @returns {Promise<string|null>} Last notified version or null if none
   */
  async getLastNotifiedVersion() {
    try {
      const data = JSON.parse(await fs.readFile(this.versionFile, 'utf8'));
      return data.version;
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('[VersionTracker] No previous version file found, this is first run');
        return null;
      }
      logger.error(`[VersionTracker] Error reading version file: ${error.message}`);
      return null;
    }
  }

  /**
   * Save the current version as notified
   * @param {string} version - Version that was notified
   * @returns {Promise<void>}
   */
  async saveNotifiedVersion(version) {
    try {
      await fs.mkdir(this.dataPath, { recursive: true });
      await fs.writeFile(
        this.versionFile,
        JSON.stringify({ version, notifiedAt: new Date().toISOString() }, null, 2)
      );
      logger.info(`[VersionTracker] Saved notified version: ${version}`);
    } catch (error) {
      logger.error(`[VersionTracker] Error saving version: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse version string into components
   * @param {string} version - Version string (e.g., "1.2.3")
   * @returns {{major: number, minor: number, patch: number}} Version components
   */
  parseVersion(version) {
    const parts = version.split('.').map(p => parseInt(p, 10) || 0);
    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0,
    };
  }

  /**
   * Compare two versions
   * @param {string} v1 - First version
   * @param {string} v2 - Second version
   * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  compareVersions(v1, v2) {
    const parsed1 = this.parseVersion(v1);
    const parsed2 = this.parseVersion(v2);

    if (parsed1.major > parsed2.major) return 1;
    if (parsed1.major < parsed2.major) return -1;

    if (parsed1.minor > parsed2.minor) return 1;
    if (parsed1.minor < parsed2.minor) return -1;

    if (parsed1.patch > parsed2.patch) return 1;
    if (parsed1.patch < parsed2.patch) return -1;

    return 0;
  }

  /**
   * Check if a new version is available since last notification
   * @returns {Promise<{hasNewVersion: boolean, currentVersion: string, lastVersion: string|null, changeType: string|null}>}
   */
  async checkForNewVersion() {
    const currentVersion = await this.getCurrentVersion();
    const lastVersion = await this.getLastNotifiedVersion();

    if (!lastVersion) {
      // First run - we should notify about the current version
      // Don't save yet - let the notification manager handle that after sending
      logger.info(
        `[VersionTracker] First run detected, will notify about current version ${currentVersion}`
      );

      // Determine change type based on current version
      const current = this.parseVersion(currentVersion);
      let changeType = 'minor'; // Default to minor for first notification

      // If it's a major version (x.0.0), treat as major
      if (current.minor === 0 && current.patch === 0) {
        changeType = 'major';
      }

      return { hasNewVersion: true, currentVersion, lastVersion: null, changeType };
    }

    const comparison = this.compareVersions(currentVersion, lastVersion);
    const hasNewVersion = comparison > 0;
    let changeType = null;

    if (hasNewVersion) {
      const current = this.parseVersion(currentVersion);
      const last = this.parseVersion(lastVersion);

      if (current.major > last.major) {
        changeType = 'major';
      } else if (current.minor > last.minor) {
        changeType = 'minor';
      } else if (current.patch > last.patch) {
        changeType = 'patch';
      }
    }

    logger.info(
      `[VersionTracker] Version check - Current: ${currentVersion}, Last: ${lastVersion}, Has new: ${hasNewVersion}, Type: ${changeType}`
    );

    return { hasNewVersion, currentVersion, lastVersion, changeType };
  }

  /**
   * Get version difference details
   * @param {string} fromVersion - Starting version
   * @param {string} toVersion - Target version
   * @returns {Object} Version difference details
   */
  getVersionDiff(fromVersion, toVersion) {
    const from = this.parseVersion(fromVersion);
    const to = this.parseVersion(toVersion);

    return {
      from: fromVersion,
      to: toVersion,
      majorDiff: to.major - from.major,
      minorDiff: to.minor - from.minor,
      patchDiff: to.patch - from.patch,
    };
  }

  /**
   * Clear the saved version file (for resetting first-run state)
   * @returns {Promise<void>}
   */
  async clearSavedVersion() {
    try {
      await fs.unlink(this.versionFile);
      logger.info('[VersionTracker] Cleared saved version file');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error(`[VersionTracker] Error clearing version file: ${error.message}`);
      }
    }
  }
}

module.exports = VersionTracker;
