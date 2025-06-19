/**
 * Tests for VersionTracker
 */

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    stat: jest.fn(),
    unlink: jest.fn(),
  },
}));

jest.mock('../../../../src/logger');

const fs = require('fs').promises;
const VersionTracker = require('../../../../src/core/notifications/VersionTracker');
const logger = require('../../../../src/logger');

describe('VersionTracker', () => {
  let tracker;

  beforeEach(() => {
    jest.clearAllMocks();
    tracker = new VersionTracker();

    // Set up logger mock
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();
  });

  describe('getCurrentVersion', () => {
    it('should read version from package.json', async () => {
      const mockPackageJson = { version: '1.2.3' };
      fs.readFile.mockResolvedValue(JSON.stringify(mockPackageJson));

      const version = await tracker.getCurrentVersion();

      expect(version).toBe('1.2.3');
      expect(fs.readFile).toHaveBeenCalledWith(expect.stringContaining('package.json'), 'utf8');
    });

    it('should throw error if package.json cannot be read', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));

      await expect(tracker.getCurrentVersion()).rejects.toThrow('File not found');
    });
  });

  describe('getLastNotifiedVersion', () => {
    it('should return version from saved file', async () => {
      const mockData = { version: '1.2.0' };
      fs.readFile.mockResolvedValue(JSON.stringify(mockData));

      const version = await tracker.getLastNotifiedVersion();

      expect(version).toBe('1.2.0');
    });

    it('should return null if file does not exist', async () => {
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      fs.readFile.mockRejectedValue(error);

      const version = await tracker.getLastNotifiedVersion();

      expect(version).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('No previous version file found')
      );
    });

    it('should return null on other errors', async () => {
      fs.readFile.mockRejectedValue(new Error('Permission denied'));

      const version = await tracker.getLastNotifiedVersion();

      expect(version).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error reading version file')
      );
    });
  });

  describe('saveNotifiedVersion', () => {
    it('should save version to file', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      await tracker.saveNotifiedVersion('1.2.3');

      expect(fs.mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('lastNotifiedVersion.json'),
        expect.stringContaining('"version": "1.2.3"')
      );
    });

    it('should throw error if save fails', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockRejectedValue(new Error('Write failed'));

      await expect(tracker.saveNotifiedVersion('1.2.3')).rejects.toThrow('Write failed');
    });
  });

  describe('parseVersion', () => {
    it('should parse valid version strings', () => {
      expect(tracker.parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
      expect(tracker.parseVersion('10.0.0')).toEqual({ major: 10, minor: 0, patch: 0 });
      expect(tracker.parseVersion('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0 });
    });

    it('should handle incomplete versions', () => {
      expect(tracker.parseVersion('1.2')).toEqual({ major: 1, minor: 2, patch: 0 });
      expect(tracker.parseVersion('1')).toEqual({ major: 1, minor: 0, patch: 0 });
      expect(tracker.parseVersion('')).toEqual({ major: 0, minor: 0, patch: 0 });
    });

    it('should handle invalid parts', () => {
      expect(tracker.parseVersion('1.a.3')).toEqual({ major: 1, minor: 0, patch: 3 });
      expect(tracker.parseVersion('x.y.z')).toEqual({ major: 0, minor: 0, patch: 0 });
    });
  });

  describe('compareVersions', () => {
    it('should correctly compare versions', () => {
      expect(tracker.compareVersions('2.0.0', '1.0.0')).toBe(1);
      expect(tracker.compareVersions('1.0.0', '2.0.0')).toBe(-1);
      expect(tracker.compareVersions('1.0.0', '1.0.0')).toBe(0);

      expect(tracker.compareVersions('1.2.0', '1.1.0')).toBe(1);
      expect(tracker.compareVersions('1.1.0', '1.2.0')).toBe(-1);

      expect(tracker.compareVersions('1.0.2', '1.0.1')).toBe(1);
      expect(tracker.compareVersions('1.0.1', '1.0.2')).toBe(-1);
    });
  });

  describe('checkForNewVersion', () => {
    beforeEach(() => {
      // Mock package.json to return current version
      fs.readFile.mockImplementation(path => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({ version: '1.2.0' }));
        }
        return Promise.reject(new Error('Unknown file'));
      });
    });

    it('should return hasNewVersion: true on first run', async () => {
      // Simulate first run - no saved version file
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      fs.readFile.mockImplementation(path => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({ version: '1.2.0' }));
        }
        if (path.includes('lastNotifiedVersion.json')) {
          return Promise.reject(error);
        }
        return Promise.reject(new Error('Unknown file'));
      });

      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const result = await tracker.checkForNewVersion();

      expect(result).toEqual({
        hasNewVersion: true,
        currentVersion: '1.2.0',
        lastVersion: null,
        changeType: 'minor',
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[VersionTracker] First run detected, will notify about current version 1.2.0'
      );
      // Should NOT save version yet - let notification manager handle that
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should detect major version on first run for x.0.0 versions', async () => {
      // Simulate first run with major version
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      fs.readFile.mockImplementation(path => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({ version: '2.0.0' }));
        }
        if (path.includes('lastNotifiedVersion.json')) {
          return Promise.reject(error);
        }
        return Promise.reject(new Error('Unknown file'));
      });

      const result = await tracker.checkForNewVersion();

      expect(result).toEqual({
        hasNewVersion: true,
        currentVersion: '2.0.0',
        lastVersion: null,
        changeType: 'major',
      });
    });

    it('should detect major version change', async () => {
      // Current version is 1.2.0, last notified was 0.9.0
      fs.readFile.mockImplementation(path => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({ version: '2.0.0' }));
        }
        if (path.includes('lastNotifiedVersion.json')) {
          return Promise.resolve(JSON.stringify({ version: '1.9.0' }));
        }
        return Promise.reject(new Error('Unknown file'));
      });

      const result = await tracker.checkForNewVersion();

      expect(result).toEqual({
        hasNewVersion: true,
        currentVersion: '2.0.0',
        lastVersion: '1.9.0',
        changeType: 'major',
      });
    });

    it('should detect minor version change', async () => {
      fs.readFile.mockImplementation(path => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({ version: '1.3.0' }));
        }
        if (path.includes('lastNotifiedVersion.json')) {
          return Promise.resolve(JSON.stringify({ version: '1.2.5' }));
        }
        return Promise.reject(new Error('Unknown file'));
      });

      const result = await tracker.checkForNewVersion();

      expect(result).toEqual({
        hasNewVersion: true,
        currentVersion: '1.3.0',
        lastVersion: '1.2.5',
        changeType: 'minor',
      });
    });

    it('should detect patch version change', async () => {
      fs.readFile.mockImplementation(path => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({ version: '1.2.1' }));
        }
        if (path.includes('lastNotifiedVersion.json')) {
          return Promise.resolve(JSON.stringify({ version: '1.2.0' }));
        }
        return Promise.reject(new Error('Unknown file'));
      });

      const result = await tracker.checkForNewVersion();

      expect(result).toEqual({
        hasNewVersion: true,
        currentVersion: '1.2.1',
        lastVersion: '1.2.0',
        changeType: 'patch',
      });
    });

    it('should detect no change when versions are equal', async () => {
      fs.readFile.mockImplementation(path => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({ version: '1.2.0' }));
        }
        if (path.includes('lastNotifiedVersion.json')) {
          return Promise.resolve(JSON.stringify({ version: '1.2.0' }));
        }
        return Promise.reject(new Error('Unknown file'));
      });

      const result = await tracker.checkForNewVersion();

      expect(result).toEqual({
        hasNewVersion: false,
        currentVersion: '1.2.0',
        lastVersion: '1.2.0',
        changeType: null,
      });
    });

    it('should detect no change when current version is older', async () => {
      fs.readFile.mockImplementation(path => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({ version: '1.1.0' }));
        }
        if (path.includes('lastNotifiedVersion.json')) {
          return Promise.resolve(JSON.stringify({ version: '1.2.0' }));
        }
        return Promise.reject(new Error('Unknown file'));
      });

      const result = await tracker.checkForNewVersion();

      expect(result).toEqual({
        hasNewVersion: false,
        currentVersion: '1.1.0',
        lastVersion: '1.2.0',
        changeType: null,
      });
    });
  });

  describe('getVersionDiff', () => {
    it('should calculate version differences', () => {
      expect(tracker.getVersionDiff('1.0.0', '2.1.3')).toEqual({
        from: '1.0.0',
        to: '2.1.3',
        majorDiff: 1,
        minorDiff: 1,
        patchDiff: 3,
      });

      expect(tracker.getVersionDiff('1.2.3', '1.2.5')).toEqual({
        from: '1.2.3',
        to: '1.2.5',
        majorDiff: 0,
        minorDiff: 0,
        patchDiff: 2,
      });

      expect(tracker.getVersionDiff('2.0.0', '1.5.0')).toEqual({
        from: '2.0.0',
        to: '1.5.0',
        majorDiff: -1,
        minorDiff: 5,
        patchDiff: 0,
      });
    });
  });

  describe('clearSavedVersion', () => {
    it('should delete the version file', async () => {
      fs.unlink.mockResolvedValue();

      await tracker.clearSavedVersion();

      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('lastNotifiedVersion.json'));
      expect(logger.info).toHaveBeenCalledWith('[VersionTracker] Cleared saved version file');
    });

    it('should handle file not found silently', async () => {
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      fs.unlink.mockRejectedValue(error);

      await tracker.clearSavedVersion();

      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should log error for other failures', async () => {
      fs.unlink.mockRejectedValue(new Error('Permission denied'));

      await tracker.clearSavedVersion();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error clearing version file')
      );
    });
  });
});
