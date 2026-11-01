import { hashPassword } from '../src/lib/auth/password';

async function main(): Promise<void> {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: npm run hash-password -- \'your-password\'');
    process.exit(1);
  }

  const hash = await hashPassword(password);
  console.log(hash);
  console.error('\nPut this value in ADMIN_PASSWORD_HASH (never commit it).');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
