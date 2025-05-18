/**
 * Manual mock for node-fetch
 */

// Default mock data
const defaultMockData = {
  id: '12345',
  name: 'Test Display Name',
};

const nodeFetch = jest.fn().mockImplementation(() => 
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(defaultMockData)
  })
);

module.exports = nodeFetch;