## MODIFIED Requirements

### Requirement: File type detection from content
The app SHALL determine the type of an uploaded or delivered file from its first bytes and never from the client-supplied name or MIME type. It SHALL recognize PNG (`89 50 4E 47 0D 0A 1A 0A`), JPEG (`FF D8 FF`), WebP (`RIFF`, four size bytes, `WEBP`), PDF (`%PDF-`), and MP4 (the ASCII text `ftyp` in bytes 4 to 8), and report anything else as unknown. For each recognized type it SHALL provide the canonical MIME type and file extension (`image/png`/`png`, `image/jpeg`/`jpg`, `image/webp`/`webp`, `application/pdf`/`pdf`, `video/mp4`/`mp4`). Only PNG, JPEG, and WebP SHALL count as images; PDF and MP4 SHALL NOT.

#### Scenario: Each supported type
- **WHEN** buffers that start with the PNG, JPEG, WebP, PDF, and MP4 signatures are inspected
- **THEN** the results are `png`, `jpeg`, `webp`, `pdf`, and `mp4` with the canonical MIME types and extensions

#### Scenario: MP4 is not an image
- **WHEN** an MP4 buffer is checked for being an image
- **THEN** it is not an image, and neither is a PDF

#### Scenario: Disguised file
- **WHEN** a buffer containing HTML is inspected
- **THEN** the result is unknown

#### Scenario: Too short or empty
- **WHEN** an empty buffer or a buffer shorter than the signature is inspected
- **THEN** the result is unknown

#### Scenario: Other containers
- **WHEN** a WebM buffer (`1A 45 DF A3`) or an AVI buffer (`RIFF` with `AVI `) is inspected
- **THEN** the result is unknown
