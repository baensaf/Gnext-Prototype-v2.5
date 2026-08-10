process.env.DB_USER = process.env.DB_USER || 'admin';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'admin';

import { Client } from 'pg';

export async function verifyFreshDatabaseCertification() {
  console.log('--- STARTING FRESH DISPOSABLE POSTGRESQL DATABASE CERTIFICATION ---');

  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || '5432', 10);
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const certDbName = 'appdb_cert_disposable';

  const rootClient = new Client({
    host,
    port,
    user,
    password,
    database: 'postgres',
  });

  await rootClient.connect();
  await rootClient.query(`DROP DATABASE IF EXISTS "${certDbName}" (FORCE);`);
  await rootClient.query(`CREATE DATABASE "${certDbName}";`);
  await rootClient.end();
  console.log(`[DB CERT] Created fresh disposable database: ${certDbName}`);

  // Set environment variable BEFORE importing AppDataSource or seed
  process.env.DB_NAME = certDbName;

  let appDataSourceRef: any = null;

  try {
    const { AppDataSource } = await import('../data-source');
    const { runSeed } = await import('../seed');
    appDataSourceRef = AppDataSource;

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
    if (hasPending) {
      throw new Error('[DB CERT] Verification failed: Pending migrations detected after running migrations!');
    }

    // 3. Verify real existing required tables in database schema
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

    console.log('[DB CERT] Verifying real existing required schema tables...');
    for (const table of tablesToVerify) {
      const res = await AppDataSource.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      if (!res || res.length === 0) {
        throw new Error(`[DB CERT] Required table "${table}" does not exist in schema!`);
      }
    }
    console.log(`✅ SCHEMA VERIFICATION PASSED: All ${tablesToVerify.length} required tables exist in database.`);

    // 4. Seed 1st Run
    console.log('[DB CERT] Running Minimal Seed (1st execution)...');
    await runSeed();

    const countsRun1: Record<string, number> = {};
    for (const table of tablesToVerify) {
      const res = await AppDataSource.query(`SELECT COUNT(*)::int as count FROM "${table}"`);
      countsRun1[table] = res[0].count;
    }
    console.log('[DB CERT] Seed Run 1 Row Counts:', JSON.stringify(countsRun1, null, 2));

    // 5. Seed 2nd Run (Idempotency Check)
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

    if (duplicatesFound) {
      throw new Error('[DB CERT] Idempotency verification failed: Duplicate records detected on 2nd seed run!');
    }
    console.log('✅ IDEMPOTENCY CONFIRMED: 2nd seed run generated ZERO duplicate records!');

    // 6. Readiness check with synchronize: false
    const syncStatus = AppDataSource.options.synchronize;
    const isInitialized = AppDataSource.isInitialized;
    console.log(`[DB CERT] Backend Readiness Check: DataSource Initialized = ${isInitialized}, synchronize = ${syncStatus}`);
    if (!isInitialized || syncStatus !== false) {
      throw new Error(`[DB CERT] Readiness check failed: Initialized=${isInitialized}, synchronize=${syncStatus}`);
    }
    console.log('✅ READINESS CHECK PASSED: Database initialized with synchronize: false');

    console.log('--- FRESH POSTGRESQL CERTIFICATION COMPLETE & SUCCESSFUL ---');
  } finally {
    if (appDataSourceRef && appDataSourceRef.isInitialized) {
      await appDataSourceRef.destroy();
    }

    // Drop disposable test DB
    try {
      const cleanupClient = new Client({
        host,
        port,
        user,
        password,
        database: 'postgres',
      });
      await cleanupClient.connect();
      await cleanupClient.query(`DROP DATABASE IF EXISTS "${certDbName}" (FORCE);`);
      await cleanupClient.end();
      console.log(`[DB CERT] Cleaned up disposable database ${certDbName}`);
    } catch (cleanupErr) {
      console.error(`⚠️ Failed to clean up database ${certDbName}:`, cleanupErr);
    }
  }
}

if (require.main === module) {
  verifyFreshDatabaseCertification().catch((err) => {
    console.error('❌ Fresh DB Certification Error:', err);
    process.exit(1);
  });
}
