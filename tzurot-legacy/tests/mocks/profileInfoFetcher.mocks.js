/**
 * Legacy Profile Info Fetcher Mocks - Deprecated
 *
 * This file is kept for backward compatibility but should not be used in new tests.
 * Use the new consolidated mock system at tests/__mocks__/index.js instead.
 *
 * @deprecated Use require('../../__mocks__').api instead
 */

const { createApiEnvironment } = require('../__mocks__/api');

// Create default API environment for legacy compatibility
const defaultApi = createApiEnvironment();

/**
 * Legacy function to setup fetch success
 * @deprecated Use apiEnv.fetch.setResponse() instead
 */
function setupFetchSuccess(mockFetch = global.fetch) {
  console.warn(
    'DEPRECATED: setupFetchSuccess is deprecated. Use the consolidated mock system instead.'
  );

  if (mockFetch && typeof mockFetch.mockResolvedValue === 'function') {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: '12345',
          name: 'Mock Profile',
        }),
    });
  }
}

/**
 * Legacy function to setup fetch error
 * @deprecated Use apiEnv.fetch.setError() instead
 */
function setupFetchError(mockFetch = global.fetch, error = 'Network error') {
  console.warn(
    'DEPRECATED: setupFetchError is deprecated. Use the consolidated mock system instead.'
  );

  if (mockFetch && typeof mockFetch.mockRejectedValue === 'function') {
    mockFetch.mockRejectedValue(new Error(error));
  }
}

module.exports = {
  setupFetchSuccess,
  setupFetchError,

  // Warn about deprecation
  _deprecated: true,
  _message: 'This mock is deprecated. Use the consolidated system at tests/__mocks__/index.js',
};
