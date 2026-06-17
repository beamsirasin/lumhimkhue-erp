import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

function requireSafeE2eDatabaseUrl() {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'E2E_DATABASE_URL is required. Refusing to run Playwright against DATABASE_URL or production data.',
    );
  }

  const parsed = new URL(databaseUrl);
  const host = parsed.hostname.toLowerCase();
  const databaseName = parsed.pathname.toLowerCase();
  const safeLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const namedForTests = `${host}${databaseName}`.includes('test') || `${host}${databaseName}`.includes('e2e');

  if (!safeLocalHost && !namedForTests) {
    throw new Error(
      'E2E_DATABASE_URL must point to a local database or a database name/host containing "test" or "e2e".',
    );
  }

  return databaseUrl;
}

const e2eDatabaseUrl = requireSafeE2eDatabaseUrl();

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `npm run e2e:seed && npm run dev -- --hostname 127.0.0.1 --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'playwright-e2e-auth-secret-at-least-32-chars',
      AUTH_TRUST_HOST: 'true',
      DATABASE_URL: e2eDatabaseUrl,
      E2E_DATABASE_URL: e2eDatabaseUrl,
      NEXT_PUBLIC_APP_URL: baseURL,
    },
  },
});
