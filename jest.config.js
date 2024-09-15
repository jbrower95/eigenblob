/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  preset: 'ts-jest',
  testEnvironment: "jsdom",
  transform: {
    "^.+.tsx?$": ["ts-jest",{}],
  },
  testMatch: [
    "**/tests/**/*.test.(ts|js)"
  ],
  testPathIgnorePatterns: ["node_modules", "lib/"]
};