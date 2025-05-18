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

// Setup success mock
function setupFetchSuccess(nodeFetch) {
  nodeFetch.mockImplementation(() => 
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(mockProfileData)
    })
  );
}

// Setup error response mock
function setupFetchError(nodeFetch, status = 404, statusText = 'Not Found') {
  nodeFetch.mockImplementationOnce(() => 
    Promise.resolve({
      ok: false,
      status,
      statusText
    })
  );
}

// Setup exception mock
function setupFetchException(nodeFetch, error = new Error('Network error')) {
  nodeFetch.mockImplementationOnce(() => 
    Promise.reject(error)
  );
}

// Setup empty data mock
function setupFetchEmptyData(nodeFetch) {
  nodeFetch.mockImplementationOnce(() => 
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(null)
    })
  );
}

// Setup missing name mock
function setupFetchMissingName(nodeFetch) {
  nodeFetch.mockImplementationOnce(() => 
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ id: mockProfileData.id }) // Missing name
    })
  );
}

// Setup missing id mock
function setupFetchMissingId(nodeFetch) {
  nodeFetch.mockImplementationOnce(() => 
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ name: mockProfileData.name }) // Missing id
    })
  );
}

module.exports = {
  mockProfileData,
  mockEndpoint,
  mockAvatarUrlFormat,
  setupFetchSuccess,
  setupFetchError,
  setupFetchException,
  setupFetchEmptyData,
  setupFetchMissingName,
  setupFetchMissingId
};