import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach } from 'vitest'
import { openDatabase, type AppDatabase } from '../../server/utils/db'
import { runMigrations } from '../../server/utils/migrate'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../server/db/migrations', import.meta.url))

/**
 * A fresh SQLite database per test, built with the real generated migrations, so the
 * tests also prove that the migration matches the Drizzle schema.
 */
export function useTestDatabase() {
  let dir = ''
  let opened: AppDatabase | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aladin-test-'))
    opened = openDatabase(join(dir, 'aladin.db'))
    runMigrations(opened.db, MIGRATIONS_DIR, { info: () => {} })
  })

  afterEach(() => {
    opened?.sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  })

  return {
    get db() {
      if (!opened) throw new Error('test database is only available inside a test')
      return opened.db
    },
    get sqlite() {
      if (!opened) throw new Error('test database is only available inside a test')
      return opened.sqlite
    }
  }
}

/** A fresh, empty media directory per test. */
export function useTestMedia() {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aladin-media-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  return {
    get dir() {
      if (!dir) throw new Error('test media dir is only available inside a test')
      return dir
    }
  }
}
