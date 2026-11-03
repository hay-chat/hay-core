/**
 * A plugin's registry checksum packs two fingerprints into the existing
 * varchar(64) `checksum` column, so a source edit only triggers a rebuild and
 * only a dependency change triggers an `npm install`:
 *
 *   chars  0-31  source: every .ts/.js file outside node_modules and dist
 *   chars 32-63  deps:   dependency fields of package.json and mcp/package.json
 *
 * Rows written before this format hold one full sha256, so both halves differ
 * once and the plugin is reinstalled and rebuilt one time.
 */
const HALF = 32;

export function packPluginChecksum(sourceHash: string, depsHash: string): string {
  return sourceHash.slice(0, HALF) + depsHash.slice(0, HALF);
}

export function pluginChecksumChanges(
  previous: string | null | undefined,
  next: string,
): { source: boolean; deps: boolean } {
  return {
    source: previous?.slice(0, HALF) !== next.slice(0, HALF),
    deps: previous?.slice(HALF) !== next.slice(HALF),
  };
}
