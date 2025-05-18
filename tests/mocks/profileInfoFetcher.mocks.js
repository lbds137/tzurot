// Mock implementation for profileInfoFetcher
const profileInfoFetcherMock = jest.genMockFromModule('../../src/profileInfoFetcher');

// Mock cache
const profileInfoCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000;

// Mock data
const mockData = {};

// Mock fetchProfileInfo
profileInfoFetcherMock.fetchProfileInfo = jest.fn().mockImplementation(async (profileName) => {
  if (mockData.shouldFail) {
    if (mockData.failWithError) {
      throw new Error('Mock error');
    }
    return null;
  }
  
  if (mockData.profileData && mockData.profileData[profileName]) {
    return mockData.profileData[profileName];
  }
  
  return {
    id: `mock-id-${profileName}`,
    name: `Mock ${profileName}`
  };
});

// Mock getProfileAvatarUrl
profileInfoFetcherMock.getProfileAvatarUrl = jest.fn().mockImplementation(async (profileName) => {
  if (mockData.shouldFail) {
    return null;
  }
  
  const profileInfo = await profileInfoFetcherMock.fetchProfileInfo(profileName);
  if (!profileInfo || !profileInfo.id) {
    return null;
  }
  
  return `https://example.com/avatars/${profileInfo.id}.png`;
});

// Mock getProfileDisplayName
profileInfoFetcherMock.getProfileDisplayName = jest.fn().mockImplementation(async (profileName) => {
  if (mockData.shouldFail) {
    return profileName;
  }
  
  const profileInfo = await profileInfoFetcherMock.fetchProfileInfo(profileName);
  if (!profileInfo || !profileInfo.name) {
    return profileName;
  }
  
  return profileInfo.name;
});

// Helper to set mock data for tests
profileInfoFetcherMock.__setMockData = (data) => {
  Object.assign(mockData, data);
};

// Helper to reset mock data
profileInfoFetcherMock.__resetMockData = () => {
  Object.keys(mockData).forEach(key => delete mockData[key]);
};

module.exports = profileInfoFetcherMock;