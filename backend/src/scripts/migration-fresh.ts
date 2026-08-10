process.env.DB_PORT = process.env.DB_PORT || '5433';
process.env.DB_NAME = process.env.DB_NAME || 'appdb_test';
process.env.DB_USER = process.env.DB_USER || 'postgres';
process.env.DB_USERNAME = process.env.DB_USERNAME || 'postgres';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';

import { AppDataSource } from '../data-source';
import { runSeed } from '../seed';

export async function runMigrationFresh(): Promise<void> {
  console.log('[Migration Fresh] Initializing PostgreSQL connection via AppDataSource...');
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  console.log('[Migration Fresh] Running forward TypeORM migrations...');
  const migrations = await AppDataSource.runMigrations();
  console.log(`[Migration Fresh] Ran ${migrations.length} migrations successfully.`);

  console.log('[Migration Fresh] Seeding initial tenant & system data...');
  await runSeed();
  console.log('[Migration Fresh] Clean database initialization complete!');

  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  runMigrationFresh()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Migration Fresh] Error:', err);
      process.exit(1);
    });
}
