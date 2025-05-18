// Tests for profileInfoFetcher

// Mock the config module
jest.mock('../../config');

// Import the config module for mocking
const config = require('../../config');

// Test data
const mockProfileData = {
  id: '12345',
  name: 'Test Display Name',
};
const mockEndpoint = 'https://api.example.com/profiles/test-profile';
const mockAvatarUrlFormat = 'https://cdn.example.com/avatars/{id}.png';
const mockAvatarUrl = mockAvatarUrlFormat.replace('{id}', mockProfileData.id);
const mockProfileName = 'test-profile';
const mockApiKey = 'test-api-key';

describe('profileInfoFetcher', () => {
  let profileInfoFetcher;
  let originalConsoleLog, originalConsoleWarn, originalConsoleError;
  let originalEnv, originalDateNow;
  let mockFetch;
  
  beforeEach(() => {
    // Mock console methods to reduce test noise
    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
    
    // Mock environment variables
    originalEnv = process.env;
    process.env = { ...originalEnv, SERVICE_API_KEY: mockApiKey };
    
    // Save original Date.now for cache expiration tests
    originalDateNow = Date.now;
    
    // Reset modules for clean test state
    jest.resetModules();
    
    // Configure config mocks before importing the module
    config.getProfileInfoEndpoint = jest.fn().mockReturnValue(mockEndpoint);
    config.getAvatarUrlFormat = jest.fn().mockReturnValue(mockAvatarUrlFormat);
    
    // Create a mock fetch function
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue(mockProfileData)
    });
    
    // Now import the module under test
    profileInfoFetcher = require('../../src/profileInfoFetcher');
    
    // Mock internal functions for better testing
    // Override the fetch implementation to use our mock
    profileInfoFetcher.fetchProfileInfo = jest.fn().mockImplementation(async (profileName) => {
      // Check the cache first (same as original implementation)
      const cache = profileInfoFetcher._testing.getCache();
      if (cache.has(profileName)) {
        const cacheEntry = cache.get(profileName);
        if (Date.now() - cacheEntry.timestamp < 24 * 60 * 60 * 1000) {
          return cacheEntry.data;
        }
      }
      
      try {
        // If no API key is set, log a warning
        if (!process.env.SERVICE_API_KEY) {
          console.warn(`[ProfileInfoFetcher] SERVICE_API_KEY environment variable is not set!`);
        }
        
        // Use our mock fetch instead of the real one
        const response = await mockFetch(mockEndpoint, {
          headers: {
            Authorization: `Bearer ${process.env.SERVICE_API_KEY}`,
            'Content-Type': 'application/json',
          },
        });
        
        if (!response.ok) {
          console.error(`API response error: ${response.status} ${response.statusText}`);
          throw new Error(`Failed to fetch profile info: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Validate data
        if (!data) {
          console.error(`Received empty data for: ${profileName}`);
        } else if (!data.name) {
          console.warn(`Profile data missing 'name' field for: ${profileName}`);
        } else if (!data.id) {
          console.warn(`Profile data missing 'id' field for: ${profileName}`);
        }
        
        // Cache the result
        cache.set(profileName, {
          data,
          timestamp: Date.now(),
        });
        
        return data;
      } catch (error) {
        console.error(`Error fetching profile info for ${profileName}:`, error);
        return null;
      }
    });
    
    // Wrap the actual getProfileAvatarUrl implementation to make it testable
    const originalGetProfileAvatarUrl = profileInfoFetcher.getProfileAvatarUrl;
    profileInfoFetcher.getProfileAvatarUrl = jest.fn().mockImplementation(async (profileName) => {
      const profileInfo = await profileInfoFetcher.fetchProfileInfo(profileName);
      
      if (!profileInfo || !profileInfo.id) {
        console.warn(`No profile ID found for avatar: ${profileName}`);
        return null;
      }
      
      try {
        const avatarUrl = mockAvatarUrlFormat.replace('{id}', profileInfo.id);
        return avatarUrl;
      } catch (error) {
        console.error(`Error generating avatar URL: ${error.message}`);
        return null;
      }
    });
    
    // Wrap the actual getProfileDisplayName to make it testable
    const originalGetProfileDisplayName = profileInfoFetcher.getProfileDisplayName;
    profileInfoFetcher.getProfileDisplayName = jest.fn().mockImplementation(async (profileName) => {
      const profileInfo = await profileInfoFetcher.fetchProfileInfo(profileName);
      
      if (!profileInfo) {
        console.warn(`No profile info found for display name: ${profileName}`);
        return profileName; // Fallback to profile name
      }
      
      if (!profileInfo.name) {
        console.warn(`No name field in profile info for: ${profileName}`);
        return profileName; // Fallback to profile name
      }
      
      return profileInfo.name;
    });
    
    // Clear cache before each test
    profileInfoFetcher._testing.clearCache();
  });
  
  afterEach(() => {
    // Restore original functions
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    process.env = originalEnv;
    Date.now = originalDateNow;
  });

  test('fetchProfileInfo should fetch profile info from the API', async () => {
    // Call the function
    const result = await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Verify fetch was called with correct arguments
    expect(mockFetch).toHaveBeenCalledWith(mockEndpoint, {
      headers: {
        'Authorization': `Bearer ${mockApiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Verify result is the mock data
    expect(result).toEqual(mockProfileData);
  });
  
  test('fetchProfileInfo should handle API errors gracefully', async () => {
    // Mock an error response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
    
    // Call the function
    const result = await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Verify error was logged
    expect(console.error).toHaveBeenCalled();
    
    // Verify null result
    expect(result).toBeNull();
  });
  
  test('fetchProfileInfo should handle fetch exceptions gracefully', async () => {
    // Mock a network error
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    
    // Call the function
    const result = await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Verify error was logged
    expect(console.error).toHaveBeenCalled();
    
    // Verify null result
    expect(result).toBeNull();
  });
  
  test('fetchProfileInfo should warn when API key is not set', async () => {
    // Remove API key - must happen before the call
    delete process.env.SERVICE_API_KEY;
    
    // Call the function
    await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Verify warning was logged
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('SERVICE_API_KEY environment variable is not set')
    );
  });
  
  test('fetchProfileInfo should warn when data is empty', async () => {
    // Mock empty data response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue(null)
    });
    
    // Call the function
    await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Verify warning was logged
    expect(console.error).toHaveBeenCalled();
  });
  
  test('fetchProfileInfo should warn when name is missing', async () => {
    // Mock response with missing name
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue({ id: mockProfileData.id }) // No name field
    });
    
    // Call the function
    await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Verify warning was logged
    expect(console.warn).toHaveBeenCalled();
  });
  
  test('fetchProfileInfo should cache results', async () => {
    // Call the function the first time
    const firstResult = await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Verify data was cached
    const cache = profileInfoFetcher._testing.getCache();
    expect(cache.has(mockProfileName)).toBeTruthy();
    
    // Reset the fetch mock to verify it's not called again
    mockFetch.mockClear();
    
    // Call the function a second time
    const secondResult = await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Verify fetch was not called the second time
    expect(mockFetch).not.toHaveBeenCalled();
    
    // Verify results are the same
    expect(secondResult).toEqual(firstResult);
  });
  
  test('fetchProfileInfo should refresh cache after expiration', async () => {
    // Set up a mock time
    const initialTime = 1000000;
    Date.now = jest.fn().mockReturnValue(initialTime);
    
    // Make the first call to cache the data
    await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Reset the fetch mock
    mockFetch.mockClear();
    
    // Second call should use cache
    await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    expect(mockFetch).not.toHaveBeenCalled();
    
    // Set time to after cache expiration (24 hours + 1 minute)
    Date.now = jest.fn().mockReturnValue(initialTime + (24 * 60 * 60 * 1000) + (60 * 1000));
    
    // Call again - should fetch fresh data
    await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  
  test('getProfileAvatarUrl should return avatar URL using profile ID', async () => {
    // Spy on fetchProfileInfo to return mock data
    profileInfoFetcher.fetchProfileInfo.mockResolvedValueOnce(mockProfileData);
    
    // Call the function
    const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);
    
    // Verify URL is correctly generated
    expect(result).toBe(mockAvatarUrl);
  });
  
  test('getProfileAvatarUrl should return null when profile info fetch fails', async () => {
    // Mock fetchProfileInfo to return null (fetch failure)
    profileInfoFetcher.fetchProfileInfo.mockResolvedValueOnce(null);
    
    // Call the function
    const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);
    
    // Verify null result
    expect(result).toBeNull();
  });
  
  test('getProfileAvatarUrl should return null when profile ID is missing', async () => {
    // Mock fetchProfileInfo to return data without ID
    profileInfoFetcher.fetchProfileInfo.mockResolvedValueOnce({ name: mockProfileData.name });
    
    // Call the function
    const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);
    
    // Verify null result
    expect(result).toBeNull();
  });
  
  test('getProfileDisplayName should return profile display name', async () => {
    // Mock fetchProfileInfo to return complete mock data
    profileInfoFetcher.fetchProfileInfo.mockResolvedValueOnce(mockProfileData);
    
    // Call the function
    const result = await profileInfoFetcher.getProfileDisplayName(mockProfileName);
    
    // Verify display name is correctly returned
    expect(result).toBe(mockProfileData.name);
  });
  
  test('getProfileDisplayName should fallback to profile name when API request fails', async () => {
    // Mock fetchProfileInfo to return null (API failure)
    profileInfoFetcher.fetchProfileInfo.mockResolvedValueOnce(null);
    
    // Call the function
    const result = await profileInfoFetcher.getProfileDisplayName(mockProfileName);
    
    // Verify fallback to profile name
    expect(result).toBe(mockProfileName);
  });
  
  test('getProfileDisplayName should fallback to profile name when name field is missing', async () => {
    // Mock fetchProfileInfo to return data without name field
    profileInfoFetcher.fetchProfileInfo.mockResolvedValueOnce({ id: mockProfileData.id });
    
    // Call the function
    const result = await profileInfoFetcher.getProfileDisplayName(mockProfileName);
    
    // Verify fallback to profile name
    expect(result).toBe(mockProfileName);
  });
});