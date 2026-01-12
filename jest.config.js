/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'bin/**/*.js',
    '!bin/postinstall.js',
    '!bin/mcp-server.js',  // MCP server needs special testing
  ],
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  testTimeout: 30000,  // CLI tests may take longer
};
