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
    'discord.js': '<rootDir>/tests/mocks/discord.js.mock.js'
  }
};