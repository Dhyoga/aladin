import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

/**
 * Applies pending Drizzle migrations from `migrationsDir`.
 * Returns false (and logs) when the folder exists but no migration has been generated yet.
 * Throws when the folder itself is missing (a misconfiguration, e.g. it was not copied
 * into the image) and when a migration fails, so the server does not start.
 */
export function runMigrations<TSchema extends Record<string, unknown>>(
  db: BetterSQLite3Database<TSchema>,
  migrationsDir: string,
  log: Pick<Console, 'info'> = console
): boolean {
  if (!existsSync(migrationsDir)) {
    throw new Error(`Migrations folder not found: ${migrationsDir} (set NUXT_MIGRATIONS_DIR to override)`)
  }

  if (!existsSync(join(migrationsDir, 'meta', '_journal.json'))) {
    log.info(`[db] no migrations found in ${migrationsDir}, nothing to migrate`)
    return false
  }

  migrate(db, { migrationsFolder: migrationsDir })
  log.info(`[db] migrations up to date (${migrationsDir})`)
  return true
}
