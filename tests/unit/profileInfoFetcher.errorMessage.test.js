/**
 * Tests for getProfileErrorMessage function in profileInfoFetcher
 */

// Mock dependencies
jest.mock('../../src/logger');
jest.mock('../../src/core/api', () => ({
  ProfileInfoFetcher: jest.fn().mockImplementation(() => ({
    fetchProfileInfo: jest.fn(),
    clearCache: jest.fn(),
    deleteFromCache: jest.fn(),
    getCache: jest.fn().mockReturnValue(new Map()),
  })),
}));

const logger = require('../../src/logger');
const { ProfileInfoFetcher } = require('../../src/core/api');
const { getProfileErrorMessage, _testing } = require('../../src/profileInfoFetcher');

describe('Profile Info Fetcher - Error Messages', () => {
  let mockFetcher;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset the fetcher
    _testing.resetFetcher();

    // Get the mock fetcher instance
    mockFetcher = new ProfileInfoFetcher();
    ProfileInfoFetcher.mockReturnValue(mockFetcher);

    // Set up logger mocks
    logger.info = jest.fn();
    logger.debug = jest.fn();
    logger.warn = jest.fn();
    logger.error = jest.fn();
  });

  describe('getProfileErrorMessage', () => {
    it('should return error message when profile has one', async () => {
      const mockProfileData = {
        name: 'Test Personality',
        avatar: 'https://example.com/avatar.png',
        error_message:
          '*laughs darkly* The mysteries of existence sometimes exceed even my grasp... ||*(an error has occurred)*||',
      };

      mockFetcher.fetchProfileInfo.mockResolvedValue(mockProfileData);

      const result = await getProfileErrorMessage('test-personality', 'user-123');

      expect(result).toBe(mockProfileData.error_message);
      expect(mockFetcher.fetchProfileInfo).toHaveBeenCalledWith('test-personality', 'user-123');
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[ProfileInfoFetcher] Found error message for test-personality:')
      );
    });

    it('should return null when profile has no error message', async () => {
      const mockProfileData = {
        name: 'Test Personality',
        avatar: 'https://example.com/avatar.png',
        // No error_message field
      };

      mockFetcher.fetchProfileInfo.mockResolvedValue(mockProfileData);

      const result = await getProfileErrorMessage('test-personality');

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        '[ProfileInfoFetcher] No error_message found for profile: test-personality'
      );
    });

    it('should return null when profile is not found', async () => {
      mockFetcher.fetchProfileInfo.mockResolvedValue(null);

      const result = await getProfileErrorMessage('unknown-personality');

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        '[ProfileInfoFetcher] No profile info found for error message: unknown-personality'
      );
    });

    it('should handle errors gracefully', async () => {
      mockFetcher.fetchProfileInfo.mockRejectedValue(new Error('Network error'));

      const result = await getProfileErrorMessage('test-personality');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        '[ProfileInfoFetcher] Error getting error message: Network error'
      );
    });

    it('should handle empty error messages', async () => {
      const mockProfileData = {
        name: 'Test Personality',
        error_message: '', // Empty string
      };

      mockFetcher.fetchProfileInfo.mockResolvedValue(mockProfileData);

      const result = await getProfileErrorMessage('test-personality');

      // Empty string is falsy, so it should return null
      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        '[ProfileInfoFetcher] No error_message found for profile: test-personality'
      );
    });

    it('should log the first 100 characters of error message', async () => {
      const longErrorMessage = 'A'.repeat(150) + ' ||*(an error has occurred)*||';
      const mockProfileData = {
        name: 'Test Personality',
        error_message: longErrorMessage,
      };

      mockFetcher.fetchProfileInfo.mockResolvedValue(mockProfileData);

      await getProfileErrorMessage('test-personality');

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining(
          '[ProfileInfoFetcher] Found error message for test-personality: ' +
            'A'.repeat(100) +
            '...'
        )
      );
    });

    it('should pass userId when provided', async () => {
      const mockProfileData = {
        error_message: 'Error occurred!',
      };

      mockFetcher.fetchProfileInfo.mockResolvedValue(mockProfileData);

      await getProfileErrorMessage('test-personality', 'user-456');

      expect(mockFetcher.fetchProfileInfo).toHaveBeenCalledWith('test-personality', 'user-456');
    });
  });
});
