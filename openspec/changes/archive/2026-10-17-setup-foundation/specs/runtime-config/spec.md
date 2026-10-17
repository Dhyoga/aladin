## ADDED Requirements

### Requirement: Server-only runtime configuration
The app SHALL read all configuration through Nuxt `runtimeConfig` with no keys under `public`, and server code SHALL access it with `useRuntimeConfig(event)`. The configuration keys SHALL be `databasePath`, `mediaDir`, `n8nMode`, `n8nBaseUrl`, `appInternalUrl`, and `sharedSecret`.

#### Scenario: No public configuration
- **WHEN** the client bundle is inspected
- **THEN** it contains no configuration values (in particular not `sharedSecret`)

### Requirement: Safe local defaults
Without any environment variables, the app SHALL start in local mode with these defaults: `databasePath` = `./data/aladin.db`, `mediaDir` = `./data/media`, `n8nMode` = `mock`, `n8nBaseUrl` = empty, `appInternalUrl` = `http://localhost:3000`, `sharedSecret` = `dev-secret`.

#### Scenario: Start without a .env file
- **WHEN** `pnpm dev` is started in a clean checkout with no `.env`
- **THEN** the server starts, `n8nMode` is `mock`, and no request is made to n8n

### Requirement: Environment override with NUXT_ prefix
Each configuration key SHALL be overridable at runtime by the environment variable `NUXT_<KEY_IN_SNAKE_CASE>` (for example `NUXT_N8N_MODE`, `NUXT_SHARED_SECRET`). Environment variables without the `NUXT_` prefix SHALL NOT affect the configuration.

#### Scenario: Prefixed override
- **WHEN** the server starts with `NUXT_N8N_MODE=live`
- **THEN** `n8nMode` is `live`

#### Scenario: Unprefixed variable is ignored
- **WHEN** the server starts with `N8N_MODE=live` and no `NUXT_N8N_MODE`
- **THEN** `n8nMode` remains `mock`

### Requirement: Configuration validation
On server start the configuration SHALL be validated with a Zod schema from `shared/schemas`. `n8nMode` MUST be `mock` or `live`. An invalid configuration SHALL prevent the server from starting, with an error message naming the offending key.

#### Scenario: Invalid n8n mode
- **WHEN** the server starts with `NUXT_N8N_MODE=banana`
- **THEN** startup fails with an error that mentions `n8nMode`

### Requirement: Production secret enforcement
When `NODE_ENV` is `production`, the server SHALL refuse to start if `sharedSecret` equals the default value or is shorter than 32 characters. The error message SHALL mention `NUXT_SHARED_SECRET`. Outside production the default secret SHALL be accepted.

#### Scenario: Default secret in production
- **WHEN** the server starts with `NODE_ENV=production` and `sharedSecret` is `dev-secret`
- **THEN** startup fails with an error mentioning `NUXT_SHARED_SECRET`

#### Scenario: Short secret in production
- **WHEN** the server starts with `NODE_ENV=production` and a 20-character `sharedSecret`
- **THEN** startup fails with an error mentioning `NUXT_SHARED_SECRET`

#### Scenario: Valid secret in production
- **WHEN** the server starts with `NODE_ENV=production` and a 32-character non-default `sharedSecret`
- **THEN** startup succeeds

#### Scenario: Default secret in development
- **WHEN** the server starts with `NODE_ENV=development` and the default `sharedSecret`
- **THEN** startup succeeds
