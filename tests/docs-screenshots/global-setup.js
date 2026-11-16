// Seeds the docs organization before any shot runs. The seed lives in the server workspace
// (server/scripts/seed-docs-screenshots.ts) because it needs TypeORM and the server's decorators.
const { execFileSync } = require("child_process");
const path = require("path");

module.exports = async function globalSetup() {
  execFileSync("npm", ["run", "docs:seed", "--silent"], {
    cwd: path.join(__dirname, "../../server"),
    stdio: "inherit",
  });
};
