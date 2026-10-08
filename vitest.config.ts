/**
 * FILE: vitest.config.ts
 * WHAT: Unit-test config. Tests live in tests/ and only touch pure code (matching/*, naukri parsers).
 * CALLED BY: `npm test`
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
