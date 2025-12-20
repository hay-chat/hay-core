// JavaScript wrapper to run TypeScript global setup with tsx
const { register } = require("tsx/cjs/api");

// Register tsx to handle TypeScript files
const unregister = register();

try {
  // Import and run the TypeScript setup
  const setup = require("./global-setup.ts").default;
  module.exports = setup;
} finally {
  // Cleanup registration
  unregister();
}
