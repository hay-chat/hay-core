#!/usr/bin/env node
/**
 * Re-encrypts stored secrets under the current key after changing
 * PLUGIN_ENCRYPTION_KEYS. Lists counts unless --apply is passed; safe to run
 * again. Exits non-zero while any value can't be opened: keep the old key until
 * it exits zero.
 *
 *   npm run secrets:rotate-encryption-key            # dry run
 *   npm run secrets:rotate-encryption-key -- --apply
 */
import { AppDataSource } from "../database/data-source";
import { rotateStoredSecrets } from "../services/encryption-rotation.service";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await AppDataSource.initialize();

  const report = await rotateStoredSecrets({ apply });
  for (const failure of report.failures) {
    console.error(`cannot decrypt: ${failure}`);
  }
  console.log(
    `${apply ? "Done" : "Dry run"}: ${report.rotated} re-encrypted, ${report.encrypted} plaintext credentials encrypted, ${report.failed} unreadable`,
  );
  await AppDataSource.destroy();
  process.exit(report.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
