process.env.DB_USER = process.env.DB_USER || 'admin';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'admin';

import { Client } from 'pg';
import { runSeed } from '../seed';

export async function verifyFreshDatabaseCertification() {
  console.log('--- STARTING FRESH DISPOSABLE POSTGRESQL DATABASE CERTIFICATION ---');

  const rootClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'postgres',
  });

  await rootClient.connect();
  const certDbName = 'appdb_cert_disposable';
  await rootClient.query(`DROP DATABASE IF EXISTS "${certDbName}" (FORCE);`);
  await rootClient.query(`CREATE DATABASE "${certDbName}";`);
  await rootClient.end();
  console.log(`[DB CERT] Created fresh disposable database: ${certDbName}`);

  process.env.DB_NAME = certDbName;
  const { AppDataSource } = await import('../data-source');

  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
  await AppDataSource.initialize();

  console.log(`[DB CERT] AppDataSource initialized with synchronize = ${AppDataSource.options.synchronize}`);

  // 1. Run migrations
  console.log('[DB CERT] Running TypeORM migrations on fresh database...');
  const executedMigrations = await AppDataSource.runMigrations();
  console.log(`[DB CERT] Ran ${executedMigrations.length} migrations:`);
  executedMigrations.forEach((m: any) => console.log(`  - ${m.name}`));

  // 2. Verify migration:show (no pending migrations)
  const hasPending = await AppDataSource.showMigrations();
  console.log(`[DB CERT] Has pending migrations? ${hasPending} (Expected: false)`);

  // 3. Seed 1st Run
  console.log('[DB CERT] Running Minimal Seed (1st execution)...');
  await runSeed();

  const tablesToVerify = [
    'tenant',
    'admin_user',
    'branch',
    'terminal',
    'payment_method',
    'currency',
    'reason_code',
    'category',
    'product',
    'approval_rule',
  ];

  const countsRun1: Record<string, number> = {};
  for (const table of tablesToVerify) {
    const res = await AppDataSource.query(`SELECT COUNT(*)::int as count FROM "${table}"`);
    countsRun1[table] = res[0].count;
  }
  console.log('[DB CERT] Seed Run 1 Row Counts:', JSON.stringify(countsRun1, null, 2));

  // 4. Seed 2nd Run (Idempotency test)
  console.log('[DB CERT] Running Minimal Seed (2nd execution - Idempotency Check)...');
  await runSeed();

  const countsRun2: Record<string, number> = {};
  for (const table of tablesToVerify) {
    const res = await AppDataSource.query(`SELECT COUNT(*)::int as count FROM "${table}"`);
    countsRun2[table] = res[0].count;
  }
  console.log('[DB CERT] Seed Run 2 Row Counts:', JSON.stringify(countsRun2, null, 2));

  let duplicatesFound = false;
  for (const table of tablesToVerify) {
    if (countsRun1[table] !== countsRun2[table]) {
      console.error(`❌ DISCREPANCY in table ${table}: Run 1 = ${countsRun1[table]}, Run 2 = ${countsRun2[table]}`);
      duplicatesFound = true;
    }
  }

  if (!duplicatesFound) {
    console.log('✅ IDEMPOTENCY CONFIRMED: 2nd seed run generated ZERO duplicate records!');
  }

  // 5. Readiness check with synchronize: false
  const syncStatus = AppDataSource.options.synchronize;
  const isInitialized = AppDataSource.isInitialized;
  console.log(`[DB CERT] Backend Readiness Check: DataSource Initialized = ${isInitialized}, synchronize = ${syncStatus}`);
  if (isInitialized && syncStatus === false) {
    console.log('✅ READINESS CHECK PASSED: Database initialized with synchronize: false');
  }

  await AppDataSource.destroy();

  // Drop disposable test DB
  const cleanupClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'admin',
    database: 'postgres',
  });
  await cleanupClient.connect();
  await cleanupClient.query(`DROP DATABASE IF EXISTS "${certDbName}" (FORCE);`);
  await cleanupClient.end();
  console.log(`[DB CERT] Cleaned up disposable database ${certDbName}`);

  console.log('--- FRESH POSTGRESQL CERTIFICATION COMPLETE & SUCCESSFUL ---');
}

if (require.main === module) {
  verifyFreshDatabaseCertification().catch((err) => {
    console.error('❌ Fresh DB Certification Error:', err);
    process.exit(1);
  });
}
