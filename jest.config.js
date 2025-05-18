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
    'discord.js': '<rootDir>/tests/mocks/discord.js.mock.js'
  },
  // Use Babel to transform code
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(chalk|inquirer)/)'
  ]
};