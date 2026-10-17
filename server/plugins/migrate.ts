import { resolve } from 'node:path'

// The migrations folder is not bundled by Nitro, so it is referenced by absolute
// path (cwd = project root in dev and /app in Docker). NUXT_MIGRATIONS_DIR overrides.
export default defineNitroPlugin(() => {
  const migrationsDir = process.env.NUXT_MIGRATIONS_DIR || resolve(process.cwd(), 'server/db/migrations')
  runMigrations(getDb().db, migrationsDir)
})
