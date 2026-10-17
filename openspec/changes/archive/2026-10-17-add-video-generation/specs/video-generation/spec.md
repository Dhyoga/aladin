## ADDED Requirements

### Requirement: Start a video from a finished post
`POST /api/generations/:id/video` (no body) SHALL start a `video` job for the generation, linked to its brand and to the generation, and answer 201 with the generation detail. The job input SHALL contain the brand's Brand DNA, the generation's prompt, the post's **current** caption and hashtags (so an edited caption is used), and the assets: the brand logo first (when the brand has one), then the photos chosen for the post that still exist, at most 4 assets in total. The duration (10 seconds) and the aspect ratio (9:16) SHALL be those required by the n8n contract.

#### Scenario: Successful start
- **WHEN** a finished post is asked for a video
- **THEN** the response is 201, `video.status` is `running`, and a `video` job exists with the generation id and the brand id

#### Scenario: Edited caption is used
- **WHEN** the caption of the post was edited to `Teks baru` before the video is requested
- **THEN** the dispatched input has `post.caption` equal to `Teks baru`

#### Scenario: Assets
- **WHEN** the brand has a logo and the post used two photos
- **THEN** the dispatched assets are the logo followed by the two photos, in the order chosen for the post

#### Scenario: A photo was deleted since the post
- **WHEN** one of the two photos of the post no longer exists
- **THEN** the video is started with the logo and the remaining photo only

### Requirement: When a video may be started
The endpoint SHALL answer 404 for an unknown generation. It SHALL answer 409, creating no job, when the post is not `completed`, when a video job is `queued` or `running`, when the video is already `completed`, when the brand is not `ready` or its Brand DNA is missing, or when none of the photos of the post exist any more. A generation whose latest video job `failed` (including by timeout), or that never had a video, SHALL be allowed to start one.

#### Scenario: Post not finished
- **WHEN** the post is still running or failed
- **THEN** the response is 409 and no job is created

#### Scenario: Video already running
- **WHEN** a video job is running
- **THEN** the response is 409 and no second job is created

#### Scenario: Video already done
- **WHEN** the video is completed
- **THEN** the response is 409 and the stored video is untouched

#### Scenario: Retry after failure
- **WHEN** the latest video job failed
- **THEN** a new job is started and the response is 201

#### Scenario: Retry after a timeout
- **WHEN** the latest video job has been running for more than 20 minutes
- **THEN** it counts as failed and a new job can be started

#### Scenario: Brand not ready
- **WHEN** the brand is `extracting` or `failed`
- **THEN** the response is 409

#### Scenario: No photos left
- **WHEN** every photo of the post was deleted
- **THEN** the response is 409 and no job is created

#### Scenario: Unknown generation
- **WHEN** the id does not exist
- **THEN** the response is 404

### Requirement: One click never starts two videos
Checking that no video job is running and creating the new job SHALL happen without any asynchronous step in between, so that two requests that arrive at the same time start exactly one job.

#### Scenario: Two simultaneous requests
- **WHEN** two requests for the same finished post are made at the same time
- **THEN** exactly one job is created, one request is answered 201 and the other 409

### Requirement: A new attempt clears the previous one
When a new attempt starts, the stored video script, storyboard path, and video path of the generation SHALL be cleared before the job is dispatched, so nothing of an earlier failed attempt is shown with the new one.

#### Scenario: Retry clears the earlier result
- **WHEN** a failed attempt had saved a script and a storyboard and a retry is started
- **THEN** the detail shows `script` and `storyboardUrl` as null until the new attempt delivers them

### Requirement: Dispatch failure is shown, not thrown
If n8n refuses the video job at dispatch, the endpoint SHALL still answer 201 and the video SHALL be `failed` with an error starting with `dispatch_failed`, so the user can retry.

#### Scenario: n8n refuses
- **WHEN** the dispatch fails with `n8n responded 500`
- **THEN** the response is 201 and `video.status` is `failed`

### Requirement: Video status derived from the job
The video status SHALL be derived when the generation is read from its latest `video` job, after applying the job timeout rule: `queued` or `running` → `running` with the job's `stage`, `completed` → `completed`, `failed` → `failed` with the job's `error`. A generation with no video job SHALL have `video` equal to null. Reading SHALL NOT write to the `generations` table.

#### Scenario: Running with a stage
- **WHEN** the video job is running at stage `storyboard`
- **THEN** `video.status` is `running` and `video.stage` is `storyboard`

#### Scenario: Timeout
- **WHEN** the video job has been running for more than 20 minutes
- **THEN** `video.status` is `failed` with error `timeout`

#### Scenario: Never requested
- **WHEN** no video job exists
- **THEN** `video` is null

#### Scenario: Latest job wins
- **WHEN** a failed video job is followed by a running one
- **THEN** `video.status` is `running` and `video.jobId` is the newer job
