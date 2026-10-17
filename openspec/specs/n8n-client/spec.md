# n8n-client Specification

## Purpose
Defines how the app sends jobs to n8n: the live webhook request and its failure handling, and the mock mode that replays fixtures through the real callback path.

## Requirements
### Requirement: Mode selection
The n8n client SHALL operate in `live` mode when `runtimeConfig.n8nMode` is `live` and in `mock` mode when it is `mock`. In `mock` mode it SHALL NOT perform any network request.

#### Scenario: Mock mode makes no request
- **WHEN** a job is dispatched in `mock` mode with a `fetch` function that fails the test if called
- **THEN** dispatch succeeds and `fetch` was never called

### Requirement: Live webhook request
In `live` mode the client SHALL send `POST <n8nBaseUrl>/webhook/<path>` (path per job type) with headers `Content-Type: application/json` and `X-Aladin-Secret` set to `sharedSecret`, and a JSON body validated against the n8n contract for that job type before sending. The body's `callback_url` SHALL be `<appInternalUrl>/api/n8n/callback` and `asset_base_url` SHALL be `<appInternalUrl>/api/internal/assets`, with a single slash between host and path when the configured URL has a trailing slash. A response with a 2xx status SHALL count as success.

#### Scenario: Request shape
- **WHEN** a `post` job is dispatched in `live` mode with `n8nBaseUrl` `http://n8n:5678` and `appInternalUrl` `http://aladin:3000`
- **THEN** `fetch` is called once with URL `http://n8n:5678/webhook/aladin-post-generate`, method `POST`, header `X-Aladin-Secret` equal to the shared secret, and a JSON body whose `job_id` is the job id, `callback_url` is `http://aladin:3000/api/n8n/callback`, and `asset_base_url` is `http://aladin:3000/api/internal/assets`

#### Scenario: Trailing slash in base URL
- **WHEN** `n8nBaseUrl` is `http://n8n:5678/`
- **THEN** the requested URL is `http://n8n:5678/webhook/aladin-post-generate` (no double slash)

#### Scenario: Invalid input is rejected before sending
- **WHEN** a `post` job is dispatched with an empty prompt
- **THEN** dispatch throws a validation error and `fetch` is not called

### Requirement: Live failure handling
In `live` mode, any non-2xx response, network error, or request exceeding 15 seconds SHALL make dispatch throw an error whose message states the status or cause and SHALL NOT contain the shared secret.

#### Scenario: Non-2xx response
- **WHEN** n8n responds with status 404
- **THEN** dispatch throws an error whose message contains `404` and does not contain the shared secret

#### Scenario: Network error
- **WHEN** `fetch` rejects with a connection error
- **THEN** dispatch throws an error that mentions the cause

#### Scenario: Request timeout
- **WHEN** n8n does not respond within 15 seconds
- **THEN** dispatch throws an error that mentions a timeout

### Requirement: Mock runs the real callback path
In `mock` mode, dispatch SHALL resolve immediately and then run a per-job-type scenario in the background. Each scenario event SHALL be delivered by calling the same callback core function the HTTP endpoint uses, with files in the same structure as parsed multipart files, so that status transitions, idempotency, validation, and result handlers behave exactly as in `live` mode.

#### Scenario: Dispatch does not wait for the scenario
- **WHEN** a `video` job is dispatched in `mock` mode
- **THEN** dispatch resolves before the first scenario event is delivered

#### Scenario: Events go through result handlers
- **WHEN** a result handler is registered for `post` and a mock `post` scenario completes
- **THEN** that handler's completion callback receives the validated payload and the `image` file

### Requirement: Mock scenarios
The mock SHALL provide one scenario per job type:

- `brand_extract`: progress `crawling` (for `source_type` `url`) or `reading` (for `pdf`), progress `structuring`, then completed with the fixture Brand DNA and the fixture logo.
- `post`: progress `caption`, progress `image`, then completed with the fixture caption, hashtags, image brief, and the fixture post image.
- `video`: progress `script` with the fixture script as payload, progress `storyboard` with the fixture storyboard file, progress `video`, then completed with the fixture script and the fixture video.

Delays between events SHALL be injectable so tests run without real waiting.

#### Scenario: Post scenario sequence
- **WHEN** a `post` scenario runs to the end
- **THEN** the job passed through stages `caption` then `image`, and finished `completed`

#### Scenario: Video scenario sequence
- **WHEN** a `video` scenario runs to the end
- **THEN** the job passed through stages `script`, `storyboard`, and `video`, a storyboard file was delivered with the second progress event, and the job finished `completed` with the video file delivered

#### Scenario: Brand extract from PDF
- **WHEN** a `brand_extract` scenario runs with `source_type` `pdf`
- **THEN** the first stage is `reading`

### Requirement: Mock failure trigger
When the dispatch input contains the text `mock:fail` (for example in the URL or the prompt), the mock scenario SHALL deliver its first progress event and then a `failed` event with a descriptive error, so the failure state can be demonstrated.

#### Scenario: Forced failure
- **WHEN** a `post` job whose prompt contains `mock:fail` runs in `mock` mode
- **THEN** the job ends `failed` with a non-empty error and no completion handler is called

### Requirement: Mock fixtures
The repository SHALL contain fixtures under `server/fixtures/` that the mock reads from the project root: a Brand DNA JSON, a post JSON (caption, hashtags, image brief), a video script JSON, a logo PNG, a post image PNG, a storyboard PNG, and a 9:16 10-second H.264/AAC MP4 with the moov atom at the start. All JSON fixtures SHALL validate against the n8n contract and Brand DNA schema.

#### Scenario: Fixtures conform to the contract
- **WHEN** the JSON fixtures are validated with the contract schemas
- **THEN** validation succeeds for all of them

#### Scenario: Fixture files exist and are non-empty
- **WHEN** the fixture loader reads `logo.png`, `post.png`, `storyboard.png`, and `video.mp4`
- **THEN** each returns a non-empty buffer with the matching file signature
