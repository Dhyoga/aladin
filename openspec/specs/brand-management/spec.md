# brand-management Specification

## Purpose
Defines brand CRUD operations: listing, creating from a website URL, PDF, or manual name, reading detail, updating Brand DNA, re-extracting, and deleting brands.

## Requirements
### Requirement: Brand persistence
The app SHALL store brands in a `brands` table (`id`, `name`, `source_type` of `url`, `pdf`, or `manual`, `source_url`, `source_asset_id`, `dna_json`, `status` of `extracting`, `ready`, or `failed`, `created_at`, `updated_at`) and their files in a `brand_assets` table (`id`, `brand_id`, `kind` of `logo`, `product_photo`, or `source_pdf`, `path`, `mime`, `size_bytes`, `label`, `sort_order`, `created_at`). `brand_assets.brand_id` SHALL be a foreign key that cascades on delete. Both tables SHALL be created by a Drizzle migration applied on server start.

#### Scenario: Cascade on delete
- **WHEN** a brand row with two asset rows is deleted
- **THEN** both asset rows are deleted

#### Scenario: Migration on a fresh database
- **WHEN** the server starts against an empty database
- **THEN** the `brands` and `brand_assets` tables exist next to `jobs`

### Requirement: List brands
`GET /api/brands` SHALL return all brands, newest first, each as `{ id, name, status, sourceType, logoUrl, updatedAt }`, where `logoUrl` is the media URL of the brand's logo or null. Brands that are `extracting` SHALL have their status reconciled before they are returned.

#### Scenario: Ordering and logo
- **WHEN** two brands exist and only the older one has a logo
- **THEN** the newer brand is listed first with `logoUrl` null, and the older one has `logoUrl` starting with `/media/brands/`

#### Scenario: Empty list
- **WHEN** no brand exists
- **THEN** the response is an empty array

### Requirement: Create a brand from a website
`POST /api/brands` with multipart fields `source_type=url` and a valid `http` or `https` `url` SHALL create a brand with status `extracting`, `source_url` set, and a name equal to the hostname without a leading `www.`, then start a `brand_extract` job for `{ source_type: 'url', url }` linked to the brand. The response SHALL be 201 with the brand detail, including the started extraction.

#### Scenario: Website brand
- **WHEN** a brand is created with `url` `https://www.kopisenja.example/about`
- **THEN** the response is 201, the brand has status `extracting`, name `kopisenja.example`, `sourceUrl` equal to the given URL, and `extraction` describes a running `brand_extract` job whose `brandId` is the new brand

#### Scenario: Non-http URL
- **WHEN** the URL is `ftp://example.com` or `javascript:alert(1)` or not a URL
- **THEN** the response is 400 and no brand is created

### Requirement: Create a brand from a PDF
`POST /api/brands` with `source_type=pdf` and a `file` part SHALL accept only a file whose content is a PDF and whose size is at most 20 MB, store it as a `source_pdf` asset, set `source_asset_id`, name the brand after the uploaded file name without its extension (control characters removed, trimmed, at most 100 characters, `Untitled brand` when nothing remains), and start a `brand_extract` job for `{ source_type: 'pdf', pdf_asset_id }`. The brand row and the asset row SHALL be created together or not at all.

#### Scenario: PDF brand
- **WHEN** a valid PDF named `Profil Kopi Senja.pdf` is uploaded
- **THEN** the response is 201, the brand has status `extracting` and name `Profil Kopi Senja`, a `source_pdf` asset exists under `brands/<brandId>/source/`, and the job was started with that asset's id

#### Scenario: File that is not a PDF
- **WHEN** a file named `x.pdf` whose content is not a PDF is uploaded
- **THEN** the response is 400 and neither a brand nor a file is created

#### Scenario: Missing file
- **WHEN** `source_type` is `pdf` and no file is sent
- **THEN** the response is 400

#### Scenario: File over the limit
- **WHEN** a PDF larger than 20 MB is uploaded
- **THEN** the response is 413 and nothing is created

### Requirement: Create a manual brand
`POST /api/brands` with `source_type=manual` and a `name` of 1 to 100 characters (after trimming) SHALL create a brand with status `ready` and no job. Its Brand DNA SHALL contain the name, empty strings for the required text fields, and empty lists.

#### Scenario: Manual brand
- **WHEN** a manual brand named `  Warung Kita  ` is created
- **THEN** the response is 201, the name is `Warung Kita`, the status is `ready`, `extraction` is null, and `dna` is valid Brand DNA with `identity.name` `Warung Kita`

#### Scenario: Invalid name
- **WHEN** the name is empty, only spaces, or longer than 100 characters
- **THEN** the response is 400

