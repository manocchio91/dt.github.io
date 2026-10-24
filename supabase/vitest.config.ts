import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'db', environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 120_000 },
});
