## ADDED Requirements

### Requirement: Result handler for post jobs
The app SHALL register a result handler for `post` jobs. When a job completes, the handler SHALL store the caption and the hashtags on the generation named by `job.generationId`, save the image as `generations/<generationId>/post.<ext>` under `mediaDir`, set `image_path`, and refresh `updated_at`. The extension SHALL come from the type detected from the image content (`png`, `jpg`, or `webp`), never from the file name or MIME type the sender gave.

#### Scenario: Successful post
- **WHEN** a `post` job completes with caption `Halo`, hashtags `["#a"]`, and a valid PNG image
- **THEN** the generation has that caption and hashtags, `image_path` `generations/<id>/post.png`, the file exists with the exact bytes, and the job is `completed`

#### Scenario: Extension follows the content
- **WHEN** the delivered image is a JPEG
- **THEN** the file is saved as `post.jpg`

### Requirement: Only real images are stored
The handler SHALL reject an image whose content is not a PNG, JPEG, or WebP, by throwing, so the pipeline fails the job with `handler_failed`. Nothing SHALL be written to the generation or to disk in that case.

#### Scenario: Image that is not an image
- **WHEN** the delivered `image` file contains HTML
- **THEN** the job ends `failed` with an error starting with `handler_failed`, the generation keeps no caption or image, and no file exists under `generations/<id>/`

### Requirement: Missing generation fails the job
If the job has no generation, or the generation no longer exists when the result arrives or when the row is updated, the handler SHALL throw, so the job fails with `handler_failed`, and SHALL remove any file it already wrote.

#### Scenario: Generation deleted while running
- **WHEN** the generation is deleted before the result arrives
- **THEN** the job ends `failed` with an error starting with `handler_failed` and no file is left behind

#### Scenario: Job without a generation
- **WHEN** a completed `post` job has no `generation_id`
- **THEN** the job ends `failed` with an error starting with `handler_failed`

### Requirement: Works end to end in mock mode
In mock mode, creating a generation SHALL end with the generation `completed`, the fixture caption and hashtags stored, and the fixture image saved and served by `/media`. A prompt containing `mock:fail` SHALL end with the generation `failed` and an error mentioning the mock failure. No network request SHALL be made.

#### Scenario: Mock success
- **WHEN** a generation is created in mock mode and the scenario finishes
- **THEN** it is `completed`, its caption is the fixture caption, and requesting its `imageUrl` returns a PNG

#### Scenario: Forced failure
- **WHEN** the prompt contains `mock:fail`
- **THEN** the generation ends `failed` with an error mentioning `mock:fail`, with no caption and no image
