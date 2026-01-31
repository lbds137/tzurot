/**
 * Tests for GitHubReleaseClient
 */

// Mock dependencies
jest.mock('node-fetch');
jest.mock('../../../../src/logger');

const fetch = require('node-fetch');
const GitHubReleaseClient = require('../../../../src/core/notifications/GitHubReleaseClient');
const logger = require('../../../../src/logger');

describe('GitHubReleaseClient', () => {
  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    client = new GitHubReleaseClient({
      owner: 'testowner',
      repo: 'testrepo',
      cacheTTL: 1000, // 1 second for tests
    });

    // Set up logger mock
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getReleaseByTag', () => {
    const mockRelease = {
      tag_name: 'v1.2.0',
      name: 'Version 1.2.0',
      body: '## Changes\n- New feature\n- Bug fix',
      html_url: 'https://example.com/testowner/testrepo/releases/tag/v1.2.0',
      published_at: '2024-01-01T00:00:00Z',
    };

    it('should fetch release data from GitHub', async () => {
      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockRelease),
      });

      const release = await client.getReleaseByTag('1.2.0');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/testowner/testrepo/releases/tags/v1.2.0',
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Tzurot-Bot',
          },
        }
      );
      expect(release).toEqual(mockRelease);
    });

    it('should add v prefix if not present', async () => {
      fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockRelease),
      });

      // Test without v prefix
      await client.getReleaseByTag('1.2.0');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/tags/v1.2.0'),
        expect.any(Object)
      );

      // Clear cache and mocks
      client.clearCache();
      fetch.mockClear();
      fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockRelease),
      });

      // Test with v prefix - should still use v prefix
      await client.getReleaseByTag('v1.2.0');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/tags/v1.2.0'),
        expect.any(Object)
      );
    });

    it('should cache release data', async () => {
      fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockRelease),
      });

      // First call
      const release1 = await client.getReleaseByTag('1.2.0');
      expect(fetch).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const release2 = await client.getReleaseByTag('1.2.0');
      expect(fetch).toHaveBeenCalledTimes(1); // Still only 1 call
      expect(release2).toEqual(release1);
      expect(logger.info).toHaveBeenCalledWith(
        '[GitHubReleaseClient] Using cached release data for v1.2.0'
      );
    });

    it('should refetch after cache expires', async () => {
      // Mock Date.now() to work with fake timers
      const dateNowSpy = jest.spyOn(Date, 'now');
      let currentTime = 1000000;
      dateNowSpy.mockImplementation(() => currentTime);

      fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockRelease),
      });

      // First call
      await client.getReleaseByTag('1.2.0');
      expect(fetch).toHaveBeenCalledTimes(1);

      // Advance time to expire cache
      currentTime += 1100;

      // Second call should refetch
      await client.getReleaseByTag('1.2.0');
      expect(fetch).toHaveBeenCalledTimes(2);

      dateNowSpy.mockRestore();
    });

    it('should return null for 404 responses', async () => {
      fetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const release = await client.getReleaseByTag('nonexistent');

      expect(release).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        '[GitHubReleaseClient] No release found for tag vnonexistent'
      );
    });

    it('should throw error for other HTTP errors', async () => {
      fetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(client.getReleaseByTag('1.2.0')).rejects.toThrow(
        'GitHub API error: 500 Internal Server Error'
      );
    });

    it('should handle network errors', async () => {
      fetch.mockRejectedValue(new Error('Network error'));

      await expect(client.getReleaseByTag('1.2.0')).rejects.toThrow('Network error');

      expect(logger.error).toHaveBeenCalledWith(
        '[GitHubReleaseClient] Error fetching release v1.2.0: Network error'
      );
    });
  });

  describe('getReleasesBetween', () => {
    it('should return empty array on error', async () => {
      fetch.mockRejectedValue(new Error('API error'));

      const releases = await client.getReleasesBetween('1.1.0', '1.2.0');

      expect(releases).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('formatReleaseNotes', () => {
    const mockRelease = {
      tag_name: 'v1.2.0',
      name: 'Version 1.2.0 - Feature Update',
      body: '## New Features\n- Feature 1\n- Feature 2\n\n## Bug Fixes\n- Fix 1',
      html_url: 'https://example.com/test/test/releases/tag/v1.2.0',
      published_at: '2024-01-01T00:00:00Z',
    };

    it('should format release notes for Discord', () => {
      const formatted = client.formatReleaseNotes(mockRelease);

      expect(formatted).toContain('**Version 1.2.0 - Feature Update**');
      expect(formatted).toContain('Released:');
      expect(formatted).toContain('**Release Notes:**');
      expect(formatted).toContain('## New Features');
      expect(formatted).toContain(
        '[View on GitHub](https://example.com/test/test/releases/tag/v1.2.0)'
      );
    });

    it('should truncate long release notes', () => {
      const longRelease = {
        ...mockRelease,
        body: 'x'.repeat(2000), // Very long body
      };

      const formatted = client.formatReleaseNotes(longRelease);

      expect(formatted.length).toBeLessThan(2000);
      expect(formatted).toContain('...');
      expect(formatted).toContain('[Read full release notes]');
    });

    it('should handle missing release notes', () => {
      const releaseWithoutBody = {
        ...mockRelease,
        body: null,
      };

      const formatted = client.formatReleaseNotes(releaseWithoutBody);

      expect(formatted).toContain('**Version 1.2.0 - Feature Update**');
      expect(formatted).not.toContain('**Release Notes:**');
    });

    it('should handle null release', () => {
      const formatted = client.formatReleaseNotes(null);
      expect(formatted).toBe('No release notes available.');
    });

    it('should respect includeFullNotes parameter', () => {
      const formatted = client.formatReleaseNotes(mockRelease, false);

      expect(formatted).toContain('**Version 1.2.0 - Feature Update**');
      expect(formatted).not.toContain('**Release Notes:**');
      expect(formatted).not.toContain('## New Features');
    });

    // Additional getReleasesBetween tests
    const mockReleases = [
      {
        tag_name: 'v1.3.0',
        name: 'Version 1.3.0',
        body: '## Added\n- Feature C\n## Fixed\n- Bug 3',
        html_url: 'https://example.com/release/v1.3.0',
        published_at: '2024-01-03T00:00:00Z',
        draft: false,
        prerelease: false,
      },
      {
        tag_name: 'v1.2.0',
        name: 'Version 1.2.0',
        body: '## Added\n- Feature B\n## Fixed\n- Bug 2',
        html_url: 'https://example.com/release/v1.2.0',
        published_at: '2024-01-02T00:00:00Z',
        draft: false,
        prerelease: false,
      },
      {
        tag_name: 'v1.1.0',
        name: 'Version 1.1.0',
        body: '## Added\n- Feature A\n## Fixed\n- Bug 1',
        html_url: 'https://example.com/release/v1.1.0',
        published_at: '2024-01-01T00:00:00Z',
        draft: false,
        prerelease: false,
      },
      {
        tag_name: 'v1.0.0',
        name: 'Version 1.0.0',
        body: '## Initial Release',
        html_url: 'https://example.com/release/v1.0.0',
        published_at: '2023-12-31T00:00:00Z',
        draft: false,
        prerelease: false,
      },
    ];

    it('should fetch releases between two versions', async () => {
      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockReleases),
      });

      const releases = await client.getReleasesBetween('1.1.0', '1.3.0');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/testowner/testrepo/releases?per_page=100'
      );
      expect(releases).toHaveLength(2);
      expect(releases[0].tag_name).toBe('v1.3.0');
      expect(releases[1].tag_name).toBe('v1.2.0');
    });

    it('should handle version tags with and without v prefix', async () => {
      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockReleases),
      });

      const releases = await client.getReleasesBetween('v1.0.0', 'v1.2.0');

      expect(releases).toHaveLength(2);
      expect(releases[0].tag_name).toBe('v1.2.0');
      expect(releases[1].tag_name).toBe('v1.1.0');
    });

    it('should skip draft and prerelease versions', async () => {
      const releasesWithDrafts = [
        ...mockReleases.slice(0, 2),
        {
          tag_name: 'v1.2.5-beta',
          name: 'Beta Release',
          prerelease: true,
          draft: false,
        },
        {
          tag_name: 'v1.2.4-draft',
          name: 'Draft Release',
          prerelease: false,
          draft: true,
        },
        ...mockReleases.slice(2),
      ];

      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(releasesWithDrafts),
      });

      const releases = await client.getReleasesBetween('1.0.0', '1.3.0');

      expect(releases).toHaveLength(3);
      expect(releases.every(r => !r.draft && !r.prerelease)).toBe(true);
    });

    it('should handle API errors gracefully', async () => {
      fetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const releases = await client.getReleasesBetween('1.0.0', '1.2.0');

      expect(releases).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error fetching releases'));
    });

    it('should fetch single release if end version not found in list', async () => {
      fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue(mockReleases),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            tag_name: 'v1.5.0',
            name: 'Version 1.5.0',
            body: 'New release',
          }),
        });

      const releases = await client.getReleasesBetween('1.0.0', '1.5.0');

      expect(releases).toHaveLength(1);
      expect(releases[0].tag_name).toBe('v1.5.0');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not find version 1.5.0')
      );
    });

    it('should return empty array if direct fetch also fails', async () => {
      fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue(mockReleases),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });

      const releases = await client.getReleasesBetween('1.0.0', '1.5.0');

      expect(releases).toEqual([]);
    });
  });

  describe('parseReleaseChanges', () => {
    it('should parse release notes into categories', () => {
      const release = {
        body: `## Features
- New dashboard
- API improvements

## Bug Fixes
- Fixed login issue
- Fixed data export

## Breaking Changes
- Removed legacy endpoints

## Other
- Updated dependencies`,
      };

      const changes = client.parseReleaseChanges(release);

      expect(changes).toEqual({
        features: ['New dashboard', 'API improvements'],
        fixes: ['Fixed login issue', 'Fixed data export'],
        breaking: ['Removed legacy endpoints'],
        other: ['Updated dependencies'],
      });
    });

    it('should handle various section headers', () => {
      const release = {
        body: `### Added
- Feature 1

## Fixed
- Bug 1

# BREAKING
- Change 1

## Misc
- Other 1`,
      };

      const changes = client.parseReleaseChanges(release);

      expect(changes.features).toEqual(['Feature 1']);
      expect(changes.fixes).toEqual(['Bug 1']);
      expect(changes.breaking).toEqual(['Change 1']);
      expect(changes.other).toEqual(['Other 1']);
    });

    it('should handle missing sections', () => {
      const release = {
        body: `## Features
- New feature

Some other text that's not in a section`,
      };

      const changes = client.parseReleaseChanges(release);

      expect(changes.features).toEqual(['New feature']);
      expect(changes.fixes).toEqual([]);
      expect(changes.breaking).toEqual([]);
      expect(changes.other).toEqual([]);
    });

    it('should handle null or empty release', () => {
      expect(client.parseReleaseChanges(null)).toEqual({
        features: [],
        fixes: [],
        breaking: [],
        other: [],
      });

      expect(client.parseReleaseChanges({ body: null })).toEqual({
        features: [],
        fixes: [],
        breaking: [],
        other: [],
      });

      expect(client.parseReleaseChanges({ body: '' })).toEqual({
        features: [],
        fixes: [],
        breaking: [],
        other: [],
      });
    });

    it('should handle bullet points with different markers', () => {
      const release = {
        body: `## Features
- Dash bullet
* Star bullet
- Another dash bullet`,
      };

      const changes = client.parseReleaseChanges(release);

      expect(changes.features).toEqual(['Dash bullet', 'Star bullet', 'Another dash bullet']);
    });

    it('should categorize Changed section as other, not breaking', () => {
      const release = {
        body: `## Changed
- Environment Variable Standardization
- Updated configuration

## Breaking
- Actual breaking change`,
      };

      const changes = client.parseReleaseChanges(release);

      expect(changes.breaking).toEqual(['Actual breaking change']);
      expect(changes.other).toEqual([
        'Environment Variable Standardization',
        'Updated configuration',
      ]);
    });
  });

  describe('clearCache', () => {
    it('should clear the release cache', async () => {
      const mockRelease = { tag_name: 'v1.0.0' };
      fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockRelease),
      });

      // Cache a release
      await client.getReleaseByTag('1.0.0');
      expect(fetch).toHaveBeenCalledTimes(1);

      // Clear cache
      client.clearCache();

      // Next call should fetch again
      await client.getReleaseByTag('1.0.0');
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith('[GitHubReleaseClient] Cleared release cache');
    });
  });
});
