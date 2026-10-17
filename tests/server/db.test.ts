import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbAccessor, openDatabase } from '../../server/utils/db'
import { runMigrations } from '../../server/utils/migrate'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aladin-db-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeMigrations(sql: string): string {
  const migrationsDir = join(dir, 'migrations')
  mkdirSync(join(migrationsDir, 'meta'), { recursive: true })
  writeFileSync(
    join(migrationsDir, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: [{ idx: 0, version: '6', when: 1700000000000, tag: '0000_init', breakpoints: true }]
    })
  )
  writeFileSync(join(migrationsDir, '0000_init.sql'), sql)
  return migrationsDir
}

describe('openDatabase', () => {
  it('creates the parent directory and the database file', () => {
    const file = join(dir, 'nested', 'deeper', 'aladin.db')
    const { sqlite } = openDatabase(file)
    expect(existsSync(file)).toBe(true)
    sqlite.close()
  })

  it('enables WAL and foreign keys', () => {
    const { sqlite } = openDatabase(join(dir, 'aladin.db'))
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    sqlite.close()
  })
})

describe('createDbAccessor', () => {
  it('opens lazily once and returns the same instance', () => {
    const resolvePath = vi.fn(() => join(dir, 'aladin.db'))
    const getDb = createDbAccessor(resolvePath)
    expect(resolvePath).not.toHaveBeenCalled()

    const first = getDb()
    const second = getDb()
    expect(second).toBe(first)
    expect(resolvePath).toHaveBeenCalledTimes(1)
    first.sqlite.close()
  })
})

describe('runMigrations', () => {
  it('skips with a log when there is no migration journal', () => {
    const { db, sqlite } = openDatabase(join(dir, 'aladin.db'))
    const info = vi.fn()
    const emptyDir = join(dir, 'empty')
    mkdirSync(emptyDir)

    expect(runMigrations(db, emptyDir, { info })).toBe(false)
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/no migrations found/))
    sqlite.close()
  })

  it('throws when the migrations folder does not exist', () => {
    const { db, sqlite } = openDatabase(join(dir, 'aladin.db'))

    expect(() => runMigrations(db, join(dir, 'missing'), { info: vi.fn() }))
      .toThrow(/Migrations folder not found.*NUXT_MIGRATIONS_DIR/)
    sqlite.close()
  })

  it('applies a pending migration', () => {
    const { db, sqlite } = openDatabase(join(dir, 'aladin.db'))
    const migrationsDir = writeMigrations('CREATE TABLE widgets (id integer primary key, name text);')

    expect(runMigrations(db, migrationsDir, { info: vi.fn() })).toBe(true)
    sqlite.prepare('INSERT INTO widgets (name) VALUES (?)').run('a')
    expect(sqlite.prepare('SELECT count(*) AS n FROM widgets').get()).toEqual({ n: 1 })
    sqlite.close()
  })

  it('is idempotent on a second run', () => {
    const { db, sqlite } = openDatabase(join(dir, 'aladin.db'))
    const migrationsDir = writeMigrations('CREATE TABLE widgets (id integer primary key);')

    runMigrations(db, migrationsDir, { info: vi.fn() })
    expect(() => runMigrations(db, migrationsDir, { info: vi.fn() })).not.toThrow()
    expect(sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: 1 })
    sqlite.close()
  })

  it('propagates the error of a broken migration', () => {
    const { db, sqlite } = openDatabase(join(dir, 'aladin.db'))
    const migrationsDir = writeMigrations('THIS IS NOT SQL;')

    expect(() => runMigrations(db, migrationsDir, { info: vi.fn() })).toThrow()
    sqlite.close()
  })
})
