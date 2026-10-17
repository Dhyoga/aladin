import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'

export interface AppDatabase {
  db: BetterSQLite3Database<typeof schema>
  sqlite: Database.Database
}

/** Opens (and creates, if needed) the SQLite file with the pragmas the app relies on. */
export function openDatabase(path: string): AppDatabase {
  const file = resolve(path)
  mkdirSync(dirname(file), { recursive: true })

  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  return { db: drizzle(sqlite, { schema }), sqlite }
}

/** Returns an accessor that opens the connection on first use and then reuses it. */
export function createDbAccessor(resolvePath: () => string): () => AppDatabase {
  let instance: AppDatabase | undefined
  return () => (instance ??= openDatabase(resolvePath()))
}

export const getDb = createDbAccessor(() => useRuntimeConfig().databasePath)
