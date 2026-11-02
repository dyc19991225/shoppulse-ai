import { loadConfig } from '../src/lib/config';
import { BOOTSTRAP_ADMIN_ID, openDb } from '../src/lib/db';
import { seedSampleData } from '../src/lib/seed';

function main(): void {
  const config = loadConfig(undefined, { checkLlmReady: false });
  const db = openDb({ dbPath: config.dbPath });
  try {
    const result = seedSampleData(db, BOOTSTRAP_ADMIN_ID);
    console.log(`Database: ${config.dbPath}`);
    console.log(
      `Seeded ${result.kbInserted} knowledge entries, ${result.productsInserted} products (existing rows skipped).`,
    );
  } finally {
    db.close();
  }
}

main();
