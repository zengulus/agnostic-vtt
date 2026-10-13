import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 960 },
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      AUTH_MODE: 'local',
      LOCAL_DATA_DIR: '/tmp/aether-browser-tests',
      ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173',
      VITE_BASE_PATH: '/',
      VITE_SERVER_URL: '',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
});
