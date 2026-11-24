// file-type 22 publishes its types only through package.json "exports", which
// the server's node10 module resolution does not read. Point the bare specifier
// at the declaration file; Node itself resolves the package normally.
declare module "file-type" {
  export * from "file-type/source/index.js";
}
