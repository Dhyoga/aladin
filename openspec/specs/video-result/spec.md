# video-result Specification

## Purpose
Defines how the result of a video job is stored on its generation: script, storyboard image and MP4 video, plus failure cases and the mock end to end behavior.

## Requirements
### Requirement: Script and storyboard are saved as they arrive
The app SHALL register a result handler for `video` jobs. On a progress event that carries a valid video script payload for the `script` stage, the handler SHALL store the script on the generation. On a progress event that carries a `storyboard` file, it SHALL check that the file is a PNG, JPEG, or WebP image, save it as `generations/<id>/storyboard.<ext>` (extension from the content, never from the name), and set `storyboard_path`. A progress event for any other stage SHALL store nothing. Both results SHALL be visible in the generation detail while the video is still running.

#### Scenario: Script arrives
- **WHEN** the `script` progress event arrives with five scenes
- **THEN** the detail shows `video.script` with five scenes while `video.status` is still `running`

#### Scenario: Storyboard arrives
- **WHEN** the `storyboard` progress event arrives with a PNG
- **THEN** `generations/<id>/storyboard.png` exists and `video.storyboardUrl` points to it

#### Scenario: Video stage stores nothing
- **WHEN** the `video` progress event arrives
- **THEN** the generation row is unchanged

#### Scenario: Same event twice
- **WHEN** the same progress event is delivered twice
- **THEN** the stored result is the same as after one delivery

### Requirement: The finished video is saved
When a `video` job completes, the handler SHALL store the final script from the payload, store the storyboard if it was delivered with the completion and was not saved before, check that the `video` file is an MP4 (an `ftyp` box in bytes 4 to 8), save it as `generations/<id>/video.mp4`, and set `video_path`. The job SHALL then be `completed`.

#### Scenario: Successful video
- **WHEN** a video job completes with a valid payload and an MP4 file
- **THEN** `video.mp4` exists with the exact bytes, `video.videoUrl` points to it, and `video.status` is `completed`

#### Scenario: Storyboard sent only at completion
- **WHEN** the storyboard file arrives with the completion and not before
- **THEN** it is saved and `video.storyboardUrl` is set

#### Scenario: Final script replaces the progress script
- **WHEN** the completion payload has a script that differs from the one stored at progress
- **THEN** the stored script is the one from the completion

### Requirement: Only real files are stored
The handler SHALL throw, so the job fails with `handler_failed`, when the video is not an MP4 or when a storyboard is not an image, and SHALL write nothing for that file.

#### Scenario: Video that is not an MP4
- **WHEN** the delivered `video` file is a PNG or text
- **THEN** the job ends `failed` with an error starting with `handler_failed`, `video_path` stays null, and no `video.mp4` exists

#### Scenario: Storyboard that is not an image
- **WHEN** the delivered `storyboard` file contains HTML
- **THEN** the job ends `failed` with an error starting with `handler_failed` and no storyboard file exists

### Requirement: Storyboard files do not pile up
When a storyboard is saved, any storyboard file of the same generation with another extension SHALL be removed, so one generation never keeps two storyboard files.

#### Scenario: Type changes between attempts
- **WHEN** an earlier attempt saved `storyboard.png` and a new attempt delivers a JPEG
- **THEN** only `storyboard.jpg` remains and `storyboard_path` points to it

### Requirement: Missing generation fails the job
If the job has no generation, or the generation no longer exists when an event arrives or when the row is updated, the handler SHALL throw, so the job fails with `handler_failed`, and SHALL remove any file it already wrote for that event.

#### Scenario: Generation deleted while the video runs
- **WHEN** the generation is deleted and a later progress or completion event arrives
- **THEN** the job ends `failed` with an error starting with `handler_failed` and no file is left under `generations/`

### Requirement: Works end to end in mock mode
In mock mode, starting a video SHALL end with the video `completed`, with the fixture script, the fixture storyboard, and the fixture MP4 saved and served by `/media`, passing through the stages `script`, `storyboard`, and `video`. A video whose request contains the text `mock:fail` (for instance in the caption) SHALL end `failed` with an error mentioning the mock failure. No network request SHALL be made.

#### Scenario: Mock success
- **WHEN** a video is started in mock mode and the scenario finishes
- **THEN** `video.status` is `completed` and requesting `videoUrl` returns an MP4

#### Scenario: Stages in order
- **WHEN** the mock scenario runs one step at a time
- **THEN** the video shows stage `script` and a script, then stage `storyboard` and a storyboard, then stage `video`, and only at the end `completed` with a video

#### Scenario: Forced failure through the caption
- **WHEN** the caption contains `mock:fail` and a video is started
- **THEN** the video ends `failed` with an error mentioning `mock:fail`, and a retry after the caption is fixed can end `completed`
