import { loadConfig } from '../src/lib/config';
import { openDb } from '../src/lib/db';
import { seedSampleData } from '../src/lib/seed';

function main(): void {
  const config = loadConfig();
  const db = openDb({ dbPath: config.dbPath });
  try {
    const result = seedSampleData(db);
    console.log(`Database: ${config.dbPath}`);
    console.log(
      `Seeded ${result.kbInserted} knowledge entries, ${result.productsInserted} products (existing rows skipped).`,
    );
  } finally {
    db.close();
  }
}

main();
