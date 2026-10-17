# brand-extraction Specification

## Purpose
Defines the `brand_extract` result handler that stores extracted Brand DNA, reconciles brand status from its job, handles logo and website from extraction, and fails jobs appropriately on error.

## Requirements
### Requirement: Result handler for brand_extract
The app SHALL register a result handler for `brand_extract` jobs. When a job completes, the handler SHALL store the validated Brand DNA as the brand's DNA, set `brands.name` to `identity.name`, set the status to `ready`, and refresh `updated_at`, all in one transaction and only while the brand is still `extracting`.

#### Scenario: Successful extraction
- **WHEN** a `brand_extract` job completes with a valid Brand DNA named `Kopi Senja` for an `extracting` brand
- **THEN** the brand has that DNA, name `Kopi Senja`, and status `ready`, and the job is `completed`

#### Scenario: Result replaces old DNA
- **WHEN** a re-extraction completes for a brand that already had a DNA
- **THEN** the stored DNA is the new one in full

### Requirement: Website from the source URL
When the extracted DNA has no `identity.website` and the brand has a `source_url`, the handler SHALL store the source URL as `identity.website`. An extracted website SHALL be kept as is.

#### Scenario: Website missing
- **WHEN** the result has no website and the brand's source URL is `https://kopisenja.example`
- **THEN** the stored DNA has `identity.website` `https://kopisenja.example`

#### Scenario: Website present
- **WHEN** the result has website `https://other.example`
- **THEN** the stored DNA keeps `https://other.example`

### Requirement: Logo from extraction
When the job delivered a `logo` file, the handler SHALL save it as the brand's logo only if the brand has no logo yet and the file is a valid PNG, JPEG, or WebP within the 10 MB limit. A logo the user already has SHALL never be replaced. An invalid logo SHALL be ignored with a warning in the log and SHALL NOT fail the extraction.

#### Scenario: Brand without logo
- **WHEN** the result carries a valid PNG logo and the brand has no logo
- **THEN** a logo asset exists under `brands/<brandId>/` and the DNA is stored

#### Scenario: Brand with a logo
- **WHEN** the result carries a logo and the brand already has one
- **THEN** the existing logo stays and the extracted logo is not stored

#### Scenario: Invalid logo
- **WHEN** the result carries a `logo` whose content is not an image
- **THEN** no logo is stored, a warning is logged, and the brand still becomes `ready`

### Requirement: Handler errors fail the job
If the job has no brand, the brand no longer exists, or the brand is no longer `extracting`, the handler SHALL throw so the pipeline marks the job `failed` with `handler_failed`. A logo file written before a failed transaction SHALL be removed.

#### Scenario: Brand deleted while extracting
- **WHEN** the brand was deleted before the result arrived
- **THEN** the job becomes `failed` with an error starting with `handler_failed`

#### Scenario: Brand not extracting
- **WHEN** the result arrives for a brand whose status is `ready`
- **THEN** the job becomes `failed` with an error starting with `handler_failed` and the brand is unchanged

### Requirement: Status reconciliation
When a brand with status `extracting` is read (detail or list), the app SHALL look at the brand's latest `brand_extract` job, applying the job timeout rule first. If that job is `failed` for any reason (dispatch failure, `failed` callback, invalid payload, handler failure, no handler, or timeout), the brand SHALL become `failed` (only while it is still `extracting`). If the brand is `extracting`, has no job, and was created more than 60 seconds ago, it SHALL become `failed`. A brand whose job is still queued or running SHALL remain `extracting`.

#### Scenario: n8n reports failure
- **WHEN** the extraction job failed with error `Gemini quota exceeded` and the brand is read
- **THEN** the brand is `failed` and `extraction.error` is `Gemini quota exceeded`

#### Scenario: Dispatch failed
- **WHEN** n8n rejected the job at dispatch
- **THEN** reading the brand shows `failed` with an `extraction.error` starting with `dispatch_failed`

#### Scenario: Timeout
- **WHEN** the extraction job has been running for more than 5 minutes and the brand is read
- **THEN** the brand is `failed` and `extraction.error` is `timeout`

#### Scenario: Still running
- **WHEN** the job is running and within its limit
- **THEN** the brand stays `extracting` and `extraction.stage` shows the job's current stage

#### Scenario: Brand without a job
- **WHEN** an `extracting` brand created 2 minutes ago has no job
- **THEN** reading it makes it `failed`

#### Scenario: Brand without a job, just created
- **WHEN** an `extracting` brand created 5 seconds ago has no job
- **THEN** it stays `extracting`

#### Scenario: Reconciliation is idempotent
- **WHEN** a brand that was already marked `failed` is read again
- **THEN** it stays `failed` and `extraction.error` still shows the job's error

### Requirement: Extraction works end to end in mock mode
In mock mode, creating a brand from a URL or a PDF SHALL end with the brand `ready` and the fixture Brand DNA stored, and creating a brand whose URL contains `mock:fail` SHALL end with the brand `failed` and an `extraction.error` mentioning the mock failure. No network request SHALL be made.

#### Scenario: URL brand reaches ready
- **WHEN** a brand is created from `https://example.com` in mock mode and the scenario finishes
- **THEN** the brand is `ready`, its name is the fixture brand name, its logo exists, and `identity.website` is `https://example.com`

#### Scenario: PDF brand reaches ready
- **WHEN** a brand is created from a PDF in mock mode and the scenario finishes
- **THEN** the brand is `ready` with the fixture DNA

#### Scenario: Forced failure
- **WHEN** a brand is created from `https://example.com/?x=mock:fail`
- **THEN** the brand ends `failed` and `extraction.error` mentions `mock:fail`
