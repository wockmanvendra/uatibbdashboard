import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      USE_MOCK_DATA: 'true',
      CACHE_DRIVER: 'memory',
      AUTH_RATE_LIMIT: '100000',
      // Sign-in goes to a stand-in Central User Service (src/test/central.ts).
      CENTRAL_USER_SERVICE_URL: 'http://central.test',
      CENTRAL_CLIENT_ID: 'ibb-insights',
      CENTRAL_API_KEY: 'test-api-key',
      ALL_DIVISION_MOBILES: '9000000009',
    },
  },
});
