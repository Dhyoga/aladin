# generation-management Specification

## Purpose
Defines how Studio posts are requested and tracked: the generations table, creating a generation and its post job, input validation, status derived from the job, history, detail, editing caption and hashtags, and deletion.

## Requirements
### Requirement: Generations table
The app SHALL store one row per Studio prompt in a `generations` table (`id` starting with `gen_`, `brand_id`, `prompt`, `aspect_ratio` of `1:1` or `4:5`, `asset_ids_json`, `caption`, `hashtags_json`, `image_path`, `video_script_json`, `storyboard_path`, `video_path`, `created_at`, `updated_at`). The three video columns SHALL be nullable and SHALL be added by a Drizzle migration that leaves existing rows unchanged. `brand_id` SHALL be a foreign key that cascades on delete. The table SHALL be created by a Drizzle migration applied on server start, together with an index on `jobs(generation_id, created_at)`. The generation SHALL NOT store its own status or job id, neither for the post nor for the video.

#### Scenario: Cascade on brand delete
- **WHEN** a brand row that has two generation rows is deleted
- **THEN** both generation rows are deleted

#### Scenario: Migration on a fresh database
- **WHEN** the server starts against an empty database
- **THEN** the `generations` table exists next to `brands` and `jobs`, including the video columns

#### Scenario: Existing rows survive the video migration
- **WHEN** the migration that adds the video columns is applied to a database that already has generations
- **THEN** those rows are unchanged and their video columns are null

### Requirement: Create a generation
`POST /api/generations` with a JSON body `{ brandId, prompt, aspectRatio, assetIds }` SHALL create a generation and start a `post` job linked to both the brand and the generation. The job input SHALL contain the brand's Brand DNA, the trimmed prompt, the aspect ratio, and the assets: the brand logo first (when the brand has one), then the selected photos in the order given, each as `{ id, kind, mime, label }`. The response SHALL be 201 with the generation detail, including the status of the job that was just started.

#### Scenario: Successful creation
- **WHEN** a ready brand with a logo and two photos receives a request with both photo ids, prompt `promo ramadan`, and `4:5`
- **THEN** the response is 201, the generation has status `running`, and the dispatched input has `aspect_ratio` `4:5`, the brand's DNA, and three assets in the order logo, photo 1, photo 2

#### Scenario: Brand without a logo
- **WHEN** the brand has no logo
- **THEN** the dispatched assets contain only the selected photos

#### Scenario: n8n refuses the job
- **WHEN** the dispatch fails with `n8n responded 500`
- **THEN** the response is still 201 and the generation has status `failed` with an error starting with `dispatch_failed`

### Requirement: Input validation
`POST /api/generations` SHALL answer 400 when `prompt` is empty after trimming or longer than 2000 characters, when `aspectRatio` is not `1:1` or `4:5`, when `assetIds` has fewer than 1 or more than 3 entries or contains duplicates, or when any id is not a product photo of that brand. It SHALL answer 404 for an unknown brand and 409 when the brand is not `ready` or has no Brand DNA. Nothing SHALL be created and no job started in any of these cases.

#### Scenario: Invalid prompt or ratio
- **WHEN** the prompt is `   ` or 2001 characters, or the ratio is `16:9`
- **THEN** the response is 400

#### Scenario: Wrong number of photos
- **WHEN** `assetIds` is empty, or has four entries
- **THEN** the response is 400

#### Scenario: Duplicate photo ids
- **WHEN** the same photo id is sent twice
- **THEN** the response is 400

#### Scenario: Photo of another brand, logo, or unknown id
- **WHEN** an id belongs to another brand, is the brand's logo, or does not exist
- **THEN** the response is 400 and no job is started

#### Scenario: Unknown brand
- **WHEN** `brandId` does not exist
- **THEN** the response is 404

#### Scenario: Brand still extracting or failed
- **WHEN** the brand is `extracting` or `failed`
- **THEN** the response is 409

