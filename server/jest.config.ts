import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@server/(.*)$": "<rootDir>/$1",
    "^@plugins/(.*)$": "<rootDir>/../plugins/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        diagnostics: false,
        tsconfig: {
          module: "commonjs",
          types: ["node", "jest"],
          baseUrl: "./",
          paths: {
            "@server/*": ["./*"],
            "@plugins/*": ["../plugins/*"],
          },
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          strict: false,
        },
      },
    ],
  },
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
};

export default config;
