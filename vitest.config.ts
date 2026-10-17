import { defineConfig } from 'vitest/config'

// Tests live in tests/ (not next to the code): files under server/utils are
// auto-imported by Nitro, so a *.test.ts there would end up in the bundle.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
