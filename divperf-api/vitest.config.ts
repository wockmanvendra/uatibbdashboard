import { defineConfig } from 'vitest/config';
import { TEST_USER_DATABASE_URL } from './src/test/testDb.js';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/test/globalSetup.ts'],
    // Test files share one user database.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      USE_MOCK_DATA: 'true',
      CACHE_DRIVER: 'memory',
      USER_DATABASE_URL: TEST_USER_DATABASE_URL,
      AUTH_RATE_LIMIT: '100000',
    },
  },
});
