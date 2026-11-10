module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: ["**/*.test.ts", "**/__tests__/**/*.ts"],
  moduleNameMapper: {
    "^@server/(.*)$": "<rootDir>/$1",
    "^@plugins/(.*)$": "<rootDir>/../plugins/$1",
    // ESM-only; see tests/helpers/puppeteer-stub.ts.
    "^(puppeteer-core|@puppeteer/browsers)$": "<rootDir>/tests/helpers/puppeteer-stub.ts",
    // Its Node entry is exposed only through import/module-sync conditions.
    "^file-type$": "<rootDir>/node_modules/file-type/index.js",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: false,
          // zod 4 infers object types only with strictNullChecks; noImplicitAny keeps
          // evolving `let x = null` declarations typed the way the build sees them.
          strictNullChecks: true,
          noImplicitAny: true,
          skipLibCheck: true,
        },
        diagnostics: {
          ignoreCodes: [2345, 2322], // Ignore type mismatch errors in tests
        },
      },
    ],
    // sanitize-html's parser chain ships ESM only. Node loads it through
    // require(esm) at runtime, but Jest's CommonJS runtime cannot, so compile it.
    "^.+\\.js$": [
      "ts-jest",
      { tsconfig: { allowJs: true, esModuleInterop: true }, diagnostics: false },
    ],
  },
  transformIgnorePatterns: [
    "/node_modules/(?!(htmlparser2|domhandler|domutils|domelementtype|dom-serializer|entities|file-type|marked|strtok3|token-types|@tokenizer|@borewit|uint8array-extras)/)",
  ],
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
