# studio-ui Specification

## Purpose
Defines the Studio page: the composer, empty states, progress while generating, the Instagram post mockup, result actions, failure and Retry, the history in the sidebar, and the mobile layout.

## Requirements
### Requirement: Composer
The `/studio` page SHALL show a composer for the active brand: a "CREATE WITH" row with a brand picker listing the brands that are ready (changing it changes the active brand shown in the sidebar too), a prompt textarea, a product photo picker, an aspect ratio toggle of `1:1` and `4:5` defaulting to `4:5`, and a primary **Generate Post** button carrying the cost label `~$0.04`. The photo picker SHALL show the brand's photos as thumbnails, allow selecting up to 3, and preselect the first photo. The button SHALL be disabled while the prompt is empty, while no photo is selected, and while a request is being sent. The prompt draft SHALL survive moving to another page and back.

#### Scenario: Defaults
- **WHEN** a brand with two photos is active
- **THEN** the first photo is selected, the ratio is `4:5`, and Generate Post is disabled until a prompt is typed

#### Scenario: Photo limit
- **WHEN** three photos are selected and a fourth is clicked
- **THEN** it is not selected and the user is told the limit is 3

#### Scenario: Generate
- **WHEN** the user types a prompt and clicks Generate Post
- **THEN** a generation is created, the result area shows it as running, and the button is disabled until the request returns

#### Scenario: Changing the brand
- **WHEN** another ready brand is picked
- **THEN** it becomes the active brand, the photo selection resets to its first photo, and the history shows its generations

### Requirement: Empty states
Without any brand the page SHALL invite the user to create one on the Brand DNA page. For an active brand without product photos the page SHALL explain that photos are needed, link to the Brand DNA page, and keep Generate Post disabled. Without an active brand but with ready brands, the page SHALL ask the user to pick one.

#### Scenario: No brands
- **WHEN** no brand exists
- **THEN** the page shows a message and a link to `/brand-dna`, and no composer

#### Scenario: Brand without photos
- **WHEN** the active brand has no product photos
- **THEN** Generate Post is disabled and a message links to `/brand-dna`

### Requirement: Progress while generating
While a generation is running, the result area SHALL show a placeholder with the proportions of the chosen ratio and the current step (`Caption` then `Image`), following the job with `useJobPolling` at a 2 second interval. When the job reaches a final state the page SHALL reload the generation and the history.

#### Scenario: Steps
- **WHEN** a mock generation runs
- **THEN** the area shows the step `Caption`, then `Image`, then the finished post, without a page reload

### Requirement: Instagram post mockup
A completed generation SHALL be shown as a mockup of an Instagram post on a black card: a header with the brand logo (or its initial) as a 32px avatar and the handle (`instagramHandle`, else the brand name), the image full width in the generation's ratio, a row of action icons, and below it the caption and the hashtags, with hashtags in the info color. The mockup SHALL be headed "This is what your followers will see".

#### Scenario: Completed post
- **WHEN** a completed generation is selected
- **THEN** the mockup shows the image, the caption, and the hashtags

#### Scenario: Handle fallback
- **WHEN** the brand has no Instagram handle
- **THEN** the header shows the brand name

### Requirement: Result actions
A completed generation SHALL offer **Copy caption**, **Edit caption**, **Download image**, and **Regenerate**. Copy SHALL place the caption, an empty line, and the hashtags separated by spaces on the clipboard and confirm it. Edit SHALL turn the caption into a textarea with Save and Cancel; Save stores the change through the API and shows it, Cancel restores the stored caption; an empty caption or one over 2200 characters SHALL be refused with a message. Download SHALL download the image file under a name made from the brand name and the generation id, with the extension of the file. Regenerate SHALL create a new generation with the same prompt, ratio, and photos that still exist (the brand's first photo when none remain) and select it.

#### Scenario: Copy
- **WHEN** Copy caption is clicked
- **THEN** the clipboard holds the caption, a blank line, and the hashtags, and the button briefly confirms

#### Scenario: Edit and save
- **WHEN** the user edits the caption and saves
- **THEN** the mockup shows the new caption and reloading the page still shows it

#### Scenario: Invalid edit
- **WHEN** the caption is cleared and Save is clicked
- **THEN** a message explains the problem and nothing is saved

#### Scenario: Regenerate
- **WHEN** Regenerate is clicked
- **THEN** a new generation with the same prompt appears in the history and is selected, and the previous one stays

### Requirement: Failure and Retry
A failed generation SHALL be shown as a card with a friendly message that includes the reason from the job when there is one, and a **Retry** button that does the same as Regenerate. The message SHALL NOT show raw status codes or stack traces.

#### Scenario: Forced failure
- **WHEN** the prompt contains `mock:fail`
- **THEN** the card says the post could not be created, shows the reason, and offers Retry

#### Scenario: Retry
- **WHEN** Retry is clicked on a failed generation
- **THEN** a new generation starts with the same prompt, ratio, and photos

### Requirement: History in the sidebar
On `/studio` the sidebar SHALL show the history of the active brand, newest first: for each generation a thumbnail (or a progress or failure icon), the beginning of the prompt, the time, and the status. Clicking an item shows that generation in the result area and, on small screens, closes the drawer. A running item SHALL update itself without a page reload. An item SHALL offer deleting the generation after a confirmation. The history SHALL NOT appear on other pages.

#### Scenario: Selecting from history
- **WHEN** an older generation is clicked
- **THEN** the result area shows its mockup

#### Scenario: Live update
- **WHEN** a generation is running in the history
- **THEN** its thumbnail replaces the progress icon when it finishes, without a reload

#### Scenario: Delete from history
- **WHEN** the user deletes an item and confirms
- **THEN** it disappears from the history and, if it was selected, the result area is cleared

#### Scenario: Other pages
- **WHEN** the user is on `/brand-dna`
- **THEN** the sidebar shows no history

### Requirement: Mobile
At 375px wide the Studio page SHALL have no horizontal scrolling, the composer SHALL stack vertically, and the mockup SHALL fit the width.

#### Scenario: Narrow screen
- **WHEN** the page is opened at 375px
- **THEN** the document is no wider than the viewport
