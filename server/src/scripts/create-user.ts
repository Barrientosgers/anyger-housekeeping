import readline from 'node:readline';
import { hash } from '@node-rs/argon2';
import { createPool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';

// Usage: npm run user:create -w server -- someone@example.com [admin|staff]
// The password is typed at a hidden prompt, so it never lands in shell history or logs.
const [email, role = 'staff'] = process.argv.slice(2);
if (!email || !['admin', 'staff'].includes(role)) {
  console.error('Usage: npm run user:create -w server -- <email> [admin|staff]');
  process.exit(1);
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    out._writeToOutput = (s) => {
      if (s.includes(question)) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const password = await promptHidden('Password (min 12 characters): ');
if (password.length < 12) {
  console.error('Password must be at least 12 characters.');
  process.exit(1);
}
const confirm = await promptHidden('Repeat password: ');
if (confirm !== password) {
  console.error('Passwords do not match.');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set DATABASE_URL first (see docs/deploy.md).');
  process.exit(1);
}
// Remote databases such as Neon require TLS; their URL carries sslmode=require.
const pool = createPool(databaseUrl, false);
await migrate(pool);
await pool.query(
  `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
  [email.trim().toLowerCase(), await hash(password), role],
);
console.log(`User ${email.trim().toLowerCase()} saved.`);
await pool.end();
