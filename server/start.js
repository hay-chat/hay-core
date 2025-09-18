#!/usr/bin/env node

// Production entry point with module alias setup
const path = require("path");

// Register module aliases for production
require("module-alias/register");

// Add path aliases for compiled code
const moduleAlias = require("module-alias");
moduleAlias.addAliases({
  "@server": path.join(__dirname, "dist/server"),
  "@plugins": path.join(__dirname, "dist/plugins"),
});

// Start the server
require("./dist/server/main");
