/**
 * Simplified node-fetch mock for backward compatibility
 * This mock prioritizes compatibility with existing tests over the new API system
 */

// Store original jest.fn for pristine mock creation
const createJestMock = () => jest.fn();

// Helper function to create a proper ArrayBuffer from Buffer
const createArrayBuffer = (data = 'mock data') => {
  const buffer = Buffer.from(data);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

// Helper function to create mock response
const createMockResponse = (options = {}) => ({
  ok: options.ok !== undefined ? options.ok : true,
  status: options.status || 200,
  statusText: options.statusText || 'OK',
  headers: {
    get: jest.fn().mockImplementation(header => {
      if (header === 'content-type') return options.contentType || 'image/jpeg';
      return 'application/json';
    }),
  },
  json: jest.fn().mockResolvedValue(options.json || {}),
  text: jest.fn().mockResolvedValue(options.text || ''),
  buffer: jest.fn().mockResolvedValue(options.buffer || Buffer.from('mock image data')),
  arrayBuffer: jest
    .fn()
    .mockResolvedValue(options.arrayBuffer || createArrayBuffer('mock image data')),
});

// Create a pure Jest mock function but with better defaults
const mockFetch = createJestMock();

// Set up default behavior that's compatible with existing tests
mockFetch.mockResolvedValue(createMockResponse());

module.exports = mockFetch;
