// Tests for profileInfoFetcher

// Mock dependencies first - using automatic mocks
jest.mock('node-fetch');
jest.mock('../../config');

// Import the module after mocking dependencies
const fetch = require('node-fetch');
const config = require('../../config');

describe('profileInfoFetcher', () => {
  let originalConsoleLog;
  let originalConsoleWarn;
  let originalConsoleError;
  let originalEnv;
  
  // Test data
  const mockProfileName = 'test-profile';
  const mockProfileId = '12345';
  const mockDisplayName = 'Test Display Name';
  const mockEndpoint = 'https://api.example.com/profiles/test-profile';
  const mockAvatarUrlFormat = 'https://cdn.example.com/avatars/{id}.png';
  const mockAvatarUrl = `https://cdn.example.com/avatars/${mockProfileId}.png`;
  const mockApiKey = 'test-api-key';
  
  const mockProfileData = {
    id: mockProfileId,
    name: mockDisplayName
  };
  
  beforeEach(() => {
    // Save original console methods
    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;
    
    // Mock console methods to reduce noise
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
    
    // Save original environment
    originalEnv = process.env;
    
    // Set API key in environment
    process.env = { ...process.env, SERVICE_API_KEY: mockApiKey };
    
    // Clear all mock calls
    jest.clearAllMocks();
    
    // Reset modules registry to clear cache
    jest.resetModules();
    
    // Set up mock implementations
    config.getProfileInfoEndpoint = jest.fn().mockReturnValue(mockEndpoint);
    config.getAvatarUrlFormat = jest.fn().mockReturnValue(mockAvatarUrlFormat);
    
    // Set default fetch mock
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue(mockProfileData)
    });
  });
  
  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    
    // Restore original environment
    process.env = originalEnv;
  });
  
  test('fetchProfileInfo should fetch profile info from the API', async () => {
    // Import the module under test after mocking
    const profileInfoFetcher = require('../../src/profileInfoFetcher');
    
    // Call the function
    const result = await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Verify fetch was called with the correct arguments
    expect(fetch).toHaveBeenCalledWith(mockEndpoint, {
      headers: {
        'Authorization': `Bearer ${mockApiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Verify the result
    expect(result).toEqual(mockProfileData);
  });
  
  test('fetchProfileInfo should handle API errors gracefully', async () => {
    // Set up fetch to return an error response
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });
    
    // Import the module under test after mocking
    const profileInfoFetcher = require('../../src/profileInfoFetcher');
    
    // Call the function
    const result = await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Verify error was logged
    expect(console.error).toHaveBeenCalled();
    
    // Verify null result
    expect(result).toBeNull();
  });
  
  test('fetchProfileInfo should handle fetch exceptions gracefully', async () => {
    // Set up fetch to throw an error
    fetch.mockRejectedValueOnce(new Error('Network error'));
    
    // Import the module under test after mocking
    const profileInfoFetcher = require('../../src/profileInfoFetcher');
    
    // Call the function
    const result = await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Verify error was logged
    expect(console.error).toHaveBeenCalled();
    
    // Verify null result
    expect(result).toBeNull();
  });
  
  test('fetchProfileInfo should warn when API key is not set', async () => {
    // Remove API key from environment
    delete process.env.SERVICE_API_KEY;
    
    // Import the module under test after mocking
    const profileInfoFetcher = require('../../src/profileInfoFetcher');
    
    // Call the function
    await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Verify warning was logged
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('SERVICE_API_KEY environment variable is not set')
    );
  });
  
  test('fetchProfileInfo should warn when data is empty', async () => {
    // Set up fetch to return empty data
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue(null)
    });
    
    // Import the module under test after mocking
    const profileInfoFetcher = require('../../src/profileInfoFetcher');
    
    // Call the function
    await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Verify warning was logged
    expect(console.error).toHaveBeenCalled();
  });
  
  test('fetchProfileInfo should warn when name is missing', async () => {
    // Set up fetch to return data without name
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue({ id: mockProfileId }) // Missing name
    });
    
    // Import the module under test after mocking
    const profileInfoFetcher = require('../../src/profileInfoFetcher');
    
    // Call the function
    await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Verify warning was logged
    expect(console.warn).toHaveBeenCalled();
  });
  
  test('fetchProfileInfo should cache results', async () => {
    // Import the module under test after mocking
    const profileInfoFetcher = require('../../src/profileInfoFetcher');
    
    // First call - should make API request
    await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Reset mock to verify it's not called again
    fetch.mockClear();
    
    // Second call - should use cached result
    const result = await profileInfoFetcher.fetchProfileInfo(mockProfileName);
    
    // Verify fetch was not called again
    expect(fetch).not.toHaveBeenCalled();
    
    // Verify correct data was returned from cache
    expect(result).toEqual(mockProfileData);
  });
  
  test('getProfileAvatarUrl should return avatar URL using profile ID', async () => {
    // Import the module under test after mocking
    const profileInfoFetcher = require('../../src/profileInfoFetcher');
    
    // Call the function
    const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);
    
    // Verify correct URL is returned
    expect(result).toBe(mockAvatarUrl);
  });
  
  test('getProfileAvatarUrl should return null when profile info fetch fails', async () => {
    // Set up fetch to return an error response
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });
    
    // Import the module under test after mocking
    const profileInfoFetcher = require('../../src/profileInfoFetcher');
    
    // Call the function
    const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);
    
    // Verify null result
    expect(result).toBeNull();
  });
  
  test('getProfileAvatarUrl should return null when profile ID is missing', async () => {
    // Set up fetch to return data without ID
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue({ name: mockDisplayName }) // Missing ID
    });
    
    // Import the module under test after mocking
    const profileInfoFetcher = require('../../src/profileInfoFetcher');
    
    // Call the function
    const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);
    
    // Verify null result
    expect(result).toBeNull();
  });
  
  test('getProfileDisplayName should return profile display name', async () => {
    // Import the module under test after mocking
    const profileInfoFetcher = require('../../src/profileInfoFetcher');
    
    // Call the function
    const result = await profileInfoFetcher.getProfileDisplayName(mockProfileName);
    
    // Verify correct display name is returned
    expect(result).toBe(mockDisplayName);
  });
  
  test('getProfileDisplayName should fallback to profile name when API request fails', async () => {
    // Set up fetch to return an error response
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });
    
    // Import the module under test after mocking
    const profileInfoFetcher = require('../../src/profileInfoFetcher');
    
    // Call the function
    const result = await profileInfoFetcher.getProfileDisplayName(mockProfileName);
    
    // Verify fallback to profile name
    expect(result).toBe(mockProfileName);
  });
  
  test('getProfileDisplayName should fallback to profile name when name field is missing', async () => {
    // Set up fetch to return data without name
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue({ id: mockProfileId }) // Missing name
    });
    
    // Import the module under test after mocking
    const profileInfoFetcher = require('../../src/profileInfoFetcher');
    
    // Call the function
    const result = await profileInfoFetcher.getProfileDisplayName(mockProfileName);
    
    // Verify fallback to profile name
    expect(result).toBe(mockProfileName);
  });
});