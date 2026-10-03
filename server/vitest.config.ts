import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SESSION_SECRET: 'test-secret-test-secret-test-secret-123',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://anyger:anyger_local_only@127.0.0.1:5433/anyger_test',
    },
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/scripts/**', 'src/db/migrate-cli.ts'],
    },
  },
});
