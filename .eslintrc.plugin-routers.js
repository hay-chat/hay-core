// Plugins are excluded from the main ESLint run; this one rule still applies to
// their tRPC routers, which core invokes in-process with an organization context.
const message = "Plugin routers must use pluginRouterProcedure from @server/trpc.";

module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2020, sourceType: "module" },
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: ["@server/trpc", "@server/trpc/init"].map((name) => ({
          name,
          importNames: ["publicProcedure"],
          message,
        })),
      },
    ],
  },
};
