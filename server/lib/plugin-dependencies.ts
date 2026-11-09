/**
 * Guards around `npm install` for organization-supplied plugins, whose
 * package.json and npm settings are untrusted. Dependencies may only come from
 * the public registry, at versions npm resolves itself.
 */
import { existsSync, promises as fs } from "fs";
import path from "path";

/**
 * Ignores the host's npm config and the plugin's lockfile, whose `resolved`
 * URLs could point anywhere.
 */
export const CUSTOM_PLUGIN_INSTALL_COMMAND =
  "npm install --ignore-scripts --no-package-lock --no-audit --no-fund --userconfig=/dev/null --registry=https://registry.npmjs.org/";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/** Semver ranges and dist-tags: no protocol, URL, path or `user/repo` shorthand. */
const REGISTRY_SPEC = /^[\w.*^~<>=|\s-]+$/;

/** npm files that override where packages come from, deleted before installing. */
const NPM_OVERRIDE_FILES = [".npmrc", "npm-shrinkwrap.json"];

const SDK_PACKAGE = "@hay/plugin-sdk";

type PackageManifest = Record<string, unknown>;

/** Throws when a manifest would make npm fetch anything other than registry packages. */
export function assertRegistryDependencies(
  manifest: PackageManifest,
  packageDir: string,
  sdkPath: string,
): void {
  if (manifest.overrides !== undefined) {
    throw new Error("Plugin package.json may not use overrides");
  }
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (deps === undefined) continue;
    if (typeof deps !== "object" || deps === null) {
      throw new Error(`Plugin package.json has an invalid ${field} field`);
    }
    for (const [name, spec] of Object.entries(deps)) {
      if (name === SDK_PACKAGE && isLocalSdk(spec, packageDir, sdkPath)) continue;
      if (typeof spec !== "string" || !REGISTRY_SPEC.test(spec)) {
        throw new Error(`Plugin dependency "${name}" must be a version from the npm registry`);
      }
    }
  }
}

function isLocalSdk(spec: unknown, packageDir: string, sdkPath: string): boolean {
  return (
    typeof spec === "string" &&
    spec.startsWith("file:") &&
    path.resolve(packageDir, spec.slice("file:".length)) === path.resolve(sdkPath)
  );
}

/** Validate one package directory of a custom plugin and strip its npm overrides. */
export async function prepareCustomPluginInstall(
  packageDir: string,
  sdkPath: string,
): Promise<void> {
  const manifestPath = path.join(packageDir, "package.json");
  if (!existsSync(manifestPath)) return;

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as PackageManifest;
  assertRegistryDependencies(manifest, packageDir, sdkPath);
  await Promise.all(
    NPM_OVERRIDE_FILES.map((file) => fs.rm(path.join(packageDir, file), { force: true })),
  );
}
