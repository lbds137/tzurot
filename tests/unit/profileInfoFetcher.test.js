// Import the original module for spying
const profileInfoFetcher = require('../../src/profileInfoFetcher');

// Mock dependencies
jest.mock('node-fetch');
jest.mock('../../config');

// Import mocks
const fetch = require('node-fetch');
const config = require('../../config');

// Mock console methods
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

describe('profileInfoFetcher', () => {
  // Set up common test variables
  const mockProfileName = 'test-profile';
  const mockProfileId = '12345';
  const mockDisplayName = 'Test Profile';
  const mockApiKey = 'mock-api-key';
  const mockEndpoint = 'https://api.example.com/profiles/test-profile';
  const mockAvatarUrlFormat = 'https://cdn.example.com/avatars/{id}.png';
  const mockAvatarUrl = `https://cdn.example.com/avatars/${mockProfileId}.png`;
  
  // Mock response data
  const mockProfileData = {
    id: mockProfileId,
    name: mockDisplayName,
    additional: 'data'
  };

  // Save the original process.env
  const originalEnv = process.env;
  
  // Save the original Date.now
  const originalDateNow = Date.now;

  beforeEach(() => {
    // Clear all mock calls
    jest.clearAllMocks();
    
    // Mock console methods to prevent noise
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
    
    // Set up process.env with the mock API key
    process.env = { ...originalEnv, SERVICE_API_KEY: mockApiKey };
    
    // Mock config functions
    config.getProfileInfoEndpoint.mockReturnValue(mockEndpoint);
    config.getAvatarUrlFormat.mockReturnValue(mockAvatarUrlFormat);
    
    // Mock Date.now to control cache expiration tests
    Date.now = jest.fn(() => 1000);
    
    // Default successful fetch implementation
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(mockProfileData)
    });
    
    // Manually clear the module's internal cache
    const moduleCache = require.cache[require.resolve('../../src/profileInfoFetcher')];
    if (moduleCache) {
      moduleCache.exports.profileInfoCache = new Map();
    }
  });

  afterEach(() => {
    // Restore original functions
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    Date.now = originalDateNow;
    
    // Restore original environment
    process.env = originalEnv;
  });
  
  // Test fetchProfileInfo
  describe('fetchProfileInfo', () => {
    test('should fetch profile info from the API', async () => {
      // Spy on fetchProfileInfo
      const fetchProfileInfoSpy = jest.spyOn(profileInfoFetcher, 'fetchProfileInfo');
      
      // Call the function
      const result = await profileInfoFetcher.fetchProfileInfo(mockProfileName);
      
      // Verify correct fetch call and parameters
      expect(fetch).toHaveBeenCalledWith(mockEndpoint, {
        headers: {
          'Authorization': `Bearer ${mockApiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      // Verify the result matches the mock data
      expect(result).toEqual(mockProfileData);
      
      // Restore original implementation
      fetchProfileInfoSpy.mockRestore();
    });
    
    test('should handle API errors gracefully', async () => {
      // Mock error response
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });
      
      const result = await profileInfoFetcher.fetchProfileInfo(mockProfileName);
      
      // Verify null return value on error
      expect(result).toBeNull();
      
      // Verify error was logged
      expect(console.error).toHaveBeenCalled();
    });
    
    test('should handle fetch exceptions gracefully', async () => {
      // Mock network error
      fetch.mockRejectedValueOnce(new Error('Network error'));
      
      const result = await profileInfoFetcher.fetchProfileInfo(mockProfileName);
      
      // Verify null return value on exception
      expect(result).toBeNull();
      
      // Verify error was logged
      expect(console.error).toHaveBeenCalled();
    });
    
    test('should warn when API key is not set', async () => {
      // Temporarily unset the API key
      delete process.env.SERVICE_API_KEY;
      
      // Call the function (will still make API call)
      await profileInfoFetcher.fetchProfileInfo(mockProfileName);
      
      // Verify warning was logged
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('SERVICE_API_KEY environment variable is not set')
      );
    });
  });
  
  // Test getProfileAvatarUrl
  describe('getProfileAvatarUrl', () => {
    test('should return formatted avatar URL using profile ID', async () => {
      // Mock fetchProfileInfo to control test isolation
      const fetchProfileInfoSpy = jest.spyOn(profileInfoFetcher, 'fetchProfileInfo')
        .mockResolvedValue(mockProfileData);
      
      const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);
      
      // Verify correct URL formatting
      expect(result).toBe(mockAvatarUrl);
      
      // Verify fetchProfileInfo was called
      expect(fetchProfileInfoSpy).toHaveBeenCalledWith(mockProfileName);
      
      // Restore original implementation
      fetchProfileInfoSpy.mockRestore();
    });
    
    test('should return null when profile info cannot be fetched', async () => {
      // Mock fetchProfileInfo to return null (API error)
      const fetchProfileInfoSpy = jest.spyOn(profileInfoFetcher, 'fetchProfileInfo')
        .mockResolvedValue(null);
      
      const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);
      
      // Verify null result when profile info is unavailable
      expect(result).toBeNull();
      
      // Restore original implementation
      fetchProfileInfoSpy.mockRestore();
    });
    
    test('should return null when profile ID is missing', async () => {
      // Mock fetchProfileInfo to return profile without ID
      const fetchProfileInfoSpy = jest.spyOn(profileInfoFetcher, 'fetchProfileInfo')
        .mockResolvedValue({ name: mockDisplayName }); // No ID field
      
      const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);
      
      // Verify null result when ID is missing
      expect(result).toBeNull();
      
      // Restore original implementation
      fetchProfileInfoSpy.mockRestore();
    });
  });
  
  // Test getProfileDisplayName
  describe('getProfileDisplayName', () => {
    test('should return the profile display name', async () => {
      // Mock fetchProfileInfo to control test isolation
      const fetchProfileInfoSpy = jest.spyOn(profileInfoFetcher, 'fetchProfileInfo')
        .mockResolvedValue(mockProfileData);
      
      const result = await profileInfoFetcher.getProfileDisplayName(mockProfileName);
      
      // Verify correct display name is returned
      expect(result).toBe(mockDisplayName);
      
      // Verify fetchProfileInfo was called
      expect(fetchProfileInfoSpy).toHaveBeenCalledWith(mockProfileName);
      
      // Restore original implementation
      fetchProfileInfoSpy.mockRestore();
    });
    
    test('should fallback to profile name when API request fails', async () => {
      // Mock fetchProfileInfo to return null (API error)
      const fetchProfileInfoSpy = jest.spyOn(profileInfoFetcher, 'fetchProfileInfo')
        .mockResolvedValue(null);
      
      const result = await profileInfoFetcher.getProfileDisplayName(mockProfileName);
      
      // Verify fallback to profile name when API fails
      expect(result).toBe(mockProfileName);
      
      // Restore original implementation
      fetchProfileInfoSpy.mockRestore();
    });
    
    test('should fallback to profile name when name field is missing', async () => {
      // Mock fetchProfileInfo to return profile without name
      const fetchProfileInfoSpy = jest.spyOn(profileInfoFetcher, 'fetchProfileInfo')
        .mockResolvedValue({ id: mockProfileId }); // No name field
      
      const result = await profileInfoFetcher.getProfileDisplayName(mockProfileName);
      
      // Verify fallback to profile name when name is missing
      expect(result).toBe(mockProfileName);
      
      // Restore original implementation
      fetchProfileInfoSpy.mockRestore();
    });
  });
});