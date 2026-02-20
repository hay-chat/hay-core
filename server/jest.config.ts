import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  moduleNameMapper: {
    "^@server/(.*)$": "<rootDir>/$1",
    "^@plugins/(.*)$": "<rootDir>/../plugins/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.json",
        // Allow JS-style test files with .ts extension
        diagnostics: false,
      },
    ],
  },
};

export default config;
