## ADDED Requirements

### Requirement: Single SQLite database file
The app SHALL use exactly one SQLite database file at the path given by `runtimeConfig.databasePath`, accessed through `better-sqlite3` and Drizzle ORM. Opening the database SHALL create the parent directory if it does not exist, enable `journal_mode = WAL`, and enable `foreign_keys`.

#### Scenario: First open creates the file
- **WHEN** the database is opened at a path whose parent directory does not exist
- **THEN** the directory and the database file are created

#### Scenario: Pragmas are applied
- **WHEN** the database is opened
- **THEN** `PRAGMA journal_mode` returns `wal` and `PRAGMA foreign_keys` returns `1`

### Requirement: Shared lazy connection
Server code SHALL obtain the database through a single accessor that opens the connection on first use and returns the same instance on later calls.

#### Scenario: Same instance
- **WHEN** the accessor is called twice
- **THEN** both calls return the same database instance

### Requirement: Automatic migrations on server start
A Nitro plugin SHALL apply pending Drizzle migrations when the server starts. The migrations folder SHALL be resolved as an absolute path, by default `<process cwd>/server/db/migrations`, and SHALL be overridable with `NUXT_MIGRATIONS_DIR`. Migrations SHALL NOT depend on files bundled by Nitro.

#### Scenario: Pending migration is applied
- **WHEN** the server starts and the migrations folder contains a migration that has not been applied
- **THEN** the migration is applied and recorded

#### Scenario: Migrations are idempotent
- **WHEN** the server starts twice with the same migrations folder
- **THEN** the second start applies no migration and does not fail

### Requirement: No migrations yet
If the migrations folder exists but has no migration journal (`meta/_journal.json`), the plugin SHALL log that there is nothing to migrate and continue starting without error.

#### Scenario: Empty migrations folder
- **WHEN** the server starts and no migration has been generated yet
- **THEN** the server starts normally and the log states that no migrations were found

### Requirement: Missing migrations folder stops startup
If the migrations folder does not exist at all, the server SHALL fail to start with an error that names the path and mentions `NUXT_MIGRATIONS_DIR`, instead of silently running without migrations.

#### Scenario: Folder not found
- **WHEN** the server starts and the resolved migrations folder does not exist
- **THEN** startup fails with an error naming the folder and `NUXT_MIGRATIONS_DIR`

### Requirement: Migration failure stops startup
If applying a migration fails, the server SHALL fail to start rather than run against a partially migrated database.

#### Scenario: Broken migration
- **WHEN** a migration contains invalid SQL
- **THEN** server startup fails with the underlying error
