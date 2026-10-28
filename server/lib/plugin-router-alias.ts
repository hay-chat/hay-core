import path from "path";
import { register } from "tsconfig-paths";

/**
 * Plugin tRPC routers (`plugins/<x>/dist/router.cjs`) are bundled by esbuild
 * with `@server/*` left external, on purpose: they must share the server's tRPC
 * `t` instance, repositories and other singletons rather than carry copies.
 *
 * Under ts-node / tsx the `@server/*` path alias is resolved at runtime, so the
 * router's bare `require("@server/trpc")` works. In production the server runs
 * as plain `node dist/main.js`: `tsc-alias` rewrote the aliases inside
 * server/dist only, and nothing resolves them for files outside it — the router
 * fails with "Cannot find module '@server/trpc'".
 *
 * This registers `@server/*` → the server's own root (server/ in dev,
 * server/dist in prod, derived from this file's location) so the router
 * resolves to the very module files the server has already loaded.
 * Idempotent; returns a function that undoes the registration (for tests).
 */
let unregister: (() => void) | null = null;

export function registerServerAliasForPlugins(
  serverRoot: string = path.resolve(__dirname, ".."),
): () => void {
  if (!unregister) {
    unregister = register({
      baseUrl: serverRoot,
      paths: { "@server/*": ["./*"] },
      addMatchAll: false,
    });
  }
  return () => {
    unregister?.();
    unregister = null;
  };
}
