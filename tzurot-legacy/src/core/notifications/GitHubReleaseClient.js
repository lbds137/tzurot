const fetch = require('node-fetch');
const logger = require('../../logger');

/**
 * GitHubReleaseClient - Fetches release information from GitHub
 */
class GitHubReleaseClient {
  constructor(options = {}) {
    this.owner = options.owner || 'lbds137';
    this.repo = options.repo || 'tzurot';
    this.apiBase = 'https://api.github.com';
    this.releaseCache = new Map();
    this.cacheTTL = options.cacheTTL || 3600000; // 1 hour

    // Optional GitHub token for higher rate limits
    // Can be set via GITHUB_TOKEN env var or passed in options
    this.githubToken = options.githubToken || process.env.GITHUB_TOKEN || null;

    if (this.githubToken) {
      logger.info('[GitHubReleaseClient] Using authenticated GitHub API access');
    } else {
      logger.info(
        '[GitHubReleaseClient] Using unauthenticated GitHub API access (60 req/hour limit)'
      );
    }
  }

  /**
   * Get release notes for a specific version
   * @param {string} version - Version tag (e.g., 'v1.0.2')
   * @returns {Promise<Object|null>} Release data or null
   */
  async getReleaseByTag(version) {
    const tag = version.startsWith('v') ? version : `v${version}`;

    // Check cache
    const cached = this.releaseCache.get(tag);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      logger.info(`[GitHubReleaseClient] Using cached release data for ${tag}`);
      return cached.data;
    }

    try {
      const url = `${this.apiBase}/repos/${this.owner}/${this.repo}/releases/tags/${tag}`;

      const headers = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Tzurot-Bot',
      };

      // Add authorization header if token is available
      if (this.githubToken) {
        headers['Authorization'] = `token ${this.githubToken}`;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        if (response.status === 404) {
          logger.warn(`[GitHubReleaseClient] No release found for tag ${tag}`);
          return null;
        }
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Cache the result
      this.releaseCache.set(tag, { data, timestamp: Date.now() });

      logger.info(`[GitHubReleaseClient] Fetched release data for ${tag}`);
      return data;
    } catch (error) {
      logger.error(`[GitHubReleaseClient] Error fetching release ${tag}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get release notes between two versions
   * @param {string} fromVersion - Starting version (exclusive)
   * @param {string} toVersion - Ending version (inclusive)
   * @returns {Promise<Array>} Array of releases between versions
   */
  async getReleasesBetween(fromVersion, toVersion) {
    try {
      logger.info(
        `[GitHubReleaseClient] Fetching releases between ${fromVersion} and ${toVersion}`
      );

      // Fetch all releases (GitHub returns them in reverse chronological order)
      const url = `https://api.github.com/repos/${this.owner}/${this.repo}/releases?per_page=100`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const allReleases = await response.json();

      // Filter releases between the two versions
      const releases = [];
      let foundEnd = false;

      // Normalize versions by removing 'v' prefix
      const normalizedFromVersion = fromVersion.replace(/^v/, '');
      const normalizedToVersion = toVersion.replace(/^v/, '');

      for (const release of allReleases) {
        const tagName = release.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present

        // Skip drafts and prereleases unless we're looking for them specifically
        if (release.draft || release.prerelease) {
          continue;
        }

        // Check if we reached the start version (exclusive)
        if (tagName === normalizedFromVersion) {
          break; // Stop here, don't include the start version
        }

        // Start collecting when we find the end version (inclusive)
        if (tagName === normalizedToVersion) {
          foundEnd = true;
        }

        // Collect releases after finding end version
        if (foundEnd) {
          releases.push(release);
        }
      }

      // If we didn't find the end version, just return the latest release
      if (!foundEnd) {
        logger.warn(
          `[GitHubReleaseClient] Could not find version ${toVersion}, fetching it directly`
        );
        const directRelease = await this.getReleaseByTag(toVersion);
        return directRelease ? [directRelease] : [];
      }

      logger.info(`[GitHubReleaseClient] Found ${releases.length} releases between versions`);
      return releases;
    } catch (error) {
      logger.error(`[GitHubReleaseClient] Error fetching releases: ${error.message}`);
      return [];
    }
  }

  /**
   * Format release notes for Discord
   * @param {Object} release - GitHub release object
   * @param {boolean} includeFullNotes - Whether to include full release notes
   * @returns {string} Formatted release notes
   */
  formatReleaseNotes(release, includeFullNotes = true) {
    if (!release) return 'No release notes available.';

    const parts = [];

    // Title and version
    parts.push(`**${release.name || release.tag_name}**`);

    // Publication date
    if (release.published_at) {
      const date = new Date(release.published_at).toLocaleDateString();
      parts.push(`Released: ${date}`);
    }

    // Release notes
    if (includeFullNotes && release.body) {
      parts.push('');
      parts.push('**Release Notes:**');

      // Truncate if too long for Discord
      const maxLength = 1500;
      let body = release.body;

      if (body.length > maxLength) {
        body =
          body.substring(0, maxLength) +
          '...\n\n[Read full release notes](' +
          release.html_url +
          ')';
      }

      parts.push(body);
    }

    // Link to release
    parts.push('');
    parts.push(`[View on GitHub](${release.html_url})`);

    return parts.join('\n');
  }

  /**
   * Extract key changes from release notes
   * @param {Object} release - GitHub release object
   * @returns {Object} Categorized changes
   */
  parseReleaseChanges(release) {
    if (!release || !release.body) {
      return { features: [], fixes: [], breaking: [], other: [] };
    }

    const changes = {
      features: [],
      fixes: [],
      breaking: [],
      other: [],
    };

    const lines = release.body.split('\n');
    let currentSection = 'other';

    for (const line of lines) {
      const trimmed = line.trim();

      // Detect sections
      if (trimmed.match(/^#+\s*(features?|added)/i)) {
        currentSection = 'features';
      } else if (trimmed.match(/^#+\s*(fixes?|fixed|bug\s*fixes?)/i)) {
        currentSection = 'fixes';
      } else if (trimmed.match(/^#+\s*(breaking)/i)) {
        currentSection = 'breaking';
      } else if (trimmed.match(/^#+\s*(changed|other|misc|chore|removed)/i)) {
        currentSection = 'other';
      }

      // Collect bullet points
      else if (trimmed.match(/^[-*]\s+/)) {
        const content = trimmed.replace(/^[-*]\s+/, '');
        changes[currentSection].push(content);
      }
    }

    return changes;
  }

  /**
   * Clear the release cache
   */
  clearCache() {
    this.releaseCache.clear();
    logger.info('[GitHubReleaseClient] Cleared release cache');
  }
}

module.exports = GitHubReleaseClient;
