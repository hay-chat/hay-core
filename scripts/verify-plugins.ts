import { AppDataSource } from '../server/database/data-source';

(async () => {
  await AppDataSource.initialize();

  const plugins = await AppDataSource.query(`
    SELECT plugin_id, name, version, source_type
    FROM plugin_registry
    WHERE source_type = 'core'
    ORDER BY plugin_id
  `);

  console.log(`\n📦 Found ${plugins.length} core plugins in database:\n`);
  plugins.forEach((p: any) => {
    console.log(`  ✓ ${p.plugin_id.padEnd(35)} | ${p.name.padEnd(20)} | v${p.version}`);
  });

  await AppDataSource.destroy();
})();
