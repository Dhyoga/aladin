## ADDED Requirements

### Requirement: Internal asset download for n8n
`GET /api/internal/assets/:id` SHALL return the file of the brand asset with that id (a `source_pdf`, a logo, or a product photo), so n8n can download inputs at `<asset_base_url>/<id>`. The file SHALL be served with the same `Content-Type`, `Content-Length`, `X-Content-Type-Options`, and `Range` behavior as the media route.

#### Scenario: Download a PDF
- **WHEN** n8n requests the id of a `source_pdf` asset with the right secret
- **THEN** the response is 200 with `Content-Type: application/pdf` and the exact file bytes

#### Scenario: Download a photo with a range
- **WHEN** n8n requests a photo with `Range: bytes=0-9`
- **THEN** the response is 206 with the first 10 bytes

### Requirement: Authentication and internal-only access
The endpoint SHALL answer 404 to any request that carries an `X-Forwarded-Host` header, and 401 when `X-Aladin-Secret` is missing or wrong, using the same constant-time check as the callback endpoint. Both checks SHALL run before the database is queried.

#### Scenario: Wrong secret
- **WHEN** a request has a wrong secret
- **THEN** the response is 401 and no file is returned

#### Scenario: Missing secret
- **WHEN** a request has no secret header
- **THEN** the response is 401

#### Scenario: Through the public proxy
- **WHEN** a request with the right secret also carries `X-Forwarded-Host`
- **THEN** the response is 404

### Requirement: Unknown asset
An id that does not exist SHALL yield 404, and so SHALL an asset whose file is missing on disk.

#### Scenario: Unknown id
- **WHEN** the id does not exist
- **THEN** the response is 404

#### Scenario: Row without file
- **WHEN** the asset row exists but its file was removed
- **THEN** the response is 404