### Requirement: Status derived from the post job
A generation's status SHALL be derived when it is read from its latest `post` job, found through `jobs.generation_id`, after applying the job timeout rule: job `queued` or `running` → `running` (with the job's `stage`), `completed` → `completed`, `failed` → `failed` (with the job's `error`). A generation with no job SHALL be `failed` with a readable error when it is older than 60 seconds, and `running` before that. Reading SHALL NOT write to the `generations` table.

#### Scenario: Running with a stage
- **WHEN** the job is running at stage `image`
- **THEN** the generation is `running` with stage `image`

#### Scenario: Job failed
- **WHEN** the job failed with `Gemini quota exceeded`
- **THEN** the generation is `failed` with that error

#### Scenario: Timeout
- **WHEN** the job has been running for more than 5 minutes
- **THEN** the generation is `failed` with error `timeout`

#### Scenario: No job, old
- **WHEN** a generation created 2 minutes ago has no job
- **THEN** it is `failed`

#### Scenario: No job, just created
- **WHEN** a generation created 5 seconds ago has no job
- **THEN** it is `running`

### Requirement: Generation detail
`GET /api/generations/:id` SHALL return `{ id, brandId, prompt, aspectRatio, assetIds, caption, hashtags, imageUrl, status, stage, error, jobId, video, createdAt, updatedAt }`, where `imageUrl` is `/media/` followed by `image_path` or null, `caption` and `hashtags` are null while the post is not finished, and `jobId` is the id of the post job. `video` SHALL be null when no video was ever requested, and otherwise `{ status, stage, error, jobId, script, storyboardUrl, videoUrl }` with the status derived from the latest video job, `script` the stored video script or null, and `storyboardUrl` and `videoUrl` the media URLs of the stored files or null. An unknown id SHALL yield 404. Stored JSON (including the video script) that no longer satisfies its schema SHALL yield 500 with a message saying so.

#### Scenario: Completed generation
- **WHEN** a completed generation is read
- **THEN** it has status `completed`, a caption, hashtags, an `imageUrl` starting with `/media/generations/`, a `jobId`, and `video` null

#### Scenario: Generation with a finished video
- **WHEN** a generation whose video job completed is read
- **THEN** `video.status` is `completed` and `video.videoUrl`, `video.storyboardUrl`, and `video.script` are set

#### Scenario: Generation with a running video
- **WHEN** a video job is running and its script has arrived
- **THEN** `video.status` is `running`, `video.script` is set, and `video.videoUrl` is null

#### Scenario: Corrupt video script
- **WHEN** the stored `video_script_json` is not a valid script
- **THEN** the response is 500 with a message saying the stored data is invalid

#### Scenario: Unknown id
- **WHEN** the id does not exist
- **THEN** the response is 404

### Requirement: History
`GET /api/generations?brandId=` SHALL return the generations of that brand, newest first and at most 100, each as `{ id, brandId, prompt, aspectRatio, status, stage, imageUrl, createdAt }` with the status derived as above. A missing `brandId` SHALL yield 400. A brand without generations SHALL yield an empty array.

#### Scenario: Ordering and scope
- **WHEN** two brands have generations
- **THEN** only the requested brand's generations are returned, newest first

#### Scenario: Missing brand id
- **WHEN** the request has no `brandId`
- **THEN** the response is 400

#### Scenario: Cap
- **WHEN** a brand has 120 generations
- **THEN** 100 are returned, the newest ones

### Requirement: Edit caption and hashtags
`PATCH /api/generations/:id` with `{ caption?, hashtags? }` SHALL replace the given fields of a `completed` generation and answer 200 with the detail. `caption` MUST be 1 to 2200 characters after trimming. `hashtags` MUST have at most 30 entries; each entry is trimmed, any leading `#` characters are normalized to exactly one, entries containing spaces or longer than 100 characters are invalid, and duplicates (ignoring case) are dropped keeping the first. It SHALL answer 400 for invalid values, 409 when the generation is not `completed`, and 404 for an unknown id. An empty body SHALL change nothing and answer 200.

#### Scenario: Edit the caption
- **WHEN** the caption of a completed generation is patched to `Teks baru`
- **THEN** the response is 200 with that caption and `updatedAt` increased

#### Scenario: Hashtag with a space
- **WHEN** hashtags `["promo", "kopi senja"]` are sent
- **THEN** the response is 400 because `kopi senja` contains a space and nothing changes

#### Scenario: Hashtags normalized and deduplicated
- **WHEN** hashtags `["promo", "#Promo", "##baru"]` are sent
- **THEN** the stored hashtags are `["#promo", "#baru"]`

#### Scenario: Caption too long or empty
- **WHEN** the caption is empty, only spaces, or 2201 characters
- **THEN** the response is 400 and nothing changes

#### Scenario: Not finished yet
- **WHEN** a running or failed generation is patched
- **THEN** the response is 409

### Requirement: Delete a generation
`DELETE /api/generations/:id` SHALL remove the generation row and the folder `generations/<id>/` under `mediaDir` and answer 204. A failure to remove files SHALL be logged but SHALL NOT fail the request. An unknown id SHALL yield 404. Its jobs SHALL NOT be deleted.

#### Scenario: Delete with a file
- **WHEN** a completed generation is deleted
- **THEN** the response is 204, the row is gone, the folder no longer exists, and the job row still exists

#### Scenario: Delete while running
- **WHEN** a running generation is deleted and its job later completes
- **THEN** the job ends `failed` with an error starting with `handler_failed` and no file is left under `generations/`

#### Scenario: Unknown id
- **WHEN** the id does not exist
- **THEN** the response is 404
