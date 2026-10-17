import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { brands, generations } from '../../server/db/schema'
import { openDatabase } from '../../server/utils/db'
import { runMigrations } from '../../server/utils/migrate'
import { useTestDatabase } from './helpers'

const testDb = useTestDatabase()

const brand = (id: string) => ({
  id,
  name: `Brand ${id}`,
  sourceType: 'manual' as const,
  sourceUrl: null,
  sourceAssetId: null,
  dnaJson: null,
  status: 'ready' as const,
  createdAt: 1,
  updatedAt: 1
})

const generation = (id: string, brandId: string) => ({
  id,
  brandId,
  prompt: 'promo',
  aspectRatio: '4:5' as const,
  assetIdsJson: '["ast_1"]',
  caption: null,
  hashtagsJson: null,
  imagePath: null,
  createdAt: 1,
  updatedAt: 1
})

describe('generations table', () => {
  it('is created by the migration, with its indexes and the new jobs index', () => {
    const names = testDb.sqlite
      .prepare("select name from sqlite_master where type in ('table', 'index') order by name")
      .all()
      .map(row => (row as { name: string }).name)

    expect(names).toEqual(expect.arrayContaining(['generations', 'generations_brand_idx', 'jobs_generation_idx']))
  })

  it('has no status and no job id of its own (both come from the jobs), only the post and video results', () => {
    const columns = testDb.sqlite.prepare('pragma table_info(generations)').all().map(c => (c as { name: string }).name)
    expect(columns).toEqual([
      'id', 'brand_id', 'prompt', 'aspect_ratio', 'asset_ids_json', 'caption', 'hashtags_json', 'image_path',
      'created_at', 'updated_at', 'video_script_json', 'storyboard_path', 'video_path'
    ])
  })

  it('the three video columns are nullable and empty on a new generation', () => {
    testDb.db.insert(brands).values(brand('b1')).run()
    testDb.db.insert(generations).values(generation('g1', 'b1')).run()

    const row = testDb.db.select().from(generations).get()!
    expect(row).toMatchObject({ videoScriptJson: null, storyboardPath: null, videoPath: null })
    const info = testDb.sqlite.prepare('pragma table_info(generations)').all() as { name: string, notnull: number }[]
    for (const name of ['video_script_json', 'storyboard_path', 'video_path']) {
      expect(info.find(column => column.name === name)).toMatchObject({ notnull: 0 })
    }
  })

  it('cascade: deleting a brand deletes its generations and only its generations', () => {
    testDb.db.insert(brands).values([brand('b1'), brand('b2')]).run()
    testDb.db.insert(generations).values([generation('g1', 'b1'), generation('g2', 'b1'), generation('g3', 'b2')]).run()

    testDb.db.delete(brands).where(eq(brands.id, 'b1')).run()

    expect(testDb.db.select().from(generations).all().map(row => row.id)).toEqual(['g3'])
  })

  it('foreign key: a generation for a brand that does not exist is rejected', () => {
    expect(() => testDb.db.insert(generations).values(generation('g1', 'ghost')).run()).toThrow(/FOREIGN KEY/i)
  })

  it('the jobs index is used to find the jobs of a generation', () => {
    const plan = testDb.sqlite
      .prepare("explain query plan select * from jobs where generation_id = 'g1' order by created_at desc")
      .all()
      .map(row => (row as { detail: string }).detail)
      .join(' ')
    expect(plan).toMatch(/jobs_generation_idx/)
  })
})

describe('the video migration', () => {
  const MIGRATIONS = fileURLToPath(new URL('../../server/db/migrations', import.meta.url))

  it('is exactly three ADD COLUMN statements and nothing else', () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] }
    const sql = readFileSync(join(MIGRATIONS, `${journal.entries[3]!.tag}.sql`), 'utf8')
    const statements = sql.split('--> statement-breakpoint').map(part => part.trim().replace(/;$/, ''))
    expect(statements).toEqual([
      'ALTER TABLE `generations` ADD `video_script_json` text',
      'ALTER TABLE `generations` ADD `storyboard_path` text',
      'ALTER TABLE `generations` ADD `video_path` text'
    ])
  })

  it('leaves generations that existed before it untouched, with empty video columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aladin-migration-'))
    try {
      // A migrations folder that stops before the video migration, as a database from before it would be.
      const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] }
      const before = { ...journal, entries: journal.entries.slice(0, 3) }
      const oldDir = join(dir, 'old')
      mkdirSync(join(oldDir, 'meta'), { recursive: true })
      writeFileSync(join(oldDir, 'meta/_journal.json'), JSON.stringify(before))
      for (const entry of before.entries) copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(oldDir, `${entry.tag}.sql`))

      const { db, sqlite } = openDatabase(join(dir, 'aladin.db'))
      runMigrations(db, oldDir, { info: () => {} })
      expect(sqlite.prepare('pragma table_info(generations)').all()).toHaveLength(10) // no video columns yet

      sqlite.prepare("insert into brands (id, name, source_type, status, created_at, updated_at) values ('b1', 'Old', 'manual', 'ready', 1, 1)").run()
      sqlite.prepare(`insert into generations (id, brand_id, prompt, aspect_ratio, asset_ids_json, caption, hashtags_json, image_path, created_at, updated_at)
        values ('g_old', 'b1', 'promo', '4:5', '["a"]', 'Halo', '["#a"]', 'generations/g_old/post.png', 5, 6)`).run()

      runMigrations(db, MIGRATIONS, { info: () => {} }) // now the full folder: only the new migration runs

      expect(db.select().from(generations).where(eq(generations.id, 'g_old')).get()).toEqual({
        id: 'g_old',
        brandId: 'b1',
        prompt: 'promo',
        aspectRatio: '4:5',
        assetIdsJson: '["a"]',
        caption: 'Halo',
        hashtagsJson: '["#a"]',
        imagePath: 'generations/g_old/post.png',
        videoScriptJson: null,
        storyboardPath: null,
        videoPath: null,
        createdAt: 5,
        updatedAt: 6
      })
      expect(sqlite.prepare('select count(*) as n from __drizzle_migrations').get()).toEqual({ n: 4 })
      sqlite.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
