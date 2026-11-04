module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  testMatch: ['<rootDir>/src/**/*.test.{js,jsx}'],
  clearMocks: true,
  // Jest cannot parse import.meta, so the one file that reads it is swapped.
  // Stylesheets imported by components are empty objects under test.
  moduleNameMapper: {
    '^(\\.{1,2}/)+(.*/)?lib/env$': '<rootDir>/src/lib/env.jest.cjs',
    '\\.css$': '<rootDir>/src/lib/style.jest.cjs',
  },
};