### Requirement: Creation input validation
`POST /api/brands` SHALL answer 400 for a missing or unknown `source_type`, and SHALL answer 413 when `Content-Length` exceeds 21 MB before reading the body. A non-multipart body SHALL yield 400.

#### Scenario: Unknown source type
- **WHEN** `source_type` is `docx`
- **THEN** the response is 400

#### Scenario: Oversized request
- **WHEN** the declared `Content-Length` is 22 MB
- **THEN** the response is 413

### Requirement: Brand detail
`GET /api/brands/:id` SHALL return `{ id, name, status, sourceType, sourceUrl, dna, logo, photos, extraction, createdAt, updatedAt }` after reconciling the status. `dna` is the stored Brand DNA or null while the first extraction has not finished, `logo` is the logo asset or null, `photos` are the product photos ordered by `sort_order` then creation time, and `extraction` describes the latest `brand_extract` job (`{ jobId, status, stage, error }`) for brands that are `extracting` or `failed`, and is null otherwise. An unknown id SHALL yield 404.

#### Scenario: Ready brand
- **WHEN** a ready brand with a logo and two photos is read
- **THEN** the response includes the DNA, the logo, the photos in order, and `extraction` null

#### Scenario: Unknown brand
- **WHEN** a brand id that does not exist is read
- **THEN** the response is 404

#### Scenario: Corrupt stored DNA
- **WHEN** the stored `dna_json` does not satisfy the Brand DNA schema
- **THEN** the response is 500 with a message saying the stored Brand DNA is invalid

### Requirement: Update the Brand DNA
`PATCH /api/brands/:id` with body `{ dna }` SHALL validate `dna` against the Brand DNA schema (400 with the issues otherwise), replace the stored DNA entirely, set `brands.name` to `dna.identity.name`, set the status to `ready`, and refresh `updated_at`. It SHALL answer 409 while the brand is `extracting` and 404 for an unknown brand. Updating a `failed` brand SHALL make it `ready`.

#### Scenario: Successful update
- **WHEN** a ready brand is patched with a DNA whose `identity.name` is `Nama Baru`
- **THEN** the response is 200 with the new DNA, the brand name is `Nama Baru`, and `updatedAt` increased

#### Scenario: Invalid DNA
- **WHEN** the DNA has an invalid color such as `red`
- **THEN** the response is 400 and the stored DNA is unchanged

#### Scenario: Patch during extraction
- **WHEN** a brand that is `extracting` is patched
- **THEN** the response is 409 and nothing changes

#### Scenario: Taking over a failed brand
- **WHEN** a `failed` brand is patched with a valid DNA
- **THEN** its status becomes `ready`

### Requirement: Re-extract a brand
`POST /api/brands/:id/re-extract` SHALL start a new `brand_extract` job from the brand's original source (its `source_url`, or its `source_pdf` asset) and set the status to `extracting`. It SHALL answer 400 for a `manual` brand, 409 when the brand is already `extracting` (so a double click starts only one job), and 404 for an unknown brand. The previous DNA SHALL stay stored until a new result replaces it.

#### Scenario: Re-extract a ready brand
- **WHEN** a ready URL brand is re-extracted
- **THEN** the response contains status `extracting` and a new running job, and the old DNA is still stored

#### Scenario: Double click
- **WHEN** re-extract is requested twice in a row
- **THEN** the first response is successful, the second is 409, and exactly one extraction job exists for that request pair

#### Scenario: Manual brand
- **WHEN** a manual brand is re-extracted
- **THEN** the response is 400

#### Scenario: Retry after failure
- **WHEN** a `failed` PDF brand is re-extracted
- **THEN** a new job starts with the id of the brand's `source_pdf` asset and the status becomes `extracting`

### Requirement: Delete a brand
`DELETE /api/brands/:id` SHALL remove the brand, its asset rows, its generation rows, the folder `brands/<id>/`, and the folder `generations/<generationId>/` of each of its generations under `mediaDir`, and answer 204. A failure to remove files SHALL be logged but SHALL NOT fail the request. An unknown id SHALL yield 404. Jobs belonging to the brand SHALL NOT be deleted.

#### Scenario: Delete with files
- **WHEN** a brand with a logo, a photo, and a source PDF is deleted
- **THEN** the response is 204, no brand or asset rows remain, and the folder `brands/<id>` no longer exists

#### Scenario: Delete during extraction
- **WHEN** a brand with a running extraction job is deleted
- **THEN** the response is 204 and the job row still exists

#### Scenario: Unknown brand
- **WHEN** an id that does not exist is deleted
- **THEN** the response is 404

#### Scenario: Delete with generations
- **WHEN** a brand with two generations that each have a saved image is deleted
- **THEN** the response is 204, no generation rows remain, the folder `generations/<id>` of each of them no longer exists, and the generations of other brands and their folders are untouched
