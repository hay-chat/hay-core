module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: ["**/*.test.ts", "**/__tests__/**/*.ts"],
  moduleNameMapper: {
    "^@server/(.*)$": "<rootDir>/$1",
    "^@plugins/(.*)$": "<rootDir>/../plugins/$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: false,
          skipLibCheck: true,
        },
        diagnostics: {
          ignoreCodes: [2345, 2322], // Ignore type mismatch errors in tests
        },
      },
    ],
  },
  collectCoverageFrom: [
    "services/**/*.ts",
    "routes/**/*.ts",
    "lib/**/*.ts",
    "workers/**/*.ts",
    "!**/*.test.ts",
    "!**/node_modules/**",
    "!**/dist/**",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  verbose: true,
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  testTimeout: 60000, // 60 seconds for integration tests with longer intervals
  maxWorkers: "50%", // Use half of available CPU cores
  // Ignore these patterns
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
};
