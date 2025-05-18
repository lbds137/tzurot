/**
 * Mock implementation for testing profileInfoFetcher.js
 */

// Mock profile data for tests
const mockProfileData = {
  id: '12345',
  name: 'Test Display Name',
};

// Mock API endpoint
const mockEndpoint = 'https://api.example.com/profiles/test-profile';

// Mock avatar URL format
const mockAvatarUrlFormat = 'https://cdn.example.com/avatars/{id}.png';

// Create a mock Response class that matches node-fetch Response
class MockResponse {
  constructor(options = {}) {
    this.ok = options.ok || true;
    this.status = options.status || 200;
    this.statusText = options.statusText || 'OK';
    this._data = options.data;
  }

  json() {
    return Promise.resolve(this._data);
  }
}

// Helper to create a mock fetch implementation
function createMockFetch(response) {
  return jest.fn().mockImplementation(() => Promise.resolve(response));
}

// Setup success mock
function setupFetchSuccess(nodeFetchMock) {
  const response = new MockResponse({
    ok: true, 
    status: 200, 
    statusText: 'OK',
    data: mockProfileData
  });
  
  // Replace the mock implementation
  nodeFetchMock.mockImplementation(() => Promise.resolve(response));
  
  return response;
}

// Setup error response mock
function setupFetchError(nodeFetchMock, status = 404, statusText = 'Not Found') {
  const response = new MockResponse({
    ok: false,
    status,
    statusText,
    data: { error: statusText }
  });
  
  nodeFetchMock.mockImplementationOnce(() => Promise.resolve(response));
  
  return response;
}

// Setup exception mock
function setupFetchException(nodeFetchMock, error = new Error('Network error')) {
  nodeFetchMock.mockImplementationOnce(() => Promise.reject(error));
  return error;
}

// Setup empty data mock
function setupFetchEmptyData(nodeFetchMock) {
  const response = new MockResponse({
    ok: true,
    status: 200,
    statusText: 'OK',
    data: null
  });
  
  nodeFetchMock.mockImplementationOnce(() => Promise.resolve(response));
  
  return response;
}

// Setup missing name mock
function setupFetchMissingName(nodeFetchMock) {
  const data = { id: mockProfileData.id }; // Missing name
  const response = new MockResponse({
    ok: true,
    status: 200,
    statusText: 'OK',
    data
  });
  
  nodeFetchMock.mockImplementationOnce(() => Promise.resolve(response));
  
  return response;
}

// Setup missing id mock
function setupFetchMissingId(nodeFetchMock) {
  const data = { name: mockProfileData.name }; // Missing id
  const response = new MockResponse({
    ok: true,
    status: 200,
    statusText: 'OK',
    data
  });
  
  nodeFetchMock.mockImplementationOnce(() => Promise.resolve(response));
  
  return response;
}

module.exports = {
  mockProfileData,
  mockEndpoint,
  mockAvatarUrlFormat,
  createMockFetch,
  setupFetchSuccess,
  setupFetchError,
  setupFetchException,
  setupFetchEmptyData,
  setupFetchMissingName,
  setupFetchMissingId
};