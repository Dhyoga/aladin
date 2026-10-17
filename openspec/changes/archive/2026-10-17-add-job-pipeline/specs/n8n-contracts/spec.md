## ADDED Requirements

### Requirement: Single source of truth for n8n payloads
All payloads exchanged with n8n SHALL be defined as Zod schemas in `shared/schemas/n8n-contracts.ts`, shared by the request builder, the callback handler, the mock, and the tests. Field names on the wire SHALL be snake_case.

#### Scenario: Schemas are importable from client and server code
- **WHEN** `shared/schemas/n8n-contracts.ts` is imported
- **THEN** it exports the schemas and constants described below without depending on Nitro or Node-only modules

### Requirement: Webhook paths
Each job type SHALL map to a fixed webhook path: `brand_extract` → `aladin-brand-extract`, `post` → `aladin-post-generate`, `video` → `aladin-video-generate`.

#### Scenario: Path lookup
- **WHEN** the webhook path for `video` is requested
- **THEN** it is `aladin-video-generate`

### Requirement: Request envelope
Every webhook request body SHALL contain `job_id` (non-empty string), `callback_url` (valid URL), and `asset_base_url` (valid URL).

#### Scenario: Missing envelope field
- **WHEN** a request body without `callback_url` is validated
- **THEN** validation fails with an issue at path `callback_url`

### Requirement: Brand extract request
The brand extract request SHALL be a union discriminated by `source_type`: `url` with a required valid `url`, or `pdf` with a required non-empty `pdf_asset_id`.

#### Scenario: URL source
- **WHEN** `{ source_type: 'url', url: 'https://example.com' }` is validated with a valid envelope
- **THEN** validation succeeds

#### Scenario: PDF source without asset id
- **WHEN** `{ source_type: 'pdf' }` is validated
- **THEN** validation fails with an issue at path `pdf_asset_id`

#### Scenario: Unknown source type
- **WHEN** `source_type` is `docx`
- **THEN** validation fails

### Requirement: Post and video requests
The post request SHALL contain `brand_dna` (valid Brand DNA), `prompt` (1–2000 characters), `aspect_ratio` (`1:1` or `4:5`), and `assets` (at most 4 entries). The video request SHALL contain `brand_dna`, `prompt`, `post` (`{ caption, hashtags }`), `assets` (at most 4 entries), `duration_seconds` fixed to `10`, and `aspect_ratio` fixed to `9:16`. Each asset SHALL have `id`, `kind` (`logo` or `product_photo`), `mime`, and an optional `label`.

#### Scenario: Valid post request
- **WHEN** a post request with a valid Brand DNA, prompt, `4:5`, and one product photo asset is validated
- **THEN** validation succeeds

#### Scenario: Unsupported aspect ratio
- **WHEN** a post request has `aspect_ratio` `16:9`
- **THEN** validation fails with an issue at path `aspect_ratio`

#### Scenario: Empty prompt
- **WHEN** a post request has an empty `prompt`
- **THEN** validation fails

#### Scenario: Video duration fixed
- **WHEN** a video request has `duration_seconds` 15
- **THEN** validation fails

### Requirement: Callback fields
The callback form SHALL contain `job_id` (non-empty string) and `event` (`progress`, `completed`, or `failed`), and MAY contain `stage` (string of 1–50 characters), `payload` (a string), and `error` (a string). `stage` SHALL NOT be restricted to a fixed vocabulary. The contract SHALL additionally export the stage names known to the UI per job type: `brand_extract` → `crawling`, `reading`, `structuring`; `post` → `caption`, `image`; `video` → `script`, `storyboard`, `video`.

#### Scenario: Valid progress fields
- **WHEN** `{ job_id: 'job_1', event: 'progress', stage: 'anything-new' }` is validated
- **THEN** validation succeeds

#### Scenario: Unknown event
- **WHEN** `event` is `done`
- **THEN** validation fails with an issue at path `event`

#### Scenario: Missing job id
- **WHEN** `job_id` is absent or empty
- **THEN** validation fails

### Requirement: Completed payloads per job type
The `payload` of a `completed` callback SHALL be a JSON string that, once parsed, validates against the schema of its job type:

- `brand_extract`: `{ brand_dna }` with a valid Brand DNA.
- `post`: `{ caption, hashtags, image_brief }` where `caption` is non-empty, `hashtags` is an array of strings, and `image_brief` is an object with `headline` and `scene` strings, optional `subheadline` and `layout_notes`, and `chips` of at most 3 strings (default empty); unknown extra keys in `image_brief` SHALL be preserved.
- `video`: `{ script: { scenes } }` where `scenes` has at least one entry, each with numeric `start` and `end` (`end` greater than `start`), a `visual` string, an optional `on_screen_text` string, and a `voice_over` string.

The `payload` of a `progress` callback with `stage` `script` for a video job SHALL, when present, validate against the same script schema.

#### Scenario: Valid post payload
- **WHEN** a payload with a caption, two hashtags, and an image brief with headline and scene is validated for `post`
- **THEN** validation succeeds and `chips` defaults to an empty array

#### Scenario: Too many chips
- **WHEN** an image brief has 4 chips
- **THEN** validation fails

#### Scenario: Video scene with reversed times
- **WHEN** a scene has `start` 4 and `end` 2
- **THEN** validation fails

#### Scenario: Video payload without scenes
- **WHEN** `scenes` is an empty array
- **THEN** validation fails

### Requirement: Callback files and limits
The callback MAY carry the files `logo`, `image`, `storyboard`, and `video`. The contract SHALL export the maximum size per file: `logo` 10 MB, `image` 20 MB, `storyboard` 20 MB, `video` 100 MB, and a maximum total request size of 130 MB. It SHALL also export which files a `completed` callback requires per job type: `brand_extract` none, `post` `image`, `video` `video`.

#### Scenario: Required files lookup
- **WHEN** the required files for `post` are requested
- **THEN** the result is `image`

#### Scenario: Limits lookup
- **WHEN** the maximum size for `video` is requested
- **THEN** it is 100 MB (104857600 bytes)
