# video-ui Specification

## Purpose
Defines the Studio user interface for requesting, following, viewing, and downloading video ads.

## Requirements
### Requirement: Video section of a finished post
Under the actions of a finished post the Studio SHALL show a video section. It SHALL NOT be shown while the post is running or failed. A post without a video SHALL show a card offering to turn the post into a 10-second Reel, with a **Generate Video** button that carries the cost label `~$1`.

#### Scenario: Post without a video
- **WHEN** a finished post without a video is shown
- **THEN** the video section offers Generate Video with the cost label

#### Scenario: Post not finished
- **WHEN** the post is still running or failed
- **THEN** there is no video section

### Requirement: Cost confirmation
Clicking Generate Video, and clicking Retry, SHALL open a confirmation dialog that states the cost (about $1) and that it takes a few minutes. The API SHALL be called only after the user confirms; cancelling SHALL start nothing.

#### Scenario: Confirm
- **WHEN** the user clicks Generate Video and confirms
- **THEN** a video is started and the section shows its progress

#### Scenario: Cancel
- **WHEN** the user clicks Generate Video and cancels
- **THEN** no video is started and the section is as before

### Requirement: Progress
While the video runs, the section SHALL show the steps `Script`, `Storyboard`, and `Video` as connected steps, with the current one highlighted and animated and finished ones marked, following the job with `useJobPolling` at a 4 second interval. As soon as the storyboard exists it SHALL be shown, even while the video is still being rendered. When the job reaches a final state the section SHALL show the result without a page reload.

#### Scenario: Steps
- **WHEN** a mock video runs
- **THEN** the section goes through Script, Storyboard, and Video

#### Scenario: Storyboard before the video
- **WHEN** the storyboard stage is reached
- **THEN** the storyboard image is visible while the Video step is still running

#### Scenario: Finishing
- **WHEN** the job completes
- **THEN** the progress is replaced by the player without reloading

#### Scenario: Reload during the video
- **WHEN** the page is reloaded while the video runs and the post is selected again
- **THEN** the section shows the progress and finishes by itself

### Requirement: Reels player
A completed video SHALL be shown in a mockup of a Reels screen: a 9:16 frame with 28px rounded corners, a `<video>` element that has controls, plays inline, and covers the frame, and a gradient at the bottom with the handle and the beginning of the caption placed above the native controls so the controls stay usable. The video SHALL be served so it can be seeked (HTTP `Range`).

#### Scenario: Playable
- **WHEN** a completed video is shown
- **THEN** the video element loads its metadata with 9:16 proportions

#### Scenario: Seeking
- **WHEN** the browser requests part of the video with a `Range` header
- **THEN** the response is 206 with that part

### Requirement: Script, downloads
A completed video SHALL show its script in a collapsible section listing each scene with its time range, the visual, the on-screen text, and the voice over. It SHALL offer **Download video** and **Download storyboard**, with file names made from the brand name and the generation id and the extension of each file, and SHALL show the storyboard image.

#### Scenario: Script
- **WHEN** the script section is opened
- **THEN** every scene is listed with its time range, visual, on-screen text, and voice over

#### Scenario: Downloads
- **WHEN** Download video and Download storyboard are clicked
- **THEN** the files are named like `kopi-senja-gen_abc.mp4` and `kopi-senja-gen_abc-storyboard.png`

### Requirement: Failure and Retry
A failed video SHALL be shown as a card with a friendly message, without raw status codes or stack traces, that includes the reason from the job when there is a readable one, and a **Retry** button that goes through the cost confirmation. The post above it SHALL stay untouched.

#### Scenario: Forced failure
- **WHEN** the caption contains `mock:fail` and a video is started
- **THEN** the card says the video could not be created, shows the reason, and offers Retry

#### Scenario: Retry
- **WHEN** the caption is fixed and Retry is confirmed
- **THEN** a new video starts on the same post and the failure card is replaced by the progress

### Requirement: Mobile
At 375px wide the video section SHALL not cause horizontal scrolling and the Reels frame SHALL fit the screen.

#### Scenario: Narrow screen
- **WHEN** a completed video is shown at 375px
- **THEN** the document is no wider than the viewport
