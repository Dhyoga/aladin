## MODIFIED Requirements

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
