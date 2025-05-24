/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  verbose: true,
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.js',
    '!**/node_modules/**',
    '!**/tests/**'
  ],
  coverageDirectory: 'coverage',
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  // Mock Discord.js to avoid real API calls
  moduleNameMapper: {
    'discord.js': '<rootDir>/tests/__mocks__/discord.js'
  },
  // Use Babel to transform code
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(chalk|inquirer)/)'
  ],
  // Timeout and open handles configuration
  testTimeout: 5000, // 5 seconds default - prevents long-running tests
  detectOpenHandles: true,
  forceExit: true,
  // Setup files to handle global test environment
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js']
};