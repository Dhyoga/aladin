## ADDED Requirements

### Requirement: Jobs table
The app SHALL persist jobs in a `jobs` table with the columns `id`, `type`, `brand_id`, `generation_id`, `status`, `stage`, `error`, `created_at`, `started_at`, `finished_at`, and `updated_at` (timestamps as unix milliseconds). `type` MUST be one of `brand_extract`, `post`, `video`. `status` MUST be one of `queued`, `running`, `completed`, `failed`. `brand_id` and `generation_id` SHALL be nullable and SHALL NOT be foreign keys. The table SHALL be created by a Drizzle migration applied on server start.

#### Scenario: Job creation
- **WHEN** a job of type `post` is created for brand `b1`
- **THEN** a row exists with an id starting with `job_`, status `queued`, `stage` null, `error` null, `started_at` null, `finished_at` null, and equal `created_at` and `updated_at`

#### Scenario: Migration applies on a fresh database
- **WHEN** the server starts against an empty database
- **THEN** the `jobs` table exists

### Requirement: Dispatch outcome
Starting a job SHALL create it as `queued`, send it to n8n through the n8n client, and then set it to `running` (recording `started_at`) if the client succeeds, or to `failed` with an `error` starting with `dispatch_failed` if the client throws. The call SHALL return the resulting job.

#### Scenario: n8n accepts the job
- **WHEN** a job is started and the n8n client resolves
- **THEN** the returned job has status `running` and a `started_at` timestamp

#### Scenario: n8n rejects the job
- **WHEN** a job is started and the n8n client throws an error with message `n8n responded 500`
- **THEN** the returned job has status `failed`, an `error` that starts with `dispatch_failed` and contains that message, and a `finished_at` timestamp

### Requirement: Atomic and final status transitions
Every status change SHALL be applied only if the job is currently in a status from which the transition is allowed, and SHALL report whether it was applied. Allowed transitions are `queued` → `running` | `failed`, and `running` → `completed` | `failed`, with a callback also allowed to move a `queued` job directly to `completed` or `failed`. `completed` and `failed` are final: no transition SHALL change a final job.

#### Scenario: Final job is immutable
- **WHEN** a transition to `failed` is attempted on a `completed` job
- **THEN** the transition reports that it was not applied and the job stays `completed`

#### Scenario: Competing transitions
- **WHEN** a completion and a timeout are both applied to the same `running` job, one after the other
- **THEN** only the first is applied and the job keeps the status that first transition set

### Requirement: Early callback does not regress a job
Marking a job `running` after dispatch SHALL only apply while the job is still `queued`, so a callback that already moved the job forward is never overwritten.

#### Scenario: Callback beat the dispatch response
- **WHEN** a job is `completed` by a callback and the dispatch then tries to mark it `running`
- **THEN** the job stays `completed`

### Requirement: Lazy timeout
A non-final job SHALL be treated as timed out when the time since `started_at` (or `created_at` when `started_at` is null) exceeds the limit for its type: 5 minutes for `brand_extract`, 5 minutes for `post`, and 20 minutes for `video`. Reading a job through the status endpoint SHALL mark a timed-out job `failed` with `error` equal to `timeout`. A bulk operation SHALL apply the same rule to all stale jobs.

#### Scenario: Running job past its limit
- **WHEN** a `post` job started 6 minutes ago is read
- **THEN** it is returned with status `failed` and error `timeout`

#### Scenario: Video job within its limit
- **WHEN** a `video` job started 10 minutes ago is read
- **THEN** it is returned with status `running`

#### Scenario: Job stuck in queued
- **WHEN** a `queued` job created 6 minutes ago with no `started_at` and type `post` is read
- **THEN** it is returned with status `failed` and error `timeout`

#### Scenario: Bulk expiry
- **WHEN** the bulk operation runs with one stale `running` job and one fresh `running` job
- **THEN** only the stale job becomes `failed` with error `timeout`

### Requirement: Job status endpoint
`GET /api/jobs/:id` SHALL return the job as `{ id, type, status, stage, error, brandId, generationId, createdAt, startedAt, finishedAt, updatedAt }` after applying the timeout check, with `Cache-Control: no-store`. An unknown id SHALL yield 404.

#### Scenario: Existing job
- **WHEN** a client requests the status of an existing running job
- **THEN** the response is 200 with its fields in camelCase and `Cache-Control: no-store`

#### Scenario: Unknown job
- **WHEN** a client requests a job id that does not exist
- **THEN** the response is 404
